import { Injectable, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { AuditAction } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { deactivatePoliciesWithoutConditions } from '../../common/utils/control-policy-cleanup.util';
import { assertOrganizationInScopeOrThrow, ensureOrganizationInScope, assertLeafOrganization } from '../../common/utils/organization-scope.util';
import { ControlPoliciesService } from '../control-policies/control-policies.service';
import { toTimePolicyResponseDto } from './time-policies.mapper';
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
  constructor(
    private prisma: PrismaService,
    private readonly controlPoliciesService: ControlPoliciesService,
  ) {}

  private ensureOrganizationInScope(
    organizationId: string | undefined,
    scopeOrganizationIds?: string[],
  ): void {
    ensureOrganizationInScope(organizationId, scopeOrganizationIds);
  }

  private assertPolicyInScope(policy: { organizationId: string }, scopeOrganizationIds?: string[]): void {
    assertOrganizationInScopeOrThrow(policy.organizationId, scopeOrganizationIds, '시간 정책을 찾을 수 없습니다.');
  }

  async create(
    createTimePolicyDto: CreateTimePolicyDto,
    scopeOrganizationIds?: string[],
    actorUserId?: string,
  ): Promise<TimePolicyResponseDto> {
    const { organizationId, excludePeriods, ...rest } = createTimePolicyDto;

    this.ensureOrganizationInScope(organizationId, scopeOrganizationIds);

    // Validate organization
    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
    });
    if (!org) {
      throw new BadRequestException('조직을 찾을 수 없습니다.');
    }

    await assertLeafOrganization(this.prisma, organizationId);

    const normalizedSlot = this.resolvePrimaryTimeSlot(createTimePolicyDto);
    if (!normalizedSlot) {
      throw new BadRequestException('timeSlots 또는 startTime/endTime/days 입력이 필요합니다.');
    }
    const { startTime, endTime, days } = normalizedSlot;
    const normalizedExcludePeriods = this.normalizeExcludePeriods(excludePeriods);

    const policy = await this.prisma.timePolicy.create({
      data: {
        name: rest.name,
        description: rest.description,
        startTime: this.parseTimeToDate(startTime),
        endTime: this.parseTimeToDate(endTime),
        days,
        organizationId,
        createdById: actorUserId,
        updatedById: actorUserId,
        ...(normalizedExcludePeriods.length > 0 && {
          excludePeriods: {
            create: normalizedExcludePeriods.map((ep) => ({
              reason: ep.reason,
              startTime: this.parseTimeToDate(ep.startTime),
              endTime: this.parseTimeToDate(ep.endTime),
            })),
          },
        }),
      },
      include: {
        organization: {
          select: { id: true, name: true },
        },
        excludePeriods: true,
      },
    });

    return this.toResponseDto(policy);
  }

  async findAll(
    filter: TimePolicyFilterDto,
    scopeOrganizationIds?: string[],
  ): Promise<TimePolicyListResponseDto> {
    const { search, organizationId, page = 1, limit = 20 } = filter;
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
      },
      include: {
        organization: {
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
    actorUserId?: string,
  ): Promise<TimePolicyResponseDto> {
    await this.findOne(id, scopeOrganizationIds);

    const {
      organizationId,
      excludePeriods,
      timeSlots,
      startTime,
      endTime,
      days,
      ...rest
    } = updateTimePolicyDto;

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

    const normalizedSlot = this.resolvePrimaryTimeSlot({
      timeSlots,
      startTime,
      endTime,
      days,
    });
    if (normalizedSlot) {
      updateData.startTime = this.parseTimeToDate(normalizedSlot.startTime);
      updateData.endTime = this.parseTimeToDate(normalizedSlot.endTime);
      updateData.days = normalizedSlot.days;
    }

    // excludePeriods가 있으면 기존 것 모두 삭제 후 새로 생성
    if (excludePeriods !== undefined) {
      const normalizedExcludePeriods = this.normalizeExcludePeriods(excludePeriods);
      await this.prisma.timePolicyExcludePeriod.deleteMany({
        where: { timePolicyId: id },
      });
      if (normalizedExcludePeriods.length > 0) {
        await this.prisma.timePolicyExcludePeriod.createMany({
          data: normalizedExcludePeriods.map((ep) => ({
            timePolicyId: id,
            reason: ep.reason,
            startTime: this.parseTimeToDate(ep.startTime),
            endTime: this.parseTimeToDate(ep.endTime),
          })),
        });
      }
    }

    const policy = await this.prisma.timePolicy.update({
      where: { id },
      data: {
        ...updateData,
        updatedById: actorUserId,
      },
      include: {
        organization: {
          select: { id: true, name: true },
        },
        excludePeriods: true,
      },
    });

    const impactedPolicies = await this.prisma.controlPolicyTimePolicy.findMany({
      where: { timePolicyId: id },
      select: { policyId: true },
    });
    await this.controlPoliciesService.notifyPoliciesChanged(
      impactedPolicies.map((item) => item.policyId),
      'update',
    );

    if (actorUserId) {
      void this.prisma.auditLog.create({
        data: {
          accountId: actorUserId,
          organizationId: policy.organizationId,
          action: AuditAction.UPDATE,
          resourceType: 'TimePolicy',
          resourceId: policy.id,
          resourceName: policy.name,
          changesAfter: {
            timePolicyId: policy.id,
            updatedById: actorUserId,
          },
        },
      }).catch(() => undefined);
    }

    return this.toResponseDto(policy);
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

    let impactedPolicyIds: string[] = [];
    await this.prisma.$transaction(async (tx) => {
      const impacted = await tx.controlPolicyTimePolicy.findMany({
        where: { timePolicyId: id },
        select: { policyId: true },
      });
      impactedPolicyIds = impacted.map((item: any) => item.policyId);

      await tx.controlPolicyTimePolicy.deleteMany({ where: { timePolicyId: id } });
      await tx.timePolicy.delete({ where: { id } });

      await deactivatePoliciesWithoutConditions(
        tx,
        impacted.map((item: any) => item.policyId),
      );
    });

    await this.controlPoliciesService.notifyPoliciesChanged(impactedPolicyIds, 'update');
  }

  async isTimeActive(policyId: string, checkTime?: Date, scopeOrganizationIds?: string[]): Promise<boolean> {
    const policy = await this.prisma.timePolicy.findUnique({
      where: { id: policyId },
      include: { excludePeriods: true },
    });

    if (!policy) {
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

    const inPolicyRange = startTime <= endTime
      ? currentTime >= startTime && currentTime <= endTime
      : currentTime >= startTime || currentTime <= endTime;

    if (!inPolicyRange) {
      return false;
    }

    // Check exclude periods
    for (const exclude of policy.excludePeriods) {
      const excludeStart = this.extractTime(exclude.startTime);
      const excludeEnd = this.extractTime(exclude.endTime);
      const inExcludeRange = excludeStart <= excludeEnd
        ? currentTime >= excludeStart && currentTime <= excludeEnd
        : currentTime >= excludeStart || currentTime <= excludeEnd;

      if (inExcludeRange) {
        return false;
      }
    }

    return true;
  }

  async getStats(scopeOrganizationIds?: string[]): Promise<TimePolicyStatsDto> {
    const [totalPolicies, byOrgResult] = await Promise.all([
      this.prisma.timePolicy.count({
        where: scopeOrganizationIds ? { organizationId: { in: scopeOrganizationIds } } : undefined,
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
      activePolicies: totalPolicies,
      byOrganization,
    };
  }

  // Helper: Parse HH:MM string to Date with time
  private parseTimeToDate(timeStr: string): Date {
    const [hours, minutes] = timeStr.split(':').map(Number);
    const date = new Date(Date.UTC(1970, 0, 1, 0, 0, 0, 0));
    date.setUTCHours(hours, minutes, 0, 0);
    return date;
  }

  // Helper: Extract time as minutes from midnight
  private extractTime(date: Date): number {
    return date.getUTCHours() * 60 + date.getUTCMinutes();
  }

  // Helper: Get day of week in Korean
  private getDayOfWeek(date: Date): string {
    const days = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'];
    return days[date.getDay()];
  }

  private toResponseDto(policy: any, customTimeSlots?: TimeSlotDto[]): TimePolicyResponseDto {
    return toTimePolicyResponseDto(policy, customTimeSlots);
  }

  private resolvePrimaryTimeSlot(
    dto: Partial<CreateTimePolicyDto>,
  ): { startTime: string; endTime: string; days: string[] } | null {
    const firstSlot = Array.isArray(dto.timeSlots) && dto.timeSlots.length > 0
      ? dto.timeSlots[0]
      : null;

    const startTime = (firstSlot?.startTime ?? dto.startTime)?.trim();
    const endTime = (firstSlot?.endTime ?? dto.endTime)?.trim();
    const days = Array.isArray(firstSlot?.days)
      ? firstSlot.days
      : Array.isArray(dto.days)
        ? dto.days
        : [];

    if (!startTime || !endTime || days.length === 0) {
      return null;
    }

    return {
      startTime,
      endTime,
      days,
    };
  }

  private normalizeExcludePeriods(
    excludePeriods?: Array<{ reason: string; start?: string; end?: string; startTime?: string; endTime?: string }>,
  ): Array<{ reason: string; startTime: string; endTime: string }> {
    if (!Array.isArray(excludePeriods)) {
      return [];
    }

    return excludePeriods
      .map((period) => {
        const startTime = (period.start ?? period.startTime ?? '').trim();
        const endTime = (period.end ?? period.endTime ?? '').trim();
        const reason = (period.reason ?? '').trim();

        return {
          reason,
          startTime,
          endTime,
        };
      })
      .filter((period) => period.reason.length > 0 && period.startTime.length > 0 && period.endTime.length > 0);
  }
}
