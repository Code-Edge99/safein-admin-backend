import { Injectable, NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CreateHarmfulAppDto,
  UpdateHarmfulAppDto,
  HarmfulAppResponseDto,
  HarmfulAppFilterDto,
  HarmfulAppListResponseDto,
} from './dto';

@Injectable()
export class HarmfulAppsService {
  private readonly validPlatforms = ['android', 'ios'] as const;
  private platformsNormalized = false;

  constructor(private prisma: PrismaService) {}

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

  async create(dto: CreateHarmfulAppDto): Promise<HarmfulAppResponseDto> {
    await this.ensureValidPlatformData();

    // 패키지 이름 중복 체크
    const existing = await this.prisma.harmfulApp.findUnique({
      where: { packageName: dto.packageName },
    });

    if (existing) {
      throw new ConflictException(`이미 등록된 패키지입니다: ${dto.packageName}`);
    }

    const app = await this.prisma.harmfulApp.create({
      data: {
        name: dto.name,
        packageName: dto.packageName,
        category: dto.category,
        platform: this.normalizePlatform(dto.platform),
        iconUrl: dto.iconUrl,
        isGlobal: dto.isGlobal ?? false,
      },
      include: {
        _count: {
          select: { presetItems: true },
        },
      },
    });

    return this.toResponseDto(app);
  }

