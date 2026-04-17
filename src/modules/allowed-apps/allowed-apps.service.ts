import { Injectable, NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { AuditAction, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ControlPoliciesService } from '../control-policies/control-policies.service';
import { toAllowedAppResponseDto } from './allowed-apps.mapper';
import {
  CreateAllowedAppDto,
  UpdateAllowedAppDto,
  AllowedAppResponseDto,
  AllowedAppFilterDto,
  AllowedAppListResponseDto,
  RefreshAllowedAppIconsDto,
  RefreshAllowedAppIconsResponseDto,
} from './dto';

@Injectable()
export class AllowedAppsService {
  private readonly validPlatforms = ['android', 'ios'] as const;
  private platformsNormalized = false;
  private readonly refreshConcurrency = 5;

  constructor(
    private prisma: PrismaService,
    private readonly controlPoliciesService: ControlPoliciesService,
  ) {}

  private normalizePackageName(packageName: string): string {
    return packageName.trim();
  }

  private normalizePlatform(platform?: string): 'android' | 'ios' {
    return platform === 'ios' ? 'ios' : 'android';
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
        data: { platform: 'android' },
      }),
    ]);

    this.platformsNormalized = true;
  }

  async create(dto: CreateAllowedAppDto, actorUserId?: string): Promise<AllowedAppResponseDto> {
    await this.ensureValidPlatformData();

    const normalizedPackageName = this.normalizePackageName(dto.packageName);

    // 패키지 이름 중복 체크
    const existing = await this.prisma.allowedApp.findFirst({
      where: {
        packageName: {
          equals: normalizedPackageName,
          mode: 'insensitive',
        },
      },
    });

    if (existing) {
      throw new ConflictException(`이미 등록된 패키지입니다: ${normalizedPackageName}`);
    }

    const app = await this.prisma.allowedApp.create({
      data: {
        name: dto.name,
        packageName: normalizedPackageName,
        category: dto.category,
        platform: this.normalizePlatform(dto.platform),
        iconUrl: dto.iconUrl,
        isGlobal: dto.isGlobal ?? false,
        createdById: actorUserId,
        updatedById: actorUserId,
      },
      include: {
        _count: {
          select: { presetItems: true },
        },
      },
    });

    return this.toResponseDto(app);
  }

  async findAll(
    filter: AllowedAppFilterDto,
    scopeOrganizationIds?: string[],
  ): Promise<AllowedAppListResponseDto> {
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
      this.prisma.allowedApp.findMany({
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
      this.prisma.allowedApp.count({ where }),
    ]);

    // 허용앱별 설치 직원 수 집계 (고유 직원 수)
    const appIds = data.map((app) => app.id);
    const installedCountMap = await this.getInstalledCountByApps(appIds, scopeOrganizationIds);

    return {
      data: data.map((app) => this.toResponseDto(app, installedCountMap.get(app.id) || 0)),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async findOne(id: string, scopeOrganizationIds?: string[]): Promise<AllowedAppResponseDto> {
    await this.ensureValidPlatformData();

    const app = await this.prisma.allowedApp.findUnique({
      where: { id },
      include: {
        _count: {
          select: { presetItems: true },
        },
      },
    });

    if (!app) {
      throw new NotFoundException('허용앱을 찾을 수 없습니다.');
    }

    const installedCountMap = await this.getInstalledCountByApps([id], scopeOrganizationIds);
    return this.toResponseDto(app, installedCountMap.get(id) || 0);
  }

  async findByPackageName(
    packageName: string,
    scopeOrganizationIds?: string[],
  ): Promise<AllowedAppResponseDto> {
    await this.ensureValidPlatformData();

    const normalizedPackageName = this.normalizePackageName(packageName);

    let app = await this.prisma.allowedApp.findUnique({
      where: { packageName: normalizedPackageName },
      include: {
        _count: {
          select: { presetItems: true },
        },
      },
    });

    if (!app) {
      app = await this.prisma.allowedApp.findFirst({
        where: {
          packageName: {
            equals: normalizedPackageName,
            mode: 'insensitive',
          },
        },
        orderBy: { updatedAt: 'desc' },
        include: {
          _count: {
            select: { presetItems: true },
          },
        },
      });
    }

    if (!app) {
      throw new NotFoundException('허용앱을 찾을 수 없습니다.');
    }

    const installedCountMap = await this.getInstalledCountByApps([app.id], scopeOrganizationIds);
    return this.toResponseDto(app, installedCountMap.get(app.id) || 0);
  }

  async update(id: string, dto: UpdateAllowedAppDto, actorUserId?: string): Promise<AllowedAppResponseDto> {
    await this.ensureValidPlatformData();

    await this.findOne(id);

    const updateData: any = { ...dto };
    if (dto.platform !== undefined) {
      updateData.platform = this.normalizePlatform(dto.platform);
    }

    const normalizedPackageName = dto.packageName ? this.normalizePackageName(dto.packageName) : undefined;
    if (normalizedPackageName) {
      updateData.packageName = normalizedPackageName;
    }

    // 패키지 이름 변경 시 중복 체크
    if (normalizedPackageName) {
      const existing = await this.prisma.allowedApp.findFirst({
        where: {
          packageName: {
            equals: normalizedPackageName,
            mode: 'insensitive',
          },
          NOT: { id },
        },
      });

      if (existing) {
        throw new ConflictException(`이미 등록된 패키지입니다: ${normalizedPackageName}`);
      }
    }

    const app = await this.prisma.allowedApp.update({
      where: { id },
      data: {
        ...updateData,
        updatedById: actorUserId,
      },
      include: {
        _count: {
          select: { presetItems: true },
        },
      },
    });

    await this.notifyPoliciesByAllowedApp(id);

    if (actorUserId) {
      void this.prisma.auditLog.create({
        data: {
          accountId: actorUserId,
          action: AuditAction.UPDATE,
          resourceType: 'AllowedApp',
          resourceId: app.id,
          resourceName: app.name,
          changesAfter: {
            allowedAppId: app.id,
            updatedById: actorUserId,
          },
        },
      }).catch(() => undefined);
    }

    const installedCountMap = await this.getInstalledCountByApps([id]);
    return this.toResponseDto(app, installedCountMap.get(id) || 0);
  }

  async refreshIcons(dto: RefreshAllowedAppIconsDto): Promise<RefreshAllowedAppIconsResponseDto> {
    await this.ensureValidPlatformData();

    const where: any = {};
    if (dto.platform && dto.platform !== 'all') {
      where.platform = dto.platform;
    }
    if (dto.appIds && dto.appIds.length > 0) {
      where.id = { in: dto.appIds };
    }

    const apps = await this.prisma.allowedApp.findMany({
      where,
      select: {
        id: true,
        packageName: true,
        platform: true,
        iconUrl: true,
      },
      orderBy: { updatedAt: 'asc' },
    });

    const results: RefreshAllowedAppIconsResponseDto['results'] = [];
    let cursor = 0;

    const worker = async () => {
      while (cursor < apps.length) {
        const index = cursor++;
        const app = apps[index];
        if (!app) continue;

        const normalizedPlatform = this.normalizePlatform(app.platform);
        const previousIconUrl = app.iconUrl || null;

        try {
          const fetchedIconUrl = normalizedPlatform === 'ios'
            ? await this.fetchIosIconUrl(app.packageName)
            : await this.fetchAndroidIconUrl(app.packageName);

          if (!fetchedIconUrl) {
            results.push({
              id: app.id,
              packageName: app.packageName,
              platform: normalizedPlatform,
              previousIconUrl,
              iconUrl: previousIconUrl,
              status: 'missing',
              message: '스토어에서 아이콘을 찾지 못했습니다.',
            });
            continue;
          }

          if (previousIconUrl !== fetchedIconUrl) {
            await this.prisma.allowedApp.update({
              where: { id: app.id },
              data: { iconUrl: fetchedIconUrl },
            });

            results.push({
              id: app.id,
              packageName: app.packageName,
              platform: normalizedPlatform,
              previousIconUrl,
              iconUrl: fetchedIconUrl,
              status: 'updated',
            });
            continue;
          }

          results.push({
            id: app.id,
            packageName: app.packageName,
            platform: normalizedPlatform,
            previousIconUrl,
            iconUrl: fetchedIconUrl,
            status: 'unchanged',
          });
        } catch (error) {
          results.push({
            id: app.id,
            packageName: app.packageName,
            platform: normalizedPlatform,
            previousIconUrl,
            iconUrl: previousIconUrl,
            status: 'failed',
            message: error instanceof Error ? error.message : '알 수 없는 오류',
          });
        }
      }
    };

    await Promise.all(
      Array.from({ length: Math.min(this.refreshConcurrency, Math.max(apps.length, 1)) }, () => worker()),
    );

    const updated = results.filter((r) => r.status === 'updated').length;
    const unchanged = results.filter((r) => r.status === 'unchanged').length;
    const missing = results.filter((r) => r.status === 'missing').length;
    const failed = results.filter((r) => r.status === 'failed').length;

    return {
      total: apps.length,
      refreshed: updated + unchanged,
      updated,
      unchanged,
      missing,
      failed,
      results,
    };
  }

  async remove(id: string): Promise<void> {
    await this.ensureValidPlatformData();

    const app = await this.prisma.allowedApp.findUnique({
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
      throw new NotFoundException('허용앱을 찾을 수 없습니다.');
    }

    if (app._count.presetItems > 0) {
      throw new BadRequestException('프리셋에서 사용 중인 허용앱은 삭제할 수 없습니다. 프리셋에서 먼저 제거해주세요.');
    }

    await this.prisma.allowedApp.delete({
      where: { id },
    });
  }

  async getCategories(): Promise<string[]> {
    await this.ensureValidPlatformData();

    const result = await this.prisma.allowedApp.groupBy({
      by: ['category'],
      where: {
        category: { not: null },
      },
    });

    return result.map((r) => r.category).filter((c): c is string => c !== null);
  }

  async toggleGlobal(id: string, actorUserId?: string): Promise<AllowedAppResponseDto> {
    await this.ensureValidPlatformData();

    const app = await this.findOne(id);

    const updated = await this.prisma.allowedApp.update({
      where: { id },
      data: {
        isGlobal: !app.isGlobal,
        updatedById: actorUserId,
      },
      include: {
        _count: {
          select: { presetItems: true },
        },
      },
    });

    await this.notifyPoliciesByAllowedApp(id);

    if (actorUserId) {
      void this.prisma.auditLog.create({
        data: {
          accountId: actorUserId,
          action: AuditAction.UPDATE,
          resourceType: 'AllowedApp',
          resourceId: updated.id,
          resourceName: updated.name,
          changesAfter: {
            allowedAppId: updated.id,
            isGlobal: updated.isGlobal,
            updatedById: actorUserId,
          },
        },
      }).catch(() => undefined);
    }

    const installedCountMap = await this.getInstalledCountByApps([id]);
    return this.toResponseDto(updated, installedCountMap.get(id) || 0);
  }

  private async notifyPoliciesByAllowedApp(allowedAppId: string): Promise<void> {
    const presetItems = await this.prisma.allowedAppPresetItem.findMany({
      where: { allowedAppId },
      select: { presetId: true },
    });

    const presetIds = Array.from(new Set(presetItems.map((item) => item.presetId)));
    if (presetIds.length === 0) {
      return;
    }

    const impactedPolicies = await this.prisma.controlPolicyAllowedApp.findMany({
      where: {
        presetId: { in: presetIds },
      },
      select: { policyId: true },
    });

    await this.controlPoliciesService.notifyPoliciesChanged(
      impactedPolicies.map((item) => item.policyId),
      'update',
    );
  }

  /**
    * 허용앱 ID 목록에 대해 설치한 고유 직원 수를 집계합니다.
   * InstalledApp → Device → Employee 관계를 통해 distinct employeeId를 카운트합니다.
   */
  private async getInstalledCountByApps(
    appIds: string[],
    scopeOrganizationIds?: string[],
  ): Promise<Map<string, number>> {
    if (appIds.length === 0) return new Map();
    if (scopeOrganizationIds && scopeOrganizationIds.length === 0) return new Map();

    try {
      const scopeCondition = scopeOrganizationIds && scopeOrganizationIds.length > 0
        ? Prisma.sql`AND COALESCE(d."organizationId", e."organizationId") IN (${Prisma.join(scopeOrganizationIds)})`
        : Prisma.empty;

      const results: Array<{ allowedAppId: string; count: bigint }> = await this.prisma.$queryRaw`
        SELECT ha."id" AS "allowedAppId", COUNT(DISTINCT d."employeeId") AS count
        FROM allowed_apps ha
        LEFT JOIN installed_apps ia
          ON LOWER(ia."packageName") = LOWER(ha."packageName")
          AND ia."isInstalled" = true
        LEFT JOIN devices d
          ON d."id" = ia."deviceId"
          AND d."employeeId" IS NOT NULL
        LEFT JOIN employees e
          ON e."id" = d."employeeId"
        WHERE ha."id" IN (${Prisma.join(appIds)})
        ${scopeCondition}
        GROUP BY ha."id"
      `;

      const map = new Map<string, number>();
      for (const r of results) {
        map.set(r.allowedAppId, Number(r.count));
      }
      return map;
    } catch (error) {
      console.error('getInstalledCountByApps error:', error);
      return new Map();
    }
  }

  private async fetchAndroidIconUrl(packageName: string): Promise<string | null> {
    const url = `https://play.google.com/store/apps/details?id=${encodeURIComponent(packageName)}&hl=ko&gl=KR`;
    const html = await this.fetchText(url);

    const ogImageMatch = html.match(/<meta\s+property="og:image"\s+content="([^"]+)"\s*\/?\s*>/i);
    if (ogImageMatch?.[1]) {
      return ogImageMatch[1].replace(/&amp;/g, '&');
    }

    const imgSrcMatch = html.match(/"iconUrl":"(https:[^"]+)"/i);
    if (imgSrcMatch?.[1]) {
      return imgSrcMatch[1].replace(/\\u003d/g, '=').replace(/\\u0026/g, '&');
    }

    return null;
  }

  private async fetchIosIconUrl(bundleId: string): Promise<string | null> {
    const url = `https://itunes.apple.com/lookup?bundleId=${encodeURIComponent(bundleId)}`;
    const json = await this.fetchJson<any>(url);
    const first = Array.isArray(json?.results) ? json.results[0] : null;
    return first?.artworkUrl512 || first?.artworkUrl100 || null;
  }

  private async fetchText(url: string): Promise<string> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    try {
      const response = await fetch(url, {
        method: 'GET',
        signal: controller.signal,
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      return await response.text();
    } finally {
      clearTimeout(timeout);
    }
  }

  private async fetchJson<T>(url: string): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    try {
      const response = await fetch(url, {
        method: 'GET',
        signal: controller.signal,
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
          Accept: 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      return (await response.json()) as T;
    } finally {
      clearTimeout(timeout);
    }
  }

  private toResponseDto(app: any, installedCount: number = 0): AllowedAppResponseDto {
    return toAllowedAppResponseDto(app, (platform) => this.normalizePlatform(platform), installedCount);
  }
}
