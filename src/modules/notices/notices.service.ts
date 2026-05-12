import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AdminRole, AppLanguage, NoticeAttachment, Prisma, TranslatableEntityType } from '@prisma/client';
import { access, unlink } from 'fs/promises';
import { PaginatedResponse } from '../../common/dto';
import { PrismaService } from '../../prisma/prisma.service';
import { resolveOrganizationClassification } from '../../common/utils/organization-scope.util';
import { ContentTranslationService } from '@/common/translation/translation.service';
import {
  CleanupNoticeUploadsResponseDto,
  CreateNoticeDto,
  CreateNoticeTemplateDto,
  NoticeCleanupUploadFileDto,
  NoticeAttachmentPayloadDto,
  NoticeFilterDto,
  NoticeResponseDto,
  NoticeTemplateFilterDto,
  NoticeTemplateResponseDto,
  NoticeUploadResponseDto,
  UpdateNoticeTemplateDto,
  UpdateNoticeDto,
} from './dto';
import {
  buildNoticeStoragePath,
  ensureNoticeUploadDirs,
  NOTICE_ATTACHMENTS_DIR,
  NOTICE_IMAGES_DIR,
  normalizeUploadOriginalName,
  resolveNoticeAbsolutePath,
  resolveNoticeAbsolutePathCandidates,
  sanitizeStoredFileName,
} from './notices.storage';

type NoticeWithRelations = Prisma.NoticeGetPayload<{
  include: {
    organization: { select: { id: true; name: true } };
    noticeTemplate: { select: { id: true; name: true } };
    createdBy: { select: { id: true; name: true; username: true; role: true } };
    attachments: true;
  };
}>;

type NoticeTemplateWithRelations = Prisma.NoticeTemplateGetPayload<{
  include: {
    organization: { select: { id: true; name: true } };
  };
}>;

type NoticePermissionTarget = {
  organizationId: string;
  createdById: string | null;
};

type NoticeActorAccessContext = {
  actorType: 'SUPER_ADMIN' | 'COMPANY_MANAGER' | 'GROUP_MANAGER';
  manageableOrganizationIds?: string[];
  companyOrganizationId?: string;
  canEditScopedNotices: boolean;
};

