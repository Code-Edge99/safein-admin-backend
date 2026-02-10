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

    // Validate work type and check for existing policy
    const workType = await this.prisma.workType.findUnique({
      where: { id: workTypeId },
    });
    if (!workType) {
      throw new BadRequestException('작업 유형을 찾을 수 없습니다.');
    }

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

      if (organizationId) {
        const org = await tx.organization.findUnique({ where: { id: organizationId } });
        if (!org) throw new BadRequestException('조직을 찾을 수 없습니다.');
        updateData.organizationId = organizationId;
      }

      if (workTypeId) {
        // Check for conflict
        const existingPolicy = await tx.controlPolicy.findUnique({ where: { workTypeId } });
        if (existingPolicy && existingPolicy.id !== id) {
          throw new ConflictException('해당 작업 유형에 이미 정책이 존재합니다.');
        }
        updateData.workTypeId = workTypeId;
      }

      await tx.controlPolicy.update({
        where: { id },
        data: updateData,
      });

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
    await this.findOne(policyId);

    await this.prisma.$transaction(async (tx) => {
      await tx.controlPolicyZone.deleteMany({ where: { policyId } });
      if (zoneIds.length > 0) {
        await tx.controlPolicyZone.createMany({
          data: zoneIds.map((zoneId) => ({ policyId, zoneId })),
        });
      }
    });

    return this.findOneDetail(policyId);
  }

  async assignTimePolicies(policyId: string, timePolicyIds: string[]): Promise<ControlPolicyDetailDto> {
    await this.findOne(policyId);

    await this.prisma.$transaction(async (tx) => {
      await tx.controlPolicyTimePolicy.deleteMany({ where: { policyId } });
      if (timePolicyIds.length > 0) {
        await tx.controlPolicyTimePolicy.createMany({
          data: timePolicyIds.map((timePolicyId) => ({ policyId, timePolicyId })),
        });
      }
    });

    return this.findOneDetail(policyId);
  }

  async assignBehaviorConditions(policyId: string, behaviorConditionIds: string[]): Promise<ControlPolicyDetailDto> {
    await this.findOne(policyId);

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
    });

    return this.findOneDetail(policyId);
  }

  async assignHarmfulApps(policyId: string, harmfulAppPresetIds: string[]): Promise<ControlPolicyDetailDto> {
    await this.findOne(policyId);

    await this.prisma.$transaction(async (tx) => {
      await tx.controlPolicyHarmfulApp.deleteMany({ where: { policyId } });
      if (harmfulAppPresetIds.length > 0) {
        await tx.controlPolicyHarmfulApp.createMany({
          data: harmfulAppPresetIds.map((presetId) => ({ policyId, presetId })),
        });
      }
    });

    return this.findOneDetail(policyId);
  }

  async assignEmployees(policyId: string, employeeIds: string[]): Promise<ControlPolicyDetailDto> {
    await this.findOne(policyId);

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
