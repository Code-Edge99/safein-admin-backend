import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class PermissionsService {
  constructor(private prisma: PrismaService) {}

  async findAll() {
    const permissions = await this.prisma.permission.findMany({
      where: { isActive: true },
      orderBy: [{ category: 'asc' }, { code: 'asc' }],
    });

    const rolePermissions = await this.prisma.rolePermission.findMany({
      include: { permission: true },
    });

    // 역할별 권한 매핑
    const rolePermMap = new Map<string, Set<string>>();
    rolePermissions.forEach((rp) => {
      const set = rolePermMap.get(rp.role) || new Set();
      set.add(rp.permissionId);
      rolePermMap.set(rp.role, set);
    });

    return {
      data: permissions.map((p) => ({
        id: p.id,
        code: p.code,
        name: p.name,
        category: p.category,
        description: p.description,
        superAdmin: rolePermMap.get('SUPER_ADMIN')?.has(p.id) ?? true,
        manager: rolePermMap.get('SITE_ADMIN')?.has(p.id) ?? false,
        viewer: rolePermMap.get('VIEWER')?.has(p.id) ?? false,
        lastModified: p.updatedAt || p.createdAt,
        modifiedBy: '시스템',
      })),
      total: permissions.length,
      page: 1,
      limit: 100,
      totalPages: 1,
    };
  }

  async update(permissionId: string, data: { role: string; enabled: boolean }) {
    const permission = await this.prisma.permission.findUnique({
      where: { id: permissionId },
    });

    if (!permission) {
      throw new NotFoundException('권한을 찾을 수 없습니다.');
    }

    if (data.enabled) {
      await this.prisma.rolePermission.upsert({
        where: {
          role_permissionId: {
            role: data.role as any,
            permissionId,
          },
        },
        update: {},
        create: {
          role: data.role as any,
          permissionId,
        },
      });
    } else {
      await this.prisma.rolePermission.deleteMany({
        where: {
          role: data.role as any,
          permissionId,
        },
      });
    }

    return { success: true };
  }

  async bulkUpdate(updates: Array<{ permissionId: string; role: string; enabled: boolean }>) {
    for (const update of updates) {
      await this.update(update.permissionId, { role: update.role, enabled: update.enabled });
    }
    return { success: true, updated: updates.length };
  }
}
