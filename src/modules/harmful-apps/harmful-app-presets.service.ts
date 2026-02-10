import { Injectable, NotFoundException } from '@nestjs/common';
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
  constructor(private prisma: PrismaService) {}

  async create(dto: CreateHarmfulAppPresetDto): Promise<HarmfulAppPresetDetailDto> {
    const preset = await this.prisma.harmfulAppPreset.create({
      data: {
        name: dto.name,
        description: dto.description,
        platform: dto.platform || 'android',
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

  async findAll(filter: HarmfulAppPresetFilterDto): Promise<HarmfulAppPresetListResponseDto> {
    const page = filter.page || 1;
    const limit = filter.limit || 20;
    const skip = (page - 1) * limit;

    const where: any = {};

    if (filter.search) {
      where.name = { contains: filter.search, mode: 'insensitive' };
    }

    if (filter.organizationId) {
      where.organizationId = filter.organizationId;
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

  async findOne(id: string): Promise<HarmfulAppPresetDetailDto> {
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

    return this.toDetailDto(preset);
  }

  async update(id: string, dto: UpdateHarmfulAppPresetDto): Promise<HarmfulAppPresetDetailDto> {
    await this.findOne(id);

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
        platform: dto.platform,
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

  async remove(id: string): Promise<void> {
    await this.findOne(id);

    await this.prisma.harmfulAppPreset.delete({
      where: { id },
    });
  }

  async addApps(id: string, appIds: string[]): Promise<HarmfulAppPresetDetailDto> {
    await this.findOne(id);

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

  async removeApps(id: string, appIds: string[]): Promise<HarmfulAppPresetDetailDto> {
    await this.findOne(id);

    await this.prisma.harmfulAppPresetItem.deleteMany({
      where: {
        presetId: id,
        harmfulAppId: { in: appIds },
      },
    });

    return this.findOne(id);
  }

  async findByOrganization(organizationId: string): Promise<HarmfulAppPresetResponseDto[]> {
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

  async getStats(): Promise<HarmfulAppStatsDto> {
    const [totalApps, globalApps, totalPresets, categoryStats, platformStats] = await Promise.all([
      this.prisma.harmfulApp.count(),
      this.prisma.harmfulApp.count({ where: { isGlobal: true } }),
      this.prisma.harmfulAppPreset.count(),
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
      platform: preset.platform || 'android',
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
        platform: item.harmfulApp.platform || 'android',
        iconUrl: item.harmfulApp.iconUrl,
        isGlobal: item.harmfulApp.isGlobal,
        presetCount: 0,
        createdAt: item.harmfulApp.createdAt,
        updatedAt: item.harmfulApp.updatedAt,
      })) || [],
    };
  }
}
