import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AdminRole,
  PermissionTargetRole as PrismaPermissionTargetRole,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { resolveOrganizationClassification } from '../../common/utils/organization-scope.util';
import {
  BulkUpdateCompanyPermissionItemDto,
  BulkUpdateCompanyPermissionsResultDto,
  EffectivePermissionsResponseDto,
  PermissionActorTypeEnum,
  PermissionMatrixResponseDto,
  PermissionTargetRoleEnum,
  UpdateCompanyPermissionDto,
  UpdateCompanyPermissionResultDto,
} from './dto/permissions.dto';

type PermissionActorContext = {
  id?: string;
  role?: string;
  organizationId?: string;
  scopeOrganizationIds?: string[];
};

type ResolvedActorScope = {
  actorType: PermissionActorTypeEnum;
  companyOrganizationId?: string;
  companyOrganizationName?: string;
};

type ResolvedCompanyScope = {
  id: string;
  name: string;
};

type ResolvedPermissionTarget = {
  enumValue: PermissionTargetRoleEnum;
  prismaValue: PrismaPermissionTargetRole;
};

type PermissionCatalogItem = {
  id: string;
  category: string;
  name: string;
  code: string;
  description?: string;
};

const PERMISSION_CATALOG: PermissionCatalogItem[] = [
  { id: 'perm-dashboard-read', category: '대시보드', name: '대시보드 화면 조회', code: 'DASHBOARD_READ', description: '대시보드 화면을 조회합니다.' },
  { id: 'perm-org-read', category: '현장 관리', name: '현장 관리 조회', code: 'ORG_READ', description: '현장 관리 화면을 조회합니다.' },
  { id: 'perm-org-write', category: '현장 관리', name: '현장 관리 수정', code: 'ORG_WRITE', description: '현장 정보를 생성/수정/삭제합니다.' },
  { id: 'perm-employee-read', category: '직원 관리', name: '직원 관리 조회', code: 'EMPLOYEE_READ', description: '직원 목록/상세 화면을 조회합니다.' },
  { id: 'perm-employee-write', category: '직원 관리', name: '직원 관리 수정', code: 'EMPLOYEE_WRITE', description: '직원 정보를 생성/수정/삭제합니다.' },
  { id: 'perm-notice-read', category: '직원 관리', name: '공지사항 조회', code: 'NOTICE_READ', description: '공지사항 목록/상세를 조회합니다.' },
  { id: 'perm-notice-write', category: '직원 관리', name: '공지사항 등록/수정', code: 'NOTICE_WRITE', description: '공지사항을 등록/수정/삭제합니다.' },
  { id: 'perm-zone-read', category: '정책 관리', name: '구역 조건 조회', code: 'ZONE_READ', description: '구역 조건 화면을 조회합니다.' },
  { id: 'perm-zone-write', category: '정책 관리', name: '구역 조건 수정', code: 'ZONE_WRITE', description: '구역 조건을 생성/수정/삭제합니다.' },
  { id: 'perm-time-policy-read', category: '정책 관리', name: '시간 조건 조회', code: 'TIME_POLICY_READ', description: '시간 조건 화면을 조회합니다.' },
  { id: 'perm-time-policy-write', category: '정책 관리', name: '시간 조건 수정', code: 'TIME_POLICY_WRITE', description: '시간 조건을 생성/수정/삭제합니다.' },
  { id: 'perm-behavior-read', category: '정책 관리', name: '행동 조건 조회', code: 'BEHAVIOR_READ', description: '행동 조건 화면을 조회합니다.' },
  { id: 'perm-behavior-write', category: '정책 관리', name: '행동 조건 수정', code: 'BEHAVIOR_WRITE', description: '행동 조건을 생성/수정/삭제합니다.' },
  { id: 'perm-allowed-app-read', category: '정책 관리', name: '허용앱 프리셋 조회', code: 'ALLOWED_APP_READ', description: '허용앱 프리셋 화면을 조회합니다.' },
  { id: 'perm-allowed-app-write', category: '정책 관리', name: '허용앱 프리셋 수정', code: 'ALLOWED_APP_WRITE', description: '허용앱 프리셋을 생성/수정/삭제합니다.' },
  { id: 'perm-control-policy-read', category: '정책 관리', name: '통제 정책 조회', code: 'CONTROL_POLICY_READ', description: '통제 정책 화면을 조회합니다.' },
  { id: 'perm-control-policy-write', category: '정책 관리', name: '통제 정책 수정', code: 'CONTROL_POLICY_WRITE', description: '통제 정책을 생성/수정/삭제합니다.' },
  { id: 'perm-control-log-read', category: '모니터링', name: '활동 차단 로그 조회', code: 'CONTROL_LOG_READ', description: '활동 차단 로그 화면을 조회합니다.' },
  { id: 'perm-system-log-read', category: '모니터링', name: '시스템 로그 조회', code: 'SYSTEM_LOG_READ', description: '시스템 로그 화면을 조회합니다.' },
  { id: 'perm-login-history-read', category: '직원 관리', name: '로그인 이력 조회', code: 'LOGIN_HISTORY_READ', description: '직원 로그인 이력 화면을 조회합니다.' },
  { id: 'perm-employee-report-read', category: '모니터링', name: '직원별 리포트 조회', code: 'EMPLOYEE_REPORT_READ', description: '직원별 리포트 화면을 조회합니다.' },
  { id: 'perm-site-report-read', category: '모니터링', name: '현장별 통계 조회', code: 'SITE_REPORT_READ', description: '현장별 통계 화면을 조회합니다.' },
  { id: 'perm-account-read', category: '시스템', name: '계정 관리 조회', code: 'ACCOUNT_READ', description: '계정 관리 화면을 조회합니다.' },
  { id: 'perm-account-write', category: '시스템', name: '계정 관리 수정', code: 'ACCOUNT_WRITE', description: '계정을 생성/수정/삭제합니다.' },
  { id: 'perm-permission-read', category: '시스템', name: '권한 관리 조회', code: 'PERMISSION_READ', description: '권한 관리 화면을 조회합니다.' },
  { id: 'perm-permission-write', category: '시스템', name: '권한 관리 수정', code: 'PERMISSION_WRITE', description: '권한 매트릭스를 수정합니다.' },
];

