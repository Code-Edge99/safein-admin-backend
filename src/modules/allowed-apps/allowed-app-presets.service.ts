import { Injectable, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { deactivatePoliciesWithoutConditions } from '../../common/utils/control-policy-cleanup.util';
import { assertOrganizationInScopeOrThrow, ensureOrganizationInScope } from '../../common/utils/organization-scope.util';
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
  private readonly validPlatforms = ['android', 'ios', 'both'] as const;
  private platformsNormalized = false;

  constructor(
    private prisma: PrismaService,
    private readonly controlPoliciesService: ControlPoliciesService,
  ) {}

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

  private normalizePlatform(platform?: string): 'android' | 'ios' | 'both' {
    if (platform === 'ios') return 'ios';
    if (platform === 'both') return 'both';
    return 'android';
  }

  private async ensureValidPlatformData(): Promise<void> {
    if (this.platformsNormalized) return;

    await Promise.all([
      this.prisma.allowedApp.updateMany({
        where: { platform: { notIn: [...this.validPlatforms] } },
        data: { platform: 'android' },
      }),
      this.prisma.allowedAppPreset.updateMany({
        where: { platform: { notIn: [...this.validPlatforms] } },
        data: { platform: 'both' },
      }),
    ]);

    this.platformsNormalized = true;
  }

  private async validateAppsExist(appIds: string[] | undefined): Promise<void> {
    if (!appIds || appIds.length === 0) return;

    const apps = await this.prisma.allowedApp.findMany({
      where: { id: { in: appIds } },
      select: { id: true, name: true, platform: true },
    });

    const foundIds = new Set(apps.map((app) => app.id));
    const missingIds = appIds.filter((id) => !foundIds.has(id));
    if (missingIds.length > 0) {
      throw new NotFoundException(`존재하지 않는 허용앱이 포함되어 있습니다: ${missingIds.join(', ')}`);
    }

  }

  async create(dto: CreateAllowedAppPresetDto, scopeOrganizationIds?: string[]): Promise<AllowedAppPresetDetailDto> {
    await this.ensureValidPlatformData();

    this.ensureOrganizationInScope(dto.organizationId, scopeOrganizationIds);

    await this.validateAppsExist(dto.appIds);

    const preset = await this.prisma.allowedAppPreset.create({
      data: {
        name: dto.name,
        description: dto.description,
        platform: 'both',
        organizationId: dto.organizationId,
        workTypeId: dto.workTypeId,
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
        workType: { select: { id: true, name: true } },
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

    const where: any = {};

    if (filter.search) {
      where.name = { contains: filter.search, mode: 'insensitive' };
    }

    if (filter.organizationId) {
      this.ensureOrganizationInScope(filter.organizationId, scopeOrganizationIds);
      where.organizationId = filter.organizationId;
    } else if (scopeOrganizationIds) {
      where.organizationId = { in: scopeOrganizationIds };
    }

    if (filter.workTypeId) {
      where.workTypeId = filter.workTypeId;
    }

    const [data, total] = await Promise.all([
      this.prisma.allowedAppPreset.findMany({
        where,
        skip,
        take: limit,
        include: {
          organization: { select: { id: true, name: true } },
          workType: { select: { id: true, name: true } },
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

    const preset = await this.prisma.allowedAppPreset.findUnique({
      where: { id },
      include: {
        organization: { select: { id: true, name: true } },
        workType: { select: { id: true, name: true } },
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
  ): Promise<AllowedAppPresetDetailDto> {
    await this.ensureValidPlatformData();
    await this.findOne(id, scopeOrganizationIds);

    this.ensureOrganizationInScope(dto.organizationId, scopeOrganizationIds);

    await this.validateAppsExist(dto.appIds);

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
        platform: 'both',
        organizationId: dto.organizationId,
        workTypeId: dto.workTypeId,
      },
      include: {
        organization: { select: { id: true, name: true } },
        workType: { select: { id: true, name: true } },
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

    await this.notifyPoliciesByPreset(id);

    return this.toDetailDto(preset);
  }

  async remove(id: string, scopeOrganizationIds?: string[]): Promise<void> {
    await this.ensureValidPlatformData();

    const preset = await this.prisma.allowedAppPreset.findUnique({
      where: { id },
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
      await tx.allowedAppPreset.delete({ where: { id } });

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
  ): Promise<AllowedAppPresetDetailDto> {
    await this.ensureValidPlatformData();
    const preset = await this.findOne(id, scopeOrganizationIds);
    await this.validateAppsExist(appIds);

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

    return this.findOne(id);
  }

  async removeApps(
    id: string,
    appIds: string[],
    scopeOrganizationIds?: string[],
  ): Promise<AllowedAppPresetDetailDto> {
    await this.ensureValidPlatformData();

    await this.findOne(id, scopeOrganizationIds);

    await this.prisma.allowedAppPresetItem.deleteMany({
      where: {
        presetId: id,
        allowedAppId: { in: appIds },
      },
    });

    await this.notifyPoliciesByPreset(id);

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
      where: { organizationId },
      include: {
        organization: { select: { id: true, name: true } },
        workType: { select: { id: true, name: true } },
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
        where: scopeOrganizationIds ? { organizationId: { in: scopeOrganizationIds } } : undefined,
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
    return toAllowedAppPresetResponseDto(preset);
  }

  private toDetailDto(preset: any): AllowedAppPresetDetailDto {
    return toAllowedAppPresetDetailDto(preset, (platform) => this.normalizePlatform(platform));
  }
}
