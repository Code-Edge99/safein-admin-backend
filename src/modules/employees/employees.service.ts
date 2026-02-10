import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { Prisma, EmployeeStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PaginatedResponse } from '../../common/dto';
import {
  CreateEmployeeDto,
  UpdateEmployeeDto,
  EmployeeResponseDto,
  EmployeeDetailDto,
  EmployeeFilterDto,
  BulkAssignWorkTypeDto,
  BulkMoveOrganizationDto,
  EmployeeStatusEnum,
} from './dto';

@Injectable()
export class EmployeesService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateEmployeeDto): Promise<EmployeeResponseDto> {
    // 조직 존재 여부 확인
    const organization = await this.prisma.organization.findUnique({
      where: { id: dto.organizationId },
    });

    if (!organization) {
      throw new NotFoundException('조직을 찾을 수 없습니다.');
    }

    // 현장 존재 여부 확인
    const site = await this.prisma.organization.findUnique({
      where: { id: dto.siteId },
    });

    if (!site) {
      throw new NotFoundException('현장을 찾을 수 없습니다.');
    }

    // 근무 유형 존재 여부 확인
    if (dto.workTypeId) {
      const workType = await this.prisma.workType.findUnique({
        where: { id: dto.workTypeId },
      });
      if (!workType) {
        throw new NotFoundException('근무 유형을 찾을 수 없습니다.');
      }
    }

    const employee = await this.prisma.employee.create({
      data: {
        employeeId: dto.employeeId,
        name: dto.name,
        organizationId: dto.organizationId,
        siteId: dto.siteId,
        position: dto.position,
        role: dto.role,
        email: dto.email,
        phone: dto.phone,
        workTypeId: dto.workTypeId,
        status: (dto.status as EmployeeStatus) || EmployeeStatus.ACTIVE,
        hireDate: dto.hireDate ? new Date(dto.hireDate) : undefined,
      },
      include: {
        organization: true,
        site: true,
        workType: true,
      },
    });

