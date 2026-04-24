import { Injectable, NotFoundException } from '@nestjs/common';
import { AppLanguage, TranslatableEntityType } from '@prisma/client';
import { SUPPORTED_APP_LANGUAGE_DETAILS } from '@/common/translation/app-language.util';
import { ContentTranslationService } from '@/common/translation/translation.service';
import { PrismaService } from '@/prisma/prisma.service';
import {
  TranslationRebuildArea,
  TranslationRebuildRequestDto,
  TranslationRebuildResponseDto,
  TranslationRebuildResultDto,
} from './dto/translation-test.dto';

type TranslationField = {
  fieldKey: string;
  content: string | null | undefined;
  isHtml?: boolean;
};

type TranslationTarget = {
  entityType: TranslatableEntityType;
  entityId: string;
  sourceUpdatedAt: Date;
  fields: TranslationField[];
};

@Injectable()
export class TranslationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly contentTranslationService: ContentTranslationService,
  ) {}

  getSupportedLanguages() {
    return SUPPORTED_APP_LANGUAGE_DETAILS.map((language) => ({ ...language }));
  }

  async rebuildTranslations(dto: TranslationRebuildRequestDto): Promise<TranslationRebuildResponseDto> {
    const targets = await this.loadTargets(dto.area, dto.entityId);
    if (dto.entityId && targets.length === 0) {
      throw new NotFoundException(`${dto.area} 영역에서 대상을 찾을 수 없습니다: ${dto.entityId}`);
    }

    const summaryByEntityType = new Map<TranslatableEntityType, TranslationRebuildResultDto>();

    for (const target of targets) {
      const result = await this.syncTarget(target);
      const current = summaryByEntityType.get(target.entityType) ?? {
        entityType: target.entityType,
        processedCount: 0,
        queuedCount: 0,
        clearedCount: 0,
      };

      current.processedCount += 1;
      current.queuedCount += result.queued ? 1 : 0;
      current.clearedCount += result.cleared ? 1 : 0;
      summaryByEntityType.set(target.entityType, current);
    }

    return {
      area: dto.area,
      entityId: dto.entityId ?? null,
      processedCount: targets.length,
      results: Array.from(summaryByEntityType.values()),
    };
  }

  private async syncTarget(target: TranslationTarget): Promise<{ queued: boolean; cleared: boolean }> {
    const normalizedFields = target.fields.map((field) => ({
      fieldKey: field.fieldKey.trim(),
      content: String(field.content ?? '').trim(),
      isHtml: field.isHtml === true,
    }));

    const nonEmptyFields = normalizedFields.filter((field) => field.fieldKey.length > 0 && field.content.length > 0);
    const emptyFieldKeys = normalizedFields
      .filter((field) => field.fieldKey.length > 0 && field.content.length === 0)
      .map((field) => field.fieldKey);

    if (nonEmptyFields.length > 0) {
      await this.contentTranslationService.storeEntityTranslations(
        target.entityType,
        target.entityId,
        AppLanguage.ko,
        Object.fromEntries(nonEmptyFields.map((field) => [field.fieldKey, field.content])),
        target.sourceUpdatedAt,
      );

      this.contentTranslationService.queueTranslationsFromKorean({
        entityType: target.entityType,
        entityId: target.entityId,
        sourceUpdatedAt: target.sourceUpdatedAt,
        fields: nonEmptyFields,
      });
    }

    if (emptyFieldKeys.length > 0) {
      await this.contentTranslationService.deleteEntityTranslations(
        target.entityType,
        target.entityId,
        emptyFieldKeys,
      );
      await this.contentTranslationService.deletePendingTranslationJobs(
        target.entityType,
        target.entityId,
        emptyFieldKeys,
      );
    }

    return {
      queued: nonEmptyFields.length > 0,
      cleared: emptyFieldKeys.length > 0,
    };
  }

  private async loadTargets(area: TranslationRebuildArea, entityId?: string): Promise<TranslationTarget[]> {
    switch (area) {
      case TranslationRebuildArea.NOTICE:
        return this.loadNoticeTargets(entityId);
      case TranslationRebuildArea.CONTROL_POLICY:
        return this.loadControlPolicyTargets(entityId);
      case TranslationRebuildArea.INCIDENT_REPORT:
        return this.loadIncidentReportTargets(entityId);
      case TranslationRebuildArea.ZONE:
        return this.loadZoneTargets(entityId);
      case TranslationRebuildArea.TIME_POLICY:
        return this.loadTimePolicyTargets(entityId);
      case TranslationRebuildArea.BEHAVIOR_CONDITION:
        return this.loadBehaviorConditionTargets(entityId);
      case TranslationRebuildArea.ALLOWED_APP_PRESET:
        return this.loadAllowedAppPresetTargets(entityId);
      case TranslationRebuildArea.ALLOWED_APP:
        return this.loadAllowedAppTargets(entityId);
      default:
        return [];
    }
  }

  private async loadNoticeTargets(entityId?: string): Promise<TranslationTarget[]> {
    const notices = await this.prisma.notice.findMany({
      where: entityId ? { id: entityId } : undefined,
      select: {
        id: true,
        title: true,
        contentHtml: true,
        contentText: true,
        updatedAt: true,
      },
    });

    return notices.map((notice) => ({
      entityType: TranslatableEntityType.NOTICE,
      entityId: notice.id,
      sourceUpdatedAt: notice.updatedAt,
      fields: [
        { fieldKey: 'title', content: notice.title },
        { fieldKey: 'contentHtml', content: notice.contentHtml, isHtml: true },
        { fieldKey: 'contentText', content: notice.contentText },
      ],
    }));
  }

  private async loadControlPolicyTargets(entityId?: string): Promise<TranslationTarget[]> {
    const policies = await this.prisma.controlPolicy.findMany({
      where: entityId ? { id: entityId } : undefined,
      select: {
        id: true,
        name: true,
        description: true,
        updatedAt: true,
      },
    });

    return policies.map((policy) => ({
      entityType: TranslatableEntityType.CONTROL_POLICY,
      entityId: policy.id,
      sourceUpdatedAt: policy.updatedAt,
      fields: [
        { fieldKey: 'name', content: policy.name },
        { fieldKey: 'description', content: policy.description },
      ],
    }));
  }

  private async loadIncidentReportTargets(entityId?: string): Promise<TranslationTarget[]> {
    const reports = await this.prisma.incidentReport.findMany({
      where: {
        deletedAt: null,
        ...(entityId ? { id: entityId } : {}),
      },
      select: {
        id: true,
        title: true,
        description: true,
        resolutionSummary: true,
        updatedAt: true,
      },
    });

    return reports.map((report) => ({
      entityType: TranslatableEntityType.INCIDENT_REPORT,
      entityId: report.id,
      sourceUpdatedAt: report.updatedAt,
      fields: [
        { fieldKey: 'title', content: report.title },
        { fieldKey: 'description', content: report.description },
        { fieldKey: 'resolutionSummary', content: report.resolutionSummary },
      ],
    }));
  }

  private async loadZoneTargets(entityId?: string): Promise<TranslationTarget[]> {
    const zones = await this.prisma.zone.findMany({
      where: {
        deletedAt: null,
        ...(entityId ? { id: entityId } : {}),
      },
      select: {
        id: true,
        name: true,
        description: true,
        updatedAt: true,
      },
    });

    return zones.map((zone) => ({
      entityType: TranslatableEntityType.ZONE,
      entityId: zone.id,
      sourceUpdatedAt: zone.updatedAt,
      fields: [
        { fieldKey: 'name', content: zone.name },
        { fieldKey: 'description', content: zone.description },
      ],
    }));
  }

  private async loadTimePolicyTargets(entityId?: string): Promise<TranslationTarget[]> {
    const policies = await this.prisma.timePolicy.findMany({
      where: entityId ? { id: entityId } : undefined,
      select: {
        id: true,
        name: true,
        description: true,
        updatedAt: true,
        excludePeriods: {
          select: {
            id: true,
            reason: true,
          },
        },
      },
    });

    return policies.flatMap((policy) => {
      const targets: TranslationTarget[] = [{
        entityType: TranslatableEntityType.TIME_POLICY,
        entityId: policy.id,
        sourceUpdatedAt: policy.updatedAt,
        fields: [
          { fieldKey: 'name', content: policy.name },
          { fieldKey: 'description', content: policy.description },
        ],
      }];

      for (const excludePeriod of policy.excludePeriods) {
        targets.push({
          entityType: TranslatableEntityType.TIME_POLICY_EXCLUDE_PERIOD,
          entityId: excludePeriod.id,
          sourceUpdatedAt: policy.updatedAt,
          fields: [{ fieldKey: 'name', content: excludePeriod.reason }],
        });
      }

      return targets;
    });
  }

  private async loadBehaviorConditionTargets(entityId?: string): Promise<TranslationTarget[]> {
    const conditions = await this.prisma.behaviorCondition.findMany({
      where: entityId ? { id: entityId } : undefined,
      select: {
        id: true,
        name: true,
        description: true,
        updatedAt: true,
      },
    });

    return conditions.map((condition) => ({
      entityType: TranslatableEntityType.BEHAVIOR_CONDITION,
      entityId: condition.id,
      sourceUpdatedAt: condition.updatedAt,
      fields: [
        { fieldKey: 'name', content: condition.name },
        { fieldKey: 'description', content: condition.description },
      ],
    }));
  }

  private async loadAllowedAppPresetTargets(entityId?: string): Promise<TranslationTarget[]> {
    const presets = await this.prisma.allowedAppPreset.findMany({
      where: entityId ? { id: entityId } : undefined,
      select: {
        id: true,
        name: true,
        description: true,
        updatedAt: true,
      },
    });

    return presets.map((preset) => ({
      entityType: TranslatableEntityType.ALLOWED_APP_PRESET,
      entityId: preset.id,
      sourceUpdatedAt: preset.updatedAt,
      fields: [
        { fieldKey: 'name', content: preset.name },
        { fieldKey: 'description', content: preset.description },
      ],
    }));
  }

  private async loadAllowedAppTargets(entityId?: string): Promise<TranslationTarget[]> {
    const apps = await this.prisma.allowedApp.findMany({
      where: entityId ? { id: entityId } : undefined,
      select: {
        id: true,
        name: true,
        updatedAt: true,
      },
    });

    return apps.map((app) => ({
      entityType: TranslatableEntityType.ALLOWED_APP,
      entityId: app.id,
      sourceUpdatedAt: app.updatedAt,
      fields: [{ fieldKey: 'name', content: app.name }],
    }));
  }
}