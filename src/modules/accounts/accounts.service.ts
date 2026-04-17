import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { AdminRole } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { normalizePhoneNumber } from '../../common/utils/phone.util';
import {
  resolveAdminActorType,
  resolveOrganizationClassification,
} from '../../common/utils/organization-scope.util';
import type { AdminActorType } from '../../common/types/admin-actor-type';
import * as bcrypt from 'bcrypt';
import { toAccountResponseDto } from './accounts.mapper';
import {
  CreateAccountDto,
  UpdateAccountDto,
  ChangePasswordDto,
  ResetPasswordDto,
  AccountResponseDto,
  AccountFilterDto,
  AccountListResponseDto,
  AccountStatsDto,
} from './dto';

type AccountActorContext = {
  id?: string;
  role?: string;
  organizationId?: string;
  scopeOrganizationIds?: string[];
};

type AccountAccessScope = {
  tier: AdminActorType;
  organizationId?: string;
  scopeOrganizationIds?: string[];
};

const ACCOUNT_ORGANIZATION_SELECT = {
  id: true,
  name: true,
  parentId: true,
  teamCode: true,
} as const;

@Injectable()
export class AccountsService {
  constructor(private prisma: PrismaService) {}

  private async resolveActorAccessScope(actor: AccountActorContext): Promise<AccountAccessScope> {
    if (actor.role === AdminRole.SUPER_ADMIN) {
      return { tier: 'SUPER_ADMIN' };
    }

    if (actor.role !== AdminRole.SITE_ADMIN) {
      throw new ForbiddenException('계정 관리 권한이 없습니다.');
    }

    if (!actor.organizationId) {
      throw new ForbiddenException('소속 조직 정보가 없는 계정은 계정 관리를 사용할 수 없습니다.');
    }

    const actorOrganization = await this.prisma.organization.findUnique({
      where: { id: actor.organizationId },
      select: {
        id: true,
        parentId: true,
        teamCode: true,
        isActive: true,
      },
    });

    if (!actorOrganization || !actorOrganization.isActive) {
      throw new ForbiddenException('유효하지 않은 소속 조직입니다.');
    }

    const actorType = resolveAdminActorType(actor.role, actorOrganization);
    if (!actorType || actorType === 'SUPER_ADMIN') {
      throw new ForbiddenException('회사 또는 그룹 관리자만 계정 관리 기능을 사용할 수 있습니다.');
    }

    return {
      tier: actorType,
      organizationId: actorOrganization.id,
      scopeOrganizationIds: actor.scopeOrganizationIds ?? [actorOrganization.id],
    };
  }

  private resolveAccountActorType(account: {
    role: AdminRole;
    organization?: { id: string; name: string; parentId: string | null; teamCode: string | null } | null;
  }): AdminActorType {
    const actorType = resolveAdminActorType(account.role, account.organization);

    if (!actorType) {
      throw new BadRequestException('관리자 계정은 회사 관리자 또는 그룹 담당자 조직에만 연결할 수 있습니다.');
    }

    return actorType;
  }

  private async collectScopedGroupOrganizationIds(scopeOrganizationIds: string[]): Promise<string[]> {
    if (scopeOrganizationIds.length === 0) {
      return [];
    }

    const organizations = await this.prisma.organization.findMany({
      where: {
        id: { in: scopeOrganizationIds },
        isActive: true,
      },
      select: {
        id: true,
        parentId: true,
        teamCode: true,
      },
    });

    return organizations
      .filter((organization) => resolveOrganizationClassification(organization) === 'GROUP')
      .map((organization) => organization.id);
  }

