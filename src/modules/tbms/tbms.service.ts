import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  AppLanguage,
  DeviceOS,
  EmployeeStatus,
  Prisma,
  PushTokenStatus,
  TbmAttachmentType,
  TbmParticipantState,
  TbmStatus,
  TranslatableEntityType,
} from '@prisma/client';
import { Request } from 'express';
import { ConfigService } from '@nestjs/config';
import { access } from 'fs/promises';
import { resolve } from 'path';
import { PrismaService } from '../../prisma/prisma.service';
import { PaginatedResponse } from '../../common/dto';
import { ContentTranslationService } from '@/common/translation/translation.service';
import { resolveOrganizationClassification } from '../../common/utils/organization-scope.util';
import { readStageConfig } from '../../common/config/stage.config';
import {
  CreateTbmDto,
  SendTbmPushMessageDto,
  TbmAdminAttendeeDto,
  TbmAdminDetailDto,
  TbmAdminListItemDto,
  TbmAttendeeConfirmFilter,
  TbmCandidateFilterDto,
  TbmCandidateResponseDto,
  TbmListFilterDto,
  TbmPushMessageResultDto,
  TbmTranslationStatus,
  UpdateTbmDto,
} from './dto';
import {
  buildContentDisposition,
  cleanupTbmUploadFiles,
  getTbmUploadDir,
  isAllowedTbmAttachmentFile,
  isAllowedTbmAudioFile,
  isTbmImageFile,
  normalizeTbmUploadOriginalName,
  sanitizeTbmStoredFileName,
  TbmUploadedFile,
} from './tbms.storage';

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const ALL_APP_LANGUAGES = Object.values(AppLanguage);
const TBM_EMPLOYEE_SELECTABLE_STATUSES: EmployeeStatus[] = [EmployeeStatus.ACTIVE];

type OrganizationNode = {
  id: string;
  name: string;
  parentId: string | null;
  teamCode: string | null;
};

type OrganizationPath = {
  company: OrganizationNode | null;
  group: OrganizationNode | null;
  team: OrganizationNode | null;
};

type TbmField = {
  fieldKey: string;
  content: string;
};

type TbmPushEvent = 'created' | 'started' | 'message';

type TbmPushTarget = {
  deviceId: string;
  token: string;
  os: DeviceOS;
  employeeId: string | null;
  language: AppLanguage;
};

type TbmPushContent = {
  type: string;
  notificationTitle: string;
  notificationBody: string;
  message?: string;
};

type TbmPushRecipient = {
  employeeId: string;
  language: AppLanguage;
};

type TbmPushLocalizationContext = {
  event: TbmPushEvent;
  title: string;
  titleSourceLanguage: AppLanguage;
  messageSourceLanguage?: AppLanguage;
};

@Injectable()
export class TbmsService {
  private readonly logger = new Logger(TbmsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly contentTranslationService: ContentTranslationService,
    private readonly configService: ConfigService,
  ) {}

  // ============ 조직 트리 헬퍼 ============

  private async getOrganizationMap(): Promise<Map<string, OrganizationNode>> {
    const organizations = await this.prisma.organization.findMany({
      where: { deletedAt: null, isActive: true },
      select: { id: true, name: true, parentId: true, teamCode: true },
    });

    return new Map(organizations.map((organization) => [organization.id, organization]));
  }

  private resolveOrganizationPath(
    organizationId: string,
    organizationMap: Map<string, OrganizationNode>,
  ): OrganizationPath {
    const visited = new Set<string>();
    let current = organizationMap.get(organizationId) ?? null;
    let company: OrganizationNode | null = null;
    let group: OrganizationNode | null = null;
    let team: OrganizationNode | null = null;

    while (current && !visited.has(current.id)) {
      visited.add(current.id);
      const classification = resolveOrganizationClassification(current);

      if (classification === 'COMPANY') {
        company = current;
        break;
      }

      if (classification === 'UNIT' && !team) {
        team = current;
      }

      if (classification === 'GROUP' && !group) {
        group = current;
      }

      current = current.parentId ? organizationMap.get(current.parentId) ?? null : null;
    }

    return { company, group, team };
  }

  private collectDescendantOrganizationIds(
    rootOrganizationId: string,
    organizationMap: Map<string, OrganizationNode>,
  ): string[] {
    const childrenByParent = new Map<string, string[]>();
    for (const organization of organizationMap.values()) {
      if (organization.parentId) {
        const list = childrenByParent.get(organization.parentId) ?? [];
        list.push(organization.id);
        childrenByParent.set(organization.parentId, list);
      }
    }

    const visited = new Set<string>([rootOrganizationId]);
    let frontier = [rootOrganizationId];
    while (frontier.length > 0) {
      const next: string[] = [];
      for (const id of frontier) {
        for (const childId of childrenByParent.get(id) ?? []) {
          if (!visited.has(childId)) {
            visited.add(childId);
            next.push(childId);
          }
        }
      }
      frontier = next;
    }

    return Array.from(visited);
  }

  // ============ 날짜/콘텐츠 헬퍼 ============

  private parseJsonStringArray(value: Prisma.JsonValue | null | undefined): string[] {
    if (!Array.isArray(value)) {
      return [];
    }
    return value.map((entry) => String(entry ?? '').trim()).filter(Boolean);
  }

  private getKstDateString(date: Date): string {
    return new Date(date.getTime() + KST_OFFSET_MS).toISOString().slice(0, 10);
  }

  private getKstTodayString(): string {
    return this.getKstDateString(new Date());
  }

  private getKstDateStartUtc(date: string): Date {
    return new Date(`${date}T00:00:00.000+09:00`);
  }

