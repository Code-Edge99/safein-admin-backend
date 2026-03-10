import {
  Injectable,
  NotFoundException,
  BadRequestException,
  BadGatewayException,
  ConflictException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { Prisma, EmployeeStatus, DeviceOperationStatus, DeviceOS, PushTokenStatus } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { randomUUID } from 'crypto';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { PaginatedResponse } from '../../common/dto';
import { assertOrganizationInScopeOrThrow, ensureOrganizationInScope } from '../../common/utils/organization-scope.util';
import { toEmployeeResponseDto } from './employees.mapper';
import { readStageConfig } from '../../common/config/stage.config';
import {
  CreateEmployeeDto,
  UpdateEmployeeDto,
  EmployeeResponseDto,
  EmployeeDetailDto,
  EmployeeFilterDto,
  EmployeeMdmManualUnblockDto,
  BulkAssignWorkTypeDto,
  BulkMoveOrganizationDto,
  EmployeeStatusEnum,
} from './dto';

@Injectable()
export class EmployeesService {
  private readonly logger = new Logger(EmployeesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  private ensureOrganizationInScope(
    organizationId: string | undefined,
    scopeOrganizationIds?: string[],
  ): void {
    ensureOrganizationInScope(organizationId, scopeOrganizationIds);
  }

  private assertOrganizationInScope(
    organizationId: string | null | undefined,
    scopeOrganizationIds?: string[],
  ): void {
    assertOrganizationInScopeOrThrow(organizationId, scopeOrganizationIds, '직원을 찾을 수 없습니다.');
  }

  private assertNotDeletedStatus(status: EmployeeStatus): void {
    if (status === ('DELETE' as EmployeeStatus)) {
      throw new NotFoundException('직원을 찾을 수 없습니다.');
    }
  }

  async create(dto: CreateEmployeeDto, scopeOrganizationIds?: string[]): Promise<EmployeeResponseDto> {
    const normalizedEmployeeId = dto.employeeId?.trim();

    if (!normalizedEmployeeId) {
      throw new BadRequestException('직원 ID는 필수 입력값입니다.');
    }

    await this.ensureUniqueEmployeeIdentity({
      employeeId: normalizedEmployeeId,
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
          memo: dto.memo?.trim() || null,
          workTypeId: dto.workTypeId,
          status: (dto.status as EmployeeStatus) || EmployeeStatus.ACTIVE,
          hireDate: dto.hireDate ? new Date(dto.hireDate) : undefined,
        } as any,
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
    } else {
      where.status = { not: 'DELETE' as EmployeeStatus };
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

    this.assertNotDeletedStatus(employee.status as EmployeeStatus);

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

    const previousEmployee = await this.prisma.employee.findUnique({
      where: { id: employeeId },
      select: {
        id: true,
        status: true,
      },
    });

    if ((dto.newPassword && !dto.confirmPassword) || (!dto.newPassword && dto.confirmPassword)) {
      throw new BadRequestException('새 비밀번호와 확인 비밀번호를 모두 입력해주세요.');
    }

    if (dto.newPassword && dto.confirmPassword && dto.newPassword !== dto.confirmPassword) {
      throw new BadRequestException('새 비밀번호가 일치하지 않습니다.');
    }

    const requestedEmployeeId = dto.employeeId !== undefined ? dto.employeeId?.trim() || '' : undefined;

    if (requestedEmployeeId !== undefined && !requestedEmployeeId) {
      throw new BadRequestException('직원 ID는 비워둘 수 없습니다.');
    }

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
        let workingEmployeeId = employeeId;

        if (requestedEmployeeId && requestedEmployeeId !== employeeId) {
          workingEmployeeId = await this.reassignEmployeeId(
            tx,
            employeeId,
            requestedEmployeeId,
            Boolean(dto.confirmIdReassignment),
          );
        }

        const updatedEmployee = await tx.employee.update({
          where: { id: workingEmployeeId },
          data: {
            name: dto.name,
            organizationId: dto.organizationId,
            siteId: dto.siteId,
            position: dto.position,
            role: dto.role,
            email: dto.email,
            memo: dto.memo !== undefined ? (dto.memo.trim() || null) : undefined,
            workTypeId: dto.workTypeId,
            status: dto.status as EmployeeStatus | undefined,
            hireDate: dto.hireDate ? new Date(dto.hireDate) : undefined,
          } as any,
          include: {
            organization: true,
            site: true,
            workType: true,
          },
        });

        if (dto.newPassword) {
          const passwordHash = await bcrypt.hash(dto.newPassword, 10);
          await tx.employeeAccount.upsert({
            where: { employeeId: workingEmployeeId },
            update: { passwordHash, isActive: true },
            create: {
              employeeId: workingEmployeeId,
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

    if (
      previousEmployee
      && dto.status
      && this.isNonActiveEmployeeStatus(dto.status as EmployeeStatus)
      && previousEmployee.status !== (dto.status as EmployeeStatus)
    ) {
      await this.notifyPolicyChangedForEmployees([employee.id], 'employee_status_non_active');
    }

    return this.toResponseDto(employee);
  }

  async remove(employeeId: string, scopeOrganizationIds?: string[]): Promise<void> {
    const employee = await this.prisma.employee.findUnique({
      where: { id: employeeId },
      select: {
        id: true,
        name: true,
        organizationId: true,
        hireDate: true,
      },
    });

    if (!employee) {
      throw new NotFoundException('직원을 찾을 수 없습니다.');
    }

    this.assertOrganizationInScope(employee.organizationId, scopeOrganizationIds);

    const archiveEmployeeId = this.buildDeletedEmployeeArchiveId(employee.id);
    const archivePasswordHash = await bcrypt.hash(randomUUID(), 10);

    await this.prisma.$transaction(async (tx) => {
      const employeeDevices = await tx.device.findMany({
        where: { employeeId: employee.id },
        select: { id: true },
      });
      const employeeDeviceIds = employeeDevices.map((device) => device.id);

      await tx.employee.create({
        data: {
          id: archiveEmployeeId,
          name: employee.name || '삭제된 직원',
          organizationId: employee.organizationId,
          status: 'DELETE' as EmployeeStatus,
          memo: `삭제 아카이브 계정 (원본 직원ID: ${employee.id})`,
          hireDate: employee.hireDate,
          phone: null,
          email: null,
          position: null,
          role: null,
          workTypeId: null,
          siteId: null,
        },
      });

      await tx.controlPolicyEmployee.deleteMany({
        where: { employeeId: employee.id },
      });

      await tx.employeeExclusion.deleteMany({
        where: { employeeId: employee.id },
      });

      await tx.device.updateMany({
        where: { employeeId: employee.id },
        data: {
          employeeId: null,
          deviceStatus: DeviceOperationStatus.UNASSIGNED,
          mdmManualUnblockUntilLogin: false,
          mdmManualUnblockReason: null,
          mdmManualUnblockSetAt: null,
        },
      });

      await tx.deviceToken.updateMany({
        where: { deviceId: { in: employeeDeviceIds } },
        data: {
          isValid: false,
          refreshToken: null,
          expiresAt: null,
        },
      });

      await tx.controlLog.updateMany({
        where: { employeeId: employee.id },
        data: { employeeId: archiveEmployeeId },
      });

      await tx.employeeDailyStat.updateMany({
        where: { employeeId: employee.id },
        data: { employeeId: archiveEmployeeId },
      });

      await tx.zoneVisitSession.updateMany({
        where: { employeeId: employee.id },
        data: { employeeId: archiveEmployeeId },
      });

      await tx.appUsageSession.updateMany({
        where: { employeeId: employee.id },
        data: { employeeId: archiveEmployeeId },
      });

      await tx.workSession.updateMany({
        where: { employeeId: employee.id },
        data: { employeeId: archiveEmployeeId },
      });

      const employeeAccount = await tx.employeeAccount.findUnique({
        where: { employeeId: employee.id },
        select: { id: true },
      });

      if (employeeAccount) {
        await tx.employeeAccount.update({
          where: { employeeId: employee.id },
          data: {
            employeeId: archiveEmployeeId,
            isActive: false,
            passwordHash: archivePasswordHash,
          },
        });
      }

      await tx.employee.delete({
        where: { id: employee.id },
      });
    });
  }

  private buildDeletedEmployeeArchiveId(employeeId: string): string {
    return `deleted:${employeeId}:${randomUUID()}`;
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
    const normalizedStatus = status as EmployeeStatus;

    const targetEmployees = await this.prisma.employee.findMany({
      where: {
        id: { in: employeeIds },
        ...(scopeOrganizationIds ? { organizationId: { in: scopeOrganizationIds } } : {}),
      },
      select: {
        id: true,
        status: true,
      },
    });

    const shouldNotifyEmployeeIds = this.isNonActiveEmployeeStatus(normalizedStatus)
      ? targetEmployees
        .filter((employee) => employee.status !== normalizedStatus)
        .map((employee) => employee.id)
      : [];

    const result = await this.prisma.employee.updateMany({
      where: {
        id: { in: employeeIds },
        ...(scopeOrganizationIds ? { organizationId: { in: scopeOrganizationIds } } : {}),
      },
      data: { status: normalizedStatus },
    });

    if (shouldNotifyEmployeeIds.length > 0) {
      await this.notifyPolicyChangedForEmployees(shouldNotifyEmployeeIds, 'employee_status_non_active');
    }

    return { updated: result.count };
  }

  async getStats(scopeOrganizationIds?: string[]): Promise<{
    total: number; active: number; resigned: number; exception: number; leave: number;
    deviceAssigned: number;
    byOrganization: Record<string, number>;
  }> {
    const whereBase: Prisma.EmployeeWhereInput = {
      status: { not: 'DELETE' as EmployeeStatus },
      ...(scopeOrganizationIds ? { organizationId: { in: scopeOrganizationIds } } : {}),
    };

    const [total, byStatus, byOrg, deviceAssigned] = await Promise.all([
      this.prisma.employee.count({
        where: whereBase,
      }),
      this.prisma.employee.groupBy({
        by: ['status'],
        where: whereBase,
        _count: true,
      }),
      this.prisma.employee.groupBy({
        by: ['organizationId'],
        where: whereBase,
        _count: true,
      }),
      this.prisma.device.count({
        where: {
          employeeId: { not: null },
          ...(scopeOrganizationIds ? { organizationId: { in: scopeOrganizationIds } } : {}),
        },
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
      deviceAssigned,
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
    this.assertNotDeletedStatus(employee.status);
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
    this.assertNotDeletedStatus(employee.status);
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

  async setMdmManualUnblock(
    employeeId: string,
    dto: EmployeeMdmManualUnblockDto,
    scopeOrganizationIds?: string[],
  ) {
    const employee = await this.prisma.employee.findUnique({ where: { id: employeeId } });
    if (!employee) {
      throw new NotFoundException('직원을 찾을 수 없습니다.');
    }
    this.assertNotDeletedStatus(employee.status);
    this.assertOrganizationInScope(employee.organizationId, scopeOrganizationIds);

    const normalizedDeviceId = dto.deviceId?.trim();
    if (!normalizedDeviceId) {
      throw new BadRequestException('deviceId는 필수입니다.');
    }

    const device = await this.prisma.device.findFirst({
      where: {
        deviceId: normalizedDeviceId,
        employeeId,
      },
      select: {
        id: true,
        deviceId: true,
        employeeId: true,
      },
    });

    if (!device) {
      throw new BadRequestException('해당 직원에게 할당된 디바이스를 찾을 수 없습니다.');
    }

    const appBackendResponse = await this.callAppBackendMdmManualUnblock({
      deviceId: device.deviceId,
      reason: dto.reason,
    });

    return {
      ok: true,
      employeeId,
      deviceId: device.deviceId,
      appBackendResponse,
    };
  }

  private toResponseDto(employee: any): EmployeeResponseDto {
    return toEmployeeResponseDto(employee);
  }

  private async ensureUniqueEmployeeIdentity(params: {
    employeeId?: string;
    excludeEmployeeId?: string;
  }): Promise<void> {
    const { employeeId, excludeEmployeeId } = params;

    if (employeeId && employeeId !== excludeEmployeeId) {
      const existingByCode = await this.prisma.employee.findUnique({
        where: { id: employeeId },
        select: { id: true },
      });

      if (existingByCode) {
        throw new ConflictException('이미 사용 중인 직원 ID입니다.');
      }
    }
  }

  private async reassignEmployeeId(
    tx: Prisma.TransactionClient,
    currentEmployeeId: string,
    requestedEmployeeId: string,
    confirmed: boolean,
  ): Promise<string> {
    const existingTarget = await tx.employee.findUnique({
      where: { id: requestedEmployeeId },
      select: { id: true },
    });

    if (existingTarget) {
      if (!confirmed) {
        throw new ConflictException(
          '입력한 아이디를 이미 사용하는 직원이 있습니다. 기존 사용자를 "아이디 정보 확인" 상태로 전환하고 아이디를 재할당하려면 confirmIdReassignment=true로 다시 요청하세요.',
        );
      }

      await this.moveEmployeeToPhoneInfoReview(
        tx,
        requestedEmployeeId,
        `관리자 아이디 변경으로 기존 아이디 재할당됨(신규 대상: ${currentEmployeeId})`,
      );
    }

    await tx.employee.create({
      data: {
        id: requestedEmployeeId,
        name: '임시',
        organizationId: (await tx.employee.findUniqueOrThrow({ where: { id: currentEmployeeId }, select: { organizationId: true } })).organizationId,
      },
    });

    await this.repointEmployeeReferences(tx, currentEmployeeId, requestedEmployeeId);
    await tx.employee.delete({ where: { id: currentEmployeeId } });

    return requestedEmployeeId;
  }

  private async moveEmployeeToPhoneInfoReview(
    tx: Prisma.TransactionClient,
    employeeId: string,
    reason: string,
  ): Promise<void> {
    const reviewEmployeeId = this.buildPhoneReviewEmployeeId(employeeId);

    await tx.employee.create({
      data: {
        id: reviewEmployeeId,
        name: '아이디 재검증 필요 사용자',
        organizationId: (await tx.employee.findUniqueOrThrow({ where: { id: employeeId }, select: { organizationId: true } })).organizationId,
        status: 'PHONE_INFO_REVIEW' as EmployeeStatus,
        memo: reason,
      },
    });

    await this.repointEmployeeReferences(tx, employeeId, reviewEmployeeId);
    await tx.employee.delete({ where: { id: employeeId } });
  }

  private async repointEmployeeReferences(
    tx: Prisma.TransactionClient,
    fromEmployeeId: string,
    toEmployeeId: string,
  ): Promise<void> {
    await tx.controlPolicyEmployee.updateMany({ where: { employeeId: fromEmployeeId }, data: { employeeId: toEmployeeId } });
    await tx.employeeExclusion.updateMany({ where: { employeeId: fromEmployeeId }, data: { employeeId: toEmployeeId } });
    await tx.controlLog.updateMany({ where: { employeeId: fromEmployeeId }, data: { employeeId: toEmployeeId } });
    await tx.employeeDailyStat.updateMany({ where: { employeeId: fromEmployeeId }, data: { employeeId: toEmployeeId } });
    await tx.zoneVisitSession.updateMany({ where: { employeeId: fromEmployeeId }, data: { employeeId: toEmployeeId } });
    await tx.appUsageSession.updateMany({ where: { employeeId: fromEmployeeId }, data: { employeeId: toEmployeeId } });
    await tx.workSession.updateMany({ where: { employeeId: fromEmployeeId }, data: { employeeId: toEmployeeId } });
    await tx.device.updateMany({ where: { employeeId: fromEmployeeId }, data: { employeeId: toEmployeeId } });

    const account = await tx.employeeAccount.findUnique({ where: { employeeId: fromEmployeeId }, select: { id: true } });
    if (account) {
      await tx.employeeAccount.update({ where: { employeeId: fromEmployeeId }, data: { employeeId: toEmployeeId } });
    }
  }

  private buildPhoneReviewEmployeeId(previousEmployeeId: string): string {
    return `phone-review:${previousEmployeeId}:${randomUUID()}`;
  }

  private handleUniqueConstraintError(error: unknown): void {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') {
      return;
    }

    const target = Array.isArray(error.meta?.target) ? error.meta?.target : [];

    if (target.includes('id')) {
      throw new ConflictException('이미 사용 중인 직원 ID입니다.');
    }

    throw new ConflictException('중복된 값이 있어 저장할 수 없습니다.');
  }

  private getAppBackendBaseUrl(): string {
    const baseUrl = readStageConfig(this.configService, 'APP_BACKEND_BASE_URL', {
      local: 'http://localhost:3100/api/app',
      dev: 'http://app-backend:3100/api/app',
      prod: 'http://app-backend:3100/api/app',
    });
    return baseUrl.trim().replace(/\/$/, '');
  }

  private getAppBackendMdmAdminSecret(): string | undefined {
    return this.configService.get<string>('APP_BACKEND_MDM_ADMIN_SECRET')?.trim()
      || this.configService.get<string>('MDM_ADMIN_INTERNAL_SECRET')?.trim();
  }

  private async callAppBackendMdmManualUnblock(payload: { deviceId: string; reason?: string }) {
    const endpointUrl = `${this.getAppBackendBaseUrl()}/mdm/admin/manual-unblock`;
    const secret = this.getAppBackendMdmAdminSecret();

    const response = await fetch(endpointUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(secret ? { 'x-admin-internal-secret': secret } : {}),
      },
      body: JSON.stringify({
        deviceId: payload.deviceId,
        ...(payload.reason?.trim() ? { reason: payload.reason.trim() } : {}),
      }),
    });

    if (!response.ok) {
      const responseText = await response.text();
      throw new BadGatewayException(
        `app-backend 수동 해제 호출 실패(status=${response.status}): ${responseText || 'empty response'}`,
      );
    }

    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      return response.json();
    }

    return { ok: true };
  }

  private isNonActiveEmployeeStatus(status?: EmployeeStatus): boolean {
    return !!status && status !== EmployeeStatus.ACTIVE;
  }

  private async notifyPolicyChangedForEmployees(
    employeeIds: string[],
    trigger: 'employee_status_non_active',
  ): Promise<void> {
    const uniqueEmployeeIds = Array.from(new Set(employeeIds.filter(Boolean)));
    if (uniqueEmployeeIds.length === 0) {
      return;
    }

    const devices = await this.prisma.device.findMany({
      where: {
        employeeId: { in: uniqueEmployeeIds },
        pushToken: { not: null },
        pushTokenStatus: { not: PushTokenStatus.ERROR },
      },
      select: {
        id: true,
        os: true,
        pushToken: true,
        employeeId: true,
      },
    });

    const endpointUrl = `${this.getAppBackendBaseUrl()}/internal/push/fcm/send`;
    let successCount = 0;
    let failedCount = 0;

    for (const device of devices) {
      const token = device.pushToken?.trim();
      if (!token) {
        continue;
      }

      try {
        await this.sendPolicyChangedPush(endpointUrl, {
          token,
          os: device.os,
          trigger,
          policyApplied: false,
        });
        successCount += 1;
      } catch (error) {
        failedCount += 1;
        this.logger.warn(
          `직원 상태 변경 policy_changed 전송 실패(deviceId=${device.id}, employeeId=${device.employeeId}): ${String(error)}`,
        );
      }
    }

    this.logger.log(
      `직원 상태 변경 policy_changed 전송 완료(trigger=${trigger}, employees=${uniqueEmployeeIds.length}, devices=${devices.length}, success=${successCount}, failed=${failedCount})`,
    );
  }

  private async sendPolicyChangedPush(
    endpointUrl: string,
    params: {
      token: string;
      os: DeviceOS;
      trigger: string;
      policyApplied: boolean;
    },
  ): Promise<void> {
    const response = await fetch(endpointUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message: {
          token: params.token,
          data: {
            type: 'policy_changed',
            policyVersion: String(Date.now()),
            extraData: {
              reason: params.trigger,
              trigger: params.trigger,
              policyApplied: params.policyApplied ? 'true' : 'false',
            },
          },
          ...(params.os === DeviceOS.Android
            ? {
              android: {
                priority: 'HIGH',
              },
            }
            : {
              apns: {
                headers: {
                  'apns-priority': '10',
                  'apns-collapse-id': 'policy_changed',
                },
                payload: {
                  aps: {
                    'content-available': 1,
                    sound: 'default',
                  },
                },
              },
            }),
        },
      }),
    });

    if (!response.ok) {
      const responseText = await response.text();
      throw new BadGatewayException(
        `policy_changed 호출 실패(status=${response.status}): ${responseText || 'empty response'}`,
      );
    }
  }
}
