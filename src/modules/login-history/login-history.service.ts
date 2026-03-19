import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { parseDateInputAsUtc } from '../../common/utils/kst-time.util';
import { toLoginHistoryResponseDto } from './login-history.mapper';

@Injectable()
export class LoginHistoryService {
  constructor(private prisma: PrismaService) {}

  async findAll(filter: {
    search?: string;
    status?: string;
    accountId?: string;
    startDate?: string;
    endDate?: string;
    page?: number;
    limit?: number;
  }, scopeOrganizationIds?: string[]) {
    const page = filter.page || 1;
    const limit = filter.limit || 20;
    const skip = (page - 1) * limit;

    const where: any = {};

    if (filter.status) {
      where.status = filter.status;
    }

    if (filter.accountId) {
      where.accountId = filter.accountId;
    }

    if (scopeOrganizationIds) {
      where.account = {
        organizationId: { in: scopeOrganizationIds },
      };
    }

    if (filter.startDate || filter.endDate) {
      where.loginTime = {};
      if (filter.startDate) where.loginTime.gte = parseDateInputAsUtc(filter.startDate, 'start');
      if (filter.endDate) where.loginTime.lte = parseDateInputAsUtc(filter.endDate, 'end');
    }

    if (filter.search) {
      where.OR = [
        { account: { name: { contains: filter.search, mode: 'insensitive' } } },
        { account: { username: { contains: filter.search, mode: 'insensitive' } } },
        { ipAddress: { contains: filter.search } },
      ];
    }

    const [data, total] = await Promise.all([
      this.prisma.adminLoginHistory.findMany({
        where,
        skip,
        take: limit,
        include: {
          account: { select: { id: true, name: true, username: true, role: true } },
        },
        orderBy: { loginTime: 'desc' },
      }),
      this.prisma.adminLoginHistory.count({ where }),
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
    const log = await this.prisma.adminLoginHistory.findUnique({
      where: { id },
      include: {
        account: {
          select: { id: true, name: true, username: true, role: true, organizationId: true },
        },
      },
    });

    if (!log) {
      throw new NotFoundException('로그인 이력을 찾을 수 없습니다.');
    }

    if (scopeOrganizationIds) {
      const organizationId = log.account?.organizationId;
      if (!organizationId || !scopeOrganizationIds.includes(organizationId)) {
        throw new NotFoundException('로그인 이력을 찾을 수 없습니다.');
      }
    }

    return this.toResponseDto(log);
  }

  private toResponseDto(log: any) {
    return toLoginHistoryResponseDto(log);
  }
}
