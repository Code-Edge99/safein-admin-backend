import { Injectable, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { AuditAction } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { preferKstTimestamp } from '../../common/utils/kst-time.util';
import { deactivatePoliciesWithoutConditions } from '../../common/utils/control-policy-cleanup.util';
import { assertOrganizationInScopeOrThrow, ensureOrganizationInScope, assertCompanyOrGroupOrganization } from '../../common/utils/organization-scope.util';
import { ControlPoliciesService } from '../control-policies/control-policies.service';
import { toZoneResponseDto } from './zones.mapper';
import {
  CreateZoneDto,
  UpdateZoneDto,
  ZoneFilterDto,
  ZoneResponseDto,
  ZoneListResponseDto,
  ZoneStatsDto,
  CheckPointInZoneDto,
} from './dto';

@Injectable()
export class ZonesService {
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

  private assertZoneInScope(zone: { organizationId: string }, scopeOrganizationIds?: string[]): void {
    assertOrganizationInScopeOrThrow(zone.organizationId, scopeOrganizationIds, '구역을 찾을 수 없습니다.');
  }

  async create(
    createZoneDto: CreateZoneDto,
    scopeOrganizationIds?: string[],
    actorUserId?: string,
  ): Promise<ZoneResponseDto> {
    const { coordinates, organizationId, type, shape, ...rest } = createZoneDto;

    this.ensureOrganizationInScope(organizationId, scopeOrganizationIds);

    // Validate organization
    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
    });
    if (!org) {
      throw new BadRequestException('현장을 찾을 수 없습니다.');
    }

    await assertCompanyOrGroupOrganization(this.prisma, organizationId);

    // 좌표 정규화: lat/lng 또는 latitude/longitude 모두 수용
    const normalizedCoords = this.normalizeCoordinates(coordinates);
    const geometryMetadata = this.buildZoneGeometryMetadata(
      shape as any,
      normalizedCoords,
      createZoneDto.radius,
    );

    const zone = await this.prisma.zone.create({
      data: {
        ...rest,
        type: type as any,
        shape: shape as any,
        coordinates: normalizedCoords as any,
        ...geometryMetadata,
        organizationId,
        createdById: actorUserId,
        updatedById: actorUserId,
      },
      include: {
        organization: {
          select: { id: true, name: true },
        },
      },
    });

    return this.toResponseDto(zone);
  }

  async findAll(filter: ZoneFilterDto, scopeOrganizationIds?: string[]): Promise<ZoneListResponseDto> {
    const { search, type, organizationId, page = 1, limit = 20 } = filter;
    const skip = (page - 1) * limit;

    const where: any = { deletedAt: null };

    if (search) {
      where.name = { contains: search, mode: 'insensitive' };
    }

    if (type) {
      where.type = type;
    }

    if (organizationId) {
      this.ensureOrganizationInScope(organizationId, scopeOrganizationIds);
      where.organizationId = organizationId;
    } else if (scopeOrganizationIds) {
      where.organizationId = { in: scopeOrganizationIds };
    }

    const [zones, total] = await Promise.all([
      this.prisma.zone.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          organization: {
            select: { id: true, name: true },
          },
        },
      }),
      this.prisma.zone.count({ where }),
    ]);

    return {
      data: zones.map((z) => this.toResponseDto(z)),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async findOne(id: string, scopeOrganizationIds?: string[]): Promise<ZoneResponseDto> {
    const zone = await this.prisma.zone.findFirst({
      where: { id, deletedAt: null },
      include: {
        organization: {
          select: { id: true, name: true },
        },
      },
    });

    if (!zone) {
      throw new NotFoundException('구역을 찾을 수 없습니다.');
    }

    this.assertZoneInScope(zone, scopeOrganizationIds);

    return this.toResponseDto(zone);
  }

  async findByOrganization(
    organizationId: string,
    scopeOrganizationIds?: string[],
  ): Promise<ZoneResponseDto[]> {
    this.ensureOrganizationInScope(organizationId, scopeOrganizationIds);

    const zones = await this.prisma.zone.findMany({
      where: {
        organizationId,
        deletedAt: null,
      },
      include: {
        organization: {
          select: { id: true, name: true },
        },
      },
      orderBy: { name: 'asc' },
    });

    return zones.map((z) => this.toResponseDto(z));
  }

  async update(
    id: string,
    updateZoneDto: UpdateZoneDto,
    scopeOrganizationIds?: string[],
    actorUserId?: string,
  ): Promise<ZoneResponseDto> {
    await this.findOne(id, scopeOrganizationIds);

    const { coordinates, organizationId, ...rest } = updateZoneDto;

    const updateData: any = { ...rest };

    const currentZone = await this.prisma.zone.findFirst({
      where: { id, deletedAt: null },
      select: { shape: true, coordinates: true, radius: true, organizationId: true },
    });

    if (!currentZone) {
      throw new NotFoundException('구역을 찾을 수 없습니다.');
    }

    if (coordinates) {
      updateData.coordinates = this.normalizeCoordinates(coordinates) as any;
    }

    const targetShape = (updateZoneDto.shape ?? currentZone.shape) as any;
    const targetCoordinates = (updateData.coordinates ?? currentZone.coordinates) as any[];
    const targetRadius = updateZoneDto.radius ?? currentZone.radius;
    const geometryMetadata = this.buildZoneGeometryMetadata(
      targetShape,
      this.normalizeCoordinates(targetCoordinates),
      targetRadius ?? undefined,
    );
    Object.assign(updateData, geometryMetadata);

    const targetOrganizationId = organizationId === undefined
      ? currentZone.organizationId
      : organizationId;

    if (!targetOrganizationId) {
      throw new BadRequestException('현장을 찾을 수 없습니다.');
    }

    if (organizationId !== undefined) {
      this.ensureOrganizationInScope(targetOrganizationId, scopeOrganizationIds);
      updateData.organizationId = targetOrganizationId;
    }

    const targetOrganization = await this.prisma.organization.findUnique({
      where: { id: targetOrganizationId },
    });
    if (!targetOrganization) {
      throw new BadRequestException('현장을 찾을 수 없습니다.');
    }

    await assertCompanyOrGroupOrganization(this.prisma, targetOrganizationId);

    const zone = await this.prisma.zone.update({
      where: { id },
      data: {
        ...updateData,
        updatedById: actorUserId,
      },
      include: {
        organization: {
          select: { id: true, name: true },
        },
      },
    });

    const impactedPolicies = await this.prisma.controlPolicyZone.findMany({
      where: { zoneId: id },
      select: { policyId: true },
    });
    await this.controlPoliciesService.notifyPoliciesChanged(
      impactedPolicies.map((item) => item.policyId),
      'update',
    );

    if (actorUserId) {
      void this.prisma.auditLog.create({
        data: {
          accountId: actorUserId,
          organizationId: zone.organizationId,
          action: AuditAction.UPDATE,
          resourceType: 'Zone',
          resourceId: zone.id,
          resourceName: zone.name,
          changesAfter: {
            zoneId: zone.id,
            updatedById: actorUserId,
          },
        },
      }).catch(() => undefined);
    }

    return this.toResponseDto(zone);
  }

  async remove(id: string, scopeOrganizationIds?: string[]): Promise<void> {
    const zone = await this.prisma.zone.findFirst({
      where: { id, deletedAt: null },
      include: {
        _count: {
          select: {
            policyZones: true,
            dailyStats: true,
            zoneVisitSessions: true,
          },
        },
      },
    });

    if (!zone) {
      throw new NotFoundException('구역을 찾을 수 없습니다.');
    }

    this.assertZoneInScope(zone, scopeOrganizationIds);

    let impactedPolicyIds: string[] = [];
    await this.prisma.$transaction(async (tx) => {
      const impacted = await tx.controlPolicyZone.findMany({
        where: { zoneId: id },
        select: { policyId: true },
      });
      impactedPolicyIds = impacted.map((item: any) => item.policyId);

      await tx.controlPolicyZone.deleteMany({ where: { zoneId: id } });
      await tx.zone.update({
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

  async checkPointInZone(
    zoneId: string,
    point: CheckPointInZoneDto,
    scopeOrganizationIds?: string[],
  ): Promise<boolean> {
    const zone = await this.findOne(zoneId, scopeOrganizationIds);
    const pointLat = point.latitude ?? (point as any).lat ?? 0;
    const pointLng = (point as any).lng ?? point.longitude ?? 0;

    if (zone.shape === 'circle' && zone.radius) {
      // 원형 구역: 첫 번째 좌표를 중심점으로 사용
      const center = zone.coordinates?.[0];
      if (center) {
        const cLat = center.lat ?? center.latitude ?? 0;
        const cLng = center.lng ?? center.longitude ?? 0;
        const distance = this.calculateDistance(pointLat, pointLng, cLat, cLng);
        return distance <= zone.radius;
      }
    } else if (zone.coordinates && Array.isArray(zone.coordinates)) {
      // 다각형 구역: Point-in-polygon 알고리즘
      const normalizedPolygon = zone.coordinates.map((c: any) => ({
        latitude: c.lat ?? c.latitude ?? 0,
        longitude: c.lng ?? c.longitude ?? 0,
      }));
      return this.isPointInPolygon({ latitude: pointLat, longitude: pointLng }, normalizedPolygon);
    }

    return false;
  }

  async getZoneStats(scopeOrganizationIds?: string[]): Promise<ZoneStatsDto> {
    const [totalZones, byTypeResult] = await Promise.all([
      this.prisma.zone.count({
        where: {
          deletedAt: null,
          ...(scopeOrganizationIds ? { organizationId: { in: scopeOrganizationIds } } : {}),
        },
      }),
      this.prisma.zone.groupBy({
        by: ['type'],
        where: {
          deletedAt: null,
          ...(scopeOrganizationIds ? { organizationId: { in: scopeOrganizationIds } } : {}),
        },
        _count: { type: true },
      }),
    ]);

    const byType: Record<string, number> = {};
    byTypeResult.forEach((item) => {
      byType[item.type] = item._count.type;
    });

    return {
      totalZones,
      activeZones: totalZones,
      byType,
    };
  }

  async getZoneDetailStats(
    id: string,
    scopeOrganizationIds?: string[],
  ): Promise<{
    todayBlocks: number;
    weeklyBlocks: number;
    monthlyBlocks: number;
    monthlyEntries: number;
    uniqueEmployees: number;
    lastViolationAt: string | null;
  }> {
    const zone = await this.prisma.zone.findFirst({
      where: { id, deletedAt: null },
      select: { id: true, organizationId: true },
    });

    if (!zone) {
      throw new NotFoundException('구역을 찾을 수 없습니다.');
    }

    this.assertZoneInScope(zone, scopeOrganizationIds);

    const now = new Date();
    const todayStart = new Date(now);
    todayStart.setHours(0, 0, 0, 0);

    const weeklyStart = new Date(todayStart);
    weeklyStart.setDate(weeklyStart.getDate() - 6);

    const monthlyStart = new Date(todayStart);
    monthlyStart.setDate(monthlyStart.getDate() - 29);

    const blockedWhere = {
      zoneId: id,
      action: 'blocked' as const,
    };

    const [todayBlocks, weeklyBlocks, monthlyBlocks, monthlyEntries, uniqueEmployees, lastViolation] = await Promise.all([
      this.prisma.controlLog.count({
        where: {
          ...blockedWhere,
          timestamp: { gte: todayStart },
        },
      }),
      this.prisma.controlLog.count({
        where: {
          ...blockedWhere,
          timestamp: { gte: weeklyStart },
        },
      }),
      this.prisma.controlLog.count({
        where: {
          ...blockedWhere,
          timestamp: { gte: monthlyStart },
        },
      }),
      this.prisma.zoneVisitSession.count({
        where: {
          zoneId: id,
          enteredAt: { gte: monthlyStart },
        },
      }),
      this.prisma.controlLog.groupBy({
        by: ['employeeId'],
        where: {
          ...blockedWhere,
          timestamp: { gte: monthlyStart },
        },
      }),
      this.prisma.controlLog.findFirst({
        where: blockedWhere,
        orderBy: { timestamp: 'desc' },
        select: { timestamp: true, timestampKst: true },
      }),
    ]);

    return {
      todayBlocks,
      weeklyBlocks,
      monthlyBlocks,
      monthlyEntries,
      uniqueEmployees: uniqueEmployees.length,
      lastViolationAt: preferKstTimestamp(lastViolation?.timestampKst, lastViolation?.timestamp) ?? null,
    };
  }

  // Helper: 좌표 정규화 — lat/lng과 latitude/longitude 모두 지원
  private normalizeCoordinates(coordinates: any[]): { lat: number; lng: number }[] {
    return coordinates.map((c: any) => ({
      lat: c.lat ?? c.latitude ?? 0,
      lng: c.lng ?? c.longitude ?? 0,
    }));
  }

  private buildZoneGeometryMetadata(
    shape: 'circle' | 'polygon',
    coordinates: { lat: number; lng: number }[],
    radius?: number,
  ): {
    centerLat: number | null;
    centerLon: number | null;
    bboxMinLat: number | null;
    bboxMinLon: number | null;
    bboxMaxLat: number | null;
    bboxMaxLon: number | null;
  } {
    if (!coordinates || coordinates.length === 0) {
      throw new BadRequestException('좌표는 최소 1개 이상 필요합니다.');
    }

    if (shape === 'polygon' && coordinates.length < 3) {
      throw new BadRequestException('폴리곤 구역은 최소 3개 좌표가 필요합니다.');
    }

    if (shape === 'circle') {
      const center = coordinates[0];
      if (!center) {
        throw new BadRequestException('원형 구역은 중심 좌표가 필요합니다.');
      }

      const safeRadius = Math.max(0, radius ?? 0);
      const latDelta = safeRadius / 111_320;
      const lonDelta = safeRadius / (111_320 * Math.max(Math.cos((center.lat * Math.PI) / 180), 0.000001));

      return {
        centerLat: center.lat,
        centerLon: center.lng,
        bboxMinLat: center.lat - latDelta,
        bboxMinLon: center.lng - lonDelta,
        bboxMaxLat: center.lat + latDelta,
        bboxMaxLon: center.lng + lonDelta,
      };
    }

    const lats = coordinates.map((c) => c.lat);
    const lngs = coordinates.map((c) => c.lng);

    return {
      centerLat: null,
      centerLon: null,
      bboxMinLat: Math.min(...lats),
      bboxMinLon: Math.min(...lngs),
      bboxMaxLat: Math.max(...lats),
      bboxMaxLon: Math.max(...lngs),
    };
  }

  // Helper: Haversine formula for distance calculation
  private calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371e3; // Earth's radius in meters
    const φ1 = (lat1 * Math.PI) / 180;
    const φ2 = (lat2 * Math.PI) / 180;
    const Δφ = ((lat2 - lat1) * Math.PI) / 180;
    const Δλ = ((lon2 - lon1) * Math.PI) / 180;

    const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
              Math.cos(φ1) * Math.cos(φ2) *
              Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c; // Distance in meters
  }

  // Helper: Ray-casting algorithm for point-in-polygon
  private isPointInPolygon(
    point: { latitude: number; longitude: number },
    polygon: { latitude: number; longitude: number }[],
  ): boolean {
    let inside = false;
    const n = polygon.length;

    for (let i = 0, j = n - 1; i < n; j = i++) {
      const xi = polygon[i].longitude;
      const yi = polygon[i].latitude;
      const xj = polygon[j].longitude;
      const yj = polygon[j].latitude;

      const intersect =
        yi > point.latitude !== yj > point.latitude &&
        point.longitude < ((xj - xi) * (point.latitude - yi)) / (yj - yi) + xi;

      if (intersect) inside = !inside;
    }

    return inside;
  }

  private toResponseDto(zone: any): ZoneResponseDto {
    return toZoneResponseDto(zone);
  }
}
