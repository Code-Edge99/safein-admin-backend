import { Injectable, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { deactivatePoliciesWithoutConditions } from '../../common/utils/control-policy-cleanup.util';
import { assertOrganizationInScopeOrThrow, ensureOrganizationInScope } from '../../common/utils/organization-scope.util';
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

  async create(createZoneDto: CreateZoneDto, scopeOrganizationIds?: string[]): Promise<ZoneResponseDto> {
    const { coordinates, organizationId, workTypeId, type, shape, ...rest } = createZoneDto;

    this.ensureOrganizationInScope(organizationId, scopeOrganizationIds);

    // Validate organization
    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
    });
    if (!org) {
      throw new BadRequestException('조직을 찾을 수 없습니다.');
    }

    // Validate work type if provided
    if (workTypeId) {
      const workType = await this.prisma.workType.findUnique({
        where: { id: workTypeId },
      });
      if (!workType) {
        throw new BadRequestException('작업 유형을 찾을 수 없습니다.');
      }
    }

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
        workTypeId,
      },
      include: {
        organization: {
          select: { id: true, name: true },
        },
        workType: {
          select: { id: true, name: true },
        },
      },
    });

    return this.toResponseDto(zone);
  }

  async findAll(filter: ZoneFilterDto, scopeOrganizationIds?: string[]): Promise<ZoneListResponseDto> {
    const { search, type, organizationId, workTypeId, isActive, page = 1, limit = 20 } = filter;
    const skip = (page - 1) * limit;

    const where: any = {};

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

    if (workTypeId) {
      where.workTypeId = workTypeId;
    }

    if (isActive !== undefined) {
      where.isActive = isActive;
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
          workType: {
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
    const zone = await this.prisma.zone.findUnique({
      where: { id },
      include: {
        organization: {
          select: { id: true, name: true },
        },
        workType: {
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
        isActive: true,
      },
      include: {
        organization: {
          select: { id: true, name: true },
        },
        workType: {
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
  ): Promise<ZoneResponseDto> {
    await this.findOne(id, scopeOrganizationIds);

    const { coordinates, organizationId, workTypeId, ...rest } = updateZoneDto;

    const updateData: any = { ...rest };

    const currentZone = await this.prisma.zone.findUnique({
      where: { id },
      select: { shape: true, coordinates: true, radius: true },
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

    if (organizationId !== undefined) {
      if (organizationId) {
        this.ensureOrganizationInScope(organizationId, scopeOrganizationIds);
        const org = await this.prisma.organization.findUnique({
          where: { id: organizationId },
        });
        if (!org) {
          throw new BadRequestException('조직을 찾을 수 없습니다.');
        }
      }
      updateData.organizationId = organizationId;
    }

    if (workTypeId !== undefined) {
      if (workTypeId) {
        const workType = await this.prisma.workType.findUnique({
          where: { id: workTypeId },
        });
        if (!workType) {
          throw new BadRequestException('작업 유형을 찾을 수 없습니다.');
        }
      }
      updateData.workTypeId = workTypeId || null;
    }

    const zone = await this.prisma.zone.update({
      where: { id },
      data: updateData,
      include: {
        organization: {
          select: { id: true, name: true },
        },
        workType: {
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

    return this.toResponseDto(zone);
  }

  async remove(id: string, scopeOrganizationIds?: string[]): Promise<void> {
    const zone = await this.prisma.zone.findUnique({
      where: { id },
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

    if (zone._count.dailyStats > 0 || zone._count.zoneVisitSessions > 0) {
      throw new BadRequestException('이력 데이터가 있는 구역은 삭제할 수 없습니다. 비활성화로 관리해주세요.');
    }

    let impactedPolicyIds: string[] = [];
    await this.prisma.$transaction(async (tx) => {
      const impacted = await tx.controlPolicyZone.findMany({
        where: { zoneId: id },
        select: { policyId: true },
      });
      impactedPolicyIds = impacted.map((item: any) => item.policyId);

      await tx.controlPolicyZone.deleteMany({ where: { zoneId: id } });
      await tx.zone.delete({ where: { id } });

      await deactivatePoliciesWithoutConditions(
        tx,
        impacted.map((item: any) => item.policyId),
      );
    });

    await this.controlPoliciesService.notifyPoliciesChanged(impactedPolicyIds, 'update');
  }

  async toggleActive(id: string, scopeOrganizationIds?: string[]): Promise<ZoneResponseDto> {
    const zone = await this.findOne(id, scopeOrganizationIds);

    const updated = await this.prisma.zone.update({
      where: { id },
      data: { isActive: !zone.isActive },
      include: {
        organization: {
          select: { id: true, name: true },
        },
        workType: {
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

    return this.toResponseDto(updated);
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
    const [totalZones, activeZones, byTypeResult] = await Promise.all([
      this.prisma.zone.count({
        where: scopeOrganizationIds ? { organizationId: { in: scopeOrganizationIds } } : undefined,
      }),
      this.prisma.zone.count({
        where: {
          isActive: true,
          ...(scopeOrganizationIds ? { organizationId: { in: scopeOrganizationIds } } : {}),
        },
      }),
      this.prisma.zone.groupBy({
        by: ['type'],
        where: scopeOrganizationIds ? { organizationId: { in: scopeOrganizationIds } } : undefined,
        _count: { type: true },
      }),
    ]);

    const byType: Record<string, number> = {};
    byTypeResult.forEach((item) => {
      byType[item.type] = item._count.type;
    });

    return {
      totalZones,
      activeZones,
      byType,
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