@Injectable()
export class NoticesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly contentTranslationService: ContentTranslationService,
  ) {
    ensureNoticeUploadDirs();
  }

  private isSuperAdmin(role?: string): boolean {
    return role === AdminRole.SUPER_ADMIN || role === 'SUPER_ADMIN';
  }

  private async syncNoticeTranslations(
    noticeId: string,
    values: { title: string; contentHtml: string; contentText: string },
    updatedAt: Date,
  ): Promise<void> {
    await this.contentTranslationService.storeEntityTranslations(
      TranslatableEntityType.NOTICE,
      noticeId,
      AppLanguage.ko,
      values,
      updatedAt,
    );

    this.contentTranslationService.queueTranslationsFromKorean({
      entityType: TranslatableEntityType.NOTICE,
      entityId: noticeId,
      sourceUpdatedAt: updatedAt,
      fields: [
        { fieldKey: 'title', content: values.title },
        { fieldKey: 'contentHtml', content: values.contentHtml, isHtml: true },
        { fieldKey: 'contentText', content: values.contentText },
      ],
    });
  }

  private async resolveEffectiveReadableOrganizationIds(
    scopeOrganizationIds?: string[],
    actorContext?: NoticeActorAccessContext,
  ): Promise<string[] | undefined> {
    const actorReadableOrganizationIds = actorContext?.manageableOrganizationIds;
    if (actorReadableOrganizationIds) {
      return actorReadableOrganizationIds;
    }

    if (scopeOrganizationIds && scopeOrganizationIds.length > 0) {
      return this.resolveReadableOrganizationIds(scopeOrganizationIds);
    }

    return undefined;
  }

  private guessMimeType(fileName: string): string {
    const extension = fileName.split('.').pop()?.toLowerCase() ?? '';
    const mimeMap: Record<string, string> = {
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      png: 'image/png',
      gif: 'image/gif',
      webp: 'image/webp',
      bmp: 'image/bmp',
      svg: 'image/svg+xml',
      pdf: 'application/pdf',
      txt: 'text/plain',
      csv: 'text/csv',
      json: 'application/json',
      doc: 'application/msword',
      docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      xls: 'application/vnd.ms-excel',
      xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      ppt: 'application/vnd.ms-powerpoint',
      pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      zip: 'application/zip',
    };

    return mimeMap[extension] ?? 'application/octet-stream';
  }

  private async resolveReadableOrganizationIds(scopeOrganizationIds?: string[]): Promise<string[] | undefined> {
    if (!scopeOrganizationIds) {
      return undefined;
    }

    const visited = new Set<string>(scopeOrganizationIds);
    let frontier = [...new Set(scopeOrganizationIds)];

    while (frontier.length > 0) {
      const organizations = await this.prisma.organization.findMany({
        where: {
          id: { in: frontier },
        },
        select: { parentId: true },
      });

      const nextFrontier: string[] = [];
      for (const organization of organizations) {
        const parentId = organization.parentId;
        if (parentId && !visited.has(parentId)) {
          visited.add(parentId);
          nextFrontier.push(parentId);
        }
      }

      frontier = nextFrontier;
    }

    return Array.from(visited);
  }

  private async collectDescendantOrganizationIds(rootOrganizationId: string): Promise<string[]> {
    const visited = new Set<string>([rootOrganizationId]);
    let frontier = [rootOrganizationId];

    while (frontier.length > 0) {
      const children = await this.prisma.organization.findMany({
        where: {
          parentId: { in: frontier },
        },
        select: { id: true },
      });

      const nextFrontier: string[] = [];
      for (const child of children) {
        if (!visited.has(child.id)) {
          visited.add(child.id);
          nextFrontier.push(child.id);
        }
      }

      frontier = nextFrontier;
    }

    return Array.from(visited);
  }

  private async resolveAncestorCompanyId(organizationId: string): Promise<string | null> {
    const visited = new Set<string>();
    let currentOrganizationId: string | null = organizationId;
    let depth = 0;

    while (currentOrganizationId && !visited.has(currentOrganizationId) && depth < 40) {
      visited.add(currentOrganizationId);

      const organization: { id: string; parentId: string | null; teamCode: string | null } | null = await this.prisma.organization.findUnique({
        where: { id: currentOrganizationId },
        select: { id: true, parentId: true, teamCode: true },
      });

      if (!organization) {
        break;
      }

      if (resolveOrganizationClassification(organization) === 'COMPANY') {
        return organization.id;
      }

      currentOrganizationId = organization.parentId;
      depth += 1;
    }

    return null;
  }

  private async resolveAncestorGroupId(organizationId: string): Promise<string | null> {
    const visited = new Set<string>();
    let currentOrganizationId: string | null = organizationId;
    let depth = 0;

    while (currentOrganizationId && !visited.has(currentOrganizationId) && depth < 40) {
      visited.add(currentOrganizationId);

      const organization: { id: string; parentId: string | null; teamCode: string | null } | null = await this.prisma.organization.findUnique({
        where: { id: currentOrganizationId },
        select: { id: true, parentId: true, teamCode: true },
      });

      if (!organization) {
        break;
      }

      if (resolveOrganizationClassification(organization) === 'GROUP') {
        return organization.id;
      }

      currentOrganizationId = organization.parentId;
      depth += 1;
    }

    return null;
  }

  private async resolveActorAccessContext(
    actorUserId?: string,
    actorUserRole?: string,
  ): Promise<NoticeActorAccessContext> {
    if (this.isSuperAdmin(actorUserRole)) {
      return {
        actorType: 'SUPER_ADMIN',
        canEditScopedNotices: true,
      };
    }

    if (!actorUserId) {
      throw new ForbiddenException('사용자 정보를 확인할 수 없습니다.');
    }

    const account = await this.prisma.account.findUnique({
      where: { id: actorUserId },
      select: {
        organizationId: true,
        organization: {
          select: { id: true, parentId: true, teamCode: true },
        },
      },
    });

    if (!account?.organizationId) {
      throw new ForbiddenException('소속 회사 정보를 확인할 수 없습니다.');
    }

    const companyOrganizationId = await this.resolveAncestorCompanyId(account.organizationId);
    if (!companyOrganizationId) {
      throw new ForbiddenException('소속 회사 정보를 확인할 수 없습니다.');
    }

    const classification = account.organization
      ? resolveOrganizationClassification(account.organization)
      : null;

    if (classification === 'COMPANY') {
      return {
        actorType: 'COMPANY_MANAGER',
        manageableOrganizationIds: await this.collectDescendantOrganizationIds(companyOrganizationId),
        companyOrganizationId,
        canEditScopedNotices: true,
      };
    }

    const groupOrganizationId = await this.resolveAncestorGroupId(account.organizationId);
    if (!groupOrganizationId) {
      return {
        actorType: 'GROUP_MANAGER',
        manageableOrganizationIds: [companyOrganizationId],
        companyOrganizationId,
        canEditScopedNotices: false,
      };
    }

    const groupDescendantIds = await this.collectDescendantOrganizationIds(groupOrganizationId);
    return {
      actorType: 'GROUP_MANAGER',
      manageableOrganizationIds: Array.from(new Set([companyOrganizationId, ...groupDescendantIds])),
      companyOrganizationId,
      canEditScopedNotices: false,
    };
  }

  private async resolveActorReadableOrganizationIds(
    actorUserId?: string,
    actorUserRole?: string,
  ): Promise<string[] | undefined> {
    if (this.isSuperAdmin(actorUserRole)) {
      return undefined;
    }

    if (!actorUserId) {
      throw new ForbiddenException('사용자 정보를 확인할 수 없습니다.');
    }

    const account = await this.prisma.account.findUnique({
      where: { id: actorUserId },
      select: { organizationId: true },
    });

    if (!account?.organizationId) {
      throw new ForbiddenException('소속 회사 정보를 확인할 수 없습니다.');
    }

    return this.resolveReadableOrganizationIds([account.organizationId]);
  }

  private async resolveEffectiveNoticeViewOrganizationIds(
    scopeOrganizationIds?: string[],
    actorUserId?: string,
    actorUserRole?: string,
  ): Promise<string[] | undefined> {
    const [actorReadableOrganizationIds, scopedReadableOrganizationIds] = await Promise.all([
      this.resolveActorReadableOrganizationIds(actorUserId, actorUserRole),
      scopeOrganizationIds && scopeOrganizationIds.length > 0
        ? this.resolveReadableOrganizationIds(scopeOrganizationIds)
        : Promise.resolve(undefined),
    ]);

    if (actorReadableOrganizationIds && scopedReadableOrganizationIds) {
      return Array.from(new Set([
        ...actorReadableOrganizationIds,
        ...scopedReadableOrganizationIds,
      ]));
    }

    return actorReadableOrganizationIds ?? scopedReadableOrganizationIds;
  }

  private assertOrganizationInReadableScope(organizationId: string, readableOrganizationIds?: string[]): void {
    if (!readableOrganizationIds) {
      return;
    }

    if (!readableOrganizationIds.includes(organizationId)) {
      throw new ForbiddenException('다른 그룹 공지사항에는 접근할 수 없습니다.');
    }
  }

  private canReadNotice(
    organizationId: string,
    readableOrganizationIds?: string[],
  ): boolean {
    if (!readableOrganizationIds) {
      return true;
    }

    return readableOrganizationIds.includes(organizationId);
  }

  private canAccessNotice(
    notice: NoticePermissionTarget,
    currentUserId: string | undefined,
    actorContext: NoticeActorAccessContext,
    readableOrganizationIds?: string[],
  ): boolean {
    if (currentUserId && notice.createdById === currentUserId) {
      return true;
    }

    return this.canReadNotice(notice.organizationId, readableOrganizationIds);
  }

  private assertReadableNotice(
    notice: NoticePermissionTarget,
    currentUserId: string | undefined,
    actorContext: NoticeActorAccessContext,
    readableOrganizationIds?: string[],
  ): void {
    if (this.canAccessNotice(notice, currentUserId, actorContext, readableOrganizationIds)) {
      return;
    }

    throw new ForbiddenException('다른 그룹 공지사항에는 접근할 수 없습니다.');
  }

  private assertReadableOrganization(
    organizationId: string,
    readableOrganizationIds?: string[],
  ): void {
    if (this.canReadNotice(organizationId, readableOrganizationIds)) {
      return;
    }

    throw new ForbiddenException('다른 그룹 공지사항에는 접근할 수 없습니다.');
  }

  private extractContentText(contentHtml: string, requestedContentText?: string): string {
    const normalizedRequestedText = (requestedContentText ?? '').trim();
    if (normalizedRequestedText.length > 0) {
      return normalizedRequestedText;
    }

    return contentHtml
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private async resolveNewAttachmentData(item: NoticeAttachmentPayloadDto): Promise<Prisma.NoticeAttachmentCreateManyNoticeInput> {
    const fileName = item.fileName?.trim();
    const originalName = item.originalName ? normalizeUploadOriginalName(item.originalName) : undefined;
    const mimeType = item.mimeType?.trim();
    const size = item.size;
    const isInlineImage = item.isInlineImage === true;

    if (!fileName || !originalName || !mimeType || !size || size <= 0) {
      throw new BadRequestException('신규 첨부파일 정보가 올바르지 않습니다.');
    }

    const safeFileName = sanitizeStoredFileName(fileName);
    const storagePath = buildNoticeStoragePath(safeFileName, isInlineImage);
    const absolutePath = resolveNoticeAbsolutePath(storagePath);

    try {
      await access(absolutePath);
    } catch {
      throw new BadRequestException('업로드된 파일을 찾을 수 없습니다. 다시 업로드해주세요.');
    }

    return {
      fileName: safeFileName,
      originalName,
      mimeType,
      size,
      storagePath,
      isInlineImage,
    };
  }

  private async normalizeAttachments(
    incomingAttachments: NoticeAttachmentPayloadDto[] | undefined,
    existingAttachments: NoticeAttachment[],
  ): Promise<{
    keepAttachmentIds: string[];
    newAttachments: Prisma.NoticeAttachmentCreateManyNoticeInput[];
  }> {
    const keepAttachmentIds = new Set<string>();
    const newAttachments: Prisma.NoticeAttachmentCreateManyNoticeInput[] = [];

    if (!incomingAttachments) {
      return {
        keepAttachmentIds: existingAttachments.map((attachment) => attachment.id),
        newAttachments,
      };
    }

    const existingAttachmentById = new Map(existingAttachments.map((attachment) => [attachment.id, attachment]));

    for (const item of incomingAttachments) {
      if (item.id) {
        if (!existingAttachmentById.has(item.id)) {
          throw new BadRequestException('유지할 첨부파일 정보가 올바르지 않습니다.');
        }

        keepAttachmentIds.add(item.id);
        continue;
      }

      const data = await this.resolveNewAttachmentData(item);
      newAttachments.push(data);
    }

    return {
      keepAttachmentIds: Array.from(keepAttachmentIds),
      newAttachments,
    };
  }

  private async removePhysicalFiles(attachments: NoticeAttachment[]): Promise<void> {
    for (const attachment of attachments) {
      const candidatePaths = resolveNoticeAbsolutePathCandidates(attachment.storagePath);
      for (const absolutePath of candidatePaths) {
        try {
          await unlink(absolutePath);
        } catch {
          // 파일 정리는 best-effort로 수행
        }
      }
    }
  }

  private async removeUnreferencedUploadFile(item: NoticeCleanupUploadFileDto): Promise<'deleted' | 'referenced' | 'missing'> {
    const safeFileName = sanitizeStoredFileName(item.fileName);
    const referenced = await this.prisma.noticeAttachment.findFirst({
      where: { fileName: safeFileName },
      select: { id: true },
    });

    if (referenced) {
      return 'referenced';
    }

    const storagePaths = typeof item.isInlineImage === 'boolean'
      ? [buildNoticeStoragePath(safeFileName, item.isInlineImage)]
      : [
          buildNoticeStoragePath(safeFileName, true),
          buildNoticeStoragePath(safeFileName, false),
        ];

    const candidatePaths = Array.from(new Set(
      storagePaths.flatMap((storagePath) => resolveNoticeAbsolutePathCandidates(storagePath)),
    ));

    let deleted = false;
    for (const absolutePath of candidatePaths) {
      try {
        await unlink(absolutePath);
        deleted = true;
      } catch {
        // 파일 정리는 best-effort로 수행
      }
    }

    return deleted ? 'deleted' : 'missing';
  }

  private async ensureActiveNoticeTargetOrganizationExists(organizationId: string): Promise<void> {
    const organization = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { id: true, isActive: true, parentId: true, teamCode: true },
    });

    if (!organization || !organization.isActive) {
      throw new NotFoundException('유효한 현장을 찾을 수 없습니다.');
    }

    const classification = resolveOrganizationClassification(organization);
    if (classification !== 'COMPANY' && classification !== 'GROUP') {
      throw new BadRequestException('공지사항과 공지 양식은 회사 또는 그룹 현장에만 연결할 수 있습니다.');
    }
  }

  private async resolveScopedNoticeFilterOrganizationIds(
    organizationId: string,
    readableOrganizationIds?: string[],
  ): Promise<string[]> {
    const descendantOrganizationIds = await this.collectDescendantOrganizationIds(organizationId);

    if (!readableOrganizationIds) {
      return descendantOrganizationIds;
    }

    return descendantOrganizationIds.filter((candidateId) => readableOrganizationIds.includes(candidateId));
  }

  private async canActorEditScopedNotices(actorUserId?: string, actorUserRole?: string): Promise<boolean> {
    if (this.isSuperAdmin(actorUserRole)) {
      return true;
    }

    if (!actorUserId) {
      return false;
    }

    const account = await this.prisma.account.findUnique({
      where: { id: actorUserId },
      select: {
        organization: {
          select: { id: true, parentId: true, teamCode: true },
        },
      },
    });

    if (!account?.organization) {
      return false;
    }

    return resolveOrganizationClassification(account.organization) === 'COMPANY';
  }

  private canEditNotice(
    notice: NoticePermissionTarget,
    currentUserId?: string,
    currentUserRole?: string,
    readableOrganizationIds?: string[],
    canEditScopedNotices: boolean = false,
  ): boolean {
    if (this.isSuperAdmin(currentUserRole)) {
      return true;
    }

    if (canEditScopedNotices && this.canReadNotice(notice.organizationId, readableOrganizationIds)) {
      return true;
    }

    return Boolean(currentUserId && notice.createdById === currentUserId);
  }

  private async resolveNoticeTemplateId(
    noticeTemplateId: string | null | undefined,
    targetOrganizationId: string,
    readableOrganizationIds?: string[],
  ): Promise<string | null> {
    if (!noticeTemplateId) {
      return null;
    }

    const template = await this.prisma.noticeTemplate.findUnique({
      where: { id: noticeTemplateId },
      select: { id: true, organizationId: true },
    });

    if (!template) {
      throw new NotFoundException('공지 양식을 찾을 수 없습니다.');
    }

    this.assertReadableOrganization(template.organizationId, readableOrganizationIds);

    if (template.organizationId !== targetOrganizationId) {
      throw new BadRequestException('선택한 공지 양식은 게시 현장과 일치해야 합니다.');
    }

    return template.id;
  }

  private toResponseDto(
    notice: NoticeWithRelations,
    currentUserId?: string,
    currentUserRole?: string,
    readableOrganizationIds?: string[],
    canEditScopedNotices: boolean = false,
  ): NoticeResponseDto {
    return {
      id: notice.id,
      organizationId: notice.organizationId,
      noticeTemplateId: notice.noticeTemplate?.id ?? undefined,
      noticeTemplateName: notice.noticeTemplate?.name ?? undefined,
      isPinned: notice.isPinned,
      organizationName: notice.organization?.name,
      title: notice.title,
      contentHtml: notice.contentHtml,
      contentText: notice.contentText ?? undefined,
      createdById: notice.createdById ?? undefined,
      createdByName: notice.createdBy?.name ?? undefined,
      createdByRole: notice.createdBy?.role ?? undefined,
      isEditableByMe: this.canEditNotice(
        notice,
        currentUserId,
        currentUserRole,
        readableOrganizationIds,
        canEditScopedNotices,
      ),
      attachments: notice.attachments.map((attachment) => ({
        id: attachment.id,
        fileName: attachment.fileName,
        originalName: attachment.originalName,
        mimeType: attachment.mimeType,
        size: attachment.size,
        isInlineImage: attachment.isInlineImage,
        url: `/api/notices/files/${encodeURIComponent(attachment.fileName)}`,
        createdAt: attachment.createdAt,
      })),
      createdAt: notice.createdAt,
      updatedAt: notice.updatedAt,
    };
  }

  private toTemplateResponseDto(template: NoticeTemplateWithRelations): NoticeTemplateResponseDto {
    return {
      id: template.id,
      organizationId: template.organizationId,
      organizationName: template.organization?.name,
      name: template.name,
      title: template.title,
      contentHtml: template.contentHtml,
      contentText: template.contentText ?? undefined,
      createdAt: template.createdAt,
      updatedAt: template.updatedAt,
    };
  }

  async findAll(
    filter: NoticeFilterDto,
    scopeOrganizationIds?: string[],
    currentUserId?: string,
    currentUserRole?: string,
  ): Promise<PaginatedResponse<NoticeResponseDto>> {
    const actorContext = await this.resolveActorAccessContext(currentUserId, currentUserRole);
    const readableOrganizationIds = await this.resolveEffectiveNoticeViewOrganizationIds(
      scopeOrganizationIds,
      currentUserId,
      currentUserRole,
    );
    const manageableOrganizationIds = await this.resolveEffectiveReadableOrganizationIds(
      scopeOrganizationIds,
      actorContext,
    );
    const whereConditions: Prisma.NoticeWhereInput[] = [];

    if (readableOrganizationIds) {
      if (currentUserId) {
        whereConditions.push({
          OR: [
            { organizationId: { in: readableOrganizationIds } },
            { createdById: currentUserId },
          ],
        });
      } else {
        whereConditions.push({ organizationId: { in: readableOrganizationIds } });
      }
    }

    if (filter.organizationId) {
      if (actorContext.actorType === 'GROUP_MANAGER') {
        throw new BadRequestException('현장 담당자는 조직 필터를 사용할 수 없습니다.');
      }

      this.assertOrganizationInReadableScope(filter.organizationId, readableOrganizationIds);
      const scopedOrganizationIds = await this.resolveScopedNoticeFilterOrganizationIds(
        filter.organizationId,
        readableOrganizationIds,
      );
      whereConditions.push({ organizationId: { in: scopedOrganizationIds } });
    }

    const trimmedSearch = filter.search?.trim();
    if (trimmedSearch) {
      whereConditions.push({
        OR: [
          { title: { contains: trimmedSearch, mode: 'insensitive' } },
          { contentText: { contains: trimmedSearch, mode: 'insensitive' } },
        ],
      });
    }

    const where: Prisma.NoticeWhereInput = whereConditions.length > 0
      ? { AND: whereConditions }
      : {};

    const [rows, total] = await Promise.all([
      this.prisma.notice.findMany({
        where,
        include: {
          organization: { select: { id: true, name: true } },
          noticeTemplate: { select: { id: true, name: true } },
          createdBy: { select: { id: true, name: true, username: true, role: true } },
          attachments: {
            orderBy: { createdAt: 'asc' },
          },
        },
        skip: filter.skip,
        take: filter.take,
        orderBy: [
          { isPinned: 'desc' },
          { createdAt: 'desc' },
        ],
      }),
      this.prisma.notice.count({ where }),
    ]);

    return new PaginatedResponse(
      rows.map((row) => this.toResponseDto(
        row,
        currentUserId,
        currentUserRole,
        manageableOrganizationIds,
        actorContext.canEditScopedNotices,
      )),
      total,
      filter.page ?? 1,
      filter.limit ?? 20,
    );
  }

  async findOne(
    id: string,
    scopeOrganizationIds?: string[],
    currentUserId?: string,
    currentUserRole?: string,
  ): Promise<NoticeResponseDto> {
    const row = await this.prisma.notice.findUnique({
      where: { id },
      include: {
        organization: { select: { id: true, name: true } },
        noticeTemplate: { select: { id: true, name: true } },
        createdBy: { select: { id: true, name: true, username: true, role: true } },
        attachments: {
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    if (!row) {
      throw new NotFoundException('공지사항을 찾을 수 없습니다.');
    }

    const actorContext = await this.resolveActorAccessContext(currentUserId, currentUserRole);
    const readableOrganizationIds = await this.resolveEffectiveNoticeViewOrganizationIds(
      scopeOrganizationIds,
      currentUserId,
      currentUserRole,
    );
    const manageableOrganizationIds = await this.resolveEffectiveReadableOrganizationIds(
      scopeOrganizationIds,
      actorContext,
    );
    this.assertReadableNotice(row, currentUserId, actorContext, readableOrganizationIds);

    return this.toResponseDto(
      row,
      currentUserId,
      currentUserRole,
      manageableOrganizationIds,
      actorContext.canEditScopedNotices,
    );
  }

  async findTemplates(
    filter: NoticeTemplateFilterDto,
    scopeOrganizationIds?: string[],
    currentUserId?: string,
    currentUserRole?: string,
  ): Promise<NoticeTemplateResponseDto[]> {
    const actorContext = await this.resolveActorAccessContext(currentUserId, currentUserRole);
    const readableOrganizationIds = await this.resolveEffectiveReadableOrganizationIds(
      scopeOrganizationIds,
      actorContext,
    );
    const whereConditions: Prisma.NoticeTemplateWhereInput[] = [];

    if (readableOrganizationIds) {
      whereConditions.push({ organizationId: { in: readableOrganizationIds } });
    }

    if (filter.organizationId) {
      this.assertOrganizationInReadableScope(filter.organizationId, readableOrganizationIds);
      whereConditions.push({ organizationId: filter.organizationId });
    }

    const trimmedSearch = filter.search?.trim();
    if (trimmedSearch) {
      whereConditions.push({
        OR: [
          { name: { contains: trimmedSearch, mode: 'insensitive' } },
          { title: { contains: trimmedSearch, mode: 'insensitive' } },
        ],
      });
    }

    const rows = await this.prisma.noticeTemplate.findMany({
      where: whereConditions.length > 0 ? { AND: whereConditions } : {},
      include: {
        organization: { select: { id: true, name: true } },
      },
      orderBy: [
        { name: 'asc' },
        { updatedAt: 'desc' },
      ],
    });

    return rows.map((row) => this.toTemplateResponseDto(row));
  }

  async createTemplate(
    dto: CreateNoticeTemplateDto,
    scopeOrganizationIds?: string[],
    actorUserId?: string,
    actorUserRole?: string,
  ): Promise<NoticeTemplateResponseDto> {
    if (!actorUserId) {
      throw new ForbiddenException('사용자 정보를 확인할 수 없습니다.');
    }

    const actorContext = await this.resolveActorAccessContext(actorUserId, actorUserRole);
    const readableOrganizationIds = await this.resolveEffectiveReadableOrganizationIds(
      scopeOrganizationIds,
      actorContext,
    );
    this.assertOrganizationInReadableScope(dto.organizationId, readableOrganizationIds);
    await this.ensureActiveNoticeTargetOrganizationExists(dto.organizationId);

    const name = dto.name.trim();
    const title = dto.title.trim();
    const contentHtml = dto.contentHtml.trim();
    if (!name || !title || !contentHtml) {
      throw new BadRequestException('양식명, 기본 제목, 본문은 필수입니다.');
    }

    const created = await this.prisma.noticeTemplate.create({
      data: {
        organizationId: dto.organizationId,
        name,
        title,
        contentHtml,
        contentText: this.extractContentText(contentHtml, dto.contentText),
        createdById: actorUserId,
        updatedById: actorUserId,
      },
      include: {
        organization: { select: { id: true, name: true } },
      },
    });

    return this.toTemplateResponseDto(created);
  }

  async updateTemplate(
    id: string,
    dto: UpdateNoticeTemplateDto,
    scopeOrganizationIds?: string[],
    actorUserId?: string,
    actorUserRole?: string,
  ): Promise<NoticeTemplateResponseDto> {
    if (!actorUserId) {
      throw new ForbiddenException('사용자 정보를 확인할 수 없습니다.');
    }

    const existing = await this.prisma.noticeTemplate.findUnique({
      where: { id },
      include: {
        organization: { select: { id: true, name: true } },
      },
    });

    if (!existing) {
      throw new NotFoundException('공지 양식을 찾을 수 없습니다.');
    }

    const actorContext = await this.resolveActorAccessContext(actorUserId, actorUserRole);
    const readableOrganizationIds = await this.resolveEffectiveReadableOrganizationIds(
      scopeOrganizationIds,
      actorContext,
    );
    this.assertReadableOrganization(existing.organizationId, readableOrganizationIds);

    if (dto.organizationId) {
      this.assertOrganizationInReadableScope(dto.organizationId, readableOrganizationIds);
    }

    const targetOrganizationId = dto.organizationId ?? existing.organizationId;
    await this.ensureActiveNoticeTargetOrganizationExists(targetOrganizationId);

    const name = dto.name !== undefined ? dto.name.trim() : existing.name;
    const title = dto.title !== undefined ? dto.title.trim() : existing.title;
    const contentHtml = dto.contentHtml !== undefined ? dto.contentHtml.trim() : existing.contentHtml;
    const contentText = dto.contentText !== undefined
      ? this.extractContentText(contentHtml, dto.contentText)
      : existing.contentText;

    if (!name || !title || !contentHtml) {
      throw new BadRequestException('양식명, 기본 제목, 본문은 필수입니다.');
    }

    const updated = await this.prisma.noticeTemplate.update({
      where: { id: existing.id },
      data: {
        organizationId: targetOrganizationId,
        name,
        title,
        contentHtml,
        contentText,
        updatedById: actorUserId,
      },
      include: {
        organization: { select: { id: true, name: true } },
      },
    });

    return this.toTemplateResponseDto(updated);
  }

  async create(
    dto: CreateNoticeDto,
    scopeOrganizationIds: string[] | undefined,
    actorUserId?: string,
    actorUserRole?: string,
  ): Promise<NoticeResponseDto> {
    if (!actorUserId) {
      throw new ForbiddenException('사용자 정보를 확인할 수 없습니다.');
    }

    const actorContext = await this.resolveActorAccessContext(actorUserId, actorUserRole);
    const readableOrganizationIds = await this.resolveEffectiveReadableOrganizationIds(
      scopeOrganizationIds,
      actorContext,
    );
    this.assertOrganizationInReadableScope(dto.organizationId, readableOrganizationIds);
    await this.ensureActiveNoticeTargetOrganizationExists(dto.organizationId);

    const title = dto.title.trim();
    const contentHtml = dto.contentHtml.trim();
    if (!title || !contentHtml) {
      throw new BadRequestException('제목과 본문은 필수입니다.');
    }
    const contentText = this.extractContentText(contentHtml, dto.contentText);

    const attachmentPayload = await this.normalizeAttachments(dto.attachments, []);
    const noticeTemplateId = await this.resolveNoticeTemplateId(
      dto.noticeTemplateId,
      dto.organizationId,
      readableOrganizationIds,
    );

    const created = await this.prisma.notice.create({
      data: {
        organizationId: dto.organizationId,
        noticeTemplateId,
        isPinned: dto.isPinned === true,
        title,
        contentHtml,
        contentText,
        createdById: actorUserId,
        updatedById: actorUserId,
        attachments: {
          createMany: {
            data: attachmentPayload.newAttachments,
          },
        },
      },
      include: {
        organization: { select: { id: true, name: true } },
        noticeTemplate: { select: { id: true, name: true } },
        createdBy: { select: { id: true, name: true, username: true, role: true } },
        attachments: {
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    await this.syncNoticeTranslations(created.id, { title, contentHtml, contentText }, created.updatedAt);

    return this.toResponseDto(
      created,
      actorUserId,
      actorUserRole,
      readableOrganizationIds,
      actorContext.canEditScopedNotices,
    );
  }

  async update(
    id: string,
    dto: UpdateNoticeDto,
    scopeOrganizationIds: string[] | undefined,
    actorUserId?: string,
    actorUserRole?: string,
  ): Promise<NoticeResponseDto> {
    if (!actorUserId) {
      throw new ForbiddenException('사용자 정보를 확인할 수 없습니다.');
    }

    const existing = await this.prisma.notice.findUnique({
      where: { id },
      include: {
        organization: { select: { id: true, name: true } },
        noticeTemplate: { select: { id: true, name: true } },
        createdBy: { select: { id: true, name: true, username: true, role: true } },
        attachments: {
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    if (!existing) {
      throw new NotFoundException('공지사항을 찾을 수 없습니다.');
    }

    const actorContext = await this.resolveActorAccessContext(actorUserId, actorUserRole);
    const readableOrganizationIds = await this.resolveEffectiveReadableOrganizationIds(
      scopeOrganizationIds,
      actorContext,
    );
    this.assertReadableNotice(existing, actorUserId, actorContext, readableOrganizationIds);

    if (!this.canEditNotice(existing, actorUserId, actorUserRole, readableOrganizationIds, actorContext.canEditScopedNotices)) {
      throw new ForbiddenException('슈퍼관리자, 회사 관리자 또는 작성자 본인만 수정할 수 있습니다.');
    }

    if (dto.organizationId) {
      this.assertOrganizationInReadableScope(dto.organizationId, readableOrganizationIds);
    }

    const targetOrganizationId = dto.organizationId ?? existing.organizationId;
    await this.ensureActiveNoticeTargetOrganizationExists(targetOrganizationId);

    const title = dto.title !== undefined ? dto.title.trim() : existing.title;
    const contentHtml = dto.contentHtml !== undefined ? dto.contentHtml.trim() : existing.contentHtml;
    const isPinned = dto.isPinned !== undefined ? dto.isPinned === true : existing.isPinned;

    if (!title || !contentHtml) {
      throw new BadRequestException('제목과 본문은 필수입니다.');
    }

    const attachmentPayload = await this.normalizeAttachments(dto.attachments, existing.attachments);
    const contentText = this.extractContentText(contentHtml, dto.contentText);
    const hasNoticeTemplateField = Object.prototype.hasOwnProperty.call(dto, 'noticeTemplateId');
    const noticeTemplateId = hasNoticeTemplateField
      ? await this.resolveNoticeTemplateId(dto.noticeTemplateId, targetOrganizationId, readableOrganizationIds)
      : existing.noticeTemplateId ?? null;
    const removedAttachments = existing.attachments.filter(
      (attachment) => !attachmentPayload.keepAttachmentIds.includes(attachment.id),
    );

    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.noticeAttachment.deleteMany({
        where: {
          noticeId: existing.id,
          id: {
            in: removedAttachments.map((attachment) => attachment.id),
          },
        },
      });

      if (attachmentPayload.newAttachments.length > 0) {
        await tx.noticeAttachment.createMany({
          data: attachmentPayload.newAttachments.map((attachment) => ({
            ...attachment,
            noticeId: existing.id,
          })),
        });
      }

      return tx.notice.update({
        where: { id: existing.id },
        data: {
          organizationId: targetOrganizationId,
          noticeTemplateId,
          isPinned,
          title,
          contentHtml,
          contentText,
          updatedById: actorUserId,
        },
        include: {
          organization: { select: { id: true, name: true } },
          noticeTemplate: { select: { id: true, name: true } },
          createdBy: { select: { id: true, name: true, username: true, role: true } },
          attachments: {
            orderBy: { createdAt: 'asc' },
          },
        },
      });
    });

    if (removedAttachments.length > 0) {
      await this.removePhysicalFiles(removedAttachments);
    }

    await this.syncNoticeTranslations(updated.id, { title, contentHtml, contentText }, updated.updatedAt);

    return this.toResponseDto(
      updated,
      actorUserId,
      actorUserRole,
      readableOrganizationIds,
      actorContext.canEditScopedNotices,
    );
  }

  async remove(
    id: string,
    scopeOrganizationIds: string[] | undefined,
    actorUserId?: string,
    actorUserRole?: string,
  ): Promise<void> {
    if (!actorUserId) {
      throw new ForbiddenException('사용자 정보를 확인할 수 없습니다.');
    }

    const existing = await this.prisma.notice.findUnique({
      where: { id },
      include: {
        createdBy: {
          select: { role: true },
        },
        attachments: true,
      },
    });

    if (!existing) {
      throw new NotFoundException('공지사항을 찾을 수 없습니다.');
    }

    const actorContext = await this.resolveActorAccessContext(actorUserId, actorUserRole);
    const readableOrganizationIds = await this.resolveEffectiveReadableOrganizationIds(
      scopeOrganizationIds,
      actorContext,
    );
    this.assertReadableNotice(existing, actorUserId, actorContext, readableOrganizationIds);

    if (!this.canEditNotice(existing, actorUserId, actorUserRole, readableOrganizationIds, actorContext.canEditScopedNotices)) {
      throw new ForbiddenException('슈퍼관리자, 회사 관리자 또는 작성자 본인만 삭제할 수 있습니다.');
    }

    await this.prisma.notice.delete({ where: { id: existing.id } });
    await this.removePhysicalFiles(existing.attachments);
  }

  async removeTemplate(
    id: string,
    scopeOrganizationIds?: string[],
    actorUserId?: string,
    actorUserRole?: string,
  ): Promise<void> {
    if (!actorUserId) {
      throw new ForbiddenException('사용자 정보를 확인할 수 없습니다.');
    }

    const existing = await this.prisma.noticeTemplate.findUnique({
      where: { id },
      select: { id: true, organizationId: true },
    });

    if (!existing) {
      throw new NotFoundException('공지 양식을 찾을 수 없습니다.');
    }

    const actorContext = await this.resolveActorAccessContext(actorUserId, actorUserRole);
    const readableOrganizationIds = await this.resolveEffectiveReadableOrganizationIds(
      scopeOrganizationIds,
      actorContext,
    );
    this.assertReadableOrganization(existing.organizationId, readableOrganizationIds);

    await this.prisma.noticeTemplate.delete({ where: { id: existing.id } });
  }

  buildUploadResponse(file: {
    filename: string;
    originalname: string;
    mimetype: string;
    size: number;
  }, isInlineImage: boolean): NoticeUploadResponseDto {
    const safeFileName = sanitizeStoredFileName(file.filename);

    return {
      fileName: safeFileName,
      originalName: file.originalname,
      mimeType: file.mimetype,
      size: file.size,
      isInlineImage,
      url: `/api/notices/files/${encodeURIComponent(safeFileName)}`,
    };
  }

  async cleanupUnreferencedUploads(files: NoticeCleanupUploadFileDto[] | undefined): Promise<CleanupNoticeUploadsResponseDto> {
    const normalized = Array.isArray(files) ? files : [];
    const unique = Array.from(new Map(
      normalized
        .filter((item) => Boolean(item?.fileName))
        .map((item) => [`${item.fileName}|${String(item.isInlineImage)}`, item]),
    ).values());

    let deleted = 0;
    let skippedReferenced = 0;
    let skippedMissing = 0;

    for (const item of unique) {
      const result = await this.removeUnreferencedUploadFile(item);
      if (result === 'deleted') {
        deleted += 1;
        continue;
      }

      if (result === 'referenced') {
        skippedReferenced += 1;
        continue;
      }

      skippedMissing += 1;
    }

    return {
      requested: unique.length,
      deleted,
      skippedReferenced,
      skippedMissing,
    };
  }

  async resolveDownloadFile(fileName: string): Promise<{
    absolutePath: string;
    originalName: string;
    mimeType: string;
    isInlineImage: boolean;
  }> {
    const safeFileName = sanitizeStoredFileName(fileName);
    const attachment = await this.prisma.noticeAttachment.findFirst({
      where: { fileName: safeFileName },
      orderBy: { createdAt: 'desc' },
      select: {
        storagePath: true,
        originalName: true,
        mimeType: true,
        isInlineImage: true,
      },
    });

    if (!attachment) {
      // During editor uploads, file metadata is not persisted until notice save.
      // Allow direct read by deterministic temp file name for immediate preview.
      const fallbackStorageCandidates = [
        { storagePath: `${NOTICE_IMAGES_DIR}/${safeFileName}`, isInlineImage: true },
        { storagePath: `${NOTICE_ATTACHMENTS_DIR}/${safeFileName}`, isInlineImage: false },
      ];

      for (const candidate of fallbackStorageCandidates) {
        const candidatePaths = resolveNoticeAbsolutePathCandidates(candidate.storagePath);
        for (const absolutePath of candidatePaths) {
          try {
            await access(absolutePath);
            return {
              absolutePath,
              originalName: safeFileName,
              mimeType: this.guessMimeType(safeFileName),
              isInlineImage: candidate.isInlineImage,
            };
          } catch {
            // continue searching
          }
        }
      }

      throw new NotFoundException('파일을 찾을 수 없습니다.');
    }

    const candidatePaths = resolveNoticeAbsolutePathCandidates(attachment.storagePath);
    let matchedPath: string | null = null;

    for (const candidate of candidatePaths) {
      try {
        await access(candidate);
        matchedPath = candidate;
        break;
      } catch {
        // try next candidate
      }
    }

    if (!matchedPath) {
      throw new NotFoundException('파일을 찾을 수 없습니다.');
    }

    return {
      absolutePath: matchedPath,
      originalName: attachment.originalName,
      mimeType: attachment.mimeType,
      isInlineImage: attachment.isInlineImage,
    };
  }
}
