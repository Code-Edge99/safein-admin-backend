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
import { assertOrganizationInScopeOrThrow, ensureOrganizationInScope } from '../../common/utils/organization-scope.util';
import { findEmployeeByIdentifier, resolveEmployeePrimaryId } from '../../common/utils/employee-identifier.util';
import { toDeviceResponseDto } from './devices.mapper';
import { decryptLocation, encryptLocation } from '../../common/security/location-crypto';
import { formatKstTimestampString, preferKstTimestamp } from '../../common/utils/kst-time.util';
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
    ensureOrganizationInScope(organizationId, scopeOrganizationIds);
  }

  private assertDeviceInScope(device: { organizationId?: string | null }, scopeOrganizationIds?: string[]): void {
    assertOrganizationInScopeOrThrow(device.organizationId, scopeOrganizationIds, '장치를 찾을 수 없습니다.');
  }

  async create(dto: CreateDeviceDto, scopeOrganizationIds?: string[]): Promise<DeviceResponseDto> {
    const resolvedEmployeeId = dto.employeeId
      ? await resolveEmployeePrimaryId(this.prisma, dto.employeeId)
      : null;

    // 동일 deviceId는 허용하되, 같은 소유 문맥(직원 또는 미할당) 내 중복은 방지
    const existing = await this.prisma.device.findFirst({
      where: {
        deviceId: dto.deviceId,
        employeeId: resolvedEmployeeId ?? null,
      },
      select: { id: true },
    });

    if (existing) {
      throw new ConflictException('동일 소유 문맥에 이미 등록된 장치입니다.');
    }

    // 직원 존재 여부 확인
    if (dto.employeeId) {
      const employee = await findEmployeeByIdentifier(this.prisma, dto.employeeId);
      if (!employee) {
        throw new NotFoundException('직원을 찾을 수 없습니다.');
      }
      this.ensureOrganizationInScope(employee.organizationId || undefined, scopeOrganizationIds);
    }

    // 현장 존재 여부 확인
    if (dto.organizationId) {
      this.ensureOrganizationInScope(dto.organizationId, scopeOrganizationIds);
      const organization = await this.prisma.organization.findUnique({
        where: { id: dto.organizationId },
      });
      if (!organization) {
        throw new NotFoundException('현장을 찾을 수 없습니다.');
      }
    }

    const device = await this.prisma.device.create({
      data: {
        deviceId: dto.deviceId,
        employeeId: resolvedEmployeeId,
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

    // 현장 필터
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
      const resolvedEmployeeId = await resolveEmployeePrimaryId(this.prisma, filter.employeeId);
      where.employeeId = resolvedEmployeeId || '__missing_employee__';
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

    const lastLocation = device.locations[0] ? decryptLocation(device.locations[0]) : undefined;

    return {
      ...this.toResponseDto(device),
      lastLocation: lastLocation ? {
        latitude: lastLocation.latitude,
        longitude: lastLocation.longitude,
        timestamp: preferKstTimestamp(device.locations[0].timestampKst, device.locations[0].timestamp) || '',
      } : undefined,
    };
  }

  async findByDeviceId(deviceId: string, scopeOrganizationIds?: string[]): Promise<DeviceResponseDto> {
    const device = await this.prisma.device.findFirst({
      where: {
        deviceId,
        ...(scopeOrganizationIds
          ? {
              organizationId: { in: scopeOrganizationIds },
            }
          : {}),
      },
      orderBy: { updatedAt: 'desc' },
      include: {
        employee: true,
        organization: true,
      },
    });

    if (!device) {
      throw new NotFoundException('장치를 찾을 수 없습니다.');
    }
    return this.toResponseDto(device);
  }

  async update(id: string, dto: UpdateDeviceDto, scopeOrganizationIds?: string[]): Promise<DeviceResponseDto> {
    await this.findOne(id, scopeOrganizationIds); // 존재 여부 확인

    const resolvedEmployeeId = dto.employeeId !== undefined
      ? await resolveEmployeePrimaryId(this.prisma, dto.employeeId)
      : undefined;

    // 직원 존재 여부 확인
    if (dto.employeeId) {
      const employee = await findEmployeeByIdentifier(this.prisma, dto.employeeId);
      if (!employee) {
        throw new NotFoundException('직원을 찾을 수 없습니다.');
      }
      this.ensureOrganizationInScope(employee.organizationId || undefined, scopeOrganizationIds);
    }

    this.ensureOrganizationInScope(dto.organizationId, scopeOrganizationIds);

    const device = await this.prisma.device.update({
      where: { id },
      data: {
        employeeId: resolvedEmployeeId,
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

    const employee = await findEmployeeByIdentifier(this.prisma, dto.employeeId);

    if (!employee) {
      throw new NotFoundException('직원을 찾을 수 없습니다.');
    }
    this.ensureOrganizationInScope(employee.organizationId || undefined, scopeOrganizationIds);

    const updatedDevice = await this.prisma.device.update({
      where: { id },
      data: {
        employeeId: employee.id,
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

    const encryptedLocation = encryptLocation({
      latitude: dto.latitude,
      longitude: dto.longitude,
    });

    const now = new Date();

    await this.prisma.deviceLocation.create({
      data: {
        deviceId: id,
        ...encryptedLocation,
        accuracy: dto.accuracy,
        timestamp: now,
        timestampKst: formatKstTimestampString(now),
      },
    });

    // 마지막 통신 시간 업데이트
    await this.prisma.device.update({
      where: { id },
      data: { lastCommunication: now },
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
      select: {
        id: true,
        udid: true,
        organizationId: true,
      },
    });

    if (!device) {
      throw new NotFoundException('장치를 찾을 수 없습니다.');
    }
    this.assertDeviceInScope(device, scopeOrganizationIds);

    const deleteOperations: Prisma.PrismaPromise<unknown>[] = [
      this.prisma.controlLog.deleteMany({ where: { deviceId: id } }),
      this.prisma.zoneVisitSession.deleteMany({ where: { deviceId: id } }),
      this.prisma.appUsageSession.deleteMany({ where: { deviceId: id } }),
      this.prisma.workSession.deleteMany({ where: { deviceId: id } }),
      this.prisma.installedApp.deleteMany({ where: { deviceId: id } }),
      this.prisma.mdmCommand.deleteMany({ where: { deviceId: id } }),
      this.prisma.deviceLocation.deleteMany({ where: { deviceId: id } }),
      this.prisma.deviceToken.deleteMany({ where: { deviceId: id } }),
      this.prisma.device.delete({ where: { id } }),
    ];

    if (device.udid) {
      deleteOperations.unshift(
        this.prisma.employee.updateMany({
          where: { pendingMdmUdid: device.udid },
          data: { pendingMdmUdid: null },
        }),
      );
    }

    // 관련 데이터 삭제
    await this.prisma.$transaction(deleteOperations);
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
    return toDeviceResponseDto(device);
  }
}