const PERMISSION_CATALOG_BY_LEGACY_ID = new Map(
  PERMISSION_CATALOG.map((permission) => [permission.id, permission]),
);

const PERMISSION_CATALOG_BY_CODE = new Map(
  PERMISSION_CATALOG.map((permission) => [permission.code, permission]),
);

const CATEGORY_ORDER: Record<string, number> = {
  대시보드: 1,
  '현장 관리': 2,
  '직원 관리': 3,
  '정책 관리': 4,
  모니터링: 5,
  시스템: 6,
};

const NON_DELEGABLE_GROUP_MANAGER_CODES = new Set([
  'PERMISSION_READ',
  'PERMISSION_WRITE',
]);

function getDefaultEnabled(code: string, role: 'SUPER_ADMIN' | 'SITE_ADMIN'): boolean {
  if (role === 'SUPER_ADMIN') {
    return true;
  }

  const readOnlyCode = code.endsWith('_READ');

  if (role === 'SITE_ADMIN') {
    if (code === 'ACCOUNT_READ' || code === 'ACCOUNT_WRITE' || code === 'PERMISSION_WRITE') {
      return false;
    }

    if (code === 'PERMISSION_READ') {
      return true;
    }

    return readOnlyCode;
  }

  return false;
}

@Injectable()
export class PermissionsService {
  constructor(private prisma: PrismaService) {}

  private sortRows<T extends { category: string; name: string }>(rows: T[]): T[] {
    return [...rows].sort((left, right) => {
      const categoryDiff = (CATEGORY_ORDER[left.category] ?? 999) - (CATEGORY_ORDER[right.category] ?? 999);
      if (categoryDiff !== 0) {
        return categoryDiff;
      }

      return left.name.localeCompare(right.name, 'ko');
    });
  }

