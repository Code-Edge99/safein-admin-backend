import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { Prisma, DeviceOS, DeviceStatus, DeviceOperationStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PaginatedResponse } from '../../common/dto';
import {
  CreateDeviceDto,
  UpdateDeviceDto,
  DeviceResponseDto,
  DeviceDetailDto,
  DeviceFilterDto,
  AssignDeviceDto,
  DeviceLocationDto,
} from './dto';

@Injectable()
export class DevicesService {
  constructor(private readonly prisma: PrismaService) {}

  private ensureOrganizationInScope(
    organizationId: string | undefined,
    scopeOrganizationIds?: string[],
  ): void {
    if (!organizationId || !scopeOrganizationIds) return;
    if (!scopeOrganizationIds.includes(organizationId)) {
      throw new ForbiddenException('요청한 조직은 접근 권한 범위를 벗어났습니다.');
    }
  }

  private assertDeviceInScope(device: { organizationId?: string | null }, scopeOrganizationIds?: string[]): void {
    if (!scopeOrganizationIds) return;
    if (!device.organizationId || !scopeOrganizationIds.includes(device.organizationId)) {
      throw new NotFoundException('장치를 찾을 수 없습니다.');
    }
  }

  async create(dto: CreateDeviceDto, scopeOrganizationIds?: string[]): Promise<DeviceResponseDto> {
    // 장치 ID 중복 체크
    const existing = await this.prisma.device.findUnique({
      where: { deviceId: dto.deviceId },
    });

    if (existing) {
      throw new ConflictException('이미 등록된 장치입니다.');
    }

    // 직원 존재 여부 확인
    if (dto.employeeId) {
      const employee = await this.prisma.employee.findUnique({
        where: { id: dto.employeeId },
      });
      if (!employee) {
        throw new NotFoundException('직원을 찾을 수 없습니다.');
      }
      this.ensureOrganizationInScope(employee.organizationId || undefined, scopeOrganizationIds);
    }

    // 조직 존재 여부 확인
    if (dto.organizationId) {
      this.ensureOrganizationInScope(dto.organizationId, scopeOrganizationIds);
      const organization = await this.prisma.organization.findUnique({
        where: { id: dto.organizationId },
      });
      if (!organization) {
        throw new NotFoundException('조직을 찾을 수 없습니다.');
      }
    }

    const device = await this.prisma.device.create({
      data: {
        deviceId: dto.deviceId,
        employeeId: dto.employeeId,
        organizationId: dto.organizationId,
        os: dto.os as DeviceOS,
        osVersion: dto.osVersion,
        model: dto.model,
        manufacturer: dto.manufacturer,
        appVersion: dto.appVersion,
        registeredAt: new Date(),
        deviceStatus: dto.employeeId ? DeviceOperationStatus.IN_USE : DeviceOperationStatus.UNASSIGNED,
      },
      include: {
        employee: true,
        organization: true,
      },
    });

    return this.toResponseDto(device);
  }

  async findAll(
    filter: DeviceFilterDto,
    scopeOrganizationIds?: string[],
  ): Promise<PaginatedResponse<DeviceResponseDto>> {
    const where: Prisma.DeviceWhereInput = {};

    // 조직 필터
    if (filter.organizationId) {
      this.ensureOrganizationInScope(filter.organizationId, scopeOrganizationIds);
      where.organizationId = filter.organizationId;
    } else if (scopeOrganizationIds) {
      where.organizationId = { in: scopeOrganizationIds };
    }

    // 검색어 필터
    if (filter.search) {
      where.OR = [
        { deviceId: { contains: filter.search, mode: 'insensitive' } },
        { model: { contains: filter.search, mode: 'insensitive' } },
        { employee: { name: { contains: filter.search, mode: 'insensitive' } } },
      ];
    }

    // OS 필터
    if (filter.os) {
      where.os = filter.os as DeviceOS;
    }

    // 상태 필터
    if (filter.status) {
      where.status = filter.status as DeviceStatus;
    }

    // 운영 상태 필터
    if (filter.deviceStatus) {
      where.deviceStatus = filter.deviceStatus as DeviceOperationStatus;
    }

    // 직원 필터
    if (filter.employeeId) {
      where.employeeId = filter.employeeId;
    }

    // 미할당만
    if (filter.unassignedOnly) {
      where.employeeId = null;
    }

    const [devices, total] = await Promise.all([
      this.prisma.device.findMany({
        where,
        include: {
          employee: true,
          organization: true,
          token: true,
        },
        skip: filter.skip,
        take: filter.take,
        orderBy: filter.orderBy || { createdAt: 'desc' },
      }),
      this.prisma.device.count({ where }),
    ]);

    const data = devices.map((d) => this.toResponseDto(d));

    return new PaginatedResponse(data, total, filter.page || 1, filter.limit || 20);
  }

