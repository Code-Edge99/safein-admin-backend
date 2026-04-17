import {
  Injectable,
  NotFoundException,
  BadRequestException,
  BadGatewayException,
  ConflictException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { Prisma, EmployeeStatus, DeviceOperationStatus, DeviceOS, PushTokenStatus, AuditAction } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { randomUUID } from 'crypto';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { PaginatedResponse } from '../../common/dto';
import {
  assertOrganizationInScopeOrThrow,
  ensureOrganizationInScope,
  assertUnitOrganization,
  resolveOrganizationClassification,
} from '../../common/utils/organization-scope.util';
import { findEmployeeByIdentifier, normalizePhoneEmployeeId, resolveEmployeePrimaryIds } from '../../common/utils/employee-identifier.util';
import { parseDateInputAsUtc } from '../../common/utils/kst-time.util';
import { toEmployeeResponseDto } from './employees.mapper';
import { readStageConfig } from '../../common/config/stage.config';
import {
  CreateEmployeeDto,
  UpdateEmployeeDto,
  EmployeeResponseDto,
  EmployeeDetailDto,
  EmployeeFilterDto,
  EmployeeMdmManualUnblockDto,
  EmployeeDeviceLogoutUntilNextLoginDto,
  BulkMoveOrganizationDto,
  BulkEmployeeUploadDto,
  BulkEmployeeUploadResponseDto,
  EmployeeStatusEnum,
  EmployeeStatusGroupEnum,
  HardDeleteExpiredDeletedEmployeesDto,
} from './dto';

class EmployeePolicyPushSendError extends Error {
  constructor(
    message: string,
    readonly shouldMarkTokenAsError: boolean,
  ) {
    super(message);
    this.name = 'EmployeePolicyPushSendError';
  }
}

@Injectable()
export class EmployeesService {
  private readonly logger = new Logger(EmployeesService.name);
  private static readonly DELETED_RETENTION_DAYS = 30;

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

  private normalizeEmployeeId(value?: string | null): string {
    return normalizePhoneEmployeeId(value);
  }

  private normalizeOptionalText(value?: string | null): string | null {
    if (typeof value !== 'string') {
      return null;
    }

    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  private normalizeOptionalEmail(value?: string | null): string | null {
    if (typeof value !== 'string') {
      return null;
    }

    const trimmed = value.trim().toLowerCase();
    return trimmed.length > 0 ? trimmed : null;
  }

  private normalizeCompanyName(value?: string | null): string {
    if (typeof value !== 'string') {
      return '';
    }

    return value.trim().toLowerCase();
  }

  private normalizeTeamCode(value?: string | null): string | null {
    if (typeof value !== 'string') {
      return null;
    }

    const normalized = value.trim().toUpperCase();
    return normalized.length > 0 ? normalized : null;
  }

  private async resolveScopedCompanyOrganizationIds(scopeOrganizationIds?: string[]): Promise<string[]> {
    const organizations = await this.prisma.organization.findMany({
      where: scopeOrganizationIds ? { id: { in: scopeOrganizationIds } } : undefined,
      select: {
        id: true,
        parentId: true,
        teamCode: true,
      },
    });

    return organizations
      .filter((organization) => resolveOrganizationClassification(organization) === 'COMPANY')
      .map((organization) => organization.id);
  }

  private normalizeRequestedStatus(status?: EmployeeStatus): EmployeeStatus | undefined {
    if (!status) {
      return status;
    }

    return status === ('PHONE_INFO_REVIEW' as EmployeeStatus)
      ? ('DELETE' as EmployeeStatus)
      : status;
  }

  private async validateEmployeeAssignment(
    organizationId: string,
  ): Promise<void> {
    const organization = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { id: true, parentId: true },
    });

    if (!organization) {
      throw new NotFoundException('현장을 찾을 수 없습니다.');
    }

    await assertUnitOrganization(this.prisma, organizationId);
  }

  private async getOrganizationNodes(): Promise<Array<{ id: string; parentId: string | null; teamCode: string | null }>> {
    return this.prisma.organization.findMany({
      select: {
        id: true,
        parentId: true,
        teamCode: true,
      },
    });
  }

  private resolveDescendantUnitIds(
    groupId: string,
    organizations: Array<{ id: string; parentId: string | null; teamCode: string | null }>,
  ): string[] {
    const byId = new Map(organizations.map((org) => [org.id, org] as const));
    const group = byId.get(groupId);

    if (!group) {
      throw new NotFoundException('그룹을 찾을 수 없습니다.');
    }

    if (resolveOrganizationClassification(group) !== 'GROUP') {
      throw new BadRequestException('그룹 필터에는 그룹만 선택할 수 있습니다.');
    }

    const childrenMap = organizations.reduce<Record<string, string[]>>((acc, org) => {
      if (!org.parentId) {
        return acc;
      }

      if (!acc[org.parentId]) {
        acc[org.parentId] = [];
      }

      acc[org.parentId].push(org.id);
      return acc;
    }, {});

    const unitIds: string[] = [];
    const stack: string[] = [groupId];

    while (stack.length > 0) {
      const current = stack.pop()!;
      const childIds = childrenMap[current] || [];

      for (const childId of childIds) {
        const child = byId.get(childId);
        if (!child) {
          continue;
        }

        const classification = resolveOrganizationClassification(child);
        if (classification === 'UNIT') {
          unitIds.push(child.id);
          continue;
        }

        stack.push(child.id);
      }
    }

    return unitIds;
  }

  async create(
    dto: CreateEmployeeDto,
    scopeOrganizationIds?: string[],
    actorUserId?: string,
  ): Promise<EmployeeResponseDto> {
    const normalizedEmployeeId = this.normalizeEmployeeId(dto.employeeId);
    const normalizedName = dto.name?.trim();
    const normalizedPosition = this.normalizeOptionalText(dto.position);
    const normalizedRole = this.normalizeOptionalText(dto.role);
    const normalizedEmail = this.normalizeOptionalEmail(dto.email ?? null);
    const normalizedMemo = this.normalizeOptionalText(dto.memo);
    const normalizedStatus = this.normalizeRequestedStatus(dto.status as EmployeeStatus) ?? EmployeeStatus.ACTIVE;

    if (!normalizedEmployeeId) {
      throw new BadRequestException('직원 ID는 필수 입력값입니다.');
    }

    if (!normalizedName) {
      throw new BadRequestException('직원 이름은 필수 입력값입니다.');
    }

    await this.ensureUniqueEmployeeIdentity({
      employeeId: normalizedEmployeeId,
    });

    this.ensureOrganizationInScope(dto.organizationId, scopeOrganizationIds);

    await this.validateEmployeeAssignment(dto.organizationId);

    let employee;
    try {
      employee = await this.prisma.employee.create({
        data: {
          id: normalizedEmployeeId,
          name: normalizedName,
          organizationId: dto.organizationId,
          position: normalizedPosition,
          role: normalizedRole,
          email: normalizedEmail,
          memo: normalizedMemo,
          status: normalizedStatus,
          createdById: actorUserId,
          updatedById: actorUserId,
        } as any,
        include: {
          organization: true,
        },
      });
    } catch (error) {
      this.handleUniqueConstraintError(error);
      throw error;
    }

    // 초기 비밀번호가 제공된 경우 EmployeeAccount 생성
    if (dto.password) {
      const passwordHash = await bcrypt.hash(dto.password, 10);
      await this.prisma.employeeAccount.upsert({
        where: { employeeId: employee.id },
        update: { passwordHash, isActive: true },
        create: {
          employeeId: employee.id,
          passwordHash,
          isActive: true,
        },
      });
    }

    return this.toResponseDto(employee);
  }

  async bulkUploadByCompanyTeam(
    dto: BulkEmployeeUploadDto,
    scopeOrganizationIds?: string[],
    actorUserId?: string,
  ): Promise<BulkEmployeeUploadResponseDto> {
    const rows = Array.isArray(dto?.rows) ? dto.rows : [];
    const requested = rows.length;

    if (requested === 0) {
      return {
        requested: 0,
        created: 0,
        failed: 0,
        errors: [],
      };
    }

    if (requested > 1000) {
      throw new BadRequestException('대량등록은 한 번에 최대 1000건까지 가능합니다.');
    }

    const organizations = await this.prisma.organization.findMany({
      where: {
        isActive: true,
        ...(scopeOrganizationIds ? { id: { in: scopeOrganizationIds } } : {}),
      },
      select: {
        id: true,
        name: true,
        parentId: true,
        teamCode: true,
      },
    });

    const organizationById = new Map(organizations.map((organization) => [organization.id, organization] as const));
    const resolveCompanyId = (organizationId: string): string | null => {
      const visited = new Set<string>();
      let current = organizationById.get(organizationId) || null;

      while (current && !visited.has(current.id)) {
        visited.add(current.id);
        const classification = resolveOrganizationClassification(current);
        if (classification === 'COMPANY') {
          return current.id;
        }

        const parentId = current.parentId;
        if (!parentId) {
          break;
        }

        current = organizationById.get(parentId) || null;
      }

      return null;
    };

    const companiesByName = new Map<string, Array<{ id: string; name: string }>>();
    const unitsByCompanyAndTeamCode = new Map<string, { id: string; name: string } | null>();

    organizations.forEach((organization) => {
      const classification = resolveOrganizationClassification(organization);
      if (classification === 'COMPANY') {
        const key = this.normalizeCompanyName(organization.name);
        const list = companiesByName.get(key) || [];
        list.push({ id: organization.id, name: organization.name });
        companiesByName.set(key, list);
      }
    });

    organizations.forEach((organization) => {
      const classification = resolveOrganizationClassification(organization);
      if (classification !== 'UNIT') {
        return;
      }

      const companyId = resolveCompanyId(organization.id);
      const normalizedTeamCode = this.normalizeTeamCode(organization.teamCode);
      if (!companyId || !normalizedTeamCode) {
        return;
      }

      const key = `${companyId}|${normalizedTeamCode}`;
      if (unitsByCompanyAndTeamCode.has(key)) {
        unitsByCompanyAndTeamCode.set(key, null);
        return;
      }

      unitsByCompanyAndTeamCode.set(key, {
        id: organization.id,
        name: organization.name,
      });
    });

    const requestedEmployeeIds = Array.from(new Set(
      rows
        .map((row) => this.normalizeEmployeeId(row.employeeId))
        .filter(Boolean),
    ));

    const existingEmployees = requestedEmployeeIds.length > 0
      ? await this.prisma.employee.findMany({
        where: { id: { in: requestedEmployeeIds } },
        select: { id: true },
      })
      : [];

    const existingEmployeeIdSet = new Set(existingEmployees.map((employee) => employee.id));
    const seenEmployeeIdSet = new Set<string>();

    const errors: BulkEmployeeUploadResponseDto['errors'] = [];
    let created = 0;

    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index];
      const rowNumber = Number(row?.rowNumber) > 0 ? Number(row.rowNumber) : index + 2;
      const employeeId = this.normalizeEmployeeId(row?.employeeId);
      const name = row?.name?.trim() || '';
      const companyName = row?.companyName?.trim() || '';
      const teamCode = this.normalizeTeamCode(row?.teamCode);

      const pushError = (code: string, message: string) => {
        errors.push({
          rowNumber,
          employeeId: employeeId || undefined,
          companyName: companyName || undefined,
          teamCode: teamCode || undefined,
          code,
          message,
        });
      };

      if (!employeeId) {
        pushError('INVALID_EMPLOYEE_ID', '직원 ID(휴대폰 번호)가 비어있거나 형식이 올바르지 않습니다.');
        continue;
      }

      if (!name) {
        pushError('MISSING_NAME', '직원 이름은 필수입니다.');
        continue;
      }

      if (!companyName) {
        pushError('MISSING_COMPANY_NAME', '회사명은 필수입니다.');
        continue;
      }

      if (seenEmployeeIdSet.has(employeeId) || existingEmployeeIdSet.has(employeeId)) {
        pushError('DUPLICATE_EMPLOYEE_ID', '이미 사용 중인 직원 ID입니다.');
        continue;
      }

      const companyCandidates = companiesByName.get(this.normalizeCompanyName(companyName)) || [];
      if (companyCandidates.length === 0) {
        pushError('COMPANY_NOT_FOUND', `회사명 '${companyName}'과(와) 일치하는 회사를 찾을 수 없습니다.`);
        continue;
      }

      if (companyCandidates.length > 1) {
        pushError('COMPANY_AMBIGUOUS', `회사명 '${companyName}'에 해당하는 회사가 여러 개입니다. 회사명을 구체적으로 확인해주세요.`);
        continue;
      }

      const company = companyCandidates[0];
      const targetOrganizationId = (() => {
        if (!teamCode) {
          return company.id;
        }

        const key = `${company.id}|${teamCode}`;
        const unit = unitsByCompanyAndTeamCode.get(key);

        if (unit === undefined) {
          pushError('TEAM_CODE_NOT_FOUND', `회사 '${company.name}'에서 팀코드 '${teamCode}'와 일치하는 팀을 찾을 수 없습니다.`);
          return null;
        }

        if (unit === null) {
          pushError('TEAM_CODE_AMBIGUOUS', `회사 '${company.name}'에서 팀코드 '${teamCode}'가 중복되어 매핑할 수 없습니다.`);
          return null;
        }

        return unit.id;
      })();

      if (!targetOrganizationId) {
        continue;
      }

      const targetStatus = !teamCode
        ? EmployeeStatus.EXCEPTION
        : EmployeeStatus.ACTIVE;

      const normalizedPosition = this.normalizeOptionalText(row?.position);
      const normalizedRole = this.normalizeOptionalText(row?.role);
      const normalizedEmail = this.normalizeOptionalEmail(row?.email ?? null);
      const normalizedMemo = this.normalizeOptionalText(row?.memo);
      const normalizedPassword = this.normalizeOptionalText(row?.password);

      if (normalizedEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
        pushError('INVALID_EMAIL', '이메일 형식이 올바르지 않습니다.');
        continue;
      }

      if (normalizedPassword && normalizedPassword.length < 8) {
        pushError('INVALID_PASSWORD', '초기 비밀번호는 8자 이상이어야 합니다.');
        continue;
      }

      try {
        await this.prisma.employee.create({
          data: {
            id: employeeId,
            name,
            organizationId: targetOrganizationId,
            position: normalizedPosition,
            role: normalizedRole,
            email: normalizedEmail,
            memo: normalizedMemo,
            status: targetStatus,
            createdById: actorUserId,
            updatedById: actorUserId,
          } as any,
        });

        if (normalizedPassword) {
          const passwordHash = await bcrypt.hash(normalizedPassword, 10);
          await this.prisma.employeeAccount.upsert({
            where: { employeeId },
            update: { passwordHash, isActive: true },
            create: {
              employeeId,
              passwordHash,
              isActive: true,
            },
          });
        }

        seenEmployeeIdSet.add(employeeId);
        existingEmployeeIdSet.add(employeeId);
        created += 1;
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          pushError('DUPLICATE_EMPLOYEE_ID', '이미 사용 중인 직원 ID입니다.');
          continue;
        }

        this.logger.warn(`직원 대량등록 실패(row=${rowNumber}, employeeId=${employeeId}): ${String(error)}`);
        pushError('CREATE_FAILED', '직원 생성 중 오류가 발생했습니다.');
      }
    }

    return {
      requested,
      created,
      failed: errors.length,
      errors,
    };
  }

  async findAll(
    filter: EmployeeFilterDto,
    scopeOrganizationIds?: string[],
  ): Promise<PaginatedResponse<EmployeeResponseDto>> {
    const where: Prisma.EmployeeWhereInput = {};
    const andConditions: Prisma.EmployeeWhereInput[] = [];

    const requestedUnitId = filter.unitId?.trim();
    const requestedGroupId = filter.groupId?.trim();
    const requestedOrganizationId = filter.organizationId?.trim();

    if (requestedUnitId) {
      this.ensureOrganizationInScope(requestedUnitId, scopeOrganizationIds);
      await assertUnitOrganization(this.prisma, requestedUnitId);

      if (requestedGroupId) {
        this.ensureOrganizationInScope(requestedGroupId, scopeOrganizationIds);

        const organizations = await this.getOrganizationNodes();
        const groupUnitIds = this.resolveDescendantUnitIds(requestedGroupId, organizations);
        if (!groupUnitIds.includes(requestedUnitId)) {
          throw new BadRequestException('선택한 단위가 선택한 그룹에 속하지 않습니다.');
        }
      }

      where.organizationId = requestedUnitId;
    } else if (requestedGroupId) {
      this.ensureOrganizationInScope(requestedGroupId, scopeOrganizationIds);

      const organizations = await this.getOrganizationNodes();
      const groupUnitIds = this.resolveDescendantUnitIds(requestedGroupId, organizations)
        .filter((organizationId) => !scopeOrganizationIds || scopeOrganizationIds.includes(organizationId));

      where.organizationId = { in: groupUnitIds };
    } else if (requestedOrganizationId) {
      this.ensureOrganizationInScope(requestedOrganizationId, scopeOrganizationIds);
      where.organizationId = requestedOrganizationId;
    } else if (scopeOrganizationIds) {
      where.organizationId = { in: scopeOrganizationIds };
    }

    // 검색어 필터
    if (filter.search) {
      andConditions.push({
        OR: [
        { referenceId: { contains: filter.search, mode: 'insensitive' } },
        { id: { contains: filter.search, mode: 'insensitive' } },
        { name: { contains: filter.search, mode: 'insensitive' } },
        { email: { contains: filter.search, mode: 'insensitive' } },
        ],
      });
    }

    // 상태 필터
    if (filter.statusGroup === EmployeeStatusGroupEnum.UNASSIGNED) {
      const companyOrganizationIds = await this.resolveScopedCompanyOrganizationIds(scopeOrganizationIds);
      andConditions.push({
        status: EmployeeStatus.EXCEPTION,
      });
      andConditions.push({
        organizationId: { in: companyOrganizationIds },
      });
    } else if (filter.status) {
      andConditions.push({
        status: filter.status as EmployeeStatus,
      });
    } else if (filter.statusGroup === EmployeeStatusGroupEnum.DELETED) {
      andConditions.push({
        OR: [
        { status: 'PHONE_INFO_REVIEW' as EmployeeStatus },
        { status: 'DELETE' as EmployeeStatus },
        ],
      });
    } else {
      andConditions.push({
        status: {
          notIn: ['DELETE', 'PHONE_INFO_REVIEW'] as EmployeeStatus[],
        },
      });
    }

    if (andConditions.length > 0) {
      where.AND = andConditions;
    }

    const [employees, total] = await Promise.all([
      this.prisma.employee.findMany({
        where,
        include: {
          organization: true,
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
    const employee = await findEmployeeByIdentifier(this.prisma, employeeId, {
      include: {
        organization: true,
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
      devices: employee.devices.map((d: any) => ({
        id: d.id,
        deviceId: d.deviceId,
        model: d.model || '',
        os: d.os,
        status: d.status,
        lastCommunication: d.lastCommunication || undefined,
      })),
      exclusions: employee.exclusions.map((e: any) => ({
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
    actorUserId?: string,
  ): Promise<EmployeeResponseDto> {
    const previousEmployee = await findEmployeeByIdentifier(this.prisma, employeeId, {
      select: {
        id: true,
        referenceId: true,
        status: true,
        organizationId: true,
      },
    });

    if (!previousEmployee) {
      throw new NotFoundException('직원을 찾을 수 없습니다.');
    }

    this.assertNotDeletedStatus(previousEmployee.status as EmployeeStatus);
    this.assertOrganizationInScope(previousEmployee.organizationId, scopeOrganizationIds);

    if ((dto.newPassword && !dto.confirmPassword) || (!dto.newPassword && dto.confirmPassword)) {
      throw new BadRequestException('새 비밀번호와 확인 비밀번호를 모두 입력해주세요.');
    }

    if (dto.newPassword && dto.confirmPassword && dto.newPassword !== dto.confirmPassword) {
      throw new BadRequestException('새 비밀번호가 일치하지 않습니다.');
    }

    const requestedEmployeeId = dto.employeeId !== undefined ? this.normalizeEmployeeId(dto.employeeId) : undefined;
    const normalizedName = dto.name !== undefined ? dto.name.trim() : undefined;
    const normalizedPosition = dto.position !== undefined ? this.normalizeOptionalText(dto.position) : undefined;
    const normalizedRole = dto.role !== undefined ? this.normalizeOptionalText(dto.role) : undefined;
    const normalizedEmail = dto.email !== undefined ? this.normalizeOptionalEmail(dto.email) : undefined;
    const normalizedMemo = dto.memo !== undefined ? this.normalizeOptionalText(dto.memo) : undefined;
    const normalizedStatus = dto.status !== undefined
      ? this.normalizeRequestedStatus(dto.status as EmployeeStatus)
      : undefined;
    const shouldRestoreToActiveAfterIdFix = Boolean(
      requestedEmployeeId
      && requestedEmployeeId !== previousEmployee.id
      && previousEmployee.status === ('PHONE_INFO_REVIEW' as EmployeeStatus),
    );
    const statusForUpdate = shouldRestoreToActiveAfterIdFix
      ? EmployeeStatus.ACTIVE
      : normalizedStatus;
    if (requestedEmployeeId !== undefined && !requestedEmployeeId) {
      throw new BadRequestException('직원 ID는 비워둘 수 없습니다.');
    }

    if (normalizedName !== undefined && !normalizedName) {
      throw new BadRequestException('직원 이름은 비워둘 수 없습니다.');
    }

    this.ensureOrganizationInScope(dto.organizationId, scopeOrganizationIds);

    const targetOrganizationId = dto.organizationId ?? previousEmployee.organizationId;

    await this.validateEmployeeAssignment(
      targetOrganizationId,
    );

    let employee;
    const deletedArchiveEmployeeIdsForNotify: string[] = [];
    try {
      employee = await this.prisma.$transaction(async (tx) => {
        let workingEmployeeId = previousEmployee.id;

        if (requestedEmployeeId && requestedEmployeeId !== previousEmployee.id) {
          const reassigned = await this.reassignEmployeeId(
            tx,
            previousEmployee.id,
            requestedEmployeeId,
            Boolean(dto.confirmIdReassignment),
            previousEmployee.referenceId,
          );

          workingEmployeeId = reassigned.employeeId;
          if (reassigned.archivedEmployeeId) {
            deletedArchiveEmployeeIdsForNotify.push(reassigned.archivedEmployeeId);
          }
        }

        const updatedEmployee = await tx.employee.update({
          where: { id: workingEmployeeId },
          data: {
            name: normalizedName,
            organizationId: dto.organizationId,
            position: normalizedPosition,
            role: normalizedRole,
            email: normalizedEmail,
            memo: normalizedMemo,
            status: statusForUpdate,
            updatedById: actorUserId,
          } as any,
          include: {
            organization: true,
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
      && statusForUpdate
      && this.isNonActiveEmployeeStatus(statusForUpdate)
      && previousEmployee.status !== statusForUpdate
    ) {
      await this.notifyPolicyChangedForEmployees([employee.id], 'employee_status_non_active');
    }

    if (deletedArchiveEmployeeIdsForNotify.length > 0) {
      await this.notifyDeletedPolicyUnavailableForEmployees(
        deletedArchiveEmployeeIdsForNotify,
        'STATUS_DELETE',
      ).catch((error) => {
        this.logger.warn(`아이디 재할당 삭제 처리 후 policy_changed 전송 실패: ${String(error)}`);
      });
    }

    if (actorUserId) {
      void this.prisma.auditLog.create({
        data: {
          accountId: actorUserId,
          organizationId: employee.organizationId,
          action: AuditAction.UPDATE,
          resourceType: 'Employee',
          resourceId: employee.id,
          resourceName: employee.name,
          changesAfter: {
            employeeId: employee.id,
            updatedById: actorUserId,
          },
        },
      }).catch(() => undefined);
    }

    return this.toResponseDto(employee);
  }

  async remove(employeeId: string, scopeOrganizationIds?: string[]): Promise<void> {
    const employee = await findEmployeeByIdentifier(this.prisma, employeeId, {
      select: {
        id: true,
        name: true,
        organizationId: true,
      },
    });

    if (!employee) {
      throw new NotFoundException('직원을 찾을 수 없습니다.');
    }

    this.assertOrganizationInScope(employee.organizationId, scopeOrganizationIds);

    await this.removeEmployeeById(employee.id, employee.name ?? '삭제된 직원', employee.organizationId, 'ADMIN_DELETE');
  }

  private async removeEmployeeById(
    employeeId: string,
    employeeName: string,
    organizationId: string,
    reason: 'ADMIN_DELETE' | 'RESIGNED' | 'SELF_WITHDRAW' | 'STATUS_DELETE' = 'ADMIN_DELETE',
  ): Promise<void> {
    const archiveEmployeeId = this.buildDeletedEmployeeArchiveId(employeeId);
    const archivePasswordHash = await bcrypt.hash(randomUUID(), 10);
    const now = new Date();

    await this.prisma.$transaction(async (tx) => {
      const employeeDevices = await tx.device.findMany({
        where: { employeeId },
        select: { id: true },
      });
      const employeeDeviceIds = employeeDevices.map((device) => device.id);

      await tx.employee.create({
        data: {
          id: archiveEmployeeId,
          name: employeeName || '삭제된 직원',
          organizationId,
          status: 'DELETE' as EmployeeStatus,
          memo: `삭제 아카이브 계정 (원본 직원ID: ${employeeId}) | 사유: ${reason} | 삭제시각: ${now.toISOString()}`,
          phone: null,
          email: null,
          position: null,
          role: null,
        } as any,
      });

      await tx.controlPolicyEmployee.deleteMany({
        where: { employeeId },
      });

      await tx.employeeExclusion.deleteMany({
        where: { employeeId },
      });

      await tx.device.updateMany({
        where: { employeeId },
        data: {
          employeeId: archiveEmployeeId,
          status: 'INACTIVE' as any,
          deviceStatus: DeviceOperationStatus.LOGGED_OUT,
          deactivatedAt: now,
          deactivatedReason: `deleted:${reason}`,
          mdmManualUnblockUntilLogin: false,
          mdmManualUnblockReason: null,
          mdmManualUnblockSetAt: null,
        } as any,
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
        where: { employeeId },
        data: { employeeId: archiveEmployeeId },
      });

      await tx.employeeDailyStat.updateMany({
        where: { employeeId },
        data: { employeeId: archiveEmployeeId },
      });

      await tx.zoneVisitSession.updateMany({
        where: { employeeId },
        data: { employeeId: archiveEmployeeId },
      });

      await tx.appUsageSession.updateMany({
        where: { employeeId },
        data: { employeeId: archiveEmployeeId },
      });

      await tx.workSession.updateMany({
        where: { employeeId },
        data: { employeeId: archiveEmployeeId },
      });

      const employeeAccount = await tx.employeeAccount.findUnique({
        where: { employeeId },
        select: { id: true },
      });

      if (employeeAccount) {
        await tx.employeeAccount.update({
          where: { employeeId },
          data: {
            employeeId: archiveEmployeeId,
            isActive: false,
            passwordHash: archivePasswordHash,
          },
        });
      }

      await tx.employee.delete({
        where: { id: employeeId },
      });
    });

    await this.notifyDeletedPolicyUnavailableForEmployees([archiveEmployeeId], reason)
      .catch((error) => {
        this.logger.warn(`삭제 상태 FCM 전송 실패(employeeId=${archiveEmployeeId}): ${String(error)}`);
      });
  }

  private buildDeletedEmployeeArchiveId(employeeId: string): string {
    return `deleted:${employeeId}:${randomUUID()}`;
  }

  async bulkMoveOrganization(
    dto: BulkMoveOrganizationDto,
    scopeOrganizationIds?: string[],
  ): Promise<{ updated: number }> {
    const resolvedEmployeeIds = await resolveEmployeePrimaryIds(this.prisma, dto.employeeIds);

    this.ensureOrganizationInScope(dto.targetOrganizationId, scopeOrganizationIds);

    const organization = await this.prisma.organization.findUnique({
      where: { id: dto.targetOrganizationId },
    });
    if (!organization) {
      throw new NotFoundException('대상 현장을 찾을 수 없습니다.');
    }

    await assertUnitOrganization(this.prisma, dto.targetOrganizationId);

    const targetEmployees = await this.prisma.employee.findMany({
      where: {
        id: { in: resolvedEmployeeIds },
        ...(scopeOrganizationIds ? { organizationId: { in: scopeOrganizationIds } } : {}),
      },
      select: {
        id: true,
        organizationId: true,
        status: true,
      },
    });

    const organizationNodes = await this.getOrganizationNodes();
    const organizationById = new Map(organizationNodes.map((node) => [node.id, node] as const));
    const shouldActivateEmployeeIds = targetEmployees
      .filter((employee) => {
        if (employee.status !== EmployeeStatus.EXCEPTION) {
          return false;
        }

        const currentOrganization = organizationById.get(employee.organizationId);
        if (!currentOrganization) {
          return false;
        }

        return resolveOrganizationClassification(currentOrganization) === 'COMPANY';
      })
      .map((employee) => employee.id);

    const result = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.employee.updateMany({
        where: {
          id: { in: resolvedEmployeeIds },
          ...(scopeOrganizationIds ? { organizationId: { in: scopeOrganizationIds } } : {}),
        },
        data: { organizationId: dto.targetOrganizationId },
      });

      if (shouldActivateEmployeeIds.length > 0) {
        await tx.employee.updateMany({
          where: { id: { in: shouldActivateEmployeeIds } },
          data: { status: EmployeeStatus.ACTIVE },
        });
      }

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
  ): Promise<{ requested: number; updated: number; skipped: number }> {
    const resolvedEmployeeIds = await resolveEmployeePrimaryIds(this.prisma, employeeIds);
    const uniqueEmployeeIds = Array.from(new Set(resolvedEmployeeIds.filter(Boolean)));
    const requested = uniqueEmployeeIds.length;
    const normalizedStatus = this.normalizeRequestedStatus(status as EmployeeStatus) as EmployeeStatus;

    if (uniqueEmployeeIds.length === 0) {
      return { requested: 0, updated: 0, skipped: 0 };
    }

    const targetEmployees = await this.prisma.employee.findMany({
      where: {
        id: { in: uniqueEmployeeIds },
        ...(scopeOrganizationIds ? { organizationId: { in: scopeOrganizationIds } } : {}),
      },
      select: {
        id: true,
        status: true,
      },
    });

    if (normalizedStatus === ('DELETE' as EmployeeStatus)) {
      const deletableEmployees = targetEmployees.filter((employee) => employee.status !== ('DELETE' as EmployeeStatus));

      await this.runInBatches(deletableEmployees, this.resolveBulkDeleteConcurrency(), async (employee) => {
        const source = await this.prisma.employee.findUnique({
          where: { id: employee.id },
          select: { id: true, name: true, organizationId: true },
        });

        if (!source) {
          return;
        }

        await this.removeEmployeeById(source.id, source.name ?? '삭제된 직원', source.organizationId, 'STATUS_DELETE');
      });

      return {
        requested,
        updated: deletableEmployees.length,
        skipped: Math.max(0, requested - deletableEmployees.length),
      };
    }

    const shouldNotifyEmployeeIds = this.isNonActiveEmployeeStatus(normalizedStatus)
      ? targetEmployees
        .filter((employee) => employee.status !== normalizedStatus)
        .map((employee) => employee.id)
      : [];

    const targetEmployeeIds = targetEmployees.map((employee) => employee.id);

    if (targetEmployeeIds.length === 0) {
      return { requested, updated: 0, skipped: requested };
    }

    const result = await this.prisma.employee.updateMany({
      where: {
        id: { in: targetEmployeeIds },
        status: { not: normalizedStatus },
      },
      data: { status: normalizedStatus },
    });

    if (shouldNotifyEmployeeIds.length > 0) {
      void this.notifyPolicyChangedForEmployees(shouldNotifyEmployeeIds, 'employee_status_non_active')
        .catch((error) => {
          this.logger.warn(`직원 일괄 상태 변경 후 policy_changed 비동기 전송 실패: ${String(error)}`);
        });
    }

    return {
      requested,
      updated: result.count,
      skipped: Math.max(0, requested - result.count),
    };
  }

  async bulkRemove(
    employeeIds: string[],
    scopeOrganizationIds?: string[],
  ): Promise<{ requested: number; deleted: number; skipped: number }> {
    const resolvedEmployeeIds = await resolveEmployeePrimaryIds(this.prisma, employeeIds);
    const uniqueEmployeeIds = Array.from(new Set(resolvedEmployeeIds.filter(Boolean)));
    const requested = uniqueEmployeeIds.length;

    if (uniqueEmployeeIds.length === 0) {
      return { requested: 0, deleted: 0, skipped: 0 };
    }

    const targetEmployees = await this.prisma.employee.findMany({
      where: {
        id: { in: uniqueEmployeeIds },
        ...(scopeOrganizationIds ? { organizationId: { in: scopeOrganizationIds } } : {}),
      },
      select: { id: true, name: true, organizationId: true },
    });

    await this.runInBatches(targetEmployees, this.resolveBulkDeleteConcurrency(), async (employee) => {
      await this.removeEmployeeById(employee.id, employee.name ?? '삭제된 직원', employee.organizationId, 'ADMIN_DELETE');
    });

    return {
      requested,
      deleted: targetEmployees.length,
      skipped: Math.max(0, requested - targetEmployees.length),
    };
  }

  async restoreDeletedEmployee(
    employeeId: string,
    scopeOrganizationIds?: string[],
  ): Promise<EmployeeResponseDto> {
    const deletedEmployee = await findEmployeeByIdentifier(this.prisma, employeeId, {
      include: {
        organization: true,
      },
    });

    if (!deletedEmployee) {
      throw new NotFoundException('삭제된 직원을 찾을 수 없습니다.');
    }

    this.assertOrganizationInScope(deletedEmployee.organizationId, scopeOrganizationIds);

    if (deletedEmployee.status !== ('DELETE' as EmployeeStatus)) {
      throw new BadRequestException('삭제 상태의 직원만 복원할 수 있습니다.');
    }

    const originalEmployeeId = this.resolveOriginalEmployeeIdForRestore(deletedEmployee);
    if (!originalEmployeeId) {
      throw new BadRequestException('복원 가능한 원본 직원 ID 정보가 없습니다.');
    }

    const existingEmployee = await this.prisma.employee.findUnique({
      where: { id: originalEmployeeId },
      select: { id: true },
    });

    if (existingEmployee) {
      throw new ConflictException('동일 번호의 활성 사용자 계정이 존재하여 복원할 수 없습니다.');
    }

    const restored = await this.prisma.$transaction(async (tx) => {
      await tx.employee.create({
        data: {
          id: originalEmployeeId,
          name: deletedEmployee.name,
          organizationId: deletedEmployee.organizationId,
          position: deletedEmployee.position,
          role: deletedEmployee.role,
          status: EmployeeStatus.ACTIVE,
          phone: deletedEmployee.phone,
          email: deletedEmployee.email,
          memo: deletedEmployee.memo,
          createdById: deletedEmployee.createdById,
          updatedById: deletedEmployee.updatedById,
          pendingMdmUdid: deletedEmployee.pendingMdmUdid,
        } as any,
      });

      await this.repointEmployeeReferences(tx, deletedEmployee.id, originalEmployeeId);

      await tx.employee.delete({ where: { id: deletedEmployee.id } });
      await tx.employee.update({
        where: { id: originalEmployeeId },
        data: {
          referenceId: deletedEmployee.referenceId,
          status: EmployeeStatus.ACTIVE,
          updatedAt: new Date(),
        },
      });

      await tx.employeeAccount.updateMany({
        where: { employeeId: originalEmployeeId },
        data: { isActive: true },
      });

      await tx.device.updateMany({
        where: { employeeId: originalEmployeeId },
        data: {
          status: 'NORMAL' as any,
          deviceStatus: DeviceOperationStatus.LOGGED_OUT,
          deactivatedReason: null,
        } as any,
      });

      return tx.employee.findUnique({
        where: { id: originalEmployeeId },
        include: { organization: true },
      });
    });

    return this.toResponseDto(restored);
  }

  async hardDeleteExpiredDeletedEmployees(
    dto: HardDeleteExpiredDeletedEmployeesDto,
    scopeOrganizationIds?: string[],
  ): Promise<{ requested: number; hardDeleted: number; skipped: number; dryRun: boolean; mdmDisconnected: number; mdmDisconnectFailed: number }> {
    const now = new Date();
    const fallbackThreshold = new Date(now.getTime() - EmployeesService.DELETED_RETENTION_DAYS * 24 * 60 * 60 * 1000);
    const limit = Math.max(1, Math.min(Number(dto?.limit) || 100, 1000));
    const dryRun = Boolean(dto?.dryRun);

    const targetEmployees = await this.prisma.employee.findMany({
      where: {
        status: 'DELETE' as EmployeeStatus,
        createdAt: { lte: fallbackThreshold },
        memo: { contains: '삭제 아카이브 계정' },
        ...(scopeOrganizationIds ? { organizationId: { in: scopeOrganizationIds } } : {}),
      },
      orderBy: {
        createdAt: 'asc',
      },
      take: limit,
      select: {
        id: true,
      },
    });

    if (dryRun) {
      return {
        requested: targetEmployees.length,
        hardDeleted: 0,
        skipped: 0,
        dryRun: true,
        mdmDisconnected: 0,
        mdmDisconnectFailed: 0,
      };
    }

    let hardDeleted = 0;
    let skipped = 0;
    let mdmDisconnected = 0;
    let mdmDisconnectFailed = 0;

    for (const employee of targetEmployees) {
      try {
        const result = await this.hardDeleteDeletedEmployeeById(employee.id);
        hardDeleted += 1;
        mdmDisconnected += result.mdmDisconnected;
        mdmDisconnectFailed += result.mdmDisconnectFailed;
      } catch (error) {
        skipped += 1;
        this.logger.warn(`삭제 만료 하드삭제 실패(employeeId=${employee.id}): ${String(error)}`);
      }
    }

    return {
      requested: targetEmployees.length,
      hardDeleted,
      skipped,
      dryRun: false,
      mdmDisconnected,
      mdmDisconnectFailed,
    };
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
          employee: {
            status: { not: 'DELETE' as EmployeeStatus },
          },
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

  private resolveBulkDeleteConcurrency(): number {
    const raw = this.configService.get<string>('EMPLOYEE_BULK_DELETE_CONCURRENCY')?.trim();
    const parsed = Number(raw);

    if (Number.isFinite(parsed) && parsed >= 1) {
      return Math.floor(parsed);
    }

    return 5;
  }

  private async runInBatches<T>(
    items: T[],
    concurrency: number,
    worker: (item: T) => Promise<void>,
  ): Promise<void> {
    const safeConcurrency = Math.max(1, Math.floor(concurrency));

    for (let index = 0; index < items.length; index += safeConcurrency) {
      const chunk = items.slice(index, index + safeConcurrency);
      await Promise.all(chunk.map((item) => worker(item)));
    }
  }

  private async hardDeleteDeletedEmployeeById(employeeId: string): Promise<{ mdmDisconnected: number; mdmDisconnectFailed: number }> {
    const deletedEmployee = await this.prisma.employee.findUnique({
      where: { id: employeeId },
      select: {
        id: true,
        name: true,
        organizationId: true,
        status: true,
        memo: true,
      },
    });

    const originalEmployeeId = this.resolveOriginalEmployeeIdForRestore(deletedEmployee);

    if (!deletedEmployee || deletedEmployee.status !== ('DELETE' as EmployeeStatus) || !originalEmployeeId) {
      throw new NotFoundException('하드삭제 대상 삭제 직원을 찾을 수 없습니다.');
    }

    const deletedEmployeeWithOriginalId = {
      ...deletedEmployee,
      originalEmployeeId,
    } as {
      id: string;
      name: string;
      organizationId: string;
      status: EmployeeStatus;
      originalEmployeeId: string | null;
    };

    const devices = await this.prisma.device.findMany({
      where: { employeeId: deletedEmployee.id },
      select: { id: true, deviceId: true, udid: true, os: true },
    });

    let mdmDisconnected = 0;
    let mdmDisconnectFailed = 0;

    for (const device of devices) {
      if (device.os !== DeviceOS.iOS) {
        continue;
      }

      try {
        await this.callAppBackendDisconnectMdmDevice({
          deviceId: device.deviceId,
          udid: device.udid ?? undefined,
        });
        mdmDisconnected += 1;
      } catch (error) {
        mdmDisconnectFailed += 1;
        this.logger.warn(`하드삭제 iOS MDM 연결해제 실패(deviceId=${device.deviceId}): ${String(error)}`);
      }
    }

    const now = new Date();
    const hardDeletedAnchorId = this.buildHardDeletedStatsAnchorId(deletedEmployeeWithOriginalId.id);
    const deviceIds = devices.map((device) => device.id);

    await this.prisma.$transaction(async (tx) => {
      await tx.employee.create({
        data: {
          id: hardDeletedAnchorId,
          name: '하드삭제 사용자',
          organizationId: deletedEmployeeWithOriginalId.organizationId,
          status: 'DELETE' as EmployeeStatus,
          memo: `통계 보존용 비식별 사용자(원본 아카이브: ${deletedEmployeeWithOriginalId.id}) | 하드삭제시각: ${now.toISOString()}`,
          phone: null,
          email: null,
          position: null,
          role: null,
        } as any,
      });

      await this.repointEmployeeAnalyticsReferences(tx, deletedEmployeeWithOriginalId.id, hardDeletedAnchorId);

      await tx.controlPolicyEmployee.deleteMany({ where: { employeeId: deletedEmployeeWithOriginalId.id } });
      await tx.employeeExclusion.deleteMany({ where: { employeeId: deletedEmployeeWithOriginalId.id } });

      await tx.device.updateMany({
        where: { employeeId: deletedEmployeeWithOriginalId.id },
        data: {
          employeeId: null,
          status: 'INACTIVE' as any,
          deviceStatus: DeviceOperationStatus.UNASSIGNED,
          mdmEnrollmentStatus: 'REMOVED' as any,
          deactivatedAt: now,
          deactivatedReason: 'hard_deleted_employee',
          mdmManualUnblockUntilLogin: false,
          mdmManualUnblockReason: null,
          mdmManualUnblockSetAt: null,
        } as any,
      });

      if (deviceIds.length > 0) {
        await tx.deviceToken.updateMany({
          where: { deviceId: { in: deviceIds } },
          data: {
            isValid: false,
            refreshToken: null,
            expiresAt: now,
          },
        });
      }

      const account = await tx.employeeAccount.findUnique({
        where: { employeeId: deletedEmployee.id },
        select: { id: true },
      });

      if (account) {
        await tx.employeeLoginHistory.deleteMany({
          where: { employeeAccountId: account.id },
        });

        await tx.employeeAccount.delete({
          where: { employeeId: deletedEmployeeWithOriginalId.id },
        });
      }

      await tx.employee.delete({ where: { id: deletedEmployeeWithOriginalId.id } });
    });

    return {
      mdmDisconnected,
      mdmDisconnectFailed,
    };
  }

  private async repointEmployeeAnalyticsReferences(
    tx: Prisma.TransactionClient,
    fromEmployeeId: string,
    toEmployeeId: string,
  ): Promise<void> {
    await tx.controlLog.updateMany({ where: { employeeId: fromEmployeeId }, data: { employeeId: toEmployeeId } });
    await tx.employeeDailyStat.updateMany({ where: { employeeId: fromEmployeeId }, data: { employeeId: toEmployeeId } });
    await tx.zoneVisitSession.updateMany({ where: { employeeId: fromEmployeeId }, data: { employeeId: toEmployeeId } });
    await tx.appUsageSession.updateMany({ where: { employeeId: fromEmployeeId }, data: { employeeId: toEmployeeId } });
    await tx.workSession.updateMany({ where: { employeeId: fromEmployeeId }, data: { employeeId: toEmployeeId } });
  }

  private buildHardDeletedStatsAnchorId(fromEmployeeId: string): string {
    return `hard-deleted:${fromEmployeeId}:${randomUUID()}`;
  }

  private resolveOriginalEmployeeIdForRestore(employee: any): string | null {
    const memoText = String(employee?.memo ?? '');
    const matched = memoText.match(/원본\s*직원ID\s*:\s*([^\s)]+)/i);
    if (matched?.[1]) {
      return matched[1].trim();
    }

    return null;
  }

  async assignDevice(
    employeeId: string,
    deviceId: string,
    scopeOrganizationIds?: string[],
  ): Promise<EmployeeResponseDto> {
    const employee = await findEmployeeByIdentifier(this.prisma, employeeId);
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
      data: { employeeId: employee.id, organizationId: employee.organizationId, deviceStatus: 'IN_USE' },
    });

    const updated = await this.prisma.employee.findUnique({
      where: { id: employee.id },
      include: { organization: true },
    });
    return this.toResponseDto(updated);
  }

  async unassignDevice(employeeId: string, scopeOrganizationIds?: string[]): Promise<EmployeeResponseDto> {
    const employee = await findEmployeeByIdentifier(this.prisma, employeeId);
    if (!employee) throw new NotFoundException('직원을 찾을 수 없습니다.');
    this.assertNotDeletedStatus(employee.status);
    this.assertOrganizationInScope(employee.organizationId, scopeOrganizationIds);

    await this.prisma.device.updateMany({
      where: { employeeId: employee.id },
      data: { employeeId: null, deviceStatus: 'UNASSIGNED' },
    });

    const updated = await this.prisma.employee.findUnique({
      where: { id: employee.id },
      include: { organization: true },
    });
    return this.toResponseDto(updated);
  }

  async setMdmManualUnblock(
    employeeId: string,
    dto: EmployeeMdmManualUnblockDto,
    scopeOrganizationIds?: string[],
  ) {
    const employee = await findEmployeeByIdentifier(this.prisma, employeeId);
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
        employeeId: employee.id,
      },
      select: {
        id: true,
        deviceId: true,
        employeeId: true,
        os: true,
        pushToken: true,
        pushTokenStatus: true,
      },
    });

    if (!device) {
      throw new BadRequestException('해당 직원에게 할당된 디바이스를 찾을 수 없습니다.');
    }

    const reason = dto.reason?.trim() || '관리자 요청: 다음 로그인 전까지 정책 미적용';
    const now = new Date();

    await this.prisma.device.update({
      where: { id: device.id },
      data: {
        mdmManualUnblockUntilLogin: true,
        mdmManualUnblockReason: reason,
        mdmManualUnblockSetAt: now,
      },
    });

    const endpointUrl = `${this.getAppBackendBaseUrl()}/internal/push/fcm/send`;
    const token = device.pushToken?.trim();
    let pushDispatched = false;

    if (token && device.pushTokenStatus !== PushTokenStatus.ERROR) {
      try {
        await this.sendPolicyChangedPush(endpointUrl, {
          token,
          os: device.os,
          trigger: 'manual_unblock_until_login',
          policyApplied: false,
        });
        pushDispatched = true;
      } catch (error) {
        if (error instanceof EmployeePolicyPushSendError && error.shouldMarkTokenAsError) {
          await this.prisma.$executeRaw`
            UPDATE devices
            SET "pushTokenStatus" = 'ERROR',
                "updatedAt" = NOW()
            WHERE id = ${device.id}
          `;
        }

        this.logger.warn(
          `수동 해제 policy_changed 전송 실패(deviceId=${device.id}, employeeId=${employee.id}): ${String(error)}`,
        );
      }
    }

    let mdmDispatched = false;
    let mdmDispatchError: string | null = null;

    if (device.os === DeviceOS.iOS) {
      try {
        await this.callAppBackendSendBlockedAppsAllowAll({
          deviceId: device.deviceId,
        });
        mdmDispatched = true;
      } catch (error) {
        mdmDispatchError = String(error);
        this.logger.warn(
          `수동 해제 iOS MDM 전체 허용 전송 실패(deviceId=${device.id}, employeeId=${employee.id}): ${mdmDispatchError}`,
        );
      }
    }

    return {
      ok: true,
      employeeId: employee.id,
      deviceId: device.deviceId,
      reason,
      policyBypassUntilNextLogin: true,
      pushDispatched,
      mdmDispatched,
      ...(mdmDispatchError ? { mdmDispatchError } : {}),
    };
  }

  async forceLogoutDeviceUntilNextLogin(
    employeeId: string,
    dto: EmployeeDeviceLogoutUntilNextLoginDto,
    scopeOrganizationIds?: string[],
  ) {
    const employee = await findEmployeeByIdentifier(this.prisma, employeeId);
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
        employeeId: employee.id,
      },
      select: {
        id: true,
        deviceId: true,
        os: true,
      },
    });

    if (!device) {
      throw new BadRequestException('해당 직원에게 할당된 디바이스를 찾을 수 없습니다.');
    }

    if (device.os !== DeviceOS.iOS) {
      throw new BadRequestException('iOS 디바이스만 MDM 로그아웃 처리할 수 있습니다.');
    }

    const now = new Date();
    const reason = dto.reason?.trim() || '관리자 요청: 다음 로그인 전까지 정책 미적용 및 로그아웃';

    await this.prisma.$transaction([
      this.prisma.device.update({
        where: { id: device.id },
        data: {
          mdmManualUnblockUntilLogin: true,
          mdmManualUnblockReason: reason,
          mdmManualUnblockSetAt: now,
          deviceStatus: DeviceOperationStatus.LOGGED_OUT,
          deactivatedAt: now,
          deactivatedReason: reason,
        },
      }),
      this.prisma.deviceToken.updateMany({
        where: { deviceId: device.id },
        data: {
          isValid: false,
          refreshToken: null,
          expiresAt: now,
        },
      }),
    ]);

    return {
      ok: true,
      employeeId: employee.id,
      deviceId: device.deviceId,
      reason,
      policyBypassUntilNextLogin: true,
      jwtExpired: true,
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
    preservedReferenceId: string,
  ): Promise<{ employeeId: string; archivedEmployeeId?: string }> {
    const existingTarget = await tx.employee.findUnique({
      where: { id: requestedEmployeeId },
      select: { id: true },
    });

    let archivedEmployeeId: string | undefined;

    if (existingTarget) {
      if (!confirmed) {
        throw new ConflictException(
          '입력한 아이디를 이미 사용하는 직원이 있습니다. 기존 사용자를 "삭제" 상태로 전환하고 아이디를 재할당하려면 confirmIdReassignment=true로 다시 요청하세요.',
        );
      }

      archivedEmployeeId = await this.moveEmployeeToDeletedArchive(
        tx,
        requestedEmployeeId,
        `관리자 아이디 변경으로 기존 아이디 재할당됨(신규 대상: ${currentEmployeeId})`,
      );
    }

    const currentEmployee = await tx.employee.findUniqueOrThrow({
      where: { id: currentEmployeeId },
      select: { organizationId: true },
    });

    await tx.employee.create({
      data: {
        id: requestedEmployeeId,
        name: '임시',
        organizationId: currentEmployee.organizationId,
      },
    });

    await this.repointEmployeeReferences(tx, currentEmployeeId, requestedEmployeeId);
    await tx.employee.delete({ where: { id: currentEmployeeId } });
    await tx.employee.update({
      where: { id: requestedEmployeeId },
      data: { referenceId: preservedReferenceId },
    });

    return {
      employeeId: requestedEmployeeId,
      archivedEmployeeId,
    };
  }

  private async moveEmployeeToDeletedArchive(
    tx: Prisma.TransactionClient,
    employeeId: string,
    reason: string,
  ): Promise<string | undefined> {
    const source = await tx.employee.findUnique({
      where: { id: employeeId },
      select: {
        id: true,
        name: true,
        organizationId: true,
        position: true,
        role: true,
        email: true,
        memo: true,
        createdById: true,
        updatedById: true,
        pendingMdmUdid: true,
        phone: true,
      },
    });
    if (!source) {
      return undefined;
    }

    const archiveEmployeeId = this.buildDeletedEmployeeArchiveId(employeeId);
    const archivePasswordHash = await bcrypt.hash(randomUUID(), 10);
    const now = new Date();

    const employeeDevices = await tx.device.findMany({
      where: { employeeId },
      select: { id: true },
    });
    const employeeDeviceIds = employeeDevices.map((device) => device.id);

    await tx.employee.create({
      data: {
        id: archiveEmployeeId,
        name: source.name,
        organizationId: source.organizationId,
        position: source.position,
        role: source.role,
        status: 'DELETE' as EmployeeStatus,
        phone: source.phone,
        email: source.email,
        memo: [source.memo, reason, `삭제 아카이브 계정 (원본 직원ID: ${employeeId})`].filter(Boolean).join(' | '),
        createdById: source.createdById,
        updatedById: source.updatedById,
        pendingMdmUdid: source.pendingMdmUdid,
      },
    });

    await tx.controlPolicyEmployee.deleteMany({ where: { employeeId } });
    await tx.employeeExclusion.deleteMany({ where: { employeeId } });

    await tx.device.updateMany({
      where: { employeeId },
      data: {
        employeeId: archiveEmployeeId,
        status: 'INACTIVE' as any,
        deviceStatus: DeviceOperationStatus.LOGGED_OUT,
        deactivatedAt: now,
        deactivatedReason: 'deleted:STATUS_DELETE',
        mdmManualUnblockUntilLogin: false,
        mdmManualUnblockReason: null,
        mdmManualUnblockSetAt: null,
      } as any,
    });

    await tx.deviceToken.updateMany({
      where: { deviceId: { in: employeeDeviceIds } },
      data: {
        isValid: false,
        refreshToken: null,
        expiresAt: now,
      },
    });

    await tx.controlLog.updateMany({ where: { employeeId }, data: { employeeId: archiveEmployeeId } });
    await tx.employeeDailyStat.updateMany({ where: { employeeId }, data: { employeeId: archiveEmployeeId } });
    await tx.zoneVisitSession.updateMany({ where: { employeeId }, data: { employeeId: archiveEmployeeId } });
    await tx.appUsageSession.updateMany({ where: { employeeId }, data: { employeeId: archiveEmployeeId } });
    await tx.workSession.updateMany({ where: { employeeId }, data: { employeeId: archiveEmployeeId } });

    const account = await tx.employeeAccount.findUnique({ where: { employeeId }, select: { id: true } });
    if (account) {
      await tx.employeeAccount.update({
        where: { employeeId },
        data: {
          employeeId: archiveEmployeeId,
          isActive: false,
          passwordHash: archivePasswordHash,
        },
      });
    }

    await tx.employee.delete({ where: { id: employeeId } });

    return archiveEmployeeId;
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
      dev: 'http://localhost:3100/api/app',
      prod: 'http://localhost:3100/api/app',
    });
    return baseUrl.trim().replace(/\/$/, '');
  }

  private getAppBackendMdmAdminSecret(): string | undefined {
    return this.configService.get<string>('APP_BACKEND_MDM_ADMIN_SECRET')?.trim()
      || this.configService.get<string>('MDM_ADMIN_INTERNAL_SECRET')?.trim();
  }

  private async callAppBackendSendBlockedAppsAllowAll(payload: { deviceId: string }) {
    const endpointUrl = `${this.getAppBackendBaseUrl()}/mdm/send/blocked-apps`;
    const secret = this.getAppBackendMdmAdminSecret();

    const response = await fetch(endpointUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(secret ? { 'x-admin-internal-secret': secret } : {}),
      },
      body: JSON.stringify({
        deviceId: payload.deviceId,
        blockedAppBundleIDs: [],
      }),
    });

    if (!response.ok) {
      const responseText = await response.text();
      throw new BadGatewayException(
        `app-backend 차단앱 해제 호출 실패(status=${response.status}): ${responseText || 'empty response'}`,
      );
    }

    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      return response.json();
    }

    return { ok: true };
  }

  private async callAppBackendDisconnectMdmDevice(payload: { deviceId?: string; udid?: string }) {
    const endpointUrl = `${this.getAppBackendBaseUrl()}/mdm/send/disconnect-device`;
    const secret = this.getAppBackendMdmAdminSecret();

    const response = await fetch(endpointUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(secret ? { 'x-admin-internal-secret': secret } : {}),
      },
      body: JSON.stringify({
        deviceId: payload.deviceId,
        udid: payload.udid,
      }),
    });

    if (!response.ok) {
      const responseText = await response.text();
      throw new BadGatewayException(
        `app-backend MDM 연결해제 호출 실패(status=${response.status}): ${responseText || 'empty response'}`,
      );
    }

    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      return response.json();
    }

    return { ok: true };
  }

  private isNonActiveEmployeeStatus(status?: EmployeeStatus): boolean {
    return !!status
      && status !== EmployeeStatus.ACTIVE
      && status !== ('WITHDRAW_REQUEST' as EmployeeStatus);
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
    const tokenErrorDeviceIds: string[] = [];

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
          policyApplied: trigger !== 'employee_status_non_active',
        });
        successCount += 1;
      } catch (error) {
        failedCount += 1;
        if (error instanceof EmployeePolicyPushSendError && error.shouldMarkTokenAsError) {
          tokenErrorDeviceIds.push(device.id);
        }
        this.logger.warn(
          `직원 상태 변경 policy_changed 전송 실패(deviceId=${device.id}, employeeId=${device.employeeId}): ${String(error)}`,
        );
      }
    }

    let markedAsErrorCount = 0;
    if (tokenErrorDeviceIds.length > 0) {
      const uniqueFailedDeviceIds = Array.from(new Set(tokenErrorDeviceIds));
      markedAsErrorCount = await this.prisma.$executeRaw`
        UPDATE devices
        SET "pushTokenStatus" = 'ERROR',
            "updatedAt" = NOW()
        WHERE id IN (${Prisma.join(uniqueFailedDeviceIds)})
      `;
    }

    this.logger.log(
      `직원 상태 변경 policy_changed 전송 완료(trigger=${trigger}, employees=${uniqueEmployeeIds.length}, devices=${devices.length}, success=${successCount}, failed=${failedCount}, markedAsError=${markedAsErrorCount})`,
    );
  }

  private async sendPolicyChangedPush(
    endpointUrl: string,
    params: {
      token: string;
      os: DeviceOS;
      trigger: string;
      policyApplied: boolean;
      policyApplyMessage?: string;
      notificationTitle?: string;
      notificationBody?: string;
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
              ...(params.policyApplyMessage ? { policyApplyMessage: params.policyApplyMessage } : {}),
            },
          },
          ...(params.notificationTitle || params.notificationBody
            ? {
              notification: {
                ...(params.notificationTitle ? { title: params.notificationTitle } : {}),
                ...(params.notificationBody ? { body: params.notificationBody } : {}),
              },
            }
            : {}),
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
      throw new EmployeePolicyPushSendError(
        `policy_changed 호출 실패(status=${response.status}): ${responseText || 'empty response'}`,
        this.shouldMarkTokenAsError(response.status, responseText),
      );
    }
  }

  private shouldMarkTokenAsError(statusCode: number, responseText: string): boolean {
    if (statusCode === 502) {
      return true;
    }

    if (statusCode !== 400) {
      return false;
    }

    const body = (responseText || '').toLowerCase();
    return body.includes('invalid-registration-token')
      || body.includes('registration-token-not-registered')
      || body.includes('not a valid fcm registration token')
      || body.includes('registration token is not a valid');
  }

  private async notifyDeletedPolicyUnavailableForEmployees(
    employeeIds: string[],
    reason: 'ADMIN_DELETE' | 'RESIGNED' | 'SELF_WITHDRAW' | 'STATUS_DELETE',
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
      },
    });

    const endpointUrl = `${this.getAppBackendBaseUrl()}/internal/push/fcm/send`;
    const message = '삭제된 사용자로 인하여 정책을 적용할 수 없습니다. 정책 미적용 상태로 전환됩니다.';

    for (const device of devices) {
      const token = device.pushToken?.trim();
      if (!token) {
        continue;
      }

      await this.sendPolicyChangedPush(endpointUrl, {
        token,
        os: device.os,
        trigger: `employee_deleted:${reason.toLowerCase()}`,
        policyApplied: false,
        policyApplyMessage: message,
        notificationTitle: 'SAFEIN 정책 안내',
        notificationBody: '삭제된 사용자로 인해 정책이 미적용됩니다.',
      }).catch((error) => {
        this.logger.warn(`삭제 상태 policy_changed 전송 실패(deviceId=${device.id}): ${String(error)}`);
      });
    }
  }
}
