import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ensureOrganizationInScope } from '../../common/utils/organization-scope.util';
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
  }, scopeOrganizationIds?: string[]) {
    const page = filter.page || 1;
    const limit = filter.limit || 20;
    const skip = (page - 1) * limit;

    const where: any = {};

    if (filter.action) {
      where.action = filter.action;
    }

    if (filter.resourceType) {
      where.resourceType = filter.resourceType;
    }

    if (filter.organizationId) {
      this.ensureOrganizationInScope(filter.organizationId, scopeOrganizationIds);
      where.organizationId = filter.organizationId;
    } else if (scopeOrganizationIds) {
      where.organizationId = { in: scopeOrganizationIds };
    }

    if (filter.startDate || filter.endDate) {
      where.timestamp = {};
      if (filter.startDate) where.timestamp.gte = new Date(filter.startDate);
      if (filter.endDate) where.timestamp.lte = new Date(filter.endDate);
    }

    if (filter.search) {
      where.OR = [
        { resourceName: { contains: filter.search, mode: 'insensitive' } },
        { account: { name: { contains: filter.search, mode: 'insensitive' } } },
      ];
    }

    const [data, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        skip,
        take: limit,
        include: {
          account: { select: { id: true, name: true, username: true } },
        },
        orderBy: { timestamp: 'desc' },
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    return {
      data: data.map((log) => this.toResponseDto(log)),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async findOne(id: string, scopeOrganizationIds?: string[]) {
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

    return this.toResponseDto(log);
  }

  private toResponseDto(log: any) {
    return toAuditLogResponseDto(log);
  }
}