  async findOne(id: string, scopeOrganizationIds?: string[]): Promise<DeviceDetailDto> {
    const device = await this.prisma.device.findUnique({
      where: { id },
      include: {
        employee: true,
        organization: true,
        token: true,
        locations: {
          take: 1,
          orderBy: { timestamp: 'desc' },
        },
      },
    });

    if (!device) {
      throw new NotFoundException('장치를 찾을 수 없습니다.');
    }

    this.assertDeviceInScope(device, scopeOrganizationIds);

    return {
      ...this.toResponseDto(device),
      lastLocation: device.locations[0] ? {
        latitude: device.locations[0].latitude.toNumber(),
        longitude: device.locations[0].longitude.toNumber(),
        timestamp: device.locations[0].timestamp,
      } : undefined,
    };
  }

  async findByDeviceId(deviceId: string, scopeOrganizationIds?: string[]): Promise<DeviceResponseDto> {
    const device = await this.prisma.device.findUnique({
      where: { deviceId },
      include: {
        employee: true,
        organization: true,
      },
    });

    if (!device) {
      throw new NotFoundException('장치를 찾을 수 없습니다.');
    }

    this.assertDeviceInScope(device, scopeOrganizationIds);

    return this.toResponseDto(device);
  }

  async update(id: string, dto: UpdateDeviceDto, scopeOrganizationIds?: string[]): Promise<DeviceResponseDto> {
    await this.findOne(id, scopeOrganizationIds); // 존재 여부 확인

    // 직원 존재 여부 확인
    if (dto.employeeId) {
      const employee = await this.prisma.employee.findUnique({
        where: { id: dto.employeeId },
      });
      if (!employee) {
        throw new NotFoundException('직원을 찾을 수 없습니다.');
      }
      this.ensureOrganizationInScope(employee.organizationId || undefined, scopeOrganizationIds);
    }

    this.ensureOrganizationInScope(dto.organizationId, scopeOrganizationIds);

    const device = await this.prisma.device.update({
      where: { id },
      data: {
        employeeId: dto.employeeId,
        organizationId: dto.organizationId,
        os: dto.os as DeviceOS | undefined,
        osVersion: dto.osVersion,
        model: dto.model,
        manufacturer: dto.manufacturer,
        appVersion: dto.appVersion,
        status: dto.status as DeviceStatus | undefined,
        deviceStatus: dto.deviceStatus as DeviceOperationStatus | undefined,
        deactivatedReason: dto.deactivatedReason,
        deactivatedAt: dto.status === 'INACTIVE' ? new Date() : undefined,
      },
      include: {
        employee: true,
        organization: true,
      },
    });

    return this.toResponseDto(device);
  }

  async assignToEmployee(
    id: string,
    dto: AssignDeviceDto,
    scopeOrganizationIds?: string[],
  ): Promise<DeviceResponseDto> {
    const device = await this.prisma.device.findUnique({
      where: { id },
    });

    if (!device) {
      throw new NotFoundException('장치를 찾을 수 없습니다.');
    }
    this.assertDeviceInScope(device, scopeOrganizationIds);

    const employee = await this.prisma.employee.findUnique({
      where: { id: dto.employeeId },
    });

    if (!employee) {
      throw new NotFoundException('직원을 찾을 수 없습니다.');
    }
    this.ensureOrganizationInScope(employee.organizationId || undefined, scopeOrganizationIds);

    const updatedDevice = await this.prisma.device.update({
      where: { id },
      data: {
        employeeId: dto.employeeId,
        organizationId: employee.organizationId,
        deviceStatus: DeviceOperationStatus.IN_USE,
      },
      include: {
        employee: true,
        organization: true,
      },
    });

    return this.toResponseDto(updatedDevice);
  }

  async unassign(id: string, scopeOrganizationIds?: string[]): Promise<DeviceResponseDto> {
    const device = await this.prisma.device.findUnique({
      where: { id },
    });

    if (!device) {
      throw new NotFoundException('장치를 찾을 수 없습니다.');
    }
    this.assertDeviceInScope(device, scopeOrganizationIds);

    const updatedDevice = await this.prisma.device.update({
      where: { id },
      data: {
        employeeId: null,
        deviceStatus: DeviceOperationStatus.UNASSIGNED,
      },
      include: {
        employee: true,
        organization: true,
      },
    });

    return this.toResponseDto(updatedDevice);
  }