    return this.toResponseDto(employee);
  }

  async findAll(filter: EmployeeFilterDto): Promise<PaginatedResponse<EmployeeResponseDto>> {
    const where: Prisma.EmployeeWhereInput = {};

    // 조직 필터
    if (filter.organizationId) {
      where.organizationId = filter.organizationId;
    }

    // 현장 필터
    if (filter.siteId) {
      where.siteId = filter.siteId;
    }

    // 검색어 필터
    if (filter.search) {
      where.OR = [
        { name: { contains: filter.search, mode: 'insensitive' } },
        { email: { contains: filter.search, mode: 'insensitive' } },
        { employeeId: { contains: filter.search, mode: 'insensitive' } },
      ];
    }

    // 근무 유형 필터
    if (filter.workTypeId) {
      where.workTypeId = filter.workTypeId;
    }

    // 상태 필터
    if (filter.status) {
      where.status = filter.status as EmployeeStatus;
    }

    const [employees, total] = await Promise.all([
      this.prisma.employee.findMany({
        where,
        include: {
          organization: true,
          site: true,
          workType: true,
          _count: {
            select: { devices: true },
          },
        },
        skip: filter.skip,
        take: filter.take,
        orderBy: filter.orderBy || { createdAt: 'desc' },
      }),
      this.prisma.employee.count({ where }),
    ]);

    const data = employees.map((e) => this.toResponseDto(e));

    return new PaginatedResponse(data, total, filter.page || 1, filter.limit || 20);
  }

  async findOne(id: string): Promise<EmployeeDetailDto> {
    const employee = await this.prisma.employee.findUnique({
      where: { id },
      include: {
        organization: true,
        site: true,
        workType: true,
        devices: {
          select: {
            id: true,
            deviceId: true,
            model: true,
            os: true,
            status: true,
            lastCommunication: true,
          },
        },
        exclusions: {
          where: {
            OR: [
              { endDate: null },
              { endDate: { gte: new Date() } },
            ],
          },
          select: {
            id: true,
            startDate: true,
            endDate: true,
            reason: true,
            isActive: true,
          },
        },
      },
    });

    if (!employee) {
      throw new NotFoundException('직원을 찾을 수 없습니다.');
    }

    return {
      ...this.toResponseDto(employee),
      devices: employee.devices.map(d => ({
        id: d.id,
        deviceId: d.deviceId,
        model: d.model || '',
        os: d.os,
        status: d.status,
        lastCommunication: d.lastCommunication || undefined,
      })),
      exclusions: employee.exclusions.map(e => ({
        id: e.id,
        startDate: e.startDate,
        endDate: e.endDate || undefined,
        reason: e.reason,
        isActive: e.isActive,
      })),
    };
  }

  async update(id: string, dto: UpdateEmployeeDto): Promise<EmployeeResponseDto> {
    await this.findOne(id); // 존재 여부 확인

    // 조직 존재 여부 확인
    if (dto.organizationId) {
      const organization = await this.prisma.organization.findUnique({
        where: { id: dto.organizationId },
      });
      if (!organization) {
        throw new NotFoundException('조직을 찾을 수 없습니다.');
      }
    }

    // 현장 존재 여부 확인
    if (dto.siteId) {
      const site = await this.prisma.organization.findUnique({
        where: { id: dto.siteId },
      });
      if (!site) {
        throw new NotFoundException('현장을 찾을 수 없습니다.');
      }
    }

    // 근무 유형 존재 여부 확인
    if (dto.workTypeId) {
      const workType = await this.prisma.workType.findUnique({
        where: { id: dto.workTypeId },
      });
      if (!workType) {
        throw new NotFoundException('근무 유형을 찾을 수 없습니다.');
      }
    }

    const employee = await this.prisma.employee.update({
      where: { id },
      data: {
        employeeId: dto.employeeId,
        name: dto.name,
        organizationId: dto.organizationId,
        siteId: dto.siteId,
        position: dto.position,
        role: dto.role,
        email: dto.email,
        phone: dto.phone,
        workTypeId: dto.workTypeId,
        status: dto.status as EmployeeStatus | undefined,
        hireDate: dto.hireDate ? new Date(dto.hireDate) : undefined,
      },
      include: {
        organization: true,
        site: true,
        workType: true,
      },
    });

    return this.toResponseDto(employee);
  }

  async remove(id: string): Promise<void> {
    const employee = await this.prisma.employee.findUnique({
      where: { id },
      include: {
        _count: {
          select: { devices: true },
        },
      },
    });

    if (!employee) {
      throw new NotFoundException('직원을 찾을 수 없습니다.');
    }

    // 연결된 장치가 있으면 퇴사 처리
    if (employee._count.devices > 0) {
      await this.prisma.employee.update({
        where: { id },
        data: { status: EmployeeStatus.RESIGNED },
      });
    } else {
      await this.prisma.employee.delete({
        where: { id },
      });
    }
  }

  async bulkAssignWorkType(dto: BulkAssignWorkTypeDto): Promise<{ updated: number }> {
    // 근무 유형 존재 여부 확인
    const workType = await this.prisma.workType.findUnique({
      where: { id: dto.workTypeId },
    });
    if (!workType) {
      throw new NotFoundException('근무 유형을 찾을 수 없습니다.');
    }

    const result = await this.prisma.employee.updateMany({
      where: { id: { in: dto.employeeIds } },
      data: { workTypeId: dto.workTypeId },
    });

    return { updated: result.count };
  }

  async bulkMoveOrganization(dto: BulkMoveOrganizationDto): Promise<{ updated: number }> {
    // 대상 조직 존재 여부 확인
    const organization = await this.prisma.organization.findUnique({
      where: { id: dto.targetOrganizationId },
    });
    if (!organization) {
      throw new NotFoundException('대상 조직을 찾을 수 없습니다.');
    }

    const result = await this.prisma.employee.updateMany({
      where: { id: { in: dto.employeeIds } },
      data: { organizationId: dto.targetOrganizationId },
    });

    return { updated: result.count };
  }

  async bulkUpdateStatus(employeeIds: string[], status: EmployeeStatusEnum): Promise<{ updated: number }> {
    const result = await this.prisma.employee.updateMany({
      where: { id: { in: employeeIds } },
      data: { status: status as EmployeeStatus },
    });
    return { updated: result.count };
  }

  async getStats(): Promise<{
    total: number; active: number; resigned: number; exception: number; leave: number;
    byOrganization: Record<string, number>;
  }> {
    const [total, byStatus, byOrg] = await Promise.all([
      this.prisma.employee.count(),
      this.prisma.employee.groupBy({ by: ['status'], _count: true }),
      this.prisma.employee.groupBy({ by: ['organizationId'], _count: true }),
    ]);

    const statusMap: Record<string, number> = {};
    byStatus.forEach(s => { statusMap[s.status] = s._count; });

    const orgIds = byOrg.map(o => o.organizationId);
    const orgs = await this.prisma.organization.findMany({
      where: { id: { in: orgIds } },
      select: { id: true, name: true },
    });
    const orgMap = new Map(orgs.map(o => [o.id, o.name]));
    const byOrganization: Record<string, number> = {};
    byOrg.forEach(item => {
      byOrganization[orgMap.get(item.organizationId) || item.organizationId] = item._count;
    });

    return {
      total,
      active: statusMap['ACTIVE'] || 0,
      resigned: statusMap['RESIGNED'] || 0,
      exception: statusMap['EXCEPTION'] || 0,
      leave: statusMap['LEAVE'] || 0,
      byOrganization,
    };
  }

  async assignDevice(employeeId: string, deviceId: string): Promise<EmployeeResponseDto> {
    const employee = await this.prisma.employee.findUnique({ where: { id: employeeId } });
    if (!employee) throw new NotFoundException('직원을 찾을 수 없습니다.');

    const device = await this.prisma.device.findUnique({ where: { id: deviceId } });
    if (!device) throw new NotFoundException('장치를 찾을 수 없습니다.');
    if (device.employeeId && device.employeeId !== employeeId) {
      throw new BadRequestException('해당 장치는 이미 다른 직원에게 할당되어 있습니다.');
    }

    await this.prisma.device.update({
      where: { id: deviceId },
      data: { employeeId, organizationId: employee.organizationId, deviceStatus: 'IN_USE' },
    });

    const updated = await this.prisma.employee.findUnique({
      where: { id: employeeId },
      include: { organization: true, site: true, workType: true },
    });
    return this.toResponseDto(updated);
  }

  async unassignDevice(employeeId: string): Promise<EmployeeResponseDto> {
    const employee = await this.prisma.employee.findUnique({ where: { id: employeeId } });
    if (!employee) throw new NotFoundException('직원을 찾을 수 없습니다.');

    await this.prisma.device.updateMany({
      where: { employeeId },
      data: { employeeId: null, deviceStatus: 'UNASSIGNED' },
    });

    const updated = await this.prisma.employee.findUnique({
      where: { id: employeeId },
      include: { organization: true, site: true, workType: true },
    });
    return this.toResponseDto(updated);
  }

  private toResponseDto(employee: any): EmployeeResponseDto {
    return {
      id: employee.id,
      employeeId: employee.employeeId,
      name: employee.name,
      organizationId: employee.organizationId,
      organizationName: employee.organization?.name,
      siteId: employee.siteId,
      siteName: employee.site?.name,
      position: employee.position,
      role: employee.role,
      email: employee.email,
      phone: employee.phone,
      workTypeId: employee.workTypeId,
      workTypeName: employee.workType?.name,
      status: employee.status,
      hireDate: employee.hireDate,
      createdAt: employee.createdAt,
      updatedAt: employee.updatedAt,
    };
  }
}
