import { Injectable, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CreateTimePolicyDto,
  UpdateTimePolicyDto,
  TimePolicyFilterDto,
  TimePolicyResponseDto,
  TimePolicyListResponseDto,
  TimePolicyStatsDto,
  TimeSlotDto,
} from './dto';

@Injectable()
export class TimePoliciesService {
  constructor(private prisma: PrismaService) {}

  private ensureOrganizationInScope(
    organizationId: string | undefined,
    scopeOrganizationIds?: string[],
  ): void {
    if (!organizationId || !scopeOrganizationIds) return;
    if (!scopeOrganizationIds.includes(organizationId)) {
      throw new ForbiddenException('요청한 조직은 접근 권한 범위를 벗어났습니다.');
    }
  }

  private assertPolicyInScope(policy: { organizationId: string }, scopeOrganizationIds?: string[]): void {
    if (!scopeOrganizationIds) return;
    if (!scopeOrganizationIds.includes(policy.organizationId)) {
      throw new NotFoundException('시간 정책을 찾을 수 없습니다.');
    }
  }

  private async deactivatePoliciesWithoutConditions(tx: any, policyIds: string[]): Promise<void> {
    const uniquePolicyIds = Array.from(new Set(policyIds.filter(Boolean)));
    if (uniquePolicyIds.length === 0) return;

    const policies = await tx.controlPolicy.findMany({
      where: { id: { in: uniquePolicyIds } },
      select: {
        id: true,
        _count: {
          select: {
            zones: true,
            timePolicies: true,
            behaviors: true,
            allowedApps: true,
          },
        },
      },
    });

    const emptyPolicyIds = policies
      .filter(
        (p: any) =>
          p._count.zones + p._count.timePolicies + p._count.behaviors + p._count.allowedApps === 0,
      )
      .map((p: any) => p.id);

    if (emptyPolicyIds.length === 0) return;

    await tx.controlPolicy.updateMany({
      where: { id: { in: emptyPolicyIds } },
      data: { isActive: false },
    });

    await tx.controlPolicyEmployee.deleteMany({
      where: { policyId: { in: emptyPolicyIds } },
    });
  }

