import { Injectable, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CreateHarmfulAppPresetDto,
  UpdateHarmfulAppPresetDto,
  HarmfulAppPresetResponseDto,
  HarmfulAppPresetDetailDto,
  HarmfulAppPresetFilterDto,
  HarmfulAppPresetListResponseDto,
  HarmfulAppStatsDto,
} from './dto';

@Injectable()
export class HarmfulAppPresetsService {
  private readonly validPlatforms = ['android', 'ios'] as const;
  private platformsNormalized = false;

  constructor(private prisma: PrismaService) {}

  private ensureOrganizationInScope(
    organizationId: string | undefined,
    scopeOrganizationIds?: string[],
  ): void {
    if (!organizationId || !scopeOrganizationIds) return;
    if (!scopeOrganizationIds.includes(organizationId)) {
      throw new ForbiddenException('요청한 조직은 접근 권한 범위를 벗어났습니다.');
    }
  }

  private assertPresetInScope(
    preset: { organizationId: string },
    scopeOrganizationIds?: string[],
  ): void {
    if (!scopeOrganizationIds) return;
    if (!scopeOrganizationIds.includes(preset.organizationId)) {
      throw new NotFoundException('유해 앱 프리셋을 찾을 수 없습니다.');
    }
  }

  private normalizePlatform(platform?: string): 'android' | 'ios' {
    return platform === 'ios' ? 'ios' : 'android';
  }

  private async ensureValidPlatformData(): Promise<void> {
    if (this.platformsNormalized) return;

    await Promise.all([
      this.prisma.harmfulApp.updateMany({
        where: { platform: { notIn: [...this.validPlatforms] } },
        data: { platform: 'android' },
      }),
      this.prisma.harmfulAppPreset.updateMany({
        where: { platform: { notIn: [...this.validPlatforms] } },
        data: { platform: 'android' },
      }),
    ]);

    this.platformsNormalized = true;
  }

  private async validateAppsPlatform(appIds: string[] | undefined, platform: 'android' | 'ios'): Promise<void> {
    if (!appIds || appIds.length === 0) return;

    const apps = await this.prisma.harmfulApp.findMany({
      where: { id: { in: appIds } },
      select: { id: true, name: true, platform: true },
    });

    const foundIds = new Set(apps.map((app) => app.id));
    const missingIds = appIds.filter((id) => !foundIds.has(id));
    if (missingIds.length > 0) {
      throw new NotFoundException(`존재하지 않는 유해 앱이 포함되어 있습니다: ${missingIds.join(', ')}`);
    }

    const invalidApps = apps.filter((app) => this.normalizePlatform(app.platform) !== platform);
    if (invalidApps.length > 0) {
      throw new BadRequestException(
        `프리셋 플랫폼(${platform})과 일치하지 않는 앱이 포함되어 있습니다: ${invalidApps
          .map((app) => app.name)
          .join(', ')}`,
      );
    }
  }

  private async deactivatePoliciesWithoutConditions(tx: any, policyIds: string[]): Promise<void> {
    const uniquePolicyIds = Array.from(new Set(policyIds.filter(Boolean)));
    if (uniquePolicyIds.length === 0) return;

    const policies = await tx.controlPolicy.findMany({
      where: { id: { in: uniquePolicyIds } },
      select: {
        id: true,
        _count: {
          select: {
            zones: true,
            timePolicies: true,
            behaviors: true,
            harmfulApps: true,
          },
        },
      },
    });

    const emptyPolicyIds = policies
      .filter(
        (p: any) =>
          p._count.zones + p._count.timePolicies + p._count.behaviors + p._count.harmfulApps === 0,
      )
      .map((p: any) => p.id);

    if (emptyPolicyIds.length === 0) return;

    await tx.controlPolicy.updateMany({
      where: { id: { in: emptyPolicyIds } },
      data: { isActive: false },
    });

    await tx.controlPolicyEmployee.deleteMany({
      where: { policyId: { in: emptyPolicyIds } },
    });
  }