  async findAll(filter: HarmfulAppFilterDto): Promise<HarmfulAppListResponseDto> {
    await this.ensureValidPlatformData();

    const page = filter.page || 1;
    const limit = filter.limit || 20;
    const skip = (page - 1) * limit;

    const where: any = {};

    if (filter.search) {
      where.OR = [
        { name: { contains: filter.search, mode: 'insensitive' } },
        { packageName: { contains: filter.search, mode: 'insensitive' } },
      ];
    }

    if (filter.category) {
      where.category = filter.category;
    }

    if (filter.isGlobal !== undefined) {
      where.isGlobal = filter.isGlobal;
    }

    if (filter.platform && filter.platform !== 'all') {
      where.platform = filter.platform;
    }

    const [data, total] = await Promise.all([
      this.prisma.harmfulApp.findMany({
        where,
        skip,
        take: limit,
        include: {
          _count: {
            select: { presetItems: true },
          },
        },
        orderBy: { name: 'asc' },
      }),
      this.prisma.harmfulApp.count({ where }),
    ]);

    // 유해앱별 설치 직원 수 집계 (고유 직원 수)
    const appIds = data.map((app) => app.id);
    const installedCountMap = await this.getInstalledCountByApps(appIds);

    return {
      data: data.map((app) => this.toResponseDto(app, installedCountMap.get(app.id) || 0)),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async findOne(id: string): Promise<HarmfulAppResponseDto> {
    await this.ensureValidPlatformData();

    const app = await this.prisma.harmfulApp.findUnique({
      where: { id },
      include: {
        _count: {
          select: { presetItems: true },
        },
      },
    });

    if (!app) {
      throw new NotFoundException('유해 앱을 찾을 수 없습니다.');
    }

    const installedCountMap = await this.getInstalledCountByApps([id]);
    return this.toResponseDto(app, installedCountMap.get(id) || 0);
  }

  async findByPackageName(packageName: string): Promise<HarmfulAppResponseDto> {
    await this.ensureValidPlatformData();

    const app = await this.prisma.harmfulApp.findUnique({
      where: { packageName },
      include: {
        _count: {
          select: { presetItems: true },
        },
      },
    });

    if (!app) {
      throw new NotFoundException('유해 앱을 찾을 수 없습니다.');
    }

    return this.toResponseDto(app);
  }

  async update(id: string, dto: UpdateHarmfulAppDto): Promise<HarmfulAppResponseDto> {
    await this.ensureValidPlatformData();

    await this.findOne(id);

    const updateData: UpdateHarmfulAppDto = { ...dto };
    if (dto.platform !== undefined) {
      updateData.platform = this.normalizePlatform(dto.platform);
    }

    // 패키지 이름 변경 시 중복 체크
    if (dto.packageName) {
      const existing = await this.prisma.harmfulApp.findFirst({
        where: {
          packageName: dto.packageName,
          NOT: { id },
        },
      });

      if (existing) {
        throw new ConflictException(`이미 등록된 패키지입니다: ${dto.packageName}`);
      }
    }

    const app = await this.prisma.harmfulApp.update({
      where: { id },
      data: updateData,
      include: {
        _count: {
          select: { presetItems: true },
        },
      },
    });

    const installedCountMap = await this.getInstalledCountByApps([id]);
    return this.toResponseDto(app, installedCountMap.get(id) || 0);
  }

  async remove(id: string): Promise<void> {
    await this.ensureValidPlatformData();

    const app = await this.prisma.harmfulApp.findUnique({
      where: { id },
      include: {
        _count: {
          select: {
            presetItems: true,
          },
        },
      },
    });

    if (!app) {
      throw new NotFoundException('유해 앱을 찾을 수 없습니다.');
    }

    if (app._count.presetItems > 0) {
      throw new BadRequestException('프리셋에서 사용 중인 유해 앱은 삭제할 수 없습니다. 프리셋에서 먼저 제거해주세요.');
    }

    await this.prisma.harmfulApp.delete({
      where: { id },
    });
  }

  async getCategories(): Promise<string[]> {
    await this.ensureValidPlatformData();

    const result = await this.prisma.harmfulApp.groupBy({
      by: ['category'],
      where: {
        category: { not: null },
      },
    });

    return result.map((r) => r.category).filter((c): c is string => c !== null);
  }

  async toggleGlobal(id: string): Promise<HarmfulAppResponseDto> {
    await this.ensureValidPlatformData();

    const app = await this.findOne(id);

    const updated = await this.prisma.harmfulApp.update({
      where: { id },
      data: { isGlobal: !app.isGlobal },
      include: {
        _count: {
          select: { presetItems: true },
        },
      },
    });

    const installedCountMap = await this.getInstalledCountByApps([id]);
    return this.toResponseDto(updated, installedCountMap.get(id) || 0);
  }

  /**
   * 유해앱 ID 목록에 대해 설치한 고유 직원 수를 집계합니다.
   * InstalledApp → Device → Employee 관계를 통해 distinct employeeId를 카운트합니다.
   */
  private async getInstalledCountByApps(appIds: string[]): Promise<Map<string, number>> {
    if (appIds.length === 0) return new Map();

    try {
      const results: Array<{ harmfulAppId: string; count: bigint }> = await this.prisma.$queryRaw`
        SELECT ia."harmfulAppId", COUNT(DISTINCT d."employeeId") as count
        FROM installed_apps ia
        JOIN devices d ON d.id = ia."deviceId"
        WHERE ia."harmfulAppId" IN (${Prisma.join(appIds)})
          AND ia."isInstalled" = true
          AND d."employeeId" IS NOT NULL
        GROUP BY ia."harmfulAppId"
      `;

      const map = new Map<string, number>();
      for (const r of results) {
        map.set(r.harmfulAppId, Number(r.count));
      }
      return map;
    } catch (error) {
      console.error('getInstalledCountByApps error:', error);
      return new Map();
    }
  }

  private toResponseDto(app: any, installedCount: number = 0): HarmfulAppResponseDto {
    return {
      id: app.id,
      name: app.name,
      packageName: app.packageName,
      category: app.category,
      platform: this.normalizePlatform(app.platform),
      iconUrl: app.iconUrl,
      isGlobal: app.isGlobal,
      presetCount: app._count?.presetItems || 0,
      installedCount,
      createdAt: app.createdAt,
      updatedAt: app.updatedAt,
    };
  }
}
