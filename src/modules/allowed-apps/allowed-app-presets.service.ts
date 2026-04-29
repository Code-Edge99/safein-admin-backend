import { Injectable, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { AppLanguage, AuditAction, TranslatableEntityType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { deactivatePoliciesWithoutConditions } from '../../common/utils/control-policy-cleanup.util';
import { assertOrganizationInScopeOrThrow, ensureOrganizationInScope, assertConditionOwnerOrganization, resolvePolicySourceOrganizationIds } from '../../common/utils/organization-scope.util';
import { ContentTranslationService } from '@/common/translation/translation.service';
import { ControlPoliciesService } from '../control-policies/control-policies.service';
import { toAllowedAppPresetDetailDto, toAllowedAppPresetResponseDto } from './allowed-app-presets.mapper';
import {
  CreateAllowedAppPresetDto,
  UpdateAllowedAppPresetDto,
  AllowedAppPresetResponseDto,
  AllowedAppPresetDetailDto,
  AllowedAppPresetFilterDto,
  AllowedAppPresetListResponseDto,
  AllowedAppStatsDto,
} from './dto';

@Injectable()
export class AllowedAppPresetsService {
  private readonly validPlatforms = ['android', 'ios'] as const;
  private platformsNormalized = false;

  constructor(
    private prisma: PrismaService,
    private readonly contentTranslationService: ContentTranslationService,
    private readonly controlPoliciesService: ControlPoliciesService,
  ) {}

  private async syncAllowedAppPresetTranslations(
    presetId: string,
    values: { name: string; description?: string | null },
    updatedAt: Date,
  ): Promise<void> {
    await this.contentTranslationService.storeEntityTranslations(
      TranslatableEntityType.ALLOWED_APP_PRESET,
      presetId,
      AppLanguage.ko,
      values,
      updatedAt,
    );

    this.contentTranslationService.queueTranslationsFromKorean({
      entityType: TranslatableEntityType.ALLOWED_APP_PRESET,
      entityId: presetId,
      sourceUpdatedAt: updatedAt,
      fields: [
        { fieldKey: 'name', content: values.name },
        { fieldKey: 'description', content: values.description ?? '' },
      ],
    });
  }

  private ensureOrganizationInScope(
    organizationId: string | undefined,
    scopeOrganizationIds?: string[],
  ): void {
    ensureOrganizationInScope(organizationId, scopeOrganizationIds);
  }

  private assertPresetInScope(
    preset: { organizationId: string },
    scopeOrganizationIds?: string[],
  ): void {
    assertOrganizationInScopeOrThrow(preset.organizationId, scopeOrganizationIds, '허용앱 프리셋을 찾을 수 없습니다.');
  }

  private normalizePlatform(platform?: string): 'android' | 'ios' {
    if (platform === 'ios') return 'ios';
    return 'android';
  }

  private async findAppsOrThrow(appIds: string[] | undefined): Promise<Array<{ id: string; packageName: string; platform: string }>> {
    if (!appIds || appIds.length === 0) return [];

    const apps = await this.prisma.allowedApp.findMany({
      where: { id: { in: appIds } },
      select: { id: true, packageName: true, platform: true },
    });

    const foundIds = new Set(apps.map((app) => app.id));
    const missingIds = appIds.filter((id) => !foundIds.has(id));
    if (missingIds.length > 0) {
      throw new NotFoundException(`존재하지 않는 허용앱이 포함되어 있습니다: ${missingIds.join(', ')}`);
    }

    return apps;
  }

  private inferPlatformFromApps(
    apps: Array<{ id: string; packageName: string; platform: string }>,
  ): 'android' | 'ios' | undefined {
    if (apps.length === 0) return undefined;

    const platforms = Array.from(new Set(apps.map((app) => this.normalizePlatform(app.platform))));
    if (platforms.length > 1) return undefined;

    return platforms[0];
  }

  private validateAppsPlatform(
    apps: Array<{ id: string; packageName: string; platform: string }>,
    presetPlatform?: 'android' | 'ios',
  ): void {
    // 프리셋에는 플랫폼 혼합 앱 저장을 허용하고, 실제 전송 시 디바이스 플랫폼에 맞는 앱만 내려준다.
    void apps;
    void presetPlatform;
  }

  private async ensureValidPlatformData(): Promise<void> {
    if (this.platformsNormalized) return;

    await Promise.all([
      this.prisma.allowedApp.updateMany({
        where: { platform: { notIn: [...this.validPlatforms] } },
        data: { platform: 'android' },
      }),
      this.prisma.allowedAppPreset.updateMany({
        where: { platform: { notIn: [...this.validPlatforms] }, deletedAt: null },
        data: { platform: 'android' },
      }),
    ]);

    this.platformsNormalized = true;
  }

  async create(
    dto: CreateAllowedAppPresetDto,
    scopeOrganizationIds?: string[],
    actorUserId?: string,
  ): Promise<AllowedAppPresetDetailDto> {
    await this.ensureValidPlatformData();

    this.ensureOrganizationInScope(dto.organizationId, scopeOrganizationIds);

    await assertConditionOwnerOrganization(this.prisma, dto.organizationId);

    const apps = await this.findAppsOrThrow(dto.appIds);
    const explicitPlatform = dto.platform === undefined ? undefined : this.normalizePlatform(dto.platform);
    const inferredPlatform = this.inferPlatformFromApps(apps);
    const targetPlatform = explicitPlatform ?? inferredPlatform ?? 'android';
    this.validateAppsPlatform(apps, targetPlatform);

    const preset = await this.prisma.allowedAppPreset.create({
      data: {
        name: dto.name,
        description: dto.description,
        platform: targetPlatform,
        organizationId: dto.organizationId,
        createdById: actorUserId,
        updatedById: actorUserId,
        items: dto.appIds?.length
          ? {
              create: dto.appIds.map((appId) => ({
                allowedApp: { connect: { id: appId } },
              })),
            }
          : undefined,
      },
      include: {
        organization: { select: { id: true, name: true } },
        items: {
          include: {
            allowedApp: true,
          },
        },
        _count: {
          select: { policyPresets: true },
        },
      },
    });

    await this.syncAllowedAppPresetTranslations(preset.id, {
      name: preset.name,
      description: preset.description ?? '',
    }, preset.updatedAt);

    return this.toDetailDto(preset);
  }

  async findAll(
    filter: AllowedAppPresetFilterDto,
    scopeOrganizationIds?: string[],
  ): Promise<AllowedAppPresetListResponseDto> {
    await this.ensureValidPlatformData();

    const page = filter.page || 1;
    const limit = filter.limit || 20;
    const skip = (page - 1) * limit;

    const where: any = { deletedAt: null };

    if (filter.search) {
      where.name = { contains: filter.search, mode: 'insensitive' };
    }

    if (filter.organizationId) {
      this.ensureOrganizationInScope(filter.organizationId, scopeOrganizationIds);
      where.organizationId = filter.includePolicySourceOrganizations
        ? { in: await resolvePolicySourceOrganizationIds(this.prisma, filter.organizationId) }
        : filter.organizationId;
    } else if (scopeOrganizationIds) {
      where.organizationId = { in: scopeOrganizationIds };
    }

    if (filter.platform && filter.platform !== 'all') {
      where.platform = this.normalizePlatform(filter.platform);
    }

    const [data, total] = await Promise.all([
      this.prisma.allowedAppPreset.findMany({
        where,
        skip,
        take: limit,
        include: {
          organization: { select: { id: true, name: true } },
          items: {
            include: {
              allowedApp: true,
            },
          },
          _count: {
            select: { items: true, policyPresets: true },
          },
        },
        orderBy: { name: 'asc' },
      }),
      this.prisma.allowedAppPreset.count({ where }),
    ]);

    return {
      data: data.map((preset) => this.toDetailDto(preset)),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async findOne(id: string, scopeOrganizationIds?: string[]): Promise<AllowedAppPresetDetailDto> {
    await this.ensureValidPlatformData();

    const preset = await this.prisma.allowedAppPreset.findFirst({
      where: { id, deletedAt: null },
      include: {
        organization: { select: { id: true, name: true } },
        items: {
          include: {
            allowedApp: true,
          },
        },
        _count: {
          select: { policyPresets: true },
        },
      },
    });

    if (!preset) {
      throw new NotFoundException('허용앱 프리셋을 찾을 수 없습니다.');
    }

    this.assertPresetInScope(preset, scopeOrganizationIds);

    return this.toDetailDto(preset);
  }

  async update(
    id: string,
    dto: UpdateAllowedAppPresetDto,
    scopeOrganizationIds?: string[],
    actorUserId?: string,
  ): Promise<AllowedAppPresetDetailDto> {
    await this.ensureValidPlatformData();
    const existingPreset = await this.findOne(id, scopeOrganizationIds);
    const currentPreset = await this.prisma.allowedAppPreset.findFirst({
      where: { id, deletedAt: null },
      select: { organizationId: true },
    });

    if (!currentPreset) {
      throw new NotFoundException('허용앱 프리셋을 찾을 수 없습니다.');
    }

    const targetOrganizationId = dto.organizationId === undefined
      ? currentPreset.organizationId
      : dto.organizationId;

    if (!targetOrganizationId) {
      throw new BadRequestException('현장을 찾을 수 없습니다.');
    }

    if (dto.organizationId !== undefined) {
      this.ensureOrganizationInScope(targetOrganizationId, scopeOrganizationIds);
    }

    await assertConditionOwnerOrganization(this.prisma, targetOrganizationId);

    const explicitPlatform = dto.platform === undefined ? undefined : this.normalizePlatform(dto.platform);

    let appsToValidate: Array<{ id: string; packageName: string; platform: string }> = [];
    if (dto.appIds !== undefined) {
      appsToValidate = await this.findAppsOrThrow(dto.appIds);
    } else if (explicitPlatform !== undefined) {
      const existingAppIds = (existingPreset.apps || []).map((app) => app.id);
      appsToValidate = await this.findAppsOrThrow(existingAppIds);
    }

    const inferredPlatform = explicitPlatform === undefined ? this.inferPlatformFromApps(appsToValidate) : undefined;
    const targetPlatform = explicitPlatform
      ?? inferredPlatform
      ?? this.normalizePlatform(existingPreset.platform);

    this.validateAppsPlatform(appsToValidate, targetPlatform);

    // 앱 목록이 변경되는 경우 처리
    if (dto.appIds !== undefined) {
      // 기존 연결 삭제
      await this.prisma.allowedAppPresetItem.deleteMany({
        where: { presetId: id },
      });

      // 새 연결 생성
      if (dto.appIds.length > 0) {
        await this.prisma.allowedAppPresetItem.createMany({
          data: dto.appIds.map((appId) => ({
            presetId: id,
            allowedAppId: appId,
          })),
        });
      }
    }

    const preset = await this.prisma.allowedAppPreset.update({
      where: { id },
      data: {
        name: dto.name,
        description: dto.description,
        platform: explicitPlatform !== undefined || inferredPlatform !== undefined ? targetPlatform : undefined,
        organizationId: dto.organizationId === undefined ? undefined : targetOrganizationId,
        updatedById: actorUserId,
      },
      include: {
        organization: { select: { id: true, name: true } },
        items: {
          include: {
            allowedApp: true,
          },
        },
        _count: {
          select: { policyPresets: true },
        },
      },
    });

    await this.syncAllowedAppPresetTranslations(preset.id, {
      name: preset.name,
      description: preset.description ?? '',
    }, preset.updatedAt);

    await this.notifyPoliciesByPreset(id);

    if (actorUserId) {
      void this.prisma.auditLog.create({
        data: {
          accountId: actorUserId,
          organizationId: preset.organization?.id ?? null,
          action: AuditAction.UPDATE,
          resourceType: 'AllowedAppPreset',
          resourceId: preset.id,
          resourceName: preset.name,
          changesAfter: {
            presetId: preset.id,
            updatedById: actorUserId,
          },
        },
      }).catch(() => undefined);
    }

    return this.toDetailDto(preset);
  }

  async remove(id: string, scopeOrganizationIds?: string[]): Promise<void> {
    await this.ensureValidPlatformData();

    const preset = await this.prisma.allowedAppPreset.findFirst({
      where: { id, deletedAt: null },
      include: {
        _count: {
          select: {
            policyPresets: true,
          },
        },
      },
    });

    if (!preset) {
      throw new NotFoundException('허용앱 프리셋을 찾을 수 없습니다.');
    }

    this.assertPresetInScope(preset, scopeOrganizationIds);

    let impactedPolicyIds: string[] = [];
    await this.prisma.$transaction(async (tx) => {
      const impacted = await tx.controlPolicyAllowedApp.findMany({
        where: { presetId: id },
        select: { policyId: true },
      });
      impactedPolicyIds = impacted.map((item: any) => item.policyId);

      await tx.controlPolicyAllowedApp.deleteMany({ where: { presetId: id } });
      await tx.allowedAppPreset.update({
        where: { id },
        data: {
          deletedAt: new Date(),
        },
      });

      await deactivatePoliciesWithoutConditions(
        tx,
        impacted.map((item: any) => item.policyId),
      );
    });

    await this.controlPoliciesService.notifyPoliciesChanged(impactedPolicyIds, 'update');
  }

  async addApps(
    id: string,
    appIds: string[],
    scopeOrganizationIds?: string[],
    actorUserId?: string,
  ): Promise<AllowedAppPresetDetailDto> {
    await this.ensureValidPlatformData();
    const preset = await this.findOne(id, scopeOrganizationIds);
    const apps = await this.findAppsOrThrow(appIds);
    this.validateAppsPlatform(apps, this.normalizePlatform(preset.platform));

    // 기존에 없는 앱만 추가
    const existingItems = await this.prisma.allowedAppPresetItem.findMany({
      where: { presetId: id },
      select: { allowedAppId: true },
    });

    const existingAppIds = new Set(existingItems.map((item) => item.allowedAppId));
    const newAppIds = appIds.filter((appId) => !existingAppIds.has(appId));

    if (newAppIds.length > 0) {
      await this.prisma.allowedAppPresetItem.createMany({
        data: newAppIds.map((appId) => ({
          presetId: id,
          allowedAppId: appId,
        })),
      });
    }

    await this.notifyPoliciesByPreset(id);

    if (actorUserId) {
      void this.prisma.auditLog.create({
        data: {
          accountId: actorUserId,
          organizationId: preset.organization?.id ?? null,
          action: AuditAction.UPDATE,
          resourceType: 'AllowedAppPreset',
          resourceId: id,
          resourceName: preset.name,
          changesAfter: {
            presetId: id,
            addedAppIds: newAppIds,
            updatedById: actorUserId,
          },
        },
      }).catch(() => undefined);
    }

    return this.findOne(id);
  }

  async removeApps(
    id: string,
    appIds: string[],
    scopeOrganizationIds?: string[],
    actorUserId?: string,
  ): Promise<AllowedAppPresetDetailDto> {
    await this.ensureValidPlatformData();

    const preset = await this.findOne(id, scopeOrganizationIds);

    await this.prisma.allowedAppPresetItem.deleteMany({
      where: {
        presetId: id,
        allowedAppId: { in: appIds },
      },
    });

    await this.notifyPoliciesByPreset(id);

    if (actorUserId) {
      void this.prisma.auditLog.create({
        data: {
          accountId: actorUserId,
          organizationId: preset.organization?.id ?? null,
          action: AuditAction.UPDATE,
          resourceType: 'AllowedAppPreset',
          resourceId: id,
          resourceName: preset.name,
          changesAfter: {
            presetId: id,
            removedAppIds: appIds,
            updatedById: actorUserId,
          },
        },
      }).catch(() => undefined);
    }

    return this.findOne(id, scopeOrganizationIds);
  }

  private async notifyPoliciesByPreset(presetId: string): Promise<void> {
    const impactedPolicies = await this.prisma.controlPolicyAllowedApp.findMany({
      where: { presetId },
      select: { policyId: true },
    });

    await this.controlPoliciesService.notifyPoliciesChanged(
      impactedPolicies.map((item) => item.policyId),
      'update',
    );
  }

  async findByOrganization(
    organizationId: string,
    scopeOrganizationIds?: string[],
  ): Promise<AllowedAppPresetResponseDto[]> {
    await this.ensureValidPlatformData();

    this.ensureOrganizationInScope(organizationId, scopeOrganizationIds);

    const presets = await this.prisma.allowedAppPreset.findMany({
      where: { organizationId, deletedAt: null },
      include: {
        organization: { select: { id: true, name: true } },
        items: {
          include: {
            allowedApp: true,
          },
        },
        _count: {
          select: { items: true, policyPresets: true },
        },
      },
      orderBy: { name: 'asc' },
    });

    return presets.map((preset) => this.toDetailDto(preset));
  }

  async getStats(scopeOrganizationIds?: string[]): Promise<AllowedAppStatsDto> {
    await this.ensureValidPlatformData();

    const [totalApps, globalApps, totalPresets, categoryStats, platformStats] = await Promise.all([
      this.prisma.allowedApp.count(),
      this.prisma.allowedApp.count({ where: { isGlobal: true } }),
      this.prisma.allowedAppPreset.count({
        where: scopeOrganizationIds
          ? { organizationId: { in: scopeOrganizationIds }, deletedAt: null }
          : { deletedAt: null },
      }),
      this.prisma.allowedApp.groupBy({
        by: ['category'],
        _count: true,
      }),
      this.prisma.allowedApp.groupBy({
        by: ['platform'],
        _count: true,
      }),
    ]);

    const byCategory: Record<string, number> = {};
    categoryStats.forEach((stat) => {
      const category = stat.category || '미분류';
      byCategory[category] = stat._count;
    });

    const byPlatform: Record<string, number> = {};
    platformStats.forEach((stat) => {
      byPlatform[stat.platform] = stat._count;
    });

    return {
      totalApps,
      globalApps,
      totalPresets,
      byCategory,
      byPlatform,
    };
  }

  private toResponseDto(preset: any): AllowedAppPresetResponseDto {
    return toAllowedAppPresetResponseDto(preset, (platform) => this.normalizePlatform(platform));
  }

  private toDetailDto(preset: any): AllowedAppPresetDetailDto {
    return toAllowedAppPresetDetailDto(preset, (platform) => this.normalizePlatform(platform));
  }
}