  async create(dto: CreateHarmfulAppPresetDto, scopeOrganizationIds?: string[]): Promise<HarmfulAppPresetDetailDto> {
    await this.ensureValidPlatformData();

    this.ensureOrganizationInScope(dto.organizationId, scopeOrganizationIds);

    const platform = this.normalizePlatform(dto.platform);
    await this.validateAppsPlatform(dto.appIds, platform);

    const preset = await this.prisma.harmfulAppPreset.create({
      data: {
        name: dto.name,
        description: dto.description,
        platform,
        organizationId: dto.organizationId,
        workTypeId: dto.workTypeId,
        items: dto.appIds?.length
          ? {
              create: dto.appIds.map((appId) => ({
                harmfulApp: { connect: { id: appId } },
              })),
            }
          : undefined,
      },
      include: {
        organization: { select: { id: true, name: true } },
        workType: { select: { id: true, name: true } },
        items: {
          include: {
            harmfulApp: true,
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
    filter: HarmfulAppPresetFilterDto,
    scopeOrganizationIds?: string[],
  ): Promise<HarmfulAppPresetListResponseDto> {
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

    if (filter.platform && filter.platform !== 'all') {
      where.platform = filter.platform;
    }

    const [data, total] = await Promise.all([
      this.prisma.harmfulAppPreset.findMany({
        where,
        skip,
        take: limit,
        include: {
          organization: { select: { id: true, name: true } },
          workType: { select: { id: true, name: true } },
          items: {
            include: {
              harmfulApp: true,
            },
          },
          _count: {
            select: { items: true, policyPresets: true },
          },
        },
        orderBy: { name: 'asc' },
      }),
      this.prisma.harmfulAppPreset.count({ where }),
    ]);

    return {
      data: data.map((preset) => this.toDetailDto(preset)),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async findOne(id: string, scopeOrganizationIds?: string[]): Promise<HarmfulAppPresetDetailDto> {
    await this.ensureValidPlatformData();

    const preset = await this.prisma.harmfulAppPreset.findUnique({
      where: { id },
      include: {
        organization: { select: { id: true, name: true } },
        workType: { select: { id: true, name: true } },
        items: {
          include: {
            harmfulApp: true,
          },
        },
        _count: {
          select: { policyPresets: true },
        },
      },
    });

    if (!preset) {
      throw new NotFoundException('유해 앱 프리셋을 찾을 수 없습니다.');
    }

    this.assertPresetInScope(preset, scopeOrganizationIds);

    return this.toDetailDto(preset);
  }

  async update(
    id: string,
    dto: UpdateHarmfulAppPresetDto,
    scopeOrganizationIds?: string[],
  ): Promise<HarmfulAppPresetDetailDto> {
    await this.ensureValidPlatformData();
    const existing = await this.findOne(id, scopeOrganizationIds);

    this.ensureOrganizationInScope(dto.organizationId, scopeOrganizationIds);

    const platform = this.normalizePlatform(dto.platform ?? existing.platform);
    await this.validateAppsPlatform(dto.appIds, platform);

    // 앱 목록이 변경되는 경우 처리
    if (dto.appIds !== undefined) {
      // 기존 연결 삭제
      await this.prisma.harmfulAppPresetItem.deleteMany({
        where: { presetId: id },
      });

      // 새 연결 생성
      if (dto.appIds.length > 0) {
        await this.prisma.harmfulAppPresetItem.createMany({
          data: dto.appIds.map((appId) => ({
            presetId: id,
            harmfulAppId: appId,
          })),
        });
      }
    }

    const preset = await this.prisma.harmfulAppPreset.update({
      where: { id },
      data: {
        name: dto.name,
        description: dto.description,
        platform,
        organizationId: dto.organizationId,
        workTypeId: dto.workTypeId,
      },
      include: {
        organization: { select: { id: true, name: true } },
        workType: { select: { id: true, name: true } },
        items: {
          include: {
            harmfulApp: true,
          },
        },
        _count: {
          select: { policyPresets: true },
        },
      },
    });

    return this.toDetailDto(preset);
  }

  async remove(id: string, scopeOrganizationIds?: string[]): Promise<void> {
    await this.ensureValidPlatformData();

    const preset = await this.prisma.harmfulAppPreset.findUnique({
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
      throw new NotFoundException('유해 앱 프리셋을 찾을 수 없습니다.');
    }

    this.assertPresetInScope(preset, scopeOrganizationIds);

    await this.prisma.$transaction(async (tx) => {
      const impacted = await tx.controlPolicyHarmfulApp.findMany({
        where: { presetId: id },
        select: { policyId: true },
      });

      await tx.controlPolicyHarmfulApp.deleteMany({ where: { presetId: id } });
      await tx.harmfulAppPreset.delete({ where: { id } });

      await this.deactivatePoliciesWithoutConditions(
        tx,
        impacted.map((item: any) => item.policyId),
      );
    });
  }

  async addApps(
    id: string,
    appIds: string[],
    scopeOrganizationIds?: string[],
  ): Promise<HarmfulAppPresetDetailDto> {
    await this.ensureValidPlatformData();
    const preset = await this.findOne(id, scopeOrganizationIds);
    const platform = this.normalizePlatform(preset.platform);
    await this.validateAppsPlatform(appIds, platform);

    // 기존에 없는 앱만 추가
    const existingItems = await this.prisma.harmfulAppPresetItem.findMany({
      where: { presetId: id },
      select: { harmfulAppId: true },
    });

    const existingAppIds = new Set(existingItems.map((item) => item.harmfulAppId));
    const newAppIds = appIds.filter((appId) => !existingAppIds.has(appId));

    if (newAppIds.length > 0) {
      await this.prisma.harmfulAppPresetItem.createMany({
        data: newAppIds.map((appId) => ({
          presetId: id,
          harmfulAppId: appId,
        })),
      });
    }

    return this.findOne(id);
  }

  async removeApps(
    id: string,
    appIds: string[],
    scopeOrganizationIds?: string[],
  ): Promise<HarmfulAppPresetDetailDto> {
    await this.ensureValidPlatformData();

    await this.findOne(id, scopeOrganizationIds);

    await this.prisma.harmfulAppPresetItem.deleteMany({
      where: {
        presetId: id,
        harmfulAppId: { in: appIds },
      },
    });

    return this.findOne(id, scopeOrganizationIds);
  }

  async findByOrganization(
    organizationId: string,
    scopeOrganizationIds?: string[],
  ): Promise<HarmfulAppPresetResponseDto[]> {
    await this.ensureValidPlatformData();

    this.ensureOrganizationInScope(organizationId, scopeOrganizationIds);

    const presets = await this.prisma.harmfulAppPreset.findMany({
      where: { organizationId },
      include: {
        organization: { select: { id: true, name: true } },
        workType: { select: { id: true, name: true } },
        items: {
          include: {
            harmfulApp: true,
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

  async getStats(scopeOrganizationIds?: string[]): Promise<HarmfulAppStatsDto> {
    await this.ensureValidPlatformData();

    const [totalApps, globalApps, totalPresets, categoryStats, platformStats] = await Promise.all([
      this.prisma.harmfulApp.count(),
      this.prisma.harmfulApp.count({ where: { isGlobal: true } }),
      this.prisma.harmfulAppPreset.count({
        where: scopeOrganizationIds ? { organizationId: { in: scopeOrganizationIds } } : undefined,
      }),
      this.prisma.harmfulApp.groupBy({
        by: ['category'],
        _count: true,
      }),
      this.prisma.harmfulApp.groupBy({
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

  private toResponseDto(preset: any): HarmfulAppPresetResponseDto {
    return {
      id: preset.id,
      name: preset.name,
      description: preset.description,
      platform: this.normalizePlatform(preset.platform),
      organization: preset.organization,
      workType: preset.workType,
      appCount: preset._count?.items || 0,
      policyCount: preset._count?.policyPresets || 0,
      createdAt: preset.createdAt,
      updatedAt: preset.updatedAt,
    };
  }

  private toDetailDto(preset: any): HarmfulAppPresetDetailDto {
    return {
      ...this.toResponseDto(preset),
      apps: preset.items?.map((item: any) => ({
        id: item.harmfulApp.id,
        name: item.harmfulApp.name,
        packageName: item.harmfulApp.packageName,
        category: item.harmfulApp.category,
        platform: this.normalizePlatform(item.harmfulApp.platform),
        iconUrl: item.harmfulApp.iconUrl,
        isGlobal: item.harmfulApp.isGlobal,
        presetCount: 0,
        createdAt: item.harmfulApp.createdAt,
        updatedAt: item.harmfulApp.updatedAt,
      })) || [],
    };
  }
}
