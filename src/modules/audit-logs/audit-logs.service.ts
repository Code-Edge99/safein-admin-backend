import { Injectable, NotFoundException } from '@nestjs/common';
import { AdminRole } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ensureOrganizationInScope } from '../../common/utils/organization-scope.util';
import { resolveLogQueryDateRange } from '../../common/utils/kst-time.util';
import { toAuditLogResponseDto } from './audit-logs.mapper';

@Injectable()
export class AuditLogsService {
  constructor(private prisma: PrismaService) {}

  private ensureOrganizationInScope(
    organizationId: string | undefined,
    scopeOrganizationIds?: string[],
  ): void {
    ensureOrganizationInScope(organizationId, scopeOrganizationIds);
  }

  async findAll(filter: {
    search?: string;
    action?: string;
    resourceType?: string;
    organizationId?: string;
    startDate?: string;
    endDate?: string;
    page?: number;
    limit?: number;
  }, scopeOrganizationIds?: string[], actorRole?: string) {
    const page = filter.page || 1;
    const limit = filter.limit || 20;
    const skip = (page - 1) * limit;

    const auditWhere: any = {};

    if (filter.action) {
      auditWhere.action = filter.action;
    }

    if (filter.resourceType) {
      auditWhere.resourceType = filter.resourceType;
    }

    if (filter.organizationId) {
      this.ensureOrganizationInScope(filter.organizationId, scopeOrganizationIds);
      auditWhere.organizationId = filter.organizationId;
    } else if (scopeOrganizationIds) {
      auditWhere.organizationId = { in: scopeOrganizationIds };
    }

    // 보존 정책(최근 2년) 내로 조회 범위를 강제한다. 미지정 시 하한을 2년 전으로 기본 설정.
    const timestampRange = resolveLogQueryDateRange(filter.startDate, filter.endDate);
    auditWhere.timestamp = timestampRange;

    if (filter.search) {
      auditWhere.OR = [
        { resourceName: { contains: filter.search, mode: 'insensitive' } },
        { account: { name: { contains: filter.search, mode: 'insensitive' } } },
      ];
    }

    const [auditLogs, auditTotal] = await Promise.all([
      this.prisma.auditLog.findMany({
        where: auditWhere,
        skip,
        take: limit,
        include: {
          account: { select: { id: true, name: true, username: true } },
        },
        orderBy: { timestamp: 'desc' },
      }),
      this.prisma.auditLog.count({ where: auditWhere }),
    ]);

    return {
      data: auditLogs.map((log) => this.toResponseDto(log, actorRole)),
      total: auditTotal,
      page,
      limit,
      totalPages: Math.ceil(auditTotal / limit),
    };
  }

  async findOne(id: string, scopeOrganizationIds?: string[], actorRole?: string) {
    const log = await this.prisma.auditLog.findUnique({
      where: { id },
      include: {
        account: { select: { id: true, name: true, username: true } },
      },
    });
    if (!log) {
      throw new NotFoundException('감사 로그를 찾을 수 없습니다.');
    }

    if (scopeOrganizationIds && (!log.organizationId || !scopeOrganizationIds.includes(log.organizationId))) {
      throw new NotFoundException('감사 로그를 찾을 수 없습니다.');
    }

    return this.toResponseDto(log, actorRole);
  }

  private toResponseDto(log: any, actorRole?: string) {
    return toAuditLogResponseDto(log, {
      revealActorIdentity: actorRole === AdminRole.SUPER_ADMIN || actorRole === 'SUPER_ADMIN',
    });
  }
}
