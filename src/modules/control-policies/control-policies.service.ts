import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppLanguage, AuditAction, DeviceOS, EmployeeStatus, Prisma, TranslatableEntityType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ContentTranslationService } from '@/common/translation/translation.service';
import {
  ensureOrganizationInScope,
  assertCompanyOrGroupOrganization,
  resolveOrganizationClassification,
} from '../../common/utils/organization-scope.util';
import { resolveEmployeePrimaryIds } from '../../common/utils/employee-identifier.util';
import { toControlPolicyDetailDto, toControlPolicyResponseDto } from './control-policies.mapper';
import { readStageConfig } from '../../common/config/stage.config';
import {
  CreateControlPolicyDto,
  UpdateControlPolicyDto,
  ControlPolicyFilterDto,
  ControlPolicyResponseDto,
  ControlPolicyDetailDto,
  ControlPolicyListResponseDto,
  ControlPolicyStatsDto,
} from './dto';

class PolicyPushSendError extends Error {
  constructor(
    message: string,
    readonly shouldMarkTokenAsError: boolean,
  ) {
    super(message);
    this.name = 'PolicyPushSendError';
  }
}

type PolicyPushTarget = {
  id: string;
  token: string;
  os: DeviceOS;
  employeeId: string;
};

@Injectable()
export class ControlPoliciesService {
  private readonly logger = new Logger(ControlPoliciesService.name);

  constructor(
    private prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly contentTranslationService: ContentTranslationService,
  ) {}

  private async syncControlPolicyTranslations(
    policyId: string,
    values: { name: string; description: string },
    updatedAt: Date,
  ): Promise<void> {
    await this.contentTranslationService.storeEntityTranslations(
      TranslatableEntityType.CONTROL_POLICY,
      policyId,
      AppLanguage.ko,
      values,
      updatedAt,
    );

    this.contentTranslationService.queueTranslationsFromKorean({
      entityType: TranslatableEntityType.CONTROL_POLICY,
      entityId: policyId,
      sourceUpdatedAt: updatedAt,
      fields: [
        { fieldKey: 'name', content: values.name },
        { fieldKey: 'description', content: values.description },
      ],
    });
  }

  private ensureOrganizationInScope(
    organizationId: string | undefined,
    scopeOrganizationIds?: string[],
  ): void {
    ensureOrganizationInScope(organizationId, scopeOrganizationIds);
  }

  private applyOrganizationScope(where: any, scopeOrganizationIds?: string[]): void {
    if (!scopeOrganizationIds) {
      return;
    }

    if (where.organizationId) {
      this.ensureOrganizationInScope(where.organizationId, scopeOrganizationIds);
      return;
    }

    where.organizationId = { in: scopeOrganizationIds };
  }

  private async assertPolicyInScope(policyId: string, scopeOrganizationIds?: string[]): Promise<void> {
    if (!scopeOrganizationIds) {
      return;
    }

    const policy = await this.prisma.controlPolicy.findUnique({
      where: { id: policyId },
      select: { organizationId: true, targetUnitIds: true },
    });

    if (!policy || !scopeOrganizationIds.includes(policy.organizationId)) {
      throw new NotFoundException('제어 정책을 찾을 수 없습니다.');
    }
  }