  async updateLocation(id: string, dto: DeviceLocationDto, scopeOrganizationIds?: string[]): Promise<void> {
    const device = await this.prisma.device.findUnique({
      where: { id },
    });

    if (!device) {
      throw new NotFoundException('장치를 찾을 수 없습니다.');
    }
    this.assertDeviceInScope(device, scopeOrganizationIds);

    await this.prisma.deviceLocation.create({
      data: {
        deviceId: id,
        latitude: dto.latitude,
        longitude: dto.longitude,
        accuracy: dto.accuracy,
        timestamp: new Date(),
      },
    });

    // 마지막 통신 시간 업데이트
    await this.prisma.device.update({
      where: { id },
      data: { lastCommunication: new Date() },
    });
  }

  async markAsLost(id: string, scopeOrganizationIds?: string[]): Promise<DeviceResponseDto> {
    const device = await this.prisma.device.findUnique({
      where: { id },
    });

    if (!device) {
      throw new NotFoundException('장치를 찾을 수 없습니다.');
    }
    this.assertDeviceInScope(device, scopeOrganizationIds);

    const updatedDevice = await this.prisma.device.update({
      where: { id },
      data: {
        deviceStatus: DeviceOperationStatus.LOST,
      },
      include: {
        employee: true,
        organization: true,
      },
    });

    return this.toResponseDto(updatedDevice);
  }

  async remove(id: string, scopeOrganizationIds?: string[]): Promise<void> {
    const device = await this.prisma.device.findUnique({
      where: { id },
    });

    if (!device) {
      throw new NotFoundException('장치를 찾을 수 없습니다.');
    }
    this.assertDeviceInScope(device, scopeOrganizationIds);

    // 관련 데이터 삭제
    await this.prisma.$transaction([
      this.prisma.deviceLocation.deleteMany({ where: { deviceId: id } }),
      this.prisma.deviceToken.deleteMany({ where: { deviceId: id } }),
      this.prisma.device.delete({ where: { id } }),
    ]);
  }

  async getDeviceStats(organizationId?: string, scopeOrganizationIds?: string[]): Promise<{
    total: number;
    byStatus: Record<string, number>;
    byOS: Record<string, number>;
    byOperationStatus: Record<string, number>;
  }> {
    if (organizationId) {
      this.ensureOrganizationInScope(organizationId, scopeOrganizationIds);
    }

    const where: Prisma.DeviceWhereInput = organizationId
      ? { organizationId }
      : scopeOrganizationIds
        ? { organizationId: { in: scopeOrganizationIds } }
        : {};

    const [total, byStatus, byOS, byOperationStatus] = await Promise.all([
      this.prisma.device.count({ where }),
      this.prisma.device.groupBy({
        by: ['status'],
        where,
        _count: true,
      }),
      this.prisma.device.groupBy({
        by: ['os'],
        where,
        _count: true,
      }),
      this.prisma.device.groupBy({
        by: ['deviceStatus'],
        where,
        _count: true,
      }),
    ]);

    return {
      total,
      byStatus: Object.fromEntries(byStatus.map((s) => [s.status, s._count])),
      byOS: Object.fromEntries(byOS.map((o) => [o.os, o._count])),
      byOperationStatus: Object.fromEntries(byOperationStatus.map((d) => [d.deviceStatus, d._count])),
    };
  }

  private toResponseDto(device: any): DeviceResponseDto {
    return {
      id: device.id,
      deviceId: device.deviceId,
      employeeId: device.employeeId,
      employeeName: device.employee?.name,
      organizationId: device.organizationId,
      organizationName: device.organization?.name,
      os: device.os,
      osVersion: device.osVersion,
      model: device.model,
      manufacturer: device.manufacturer,
      appVersion: device.appVersion,
      status: device.status,
      deviceStatus: device.deviceStatus,
      lastCommunication: device.lastCommunication,
      registeredAt: device.registeredAt,
      deactivatedAt: device.deactivatedAt,
      deactivatedReason: device.deactivatedReason,
      tokenInfo: device.token
        ? {
            isValid: device.token.isValid,
            lastLogin: device.token.lastLogin ?? undefined,
            expiresAt: device.token.expiresAt ?? undefined,
          }
        : undefined,
      pushToken: device.pushToken,
      createdAt: device.createdAt,
      updatedAt: device.updatedAt,
    };
  }
}
