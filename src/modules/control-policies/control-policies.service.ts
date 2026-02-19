import { Injectable, NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CreateControlPolicyDto,
  UpdateControlPolicyDto,
  ControlPolicyFilterDto,
  ControlPolicyResponseDto,
  ControlPolicyDetailDto,
  ControlPolicyListResponseDto,
  ControlPolicyStatsDto,
} from './dto';

@Injectable()
export class ControlPoliciesService {
  constructor(private prisma: PrismaService) {}

  async create(createDto: CreateControlPolicyDto): Promise<ControlPolicyDetailDto> {
    const {
      organizationId,
      workTypeId,
      zoneIds,
      timePolicyIds,
      behaviorConditionIds,
      harmfulAppPresetIds,
      employeeIds,
      ...rest
    } = createDto;

    // Validate organization
    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
    });
    if (!org) {
      throw new BadRequestException('조직을 찾을 수 없습니다.');
    }

    await this.validatePolicyRelations(this.prisma, organizationId, {
      workTypeId,
      zoneIds,
      timePolicyIds,
      behaviorConditionIds,
      harmfulAppPresetIds,
      employeeIds,
    });

    this.ensureAtLeastOneControlConditionInput({
      zoneIds,
      timePolicyIds,
      behaviorConditionIds,
      harmfulAppPresetIds,
    });

    // Check if policy already exists for this work type (1:1 relationship)
    const existingPolicy = await this.prisma.controlPolicy.findUnique({
      where: { workTypeId },
    });
    if (existingPolicy) {
      throw new ConflictException('해당 작업 유형에 이미 정책이 존재합니다.');
    }

    // Create policy with all relations
    const policy = await this.prisma.controlPolicy.create({
      data: {
        ...rest,
        organizationId,
        workTypeId,
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
        harmfulApps: harmfulAppPresetIds?.length
          ? {
              create: harmfulAppPresetIds.map((presetId) => ({ presetId })),
            }
          : undefined,
        targetEmployees: employeeIds?.length
          ? {
              create: employeeIds.map((employeeId) => ({ employeeId })),
            }
          : undefined,
      },
    });

    return this.findOneDetail(policy.id);
  }

  async findAll(filter: ControlPolicyFilterDto): Promise<ControlPolicyListResponseDto> {
    const { search, organizationId, workTypeId, isActive, page = 1, limit = 20 } = filter;
    const skip = (page - 1) * limit;

    const where: any = {};

    if (search) {
      where.name = { contains: search, mode: 'insensitive' };
    }

    if (organizationId) {
      where.organizationId = organizationId;
    }

    if (workTypeId) {
      where.workTypeId = workTypeId;
    }

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
          workType: { select: { id: true, name: true } },
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
              behaviorCondition: { select: { id: true, name: true, type: true } },
            },
          },
          harmfulApps: {
            include: {
              preset: { select: { id: true, name: true } },
            },
          },
          _count: {
            select: {
              zones: true,
              timePolicies: true,
              behaviors: true,
              harmfulApps: true,
              targetEmployees: true,
            },
          },
        },
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

  async findOne(id: string): Promise<ControlPolicyResponseDto> {
    const policy = await this.prisma.controlPolicy.findUnique({
      where: { id },
      include: {
        organization: { select: { id: true, name: true } },
        workType: { select: { id: true, name: true } },
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
            behaviorCondition: { select: { id: true, name: true, type: true } },
          },
        },
        harmfulApps: {
          include: {
            preset: { select: { id: true, name: true } },
          },
        },
        _count: {
          select: {
            zones: true,
            timePolicies: true,
            behaviors: true,
            harmfulApps: true,
            targetEmployees: true,
          },
        },
      },
    });

    if (!policy) {
      throw new NotFoundException('제어 정책을 찾을 수 없습니다.');
    }

    return this.toResponseDto(policy);
  }

  async findByOrganization(organizationId: string): Promise<ControlPolicyResponseDto[]> {
    const policies = await this.prisma.controlPolicy.findMany({
      where: { organizationId },
      orderBy: [{ priority: 'asc' }, { createdAt: 'desc' }],
      include: {
        organization: { select: { id: true, name: true } },
        workType: { select: { id: true, name: true } },
        _count: {
          select: {
            zones: true,
            timePolicies: true,
            behaviors: true,
            harmfulApps: true,
            targetEmployees: true,
          },
        },
      },
    });
    return policies.map(p => this.toResponseDto(p));
  }

  async findOneDetail(id: string): Promise<ControlPolicyDetailDto> {
    const policy = await this.prisma.controlPolicy.findUnique({
      where: { id },
      include: {
        organization: { select: { id: true, name: true } },
        workType: { select: { id: true, name: true } },
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
            behaviorCondition: { select: { id: true, name: true, type: true } },
          },
        },
        harmfulApps: {
          include: {
            preset: { select: { id: true, name: true } },
          },
        },
        targetEmployees: {
          include: {
            employee: { select: { id: true, name: true } },
          },
        },
      },
    });

    if (!policy) {
      throw new NotFoundException('제어 정책을 찾을 수 없습니다.');
    }

    return this.toDetailDto(policy);
  }

  async findByWorkType(workTypeId: string): Promise<ControlPolicyDetailDto | null> {
    const policy = await this.prisma.controlPolicy.findUnique({
      where: { workTypeId },
      include: {
        organization: { select: { id: true, name: true } },
        workType: { select: { id: true, name: true } },
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
            behaviorCondition: { select: { id: true, name: true, type: true } },
          },
        },
        harmfulApps: {
          include: {
            preset: { select: { id: true, name: true } },
          },
        },
        targetEmployees: {
          include: {
            employee: { select: { id: true, name: true } },
          },
        },
      },
    });

    return policy ? this.toDetailDto(policy) : null;
  }

  async update(id: string, updateDto: UpdateControlPolicyDto): Promise<ControlPolicyDetailDto> {
    await this.findOne(id);

    const {
      organizationId,
      workTypeId,
      zoneIds,
      timePolicyIds,
      behaviorConditionIds,
      harmfulAppPresetIds,
      employeeIds,
      ...rest
    } = updateDto;

    // Start transaction for updating relations
    await this.prisma.$transaction(async (tx) => {
      // Update basic fields
      const updateData: any = { ...rest };

      const currentPolicy = await tx.controlPolicy.findUnique({
        where: { id },
        select: { organizationId: true, workTypeId: true },
      });
      if (!currentPolicy) {
        throw new NotFoundException('제어 정책을 찾을 수 없습니다.');
      }

      const targetOrganizationId = organizationId ?? currentPolicy.organizationId;
      const targetWorkTypeId = workTypeId ?? currentPolicy.workTypeId;
      const organizationChanged =
        organizationId !== undefined && organizationId !== currentPolicy.organizationId;

      if (organizationId) {
        const org = await tx.organization.findUnique({ where: { id: organizationId } });
        if (!org) throw new BadRequestException('조직을 찾을 수 없습니다.');
        updateData.organizationId = organizationId;
      }

      await this.validatePolicyRelations(tx, targetOrganizationId, {
        workTypeId: targetWorkTypeId,
        zoneIds,
        timePolicyIds,
        behaviorConditionIds,
        harmfulAppPresetIds,
        employeeIds,
      });

      // Check if policy already exists for this work type (1:1 relationship)
      const existingPolicy = await tx.controlPolicy.findUnique({ where: { workTypeId: targetWorkTypeId } });
      if (existingPolicy && existingPolicy.id !== id) {
        throw new ConflictException('해당 작업 유형에 이미 정책이 존재합니다.');
      }

      if (workTypeId) {
        updateData.workTypeId = workTypeId;
      }

      await tx.controlPolicy.update({
        where: { id },
        data: updateData,
      });

      // 조직 변경 시 기존 관계 데이터는 재검증 없이 유지하지 않고 안전하게 비웁니다.
      // (새 조직 기준의 관계는 요청 본문으로 다시 설정)
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
        if (harmfulAppPresetIds === undefined) {
          await tx.controlPolicyHarmfulApp.deleteMany({ where: { policyId: id } });
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

      // Update harmful apps
      if (harmfulAppPresetIds !== undefined) {
        await tx.controlPolicyHarmfulApp.deleteMany({ where: { policyId: id } });
        if (harmfulAppPresetIds.length > 0) {
          await tx.controlPolicyHarmfulApp.createMany({
            data: harmfulAppPresetIds.map((presetId) => ({ policyId: id, presetId })),
          });
        }
      }

      // Update target employees
      if (employeeIds !== undefined) {
        await tx.controlPolicyEmployee.deleteMany({ where: { policyId: id } });
        if (employeeIds.length > 0) {
          await tx.controlPolicyEmployee.createMany({
            data: employeeIds.map((employeeId) => ({ policyId: id, employeeId })),
          });
        }
      }

      if (employeeIds === undefined) {
        // 정책 조직과 맞지 않는 개별 대상 직원 할당은 항상 정리
        await tx.controlPolicyEmployee.deleteMany({
          where: {
            policyId: id,
            employee: {
              organizationId: { not: targetOrganizationId },
            },
          },
        });
      }

      await this.ensurePolicyHasControlConditions(tx, id);
    });

    return this.findOneDetail(id);
  }

  async remove(id: string): Promise<void> {
    await this.findOne(id);
    await this.prisma.controlPolicy.delete({ where: { id } });
  }

  async toggleActive(id: string): Promise<ControlPolicyResponseDto> {
    const policy = await this.prisma.controlPolicy.findUnique({ where: { id } });
    if (!policy) {
      throw new NotFoundException('제어 정책을 찾을 수 없습니다.');
    }

    const updated = await this.prisma.controlPolicy.update({
      where: { id },
      data: { isActive: !policy.isActive },
      include: {
        organization: { select: { id: true, name: true } },
        workType: { select: { id: true, name: true } },
        _count: {
          select: {
            zones: true,
            timePolicies: true,
            behaviors: true,
            harmfulApps: true,
            targetEmployees: true,
          },
        },
      },
    });

    return this.toResponseDto(updated);
  }

  async assignZones(policyId: string, zoneIds: string[]): Promise<ControlPolicyDetailDto> {
    const policy = await this.prisma.controlPolicy.findUnique({
      where: { id: policyId },
      select: { organizationId: true },
    });
    if (!policy) {
      throw new NotFoundException('제어 정책을 찾을 수 없습니다.');
    }

    await this.validatePolicyRelations(this.prisma, policy.organizationId, { zoneIds });

    await this.prisma.$transaction(async (tx) => {
      await tx.controlPolicyZone.deleteMany({ where: { policyId } });
      if (zoneIds.length > 0) {
        await tx.controlPolicyZone.createMany({
          data: zoneIds.map((zoneId) => ({ policyId, zoneId })),
        });
      }

      await this.ensurePolicyHasControlConditions(tx, policyId);
    });

    return this.findOneDetail(policyId);
  }

  async assignTimePolicies(policyId: string, timePolicyIds: string[]): Promise<ControlPolicyDetailDto> {
    const policy = await this.prisma.controlPolicy.findUnique({
      where: { id: policyId },
      select: { organizationId: true },
    });
    if (!policy) {
      throw new NotFoundException('제어 정책을 찾을 수 없습니다.');
    }

    await this.validatePolicyRelations(this.prisma, policy.organizationId, { timePolicyIds });

    await this.prisma.$transaction(async (tx) => {
      await tx.controlPolicyTimePolicy.deleteMany({ where: { policyId } });
      if (timePolicyIds.length > 0) {
        await tx.controlPolicyTimePolicy.createMany({
          data: timePolicyIds.map((timePolicyId) => ({ policyId, timePolicyId })),
        });
      }

      await this.ensurePolicyHasControlConditions(tx, policyId);
    });

    return this.findOneDetail(policyId);
  }

  async assignBehaviorConditions(policyId: string, behaviorConditionIds: string[]): Promise<ControlPolicyDetailDto> {
    const policy = await this.prisma.controlPolicy.findUnique({
      where: { id: policyId },
      select: { organizationId: true },
    });
    if (!policy) {
      throw new NotFoundException('제어 정책을 찾을 수 없습니다.');
    }

    await this.validatePolicyRelations(this.prisma, policy.organizationId, { behaviorConditionIds });

    await this.prisma.$transaction(async (tx) => {
      await tx.controlPolicyBehavior.deleteMany({ where: { policyId } });
      if (behaviorConditionIds.length > 0) {
        await tx.controlPolicyBehavior.createMany({
          data: behaviorConditionIds.map((behaviorConditionId) => ({
            policyId,
            behaviorConditionId,
          })),
        });
      }

      await this.ensurePolicyHasControlConditions(tx, policyId);
    });

    return this.findOneDetail(policyId);
  }

  async assignHarmfulApps(policyId: string, harmfulAppPresetIds: string[]): Promise<ControlPolicyDetailDto> {
    const policy = await this.prisma.controlPolicy.findUnique({
      where: { id: policyId },
      select: { organizationId: true },
    });
    if (!policy) {
      throw new NotFoundException('제어 정책을 찾을 수 없습니다.');
    }

    await this.validatePolicyRelations(this.prisma, policy.organizationId, { harmfulAppPresetIds });

    await this.prisma.$transaction(async (tx) => {
      await tx.controlPolicyHarmfulApp.deleteMany({ where: { policyId } });
      if (harmfulAppPresetIds.length > 0) {
        await tx.controlPolicyHarmfulApp.createMany({
          data: harmfulAppPresetIds.map((presetId) => ({ policyId, presetId })),
        });
      }

      await this.ensurePolicyHasControlConditions(tx, policyId);
    });

    return this.findOneDetail(policyId);
  }

  async assignEmployees(policyId: string, employeeIds: string[]): Promise<ControlPolicyDetailDto> {
    const policy = await this.prisma.controlPolicy.findUnique({
      where: { id: policyId },
      select: { organizationId: true },
    });
    if (!policy) {
      throw new NotFoundException('제어 정책을 찾을 수 없습니다.');
    }

    await this.validatePolicyRelations(this.prisma, policy.organizationId, { employeeIds });

    await this.prisma.$transaction(async (tx) => {
      await tx.controlPolicyEmployee.deleteMany({ where: { policyId } });
      if (employeeIds.length > 0) {
        await tx.controlPolicyEmployee.createMany({
          data: employeeIds.map((employeeId) => ({ policyId, employeeId })),
        });
      }
    });

    return this.findOneDetail(policyId);
  }

  async getStats(): Promise<ControlPolicyStatsDto> {
    const [totalPolicies, activePolicies, totalWorkTypes, byOrgResult] = await Promise.all([
      this.prisma.controlPolicy.count(),
      this.prisma.controlPolicy.count({ where: { isActive: true } }),
      this.prisma.workType.count(),
      this.prisma.controlPolicy.groupBy({
        by: ['organizationId'],
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

    const workTypeCoverage = totalWorkTypes > 0 ? (totalPolicies / totalWorkTypes) * 100 : 0;

    return {
      totalPolicies,
      activePolicies,
      workTypeCoverage: Math.round(workTypeCoverage * 100) / 100,
      byOrganization,
    };
  }

  private normalizeIds(ids?: string[]): string[] {
    if (!ids || ids.length === 0) return [];
    return Array.from(new Set(ids.filter(Boolean)));
  }

  private ensureAtLeastOneControlConditionInput(params: {
    zoneIds?: string[];
    timePolicyIds?: string[];
    behaviorConditionIds?: string[];
    harmfulAppPresetIds?: string[];
  }): void {
    const hasAnyCondition =
      this.normalizeIds(params.zoneIds).length > 0 ||
      this.normalizeIds(params.timePolicyIds).length > 0 ||
      this.normalizeIds(params.behaviorConditionIds).length > 0 ||
      this.normalizeIds(params.harmfulAppPresetIds).length > 0;

    if (!hasAnyCondition) {
      throw new BadRequestException(
        '정책에는 최소 1개 이상의 통제 조건(구역/시간 정책/행동 조건/유해앱 프리셋)이 필요합니다.',
      );
    }
  }

  private async ensurePolicyHasControlConditions(tx: any, policyId: string): Promise<void> {
    const policy = await tx.controlPolicy.findUnique({
      where: { id: policyId },
      select: {
        _count: {
          select: {
            zones: true,
            timePolicies: true,
            behaviors: true,
            harmfulApps: true,
          },
        },
      },
    });

    if (!policy) {
      throw new NotFoundException('제어 정책을 찾을 수 없습니다.');
    }

    const totalConditions =
      policy._count.zones +
      policy._count.timePolicies +
      policy._count.behaviors +
      policy._count.harmfulApps;

    if (totalConditions === 0) {
      throw new BadRequestException(
        '정책에는 최소 1개 이상의 통제 조건(구역/시간 정책/행동 조건/유해앱 프리셋)이 필요합니다.',
      );
    }
  }

  private async validatePolicyRelations(
    tx: any,
    organizationId: string,
    relationIds: {
      workTypeId?: string;
      zoneIds?: string[];
      timePolicyIds?: string[];
      behaviorConditionIds?: string[];
      harmfulAppPresetIds?: string[];
      employeeIds?: string[];
    },
  ): Promise<void> {
    const {
      workTypeId,
      zoneIds,
      timePolicyIds,
      behaviorConditionIds,
      harmfulAppPresetIds,
      employeeIds,
    } = relationIds;

    if (workTypeId) {
      const workType = await tx.workType.findUnique({
        where: { id: workTypeId },
        select: { id: true, organizationId: true },
      });
      if (!workType) {
        throw new BadRequestException('작업 유형을 찾을 수 없습니다.');
      }
      if (workType.organizationId !== organizationId) {
        throw new BadRequestException('작업 유형은 정책과 동일 조직이어야 합니다.');
      }
    }

    const uniqueZoneIds = this.normalizeIds(zoneIds);
    if (uniqueZoneIds.length > 0) {
      const zoneCount = await tx.zone.count({
        where: { id: { in: uniqueZoneIds }, organizationId },
      });
      if (zoneCount !== uniqueZoneIds.length) {
        throw new BadRequestException('구역 ID가 유효하지 않거나 정책 조직과 일치하지 않습니다.');
      }
    }

    const uniqueTimePolicyIds = this.normalizeIds(timePolicyIds);
    if (uniqueTimePolicyIds.length > 0) {
      const timePolicyCount = await tx.timePolicy.count({
        where: { id: { in: uniqueTimePolicyIds }, organizationId },
      });
      if (timePolicyCount !== uniqueTimePolicyIds.length) {
        throw new BadRequestException('시간 정책 ID가 유효하지 않거나 정책 조직과 일치하지 않습니다.');
      }
    }

    const uniqueBehaviorConditionIds = this.normalizeIds(behaviorConditionIds);
    if (uniqueBehaviorConditionIds.length > 0) {
      const behaviorConditionCount = await tx.behaviorCondition.count({
        where: { id: { in: uniqueBehaviorConditionIds }, organizationId },
      });
      if (behaviorConditionCount !== uniqueBehaviorConditionIds.length) {
        throw new BadRequestException('행동 조건 ID가 유효하지 않거나 정책 조직과 일치하지 않습니다.');
      }
    }

    const uniquePresetIds = this.normalizeIds(harmfulAppPresetIds);
    if (uniquePresetIds.length > 0) {
      const presetCount = await tx.harmfulAppPreset.count({
        where: { id: { in: uniquePresetIds }, organizationId },
      });
      if (presetCount !== uniquePresetIds.length) {
        throw new BadRequestException('유해 앱 프리셋 ID가 유효하지 않거나 정책 조직과 일치하지 않습니다.');
      }
    }

    const uniqueEmployeeIds = this.normalizeIds(employeeIds);
    if (uniqueEmployeeIds.length > 0) {
      const employeeCount = await tx.employee.count({
        where: { id: { in: uniqueEmployeeIds }, organizationId },
      });
      if (employeeCount !== uniqueEmployeeIds.length) {
        throw new BadRequestException('직원 ID가 유효하지 않거나 정책 조직과 일치하지 않습니다.');
      }
    }
  }

  private toResponseDto(policy: any): ControlPolicyResponseDto {
    return {
      id: policy.id,
      name: policy.name,
      description: policy.description,
      priority: policy.priority,
      isActive: policy.isActive,
      organization: policy.organization,
      workType: policy.workType,
      zones: policy.zones?.map((z: any) => z.zone) ?? [],
      timePolicies: policy.timePolicies?.map((t: any) => t.timePolicy) ?? [],
      behaviorConditions: policy.behaviors?.map((b: any) => b.behaviorCondition) ?? [],
      harmfulAppPresets: policy.harmfulApps?.map((h: any) => h.preset) ?? [],
      zoneCount: policy._count?.zones ?? policy.zones?.length ?? 0,
      timePolicyCount: policy._count?.timePolicies ?? policy.timePolicies?.length ?? 0,
      behaviorConditionCount: policy._count?.behaviors ?? policy.behaviors?.length ?? 0,
      harmfulAppCount: policy._count?.harmfulApps ?? policy.harmfulApps?.length ?? 0,
      targetEmployeeCount: policy._count?.targetEmployees ?? 0,
      createdAt: policy.createdAt,
      updatedAt: policy.updatedAt,
    };
  }

  private toDetailDto(policy: any): ControlPolicyDetailDto {
    return {
      id: policy.id,
      name: policy.name,
      description: policy.description,
      priority: policy.priority,
      isActive: policy.isActive,
      organization: policy.organization,
      workType: policy.workType,
      zoneCount: policy.zones?.length ?? 0,
      timePolicyCount: policy.timePolicies?.length ?? 0,
      behaviorConditionCount: policy.behaviors?.length ?? 0,
      harmfulAppCount: policy.harmfulApps?.length ?? 0,
      targetEmployeeCount: policy.targetEmployees?.length ?? 0,
      zones: policy.zones?.map((z: any) => z.zone) ?? [],
      timePolicies: policy.timePolicies?.map((t: any) => t.timePolicy) ?? [],
      behaviorConditions: policy.behaviors?.map((b: any) => b.behaviorCondition) ?? [],
      harmfulAppPresets: policy.harmfulApps?.map((h: any) => h.preset) ?? [],
      targetEmployees: policy.targetEmployees?.map((e: any) => e.employee) ?? [],
      createdAt: policy.createdAt,
      updatedAt: policy.updatedAt,
    };
  }
}