  async create(
    createDto: CreateControlPolicyDto,
    scopeOrganizationIds?: string[],
    actorUserId?: string,
  ): Promise<ControlPolicyDetailDto> {
    const {
      organizationId,
      zoneIds,
      timePolicyIds,
      behaviorConditionIds,
      allowedAppPresetIds,
      employeeIds,
      targetOrganizationIds,
      ...rest
    } = createDto;
    const resolvedEmployeeIds = await resolveEmployeePrimaryIds(this.prisma, employeeIds);

    this.ensureOrganizationInScope(organizationId, scopeOrganizationIds);

    // Validate organization
    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
    });
    if (!org) {
      throw new BadRequestException('현장을 찾을 수 없습니다.');
    }

    await assertCompanyOrGroupOrganization(this.prisma, organizationId);

    const resolvedTargetUnitIds = await this.resolveTargetUnitIds(
      this.prisma,
      organizationId,
      targetOrganizationIds,
    );

    const existingPolicy = await this.prisma.controlPolicy.findFirst({
      where: { organizationId },
      select: { id: true },
    });
    if (existingPolicy) {
      throw new BadRequestException('정책 소유 현장(회사/그룹)당 통제 정책은 1개만 생성할 수 있습니다. 기존 정책을 수정해주세요.');
    }

    await this.validatePolicyRelations(this.prisma, organizationId, {
      zoneIds,
      timePolicyIds,
      behaviorConditionIds,
      allowedAppPresetIds,
      employeeIds,
      targetOrganizationIds: resolvedTargetUnitIds,
    });

    this.ensureSingleSelectionConstraints({
      timePolicyIds,
      behaviorConditionIds,
    });

    this.ensureRequiredConditionInputsOnCreate({ zoneIds, timePolicyIds });

    // Create policy with all relations
    const policy = await this.prisma.controlPolicy.create({
      data: {
        ...rest,
        organizationId,
        targetUnitIds: resolvedTargetUnitIds,
        createdById: actorUserId,
        updatedById: actorUserId,
        zones: zoneIds?.length
          ? {
              create: zoneIds.map((zoneId) => ({ zoneId })),
            }
          : undefined,
        timePolicies: timePolicyIds?.length
          ? {
              create: timePolicyIds.map((timePolicyId) => ({ timePolicyId })),
            }
          : undefined,
        behaviors: behaviorConditionIds?.length
          ? {
              create: behaviorConditionIds.map((behaviorConditionId) => ({ behaviorConditionId })),
            }
          : undefined,
        allowedApps: allowedAppPresetIds?.length
          ? {
              create: allowedAppPresetIds.map((presetId) => ({ presetId })),
            }
          : undefined,
        targetEmployees: employeeIds?.length
          ? {
              create: resolvedEmployeeIds.map((employeeId) => ({ employeeId })),
            }
          : undefined,
      } as any,
    });

    const detail = await this.findOneDetail(policy.id, scopeOrganizationIds);

    await this.syncControlPolicyTranslations(
      policy.id,
      {
        name: policy.name,
        description: policy.description ?? '',
      },
      policy.updatedAt,
    );

    await this.notifyPolicyChangedForOrganization({
      policyId: policy.id,
      organizationId,
      trigger: 'create',
    });

    return detail;
  }

  async findAll(
    filter: ControlPolicyFilterDto,
    scopeOrganizationIds?: string[],
  ): Promise<ControlPolicyListResponseDto> {
    const { search, organizationId, isActive, page = 1, limit = 20 } = filter;
    const skip = (page - 1) * limit;

    const where: any = {};

    if (search) {
      where.name = { contains: search, mode: 'insensitive' };
    }

    if (organizationId) {
      where.organizationId = organizationId;
    }

    this.applyOrganizationScope(where, scopeOrganizationIds);

    if (isActive !== undefined) {
      where.isActive = isActive;
    }

    const [policies, total] = await Promise.all([
      this.prisma.controlPolicy.findMany({
        where,
        skip,
        take: limit,
        orderBy: [{ priority: 'asc' }, { createdAt: 'desc' }],
        include: {
          organization: { select: { id: true, name: true } },
          zones: {
            include: {
              zone: { select: { id: true, name: true, type: true } },
            },
          },
          timePolicies: {
            include: {
              timePolicy: { select: { id: true, name: true } },
            },
          },
          behaviors: {
            include: {
              behaviorCondition: { select: { id: true, name: true } },
            },
          },
          allowedApps: {
            include: {
                preset: {
                  select: {
                    id: true,
                    name: true,
                    items: {
                      include: {
                        allowedApp: {
                          select: {
                            id: true,
                            name: true,
                            packageName: true,
                            iconUrl: true,
                          },
                        },
                      },
                    },
                  },
                },
            },
          },
          _count: {
            select: {
              zones: true,
              timePolicies: true,
              behaviors: true,
              allowedApps: true,
              targetEmployees: true,
            },
          },
        } as any,
      }),
      this.prisma.controlPolicy.count({ where }),
    ]);

    return {
      data: policies.map((p) => this.toResponseDto(p)),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async findOne(id: string, scopeOrganizationIds?: string[]): Promise<ControlPolicyResponseDto> {
    const policy = await this.prisma.controlPolicy.findFirst({
      where: {
        id,
        ...(scopeOrganizationIds
          ? {
              organizationId: { in: scopeOrganizationIds },
            }
          : {}),
      },
      include: {
        organization: { select: { id: true, name: true } },
        zones: {
          include: {
            zone: { select: { id: true, name: true, type: true } },
          },
        },
        timePolicies: {
          include: {
            timePolicy: { select: { id: true, name: true } },
          },
        },
        behaviors: {
          include: {
            behaviorCondition: { select: { id: true, name: true } },
          },
        },
        allowedApps: {
          include: {
            preset: {
              select: {
                id: true,
                name: true,
                items: {
                  include: {
                    allowedApp: {
                      select: {
                        id: true,
                        name: true,
                        packageName: true,
                        iconUrl: true,
                      },
                    },
                  },
                },
              },
            },
          },
        },
        _count: {
          select: {
            zones: true,
            timePolicies: true,
            behaviors: true,
            allowedApps: true,
            targetEmployees: true,
          },
        },
      } as any,
    });

    if (!policy) {
      throw new NotFoundException('제어 정책을 찾을 수 없습니다.');
    }

    return this.toResponseDto(policy);
  }

  async findByOrganization(
    organizationId: string,
    scopeOrganizationIds?: string[],
  ): Promise<ControlPolicyResponseDto[]> {
    this.ensureOrganizationInScope(organizationId, scopeOrganizationIds);

    const policies = await this.prisma.controlPolicy.findMany({
      where: { organizationId },
      orderBy: [{ priority: 'asc' }, { createdAt: 'desc' }],
      include: {
        organization: { select: { id: true, name: true } },
        _count: {
          select: {
            zones: true,
            timePolicies: true,
            behaviors: true,
            allowedApps: true,
            targetEmployees: true,
          },
        },
      } as any,
    });
    return policies.map(p => this.toResponseDto(p));
  }

  async findOneDetail(id: string, scopeOrganizationIds?: string[]): Promise<ControlPolicyDetailDto> {
    const policy = await this.prisma.controlPolicy.findFirst({
      where: {
        id,
        ...(scopeOrganizationIds
          ? {
              organizationId: { in: scopeOrganizationIds },
            }
          : {}),
      },
      include: {
        organization: { select: { id: true, name: true } },
        zones: {
          include: {
            zone: { select: { id: true, name: true, type: true } },
          },
        },
        timePolicies: {
          include: {
            timePolicy: { select: { id: true, name: true } },
          },
        },
        behaviors: {
          include: {
            behaviorCondition: { select: { id: true, name: true } },
          },
        },
        allowedApps: {
          include: {
            preset: {
              select: {
                id: true,
                name: true,
                items: {
                  include: {
                    allowedApp: {
                      select: {
                        id: true,
                        name: true,
                        packageName: true,
                        iconUrl: true,
                      },
                    },
                  },
                },
              },
            },
          },
        },
        targetEmployees: {
          include: {
            employee: { select: { id: true, name: true } },
          },
        },
      } as any,
    });

    if (!policy) {
      throw new NotFoundException('제어 정책을 찾을 수 없습니다.');
    }

    return this.toDetailDto(policy);
  }

  async update(
    id: string,
    updateDto: UpdateControlPolicyDto,
    scopeOrganizationIds?: string[],
    actorUserId?: string,
  ): Promise<ControlPolicyDetailDto> {
    await this.assertPolicyInScope(id, scopeOrganizationIds);
    await this.findOne(id, scopeOrganizationIds);

    const {
      organizationId,
      zoneIds,
      timePolicyIds,
      behaviorConditionIds,
      allowedAppPresetIds,
      employeeIds,
      targetOrganizationIds,
      ...rest
    } = updateDto;

    // Start transaction for updating relations
    await this.prisma.$transaction(async (tx: any) => {
      // Update basic fields
      const updateData: any = { ...rest };

      const currentPolicy = await tx.controlPolicy.findUnique({
        where: { id },
        select: {
          organizationId: true,
          targetUnitIds: true,
          _count: {
            select: {
              zones: true,
              timePolicies: true,
            },
          },
        },
      });
      if (!currentPolicy) {
        throw new NotFoundException('제어 정책을 찾을 수 없습니다.');
      }

      const hadRequiredConditionMissingBefore =
        this.resolveMissingRequiredConditionsFromCounts({
          zones: currentPolicy._count.zones,
          timePolicies: currentPolicy._count.timePolicies,
        }).length > 0;

      const targetOrganizationId = organizationId ?? currentPolicy.organizationId;
            if (scopeOrganizationIds && !scopeOrganizationIds.includes(targetOrganizationId)) {
              throw new ForbiddenException('요청한 현장은 접근 권한 범위를 벗어났습니다.');
            }
      await assertCompanyOrGroupOrganization(tx, targetOrganizationId);

      const organizationChanged =
        organizationId !== undefined && organizationId !== currentPolicy.organizationId;

      if (organizationId) {
        const org = await tx.organization.findUnique({ where: { id: organizationId } });
        if (!org) throw new BadRequestException('현장을 찾을 수 없습니다.');
        await assertCompanyOrGroupOrganization(tx, organizationId);

        if (organizationChanged) {
          const existingPolicyOnTarget = await tx.controlPolicy.findFirst({
            where: {
              organizationId,
              id: { not: id },
            },
            select: { id: true },
          });
          if (existingPolicyOnTarget) {
            throw new BadRequestException('이동 대상 현장에는 이미 통제 정책이 있습니다. 회사/그룹당 1개 정책만 허용됩니다.');
          }
        }

        updateData.organizationId = organizationId;
      }

      const resolvedTargetUnitIds = await this.resolveTargetUnitIds(
        tx,
        targetOrganizationId,
        targetOrganizationIds,
      );
      updateData.targetUnitIds = resolvedTargetUnitIds;

      await this.validatePolicyRelations(tx, targetOrganizationId, {
        zoneIds,
        timePolicyIds,
        behaviorConditionIds,
        allowedAppPresetIds,
        employeeIds,
        targetOrganizationIds: resolvedTargetUnitIds,
      });

      this.ensureSingleSelectionConstraints({
        timePolicyIds,
        behaviorConditionIds,
      });

      await tx.controlPolicy.update({
        where: { id },
        data: { ...updateData, updatedById: actorUserId },
      });

      // 현장 변경 시 기존 관계 데이터는 재검증 없이 유지하지 않고 안전하게 비웁니다.
      // (새 현장 기준의 관계는 요청 본문으로 다시 설정)
      if (organizationChanged) {
        if (zoneIds === undefined) {
          await tx.controlPolicyZone.deleteMany({ where: { policyId: id } });
        }
        if (timePolicyIds === undefined) {
          await tx.controlPolicyTimePolicy.deleteMany({ where: { policyId: id } });
        }
        if (behaviorConditionIds === undefined) {
          await tx.controlPolicyBehavior.deleteMany({ where: { policyId: id } });
        }
        if (allowedAppPresetIds === undefined) {
          await tx.controlPolicyAllowedApp.deleteMany({ where: { policyId: id } });
        }
        if (employeeIds === undefined) {
          await tx.controlPolicyEmployee.deleteMany({ where: { policyId: id } });
        }
      }

      // Update zones
      if (zoneIds !== undefined) {
        await tx.controlPolicyZone.deleteMany({ where: { policyId: id } });
        if (zoneIds.length > 0) {
          await tx.controlPolicyZone.createMany({
            data: zoneIds.map((zoneId) => ({ policyId: id, zoneId })),
          });
        }
      }

      // Update time policies
      if (timePolicyIds !== undefined) {
        await tx.controlPolicyTimePolicy.deleteMany({ where: { policyId: id } });
        if (timePolicyIds.length > 0) {
          await tx.controlPolicyTimePolicy.createMany({
            data: timePolicyIds.map((timePolicyId) => ({ policyId: id, timePolicyId })),
          });
        }
      }

      // Update behavior conditions
      if (behaviorConditionIds !== undefined) {
        await tx.controlPolicyBehavior.deleteMany({ where: { policyId: id } });
        if (behaviorConditionIds.length > 0) {
          await tx.controlPolicyBehavior.createMany({
            data: behaviorConditionIds.map((behaviorConditionId) => ({
              policyId: id,
              behaviorConditionId,
            })),
          });
        }
      }

      // Update allowed app presets
      if (allowedAppPresetIds !== undefined) {
        await tx.controlPolicyAllowedApp.deleteMany({ where: { policyId: id } });
        if (allowedAppPresetIds.length > 0) {
          await tx.controlPolicyAllowedApp.createMany({
            data: allowedAppPresetIds.map((presetId) => ({ policyId: id, presetId })),
          });
        }
      }

      // Update target employees
      if (employeeIds !== undefined) {
        const resolvedEmployeeIds = await resolveEmployeePrimaryIds(tx, employeeIds);
        await tx.controlPolicyEmployee.deleteMany({ where: { policyId: id } });
        if (resolvedEmployeeIds.length > 0) {
          await tx.controlPolicyEmployee.createMany({
            data: resolvedEmployeeIds.map((employeeId) => ({ policyId: id, employeeId })),
          });
        }
      }

      if (employeeIds === undefined) {
        // 정책 현장과 맞지 않는 개별 대상 직원 할당은 항상 정리
        await tx.controlPolicyEmployee.deleteMany({
          where: {
            policyId: id,
            employee: {
              organizationId: { notIn: resolvedTargetUnitIds },
            },
          },
        });
      }

      await this.applyRequiredConditionActivationPolicy(
        tx,
        id,
        hadRequiredConditionMissingBefore,
      );
    });
    const updatedPolicy = await this.prisma.controlPolicy.findUnique({
      where: { id },
      select: {
        id: true,
        organizationId: true,
        isActive: true,
        name: true,
        description: true,
        updatedAt: true,
      },
    });

    if (updatedPolicy) {
      await this.syncControlPolicyTranslations(
        updatedPolicy.id,
        {
          name: updatedPolicy.name,
          description: updatedPolicy.description ?? '',
        },
        updatedPolicy.updatedAt,
      );

      await this.notifyPolicyChangedForOrganization({
        policyId: updatedPolicy.id,
        organizationId: updatedPolicy.organizationId,
        trigger: updatedPolicy.isActive ? 'update' : 'deactivate',
      });

      if (actorUserId) {
        void this.prisma.auditLog.create({
          data: {
            accountId: actorUserId,
            organizationId: updatedPolicy.organizationId,
            action: AuditAction.UPDATE,
            resourceType: 'ControlPolicy',
            resourceId: updatedPolicy.id,
            resourceName: '제어 정책 수정',
            changesAfter: {
              policyId: updatedPolicy.id,
              updatedById: actorUserId,
            },
          },
        }).catch(() => undefined);
      }
    }

    return this.findOneDetail(id, scopeOrganizationIds);
  }

  async remove(id: string, scopeOrganizationIds?: string[]): Promise<void> {
    await this.assertPolicyInScope(id, scopeOrganizationIds);

    const policy = await this.prisma.controlPolicy.findUnique({
      where: { id },
      select: { id: true, organizationId: true },
    });

    if (!policy) {
      throw new NotFoundException('제어 정책을 찾을 수 없습니다.');
    }

    await this.prisma.$transaction(async (tx: any) => {
      await tx.controlPolicyZone.deleteMany({ where: { policyId: id } });
      await tx.controlPolicyTimePolicy.deleteMany({ where: { policyId: id } });
      await tx.controlPolicyBehavior.deleteMany({ where: { policyId: id } });
      await tx.controlPolicyAllowedApp.deleteMany({ where: { policyId: id } });
      await tx.controlPolicyEmployee.deleteMany({ where: { policyId: id } });
      await tx.controlPolicy.delete({ where: { id } });
    });

    await this.notifyPolicyChangedForOrganization({
      policyId: policy.id,
      organizationId: policy.organizationId,
      trigger: 'deactivate',
    });
  }

  async bulkRemove(
    policyIds: string[],
    scopeOrganizationIds?: string[],
  ): Promise<{ requested: number; deleted: number; skipped: number }> {
    const uniquePolicyIds = Array.from(new Set(policyIds.filter(Boolean)));
    const requested = uniquePolicyIds.length;

    if (uniquePolicyIds.length === 0) {
      return { requested: 0, deleted: 0, skipped: 0 };
    }

    const targetPolicies = await this.prisma.controlPolicy.findMany({
      where: {
        id: { in: uniquePolicyIds },
        ...(scopeOrganizationIds ? { organizationId: { in: scopeOrganizationIds } } : {}),
      },
      select: { id: true, organizationId: true },
    });

    const targetPolicyIds = targetPolicies.map((policy) => policy.id);

    if (targetPolicyIds.length === 0) {
      return { requested, deleted: 0, skipped: requested };
    }

    await this.prisma.$transaction(async (tx: any) => {
      await tx.controlPolicyZone.deleteMany({ where: { policyId: { in: targetPolicyIds } } });
      await tx.controlPolicyTimePolicy.deleteMany({ where: { policyId: { in: targetPolicyIds } } });
      await tx.controlPolicyBehavior.deleteMany({ where: { policyId: { in: targetPolicyIds } } });
      await tx.controlPolicyAllowedApp.deleteMany({ where: { policyId: { in: targetPolicyIds } } });
      await tx.controlPolicyEmployee.deleteMany({ where: { policyId: { in: targetPolicyIds } } });
      await tx.controlPolicy.deleteMany({ where: { id: { in: targetPolicyIds } } });
    });

    await this.notifyPoliciesByContext(targetPolicies, 'deactivate');

    return {
      requested,
      deleted: targetPolicyIds.length,
      skipped: Math.max(0, requested - targetPolicyIds.length),
    };
  }

  async bulkSetActive(
    policyIds: string[],
    isActive: boolean,
    scopeOrganizationIds?: string[],
  ): Promise<{ requested: number; updated: number; skipped: number }> {
    const uniquePolicyIds = Array.from(new Set(policyIds.filter(Boolean)));
    const requested = uniquePolicyIds.length;

    if (uniquePolicyIds.length === 0) {
      return { requested: 0, updated: 0, skipped: 0 };
    }

    const targetPolicies = await this.prisma.controlPolicy.findMany({
      where: {
        id: { in: uniquePolicyIds },
        ...(scopeOrganizationIds ? { organizationId: { in: scopeOrganizationIds } } : {}),
      },
      select: {
        id: true,
        isActive: true,
        _count: {
          select: {
            zones: true,
            timePolicies: true,
          },
        },
      },
    });

    const activationEligiblePolicyIds = targetPolicies
      .filter((policy) => {
        if (!isActive) {
          return true;
        }

        return this.resolveMissingRequiredConditionsFromCounts({
          zones: policy._count.zones,
          timePolicies: policy._count.timePolicies,
        }).length === 0;
      })
      .map((policy) => policy.id);

    const changedTargetPolicyIds = targetPolicies
      .filter((policy) => activationEligiblePolicyIds.includes(policy.id) && policy.isActive !== isActive)
      .map((policy) => policy.id);

    if (changedTargetPolicyIds.length === 0) {
      return { requested, updated: 0, skipped: requested };
    }

    const result = await this.prisma.controlPolicy.updateMany({
      where: { id: { in: changedTargetPolicyIds } },
      data: { isActive },
    });

    void this.notifyPoliciesChanged(changedTargetPolicyIds, isActive ? 'activate' : 'deactivate')
      .catch((error) => {
        this.logger.warn(`정책 일괄 상태 변경 후 policy_changed 비동기 전송 실패: ${String(error)}`);
      });

    return {
      requested,
      updated: result.count,
      skipped: Math.max(0, requested - result.count),
    };
  }

  async toggleActive(id: string, scopeOrganizationIds?: string[]): Promise<ControlPolicyResponseDto> {
    await this.assertPolicyInScope(id, scopeOrganizationIds);

    const policy = await this.prisma.controlPolicy.findUnique({
      where: { id },
      select: {
        id: true,
        isActive: true,
        _count: {
          select: {
            zones: true,
            timePolicies: true,
          },
        },
      },
    });
    if (!policy) {
      throw new NotFoundException('제어 정책을 찾을 수 없습니다.');
    }

    if (!policy.isActive) {
      const missingRequiredConditions = this.resolveMissingRequiredConditionsFromCounts({
        zones: policy._count.zones,
        timePolicies: policy._count.timePolicies,
      });

      if (missingRequiredConditions.length > 0) {
        throw new BadRequestException(
          '시간 조건과 구역 조건이 모두 충족되어야 활성화할 수 있습니다. 정책을 수정해 누락 조건을 해소해주세요.',
        );
      }
    }

    const updated = await this.prisma.controlPolicy.update({
      where: { id },
      data: { isActive: !policy.isActive },
      include: {
        organization: { select: { id: true, name: true } },
        _count: {
          select: {
            zones: true,
            timePolicies: true,
            behaviors: true,
            allowedApps: true,
            targetEmployees: true,
          },
        },
      } as any,
    });

    await this.notifyPolicyChangedForOrganization({
      policyId: updated.id,
      organizationId: updated.organizationId,
      trigger: updated.isActive ? 'activate' : 'deactivate',
    });

    return this.toResponseDto(updated);
  }

  async notifyPoliciesChanged(
    policyIds: string[],
    trigger: 'create' | 'activate' | 'update' | 'deactivate' = 'update',
  ): Promise<void> {
    const uniquePolicyIds = Array.from(new Set(policyIds.filter(Boolean)));
    if (uniquePolicyIds.length === 0) {
      return;
    }

    const policies = await this.prisma.controlPolicy.findMany({
      where: {
        id: { in: uniquePolicyIds },
      },
      select: {
        id: true,
        organizationId: true,
      },
    });

    const notifyConcurrency = this.resolvePolicyNotifyConcurrency();

    for (let index = 0; index < policies.length; index += notifyConcurrency) {
      const chunk = policies.slice(index, index + notifyConcurrency);
      const results = await Promise.allSettled(chunk.map((policy) => this.notifyPolicyChangedForOrganization({
        policyId: policy.id,
        organizationId: policy.organizationId,
        trigger,
      })));

      results.forEach((result, chunkIndex) => {
        if (result.status === 'rejected') {
          const failedPolicy = chunk[chunkIndex];
          this.logger.warn(
            `[policy_changed] notifyPoliciesChanged 실패 policyId=${failedPolicy.id}: ${String(result.reason)}`,
          );
        }
      });
    }
  }

  private async notifyPoliciesByContext(
    policies: Array<{ id: string; organizationId: string }>,
    trigger: 'create' | 'activate' | 'update' | 'deactivate',
  ): Promise<void> {
    if (policies.length === 0) {
      return;
    }

    const notifyConcurrency = this.resolvePolicyNotifyConcurrency();

    for (let index = 0; index < policies.length; index += notifyConcurrency) {
      const chunk = policies.slice(index, index + notifyConcurrency);
      const results = await Promise.allSettled(chunk.map((policy) => this.notifyPolicyChangedForOrganization({
        policyId: policy.id,
        organizationId: policy.organizationId,
        trigger,
      })));

      results.forEach((result, chunkIndex) => {
        if (result.status === 'rejected') {
          const failedPolicy = chunk[chunkIndex];
          this.logger.warn(
            `[policy_changed] notifyPoliciesByContext 실패 policyId=${failedPolicy.id}: ${String(result.reason)}`,
          );
        }
      });
    }
  }

  async dispatchPolicyChangedByFilter(
    input: {
      policyIds?: string[];
      organizationId?: string;
      trigger?: 'create' | 'activate' | 'update' | 'deactivate';
    },
    scopeOrganizationIds?: string[],
  ): Promise<{ requested: number; dispatched: number; skipped: number }> {
    const trigger = input.trigger ?? 'update';
    const uniquePolicyIds = Array.from(new Set((input.policyIds ?? []).filter(Boolean)));

    const where: any = {};

    if (trigger !== 'deactivate') {
      where.isActive = true;
    }

    if (uniquePolicyIds.length > 0) {
      where.id = { in: uniquePolicyIds };
    }

    if (input.organizationId) {
      where.organizationId = input.organizationId;
    }

    this.applyOrganizationScope(where, scopeOrganizationIds);

    const targets = await this.prisma.controlPolicy.findMany({
      where,
      select: { id: true },
    });

    const targetPolicyIds = targets.map((target) => target.id);
    if (targetPolicyIds.length === 0) {
      return {
        requested: uniquePolicyIds.length > 0 ? uniquePolicyIds.length : 0,
        dispatched: 0,
        skipped: uniquePolicyIds.length > 0 ? uniquePolicyIds.length : 0,
      };
    }

    await this.notifyPoliciesChanged(targetPolicyIds, trigger);

    const requested = uniquePolicyIds.length > 0 ? uniquePolicyIds.length : targetPolicyIds.length;
    return {
      requested,
      dispatched: targetPolicyIds.length,
      skipped: Math.max(0, requested - targetPolicyIds.length),
    };
  }

  private resolvePolicyNotifyConcurrency(): number {
    const raw = this.configService.get<string>('POLICY_NOTIFY_CONCURRENCY')?.trim();
    const parsed = Number(raw);

    if (Number.isFinite(parsed) && parsed >= 1) {
      return Math.floor(parsed);
    }

    return 5;
  }

  private async resolvePolicyDispatchTargetOrganizationIds(
    ownerOrganizationId: string,
    configuredTargetUnitIds?: string[],
  ): Promise<string[]> {
    const normalizedConfigured = this.normalizeIds(configuredTargetUnitIds);
    if (normalizedConfigured.length > 0) {
      return normalizedConfigured;
    }

    const owner = await this.prisma.organization.findUnique({
      where: { id: ownerOrganizationId },
      select: { id: true, teamCode: true },
    });

    if (!owner) {
      return [];
    }

    if (owner.teamCode) {
      return [owner.id];
    }

    return this.getDescendantUnitOrganizationIds(this.prisma, owner.id);
  }

  private async notifyPolicyChangedForOrganization(params: {
    policyId: string;
    organizationId: string;
    trigger: 'create' | 'activate' | 'update' | 'deactivate';
  }): Promise<void> {
    try {
      const appBackendBaseUrl = this.getAppBackendBaseUrl();
      const endpointUrl = `${appBackendBaseUrl}/internal/push/fcm/send`;
      const dispatchConcurrency = this.resolvePolicyPushConcurrency();
      const dispatchId = `${params.policyId}-${Date.now()}`;
      const endpointHint = this.resolveEndpointHint(endpointUrl);

      this.logger.log(
        `[policy_changed] dispatch start dispatchId=${dispatchId}, trigger=${params.trigger}, policyId=${params.policyId}, org=${params.organizationId}, endpoint=${endpointUrl}, concurrency=${dispatchConcurrency}, endpointHint=${endpointHint}`,
      );

      const policy = await this.prisma.controlPolicy.findUnique({
        where: { id: params.policyId },
        select: { targetUnitIds: true },
      });

      const targetOrganizationIds = await this.resolvePolicyDispatchTargetOrganizationIds(
        params.organizationId,
        policy?.targetUnitIds,
      );

      if (targetOrganizationIds.length === 0) {
        this.logger.warn(
          `[policy_changed] target organization empty; skip dispatch policyId=${params.policyId}, org=${params.organizationId}`,
        );
        return;
      }

      const totalTargetEmployees = await this.prisma.employee.count({
        where: {
          organizationId: { in: targetOrganizationIds },
          status: EmployeeStatus.ACTIVE,
        },
      });

      const devices = await this.prisma.$queryRaw<Array<{
        id: string;
        employeeId: string | null;
        os: DeviceOS;
        pushToken: string | null;
      }>>`
        SELECT
          d.id,
          d."employeeId",
          d.os,
          d."pushToken"
        FROM devices d
        JOIN employees e ON e.id = d."employeeId"
        WHERE d."organizationId" IN (${Prisma.join(targetOrganizationIds)})
          AND e.status = CAST(${EmployeeStatus.ACTIVE} AS "EmployeeStatus")
          AND d."pushToken" IS NOT NULL
          AND (d."pushTokenStatus" IS NULL OR d."pushTokenStatus" <> 'ERROR')
      `;

      const targetEmployeeIds = new Set<string>();
      const failedDispatchDeviceIds: string[] = [];
      const tokenErrorDeviceIds: string[] = [];
      const failureReasons: string[] = [];
      let successCount = 0;
      let targetTokenCount = 0;
      let skippedNoEmployeeCount = 0;
      let skippedNoTokenCount = 0;

      this.logger.log(
        `[policy_changed] candidate devices loaded policyId=${params.policyId}, deviceCount=${devices.length}, targetEmployees=${totalTargetEmployees}`,
      );

      const dispatchTargets: PolicyPushTarget[] = [];

      for (const device of devices) {
        const token = device.pushToken?.trim();
        if (!device.employeeId) {
          skippedNoEmployeeCount += 1;
          continue;
        }

        if (!token) {
          skippedNoTokenCount += 1;
          continue;
        }

        targetEmployeeIds.add(device.employeeId);
        dispatchTargets.push({
          id: device.id,
          employeeId: device.employeeId,
          token,
          os: device.os,
        });
      }

      targetTokenCount = dispatchTargets.length;

      for (let index = 0; index < dispatchTargets.length; index += dispatchConcurrency) {
        const chunk = dispatchTargets.slice(index, index + dispatchConcurrency);

        const results = await Promise.all(chunk.map(async (target) => {
          try {
            await this.sendPolicyChangedPush(endpointUrl, {
              dispatchId,
              token: target.token,
              os: target.os,
              policyId: params.policyId,
              trigger: params.trigger,
            });

            return {
              ok: true,
              deviceId: target.id,
              shouldMarkTokenAsError: false,
              reason: '',
            };
          } catch (error) {
            let shouldMarkTokenAsError = false;
            let reason = String(error);

            if (error instanceof PolicyPushSendError) {
              shouldMarkTokenAsError = error.shouldMarkTokenAsError;
              reason = error.message;
            } else if (error instanceof Error) {
              reason = error.message;
            }

            return {
              ok: false,
              deviceId: target.id,
              shouldMarkTokenAsError,
              reason,
            };
          }
        }));

        for (const result of results) {
          if (result.ok) {
            successCount += 1;
            continue;
          }

          failedDispatchDeviceIds.push(result.deviceId);
          if (result.shouldMarkTokenAsError) {
            tokenErrorDeviceIds.push(result.deviceId);
          }

          if (failureReasons.length < 20) {
            failureReasons.push(`${result.deviceId}:${result.reason}`);
          }
        }
      }

      let markedAsErrorCount = 0;
      if (tokenErrorDeviceIds.length > 0) {
        const uniqueFailedDeviceIds = Array.from(new Set(tokenErrorDeviceIds));
        markedAsErrorCount = await this.prisma.$executeRaw`
          UPDATE devices
          SET "pushTokenStatus" = 'ERROR',
              "updatedAt" = NOW()
          WHERE id IN (${Prisma.join(uniqueFailedDeviceIds)})
        `;
      }

      const summary = {
        dispatchId,
        trigger: params.trigger,
        policyId: params.policyId,
        organizationId: params.organizationId,
        targetOrganizationIds,
        endpointUrl,
        endpointHint,
        dispatchConcurrency,
        targetEmployees: totalTargetEmployees,
        employeesWithToken: targetEmployeeIds.size,
        employeesWithoutToken: Math.max(totalTargetEmployees - targetEmployeeIds.size, 0),
        skippedNoEmployeeCount,
        skippedNoTokenCount,
        targetTokens: targetTokenCount,
        successCount,
        failedCount: failedDispatchDeviceIds.length,
        markedAsErrorCount,
      };

      this.logger.log(`[policy_changed] ${JSON.stringify(summary)}`);

      if (failedDispatchDeviceIds.length > 0) {
        this.logger.warn(
          `[policy_changed] failed device ids dispatchId=${dispatchId}: ${failedDispatchDeviceIds.slice(0, 20).join(', ')}`
          + `${failedDispatchDeviceIds.length > 20 ? ' ...' : ''}`,
        );

        if (failureReasons.length > 0) {
          this.logger.warn(`[policy_changed] failed reasons dispatchId=${dispatchId}: ${failureReasons.join(' | ')}`);
        }
      }

      await this.prisma.auditLog.create({
        data: {
          action: this.resolveAuditActionByTrigger(params.trigger),
          resourceType: 'ControlPolicyPush',
          resourceId: params.policyId,
          resourceName: 'policy_changed 발송',
          organizationId: params.organizationId,
          changesAfter: summary,
        },
      });
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `policy_changed 푸시 처리 실패(policyId=${params.policyId}, trigger=${params.trigger}): ${errorMessage}`,
      );
    }
  }

  private async sendPolicyChangedPush(
    endpointUrl: string,
    params: {
      dispatchId: string;
      token: string;
      os: DeviceOS;
      policyId: string;
      trigger: 'create' | 'activate' | 'update' | 'deactivate';
    },
  ): Promise<void> {
    const policyApplied = params.trigger === 'deactivate' ? 'false' : 'true';
    const isIos = params.os === DeviceOS.iOS;

    const timeoutMs = this.resolvePolicyPushTimeoutMs();
    const abortController = new AbortController();
    const timer = setTimeout(() => abortController.abort(), timeoutMs);

    try {
      const response = await fetch(endpointUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-smombie-dispatch-id': params.dispatchId,
          'x-smombie-source': 'admin-backend:policy_changed',
        },
        signal: abortController.signal,
        body: JSON.stringify({
          message: {
            token: params.token,
            data: {
              type: 'policy_changed',
              policyVersion: params.policyId,
              extraData: {
                reason: params.trigger,
                policyApplied,
                deviceOs: isIos ? 'ios' : 'android',
                iosNeedsBlockedAppsDecision: isIos ? 'true' : 'false',
              },
            },
            android: {
              priority: 'HIGH',
            },
            ...(isIos
              ? {
                  apns: {
                    headers: {
                      'apns-priority': '10',
                      'apns-collapse-id': 'policy_changed',
                    },
                    payload: {
                      aps: {
                        'content-available': 1,
                      },
                    },
                  },
                }
              : {}),
          },
        }),
      });

      if (!response.ok) {
        const responseText = await response.text();
        throw new PolicyPushSendError(
          `status=${response.status}, body=${responseText || 'empty'}`,
          this.shouldMarkTokenAsError(response.status, responseText),
        );
      }
    } catch (error) {
      if (error instanceof PolicyPushSendError) {
        throw error;
      }

      if (error instanceof Error && error.name === 'AbortError') {
        throw new PolicyPushSendError(
          `network-timeout>${timeoutMs}ms, endpoint=${endpointUrl}, dispatchId=${params.dispatchId}`,
          false,
        );
      }

      throw new PolicyPushSendError(
        this.formatFetchError(error, endpointUrl, params.dispatchId),
        false,
      );
    } finally {
      clearTimeout(timer);
    }
  }

  private shouldMarkTokenAsError(statusCode: number, responseText: string): boolean {
    if (statusCode === 502) {
      return true;
    }

    if (statusCode !== 400) {
      return false;
    }

    const body = (responseText || '').toLowerCase();
    return body.includes('invalid-registration-token')
      || body.includes('registration-token-not-registered')
      || body.includes('not a valid fcm registration token')
      || body.includes('registration token is not a valid');
  }

  private resolvePolicyPushConcurrency(): number {
    const raw = this.configService.get<string>('POLICY_PUSH_CONCURRENCY')?.trim();
    const parsed = Number(raw);

    if (Number.isFinite(parsed) && parsed >= 1) {
      return Math.floor(parsed);
    }

    return 20;
  }

  private resolvePolicyPushTimeoutMs(): number {
    const raw = this.configService.get<string>('POLICY_PUSH_TIMEOUT_MS')?.trim();
    const parsed = Number(raw);

    if (Number.isFinite(parsed) && parsed >= 500) {
      return Math.floor(parsed);
    }

    return 8000;
  }

  private resolveEndpointHint(endpointUrl: string): string {
    try {
      const host = new URL(endpointUrl).hostname.toLowerCase();
      if (host === 'localhost' || host === '127.0.0.1') {
        return 'container 환경이면 localhost는 자기 컨테이너를 가리킬 수 있음(APP_BACKEND_BASE_URL 확인 필요)';
      }

      return `host=${host}`;
    } catch {
      return 'endpoint URL 파싱 실패';
    }
  }

  private formatFetchError(error: unknown, endpointUrl: string, dispatchId: string): string {
    if (error instanceof Error) {
      const errorName = error.name || 'Error';
      const errorMessage = error.message || String(error);
      const errorCause = (error as Error & { cause?: unknown }).cause;

      if (typeof errorCause === 'object' && errorCause !== null) {
        const causeCode = 'code' in (errorCause as Record<string, unknown>)
          ? String((errorCause as Record<string, unknown>).code)
          : 'unknown';
        const causeErrno = 'errno' in (errorCause as Record<string, unknown>)
          ? String((errorCause as Record<string, unknown>).errno)
          : 'unknown';
        const causeSyscall = 'syscall' in (errorCause as Record<string, unknown>)
          ? String((errorCause as Record<string, unknown>).syscall)
          : 'unknown';
        const causeAddress = 'address' in (errorCause as Record<string, unknown>)
          ? String((errorCause as Record<string, unknown>).address)
          : 'unknown';

        return `network-fetch-failed name=${errorName}, message=${errorMessage}, code=${causeCode}, errno=${causeErrno}, syscall=${causeSyscall}, address=${causeAddress}, endpoint=${endpointUrl}, dispatchId=${dispatchId}`;
      }

      return `network-fetch-failed name=${errorName}, message=${errorMessage}, endpoint=${endpointUrl}, dispatchId=${dispatchId}`;
    }

    return `network-fetch-failed unknown-error=${String(error)}, endpoint=${endpointUrl}, dispatchId=${dispatchId}`;
  }

  private getAppBackendBaseUrl(): string {
    const baseUrl = readStageConfig(this.configService, 'APP_BACKEND_BASE_URL', {
      dev: 'http://localhost:3100/api/app',
      prod: 'http://localhost:3100/api/app',
    });
    return baseUrl.trim().replace(/\/$/, '');
  }

  private resolveAuditActionByTrigger(
    trigger: 'create' | 'activate' | 'update' | 'deactivate',
  ): AuditAction {
    switch (trigger) {
      case 'create':
        return AuditAction.CREATE;
      case 'activate':
        return AuditAction.ACTIVATE;
      case 'deactivate':
        return AuditAction.DEACTIVATE;
      case 'update':
      default:
        return AuditAction.UPDATE;
    }
  }

  async assignZones(
    policyId: string,
    zoneIds: string[],
    scopeOrganizationIds?: string[],
  ): Promise<ControlPolicyDetailDto> {
    await this.assertPolicyInScope(policyId, scopeOrganizationIds);

    const policy = await this.prisma.controlPolicy.findUnique({
      where: { id: policyId },
      select: {
        organizationId: true,
        _count: {
          select: {
            zones: true,
            timePolicies: true,
          },
        },
      },
    });
    if (!policy) {
      throw new NotFoundException('제어 정책을 찾을 수 없습니다.');
    }

    const hadRequiredConditionMissingBefore =
      this.resolveMissingRequiredConditionsFromCounts({
        zones: policy._count.zones,
        timePolicies: policy._count.timePolicies,
      }).length > 0;

    await this.validatePolicyRelations(this.prisma, policy.organizationId, { zoneIds });

    await this.prisma.$transaction(async (tx: any) => {
      await tx.controlPolicyZone.deleteMany({ where: { policyId } });
      if (zoneIds.length > 0) {
        await tx.controlPolicyZone.createMany({
          data: zoneIds.map((zoneId) => ({ policyId, zoneId })),
        });
      }

      await this.applyRequiredConditionActivationPolicy(
        tx,
        policyId,
        hadRequiredConditionMissingBefore,
      );
    });

    return this.findOneDetail(policyId, scopeOrganizationIds);
  }

  async assignTimePolicies(
    policyId: string,
    timePolicyIds: string[],
    scopeOrganizationIds?: string[],
  ): Promise<ControlPolicyDetailDto> {
    await this.assertPolicyInScope(policyId, scopeOrganizationIds);

    const policy = await this.prisma.controlPolicy.findUnique({
      where: { id: policyId },
      select: {
        organizationId: true,
        _count: {
          select: {
            zones: true,
            timePolicies: true,
          },
        },
      },
    });
    if (!policy) {
      throw new NotFoundException('제어 정책을 찾을 수 없습니다.');
    }

    const hadRequiredConditionMissingBefore =
      this.resolveMissingRequiredConditionsFromCounts({
        zones: policy._count.zones,
        timePolicies: policy._count.timePolicies,
      }).length > 0;

    await this.validatePolicyRelations(this.prisma, policy.organizationId, { timePolicyIds });
    this.ensureSingleSelectionConstraints({ timePolicyIds });

    await this.prisma.$transaction(async (tx: any) => {
      await tx.controlPolicyTimePolicy.deleteMany({ where: { policyId } });
      if (timePolicyIds.length > 0) {
        await tx.controlPolicyTimePolicy.createMany({
          data: timePolicyIds.map((timePolicyId) => ({ policyId, timePolicyId })),
        });
      }

      await this.applyRequiredConditionActivationPolicy(
        tx,
        policyId,
        hadRequiredConditionMissingBefore,
      );
    });

    return this.findOneDetail(policyId, scopeOrganizationIds);
  }

  async assignBehaviorConditions(
    policyId: string,
    behaviorConditionIds: string[],
    scopeOrganizationIds?: string[],
  ): Promise<ControlPolicyDetailDto> {
    await this.assertPolicyInScope(policyId, scopeOrganizationIds);

    const policy = await this.prisma.controlPolicy.findUnique({
      where: { id: policyId },
      select: {
        organizationId: true,
        _count: {
          select: {
            zones: true,
            timePolicies: true,
          },
        },
      },
    });
    if (!policy) {
      throw new NotFoundException('제어 정책을 찾을 수 없습니다.');
    }

    const hadRequiredConditionMissingBefore =
      this.resolveMissingRequiredConditionsFromCounts({
        zones: policy._count.zones,
        timePolicies: policy._count.timePolicies,
      }).length > 0;

    await this.validatePolicyRelations(this.prisma, policy.organizationId, { behaviorConditionIds });
    this.ensureSingleSelectionConstraints({ behaviorConditionIds });

    await this.prisma.$transaction(async (tx: any) => {
      await tx.controlPolicyBehavior.deleteMany({ where: { policyId } });
      if (behaviorConditionIds.length > 0) {
        await tx.controlPolicyBehavior.createMany({
          data: behaviorConditionIds.map((behaviorConditionId) => ({
            policyId,
            behaviorConditionId,
          })),
        });
      }

      await this.applyRequiredConditionActivationPolicy(
        tx,
        policyId,
        hadRequiredConditionMissingBefore,
      );
    });

    return this.findOneDetail(policyId, scopeOrganizationIds);
  }

  async assignAllowedApps(
    policyId: string,
    allowedAppPresetIds: string[],
    scopeOrganizationIds?: string[],
  ): Promise<ControlPolicyDetailDto> {
    await this.assertPolicyInScope(policyId, scopeOrganizationIds);

    const policy = await this.prisma.controlPolicy.findUnique({
      where: { id: policyId },
      select: {
        organizationId: true,
        _count: {
          select: {
            zones: true,
            timePolicies: true,
          },
        },
      },
    });
    if (!policy) {
      throw new NotFoundException('제어 정책을 찾을 수 없습니다.');
    }

    const hadRequiredConditionMissingBefore =
      this.resolveMissingRequiredConditionsFromCounts({
        zones: policy._count.zones,
        timePolicies: policy._count.timePolicies,
      }).length > 0;

    await this.validatePolicyRelations(this.prisma, policy.organizationId, { allowedAppPresetIds });

    await this.prisma.$transaction(async (tx: any) => {
      await tx.controlPolicyAllowedApp.deleteMany({ where: { policyId } });
      if (allowedAppPresetIds.length > 0) {
        await tx.controlPolicyAllowedApp.createMany({
          data: allowedAppPresetIds.map((presetId) => ({ policyId, presetId })),
        });
      }

      await this.applyRequiredConditionActivationPolicy(
        tx,
        policyId,
        hadRequiredConditionMissingBefore,
      );
    });

    return this.findOneDetail(policyId, scopeOrganizationIds);
  }

  async assignEmployees(
    policyId: string,
    employeeIds: string[],
    scopeOrganizationIds?: string[],
  ): Promise<ControlPolicyDetailDto> {
    await this.assertPolicyInScope(policyId, scopeOrganizationIds);

    const policy = await this.prisma.controlPolicy.findUnique({
      where: { id: policyId },
      select: { organizationId: true, targetUnitIds: true },
    });
    if (!policy) {
      throw new NotFoundException('제어 정책을 찾을 수 없습니다.');
    }

    const resolvedEmployeeIds = await resolveEmployeePrimaryIds(this.prisma, employeeIds);

    await this.validatePolicyRelations(this.prisma, policy.organizationId, {
      employeeIds,
      targetOrganizationIds: policy.targetUnitIds,
    });

    await this.prisma.$transaction(async (tx) => {
      await tx.controlPolicyEmployee.deleteMany({ where: { policyId } });
      if (resolvedEmployeeIds.length > 0) {
        await tx.controlPolicyEmployee.createMany({
          data: resolvedEmployeeIds.map((employeeId) => ({ policyId, employeeId })),
        });
      }
    });

    return this.findOneDetail(policyId, scopeOrganizationIds);
  }

  async getStats(scopeOrganizationIds?: string[]): Promise<ControlPolicyStatsDto> {
    const [totalPolicies, activePolicies, byOrgResult] = await Promise.all([
      this.prisma.controlPolicy.count({
        where: scopeOrganizationIds
          ? {
              organizationId: { in: scopeOrganizationIds },
            }
          : undefined,
      }),
      this.prisma.controlPolicy.count({
        where: {
          isActive: true,
          ...(scopeOrganizationIds
            ? {
                organizationId: { in: scopeOrganizationIds },
              }
            : {}),
        },
      }),
      this.prisma.controlPolicy.groupBy({
        by: ['organizationId'],
        where: scopeOrganizationIds
          ? {
              organizationId: { in: scopeOrganizationIds },
            }
          : undefined,
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

  private normalizeIds(ids?: string[]): string[] {
    if (!ids || ids.length === 0) return [];
    return Array.from(new Set(ids.filter(Boolean)));
  }

  private ensureRequiredConditionInputsOnCreate(params: {
    zoneIds?: string[];
    timePolicyIds?: string[];
  }): void {
    if (this.normalizeIds(params.zoneIds).length === 0) {
      throw new BadRequestException('정책 생성 시 통제 구역은 최소 1개 이상 필요합니다.');
    }

    if (this.normalizeIds(params.timePolicyIds).length === 0) {
      throw new BadRequestException('정책 생성 시 시간 조건은 1개 이상 필요합니다.');
    }
  }

  private resolveMissingRequiredConditionsFromCounts(counts: {
    zones: number;
    timePolicies: number;
  }): Array<'ZONE' | 'TIME_POLICY'> {
    const missing: Array<'ZONE' | 'TIME_POLICY'> = [];

    if (counts.zones === 0) {
      missing.push('ZONE');
    }

    if (counts.timePolicies === 0) {
      missing.push('TIME_POLICY');
    }

    return missing;
  }

  private async applyRequiredConditionActivationPolicy(
    tx: any,
    policyId: string,
    hadRequiredConditionMissingBefore: boolean,
  ): Promise<void> {
    const policy = await tx.controlPolicy.findUnique({
      where: { id: policyId },
      select: {
        isActive: true,
        _count: {
          select: {
            zones: true,
            timePolicies: true,
          },
        },
      },
    });

    if (!policy) {
      throw new NotFoundException('제어 정책을 찾을 수 없습니다.');
    }

    const missingRequiredConditions = this.resolveMissingRequiredConditionsFromCounts({
      zones: policy._count.zones,
      timePolicies: policy._count.timePolicies,
    });

    if (missingRequiredConditions.length > 0) {
      if (policy.isActive) {
        await tx.controlPolicy.update({
          where: { id: policyId },
          data: { isActive: false },
        });
      }
      return;
    }

    if (hadRequiredConditionMissingBefore && !policy.isActive) {
      await tx.controlPolicy.update({
        where: { id: policyId },
        data: { isActive: true },
      });
    }
  }

  private ensureSingleSelectionConstraints(params: {
    timePolicyIds?: string[];
    behaviorConditionIds?: string[];
  }): void {
    if (params.timePolicyIds !== undefined && this.normalizeIds(params.timePolicyIds).length > 1) {
      throw new BadRequestException('시간 조건은 1개만 설정할 수 있습니다.');
    }

    if (params.behaviorConditionIds !== undefined && this.normalizeIds(params.behaviorConditionIds).length > 1) {
      throw new BadRequestException('행동 조건은 1개만 설정할 수 있습니다.');
    }
  }

  private async validatePolicyRelations(
    tx: any,
    organizationId: string,
    relationIds: {
      zoneIds?: string[];
      timePolicyIds?: string[];
      behaviorConditionIds?: string[];
      allowedAppPresetIds?: string[];
      employeeIds?: string[];
      targetOrganizationIds?: string[];
    },
  ): Promise<void> {
    const {
      zoneIds,
      timePolicyIds,
      behaviorConditionIds,
      allowedAppPresetIds,
      employeeIds,
      targetOrganizationIds,
    } = relationIds;
    const targetUnitIds = this.normalizeIds(targetOrganizationIds);
    const relationSourceOrganizationIds = await this.resolveRelationSourceOrganizationIds(tx, organizationId);

    const uniqueZoneIds = this.normalizeIds(zoneIds);
    if (uniqueZoneIds.length > 0) {
      const zoneCount = await tx.zone.count({
        where: {
          id: { in: uniqueZoneIds },
          organizationId: { in: relationSourceOrganizationIds },
          deletedAt: null,
        },
      });
      if (zoneCount !== uniqueZoneIds.length) {
        throw new BadRequestException('구역 ID가 유효하지 않거나 정책 소유 범위(그룹/회사)와 일치하지 않습니다.');
      }
    }

    const uniqueTimePolicyIds = this.normalizeIds(timePolicyIds);
    if (uniqueTimePolicyIds.length > 0) {
      const timePolicyCount = await tx.timePolicy.count({
        where: {
          id: { in: uniqueTimePolicyIds },
          organizationId: { in: relationSourceOrganizationIds },
        },
      });
      if (timePolicyCount !== uniqueTimePolicyIds.length) {
        throw new BadRequestException('시간 정책 ID가 유효하지 않거나 정책 소유 범위(그룹/회사)와 일치하지 않습니다.');
      }
    }

    const uniqueBehaviorConditionIds = this.normalizeIds(behaviorConditionIds);
    if (uniqueBehaviorConditionIds.length > 0) {
      const behaviorConditionCount = await tx.behaviorCondition.count({
        where: {
          id: { in: uniqueBehaviorConditionIds },
          organizationId: { in: relationSourceOrganizationIds },
        },
      });
      if (behaviorConditionCount !== uniqueBehaviorConditionIds.length) {
        throw new BadRequestException('행동 조건 ID가 유효하지 않거나 정책 소유 범위(그룹/회사)와 일치하지 않습니다.');
      }
    }

    const uniquePresetIds = this.normalizeIds(allowedAppPresetIds);
    if (uniquePresetIds.length > 0) {
      const presetCount = await tx.allowedAppPreset.count({
        where: {
          id: { in: uniquePresetIds },
          organizationId: { in: relationSourceOrganizationIds },
        },
      });
      if (presetCount !== uniquePresetIds.length) {
        throw new BadRequestException('허용앱 프리셋 ID가 유효하지 않거나 정책 소유 범위(그룹/회사)와 일치하지 않습니다.');
      }
    }

    const rawEmployeeIds = this.normalizeIds(employeeIds);
    const uniqueEmployeeIds = await resolveEmployeePrimaryIds(tx, rawEmployeeIds);
    if (rawEmployeeIds.length > 0 && uniqueEmployeeIds.length !== rawEmployeeIds.length) {
      throw new BadRequestException('직원 ID가 유효하지 않거나 적용 단위와 일치하지 않습니다.');
    }

    if (uniqueEmployeeIds.length > 0) {
      if (targetUnitIds.length === 0) {
        throw new BadRequestException('직원 개별 지정 시 적용 단위를 먼저 선택해주세요.');
      }

      const employeeCount = await tx.employee.count({
        where: { id: { in: uniqueEmployeeIds }, organizationId: { in: targetUnitIds } },
      });
      if (employeeCount !== uniqueEmployeeIds.length) {
        throw new BadRequestException('직원 ID가 유효하지 않거나 적용 단위와 일치하지 않습니다.');
      }
    }
  }

  private async resolveRelationSourceOrganizationIds(tx: any, organizationId: string): Promise<string[]> {
    const owner = await tx.organization.findUnique({
      where: { id: organizationId },
      select: { id: true, parentId: true, teamCode: true },
    });

    if (!owner) {
      throw new NotFoundException('현장을 찾을 수 없습니다.');
    }

    const ids = new Set<string>([organizationId]);
    const ownerClassification = resolveOrganizationClassification(owner);
    if (ownerClassification !== 'GROUP') {
      return Array.from(ids);
    }

    if (!owner.parentId) {
      return Array.from(ids);
    }

    const parent = await tx.organization.findUnique({
      where: { id: owner.parentId },
      select: { id: true, parentId: true, teamCode: true },
    });

    if (parent && resolveOrganizationClassification(parent) === 'COMPANY') {
      ids.add(parent.id);
    }

    return Array.from(ids);
  }

  private async resolveTargetUnitIds(
    tx: any,
    groupOrganizationId: string,
    requestedTargetOrganizationIds?: string[],
  ): Promise<string[]> {
    const availableUnitIds = await this.getDescendantUnitOrganizationIds(tx, groupOrganizationId);
    const availableUnitSet = new Set(availableUnitIds);

    const requested = this.normalizeIds(requestedTargetOrganizationIds);
    if (requested.length === 0) {
      return availableUnitIds;
    }

    const invalidTargetIds = requested.filter((id) => !availableUnitSet.has(id));
    if (invalidTargetIds.length > 0) {
      throw new BadRequestException('적용 대상 단위가 유효하지 않거나 선택한 그룹 하위가 아닙니다.');
    }

    return requested;
  }

  private async getDescendantUnitOrganizationIds(tx: any, groupOrganizationId: string): Promise<string[]> {
    const organizations = await tx.organization.findMany({
      select: { id: true, parentId: true, teamCode: true },
    });

    const childrenByParent = new Map<string, Array<{ id: string; parentId: string | null; teamCode: string | null }>>();
    for (const organization of organizations) {
      if (!organization.parentId) {
        continue;
      }

      const bucket = childrenByParent.get(organization.parentId) ?? [];
      bucket.push(organization);
      childrenByParent.set(organization.parentId, bucket);
    }

    const result: string[] = [];
    const queue: string[] = [groupOrganizationId];

    while (queue.length > 0) {
      const parentId = queue.shift() as string;
      const children = childrenByParent.get(parentId) ?? [];
      for (const child of children) {
        if (child.teamCode) {
          result.push(child.id);
          continue;
        }

        queue.push(child.id);
      }
    }

    return result;
  }

  private toResponseDto(policy: any): ControlPolicyResponseDto {
    return toControlPolicyResponseDto(policy);
  }

  private toDetailDto(policy: any): ControlPolicyDetailDto {
    return toControlPolicyDetailDto(policy);
  }
}
