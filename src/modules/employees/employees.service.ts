import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { Prisma, EmployeeStatus } from '@prisma/client';
import * as bcrypt from 'bcrypt';
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

  private ensureOrganizationInScope(
    organizationId: string | undefined,
    scopeOrganizationIds?: string[],
  ): void {
    if (!organizationId || !scopeOrganizationIds) return;
    if (!scopeOrganizationIds.includes(organizationId)) {
      throw new ForbiddenException('요청한 조직은 접근 권한 범위를 벗어났습니다.');
    }
  }

  private assertOrganizationInScope(
    organizationId: string | null | undefined,
    scopeOrganizationIds?: string[],
  ): void {
    if (!scopeOrganizationIds) return;
    if (!organizationId || !scopeOrganizationIds.includes(organizationId)) {
      throw new NotFoundException('직원을 찾을 수 없습니다.');
    }
  }

  async create(dto: CreateEmployeeDto, scopeOrganizationIds?: string[]): Promise<EmployeeResponseDto> {
    const normalizedEmployeeId = dto.employeeCode?.trim();
    const normalizedPhone = this.normalizePhone(dto.phone);

    if (!normalizedEmployeeId) {
      throw new BadRequestException('직원 ID는 필수 입력값입니다.');
    }

    if (!normalizedPhone) {
      throw new BadRequestException('전화번호는 필수 입력값입니다.');
    }

    await this.ensureUniqueEmployeeIdentity({
      employeeId: normalizedEmployeeId,
      phone: normalizedPhone,
    });

    this.ensureOrganizationInScope(dto.organizationId, scopeOrganizationIds);
    this.ensureOrganizationInScope(dto.siteId, scopeOrganizationIds);

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

    let employee;
    try {
      employee = await this.prisma.employee.create({
        data: {
          id: normalizedEmployeeId,
          name: dto.name,
          organizationId: dto.organizationId,
          siteId: dto.siteId,
          position: dto.position,
          role: dto.role,
          email: dto.email,
          phone: normalizedPhone,
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
    } catch (error) {
      this.handleUniqueConstraintError(error);
      throw error;
    }

    return this.toResponseDto(employee);
  }

  async findAll(
    filter: EmployeeFilterDto,
    scopeOrganizationIds?: string[],
  ): Promise<PaginatedResponse<EmployeeResponseDto>> {
    const where: Prisma.EmployeeWhereInput = {};

    // 조직 필터
    if (filter.organizationId) {
      this.ensureOrganizationInScope(filter.organizationId, scopeOrganizationIds);
      where.organizationId = filter.organizationId;
    } else if (scopeOrganizationIds) {
      where.organizationId = { in: scopeOrganizationIds };
    }

    // 현장 필터
    if (filter.siteId) {
      this.ensureOrganizationInScope(filter.siteId, scopeOrganizationIds);
      where.siteId = filter.siteId;
    }

    // 검색어 필터
    if (filter.search) {
      where.OR = [
        { id: { contains: filter.search, mode: 'insensitive' } },
        { name: { contains: filter.search, mode: 'insensitive' } },
        { email: { contains: filter.search, mode: 'insensitive' } },
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

  async findOne(employeeId: string, scopeOrganizationIds?: string[]): Promise<EmployeeDetailDto> {
    const employee = await this.prisma.employee.findUnique({
      where: { id: employeeId },
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

    this.assertOrganizationInScope(employee.organizationId, scopeOrganizationIds);

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

  async update(
    employeeId: string,
    dto: UpdateEmployeeDto,
    scopeOrganizationIds?: string[],
  ): Promise<EmployeeResponseDto> {
    await this.findOne(employeeId, scopeOrganizationIds); // 존재 여부 확인

    if ((dto.newPassword && !dto.confirmPassword) || (!dto.newPassword && dto.confirmPassword)) {
      throw new BadRequestException('새 비밀번호와 확인 비밀번호를 모두 입력해주세요.');
    }

    if (dto.newPassword && dto.confirmPassword && dto.newPassword !== dto.confirmPassword) {
      throw new BadRequestException('새 비밀번호가 일치하지 않습니다.');
    }

    const normalizedEmployeeCode = dto.employeeCode !== undefined ? dto.employeeCode?.trim() || '' : undefined;
    const normalizedPhone = dto.phone !== undefined ? this.normalizePhone(dto.phone) : undefined;

    if (normalizedEmployeeCode !== undefined && normalizedEmployeeCode !== employeeId) {
      throw new BadRequestException('직원 ID는 수정할 수 없습니다.');
    }

    if (dto.phone !== undefined && !normalizedPhone) {
      throw new BadRequestException('전화번호는 비워둘 수 없습니다.');
    }

    await this.ensureUniqueEmployeeIdentity({
      employeeId,
      phone: normalizedPhone,
      excludeEmployeeId: employeeId,
    });

    this.ensureOrganizationInScope(dto.organizationId, scopeOrganizationIds);
    this.ensureOrganizationInScope(dto.siteId, scopeOrganizationIds);

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

    let employee;
    try {
      employee = await this.prisma.$transaction(async (tx) => {
        const updatedEmployee = await tx.employee.update({
          where: { id: employeeId },
          data: {
            name: dto.name,
            organizationId: dto.organizationId,
            siteId: dto.siteId,
            position: dto.position,
            role: dto.role,
            email: dto.email,
            phone: normalizedPhone,
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

        if (dto.newPassword) {
          const passwordHash = await bcrypt.hash(dto.newPassword, 10);
          await tx.employeeAccount.upsert({
            where: { employeeId },
            update: { passwordHash, isActive: true },
            create: {
              employeeId,
              passwordHash,
              isActive: true,
            },
          });
        }

        return updatedEmployee;
      });
    } catch (error) {
      this.handleUniqueConstraintError(error);
      throw error;
    }

    return this.toResponseDto(employee);
  }

  async remove(employeeId: string, scopeOrganizationIds?: string[]): Promise<void> {
    const employee = await this.prisma.employee.findUnique({
      where: { id: employeeId },
      include: {
        _count: {
          select: { devices: true },
        },
      },
    });

    if (!employee) {
      throw new NotFoundException('직원을 찾을 수 없습니다.');
    }

    this.assertOrganizationInScope(employee.organizationId, scopeOrganizationIds);

    // 연결된 장치가 있으면 퇴사 처리
    if (employee._count.devices > 0) {
      await this.prisma.employee.update({
        where: { id: employeeId },
        data: { status: EmployeeStatus.RESIGNED },
      });
    } else {
      await this.prisma.employee.delete({
        where: { id: employeeId },
      });
    }
  }

  async bulkAssignWorkType(
    dto: BulkAssignWorkTypeDto,
    scopeOrganizationIds?: string[],
  ): Promise<{ updated: number }> {
    // 근무 유형 존재 여부 확인
    const workType = await this.prisma.workType.findUnique({
      where: { id: dto.workTypeId },
    });
    if (!workType) {
      throw new NotFoundException('근무 유형을 찾을 수 없습니다.');
    }

    const result = await this.prisma.employee.updateMany({
      where: {
        id: { in: dto.employeeIds },
        ...(scopeOrganizationIds ? { organizationId: { in: scopeOrganizationIds } } : {}),
      },
      data: { workTypeId: dto.workTypeId },
    });

    return { updated: result.count };
  }

  async bulkMoveOrganization(
    dto: BulkMoveOrganizationDto,
    scopeOrganizationIds?: string[],
  ): Promise<{ updated: number }> {
    this.ensureOrganizationInScope(dto.targetOrganizationId, scopeOrganizationIds);

    // 대상 조직 존재 여부 확인
    const organization = await this.prisma.organization.findUnique({
      where: { id: dto.targetOrganizationId },
    });
    if (!organization) {
      throw new NotFoundException('대상 조직을 찾을 수 없습니다.');
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.employee.updateMany({
        where: {
          id: { in: dto.employeeIds },
          ...(scopeOrganizationIds ? { organizationId: { in: scopeOrganizationIds } } : {}),
        },
        data: { organizationId: dto.targetOrganizationId },
      });

      // 조직 이동 후 타 조직 정책 개별 할당은 정합성을 위해 제거
      await tx.controlPolicyEmployee.deleteMany({
        where: {
          employeeId: { in: dto.employeeIds },
          ...(scopeOrganizationIds
            ? {
                employee: {
                  organizationId: { in: scopeOrganizationIds },
                },
              }
            : {}),
          policy: {
            organizationId: { not: dto.targetOrganizationId },
          },
        },
      });

      return updated;
    });

    return { updated: result.count };
  }

  async bulkUpdateStatus(
    employeeIds: string[],
    status: EmployeeStatusEnum,
    scopeOrganizationIds?: string[],
  ): Promise<{ updated: number }> {
    const result = await this.prisma.employee.updateMany({
      where: {
        id: { in: employeeIds },
        ...(scopeOrganizationIds ? { organizationId: { in: scopeOrganizationIds } } : {}),
      },
      data: { status: status as EmployeeStatus },
    });
    return { updated: result.count };
  }

  async getStats(scopeOrganizationIds?: string[]): Promise<{
    total: number; active: number; resigned: number; exception: number; leave: number;
    byOrganization: Record<string, number>;
  }> {
    const [total, byStatus, byOrg] = await Promise.all([
      this.prisma.employee.count({
        where: scopeOrganizationIds ? { organizationId: { in: scopeOrganizationIds } } : undefined,
      }),
      this.prisma.employee.groupBy({
        by: ['status'],
        where: scopeOrganizationIds ? { organizationId: { in: scopeOrganizationIds } } : undefined,
        _count: true,
      }),
      this.prisma.employee.groupBy({
        by: ['organizationId'],
        where: scopeOrganizationIds ? { organizationId: { in: scopeOrganizationIds } } : undefined,
        _count: true,
      }),
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

  async assignDevice(
    employeeId: string,
    deviceId: string,
    scopeOrganizationIds?: string[],
  ): Promise<EmployeeResponseDto> {
    const employee = await this.prisma.employee.findUnique({ where: { id: employeeId } });
    if (!employee) throw new NotFoundException('직원을 찾을 수 없습니다.');
    this.assertOrganizationInScope(employee.organizationId, scopeOrganizationIds);

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

  async unassignDevice(employeeId: string, scopeOrganizationIds?: string[]): Promise<EmployeeResponseDto> {
    const employee = await this.prisma.employee.findUnique({ where: { id: employeeId } });
    if (!employee) throw new NotFoundException('직원을 찾을 수 없습니다.');
    this.assertOrganizationInScope(employee.organizationId, scopeOrganizationIds);

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
      employeeId: employee.id,
      employeeCode: employee.id,
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

  private normalizePhone(phone?: string): string | undefined {
    if (phone === undefined || phone === null) {
      return undefined;
    }

    const digits = phone.replace(/\D/g, '');
    if (!digits) {
      return '';
    }

    if (digits.length === 11) {
      return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`;
    }

    if (digits.length === 10) {
      return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
    }

    return phone.trim();
  }

  private async ensureUniqueEmployeeIdentity(params: {
    employeeId?: string;
    phone?: string;
    excludeEmployeeId?: string;
  }): Promise<void> {
    const { employeeId, phone, excludeEmployeeId } = params;

    if (employeeId && employeeId !== excludeEmployeeId) {
      const existingByCode = await this.prisma.employee.findUnique({
        where: { id: employeeId },
        select: { id: true },
      });

      if (existingByCode) {
        throw new ConflictException('이미 사용 중인 직원 ID입니다.');
      }
    }

    if (phone) {
      const existingByPhone = await this.prisma.employee.findFirst({
        where: {
          phone,
          ...(excludeEmployeeId ? { id: { not: excludeEmployeeId } } : {}),
        },
        select: { id: true },
      });

      if (existingByPhone) {
        throw new ConflictException('이미 사용 중인 연락처입니다.');
      }
    }
  }

  private handleUniqueConstraintError(error: unknown): void {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') {
      return;
    }

    const target = Array.isArray(error.meta?.target) ? error.meta?.target : [];

    if (target.includes('phone')) {
      throw new ConflictException('이미 사용 중인 연락처입니다.');
    }

    if (target.includes('id')) {
      throw new ConflictException('이미 사용 중인 직원 ID입니다.');
    }

    throw new ConflictException('중복된 값이 있어 저장할 수 없습니다.');
  }
}
