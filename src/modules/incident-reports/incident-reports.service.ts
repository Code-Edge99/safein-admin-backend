import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AppLanguage,
  AuditAction,
  IncidentReportActionType,
  IncidentReportActorType,
  IncidentReportResolutionType,
  IncidentReportSeverity,
  IncidentReportStatus,
  Prisma,
  TranslatableEntityType,
} from '@prisma/client';
import { access } from 'fs/promises';
import * as path from 'path';
import { decryptLocation } from '../../common/security/location-crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { ContentTranslationService } from '@/common/translation/translation.service';
import {
  CreateIncidentReportCommentDto,
  IncidentReportActionDto,
  IncidentReportAttachmentDto,
  IncidentReportDetailDto,
  IncidentReportFilterDto,
  IncidentReportListItemDto,
  IncidentReportListResponseDto,
  IncidentReportLocationDto,
  ResolveIncidentReportDto,
  UpdateIncidentReportAssigneeDto,
  UpdateIncidentReportSeverityDto,
  UpdateIncidentReportStatusDto,
} from './dto';

const INCIDENT_REPORT_UPLOAD_ROOT_CANDIDATES = [
  path.resolve(process.cwd(), 'uploads', 'incident-reports'),
  path.resolve(process.cwd(), '..', 'uploads', 'incident-reports'),
  path.resolve(process.cwd(), '..', 'safein-app-backend', 'uploads', 'incident-reports'),
];

type IncidentReportDetailRow = Prisma.IncidentReportGetPayload<{
  include: {
    organization: { select: { id: true; name: true } };
    employee: { select: { id: true; name: true; phone: true } };
    zone: { select: { id: true; name: true } };
    assignedAdmin: { select: { id: true; name: true } };
    attachments: true;
    actions: {
      include: {
        employeeActor: { select: { id: true; name: true } };
        adminActor: { select: { id: true; name: true } };
      };
      orderBy: { createdAt: 'asc' };
    };
  };
}>;