  private parseUtcDateTimeForDb(value: string): Date {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      throw new BadRequestException('날짜는 UTC ISO 형식이어야 합니다. 예: 2026-06-16T15:00:00.000Z');
    }
    return parsed;
  }

  private formatScheduledDate(date: Date): string {
    return date.toISOString();
  }

  private getNextKstDateStartUtc(date: Date): Date {
    return new Date(date.getTime() + 24 * 60 * 60 * 1000);
  }

  private getKstDateRangeForDateTime(value: string): { start: Date; end: Date } {
    const parsed = this.parseUtcDateTimeForDb(value);
    const start = this.getKstDateStartUtc(this.getKstDateString(parsed));

    return {
      start,
      end: this.getNextKstDateStartUtc(start),
    };
  }

  private buildScheduledDateFilter(filter: TbmListFilterDto): Prisma.DateTimeFilter | null {
    let start: Date | undefined;
    let end: Date | undefined;

    if (filter.scheduledDate) {
      const dateRange = this.getKstDateRangeForDateTime(filter.scheduledDate);
      start = dateRange.start;
      end = dateRange.end;
    }

    if (filter.scheduledDateFrom) {
      start = this.getKstDateRangeForDateTime(filter.scheduledDateFrom).start;
    }

    if (filter.scheduledDateTo) {
      end = this.getKstDateRangeForDateTime(filter.scheduledDateTo).end;
    }

    if (start && end && start >= end) {
      throw new BadRequestException('교육일 조회 시작일은 종료일보다 늦을 수 없습니다.');
    }

    if (!start && !end) {
      return null;
    }

    return {
      ...(start ? { gte: start } : {}),
      ...(end ? { lt: end } : {}),
    };
  }

  private buildAbsoluteUrl(request: Request | undefined, path: string): string {
    if (!request) {
      return `/api${path}`;
    }
    const forwardedProto = String(request.headers['x-forwarded-proto'] || '').split(',')[0]?.trim();
    const protocol = forwardedProto || request.protocol;
    const host = request.get('host');
    return host ? `${protocol}://${host}/api${path}` : `/api${path}`;
  }

  private getAppBackendBaseUrl(): string {
    const baseUrl = readStageConfig(this.configService, 'APP_BACKEND_BASE_URL', {
      dev: 'http://localhost:3100/api/app',
      prod: 'https://safein.code-edge.com/api/app',
    });
    return baseUrl.trim().replace(/\/$/, '');
  }

  private resolveTbmPushConcurrency(): number {
    const raw = this.configService.get<string>('TBM_PUSH_CONCURRENCY')?.trim();
    const parsed = raw ? Number(raw) : 20;
    return Number.isFinite(parsed) && parsed > 0 ? Math.min(Math.floor(parsed), 100) : 20;
  }

  private resolveTbmPushTimeoutMs(): number {
    const raw = this.configService.get<string>('TBM_PUSH_TIMEOUT_MS')?.trim();
    const parsed = raw ? Number(raw) : 7000;
    return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 7000;
  }

  private buildTbmPushContent(event: TbmPushEvent, title: string, message?: string): TbmPushContent {
    if (event === 'message') {
      return {
        type: 'tbm_message',
        notificationTitle: 'TBM 교육 메시지',
        notificationBody: message ?? '',
        message,
      };
    }

    if (event === 'started') {
      return {
        type: 'tbm_started',
        notificationTitle: 'TBM 교육 시작',
        notificationBody: `${title} 교육이 시작되었습니다.`,
      };
    }

    return {
      type: 'tbm_created',
      notificationTitle: 'TBM 교육 등록',
      notificationBody: `${title} 교육이 등록되었습니다.`,
    };
  }

  private async transcribeTbmAudioFile(audioFile: TbmUploadedFile): Promise<string | null> {
    const result = await this.contentTranslationService.translateAudioFile({
      path: audioFile.path,
      originalname: audioFile.originalname,
      mimetype: audioFile.mimetype,
      size: audioFile.size,
      sourceLanguage: AppLanguage.ko,
      targetLanguage: AppLanguage.ko,
    });

    return result.transcriptText.trim() || null;
  }

  private getTbmPushBodySuffix(event: TbmPushEvent): string | null {
    if (event === 'started') {
      return '교육이 시작되었습니다.';
    }

    if (event === 'created') {
      return '교육이 등록되었습니다.';
    }

    return null;
  }

  private async translateTbmPushFields(
    fields: TbmField[],
    targetLanguage: AppLanguage,
    sourceLanguage: AppLanguage,
  ): Promise<Record<string, string>> {
    if (targetLanguage === sourceLanguage) {
      return Object.fromEntries(fields.map((field) => [field.fieldKey, field.content]));
    }

    return this.contentTranslationService.translateFields(fields, targetLanguage, sourceLanguage);
  }

  private async localizeTbmPushContent(
    content: TbmPushContent,
    targetLanguage: AppLanguage,
    context: TbmPushLocalizationContext,
  ): Promise<TbmPushContent> {
    const staticTexts = await this.translateTbmPushFields([
      { fieldKey: 'notificationTitle', content: content.notificationTitle },
      ...(this.getTbmPushBodySuffix(context.event)
        ? [{ fieldKey: 'bodySuffix', content: this.getTbmPushBodySuffix(context.event) ?? '' }]
        : []),
    ], targetLanguage, AppLanguage.ko);

    if (context.event === 'message') {
      const messageSourceLanguage = context.messageSourceLanguage ?? AppLanguage.ko;
      const translatedMessage = await this.translateTbmPushFields([
        { fieldKey: 'message', content: content.message ?? content.notificationBody },
      ], targetLanguage, messageSourceLanguage);

      return {
        ...content,
        notificationTitle: staticTexts.notificationTitle?.trim() || content.notificationTitle,
        notificationBody: translatedMessage.message?.trim() || content.notificationBody,
        ...(content.message ? { message: translatedMessage.message?.trim() || content.message } : {}),
      };
    }

    const translatedTitle = await this.translateTbmPushFields([
      { fieldKey: 'title', content: context.title },
    ], targetLanguage, context.titleSourceLanguage);

    return {
      ...content,
      notificationTitle: staticTexts.notificationTitle?.trim() || content.notificationTitle,
      notificationBody: [
        translatedTitle.title?.trim() || context.title,
        staticTexts.bodySuffix?.trim() || this.getTbmPushBodySuffix(context.event) || '',
      ].filter(Boolean).join(' '),
    };
  }

  private async localizeTbmPushContentByLanguage(
    content: TbmPushContent,
    languages: AppLanguage[],
    context: TbmPushLocalizationContext,
  ): Promise<Map<AppLanguage, TbmPushContent>> {
    const localized = new Map<AppLanguage, TbmPushContent>();
    const targetLanguages = Array.from(new Set(languages));

    await Promise.all(targetLanguages.map(async (language) => {
      try {
        localized.set(language, await this.localizeTbmPushContent(content, language, context));
      } catch (error) {
        this.logger.warn(`TBM 푸시 메시지 번역 fallback(language=${language}): ${String(error)}`);
        localized.set(language, content);
      }
    }));

    return localized;
  }

  private async sendTbmPush(endpointUrl: string, params: {
    dispatchId: string;
    event: TbmPushEvent;
    tbmId: string;
    title: string;
    scheduledDate: Date;
    target: TbmPushTarget;
    content: TbmPushContent;
    senderAdminId?: string;
    source?: string;
  }): Promise<void> {
    const timeoutMs = this.resolveTbmPushTimeoutMs();
    const abortController = new AbortController();
    const timer = setTimeout(() => abortController.abort(), timeoutMs);
    const content = params.content;
    const isIos = params.target.os === DeviceOS.iOS;

    try {
      const response = await fetch(endpointUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-smombie-dispatch-id': params.dispatchId,
          'x-smombie-source': params.source ?? `admin-backend:tbm_${params.event}`,
        },
        signal: abortController.signal,
        body: JSON.stringify({
          message: {
            token: params.target.token,
            data: {
              type: content.type,
              event: content.type,
              extraData: {
                tbmId: params.tbmId,
                title: params.title,
                scheduledDate: params.scheduledDate.toISOString(),
                employeeId: params.target.employeeId ?? '',
                language: params.target.language,
                ...(content.message ? { message: content.message } : {}),
                ...(params.senderAdminId ? { senderAdminId: params.senderAdminId } : {}),
                ...(params.source ? { source: params.source } : {}),
              },
            },
            notification: {
              title: content.notificationTitle,
              body: content.notificationBody,
            },
            android: {
              priority: 'HIGH',
            },
            ...(isIos
              ? {
                  apns: {
                    headers: {
                      'apns-priority': '10',
                      'apns-collapse-id': `${content.type}_${params.tbmId}`,
                    },
                    payload: {
                      aps: {
                        sound: 'default',
                      },
                    },
                  },
                }
              : {}),
          },
        }),
      });

      if (!response.ok) {
        const responseText = await response.text();
        throw new Error(`status=${response.status}, body=${responseText || 'empty'}`);
      }
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(`network-timeout>${timeoutMs}ms, endpoint=${endpointUrl}, dispatchId=${params.dispatchId}`);
      }

      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  private resolveTbmPushRecipients(
    participants: Array<{ employeeId: string | null; employeeIdAtAssign: string; languageAtAssigned: AppLanguage }>,
  ): TbmPushRecipient[] {
    return Array.from(
      new Map(
        participants
          .map((participant) => ({
            employeeId: (participant.employeeId ?? participant.employeeIdAtAssign).trim(),
            language: participant.languageAtAssigned,
          }))
          .filter((recipient) => !!recipient.employeeId)
          .map((recipient) => [recipient.employeeId, recipient] as const),
      ).values(),
    );
  }

  private async resolveTbmPushTargets(recipients: TbmPushRecipient[]): Promise<TbmPushTarget[]> {
    if (recipients.length === 0) {
      return [];
    }

    const languageByEmployeeId = new Map(recipients.map((recipient) => [recipient.employeeId, recipient.language]));
    const employeeIds = Array.from(languageByEmployeeId.keys());
    const devices = await this.prisma.device.findMany({
      where: {
        employeeId: { in: employeeIds },
        pushToken: { not: null },
        pushTokenStatus: { not: PushTokenStatus.ERROR },
        employee: {
          is: {
            status: EmployeeStatus.ACTIVE,
          },
        },
      },
      select: {
        id: true,
        os: true,
        pushToken: true,
        employeeId: true,
        token: {
          select: {
            lastLoginLanguage: true,
          },
        },
      },
    });

    return Array.from(
      new Map(
        devices
          .map((device) => {
            const token = device.pushToken?.trim();
            if (!token) {
              return null;
            }

            const target: TbmPushTarget = {
              deviceId: device.id,
              token,
              os: device.os,
              employeeId: device.employeeId,
              language: device.token?.lastLoginLanguage
                ?? (device.employeeId ? languageByEmployeeId.get(device.employeeId) : undefined)
                ?? AppLanguage.ko,
            };

            return [token, target] as const;
          })
          .filter((entry): entry is readonly [string, TbmPushTarget] => !!entry),
      ).values(),
    );
  }

  private async dispatchTbmPushToAttendees(tbmId: string, event: TbmPushEvent): Promise<void> {
    const tbm = await this.prisma.tbmSession.findUnique({
      where: { id: tbmId },
      select: {
        id: true,
        title: true,
        sourceLanguage: true,
        scheduledDate: true,
        participants: {
          select: {
            employeeId: true,
            employeeIdAtAssign: true,
            languageAtAssigned: true,
          },
        },
      },
    });

    if (!tbm) {
      return;
    }

    const recipients = this.resolveTbmPushRecipients(tbm.participants);

    if (recipients.length === 0) {
      return;
    }

    const targets = await this.resolveTbmPushTargets(recipients);

    if (targets.length === 0) {
      this.logger.debug(`TBM ${event} 알림 대상 토큰 없음(tbmId=${tbmId})`);
      return;
    }

    const content = this.buildTbmPushContent(event, tbm.title);
    const localizedByLanguage = await this.localizeTbmPushContentByLanguage(
      content,
      targets.map((target) => target.language),
      {
        event,
        title: tbm.title,
        titleSourceLanguage: tbm.sourceLanguage ?? AppLanguage.ko,
      },
    );

    const endpointUrl = `${this.getAppBackendBaseUrl()}/internal/push/fcm/send`;
    const dispatchId = `tbm-${event}-${tbmId}-${Date.now()}`;
    const dispatchConcurrency = this.resolveTbmPushConcurrency();
    let successCount = 0;
    const failedDeviceIds: string[] = [];
    const failureReasons: string[] = [];

    for (let index = 0; index < targets.length; index += dispatchConcurrency) {
      const chunk = targets.slice(index, index + dispatchConcurrency);
      const results = await Promise.allSettled(chunk.map((target) => this.sendTbmPush(endpointUrl, {
        dispatchId,
        event,
        tbmId,
        title: tbm.title,
        scheduledDate: tbm.scheduledDate,
        target,
        content: localizedByLanguage.get(target.language) ?? content,
      })));

      results.forEach((result, chunkIndex) => {
        if (result.status === 'fulfilled') {
          successCount += 1;
          return;
        }

        const failedTarget = chunk[chunkIndex];
        failedDeviceIds.push(failedTarget.deviceId);
        if (failureReasons.length < 20) {
          failureReasons.push(`${failedTarget.deviceId}:${String(result.reason)}`);
        }
      });
    }

    this.logger.log(
      `[tbm_${event}] dispatchId=${dispatchId}, tbmId=${tbmId}, targets=${targets.length}, success=${successCount}, failed=${failedDeviceIds.length}`,
    );

    if (failedDeviceIds.length > 0) {
      this.logger.warn(
        `[tbm_${event}] failed device ids dispatchId=${dispatchId}: ${failedDeviceIds.slice(0, 20).join(', ')}`
        + `${failedDeviceIds.length > 20 ? ' ...' : ''}`,
      );

      if (failureReasons.length > 0) {
        this.logger.warn(`[tbm_${event}] failed reasons dispatchId=${dispatchId}: ${failureReasons.join(' | ')}`);
      }
    }
  }

  private buildSourceFields(row: {
    title: string;
    location: string;
    workContent: string;
    hazards: Prisma.JsonValue;
    safetyRules: Prisma.JsonValue;
    transcriptText: string | null;
  }): TbmField[] {
    const hazards = this.parseJsonStringArray(row.hazards);
    const safetyRules = this.parseJsonStringArray(row.safetyRules);
    const fields: TbmField[] = [
      { fieldKey: 'title', content: String(row.title || '') },
      { fieldKey: 'location', content: String(row.location || '') },
      { fieldKey: 'workContent', content: String(row.workContent || '') },
      ...hazards.map((content, index) => ({ fieldKey: `hazards.${index}`, content })),
      ...safetyRules.map((content, index) => ({ fieldKey: `safetyRules.${index}`, content })),
    ];

    if (row.transcriptText) {
      fields.push({ fieldKey: 'transcriptText', content: String(row.transcriptText) });
    }

    return fields.filter((field) => field.content.trim().length > 0);
  }

  private buildAttendeeSummary(participants: Array<{ state: TbmParticipantState }>) {
    const total = participants.length;
    const confirmed = participants.filter((p) => p.state === TbmParticipantState.CONFIRMED).length;
    const pending = Math.max(total - confirmed, 0);
    return {
      total,
      confirmed,
      pending,
      confirmationRate: total > 0 ? Math.round((confirmed / total) * 100) : 0,
    };
  }

  private buildLanguageSummary(participants: Array<{ languageAtAssigned: AppLanguage }>) {
    const counts = new Map<AppLanguage, number>();
    for (const participant of participants) {
      counts.set(participant.languageAtAssigned, (counts.get(participant.languageAtAssigned) ?? 0) + 1);
    }
    return Array.from(counts.entries()).map(([language, count]) => ({ language, count }));
  }

  private async getTranslationStatusesForRow(
    row: {
      id: string;
      sourceLanguage: AppLanguage;
      title: string;
      location: string;
      workContent: string;
      hazards: Prisma.JsonValue;
      safetyRules: Prisma.JsonValue;
      transcriptText: string | null;
    },
    languages: AppLanguage[],
  ): Promise<Map<AppLanguage, TbmTranslationStatus>> {
    const result = new Map<AppLanguage, TbmTranslationStatus>();
    const targetLanguages = Array.from(new Set(languages)).filter((language) => language !== row.sourceLanguage);
    result.set(row.sourceLanguage, 'NONE');

    if (targetLanguages.length === 0) {
      return result;
    }

    const fields = this.buildSourceFields(row);
    if (fields.length === 0) {
      for (const language of targetLanguages) {
        result.set(language, 'DONE');
      }
      return result;
    }

    const fieldKeys = fields.map((field) => field.fieldKey);
    const translations = await this.prisma.contentTranslation.findMany({
      where: {
        entityType: TranslatableEntityType.TBM,
        entityId: row.id,
        language: { in: targetLanguages },
        fieldKey: { in: fieldKeys },
      },
      select: { language: true, fieldKey: true, content: true },
    });

    const byLanguage = new Map<AppLanguage, Set<string>>();
    for (const translation of translations) {
      if (!translation.content?.trim()) {
        continue;
      }
      const set = byLanguage.get(translation.language) ?? new Set<string>();
      set.add(translation.fieldKey);
      byLanguage.set(translation.language, set);
    }

    for (const language of targetLanguages) {
      const translatedCount = byLanguage.get(language)?.size ?? 0;
      if (translatedCount === 0) {
        result.set(language, 'PENDING');
      } else if (translatedCount >= fields.length) {
        result.set(language, 'DONE');
      } else {
        result.set(language, 'PARTIAL');
      }
    }

    return result;
  }

  private queueTbmTranslations(
    tbmId: string,
    sourceUpdatedAt: Date,
    fields: TbmField[],
    participantLanguages: AppLanguage[],
  ): void {
    if (fields.length === 0) {
      return;
    }

    const targetLanguages = new Set<AppLanguage>(participantLanguages.filter((language) => language !== AppLanguage.ko));
    if (targetLanguages.size === 0) {
      return;
    }

    const skipLanguages = ALL_APP_LANGUAGES.filter((language) => !targetLanguages.has(language));
    this.contentTranslationService.queueTranslationsFromKorean({
      entityType: TranslatableEntityType.TBM,
      entityId: tbmId,
      sourceUpdatedAt,
      fields,
      skipLanguages,
    });
  }

  // ============ 스코프 헬퍼 ============

  /**
   * 관리자 접근 범위(scopeOrganizationIds) 안에서 실제 조회 대상 조직 ID 집합을 계산한다.
   * - super admin(scope undefined)이고 organizationId 미지정 → undefined(전체)
   * - organizationId 지정 → 해당 현장 하위 트리(스코프와 교집합)
   */
  private async resolveQueryOrganizationIds(
    scopeOrganizationIds: string[] | undefined,
    organizationId: string | undefined,
  ): Promise<string[] | undefined> {
    if (!organizationId) {
      return scopeOrganizationIds;
    }

    if (scopeOrganizationIds && !scopeOrganizationIds.includes(organizationId)) {
      throw new ForbiddenException('요청한 현장은 접근 권한 범위를 벗어났습니다.');
    }

    const organizationMap = await this.getOrganizationMap();
    const descendants = this.collectDescendantOrganizationIds(organizationId, organizationMap);
    if (!scopeOrganizationIds) {
      return descendants;
    }
    return descendants.filter((id) => scopeOrganizationIds.includes(id));
  }

  /** TBM이 주어진 조직 범위에 속하는지(작성자 또는 참석자 기준) where 조건을 만든다. */
  private buildScopeWhere(organizationIds: string[] | undefined): Prisma.TbmSessionWhereInput {
    if (!organizationIds) {
      return {};
    }
    return {
      OR: [
        { authorOrganizationIdAtCreate: { in: organizationIds } },
        { participants: { some: { organizationIdAtAssign: { in: organizationIds } } } },
      ],
    };
  }

  private async assertTbmInScope(
    row: { authorOrganizationIdAtCreate: string | null; participants: Array<{ organizationIdAtAssign: string | null }> },
    scopeOrganizationIds: string[] | undefined,
  ): Promise<void> {
    if (!scopeOrganizationIds) {
      return;
    }
    const scope = new Set(scopeOrganizationIds);
    const authorInScope = !!row.authorOrganizationIdAtCreate && scope.has(row.authorOrganizationIdAtCreate);
    const attendeeInScope = row.participants.some(
      (p) => !!p.organizationIdAtAssign && scope.has(p.organizationIdAtAssign),
    );
    if (!authorInScope && !attendeeInScope) {
      throw new ForbiddenException('접근 권한 범위를 벗어난 TBM입니다.');
    }
  }

  // ============ 직원 후보 조회 ============

  async findCandidates(
    filter: TbmCandidateFilterDto,
    scopeOrganizationIds: string[] | undefined,
  ): Promise<TbmCandidateResponseDto> {
    const organizationMap = await this.getOrganizationMap();
    const organizationIds = await this.resolveQueryOrganizationIds(scopeOrganizationIds, filter.organizationId);

    const employees = await this.prisma.employee.findMany({
      where: {
        deletedAt: null,
        status: { in: TBM_EMPLOYEE_SELECTABLE_STATUSES },
        employeeAccount: { is: { isActive: true } },
        ...(organizationIds ? { organizationId: { in: organizationIds } } : {}),
        ...(filter.search ? { name: { contains: filter.search, mode: 'insensitive' } } : {}),
      },
      include: {
        organization: { select: { id: true, name: true } },
        employeeAccount: { select: { preferredLanguage: true } },
      },
      orderBy: [{ organizationId: 'asc' }, { name: 'asc' }],
    });

    const groupMap = new Map<string, {
      id: string;
      name: string;
      teams: Map<string, { id: string; name: string; users: TbmCandidateResponseDto['groups'][number]['teams'][number]['users'] }>;
    }>();

    for (const employee of employees) {
      const path = this.resolveOrganizationPath(employee.organizationId, organizationMap);
      const group = path.group ?? {
        id: `${employee.organizationId}:direct`,
        name: '직속',
        parentId: null,
        teamCode: null,
      };
      const team = path.team ?? path.group ?? {
        id: employee.organizationId,
        name: employee.organization.name,
        parentId: group.id,
        teamCode: null,
      };

      const groupEntry = groupMap.get(group.id) ?? { id: group.id, name: group.name, teams: new Map() };
      const teamEntry = groupEntry.teams.get(team.id) ?? { id: team.id, name: team.name, users: [] };

      teamEntry.users.push({
        id: employee.id,
        name: employee.name,
        position: employee.position ?? null,
        organizationId: employee.organizationId,
        language: employee.employeeAccount?.preferredLanguage ?? AppLanguage.ko,
        status: employee.status,
      });
      groupEntry.teams.set(team.id, teamEntry);
      groupMap.set(group.id, groupEntry);
    }

    return {
      groups: Array.from(groupMap.values()).map((group) => ({
        id: group.id,
        name: group.name,
        teams: Array.from(group.teams.values()),
      })),
      total: employees.length,
    };
  }

  // ============ 목록 ============

  async findAll(
    filter: TbmListFilterDto,
    scopeOrganizationIds: string[] | undefined,
  ): Promise<PaginatedResponse<TbmAdminListItemDto>> {
    const page = filter.page ?? 1;
    const limit = filter.limit ?? 20;
    const queryOrganizationIds = await this.resolveQueryOrganizationIds(scopeOrganizationIds, filter.organizationId);

    const andConditions: Prisma.TbmSessionWhereInput[] = [
      { deletedAt: null },
      this.buildScopeWhere(queryOrganizationIds),
    ];

    if (filter.status) {
      andConditions.push({ status: filter.status });
    }

    const scheduledDateFilter = this.buildScheduledDateFilter(filter);
    if (scheduledDateFilter) {
      andConditions.push({ scheduledDate: scheduledDateFilter });
    }

    const trimmedSearch = filter.search?.trim();
    if (trimmedSearch) {
      andConditions.push({
        OR: [
          { title: { contains: trimmedSearch, mode: 'insensitive' } },
          { location: { contains: trimmedSearch, mode: 'insensitive' } },
          { authorNameAtCreate: { contains: trimmedSearch, mode: 'insensitive' } },
        ],
      });
    }

    if (filter.confirmFilter === TbmAttendeeConfirmFilter.HAS_PENDING) {
      andConditions.push({ participants: { some: { state: TbmParticipantState.PENDING } } });
    } else if (filter.confirmFilter === TbmAttendeeConfirmFilter.ALL_CONFIRMED) {
      andConditions.push({ participants: { none: { state: TbmParticipantState.PENDING } } });
    }

    const where: Prisma.TbmSessionWhereInput = { AND: andConditions };

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.tbmSession.findMany({
        where,
        include: {
          participants: { select: { state: true, languageAtAssigned: true } },
          originalAudio: { select: { id: true } },
          _count: { select: { attachments: true } },
        },
        orderBy: [{ scheduledDate: 'desc' }, { createdAt: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.tbmSession.count({ where }),
    ]);

    const data: TbmAdminListItemDto[] = rows.map((row) => ({
      id: row.id,
      title: row.title,
      location: row.location,
      status: row.status,
      sourceLanguage: row.sourceLanguage,
      authorEmployeeId: row.authorEmployeeId,
      authorName: row.authorNameAtCreate,
      authorOrganizationName: row.authorOrganizationNameAtCreate,
      scheduledDate: this.formatScheduledDate(row.scheduledDate),
      startedAt: row.startedAt,
      endedAt: row.endedAt,
      attendeeSummary: this.buildAttendeeSummary(row.participants),
      languageSummary: this.buildLanguageSummary(row.participants),
      hasOriginalAudio: !!row.originalAudio,
      attachmentCount: row._count.attachments,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    }));

    return new PaginatedResponse(data, total, page, limit);
  }

  // ============ 상세 ============

  private async loadDetailRow(tbmId: string) {
    const row = await this.prisma.tbmSession.findFirst({
      where: { id: tbmId, deletedAt: null },
      include: {
        authorEmployee: { select: { id: true, name: true, status: true, deletedAt: true } },
        participants: {
          include: {
            employee: {
              select: {
                id: true,
                name: true,
                status: true,
                deletedAt: true,
                organization: { select: { id: true, name: true } },
              },
            },
          },
          orderBy: { createdAt: 'asc' },
        },
        originalAudio: true,
        attachments: { orderBy: { createdAt: 'asc' } },
      },
    });

    if (!row) {
      throw new NotFoundException('TBM을 찾을 수 없습니다.');
    }

    return row;
  }

  private async buildDetail(
    row: Awaited<ReturnType<TbmsService['loadDetailRow']>>,
    request?: Request,
  ): Promise<TbmAdminDetailDto> {
    const targetLanguages = Array.from(new Set([
      ...row.participants.map((p) => p.languageAtAssigned),
      row.sourceLanguage,
    ]));
    const targetStatuses = await this.getTranslationStatusesForRow(row, targetLanguages);

    const attendees: TbmAdminAttendeeDto[] = row.participants.map((p) => ({
      id: p.id,
      employeeId: p.employeeId,
      employeeIdAtAssign: p.employeeIdAtAssign,
      name: p.employeeNameAtAssign,
      organizationNameAtAssign: p.organizationNameAtAssign,
      groupNameAtAssign: p.groupNameAtAssign,
      teamNameAtAssign: p.teamNameAtAssign,
      currentOrganizationName: p.employee?.organization?.name ?? null,
      currentEmployeeStatus: p.employee?.status ?? null,
      isDeleted: !p.employee || !!p.employee.deletedAt,
      languageAtAssigned: p.languageAtAssigned,
      state: p.state,
      confirmedAt: p.confirmedAt,
      confirmedLanguage: p.confirmedLanguage,
    }));

    return {
      id: row.id,
      status: row.status,
      sourceLanguage: row.sourceLanguage,
      author: {
        id: row.authorEmployeeId,
        name: row.authorNameAtCreate,
        organizationNameAtCreate: row.authorOrganizationNameAtCreate,
        currentEmployeeStatus: row.authorEmployee?.status ?? null,
        isDeleted: !row.authorEmployee || !!row.authorEmployee.deletedAt,
      },
      content: {
        title: row.title,
        location: row.location,
        workContent: row.workContent,
        hazards: this.parseJsonStringArray(row.hazards),
        safetyRules: this.parseJsonStringArray(row.safetyRules),
        transcriptText: row.transcriptText,
      },
      audio: {
        hasOriginalAudio: !!row.originalAudio,
        originalAudioUrl: row.originalAudio
          ? this.buildAbsoluteUrl(request, `/tbms/${row.id}/audio/original`)
          : null,
        mimeType: row.originalAudio?.mimeType ?? null,
        size: row.originalAudio?.size ?? null,
        durationSec: row.originalAudio?.durationSec ?? null,
      },
      attachments: row.attachments.map((attachment) => ({
        id: attachment.id,
        originalName: attachment.originalName,
        mimeType: attachment.mimeType,
        size: attachment.size,
        isImage: attachment.type === TbmAttachmentType.IMAGE,
        downloadUrl: this.buildAbsoluteUrl(request, `/tbms/${row.id}/attachments/${attachment.id}/download`),
        createdAt: attachment.createdAt,
      })),
      attendeeSummary: this.buildAttendeeSummary(row.participants),
      languageSummary: this.buildLanguageSummary(row.participants),
      attendees,
      translationTargets: targetLanguages.map((language) => ({
        language,
        status: targetStatuses.get(language) ?? 'PENDING',
      })),
      scheduledDate: this.formatScheduledDate(row.scheduledDate),
      startedAt: row.startedAt,
      endedAt: row.endedAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  async findOne(
    tbmId: string,
    scopeOrganizationIds: string[] | undefined,
    request?: Request,
  ): Promise<TbmAdminDetailDto> {
    const row = await this.loadDetailRow(tbmId);
    await this.assertTbmInScope(row, scopeOrganizationIds);
    return this.buildDetail(row, request);
  }

  async sendAttendeePushMessage(
    tbmId: string,
    attendeeId: string,
    dto: SendTbmPushMessageDto,
    scopeOrganizationIds: string[] | undefined,
    actorAdminId?: string,
  ): Promise<TbmPushMessageResultDto> {
    const row = await this.loadDetailRow(tbmId);
    await this.assertTbmInScope(row, scopeOrganizationIds);

    const participant = row.participants.find((item) => item.id === attendeeId);
    if (!participant) {
      throw new NotFoundException('TBM 참석자를 찾을 수 없습니다.');
    }

    const message = dto.message.trim();
    if (!message) {
      throw new BadRequestException('메시지를 입력해야 합니다.');
    }

    const targetEmployeeId = (participant.employeeId ?? participant.employeeIdAtAssign).trim();
    if (!targetEmployeeId) {
      return { targetEmployeeCount: 1, targetDeviceCount: 0, successCount: 0, failedCount: 0 };
    }

    const targets = await this.resolveTbmPushTargets([{
      employeeId: targetEmployeeId,
      language: participant.languageAtAssigned,
    }]);
    if (targets.length === 0) {
      this.logger.debug(`TBM 메시지 알림 대상 토큰 없음(tbmId=${tbmId}, attendeeId=${attendeeId})`);
      return { targetEmployeeCount: 1, targetDeviceCount: 0, successCount: 0, failedCount: 0 };
    }

    const content = this.buildTbmPushContent('message', row.title, message);
    const localizedByLanguage = await this.localizeTbmPushContentByLanguage(
      content,
      targets.map((target) => target.language),
      {
        event: 'message',
        title: row.title,
        titleSourceLanguage: row.sourceLanguage ?? AppLanguage.ko,
        messageSourceLanguage: AppLanguage.ko,
      },
    );
    const endpointUrl = `${this.getAppBackendBaseUrl()}/internal/push/fcm/send`;
    const dispatchId = `tbm-message-${tbmId}-${attendeeId}-${Date.now()}`;
    const dispatchConcurrency = this.resolveTbmPushConcurrency();
    let successCount = 0;
    const failedDeviceIds: string[] = [];
    const failureReasons: string[] = [];

    for (let index = 0; index < targets.length; index += dispatchConcurrency) {
      const chunk = targets.slice(index, index + dispatchConcurrency);
      const results = await Promise.allSettled(chunk.map((target) => this.sendTbmPush(endpointUrl, {
        dispatchId,
        event: 'message',
        tbmId: row.id,
        title: row.title,
        scheduledDate: row.scheduledDate,
        target,
        content: localizedByLanguage.get(target.language) ?? content,
        senderAdminId: actorAdminId,
        source: 'admin-backend:tbm_message',
      })));

      results.forEach((result, chunkIndex) => {
        if (result.status === 'fulfilled') {
          successCount += 1;
          return;
        }

        const failedTarget = chunk[chunkIndex];
        failedDeviceIds.push(failedTarget.deviceId);
        if (failureReasons.length < 20) {
          failureReasons.push(`${failedTarget.deviceId}:${String(result.reason)}`);
        }
      });
    }

    this.logger.log(
      `[tbm_message] dispatchId=${dispatchId}, tbmId=${tbmId}, attendeeId=${attendeeId}, targets=${targets.length}, success=${successCount}, failed=${failedDeviceIds.length}`,
    );

    if (failureReasons.length > 0) {
      this.logger.warn(`[tbm_message] failed reasons dispatchId=${dispatchId}: ${failureReasons.join(' | ')}`);
    }

    return {
      targetEmployeeCount: 1,
      targetDeviceCount: targets.length,
      successCount,
      failedCount: failedDeviceIds.length,
    };
  }

  // ============ 직원 검증 ============

  private async loadSelectableEmployees(employeeIds: string[]) {
    return this.prisma.employee.findMany({
      where: { id: { in: employeeIds } },
      include: {
        organization: { select: { id: true, name: true, parentId: true, teamCode: true } },
        employeeAccount: { select: { isActive: true, preferredLanguage: true } },
      },
    });
  }

  private assertEmployeeSelectable(
    employee: {
      id: string;
      name: string;
      status: EmployeeStatus;
      deletedAt: Date | null;
      organizationId: string;
      employeeAccount: { isActive: boolean } | null;
    },
    label: string,
    scopeOrganizationIds: string[] | undefined,
  ): void {
    if (
      !TBM_EMPLOYEE_SELECTABLE_STATUSES.includes(employee.status)
      || employee.deletedAt
      || !employee.employeeAccount?.isActive
    ) {
      throw new BadRequestException(`${label}는 활성 직원만 지정할 수 있습니다.`);
    }

    if (scopeOrganizationIds && !scopeOrganizationIds.includes(employee.organizationId)) {
      throw new ForbiddenException(`${label}가 접근 권한 범위를 벗어났습니다.`);
    }
  }

  // ============ 생성 ============

  async create(
    dto: CreateTbmDto,
    scopeOrganizationIds: string[] | undefined,
    audioFile: TbmUploadedFile | undefined,
    files: TbmUploadedFile[],
    request?: Request,
  ): Promise<TbmAdminDetailDto> {
    const uploadedFileNames = [
      ...(audioFile ? [audioFile.filename] : []),
      ...files.map((file) => file.filename),
    ];

    try {
      if (audioFile && !isAllowedTbmAudioFile(audioFile)) {
        throw new BadRequestException('허용되지 않는 음성 파일 형식입니다.');
      }
      const invalidAttachment = files.find((file) => !isAllowedTbmAttachmentFile(file));
      if (invalidAttachment) {
        throw new BadRequestException('첨부파일은 이미지 또는 PDF만 업로드할 수 있습니다.');
      }

      const organizationMap = await this.getOrganizationMap();

      const author = await this.prisma.employee.findUnique({
        where: { id: dto.authorEmployeeId },
        include: {
          organization: { select: { id: true, name: true } },
          employeeAccount: { select: { isActive: true, preferredLanguage: true } },
        },
      });

      if (!author) {
        throw new BadRequestException('작성자(생성 주체) 직원을 찾을 수 없습니다.');
      }
      this.assertEmployeeSelectable(author, '작성자', scopeOrganizationIds);

      const authorPath = this.resolveOrganizationPath(author.organizationId, organizationMap);
      if (!authorPath.company) {
        throw new BadRequestException('작성자의 소속 회사 정보를 확인할 수 없습니다.');
      }

      const attendeeEmployeeIds = Array.from(new Set(dto.attendeeEmployeeIds.map((id) => id.trim()).filter(Boolean)));
      if (attendeeEmployeeIds.length === 0) {
        throw new BadRequestException('참석자(교육 대상)를 1명 이상 선택해야 합니다.');
      }

      const attendees = await this.loadSelectableEmployees(attendeeEmployeeIds);
      if (attendees.length !== attendeeEmployeeIds.length) {
        throw new BadRequestException('존재하지 않는 참석자가 포함되어 있습니다.');
      }
      for (const attendee of attendees) {
        this.assertEmployeeSelectable(attendee, '참석자', scopeOrganizationIds);
      }

      const scheduledDate = dto.scheduledDate
        ? this.parseUtcDateTimeForDb(dto.scheduledDate)
        : new Date();
      const hazards = dto.hazards ?? [];
      const safetyRules = dto.safetyRules ?? [];
      const transcriptText = audioFile
        ? await this.transcribeTbmAudioFile(audioFile)
        : dto.transcriptText?.trim() || null;

      const created = await this.prisma.tbmSession.create({
        data: {
          organizationId: authorPath.company.id,
          organizationIdAtCreate: authorPath.company.id,
          organizationNameAtCreate: authorPath.company.name,
          authorEmployeeId: author.id,
          authorEmployeeIdAtCreate: author.id,
          authorNameAtCreate: author.name,
          authorOrganizationIdAtCreate: author.organizationId,
          authorOrganizationNameAtCreate: author.organization.name,
          sourceLanguage: AppLanguage.ko,
          title: dto.title.trim(),
          location: dto.location.trim(),
          workContent: dto.workContent.trim(),
          hazards,
          safetyRules,
          transcriptText,
          status: TbmStatus.CREATED,
          scheduledDate,
          participants: {
            create: attendees.map((attendee) => {
              const attendeePath = this.resolveOrganizationPath(attendee.organizationId, organizationMap);
              return {
                employeeId: attendee.id,
                employeeIdAtAssign: attendee.id,
                employeeNameAtAssign: attendee.name,
                employeeStatusAtAssign: attendee.status,
                positionAtAssign: attendee.position,
                roleAtAssign: attendee.role,
                organizationIdAtAssign: attendee.organizationId,
                organizationNameAtAssign: attendee.organization.name,
                groupIdAtAssign: attendeePath.group?.id ?? null,
                groupNameAtAssign: attendeePath.group?.name ?? null,
                teamIdAtAssign: attendeePath.team?.id ?? attendee.organizationId,
                teamNameAtAssign: attendeePath.team?.name ?? attendee.organization.name,
                languageAtAssigned: attendee.employeeAccount?.preferredLanguage ?? AppLanguage.ko,
              };
            }),
          },
          ...(audioFile
            ? {
                originalAudio: {
                  create: {
                    fileName: audioFile.filename,
                    originalName: normalizeTbmUploadOriginalName(audioFile.originalname, 'audio.m4a'),
                    mimeType: audioFile.mimetype,
                    size: audioFile.size,
                    storagePath: audioFile.filename,
                    durationSec: dto.audioDurationSec ?? null,
                  },
                },
              }
            : {}),
          ...(files.length > 0
            ? {
                attachments: {
                  create: files.map((file) => ({
                    type: isTbmImageFile(file) ? TbmAttachmentType.IMAGE : TbmAttachmentType.FILE,
                    fileName: file.filename,
                    originalName: normalizeTbmUploadOriginalName(file.originalname),
                    mimeType: file.mimetype,
                    size: file.size,
                    storagePath: file.filename,
                  })),
                },
              }
            : {}),
        },
        include: { participants: { select: { languageAtAssigned: true } } },
      });

      this.queueTbmTranslations(
        created.id,
        created.updatedAt,
        this.buildSourceFields(created),
        created.participants.map((p) => p.languageAtAssigned),
      );

      void this.dispatchTbmPushToAttendees(created.id, 'created').catch((error) => {
        this.logger.warn(`TBM 생성 알림 전송 실패(tbmId=${created.id}): ${String(error)}`);
      });

      return this.findOne(created.id, scopeOrganizationIds, request);
    } catch (error) {
      await cleanupTbmUploadFiles(uploadedFileNames);
      throw error;
    }
  }

  // ============ 수정 ============

  async update(
    tbmId: string,
    dto: UpdateTbmDto,
    scopeOrganizationIds: string[] | undefined,
    audioFile: TbmUploadedFile | undefined,
    files: TbmUploadedFile[],
    request?: Request,
  ): Promise<TbmAdminDetailDto> {
    const uploadedFileNames = [
      ...(audioFile ? [audioFile.filename] : []),
      ...files.map((file) => file.filename),
    ];

    try {
      if (audioFile && !isAllowedTbmAudioFile(audioFile)) {
        throw new BadRequestException('허용되지 않는 음성 파일 형식입니다.');
      }
      const invalidAttachment = files.find((file) => !isAllowedTbmAttachmentFile(file));
      if (invalidAttachment) {
        throw new BadRequestException('첨부파일은 이미지 또는 PDF만 업로드할 수 있습니다.');
      }

      const existing = await this.loadDetailRow(tbmId);
      await this.assertTbmInScope(existing, scopeOrganizationIds);

      const organizationMap = await this.getOrganizationMap();

      // 참석자 교체 처리
      let participantOps: Prisma.TbmSessionUpdateInput['participants'] | undefined;
      let nextParticipantLanguages = existing.participants.map((p) => p.languageAtAssigned);

      if (dto.attendeeEmployeeIds !== undefined) {
        const nextIds = Array.from(new Set(dto.attendeeEmployeeIds.map((id) => id.trim()).filter(Boolean)));
        if (nextIds.length === 0) {
          throw new BadRequestException('참석자(교육 대상)를 1명 이상 선택해야 합니다.');
        }

        const existingByEmployeeId = new Map(
          existing.participants.map((p) => [p.employeeIdAtAssign, p]),
        );
        const keepIds = nextIds.filter((id) => existingByEmployeeId.has(id));
        const addIds = nextIds.filter((id) => !existingByEmployeeId.has(id));
        const removeParticipantIds = existing.participants
          .filter((p) => !nextIds.includes(p.employeeIdAtAssign))
          .map((p) => p.id);

        const addEmployees = addIds.length > 0 ? await this.loadSelectableEmployees(addIds) : [];
        if (addEmployees.length !== addIds.length) {
          throw new BadRequestException('존재하지 않는 참석자가 포함되어 있습니다.');
        }
        for (const employee of addEmployees) {
          this.assertEmployeeSelectable(employee, '참석자', scopeOrganizationIds);
        }

        participantOps = {
          deleteMany: removeParticipantIds.length > 0 ? { id: { in: removeParticipantIds } } : undefined,
          create: addEmployees.map((attendee) => {
            const attendeePath = this.resolveOrganizationPath(attendee.organizationId, organizationMap);
            return {
              employeeId: attendee.id,
              employeeIdAtAssign: attendee.id,
              employeeNameAtAssign: attendee.name,
              employeeStatusAtAssign: attendee.status,
              positionAtAssign: attendee.position,
              roleAtAssign: attendee.role,
              organizationIdAtAssign: attendee.organizationId,
              organizationNameAtAssign: attendee.organization.name,
              groupIdAtAssign: attendeePath.group?.id ?? null,
              groupNameAtAssign: attendeePath.group?.name ?? null,
              teamIdAtAssign: attendeePath.team?.id ?? attendee.organizationId,
              teamNameAtAssign: attendeePath.team?.name ?? attendee.organization.name,
              languageAtAssigned: attendee.employeeAccount?.preferredLanguage ?? AppLanguage.ko,
            };
          }),
        };

        const keepLanguages = existing.participants
          .filter((p) => keepIds.includes(p.employeeIdAtAssign))
          .map((p) => p.languageAtAssigned);
        nextParticipantLanguages = [
          ...keepLanguages,
          ...addEmployees.map((e) => e.employeeAccount?.preferredLanguage ?? AppLanguage.ko),
        ];
      }

      // 첨부파일 삭제 대상
      const removeAttachmentIds = dto.removeAttachmentIds ?? [];
      const removingAttachments = existing.attachments.filter((a) => removeAttachmentIds.includes(a.id));
      const removingFileNames = removingAttachments.map((a) => a.storagePath);

      // 음성 교체/삭제 대상
      const replacingAudio = !!audioFile || dto.removeAudio === true;
      const oldAudioFileName = existing.originalAudio?.storagePath ?? null;

      const title = dto.title !== undefined ? dto.title.trim() : existing.title;
      const location = dto.location !== undefined ? dto.location.trim() : existing.location;
      const workContent = dto.workContent !== undefined ? dto.workContent.trim() : existing.workContent;
      const hazards = dto.hazards !== undefined ? dto.hazards : this.parseJsonStringArray(existing.hazards);
      const safetyRules = dto.safetyRules !== undefined ? dto.safetyRules : this.parseJsonStringArray(existing.safetyRules);
      const transcriptText = audioFile
        ? await this.transcribeTbmAudioFile(audioFile)
        : dto.transcriptText !== undefined
          ? (dto.transcriptText.trim() || null)
          : dto.removeAudio === true
            ? null
            : existing.transcriptText;
      const scheduledDate = dto.scheduledDate !== undefined
        ? this.parseUtcDateTimeForDb(dto.scheduledDate)
        : existing.scheduledDate;

      if (!title || !location || !workContent) {
        throw new BadRequestException('제목, 장소, 작업 내용은 필수입니다.');
      }

      const updated = await this.prisma.$transaction(async (tx) => {
        if (removingAttachments.length > 0) {
          await tx.tbmAttachment.deleteMany({
            where: { tbmId: existing.id, id: { in: removingAttachments.map((a) => a.id) } },
          });
        }

        if (replacingAudio && existing.originalAudio) {
          await tx.tbmOriginalAudio.delete({ where: { tbmId: existing.id } });
        }

        if (files.length > 0) {
          await tx.tbmAttachment.createMany({
            data: files.map((file) => ({
              tbmId: existing.id,
              type: isTbmImageFile(file) ? TbmAttachmentType.IMAGE : TbmAttachmentType.FILE,
              fileName: file.filename,
              originalName: normalizeTbmUploadOriginalName(file.originalname),
              mimeType: file.mimetype,
              size: file.size,
              storagePath: file.filename,
            })),
          });
        }

        if (audioFile) {
          await tx.tbmOriginalAudio.create({
            data: {
              tbmId: existing.id,
              fileName: audioFile.filename,
              originalName: normalizeTbmUploadOriginalName(audioFile.originalname, 'audio.m4a'),
              mimeType: audioFile.mimetype,
              size: audioFile.size,
              storagePath: audioFile.filename,
              durationSec: dto.audioDurationSec ?? null,
            },
          });
        }

        return tx.tbmSession.update({
          where: { id: existing.id },
          data: {
            title,
            location,
            workContent,
            hazards,
            safetyRules,
            transcriptText,
            scheduledDate,
            ...(participantOps ? { participants: participantOps } : {}),
          },
        });
      });

      // 물리 파일 정리(best-effort)
      const filesToRemove = [...removingFileNames];
      if (replacingAudio && oldAudioFileName) {
        filesToRemove.push(oldAudioFileName);
      }
      if (filesToRemove.length > 0) {
        await cleanupTbmUploadFiles(filesToRemove);
      }

      this.queueTbmTranslations(
        updated.id,
        updated.updatedAt,
        this.buildSourceFields(updated),
        nextParticipantLanguages,
      );

      return this.findOne(updated.id, scopeOrganizationIds, request);
    } catch (error) {
      await cleanupTbmUploadFiles(uploadedFileNames);
      throw error;
    }
  }

  // ============ 삭제 ============

  async remove(tbmId: string, scopeOrganizationIds: string[] | undefined): Promise<void> {
    const existing = await this.loadDetailRow(tbmId);
    await this.assertTbmInScope(existing, scopeOrganizationIds);

    await this.prisma.tbmSession.update({
      where: { id: existing.id },
      data: { deletedAt: new Date() },
    });

    await this.contentTranslationService.deleteEntityTranslationBundle(TranslatableEntityType.TBM, existing.id);

    const fileNames = [
      ...(existing.originalAudio ? [existing.originalAudio.storagePath] : []),
      ...existing.attachments.map((a) => a.storagePath),
    ];
    if (fileNames.length > 0) {
      await cleanupTbmUploadFiles(fileNames);
    }
  }

  // ============ 시작/종료 ============

  async start(tbmId: string, scopeOrganizationIds: string[] | undefined, request?: Request): Promise<TbmAdminDetailDto> {
    const existing = await this.loadDetailRow(tbmId);
    await this.assertTbmInScope(existing, scopeOrganizationIds);

    if (existing.status === TbmStatus.ACTIVE) {
      return this.buildDetail(existing, request);
    }
    if (existing.status !== TbmStatus.CREATED) {
      throw new ConflictException('시작할 수 없는 TBM 상태입니다.');
    }

    await this.prisma.tbmSession.update({
      where: { id: existing.id },
      data: { status: TbmStatus.ACTIVE, startedAt: new Date() },
    });

    void this.dispatchTbmPushToAttendees(existing.id, 'started').catch((error) => {
      this.logger.warn(`TBM 시작 알림 전송 실패(tbmId=${existing.id}): ${String(error)}`);
    });

    return this.findOne(existing.id, scopeOrganizationIds, request);
  }

  async end(tbmId: string, scopeOrganizationIds: string[] | undefined, request?: Request): Promise<TbmAdminDetailDto> {
    const existing = await this.loadDetailRow(tbmId);
    await this.assertTbmInScope(existing, scopeOrganizationIds);

    if (existing.status !== TbmStatus.ACTIVE) {
      throw new ConflictException('종료할 수 없는 TBM 상태입니다.');
    }

    await this.prisma.tbmSession.update({
      where: { id: existing.id },
      data: { status: TbmStatus.ENDED, endedAt: new Date() },
    });

    return this.findOne(existing.id, scopeOrganizationIds, request);
  }

  /**
   * 관리자가 TBM 상태를 수동으로 변경한다. 시작 전(CREATED)으로 되돌리는 것을 포함해
   * 모든 상태로 전환할 수 있으며, 상태에 맞게 시작/종료 시각을 보정한다.
   *
   * @param resetConfirmations 시작 전으로 되돌릴 때 참석자 이수 기록도 초기화할지 여부
   */
  async changeStatus(
    tbmId: string,
    nextStatus: TbmStatus,
    scopeOrganizationIds: string[] | undefined,
    options: { resetConfirmations?: boolean } = {},
    request?: Request,
  ): Promise<TbmAdminDetailDto> {
    const existing = await this.loadDetailRow(tbmId);
    await this.assertTbmInScope(existing, scopeOrganizationIds);

    const now = new Date();
    const data: Prisma.TbmSessionUpdateInput = { status: nextStatus };

    if (nextStatus === TbmStatus.CREATED) {
      // 시작 전으로 되돌리기: 시작/종료 시각 초기화
      data.startedAt = null;
      data.endedAt = null;
    } else if (nextStatus === TbmStatus.ACTIVE) {
      data.startedAt = existing.startedAt ?? now;
      data.endedAt = null;
    } else {
      // ENDED
      data.startedAt = existing.startedAt ?? now;
      data.endedAt = existing.endedAt ?? now;
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.tbmSession.update({ where: { id: existing.id }, data });

      if (nextStatus === TbmStatus.CREATED && options.resetConfirmations) {
        await tx.tbmParticipant.updateMany({
          where: { tbmId: existing.id, state: TbmParticipantState.CONFIRMED },
          data: { state: TbmParticipantState.PENDING, confirmedAt: null, confirmedLanguage: null },
        });
      }
    });

    return this.findOne(existing.id, scopeOrganizationIds, request);
  }

  // ============ 파일 스트리밍 ============

  async resolveOriginalAudioFileTarget(tbmId: string, scopeOrganizationIds: string[] | undefined): Promise<{
    absolutePath: string;
    mimeType: string;
    originalName: string;
    size: number;
  }> {
    const row = await this.loadDetailRow(tbmId);
    await this.assertTbmInScope(row, scopeOrganizationIds);

    if (!row.originalAudio) {
      throw new NotFoundException('원본 음성 파일이 없습니다.');
    }

    const fileName = sanitizeTbmStoredFileName(row.originalAudio.storagePath);
    const absolutePath = resolve(getTbmUploadDir(), fileName);
    await access(absolutePath);

    return {
      absolutePath,
      mimeType: row.originalAudio.mimeType,
      originalName: row.originalAudio.originalName,
      size: row.originalAudio.size,
    };
  }

  async resolveAttachmentFileTarget(
    tbmId: string,
    attachmentId: string,
    scopeOrganizationIds: string[] | undefined,
  ): Promise<{
    absolutePath: string;
    mimeType: string;
    originalName: string;
    isImage: boolean;
  }> {
    const row = await this.loadDetailRow(tbmId);
    await this.assertTbmInScope(row, scopeOrganizationIds);

    const attachment = row.attachments.find((a) => a.id === attachmentId);
    if (!attachment) {
      throw new NotFoundException('첨부파일을 찾을 수 없습니다.');
    }

    const fileName = sanitizeTbmStoredFileName(attachment.storagePath);
    const absolutePath = resolve(getTbmUploadDir(), fileName);
    await access(absolutePath);

    return {
      absolutePath,
      mimeType: attachment.mimeType,
      originalName: attachment.originalName,
      isImage: attachment.type === TbmAttachmentType.IMAGE,
    };
  }

  buildContentDisposition(fileName: string, isInline: boolean): string {
    return buildContentDisposition(fileName, isInline);
  }
}
