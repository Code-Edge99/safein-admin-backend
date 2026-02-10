import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
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
  constructor(private prisma: PrismaService) {}

  async create(createZoneDto: CreateZoneDto): Promise<ZoneResponseDto> {
    const { coordinates, organizationId, workTypeId, type, shape, ...rest } = createZoneDto;

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

    const zone = await this.prisma.zone.create({
      data: {
        ...rest,
        type: type as any,
        shape: shape as any,
        coordinates: normalizedCoords as any,
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

  async findAll(filter: ZoneFilterDto): Promise<ZoneListResponseDto> {
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
      where.organizationId = organizationId;
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

  async findOne(id: string): Promise<ZoneResponseDto> {
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

    return this.toResponseDto(zone);
  }

  async findByOrganization(organizationId: string): Promise<ZoneResponseDto[]> {
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

  async update(id: string, updateZoneDto: UpdateZoneDto): Promise<ZoneResponseDto> {
    await this.findOne(id);

    const { coordinates, organizationId, workTypeId, ...rest } = updateZoneDto;

    const updateData: any = { ...rest };

    if (coordinates) {
      updateData.coordinates = this.normalizeCoordinates(coordinates) as any;
    }

    if (organizationId !== undefined) {
      if (organizationId) {
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

    return this.toResponseDto(zone);
  }

  async remove(id: string): Promise<void> {
    await this.findOne(id);
    await this.prisma.zone.delete({ where: { id } });
  }

  async toggleActive(id: string): Promise<ZoneResponseDto> {
    const zone = await this.findOne(id);

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

    return this.toResponseDto(updated);
  }

  async checkPointInZone(zoneId: string, point: CheckPointInZoneDto): Promise<boolean> {
    const zone = await this.findOne(zoneId);
    const pointLat = point.latitude ?? (point as any).lat ?? 0;
    const pointLng = point.longitude ?? (point as any).lng ?? 0;

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

  async getZoneStats(): Promise<ZoneStatsDto> {
    const [totalZones, activeZones, byTypeResult] = await Promise.all([
      this.prisma.zone.count(),
      this.prisma.zone.count({ where: { isActive: true } }),
      this.prisma.zone.groupBy({
        by: ['type'],
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
    let coordinates = zone.coordinates;
    if (typeof coordinates === 'string') {
      try {
        coordinates = JSON.parse(coordinates);
      } catch {
        coordinates = [];
      }
    }

    return {
      id: zone.id,
      name: zone.name,
      description: zone.description,
      type: zone.type,
      shape: zone.shape,
      coordinates,
      radius: zone.radius,
      groupId: zone.groupId,
      isActive: zone.isActive,
      organization: zone.organization,
      workType: zone.workType,
      createdAt: zone.createdAt,
      updatedAt: zone.updatedAt,
    };
  }
}