@Injectable()
export class IncidentReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly contentTranslationService: ContentTranslationService,
  ) {}

  private async clearIncidentReportResolutionTranslations(reportId: string): Promise<void> {
    await this.contentTranslationService.deleteEntityTranslations(
      TranslatableEntityType.INCIDENT_REPORT,
      reportId,
      ['resolutionSummary'],
    );
    await this.contentTranslationService.deletePendingTranslationJobs(
      TranslatableEntityType.INCIDENT_REPORT,
      reportId,
      ['resolutionSummary'],
    );
  }

  private async syncIncidentReportResolutionTranslation(
    reportId: string,
    resolutionSummary: string,
    updatedAt: Date,
  ): Promise<void> {
    if (!resolutionSummary.trim()) {
      return;
    }

    await this.contentTranslationService.storeEntityTranslations(
      TranslatableEntityType.INCIDENT_REPORT,
      reportId,
      AppLanguage.ko,
      { resolutionSummary },
      updatedAt,
    );

    this.contentTranslationService.queueTranslationsFromKorean({
      entityType: TranslatableEntityType.INCIDENT_REPORT,
      entityId: reportId,
      sourceUpdatedAt: updatedAt,
      fields: [{ fieldKey: 'resolutionSummary', content: resolutionSummary }],
    });
  }

  private buildResolutionStateForStatusChange(
    previousStatus: IncidentReportStatus,
    nextStatus: IncidentReportStatus,
    resolvedAt: Date | null,
  ): Pick<Prisma.IncidentReportUpdateInput, 'resolutionType' | 'resolutionSummary' | 'resolvedAt'> {
    if (nextStatus === IncidentReportStatus.RESOLVED) {
      return {
        resolvedAt: resolvedAt || new Date(),
      };
    }

    return {
      resolvedAt: null,
      ...(previousStatus === IncidentReportStatus.RESOLVED
        ? {
            resolutionType: null,
            resolutionSummary: null,
          }
        : {}),
    };
  }

  private getSeverityLabel(severity: IncidentReportSeverity): string {
    switch (severity) {
      case IncidentReportSeverity.LOW:
        return '낮음';
      case IncidentReportSeverity.MEDIUM:
        return '보통';
      case IncidentReportSeverity.HIGH:
        return '높음';
      case IncidentReportSeverity.EMERGENCY:
        return '긴급';
      default:
        return severity;
    }
  }

  private buildActionDto(action: IncidentReportDetailRow['actions'][number]): IncidentReportActionDto {
    return {
      id: action.id,
      actionType: action.actionType,
      actorType: action.actorType,
      actorName: action.actorType === IncidentReportActorType.ADMIN
        ? (action.adminActor?.name || null)
        : action.actorType === IncidentReportActorType.EMPLOYEE
          ? (action.employeeActor?.name || null)
          : '시스템',
      fromStatus: action.fromStatus ?? null,
      toStatus: action.toStatus ?? null,
      comment: action.comment ?? null,
      createdAt: action.createdAt,
    };
  }

  private buildAttachmentDto(reportId: string, attachment: {
    id: string;
    originalName: string;
    mimeType: string;
    size: number;
    createdAt: Date;
  }): IncidentReportAttachmentDto {
    return {
      id: attachment.id,
      originalName: attachment.originalName,
      mimeType: attachment.mimeType,
      size: attachment.size,
      downloadUrl: `/api/incident-reports/${encodeURIComponent(reportId)}/attachments/${encodeURIComponent(attachment.id)}/download`,
      createdAt: attachment.createdAt,
    };
  }

  private buildLocationDto(report: Pick<IncidentReportDetailRow, 'locationCiphertext' | 'locationIv' | 'locationTag' | 'locationKeyVersion' | 'locationText'>): IncidentReportLocationDto | null {
    const decrypted = decryptLocation(report);
    if (!decrypted && !report.locationText) {
      return null;
    }

    return {
      lat: decrypted?.latitude ?? null,
      lng: decrypted?.longitude ?? null,
      text: report.locationText ?? null,
    };
  }

  private buildListItem(row: {
    id: string;
    organizationId: string;
    organization: { name: string } | null;
    employeeId: string;
    employee: { name: string } | null;
    title: string;
    category: IncidentReportListItemDto['category'];
    severity: IncidentReportListItemDto['severity'];
    status: IncidentReportStatus;
    isEmergency: boolean;
    assignedAdmin: { id: string; name: string } | null;
    reportedAt: Date;
    updatedAt: Date;
    _count?: { attachments: number };
  }): IncidentReportListItemDto {
    return {
      id: row.id,
      organizationId: row.organizationId,
      organizationName: row.organization?.name || '-',
      employeeId: row.employeeId,
      employeeName: row.employee?.name || '-',
      title: row.title,
      category: row.category,
      severity: row.severity,
      status: row.status,
      isEmergency: row.isEmergency,
      assignedAdminId: row.assignedAdmin?.id || null,
      assignedAdminName: row.assignedAdmin?.name || null,
      attachmentCount: Number(row._count?.attachments || 0),
      reportedAt: row.reportedAt,
      updatedAt: row.updatedAt,
    };
  }

  private buildDetailDto(row: IncidentReportDetailRow): IncidentReportDetailDto {
    return {
      id: row.id,
      organizationId: row.organizationId,
      organizationName: row.organization?.name || '-',
      employeeId: row.employeeId,
      employeeName: row.employee?.name || '-',
      employeePhone: row.employee?.phone || null,
      title: row.title,
      description: row.description,
      category: row.category,
      severity: row.severity,
      status: row.status,
      isEmergency: row.isEmergency,
      zoneId: row.zone?.id || row.zoneId || null,
      zoneName: row.zone?.name || null,
      location: this.buildLocationDto(row),
      assignedAdminId: row.assignedAdmin?.id || row.assignedAdminId || null,
      assignedAdminName: row.assignedAdmin?.name || null,
      occurredAt: row.occurredAt ?? null,
      reportedAt: row.reportedAt,
      resolutionType: row.resolutionType ?? null,
      resolutionSummary: row.resolutionSummary ?? null,
      resolvedAt: row.resolvedAt ?? null,
      attachments: row.attachments.map((attachment) => this.buildAttachmentDto(row.id, attachment)),
      actions: row.actions.map((action) => this.buildActionDto(action)),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  private normalizeScopeOrganizationIds(scopeOrganizationIds?: string[]): string[] | undefined {
    if (!scopeOrganizationIds || scopeOrganizationIds.length === 0) {
      return undefined;
    }

    return Array.from(new Set(scopeOrganizationIds.map((id) => String(id).trim()).filter(Boolean)));
  }

  private async getReportInScope(reportId: string, scopeOrganizationIds?: string[]): Promise<IncidentReportDetailRow> {
    const normalizedScope = this.normalizeScopeOrganizationIds(scopeOrganizationIds);

    const report = await this.prisma.incidentReport.findFirst({
      where: {
        id: reportId,
        deletedAt: null,
        ...(normalizedScope ? { organizationId: { in: normalizedScope } } : {}),
      },
      include: {
        organization: { select: { id: true, name: true } },
        employee: { select: { id: true, name: true, phone: true } },
        zone: { select: { id: true, name: true } },
        assignedAdmin: { select: { id: true, name: true } },
        attachments: { orderBy: { createdAt: 'asc' } },
        actions: {
          include: {
            employeeActor: { select: { id: true, name: true } },
            adminActor: { select: { id: true, name: true } },
          },
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    if (!report) {
      throw new NotFoundException('신고 내역을 찾을 수 없습니다.');
    }

    return report;
  }

  private async createAuditLog(params: {
    accountId?: string;
    action: AuditAction;
    report: { id: string; title: string; organizationId: string };
    changesAfter?: Prisma.InputJsonValue;
    changesBefore?: Prisma.InputJsonValue;
  }): Promise<void> {
    await this.prisma.auditLog.create({
      data: {
        accountId: params.accountId,
        action: params.action,
        resourceType: 'IncidentReport',
        resourceId: params.report.id,
        resourceName: params.report.title,
        organizationId: params.report.organizationId,
        changesBefore: params.changesBefore,
        changesAfter: params.changesAfter,
      },
    });
  }

  async findAll(filter: IncidentReportFilterDto, scopeOrganizationIds?: string[]): Promise<IncidentReportListResponseDto> {
    const page = filter.page ?? 1;
    const limit = filter.limit ?? 20;
    const skip = (page - 1) * limit;
    const normalizedScope = this.normalizeScopeOrganizationIds(scopeOrganizationIds);

    if (filter.organizationId && normalizedScope && !normalizedScope.includes(filter.organizationId)) {
      throw new ForbiddenException('해당 조직의 신고를 조회할 권한이 없습니다.');
    }

    const search = filter.search?.trim();

    const where: Prisma.IncidentReportWhereInput = {
      deletedAt: null,
      ...(normalizedScope ? { organizationId: { in: normalizedScope } } : {}),
      ...(filter.organizationId ? { organizationId: filter.organizationId } : {}),
      ...(filter.status ? { status: filter.status } : {}),
      ...(filter.severity ? { severity: filter.severity } : {}),
      ...(filter.category ? { category: filter.category } : {}),
      ...(filter.assignedAdminId ? { assignedAdminId: filter.assignedAdminId } : {}),
      ...(search
        ? {
            OR: [
              { title: { contains: search, mode: 'insensitive' } },
              { description: { contains: search, mode: 'insensitive' } },
              { employee: { name: { contains: search, mode: 'insensitive' } } },
              { organization: { name: { contains: search, mode: 'insensitive' } } },
            ],
          }
        : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.incidentReport.findMany({
        where,
        include: {
          organization: { select: { name: true } },
          employee: { select: { name: true } },
          assignedAdmin: { select: { id: true, name: true } },
          _count: {
            select: { attachments: true },
          },
        },
        orderBy: [
          { isEmergency: 'desc' },
          { reportedAt: 'desc' },
        ],
        skip,
        take: limit,
      }),
      this.prisma.incidentReport.count({ where }),
    ]);

    return {
      data: rows.map((row) => this.buildListItem(row)),
      total,
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    };
  }

  async findOne(reportId: string, scopeOrganizationIds?: string[]): Promise<IncidentReportDetailDto> {
    const report = await this.getReportInScope(reportId, scopeOrganizationIds);
    return this.buildDetailDto(report);
  }

  async updateSeverity(
    reportId: string,
    dto: UpdateIncidentReportSeverityDto,
    scopeOrganizationIds?: string[],
    accountId?: string,
  ): Promise<IncidentReportDetailDto> {
    const report = await this.getReportInScope(reportId, scopeOrganizationIds);

    if (report.severity === dto.severity) {
      return this.buildDetailDto(report);
    }

    const comment = dto.comment?.trim();
    const severityChangeComment = [
      `심각도 변경: ${this.getSeverityLabel(report.severity)} -> ${this.getSeverityLabel(dto.severity)}`,
      ...(comment ? [comment] : []),
    ].join('\n');

    const updated = await this.prisma.incidentReport.update({
      where: { id: report.id },
      data: {
        severity: dto.severity,
        isEmergency: dto.severity === IncidentReportSeverity.EMERGENCY,
        actions: {
          create: {
            actionType: IncidentReportActionType.COMMENTED,
            actorType: IncidentReportActorType.ADMIN,
            adminActorId: accountId,
            comment: severityChangeComment,
            metadataJson: {
              severityBefore: report.severity,
              severityAfter: dto.severity,
            },
          },
        },
      },
      include: {
        organization: { select: { id: true, name: true } },
        employee: { select: { id: true, name: true, phone: true } },
        zone: { select: { id: true, name: true } },
        assignedAdmin: { select: { id: true, name: true } },
        attachments: { orderBy: { createdAt: 'asc' } },
        actions: {
          include: {
            employeeActor: { select: { id: true, name: true } },
            adminActor: { select: { id: true, name: true } },
          },
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    await this.createAuditLog({
      accountId,
      action: AuditAction.UPDATE,
      report: updated,
      changesBefore: { severity: report.severity, isEmergency: report.isEmergency },
      changesAfter: {
        severity: dto.severity,
        isEmergency: dto.severity === IncidentReportSeverity.EMERGENCY,
        comment: comment || null,
      },
    });

    return this.buildDetailDto(updated);
  }

  async updateStatus(
    reportId: string,
    dto: UpdateIncidentReportStatusDto,
    scopeOrganizationIds?: string[],
    accountId?: string,
  ): Promise<IncidentReportDetailDto> {
    const report = await this.getReportInScope(reportId, scopeOrganizationIds);

    if (report.status === dto.status) {
      return this.buildDetailDto(report);
    }

    const updated = await this.prisma.incidentReport.update({
      where: { id: report.id },
      data: {
        status: dto.status,
        ...this.buildResolutionStateForStatusChange(report.status, dto.status, report.resolvedAt),
        actions: {
          create: {
            actionType: IncidentReportActionType.STATUS_CHANGED,
            fromStatus: report.status,
            toStatus: dto.status,
            actorType: IncidentReportActorType.ADMIN,
            adminActorId: accountId,
            comment: dto.comment?.trim() || undefined,
          },
        },
      },
      include: {
        organization: { select: { id: true, name: true } },
        employee: { select: { id: true, name: true, phone: true } },
        zone: { select: { id: true, name: true } },
        assignedAdmin: { select: { id: true, name: true } },
        attachments: { orderBy: { createdAt: 'asc' } },
        actions: {
          include: {
            employeeActor: { select: { id: true, name: true } },
            adminActor: { select: { id: true, name: true } },
          },
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    await this.createAuditLog({
      accountId,
      action: AuditAction.UPDATE,
      report: updated,
      changesBefore: {
        status: report.status,
        resolutionType: report.resolutionType,
        resolutionSummary: report.resolutionSummary,
        resolvedAt: report.resolvedAt,
      },
      changesAfter: {
        status: dto.status,
        resolutionType: dto.status === IncidentReportStatus.RESOLVED ? updated.resolutionType : null,
        resolutionSummary: dto.status === IncidentReportStatus.RESOLVED ? updated.resolutionSummary : null,
        resolvedAt: dto.status === IncidentReportStatus.RESOLVED ? updated.resolvedAt : null,
        comment: dto.comment?.trim() || null,
      },
    });

    if (report.status === IncidentReportStatus.RESOLVED && dto.status !== IncidentReportStatus.RESOLVED) {
      await this.clearIncidentReportResolutionTranslations(updated.id);
    }

    return this.buildDetailDto(updated);
  }

  async updateAssignee(
    reportId: string,
    dto: UpdateIncidentReportAssigneeDto,
    scopeOrganizationIds?: string[],
    accountId?: string,
  ): Promise<IncidentReportDetailDto> {
    const report = await this.getReportInScope(reportId, scopeOrganizationIds);
    const nextAssignedAdminId = dto.assignedAdminId?.trim() || null;

    if (nextAssignedAdminId) {
      const assignee = await this.prisma.account.findFirst({
        where: {
          id: nextAssignedAdminId,
          ...(this.normalizeScopeOrganizationIds(scopeOrganizationIds)
            ? {
                OR: [
                  { role: 'SUPER_ADMIN' },
                  { organizationId: { in: this.normalizeScopeOrganizationIds(scopeOrganizationIds) } },
                ],
              }
            : {}),
        },
        select: { id: true },
      });

      if (!assignee) {
        throw new BadRequestException('배정할 관리자를 찾을 수 없거나 범위를 벗어났습니다.');
      }
    }

    const assignmentChanged = (report.assignedAdminId || null) !== nextAssignedAdminId;

    if (!assignmentChanged && report.status !== IncidentReportStatus.RESOLVED) {
      return this.buildDetailDto(report);
    }

    const nextStatus = nextAssignedAdminId ? IncidentReportStatus.ASSIGNED : IncidentReportStatus.RECEIVED;

    const updated = await this.prisma.incidentReport.update({
      where: { id: report.id },
      data: {
        assignedAdminId: nextAssignedAdminId,
        status: nextStatus,
        ...this.buildResolutionStateForStatusChange(report.status, nextStatus, report.resolvedAt),
        actions: {
          create: {
            actionType: IncidentReportActionType.ASSIGNED,
            fromStatus: report.status,
            toStatus: nextStatus,
            actorType: IncidentReportActorType.ADMIN,
            adminActorId: accountId,
            comment: dto.comment?.trim() || undefined,
            metadataJson: {
              assignedAdminId: nextAssignedAdminId,
            },
          },
        },
      },
      include: {
        organization: { select: { id: true, name: true } },
        employee: { select: { id: true, name: true, phone: true } },
        zone: { select: { id: true, name: true } },
        assignedAdmin: { select: { id: true, name: true } },
        attachments: { orderBy: { createdAt: 'asc' } },
        actions: {
          include: {
            employeeActor: { select: { id: true, name: true } },
            adminActor: { select: { id: true, name: true } },
          },
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    await this.createAuditLog({
      accountId,
      action: AuditAction.UPDATE,
      report: updated,
      changesBefore: {
        assignedAdminId: report.assignedAdminId,
        status: report.status,
        resolutionType: report.resolutionType,
        resolutionSummary: report.resolutionSummary,
        resolvedAt: report.resolvedAt,
      },
      changesAfter: {
        assignedAdminId: nextAssignedAdminId,
        status: nextStatus,
        resolutionType: null,
        resolutionSummary: null,
        resolvedAt: null,
        comment: dto.comment?.trim() || null,
      },
    });

    if (report.status === IncidentReportStatus.RESOLVED) {
      await this.clearIncidentReportResolutionTranslations(updated.id);
    }

    return this.buildDetailDto(updated);
  }

  async addComment(
    reportId: string,
    dto: CreateIncidentReportCommentDto,
    scopeOrganizationIds?: string[],
    accountId?: string,
  ): Promise<IncidentReportDetailDto> {
    const report = await this.getReportInScope(reportId, scopeOrganizationIds);
    const comment = dto.comment.trim();

    const updated = await this.prisma.incidentReport.update({
      where: { id: report.id },
      data: {
        actions: {
          create: {
            actionType: IncidentReportActionType.COMMENTED,
            actorType: IncidentReportActorType.ADMIN,
            adminActorId: accountId,
            comment,
          },
        },
      },
      include: {
        organization: { select: { id: true, name: true } },
        employee: { select: { id: true, name: true, phone: true } },
        zone: { select: { id: true, name: true } },
        assignedAdmin: { select: { id: true, name: true } },
        attachments: { orderBy: { createdAt: 'asc' } },
        actions: {
          include: {
            employeeActor: { select: { id: true, name: true } },
            adminActor: { select: { id: true, name: true } },
          },
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    await this.createAuditLog({
      accountId,
      action: AuditAction.UPDATE,
      report: updated,
      changesAfter: { comment },
    });

    return this.buildDetailDto(updated);
  }

  async resolve(
    reportId: string,
    dto: ResolveIncidentReportDto,
    scopeOrganizationIds?: string[],
    accountId?: string,
  ): Promise<IncidentReportDetailDto> {
    const report = await this.getReportInScope(reportId, scopeOrganizationIds);
    const resolutionSummary = dto.resolutionSummary.trim();

    const updated = await this.prisma.incidentReport.update({
      where: { id: report.id },
      data: {
        status: IncidentReportStatus.RESOLVED,
        resolutionType: dto.resolutionType,
        resolutionSummary,
        resolvedAt: new Date(),
        actions: {
          create: {
            actionType: IncidentReportActionType.RESOLVED,
            fromStatus: report.status,
            toStatus: IncidentReportStatus.RESOLVED,
            actorType: IncidentReportActorType.ADMIN,
            adminActorId: accountId,
            comment: dto.comment?.trim() || resolutionSummary,
          },
        },
      },
      include: {
        organization: { select: { id: true, name: true } },
        employee: { select: { id: true, name: true, phone: true } },
        zone: { select: { id: true, name: true } },
        assignedAdmin: { select: { id: true, name: true } },
        attachments: { orderBy: { createdAt: 'asc' } },
        actions: {
          include: {
            employeeActor: { select: { id: true, name: true } },
            adminActor: { select: { id: true, name: true } },
          },
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    await this.createAuditLog({
      accountId,
      action: AuditAction.UPDATE,
      report: updated,
      changesBefore: { status: report.status, resolutionType: report.resolutionType, resolutionSummary: report.resolutionSummary },
      changesAfter: { status: IncidentReportStatus.RESOLVED, resolutionType: dto.resolutionType, resolutionSummary, comment: dto.comment?.trim() || null },
    });

    await this.syncIncidentReportResolutionTranslation(updated.id, resolutionSummary, updated.updatedAt);

    return this.buildDetailDto(updated);
  }

  async addAttachment(
    reportId: string,
    file: { filename: string; originalname: string; mimetype: string; size: number },
    scopeOrganizationIds?: string[],
    accountId?: string,
  ): Promise<IncidentReportDetailDto> {
    const report = await this.getReportInScope(reportId, scopeOrganizationIds);

    const updated = await this.prisma.incidentReport.update({
      where: { id: report.id },
      data: {
        attachments: {
          create: {
            fileName: file.filename,
            originalName: file.originalname,
            mimeType: file.mimetype,
            size: file.size,
            storagePath: file.filename,
          },
        },
        actions: {
          create: {
            actionType: IncidentReportActionType.ATTACHMENT_ADDED,
            actorType: IncidentReportActorType.ADMIN,
            adminActorId: accountId,
            comment: file.originalname,
          },
        },
      },
      include: {
        organization: { select: { id: true, name: true } },
        employee: { select: { id: true, name: true, phone: true } },
        zone: { select: { id: true, name: true } },
        assignedAdmin: { select: { id: true, name: true } },
        attachments: { orderBy: { createdAt: 'asc' } },
        actions: {
          include: {
            employeeActor: { select: { id: true, name: true } },
            adminActor: { select: { id: true, name: true } },
          },
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    await this.createAuditLog({
      accountId,
      action: AuditAction.UPDATE,
      report: updated,
      changesAfter: { addedAttachment: file.originalname },
    });

    return this.buildDetailDto(updated);
  }

  async resolveAttachmentDownloadTarget(
    reportId: string,
    attachmentId: string,
    scopeOrganizationIds?: string[],
  ): Promise<{ absolutePath: string; originalName: string; mimeType: string }> {
    const report = await this.getReportInScope(reportId, scopeOrganizationIds);
    const attachment = report.attachments.find((item) => item.id === attachmentId);

    if (!attachment) {
      throw new NotFoundException('첨부파일을 찾을 수 없습니다.');
    }

    const absolutePath = await this.resolveStoredAttachmentPath(attachment.storagePath);

    return {
      absolutePath,
      originalName: attachment.originalName,
      mimeType: attachment.mimeType,
    };
  }

  private async resolveStoredAttachmentPath(storagePathValue: string): Promise<string> {
    const normalized = String(storagePathValue || '').trim();
    if (!normalized) {
      throw new NotFoundException('첨부 경로가 올바르지 않습니다.');
    }

    for (const rootPath of INCIDENT_REPORT_UPLOAD_ROOT_CANDIDATES) {
      const absolutePath = path.resolve(rootPath, normalized);
      try {
        await access(absolutePath);
        return absolutePath;
      } catch {
        // try next candidate
      }
    }

    throw new NotFoundException('첨부파일을 찾을 수 없습니다.');
  }
}