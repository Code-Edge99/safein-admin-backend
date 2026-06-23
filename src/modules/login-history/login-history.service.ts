import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { resolveLogQueryDateRange } from '../../common/utils/kst-time.util';
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

    // 보존 정책(최근 2년) 내로 조회 범위를 강제한다. 미지정 시 하한을 2년 전으로 기본 설정.
    where.loginTime = resolveLogQueryDateRange(filter.startDate, filter.endDate);

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

  private toResponseDto(log: any) {
    return toLoginHistoryResponseDto(log);
  }
}