  private async resolveOrganizationNode(
    organizationId: string,
  ): Promise<{ id: string; name: string; parentId: string | null; teamCode: string | null; isActive: boolean } | null> {
    return this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: {
        id: true,
        name: true,
        parentId: true,
        teamCode: true,
        isActive: true,
      },
    });
  }

  private async resolveAncestorCompanyOrganization(
    organizationId: string,
  ): Promise<ResolvedCompanyScope | null> {
    const visited = new Set<string>();
    let currentId: string | null = organizationId;

    while (currentId && !visited.has(currentId)) {
      visited.add(currentId);
      const current = await this.resolveOrganizationNode(currentId);

      if (!current || !current.isActive) {
        return null;
      }

      if (resolveOrganizationClassification(current) === 'COMPANY') {
        return { id: current.id, name: current.name };
      }

      currentId = current.parentId;
    }

    return null;
  }

  private async findFirstActiveCompanyOrganization(): Promise<ResolvedCompanyScope | null> {
    const organizations = await this.prisma.organization.findMany({
      where: { isActive: true },
      select: {
        id: true,
        name: true,
        parentId: true,
        teamCode: true,
      },
      orderBy: { name: 'asc' },
    });

    const company = organizations.find((organization) => resolveOrganizationClassification(organization) === 'COMPANY');
    return company ? { id: company.id, name: company.name } : null;
  }

  private async resolveActorScope(actor: PermissionActorContext): Promise<ResolvedActorScope> {
    if (actor.role === AdminRole.SUPER_ADMIN || actor.role === 'SUPER_ADMIN') {
      return { actorType: PermissionActorTypeEnum.SUPER_ADMIN };
    }

    if (actor.role !== AdminRole.SITE_ADMIN && actor.role !== 'SITE_ADMIN') {
      throw new ForbiddenException('권한 관리 기능은 관리자 계정만 사용할 수 있습니다.');
    }

    if (!actor.organizationId) {
      throw new ForbiddenException('소속 조직이 없는 계정은 권한 관리 기능을 사용할 수 없습니다.');
    }

    const organization = await this.resolveOrganizationNode(actor.organizationId);
    if (!organization || !organization.isActive) {
      throw new ForbiddenException('유효하지 않은 소속 조직입니다.');
    }

    const classification = resolveOrganizationClassification(organization);

    if (classification === 'COMPANY') {
      return {
        actorType: PermissionActorTypeEnum.COMPANY_MANAGER,
        companyOrganizationId: organization.id,
        companyOrganizationName: organization.name,
      };
    }

    if (classification === 'GROUP') {
      const company = await this.resolveAncestorCompanyOrganization(organization.id);
      if (!company) {
        throw new ForbiddenException('회사 범위를 확인할 수 없는 그룹 계정입니다.');
      }

      return {
        actorType: PermissionActorTypeEnum.GROUP_MANAGER,
        companyOrganizationId: company.id,
        companyOrganizationName: company.name,
      };
    }

    throw new ForbiddenException('회사 또는 그룹 관리자만 사용할 수 있습니다.');
  }

  private assertCanManageCompanyPermissions(actorScope: ResolvedActorScope): void {
    if (actorScope.actorType === PermissionActorTypeEnum.GROUP_MANAGER) {
      throw new ForbiddenException('그룹담당자는 권한 관리 기능을 사용할 수 없습니다.');
    }
  }

  private async resolveTargetCompanyScope(
    actorScope: ResolvedActorScope,
    requestedOrganizationId?: string,
  ): Promise<ResolvedCompanyScope | null> {
    if (actorScope.actorType === PermissionActorTypeEnum.COMPANY_MANAGER) {
      if (!actorScope.companyOrganizationId || !actorScope.companyOrganizationName) {
        throw new ForbiddenException('회사 범위를 확인할 수 없습니다.');
      }

      return {
        id: actorScope.companyOrganizationId,
        name: actorScope.companyOrganizationName,
      };
    }

    if (requestedOrganizationId) {
      const company = await this.resolveAncestorCompanyOrganization(requestedOrganizationId);
      if (!company) {
        throw new NotFoundException('대상 회사를 찾을 수 없습니다.');
      }

      return company;
    }

    return this.findFirstActiveCompanyOrganization();
  }

  private resolveRequestedTargetRole(
    actorScope: ResolvedActorScope,
    requestedTargetRole?: PermissionTargetRoleEnum,
  ): ResolvedPermissionTarget {
    if (actorScope.actorType === PermissionActorTypeEnum.SUPER_ADMIN) {
      const targetRole = requestedTargetRole ?? PermissionTargetRoleEnum.COMPANY_MANAGER;
      if (targetRole === PermissionTargetRoleEnum.GROUP_MANAGER) {
        return {
          enumValue: PermissionTargetRoleEnum.GROUP_MANAGER,
          prismaValue: PrismaPermissionTargetRole.GROUP_MANAGER,
        };
      }

      return {
        enumValue: PermissionTargetRoleEnum.COMPANY_MANAGER,
        prismaValue: PrismaPermissionTargetRole.COMPANY_MANAGER,
      };
    }

    return {
      enumValue: PermissionTargetRoleEnum.GROUP_MANAGER,
      prismaValue: PrismaPermissionTargetRole.GROUP_MANAGER,
    };
  }

  private async getGlobalSiteAdminPermissionIdSet(permissionIds: string[]): Promise<Set<string>> {
    if (permissionIds.length === 0) {
      return new Set();
    }

    const rows = await this.prisma.rolePermission.findMany({
      where: {
        role: AdminRole.SITE_ADMIN,
        permissionId: { in: permissionIds },
      },
      select: { permissionId: true },
    });

    return new Set(rows.map((row) => row.permissionId));
  }

  private async getCompanyOverrides(
    permissionIds: string[],
    organizationId: string,
    targetRole: PrismaPermissionTargetRole,
  ) {
    if (permissionIds.length === 0) {
      return new Map();
    }

    const overrides = await this.prisma.groupManagerPermissionOverride.findMany({
      where: {
        organizationId,
        permissionId: { in: permissionIds },
        targetRole,
      },
      include: {
        updatedBy: {
          select: {
            id: true,
            name: true,
            username: true,
          },
        },
      },
    });

    return new Map(overrides.map((override) => [override.permissionId, override] as const));
  }

  private async getEffectiveCompanyManagerPermissionIdSet(
    permissionIds: string[],
    companyOrganizationId: string,
  ): Promise<Set<string>> {
    const basePermissionIds = await this.getGlobalSiteAdminPermissionIdSet(permissionIds);
    const overridesByPermissionId = await this.getCompanyOverrides(
      permissionIds,
      companyOrganizationId,
      PrismaPermissionTargetRole.COMPANY_MANAGER,
    );

    const enabledPermissionIds = new Set<string>();
    for (const permissionId of permissionIds) {
      const override = overridesByPermissionId.get(permissionId);
      if (override?.isEnabled ?? basePermissionIds.has(permissionId)) {
        enabledPermissionIds.add(permissionId);
      }
    }

    return enabledPermissionIds;
  }

  private buildEmptyMatrix(
    targetRole: PermissionTargetRoleEnum,
    canEdit: boolean,
    companyScope?: ResolvedCompanyScope | null,
  ): PermissionMatrixResponseDto {
    return {
      scopeOrganizationId: companyScope?.id,
      scopeOrganizationName: companyScope?.name,
      targetRole,
      canEdit,
      data: [],
      total: 0,
      page: 1,
      limit: 1,
      totalPages: 0,
    };
  }

  private async buildCompanyManagerPermissionMatrix(
    companyScope: ResolvedCompanyScope,
    canEdit: boolean,
  ): Promise<PermissionMatrixResponseDto> {
    const syncedPermissionMap = await this.syncPermissionCatalog();
    const syncedPermissions = Array.from(syncedPermissionMap.values());
    const permissionIds = syncedPermissions.map((permission) => permission.id);
    const siteAdminPermissionIds = await this.getGlobalSiteAdminPermissionIdSet(permissionIds);
    const overridesByPermissionId = await this.getCompanyOverrides(
      permissionIds,
      companyScope.id,
      PrismaPermissionTargetRole.COMPANY_MANAGER,
    );

    const rows = this.sortRows(
      PERMISSION_CATALOG
        .map((permission) => {
          const syncedPermission = syncedPermissionMap.get(permission.code);
          const resolvedPermissionId = syncedPermission?.id ?? permission.id;
          const override = overridesByPermissionId.get(resolvedPermissionId);
          const enabled = override?.isEnabled ?? siteAdminPermissionIds.has(resolvedPermissionId);

          return {
            id: resolvedPermissionId,
            code: permission.code,
            name: permission.name,
            category: permission.category,
            description: permission.description,
            enabled,
            assignable: true,
            lastModified: override?.updatedAt ?? syncedPermission?.updatedAt ?? syncedPermission?.createdAt,
            modifiedBy: override
              ? (override.updatedBy?.name || override.updatedBy?.username || '슈퍼 관리자')
              : '전역 기본값',
          };
        }),
    );

    return {
      scopeOrganizationId: companyScope.id,
      scopeOrganizationName: companyScope.name,
      targetRole: PermissionTargetRoleEnum.COMPANY_MANAGER,
      canEdit,
      data: rows,
      total: rows.length,
      page: 1,
      limit: rows.length || 1,
      totalPages: 1,
    };
  }

  private async buildGroupManagerPermissionMatrix(
    companyScope: ResolvedCompanyScope,
    canEdit: boolean,
  ): Promise<PermissionMatrixResponseDto> {
    const syncedPermissionMap = await this.syncPermissionCatalog();
    const syncedPermissions = Array.from(syncedPermissionMap.values());
    const permissionIds = syncedPermissions.map((permission) => permission.id);
    const companyManagerPermissionIds = await this.getEffectiveCompanyManagerPermissionIdSet(permissionIds, companyScope.id);
    const overridesByPermissionId = await this.getCompanyOverrides(
      permissionIds,
      companyScope.id,
      PrismaPermissionTargetRole.GROUP_MANAGER,
    );

    const rows = this.sortRows(
      PERMISSION_CATALOG
        .filter((permission) => !NON_DELEGABLE_GROUP_MANAGER_CODES.has(permission.code))
        .map((permission) => {
          const syncedPermission = syncedPermissionMap.get(permission.code);
          const resolvedPermissionId = syncedPermission?.id ?? permission.id;
          const canAssign = companyManagerPermissionIds.has(resolvedPermissionId);
          const override = overridesByPermissionId.get(resolvedPermissionId);
          const enabled = canAssign && (override?.isEnabled ?? true);

          return {
            id: resolvedPermissionId,
            code: permission.code,
            name: permission.name,
            category: permission.category,
            description: permission.description,
            enabled,
            assignable: canAssign,
            lastModified: override?.updatedAt ?? (canAssign ? syncedPermission?.updatedAt ?? syncedPermission?.createdAt : undefined),
            modifiedBy: override
              ? (override.updatedBy?.name || override.updatedBy?.username || '회사 관리자')
              : (canAssign ? '회사 관리자 기본값' : '회사 관리자 미보유'),
          };
        }),
    );

    return {
      scopeOrganizationId: companyScope.id,
      scopeOrganizationName: companyScope.name,
      targetRole: PermissionTargetRoleEnum.GROUP_MANAGER,
      canEdit,
      data: rows,
      total: rows.length,
      page: 1,
      limit: rows.length || 1,
      totalPages: 1,
    };
  }

  private isPermissionMetadataChanged(
    existingPermission: {
      category: string;
      name: string;
      description: string | null;
      isActive: boolean;
    },
    catalogPermission: PermissionCatalogItem,
  ) {
    return existingPermission.category !== catalogPermission.category
      || existingPermission.name !== catalogPermission.name
      || (existingPermission.description ?? null) !== (catalogPermission.description ?? null)
      || existingPermission.isActive !== true;
  }

  private async ensureCatalogPermission(catalogPermission: PermissionCatalogItem) {
    const existingPermission = await this.prisma.permission.findUnique({
      where: { code: catalogPermission.code },
    });

    if (!existingPermission) {
      return this.prisma.permission.create({
        data: {
          category: catalogPermission.category,
          name: catalogPermission.name,
          code: catalogPermission.code,
          description: catalogPermission.description,
          isActive: true,
        },
      });
    }

    if (!this.isPermissionMetadataChanged(existingPermission, catalogPermission)) {
      return existingPermission;
    }

    return this.prisma.permission.update({
      where: { id: existingPermission.id },
      data: {
        category: catalogPermission.category,
        name: catalogPermission.name,
        description: catalogPermission.description,
        isActive: true,
      },
    });
  }

  private async syncPermissionCatalog() {
    const existingPermissions = await this.prisma.permission.findMany({
      where: {
        code: {
          in: PERMISSION_CATALOG.map((permission) => permission.code),
        },
      },
    });

    const existingPermissionsByCode = new Map(
      existingPermissions.map((permission) => [permission.code, permission]),
    );

    const existingPermissionCodes = new Set(
      existingPermissions.map((permission) => permission.code),
    );

    const permissionsToCreate = PERMISSION_CATALOG.filter(
      (permission) => !existingPermissionsByCode.has(permission.code),
    );

    const permissionsToUpdate = PERMISSION_CATALOG.filter((permission) => {
      const existingPermission = existingPermissionsByCode.get(permission.code);
      if (!existingPermission) {
        return false;
      }

      return this.isPermissionMetadataChanged(existingPermission, permission);
    });

    if (permissionsToCreate.length > 0) {
      await this.prisma.permission.createMany({
        data: permissionsToCreate.map((permission) => ({
          category: permission.category,
          name: permission.name,
          code: permission.code,
          description: permission.description,
          isActive: true,
        })),
        skipDuplicates: true,
      });
    }

    if (permissionsToUpdate.length > 0) {
      await this.prisma.$transaction(
        permissionsToUpdate.map((permission) =>
          this.prisma.permission.update({
            where: { code: permission.code },
            data: {
              category: permission.category,
              name: permission.name,
              description: permission.description,
              isActive: true,
            },
          }),
        ),
      );
    }

    const synced = permissionsToCreate.length > 0 || permissionsToUpdate.length > 0
      ? await this.prisma.permission.findMany({
        where: {
          code: {
            in: PERMISSION_CATALOG.map((permission) => permission.code),
          },
        },
      })
      : existingPermissions;

    const map = new Map<string, (typeof synced)[number]>();
    synced.forEach((permission) => {
      map.set(permission.code, permission);
    });

    const missingDefaults: Array<{ role: any; permissionId: string }> = [];

    for (const permission of synced) {
      if (existingPermissionCodes.has(permission.code)) {
        continue;
      }

      for (const role of ['SUPER_ADMIN', 'SITE_ADMIN'] as const) {
        if (!getDefaultEnabled(permission.code, role)) {
          continue;
        }

        missingDefaults.push({ role, permissionId: permission.id });
      }
    }

    if (missingDefaults.length > 0) {
      await this.prisma.rolePermission.createMany({
        data: missingDefaults,
        skipDuplicates: true,
      });
    }

    return map;
  }

  private async resolvePermissionById(permissionId: string) {
    const catalogByLegacyId = PERMISSION_CATALOG_BY_LEGACY_ID.get(permissionId);
    if (catalogByLegacyId) {
      return this.ensureCatalogPermission(catalogByLegacyId);
    }

    const catalogByCode = PERMISSION_CATALOG_BY_CODE.get(permissionId);
    if (catalogByCode) {
      return this.ensureCatalogPermission(catalogByCode);
    }

    const byId = await this.prisma.permission.findUnique({
      where: { id: permissionId },
    });

    if (byId && PERMISSION_CATALOG_BY_CODE.has(byId.code)) {
      return byId;
    }

    return null;
  }

  async findMine(actor: PermissionActorContext): Promise<EffectivePermissionsResponseDto> {
    const syncedPermissionMap = await this.syncPermissionCatalog();
    const actorScope = await this.resolveActorScope(actor);
    const syncedPermissions = Array.from(syncedPermissionMap.values());
    const permissionIds = syncedPermissions.map((permission) => permission.id);

    if (actorScope.actorType === PermissionActorTypeEnum.SUPER_ADMIN) {
      return {
        actorType: PermissionActorTypeEnum.SUPER_ADMIN,
        codes: PERMISSION_CATALOG.map((permission) => permission.code),
      };
    }

    if (actorScope.actorType === PermissionActorTypeEnum.COMPANY_MANAGER) {
      const companyManagerPermissionIds = actorScope.companyOrganizationId
        ? await this.getEffectiveCompanyManagerPermissionIdSet(permissionIds, actorScope.companyOrganizationId)
        : await this.getGlobalSiteAdminPermissionIdSet(permissionIds);

      return {
        actorType: PermissionActorTypeEnum.COMPANY_MANAGER,
        codes: PERMISSION_CATALOG.filter((permission) => {
          const syncedPermission = syncedPermissionMap.get(permission.code);
          const resolvedPermissionId = syncedPermission?.id ?? permission.id;
          return companyManagerPermissionIds.has(resolvedPermissionId);
        }).map((permission) => permission.code),
        companyOrganizationId: actorScope.companyOrganizationId,
        companyOrganizationName: actorScope.companyOrganizationName,
      };
    }

    const companyManagerPermissionIds = actorScope.companyOrganizationId
      ? await this.getEffectiveCompanyManagerPermissionIdSet(permissionIds, actorScope.companyOrganizationId)
      : new Set<string>();
    const overridesByPermissionId = actorScope.companyOrganizationId
      ? await this.getCompanyOverrides(
        permissionIds,
        actorScope.companyOrganizationId,
        PrismaPermissionTargetRole.GROUP_MANAGER,
      )
      : new Map();

    const codes = PERMISSION_CATALOG.filter((permission) => {
      if (NON_DELEGABLE_GROUP_MANAGER_CODES.has(permission.code)) {
        return false;
      }

      const syncedPermission = syncedPermissionMap.get(permission.code);
      const resolvedPermissionId = syncedPermission?.id ?? permission.id;
      const override = overridesByPermissionId.get(resolvedPermissionId);
      return companyManagerPermissionIds.has(resolvedPermissionId) && (override?.isEnabled ?? true);
    }).map((permission) => permission.code);

    return {
      actorType: PermissionActorTypeEnum.GROUP_MANAGER,
      codes,
      companyOrganizationId: actorScope.companyOrganizationId,
      companyOrganizationName: actorScope.companyOrganizationName,
    };
  }

  async findAll(
    actor: PermissionActorContext,
    organizationId?: string,
    requestedTargetRole?: PermissionTargetRoleEnum,
  ): Promise<PermissionMatrixResponseDto> {
    const actorScope = await this.resolveActorScope(actor);
    this.assertCanManageCompanyPermissions(actorScope);
    const targetRole = this.resolveRequestedTargetRole(actorScope, requestedTargetRole);

    const targetCompanyScope = await this.resolveTargetCompanyScope(actorScope, organizationId);
    if (!targetCompanyScope) {
      return this.buildEmptyMatrix(targetRole.enumValue, true);
    }

    if (targetRole.prismaValue === PrismaPermissionTargetRole.COMPANY_MANAGER) {
      return this.buildCompanyManagerPermissionMatrix(targetCompanyScope, true);
    }

    return this.buildGroupManagerPermissionMatrix(targetCompanyScope, true);
  }

  private async updateCompanyManagerPermission(
    companyScope: ResolvedCompanyScope,
    permission: Awaited<ReturnType<PermissionsService['resolvePermissionById']>> & { id: string; updatedAt: Date },
    enabled: boolean,
    actorId?: string,
  ): Promise<UpdateCompanyPermissionResultDto> {
    const basePermissionIds = await this.getGlobalSiteAdminPermissionIdSet([permission.id]);
    const baseEnabled = basePermissionIds.has(permission.id);
    const existingOverride = await this.prisma.groupManagerPermissionOverride.findUnique({
      where: {
        organizationId_permissionId_targetRole: {
          organizationId: companyScope.id,
          permissionId: permission.id,
          targetRole: PrismaPermissionTargetRole.COMPANY_MANAGER,
        },
      },
    });

    if (enabled === baseEnabled) {
      if (existingOverride) {
        await this.prisma.groupManagerPermissionOverride.delete({
          where: {
            organizationId_permissionId_targetRole: {
              organizationId: companyScope.id,
              permissionId: permission.id,
              targetRole: PrismaPermissionTargetRole.COMPANY_MANAGER,
            },
          },
        });
      }

      return {
        success: true,
        changed: Boolean(existingOverride),
        enabled: baseEnabled,
        lastModified: permission.updatedAt,
        modifiedBy: '전역 기본값',
      };
    }

    const touchedAt = new Date();

    await this.prisma.groupManagerPermissionOverride.upsert({
      where: {
        organizationId_permissionId_targetRole: {
          organizationId: companyScope.id,
          permissionId: permission.id,
          targetRole: PrismaPermissionTargetRole.COMPANY_MANAGER,
        },
      },
      update: {
        targetRole: PrismaPermissionTargetRole.COMPANY_MANAGER,
        isEnabled: enabled,
        updatedById: actorId || null,
        updatedAt: touchedAt,
      },
      create: {
        organizationId: companyScope.id,
        permissionId: permission.id,
        targetRole: PrismaPermissionTargetRole.COMPANY_MANAGER,
        isEnabled: enabled,
        updatedById: actorId || null,
        createdAt: touchedAt,
        updatedAt: touchedAt,
      },
    });

    return {
      success: true,
      changed: existingOverride?.isEnabled !== enabled,
      enabled,
      lastModified: touchedAt,
      modifiedBy: actorId ? '슈퍼 관리자' : '전역 설정',
    };
  }

  private async updateGroupManagerPermission(
    companyScope: ResolvedCompanyScope,
    permission: Awaited<ReturnType<PermissionsService['resolvePermissionById']>> & { id: string; updatedAt: Date },
    enabled: boolean,
    actorId?: string,
    modifiedByLabel: string = '회사 관리자',
  ): Promise<UpdateCompanyPermissionResultDto> {
    if (NON_DELEGABLE_GROUP_MANAGER_CODES.has(permission.code)) {
      throw new BadRequestException('이 권한은 그룹담당자에게 위임할 수 없습니다.');
    }

    const companyManagerPermissionIds = await this.getEffectiveCompanyManagerPermissionIdSet([permission.id], companyScope.id);
    const baseEnabled = companyManagerPermissionIds.has(permission.id);

    if (enabled && !baseEnabled) {
      throw new ForbiddenException('회사 관리자에게 부여되지 않은 권한은 그룹담당자에게 위임할 수 없습니다.');
    }

    const existingOverride = await this.prisma.groupManagerPermissionOverride.findUnique({
      where: {
        organizationId_permissionId_targetRole: {
          organizationId: companyScope.id,
          permissionId: permission.id,
          targetRole: PrismaPermissionTargetRole.GROUP_MANAGER,
        },
      },
    });

    if (enabled === baseEnabled) {
      if (existingOverride) {
        await this.prisma.groupManagerPermissionOverride.delete({
          where: {
            organizationId_permissionId_targetRole: {
              organizationId: companyScope.id,
              permissionId: permission.id,
              targetRole: PrismaPermissionTargetRole.GROUP_MANAGER,
            },
          },
        });
      }

      return {
        success: true,
        changed: Boolean(existingOverride),
        enabled: baseEnabled,
        lastModified: baseEnabled ? permission.updatedAt : undefined,
        modifiedBy: baseEnabled ? '회사 관리자 기본값' : '회사 관리자 미보유',
      };
    }

    const touchedAt = new Date();

    await this.prisma.groupManagerPermissionOverride.upsert({
      where: {
        organizationId_permissionId_targetRole: {
          organizationId: companyScope.id,
          permissionId: permission.id,
          targetRole: PrismaPermissionTargetRole.GROUP_MANAGER,
        },
      },
      update: {
        targetRole: PrismaPermissionTargetRole.GROUP_MANAGER,
        isEnabled: enabled,
        updatedById: actorId || null,
        updatedAt: touchedAt,
      },
      create: {
        organizationId: companyScope.id,
        permissionId: permission.id,
        targetRole: PrismaPermissionTargetRole.GROUP_MANAGER,
        isEnabled: enabled,
        updatedById: actorId || null,
        createdAt: touchedAt,
        updatedAt: touchedAt,
      },
    });

    return {
      success: true,
      changed: existingOverride?.isEnabled !== enabled,
      enabled,
      lastModified: touchedAt,
      modifiedBy: actorId ? modifiedByLabel : '회사 설정',
    };
  }

  async update(
    permissionId: string,
    data: UpdateCompanyPermissionDto,
    actor: PermissionActorContext,
  ): Promise<UpdateCompanyPermissionResultDto> {
    const actorScope = await this.resolveActorScope(actor);
    this.assertCanManageCompanyPermissions(actorScope);
    const targetRole = this.resolveRequestedTargetRole(actorScope, data.targetRole);

    const targetCompanyScope = await this.resolveTargetCompanyScope(actorScope, data.organizationId);
    if (!targetCompanyScope) {
      throw new NotFoundException('대상 회사를 찾을 수 없습니다.');
    }

    const permission = await this.resolvePermissionById(permissionId);
    if (!permission) {
      throw new NotFoundException('권한을 찾을 수 없습니다.');
    }

    if (targetRole.prismaValue === PrismaPermissionTargetRole.COMPANY_MANAGER) {
      return this.updateCompanyManagerPermission(targetCompanyScope, permission, data.enabled, actor.id);
    }

    return this.updateGroupManagerPermission(
      targetCompanyScope,
      permission,
      data.enabled,
      actor.id,
      actorScope.actorType === PermissionActorTypeEnum.SUPER_ADMIN ? '슈퍼 관리자' : '회사 관리자',
    );
  }

  async bulkUpdate(
    updates: BulkUpdateCompanyPermissionItemDto[],
    actor: PermissionActorContext,
  ): Promise<BulkUpdateCompanyPermissionsResultDto> {
    let changedCount = 0;

    for (const update of updates) {
      const result = await this.update(
        update.permissionId,
        {
          organizationId: update.organizationId,
          enabled: update.enabled,
          targetRole: update.targetRole,
        },
        actor,
      );
      if (result.changed) {
        changedCount += 1;
      }
    }

    return { success: true, updated: changedCount };
  }
}
