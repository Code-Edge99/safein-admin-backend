import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

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

  async findAll() {
    const syncedPermissionMap = await this.syncPermissionCatalog();
    const permissionIds = Array.from(syncedPermissionMap.values()).map((permission) => permission.id);

    const rolePermissions = await this.prisma.rolePermission.findMany({
      where: {
        permissionId: {
          in: permissionIds,
        },
      },
    });

    // 역할별 권한 매핑
    const rolePermMap = new Map<string, Set<string>>();
    rolePermissions.forEach((rp) => {
      const set = rolePermMap.get(rp.role) || new Set();
      set.add(rp.permissionId);
      rolePermMap.set(rp.role, set);
    });

    const rows = PERMISSION_CATALOG.map((permission) => {
        const syncedPermission = syncedPermissionMap.get(permission.code);
        const resolvedPermissionId = syncedPermission?.id ?? permission.id;
        return {
          id: resolvedPermissionId,
          code: permission.code,
          name: permission.name,
          category: permission.category,
          description: permission.description,
          superAdmin: rolePermMap.get('SUPER_ADMIN')?.has(resolvedPermissionId) ?? true,
          manager: rolePermMap.get('SITE_ADMIN')?.has(resolvedPermissionId) ?? false,
          lastModified: syncedPermission?.updatedAt || syncedPermission?.createdAt,
          modifiedBy: '시스템',
        };
      }).sort((left, right) => {
        const categoryDiff = (CATEGORY_ORDER[left.category] ?? 999) - (CATEGORY_ORDER[right.category] ?? 999);
        if (categoryDiff !== 0) {
          return categoryDiff;
        }

        return left.name.localeCompare(right.name, 'ko');
      });

    return {
      data: rows,
      total: PERMISSION_CATALOG.length,
      page: 1,
      limit: 100,
      totalPages: 1,
    };
  }

  async update(permissionId: string, data: { role: string; enabled: boolean }) {
    const permission = await this.resolvePermissionById(permissionId);
    if (!permission) {
      throw new NotFoundException('권한을 찾을 수 없습니다.');
    }

    const role = data.role as 'SUPER_ADMIN' | 'SITE_ADMIN';
    const existingRolePermission = await this.prisma.rolePermission.findUnique({
      where: {
        role_permissionId: {
          role: role as any,
          permissionId: permission.id,
        },
      },
    });

    if (data.enabled && existingRolePermission) {
      return {
        success: true,
        changed: false,
        lastModified: permission.updatedAt,
        modifiedBy: '시스템',
      };
    }

    if (!data.enabled && !existingRolePermission) {
      return {
        success: true,
        changed: false,
        lastModified: permission.updatedAt,
        modifiedBy: '시스템',
      };
    }

    const touchedAt = new Date();

    if (data.enabled) {
      await this.prisma.$transaction([
        this.prisma.rolePermission.create({
          data: {
            role: role as any,
            permissionId: permission.id,
          },
        }),
        this.prisma.permission.update({
          where: { id: permission.id },
          data: { updatedAt: touchedAt },
        }),
      ]);
    } else {
      await this.prisma.$transaction([
        this.prisma.rolePermission.delete({
          where: {
            role_permissionId: {
              role: role as any,
              permissionId: permission.id,
            },
          },
        }),
        this.prisma.permission.update({
          where: { id: permission.id },
          data: { updatedAt: touchedAt },
        }),
      ]);
    }

    return {
      success: true,
      changed: true,
      lastModified: touchedAt,
      modifiedBy: '시스템',
    };
  }

  async bulkUpdate(updates: Array<{ permissionId: string; role: string; enabled: boolean }>) {
    let changedCount = 0;

    for (const update of updates) {
      const result = await this.update(update.permissionId, { role: update.role, enabled: update.enabled });
      if (result.changed) {
        changedCount += 1;
      }
    }

    return { success: true, updated: changedCount };
  }
}
