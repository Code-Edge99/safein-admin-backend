import { Injectable, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { AppLanguage, AuditAction, TranslatableEntityType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { deactivatePoliciesWithoutConditions } from '../../common/utils/control-policy-cleanup.util';
import { assertOrganizationInScopeOrThrow, ensureOrganizationInScope, assertConditionOwnerOrganization, resolvePolicySourceOrganizationIds } from '../../common/utils/organization-scope.util';
import { ContentTranslationService } from '@/common/translation/translation.service';
import { ControlPoliciesService } from '../control-policies/control-policies.service';
import { toBehaviorConditionResponseDto } from './behavior-conditions.mapper';
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
  constructor(
    private prisma: PrismaService,
    private readonly contentTranslationService: ContentTranslationService,
    private readonly controlPoliciesService: ControlPoliciesService,
  ) {}

  private async syncBehaviorConditionTranslations(
    conditionId: string,
    values: { name: string; description?: string | null },
    updatedAt: Date,
  ): Promise<void> {
    await this.contentTranslationService.storeEntityTranslations(
      TranslatableEntityType.BEHAVIOR_CONDITION,
      conditionId,
      AppLanguage.ko,
      values,
      updatedAt,
    );

    this.contentTranslationService.queueTranslationsFromKorean({
      entityType: TranslatableEntityType.BEHAVIOR_CONDITION,
      entityId: conditionId,
      sourceUpdatedAt: updatedAt,
      fields: [
        { fieldKey: 'name', content: values.name },
        { fieldKey: 'description', content: values.description ?? '' },
      ],
    });
  }

  private ensureOrganizationInScope(
    organizationId: string | undefined,
    scopeOrganizationIds?: string[],
  ): void {
    ensureOrganizationInScope(organizationId, scopeOrganizationIds);
  }

  private assertConditionInScope(
    condition: { organizationId: string },
    scopeOrganizationIds?: string[],
  ): void {
    assertOrganizationInScopeOrThrow(condition.organizationId, scopeOrganizationIds, '행동 조건을 찾을 수 없습니다.');
  }

  async create(
    createDto: CreateBehaviorConditionDto,
    scopeOrganizationIds?: string[],
    actorUserId?: string,
  ): Promise<BehaviorConditionResponseDto> {
    const {
      organizationId,
      enableDistanceCondition: _enableDistanceCondition,
      enableStepsCondition: _enableStepsCondition,
      enableSpeedCondition: _enableSpeedCondition,
      ...rest
    } = createDto;

    this.ensureOrganizationInScope(organizationId, scopeOrganizationIds);

    // Validate organization
    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
    });
    if (!org) {
      throw new BadRequestException('현장을 찾을 수 없습니다.');
    }

    await assertConditionOwnerOrganization(this.prisma, organizationId);

    const thresholdData = this.resolveThresholds(createDto);

    const condition = await this.prisma.behaviorCondition.create({
      data: {
        ...rest,
        ...thresholdData,
        organizationId,
        createdById: actorUserId,
        updatedById: actorUserId,
      },
      include: {
        organization: { select: { id: true, name: true } },
        _count: { select: { policyBehaviors: true } },
      },
    });

    await this.syncBehaviorConditionTranslations(condition.id, {
      name: condition.name,
      description: condition.description ?? '',
    }, condition.updatedAt);

    return this.toResponseDto(condition);
  }

  async findAll(
    filter: BehaviorConditionFilterDto,
    scopeOrganizationIds?: string[],
  ): Promise<BehaviorConditionListResponseDto> {
    const {
      search,
      organizationId,
      includePolicySourceOrganizations,
      enableDistanceCondition,
      enableStepsCondition,
      enableSpeedCondition,
      page = 1,
      limit = 20,
    } = filter;
    const skip = (page - 1) * limit;

    const where: any = { deletedAt: null };

    if (search) {
      where.name = { contains: search, mode: 'insensitive' };
    }

    if (enableDistanceCondition !== undefined) {
      where.distanceThreshold = enableDistanceCondition ? { not: null } : null;
    }

    if (enableStepsCondition !== undefined) {
      where.stepsThreshold = enableStepsCondition ? { not: null } : null;
    }

    if (enableSpeedCondition !== undefined) {
      where.speedThreshold = enableSpeedCondition ? { not: null } : null;
    }

    if (organizationId) {
      this.ensureOrganizationInScope(organizationId, scopeOrganizationIds);
      where.organizationId = includePolicySourceOrganizations
        ? { in: await resolvePolicySourceOrganizationIds(this.prisma, organizationId) }
        : organizationId;
    } else if (scopeOrganizationIds) {
      where.organizationId = { in: scopeOrganizationIds };
    }

    const [conditions, total] = await Promise.all([
      this.prisma.behaviorCondition.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          organization: { select: { id: true, name: true } },
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
    const condition = await this.prisma.behaviorCondition.findFirst({
      where: { id, deletedAt: null },
      include: {
        organization: { select: { id: true, name: true } },
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
        deletedAt: null,
      },
      include: {
        organization: { select: { id: true, name: true } },
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
    actorUserId?: string,
  ): Promise<BehaviorConditionResponseDto> {
    const current = await this.prisma.behaviorCondition.findFirst({
      where: { id, deletedAt: null },
      include: {
        organization: { select: { id: true, name: true } },
        _count: { select: { policyBehaviors: true } },
      },
    });

    if (!current) {
      throw new NotFoundException('행동 조건을 찾을 수 없습니다.');
    }

    this.assertConditionInScope(current, scopeOrganizationIds);

    const {
      organizationId,
      enableDistanceCondition: _enableDistanceCondition,
      enableStepsCondition: _enableStepsCondition,
      enableSpeedCondition: _enableSpeedCondition,
      ...rest
    } = updateDto;

    const updateData: any = {
      ...rest,
      ...this.resolveThresholds(updateDto, {
        distanceThreshold: current.distanceThreshold,
        stepsThreshold: current.stepsThreshold,
        speedThreshold: current.speedThreshold,
      }),
    };

    const targetOrganizationId = organizationId === undefined
      ? current.organizationId
      : organizationId;
    const organizationChanged = targetOrganizationId !== current.organizationId;

    if (!targetOrganizationId) {
      throw new BadRequestException('현장을 찾을 수 없습니다.');
    }

    if (organizationId !== undefined) {
      this.ensureOrganizationInScope(targetOrganizationId, scopeOrganizationIds);
      updateData.organizationId = targetOrganizationId;
    }

    const targetOrganization = await this.prisma.organization.findUnique({
      where: { id: targetOrganizationId },
    });
    if (!targetOrganization) {
      throw new BadRequestException('현장을 찾을 수 없습니다.');
    }

    await assertConditionOwnerOrganization(this.prisma, targetOrganizationId);

    const condition = await this.prisma.behaviorCondition.update({
      where: { id },
      data: {
        ...updateData,
        updatedById: actorUserId,
      },
      include: {
        organization: { select: { id: true, name: true } },
        _count: { select: { policyBehaviors: true } },
      },
    });

    await this.syncBehaviorConditionTranslations(condition.id, {
      name: condition.name,
      description: condition.description ?? '',
    }, condition.updatedAt);

    const detachmentResult = organizationChanged
      ? await this.controlPoliciesService.detachInvalidRelationsForMovedResource('behaviorCondition', id, targetOrganizationId)
      : { detachedPolicyIds: [], deactivatedPolicyIds: [] };

    const impactedPolicies = await this.prisma.controlPolicyBehavior.findMany({
      where: { behaviorConditionId: id },
      select: { policyId: true },
    });
    const deactivatedPolicyIdSet = new Set(detachmentResult.deactivatedPolicyIds);
    const updatePolicyIds = Array.from(new Set([
      ...detachmentResult.detachedPolicyIds,
      ...impactedPolicies.map((item) => item.policyId),
    ])).filter((policyId) => !deactivatedPolicyIdSet.has(policyId));

    if (updatePolicyIds.length > 0) {
      await this.controlPoliciesService.notifyPoliciesChanged(updatePolicyIds, 'update');
    }

    if (detachmentResult.deactivatedPolicyIds.length > 0) {
      await this.controlPoliciesService.notifyPoliciesChanged(detachmentResult.deactivatedPolicyIds, 'deactivate');
    }

    if (actorUserId) {
      void this.prisma.auditLog.create({
        data: {
          accountId: actorUserId,
          organizationId: condition.organizationId,
          action: AuditAction.UPDATE,
          resourceType: 'BehaviorCondition',
          resourceId: condition.id,
          resourceName: condition.name,
          changesAfter: {
            behaviorConditionId: condition.id,
            updatedById: actorUserId,
          },
        },
      }).catch(() => undefined);
    }

    return this.toResponseDto(condition);
  }

  async remove(id: string, scopeOrganizationIds?: string[]): Promise<void> {
    await this.findOne(id, scopeOrganizationIds);

    let impactedPolicyIds: string[] = [];
    await this.prisma.$transaction(async (tx) => {
      const impacted = await tx.controlPolicyBehavior.findMany({
        where: { behaviorConditionId: id },
        select: { policyId: true },
      });
      impactedPolicyIds = impacted.map((item: any) => item.policyId);

      await tx.controlPolicyBehavior.deleteMany({ where: { behaviorConditionId: id } });
      await tx.behaviorCondition.update({
        where: { id },
        data: {
          deletedAt: new Date(),
        },
      });

      await deactivatePoliciesWithoutConditions(
        tx,
        impacted.map((item: any) => item.policyId),
      );
    });

    await this.controlPoliciesService.notifyPoliciesChanged(impactedPolicyIds, 'update');
  }

  async getStats(scopeOrganizationIds?: string[]): Promise<BehaviorConditionStatsDto> {
    const [totalConditions, thresholdStats] = await Promise.all([
      this.prisma.behaviorCondition.count({
        where: scopeOrganizationIds
          ? { organizationId: { in: scopeOrganizationIds }, deletedAt: null }
          : { deletedAt: null },
      }),
      this.prisma.behaviorCondition.findMany({
        where: scopeOrganizationIds
          ? { organizationId: { in: scopeOrganizationIds }, deletedAt: null }
          : { deletedAt: null },
        select: {
          distanceThreshold: true,
          stepsThreshold: true,
          speedThreshold: true,
        },
      }),
    ]);

    const byType: Record<string, number> = {};
    byType.distance = thresholdStats.filter((item) => item.distanceThreshold !== null).length;
    byType.steps = thresholdStats.filter((item) => item.stepsThreshold !== null).length;
    byType.speed = thresholdStats.filter((item) => item.speedThreshold !== null).length;

    return {
      totalConditions,
      activeConditions: totalConditions,
      byType,
    };
  }

  private toResponseDto(condition: any): BehaviorConditionResponseDto {
    return toBehaviorConditionResponseDto(condition);
  }

  private resolveThresholds(
    dto: Partial<CreateBehaviorConditionDto>,
    current?: {
      distanceThreshold: number | null;
      stepsThreshold: number | null;
      speedThreshold: number | null;
    },
  ) {
    const hasDistanceInput = dto.distanceThreshold !== undefined;
    const hasStepsInput = dto.stepsThreshold !== undefined;
    const hasSpeedInput = dto.speedThreshold !== undefined;

    const currentDistanceEnabled = (current?.distanceThreshold ?? null) !== null;
    const currentStepsEnabled = (current?.stepsThreshold ?? null) !== null;
    const currentSpeedEnabled = (current?.speedThreshold ?? null) !== null;

    const enableDistance =
      dto.enableDistanceCondition ?? (hasDistanceInput ? true : current ? currentDistanceEnabled : false);
    const enableSteps = dto.enableStepsCondition ?? (hasStepsInput ? true : current ? currentStepsEnabled : false);
    const enableSpeed = dto.enableSpeedCondition ?? (hasSpeedInput ? true : current ? currentSpeedEnabled : false);

    const distanceThreshold = this.resolveMetricThreshold(
      enableDistance,
      dto.distanceThreshold,
      current?.distanceThreshold ?? null,
      '이동거리',
    );
    const stepsThreshold = this.resolveMetricThreshold(
      enableSteps,
      dto.stepsThreshold,
      current?.stepsThreshold ?? null,
      '걸음',
    );
    const speedThreshold = this.resolveMetricThreshold(
      enableSpeed,
      dto.speedThreshold,
      current?.speedThreshold ?? null,
      '속도',
    );

    if (distanceThreshold === null && stepsThreshold === null && speedThreshold === null) {
      throw new BadRequestException('행동 조건은 최소 1개 이상 활성화되어야 합니다.');
    }

    return {
      distanceThreshold,
      stepsThreshold,
      speedThreshold,
    };
  }

  private resolveMetricThreshold(
    enabled: boolean,
    inputValue: number | undefined,
    currentValue: number | null,
    metricName: string,
  ): number | null {
    if (!enabled) {
      return null;
    }

    const value = inputValue ?? currentValue;
    if (value === null || value === undefined) {
      throw new BadRequestException(`${metricName} 조건이 활성화되어 있으면 기준값이 필요합니다.`);
    }

    if (!Number.isFinite(value) || value <= 0) {
      throw new BadRequestException(`${metricName} 기준값은 1 이상의 양수여야 합니다.`);
    }

    return value;
  }
}
