import { Injectable, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CreateBehaviorConditionDto,
  UpdateBehaviorConditionDto,
  BehaviorConditionFilterDto,
  BehaviorConditionResponseDto,
  BehaviorConditionListResponseDto,
  BehaviorConditionStatsDto,
} from './dto';

@Injectable()
export class BehaviorConditionsService {
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

  private assertConditionInScope(
    condition: { organizationId: string },
    scopeOrganizationIds?: string[],
  ): void {
    if (!scopeOrganizationIds) return;
    if (!scopeOrganizationIds.includes(condition.organizationId)) {
      throw new NotFoundException('행동 조건을 찾을 수 없습니다.');
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
    createDto: CreateBehaviorConditionDto,
    scopeOrganizationIds?: string[],
  ): Promise<BehaviorConditionResponseDto> {
    const { organizationId, workTypeId, type, ...rest } = createDto;

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

    const condition = await this.prisma.behaviorCondition.create({
      data: {
        ...rest,
        type: type as any,
        organizationId,
        workTypeId,
      },
      include: {
        organization: { select: { id: true, name: true } },
        workType: { select: { id: true, name: true } },
        _count: { select: { policyBehaviors: true } },
      },
    });

    return this.toResponseDto(condition);
  }

  async findAll(
    filter: BehaviorConditionFilterDto,
    scopeOrganizationIds?: string[],
  ): Promise<BehaviorConditionListResponseDto> {
    const { search, type, organizationId, workTypeId, isActive, page = 1, limit = 20 } = filter;
    const skip = (page - 1) * limit;

    const where: any = {};

    if (search) {
      where.name = { contains: search, mode: 'insensitive' };
    }

    if (type) {
      where.type = type;
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

    if (isActive !== undefined) {
      where.isActive = isActive;
    }

    const [conditions, total] = await Promise.all([
      this.prisma.behaviorCondition.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          organization: { select: { id: true, name: true } },
          workType: { select: { id: true, name: true } },
          _count: { select: { policyBehaviors: true } },
        },
      }),
      this.prisma.behaviorCondition.count({ where }),
    ]);

    return {
      data: conditions.map((c) => this.toResponseDto(c)),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async findOne(id: string, scopeOrganizationIds?: string[]): Promise<BehaviorConditionResponseDto> {
    const condition = await this.prisma.behaviorCondition.findUnique({
      where: { id },
      include: {
        organization: { select: { id: true, name: true } },
        workType: { select: { id: true, name: true } },
        _count: { select: { policyBehaviors: true } },
      },
    });

    if (!condition) {
      throw new NotFoundException('행동 조건을 찾을 수 없습니다.');
    }

    this.assertConditionInScope(condition, scopeOrganizationIds);

    return this.toResponseDto(condition);
  }

  async findByOrganization(
    organizationId: string,
    scopeOrganizationIds?: string[],
  ): Promise<BehaviorConditionResponseDto[]> {
    this.ensureOrganizationInScope(organizationId, scopeOrganizationIds);

    const conditions = await this.prisma.behaviorCondition.findMany({
      where: {
        organizationId,
        isActive: true,
      },
      include: {
        organization: { select: { id: true, name: true } },
        workType: { select: { id: true, name: true } },
        _count: { select: { policyBehaviors: true } },
      },
      orderBy: { name: 'asc' },
    });

    return conditions.map((c) => this.toResponseDto(c));
  }

  async update(
    id: string,
    updateDto: UpdateBehaviorConditionDto,
    scopeOrganizationIds?: string[],
  ): Promise<BehaviorConditionResponseDto> {
    await this.findOne(id, scopeOrganizationIds);

    const { organizationId, workTypeId, type, ...rest } = updateDto;

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

    if (type) {
      updateData.type = type;
    }

    const condition = await this.prisma.behaviorCondition.update({
      where: { id },
      data: updateData,
      include: {
        organization: { select: { id: true, name: true } },
        workType: { select: { id: true, name: true } },
        _count: { select: { policyBehaviors: true } },
      },
    });

    return this.toResponseDto(condition);
  }

  async remove(id: string, scopeOrganizationIds?: string[]): Promise<void> {
    await this.findOne(id, scopeOrganizationIds);

    await this.prisma.$transaction(async (tx) => {
      const impacted = await tx.controlPolicyBehavior.findMany({
        where: { behaviorConditionId: id },
        select: { policyId: true },
      });

      await tx.controlPolicyBehavior.deleteMany({ where: { behaviorConditionId: id } });
      await tx.behaviorCondition.delete({ where: { id } });

      await this.deactivatePoliciesWithoutConditions(
        tx,
        impacted.map((item: any) => item.policyId),
      );
    });
  }

  async toggleActive(id: string, scopeOrganizationIds?: string[]): Promise<BehaviorConditionResponseDto> {
    const condition = await this.prisma.behaviorCondition.findUnique({ where: { id } });

    if (!condition) {
      throw new NotFoundException('행동 조건을 찾을 수 없습니다.');
    }

    this.assertConditionInScope(condition, scopeOrganizationIds);

    const updated = await this.prisma.behaviorCondition.update({
      where: { id },
      data: { isActive: !condition.isActive },
      include: {
        organization: { select: { id: true, name: true } },
        workType: { select: { id: true, name: true } },
        _count: { select: { policyBehaviors: true } },
      },
    });

    return this.toResponseDto(updated);
  }

  async getStats(scopeOrganizationIds?: string[]): Promise<BehaviorConditionStatsDto> {
    const [totalConditions, activeConditions, byTypeResult] = await Promise.all([
      this.prisma.behaviorCondition.count({
        where: scopeOrganizationIds ? { organizationId: { in: scopeOrganizationIds } } : undefined,
      }),
      this.prisma.behaviorCondition.count({
        where: {
          isActive: true,
          ...(scopeOrganizationIds ? { organizationId: { in: scopeOrganizationIds } } : {}),
        },
      }),
      this.prisma.behaviorCondition.groupBy({
        by: ['type'],
        where: scopeOrganizationIds ? { organizationId: { in: scopeOrganizationIds } } : undefined,
        _count: { type: true },
      }),
    ]);

    const byType: Record<string, number> = {};
    byTypeResult.forEach((item) => {
      byType[item.type] = item._count.type;
    });

    return {
      totalConditions,
      activeConditions,
      byType,
    };
  }

  private toResponseDto(condition: any): BehaviorConditionResponseDto {
    return {
      id: condition.id,
      name: condition.name,
      type: condition.type,
      distanceThreshold: condition.distanceThreshold,
      stepsThreshold: condition.stepsThreshold,
      speedThreshold: condition.speedThreshold,
      description: condition.description,
      isActive: condition.isActive,
      organization: condition.organization,
      workType: condition.workType,
      policyCount: condition._count?.policyBehaviors ?? 0,
      createdAt: condition.createdAt,
      updatedAt: condition.updatedAt,
    };
  }
}