  private async resolveOrganizationIdForRole(
    role: AdminRole,
    organizationId: string | null | undefined,
    actorAccessScope: AccountAccessScope,
  ): Promise<string | null> {
    if (role === AdminRole.SUPER_ADMIN) {
      if (actorAccessScope.tier !== 'SUPER_ADMIN') {
        throw new ForbiddenException('슈퍼관리자 계정은 슈퍼관리자만 생성/수정할 수 있습니다.');
      }

      return null;
    }

    if (!organizationId) {
      throw new BadRequestException('관리자 계정은 회사 또는 그룹을 반드시 선택해야 합니다.');
    }

    const selectedOrganization = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { id: true, isActive: true, parentId: true, teamCode: true },
    });

    if (!selectedOrganization || !selectedOrganization.isActive) {
      throw new BadRequestException('선택한 회사/그룹을 찾을 수 없거나 비활성 상태입니다.');
    }

    const selectedClassification = resolveOrganizationClassification(selectedOrganization);
    if (selectedClassification !== 'COMPANY' && selectedClassification !== 'GROUP') {
      throw new BadRequestException('관리자 계정은 회사 또는 그룹만 선택할 수 있습니다.');
    }

    if (actorAccessScope.tier === 'SUPER_ADMIN') {
      return selectedOrganization.id;
    }

    const scopeOrganizationIds = actorAccessScope.scopeOrganizationIds ?? [];
    if (!scopeOrganizationIds.includes(selectedOrganization.id)) {
      throw new ForbiddenException('요청한 조직은 계정 관리 권한 범위를 벗어났습니다.');
    }

    if (selectedClassification !== 'GROUP') {
      if (actorAccessScope.tier === 'COMPANY_MANAGER') {
        throw new ForbiddenException('관리자는 그룹 담당자 계정만 생성/수정할 수 있습니다.');
      }
      throw new ForbiddenException('그룹 담당자는 그룹 조직만 선택할 수 있습니다.');
    }

    return selectedOrganization.id;
  }

  private async assertTargetAccountManageable(
    target: { id: string; role: AdminRole; organizationId: string | null },
    actorAccessScope: AccountAccessScope,
  ): Promise<void> {
    if (actorAccessScope.tier === 'SUPER_ADMIN') {
      return;
    }

    if (target.role === AdminRole.SUPER_ADMIN) {
      throw new ForbiddenException('슈퍼관리자 계정은 슈퍼관리자만 관리할 수 있습니다.');
    }

    if (!target.organizationId) {
      throw new ForbiddenException('소속 조직 정보가 없는 계정은 관리할 수 없습니다.');
    }

    const scopeOrganizationIds = actorAccessScope.scopeOrganizationIds ?? [];
    if (!scopeOrganizationIds.includes(target.organizationId)) {
      throw new ForbiddenException('해당 계정은 관리 권한 범위를 벗어났습니다.');
    }

    const targetOrganization = await this.prisma.organization.findUnique({
      where: { id: target.organizationId },
      select: {
        id: true,
        parentId: true,
        teamCode: true,
        isActive: true,
      },
    });

    if (!targetOrganization || !targetOrganization.isActive) {
      throw new NotFoundException('대상 계정의 조직을 찾을 수 없습니다.');
    }

    const targetClassification = resolveOrganizationClassification(targetOrganization);
    if (targetClassification !== 'GROUP') {
      throw new ForbiddenException('회사/그룹 관리자는 그룹 담당자 계정만 관리할 수 있습니다.');
    }
  }

  async create(dto: CreateAccountDto, actor: AccountActorContext): Promise<AccountResponseDto> {
    const normalizedPhone = normalizePhoneNumber(dto.phone);
    const role = dto.role as unknown as AdminRole;
    const actorAccessScope = await this.resolveActorAccessScope(actor);
    const resolvedOrganizationId = await this.resolveOrganizationIdForRole(role, dto.organizationId, actorAccessScope);

    // 사용자명 중복 체크
    const existing = await this.prisma.account.findUnique({
      where: { username: dto.username },
    });

    if (existing) {
      throw new ConflictException(`이미 사용 중인 사용자명입니다: ${dto.username}`);
    }

    // 비밀번호 해시
    const passwordHash = await bcrypt.hash(dto.password, 10);

    const account = await this.prisma.account.create({
      data: {
        username: dto.username,
        passwordHash,
        name: dto.name,
        email: dto.email,
        phone: normalizedPhone || undefined,
        role,
        organizationId: resolvedOrganizationId,
      },
      include: {
        organization: { select: ACCOUNT_ORGANIZATION_SELECT },
      },
    });

    return this.toResponseDto(account);
  }

  async findAll(filter: AccountFilterDto, actor: AccountActorContext): Promise<AccountListResponseDto> {
    const page = filter.page || 1;
    const limit = filter.limit || 20;
    const skip = (page - 1) * limit;
    const actorAccessScope = await this.resolveActorAccessScope(actor);

    const where: any = {};

    if (filter.search) {
      where.OR = [
        { username: { contains: filter.search, mode: 'insensitive' } },
        { name: { contains: filter.search, mode: 'insensitive' } },
        { email: { contains: filter.search, mode: 'insensitive' } },
      ];
    }

    if (filter.role) {
      where.role = filter.role;
    }

    if (filter.status) {
      where.status = filter.status;
    }

    if (filter.organizationId) {
      where.organizationId = filter.organizationId;
    }

    if (actorAccessScope.tier !== 'SUPER_ADMIN') {
      const scopedGroupOrganizationIds = await this.collectScopedGroupOrganizationIds(
        actorAccessScope.scopeOrganizationIds ?? [],
      );

      if (scopedGroupOrganizationIds.length === 0) {
        return {
          data: [],
          total: 0,
          page,
          limit,
          totalPages: 0,
        };
      }

      if (where.role === AdminRole.SUPER_ADMIN) {
        return {
          data: [],
          total: 0,
          page,
          limit,
          totalPages: 0,
        };
      }

      where.role = AdminRole.SITE_ADMIN;

      if (typeof filter.organizationId === 'string' && filter.organizationId.length > 0) {
        if (!scopedGroupOrganizationIds.includes(filter.organizationId)) {
          return {
            data: [],
            total: 0,
            page,
            limit,
            totalPages: 0,
          };
        }
        where.organizationId = filter.organizationId;
      } else {
        where.organizationId = { in: scopedGroupOrganizationIds };
      }
    }

    const [data, total] = await Promise.all([
      this.prisma.account.findMany({
        where,
        skip,
        take: limit,
        include: {
          organization: { select: ACCOUNT_ORGANIZATION_SELECT },
        },
        orderBy: { name: 'asc' },
      }),
      this.prisma.account.count({ where }),
    ]);

    return {
      data: data.map((account) => this.toResponseDto(account)),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async findOne(id: string, actor: AccountActorContext): Promise<AccountResponseDto> {
    const actorAccessScope = await this.resolveActorAccessScope(actor);
    const account = await this.prisma.account.findUnique({
      where: { id },
      include: {
        organization: { select: ACCOUNT_ORGANIZATION_SELECT },
      },
    });

    if (!account) {
      throw new NotFoundException('계정을 찾을 수 없습니다.');
    }

    await this.assertTargetAccountManageable(
      {
        id: account.id,
        role: account.role,
        organizationId: account.organization?.id || account.organizationId || null,
      },
      actorAccessScope,
    );

    return this.toResponseDto(account);
  }

  async findByUsername(username: string, actor: AccountActorContext): Promise<AccountResponseDto> {
    const actorAccessScope = await this.resolveActorAccessScope(actor);
    const account = await this.prisma.account.findUnique({
      where: { username },
      include: {
        organization: { select: ACCOUNT_ORGANIZATION_SELECT },
      },
    });

    if (!account) {
      throw new NotFoundException('계정을 찾을 수 없습니다.');
    }

    await this.assertTargetAccountManageable(
      {
        id: account.id,
        role: account.role,
        organizationId: account.organization?.id || account.organizationId || null,
      },
      actorAccessScope,
    );

    return this.toResponseDto(account);
  }

  async update(id: string, dto: UpdateAccountDto, actor: AccountActorContext): Promise<AccountResponseDto> {
    const actorAccessScope = await this.resolveActorAccessScope(actor);
    const normalizedPhone = normalizePhoneNumber(dto.phone);
    const currentAccount = await this.prisma.account.findUnique({
      where: { id },
      select: { id: true, username: true, role: true, organizationId: true },
    });

    if (!currentAccount) {
      throw new NotFoundException('계정을 찾을 수 없습니다.');
    }

    await this.assertTargetAccountManageable(
      {
        id: currentAccount.id,
        role: currentAccount.role,
        organizationId: currentAccount.organizationId,
      },
      actorAccessScope,
    );

    const nextRole = (dto.role as unknown as AdminRole | undefined) ?? currentAccount.role;
    const nextOrganizationId = dto.organizationId === undefined
      ? currentAccount.organizationId
      : dto.organizationId;
    const resolvedOrganizationId = await this.resolveOrganizationIdForRole(nextRole, nextOrganizationId, actorAccessScope);

    if (dto.username && dto.username !== currentAccount.username) {
      const existingUsername = await this.prisma.account.findUnique({
        where: { username: dto.username },
        select: { id: true },
      });

      if (existingUsername) {
        throw new ConflictException(`이미 사용 중인 사용자명입니다: ${dto.username}`);
      }
    }

    const account = await this.prisma.account.update({
      where: { id },
      data: {
        username: dto.username,
        name: dto.name,
        email: dto.email,
        phone: dto.phone === undefined ? undefined : normalizedPhone || null,
        role: nextRole,
        organizationId: resolvedOrganizationId,
        status: dto.status as any,
      },
      include: {
        organization: { select: ACCOUNT_ORGANIZATION_SELECT },
      },
    });

    return this.toResponseDto(account);
  }

  async changePassword(id: string, dto: ChangePasswordDto): Promise<void> {
    const account = await this.prisma.account.findUnique({
      where: { id },
    });

    if (!account) {
      throw new NotFoundException('계정을 찾을 수 없습니다.');
    }

    // 현재 비밀번호 확인
    const isValid = await bcrypt.compare(dto.currentPassword, account.passwordHash);
    if (!isValid) {
      throw new BadRequestException('현재 비밀번호가 일치하지 않습니다.');
    }

    // 새 비밀번호 해시
    const passwordHash = await bcrypt.hash(dto.newPassword, 10);

    await this.prisma.account.update({
      where: { id },
      data: { passwordHash },
    });
  }

  async resetPassword(id: string, dto: ResetPasswordDto, actor: AccountActorContext): Promise<void> {
    const actorAccessScope = await this.resolveActorAccessScope(actor);

    const account = await this.prisma.account.findUnique({
      where: { id },
      select: { id: true, role: true, organizationId: true },
    });

    if (!account) {
      throw new NotFoundException('계정을 찾을 수 없습니다.');
    }

    await this.assertTargetAccountManageable(account, actorAccessScope);

    const passwordHash = await bcrypt.hash(dto.newPassword, 10);

    await this.prisma.account.update({
      where: { id },
      data: { passwordHash },
    });
  }

  async toggleStatus(id: string, actor: AccountActorContext): Promise<AccountResponseDto> {
    const actorAccessScope = await this.resolveActorAccessScope(actor);
    const account = await this.prisma.account.findUnique({
      where: { id },
    });

    if (!account) {
      throw new NotFoundException('계정을 찾을 수 없습니다.');
    }

    await this.assertTargetAccountManageable(account, actorAccessScope);

    const newStatus = account.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE';

    const updated = await this.prisma.account.update({
      where: { id },
      data: { status: newStatus },
      include: {
        organization: { select: ACCOUNT_ORGANIZATION_SELECT },
      },
    });

    return this.toResponseDto(updated);
  }

  async remove(id: string, actor: AccountActorContext): Promise<void> {
    const actorAccessScope = await this.resolveActorAccessScope(actor);

    const account = await this.prisma.account.findUnique({
      where: { id },
      select: { id: true, role: true, organizationId: true },
    });

    if (!account) {
      throw new NotFoundException('계정을 찾을 수 없습니다.');
    }

    await this.assertTargetAccountManageable(account, actorAccessScope);

    await this.prisma.account.delete({
      where: { id },
    });
  }

  async getStats(actor: AccountActorContext): Promise<AccountStatsDto> {
    const actorAccessScope = await this.resolveActorAccessScope(actor);
    const where: any = {};

    if (actorAccessScope.tier !== 'SUPER_ADMIN') {
      const scopedGroupOrganizationIds = await this.collectScopedGroupOrganizationIds(
        actorAccessScope.scopeOrganizationIds ?? [],
      );

      if (scopedGroupOrganizationIds.length === 0) {
        return {
          total: 0,
          active: 0,
          inactive: 0,
          byRole: {},
        };
      }

      where.role = AdminRole.SITE_ADMIN;
      where.organizationId = { in: scopedGroupOrganizationIds };
    }

    const [total, active, roleStats] = await Promise.all([
      this.prisma.account.count({ where }),
      this.prisma.account.count({ where: { ...where, status: 'ACTIVE' } }),
      this.prisma.account.groupBy({
        by: ['role'],
        where,
        _count: true,
      }),
    ]);

    const byRole: Record<string, number> = {};
    roleStats.forEach((stat) => {
      byRole[stat.role] = stat._count;
    });

    return {
      total,
      active,
      inactive: total - active,
      byRole,
    };
  }

  private toResponseDto(account: any): AccountResponseDto {
    return toAccountResponseDto({
      ...account,
      actorType: account.actorType ?? this.resolveAccountActorType(account),
    });
  }
}