  async create(
    createTimePolicyDto: CreateTimePolicyDto,
    scopeOrganizationIds?: string[],
  ): Promise<TimePolicyResponseDto> {
    const { organizationId, workTypeId, timeSlots, excludePeriods, ...rest } = createTimePolicyDto;

    this.ensureOrganizationInScope(organizationId, scopeOrganizationIds);

    // Validate organization
    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
    });
    if (!org) {
      throw new BadRequestException('조직을 찾을 수 없습니다.');
    }

    // Validate work type if provided
    if (workTypeId) {
      const workType = await this.prisma.workType.findUnique({
        where: { id: workTypeId },
      });
      if (!workType) {
        throw new BadRequestException('작업 유형을 찾을 수 없습니다.');
      }
    }

    // Extract start/end time from first time slot (simplified model)
    // Full time slot support can be stored in a separate table
    const firstSlot = timeSlots[0];
    const days = firstSlot?.days || [];

    const policy = await this.prisma.timePolicy.create({
      data: {
        name: rest.name,
        description: rest.description,
        startTime: this.parseTimeToDate(firstSlot?.startTime || '09:00'),
        endTime: this.parseTimeToDate(firstSlot?.endTime || '18:00'),
        days,
        organizationId,
        workTypeId,
        isActive: rest.status !== 'INACTIVE',
        ...(excludePeriods && excludePeriods.length > 0 && {
          excludePeriods: {
            create: excludePeriods.map((ep) => ({
              name: ep.name,
              startTime: this.parseTimeToDate(ep.start),
              endTime: this.parseTimeToDate(ep.end),
            })),
          },
        }),
      },
      include: {
        organization: {
          select: { id: true, name: true },
        },
        workType: {
          select: { id: true, name: true },
        },
        excludePeriods: true,
      },
    });

    return this.toResponseDto(policy, timeSlots);
  }

  async findAll(
    filter: TimePolicyFilterDto,
    scopeOrganizationIds?: string[],
  ): Promise<TimePolicyListResponseDto> {
    const { search, organizationId, workTypeId, status, page = 1, limit = 20 } = filter;
    const skip = (page - 1) * limit;

    const where: any = {};

    if (search) {
      where.name = { contains: search, mode: 'insensitive' };
    }

    if (organizationId) {
      this.ensureOrganizationInScope(organizationId, scopeOrganizationIds);
      where.organizationId = organizationId;
    } else if (scopeOrganizationIds) {
      where.organizationId = { in: scopeOrganizationIds };
    }

    if (workTypeId) {
      where.workTypeId = workTypeId;
    }

    if (status) {
      where.isActive = status === 'ACTIVE';
    }

    const [policies, total] = await Promise.all([
      this.prisma.timePolicy.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          organization: {
            select: { id: true, name: true },
          },
          workType: {
            select: { id: true, name: true },
          },
          excludePeriods: true,
        },
      }),
      this.prisma.timePolicy.count({ where }),
    ]);

    return {
      data: policies.map((p) => this.toResponseDto(p)),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async findOne(id: string, scopeOrganizationIds?: string[]): Promise<TimePolicyResponseDto> {
    const policy = await this.prisma.timePolicy.findUnique({
      where: { id },
      include: {
        organization: {
          select: { id: true, name: true },
        },
        workType: {
          select: { id: true, name: true },
        },
        excludePeriods: true,
      },
    });

    if (!policy) {
      throw new NotFoundException('시간 정책을 찾을 수 없습니다.');
    }

    this.assertPolicyInScope(policy, scopeOrganizationIds);

    return this.toResponseDto(policy);
  }

  async findByOrganization(
    organizationId: string,
    scopeOrganizationIds?: string[],
  ): Promise<TimePolicyResponseDto[]> {
    this.ensureOrganizationInScope(organizationId, scopeOrganizationIds);

    const policies = await this.prisma.timePolicy.findMany({
      where: {
        organizationId,
        isActive: true,
      },
      include: {
        organization: {
          select: { id: true, name: true },
        },
        workType: {
          select: { id: true, name: true },
        },
      },
      orderBy: { name: 'asc' },
    });

    return policies.map((p) => this.toResponseDto(p));
  }

  async update(
    id: string,
    updateTimePolicyDto: UpdateTimePolicyDto,
    scopeOrganizationIds?: string[],
  ): Promise<TimePolicyResponseDto> {
    await this.findOne(id, scopeOrganizationIds);

    const { organizationId, workTypeId, timeSlots, status, excludePeriods, ...rest } = updateTimePolicyDto;

    const updateData: any = { ...rest };

    if (organizationId) {
      this.ensureOrganizationInScope(organizationId, scopeOrganizationIds);
      const org = await this.prisma.organization.findUnique({
        where: { id: organizationId },
      });
      if (!org) {
        throw new BadRequestException('조직을 찾을 수 없습니다.');
      }
      updateData.organizationId = organizationId;
    }

    if (workTypeId !== undefined) {
      if (workTypeId) {
        const workType = await this.prisma.workType.findUnique({
          where: { id: workTypeId },
        });
        if (!workType) {
          throw new BadRequestException('작업 유형을 찾을 수 없습니다.');
        }
      }
      updateData.workTypeId = workTypeId || null;
    }

    if (timeSlots && timeSlots.length > 0) {
      const firstSlot = timeSlots[0];
      updateData.startTime = this.parseTimeToDate(firstSlot.startTime);
      updateData.endTime = this.parseTimeToDate(firstSlot.endTime);
      updateData.days = firstSlot.days;
    }

    if (status !== undefined) {
      updateData.isActive = status === 'ACTIVE';
    }

    // excludePeriods가 있으면 기존 것 모두 삭제 후 새로 생성
    if (excludePeriods !== undefined) {
      await this.prisma.timePolicyExcludePeriod.deleteMany({
        where: { timePolicyId: id },
      });
      if (excludePeriods.length > 0) {
        await this.prisma.timePolicyExcludePeriod.createMany({
          data: excludePeriods.map((ep) => ({
            timePolicyId: id,
            name: ep.name,
            startTime: this.parseTimeToDate(ep.start),
            endTime: this.parseTimeToDate(ep.end),
          })),
        });
      }
    }

    const policy = await this.prisma.timePolicy.update({
      where: { id },
      data: updateData,
      include: {
        organization: {
          select: { id: true, name: true },
        },
        workType: {
          select: { id: true, name: true },
        },
        excludePeriods: true,
      },
    });

    return this.toResponseDto(policy, timeSlots);
  }

  async remove(id: string, scopeOrganizationIds?: string[]): Promise<void> {
    const policy = await this.prisma.timePolicy.findUnique({
      where: { id },
      include: {
        _count: {
          select: {
            policyTimePolicies: true,
          },
        },
      },
    });

    if (!policy) {
      throw new NotFoundException('시간 정책을 찾을 수 없습니다.');
    }

    this.assertPolicyInScope(policy, scopeOrganizationIds);

    await this.prisma.$transaction(async (tx) => {
      const impacted = await tx.controlPolicyTimePolicy.findMany({
        where: { timePolicyId: id },
        select: { policyId: true },
      });

      await tx.controlPolicyTimePolicy.deleteMany({ where: { timePolicyId: id } });
      await tx.timePolicy.delete({ where: { id } });

      await this.deactivatePoliciesWithoutConditions(
        tx,
        impacted.map((item: any) => item.policyId),
      );
    });
  }

  async toggleActive(id: string, scopeOrganizationIds?: string[]): Promise<TimePolicyResponseDto> {
    const policy = await this.prisma.timePolicy.findUnique({
      where: { id },
    });

    if (!policy) {
      throw new NotFoundException('시간 정책을 찾을 수 없습니다.');
    }

    this.assertPolicyInScope(policy, scopeOrganizationIds);

    const updated = await this.prisma.timePolicy.update({
      where: { id },
      data: { isActive: !policy.isActive },
      include: {
        organization: {
          select: { id: true, name: true },
        },
        workType: {
          select: { id: true, name: true },
        },
      },
    });

    return this.toResponseDto(updated);
  }

  async isTimeActive(policyId: string, checkTime?: Date, scopeOrganizationIds?: string[]): Promise<boolean> {
    const policy = await this.prisma.timePolicy.findUnique({
      where: { id: policyId },
      include: { excludePeriods: true },
    });

    if (!policy || !policy.isActive) {
      return false;
    }

    if (scopeOrganizationIds && !scopeOrganizationIds.includes(policy.organizationId)) {
      return false;
    }

    const now = checkTime || new Date();
    const dayOfWeek = this.getDayOfWeek(now);

    // Check if current day is in policy days
    if (!policy.days.includes(dayOfWeek)) {
      return false;
    }

    // Check time range
    const currentTime = this.extractTime(now);
    const startTime = this.extractTime(policy.startTime);
    const endTime = this.extractTime(policy.endTime);

    if (currentTime < startTime || currentTime > endTime) {
      return false;
    }

    // Check exclude periods
    for (const exclude of policy.excludePeriods) {
      const excludeStart = this.extractTime(exclude.startTime);
      const excludeEnd = this.extractTime(exclude.endTime);
      if (currentTime >= excludeStart && currentTime <= excludeEnd) {
        return false;
      }
    }

    return true;
  }

  async getStats(scopeOrganizationIds?: string[]): Promise<TimePolicyStatsDto> {
    const [totalPolicies, activePolicies, byOrgResult] = await Promise.all([
      this.prisma.timePolicy.count({
        where: scopeOrganizationIds ? { organizationId: { in: scopeOrganizationIds } } : undefined,
      }),
      this.prisma.timePolicy.count({
        where: {
          isActive: true,
          ...(scopeOrganizationIds ? { organizationId: { in: scopeOrganizationIds } } : {}),
        },
      }),
      this.prisma.timePolicy.groupBy({
        by: ['organizationId'],
        where: scopeOrganizationIds ? { organizationId: { in: scopeOrganizationIds } } : undefined,
        _count: { organizationId: true },
      }),
    ]);

    // Get organization names
    const orgIds = byOrgResult.map((r) => r.organizationId);
    const orgs = await this.prisma.organization.findMany({
      where: { id: { in: orgIds } },
      select: { id: true, name: true },
    });

    const orgMap = new Map(orgs.map((o) => [o.id, o.name]));
    const byOrganization: Record<string, number> = {};

    byOrgResult.forEach((item) => {
      const orgName = orgMap.get(item.organizationId) || item.organizationId;
      byOrganization[orgName] = item._count.organizationId;
    });

    return {
      totalPolicies,
      activePolicies,
      byOrganization,
    };
  }

  // Helper: Parse HH:MM string to Date with time
  private parseTimeToDate(timeStr: string): Date {
    const [hours, minutes] = timeStr.split(':').map(Number);
    const date = new Date();
    date.setHours(hours, minutes, 0, 0);
    return date;
  }

  // Helper: Extract time as minutes from midnight
  private extractTime(date: Date): number {
    return date.getHours() * 60 + date.getMinutes();
  }

  // Helper: Get day of week in Korean
  private getDayOfWeek(date: Date): string {
    const days = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'];
    return days[date.getDay()];
  }

  // Helper: Format time from Date
  private formatTime(date: Date): string {
    const hours = date.getHours().toString().padStart(2, '0');
    const minutes = date.getMinutes().toString().padStart(2, '0');
    return `${hours}:${minutes}`;
  }

  private toResponseDto(policy: any, customTimeSlots?: TimeSlotDto[]): TimePolicyResponseDto {
    const timeSlots: TimeSlotDto[] = customTimeSlots || [
      {
        startTime: this.formatTime(policy.startTime),
        endTime: this.formatTime(policy.endTime),
        days: policy.days,
      },
    ];

    // Count affected employees (by organization and optionally work type)
    let affectedEmployeeCount = 0;
    // This would require additional query - simplified for now

    // excludePeriods를 프론트엔드 형식으로 변환
    const formattedExcludePeriods = (policy.excludePeriods || []).map((ep: any) => ({
      id: ep.id,
      name: ep.name,
      start: this.formatTime(ep.startTime),
      end: this.formatTime(ep.endTime),
    }));

    return {
      id: policy.id,
      name: policy.name,
      description: policy.description,
      timeSlots,
      priority: 0, // Not in current schema
      allowOutsideHours: false, // Not in current schema
      status: policy.isActive ? 'ACTIVE' : 'INACTIVE',
      organization: policy.organization,
      workType: policy.workType,
      excludePeriods: formattedExcludePeriods,
      affectedEmployeeCount,
      createdAt: policy.createdAt,
      updatedAt: policy.updatedAt,
    };
  }
}
