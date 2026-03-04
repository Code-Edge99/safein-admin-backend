import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuditAction, DeviceOS, EmployeeStatus, Prisma } from '@prisma/client';
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
  private readonly logger = new Logger(ControlPoliciesService.name);

  constructor(
    private prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  private ensureOrganizationInScope(
    organizationId: string | undefined,
    scopeOrganizationIds?: string[],
  ): void {
    if (!organizationId || !scopeOrganizationIds) {
      return;
    }

    if (!scopeOrganizationIds.includes(organizationId)) {
      throw new ForbiddenException('요청한 조직은 접근 권한 범위를 벗어났습니다.');
    }
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
      select: { organizationId: true },
    });

    if (!policy || !scopeOrganizationIds.includes(policy.organizationId)) {
      throw new NotFoundException('제어 정책을 찾을 수 없습니다.');
    }
  }

  async create(
    createDto: CreateControlPolicyDto,
    scopeOrganizationIds?: string[],
  ): Promise<ControlPolicyDetailDto> {
    const {
      organizationId,
      workTypeId,
      zoneIds,
      timePolicyIds,
      behaviorConditionIds,
      allowedAppPresetIds,
      employeeIds,
      ...rest
    } = createDto;

    this.ensureOrganizationInScope(organizationId, scopeOrganizationIds);

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
      allowedAppPresetIds,
      employeeIds,
    });

    this.ensureSingleSelectionConstraints({
      timePolicyIds,
      behaviorConditionIds,
    });

    this.ensureAtLeastOneControlConditionInput({
      zoneIds,
      timePolicyIds,
      behaviorConditionIds,
      allowedAppPresetIds,
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
        allowedApps: allowedAppPresetIds?.length
          ? {
              create: allowedAppPresetIds.map((presetId) => ({ presetId })),
            }
          : undefined,
        targetEmployees: employeeIds?.length
          ? {
              create: employeeIds.map((employeeId) => ({ employeeId })),
            }
          : undefined,
      } as any,
    });

    const detail = await this.findOneDetail(policy.id, scopeOrganizationIds);

    await this.notifyPolicyChangedForWorkType({
      policyId: policy.id,
      organizationId,
      workTypeId,
      trigger: 'create',
    });

    return detail;
  }

  async findAll(
    filter: ControlPolicyFilterDto,
    scopeOrganizationIds?: string[],
  ): Promise<ControlPolicyListResponseDto> {
    const { search, organizationId, workTypeId, isActive, page = 1, limit = 20 } = filter;
    const skip = (page - 1) * limit;

    const where: any = {};

    if (search) {
      where.name = { contains: search, mode: 'insensitive' };
    }

    if (organizationId) {
      where.organizationId = organizationId;
    }

    this.applyOrganizationScope(where, scopeOrganizationIds);

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
        workType: { select: { id: true, name: true } },
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

  async findByWorkType(
    workTypeId: string,
    scopeOrganizationIds?: string[],
  ): Promise<ControlPolicyDetailDto | null> {
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

    if (policy && scopeOrganizationIds && !scopeOrganizationIds.includes(policy.organizationId)) {
      return null;
    }

    return policy ? this.toDetailDto(policy) : null;
  }

  async update(
    id: string,
    updateDto: UpdateControlPolicyDto,
    scopeOrganizationIds?: string[],
  ): Promise<ControlPolicyDetailDto> {
    await this.assertPolicyInScope(id, scopeOrganizationIds);
    await this.findOne(id, scopeOrganizationIds);

    const {
      organizationId,
      workTypeId,
      zoneIds,
      timePolicyIds,
      behaviorConditionIds,
      allowedAppPresetIds,
      employeeIds,
      ...rest
    } = updateDto;

    // Start transaction for updating relations
    await this.prisma.$transaction(async (tx: any) => {
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
            if (scopeOrganizationIds && !scopeOrganizationIds.includes(targetOrganizationId)) {
              throw new ForbiddenException('요청한 조직은 접근 권한 범위를 벗어났습니다.');
            }

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
        allowedAppPresetIds,
        employeeIds,
      });

      this.ensureSingleSelectionConstraints({
        timePolicyIds,
        behaviorConditionIds,
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
    const updatedPolicy = await this.prisma.controlPolicy.findUnique({
      where: { id },
      select: {
        id: true,
        organizationId: true,
        workTypeId: true,
        isActive: true,
      },
    });

    if (updatedPolicy) {
      await this.notifyPolicyChangedForWorkType({
        policyId: updatedPolicy.id,
        organizationId: updatedPolicy.organizationId,
        workTypeId: updatedPolicy.workTypeId,
        trigger: updatedPolicy.isActive ? 'update' : 'deactivate',
      });
    }

    return this.findOneDetail(id, scopeOrganizationIds);
  }

  async remove(id: string, scopeOrganizationIds?: string[]): Promise<void> {
    await this.assertPolicyInScope(id, scopeOrganizationIds);

    const policy = await this.prisma.controlPolicy.findUnique({
      where: { id },
      select: { id: true },
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
  }

  async toggleActive(id: string, scopeOrganizationIds?: string[]): Promise<ControlPolicyResponseDto> {
    await this.assertPolicyInScope(id, scopeOrganizationIds);

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
            allowedApps: true,
            targetEmployees: true,
          },
        },
      } as any,
    });

    await this.notifyPolicyChangedForWorkType({
      policyId: updated.id,
      organizationId: updated.organizationId,
      workTypeId: updated.workTypeId,
      trigger: updated.isActive ? 'activate' : 'deactivate',
    });

    return this.toResponseDto(updated);
  }

  private async notifyPolicyChangedForWorkType(params: {
    policyId: string;
    organizationId: string;
    workTypeId: string;
    trigger: 'create' | 'activate' | 'update' | 'deactivate';
  }): Promise<void> {
    try {
      const appBackendBaseUrl = this.getAppBackendBaseUrl();
      const endpointUrl = `${appBackendBaseUrl}/internal/push/fcm/send`;

      const totalTargetEmployees = await this.prisma.employee.count({
        where: {
          organizationId: params.organizationId,
          workTypeId: params.workTypeId,
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
        WHERE d."organizationId" = ${params.organizationId}
          AND e."workTypeId" = ${params.workTypeId}
          AND e.status = ${EmployeeStatus.ACTIVE}
          AND d."pushToken" IS NOT NULL
          AND (d."pushTokenStatus" IS NULL OR d."pushTokenStatus" <> 'ERROR')
      `;

      const targetEmployeeIds = new Set<string>();
      const failedDeviceIds: string[] = [];
      let successCount = 0;
      let targetTokenCount = 0;

      for (const device of devices) {
        const token = device.pushToken?.trim();
        if (!device.employeeId || !token) {
          continue;
        }

        targetEmployeeIds.add(device.employeeId);
        targetTokenCount += 1;

        try {
          await this.sendPolicyChangedPush(endpointUrl, {
            token,
            os: device.os,
            policyId: params.policyId,
            trigger: params.trigger,
          });
          successCount += 1;
        } catch {
          failedDeviceIds.push(device.id);
        }
      }

      let markedAsErrorCount = 0;
      if (failedDeviceIds.length > 0) {
        const uniqueFailedDeviceIds = Array.from(new Set(failedDeviceIds));
        markedAsErrorCount = await this.prisma.$executeRaw`
          UPDATE devices
          SET "pushTokenStatus" = 'ERROR',
              "updatedAt" = NOW()
          WHERE id IN (${Prisma.join(uniqueFailedDeviceIds)})
        `;
      }

      const summary = {
        trigger: params.trigger,
        policyId: params.policyId,
        workTypeId: params.workTypeId,
        organizationId: params.organizationId,
        targetEmployees: totalTargetEmployees,
        employeesWithToken: targetEmployeeIds.size,
        employeesWithoutToken: Math.max(totalTargetEmployees - targetEmployeeIds.size, 0),
        targetTokens: targetTokenCount,
        successCount,
        failedCount: failedDeviceIds.length,
        markedAsErrorCount,
      };

      this.logger.log(`[policy_changed] ${JSON.stringify(summary)}`);

      if (failedDeviceIds.length > 0) {
        this.logger.warn(
          `[policy_changed] failed device ids: ${failedDeviceIds.slice(0, 20).join(', ')}`
          + `${failedDeviceIds.length > 20 ? ' ...' : ''}`,
        );
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
      token: string;
      os: DeviceOS;
      policyId: string;
      trigger: 'create' | 'activate' | 'update' | 'deactivate';
    },
  ): Promise<void> {
    const policyApplied = params.trigger === 'deactivate' ? 'false' : 'true';

    const response = await fetch(endpointUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message: {
          token: params.token,
          data: {
            type: 'policy_changed',
            policyVersion: params.policyId,
            extraData: {
              trigger: params.trigger,
              policyApplied,
            },
          },
          ...(params.os === DeviceOS.Android
            ? {
              android: {
                priority: 'HIGH',
              },
            }
            : {
              android: {
                priority: 'NORMAL',
              },
            }),
        },
      }),
    });

    if (!response.ok) {
      const responseText = await response.text();
      throw new Error(`status=${response.status}, body=${responseText || 'empty'}`);
    }
  }

  private getAppBackendBaseUrl(): string {
    const baseUrl = this.configService.get<string>('APP_BACKEND_BASE_URL', 'http://localhost:3100/api/app');
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
      select: { organizationId: true },
    });
    if (!policy) {
      throw new NotFoundException('제어 정책을 찾을 수 없습니다.');
    }

    await this.validatePolicyRelations(this.prisma, policy.organizationId, { zoneIds });

    await this.prisma.$transaction(async (tx: any) => {
      await tx.controlPolicyZone.deleteMany({ where: { policyId } });
      if (zoneIds.length > 0) {
        await tx.controlPolicyZone.createMany({
          data: zoneIds.map((zoneId) => ({ policyId, zoneId })),
        });
      }

      await this.ensurePolicyHasControlConditions(tx, policyId);
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
      select: { organizationId: true },
    });
    if (!policy) {
      throw new NotFoundException('제어 정책을 찾을 수 없습니다.');
    }

    await this.validatePolicyRelations(this.prisma, policy.organizationId, { timePolicyIds });
    this.ensureSingleSelectionConstraints({ timePolicyIds });

    await this.prisma.$transaction(async (tx: any) => {
      await tx.controlPolicyTimePolicy.deleteMany({ where: { policyId } });
      if (timePolicyIds.length > 0) {
        await tx.controlPolicyTimePolicy.createMany({
          data: timePolicyIds.map((timePolicyId) => ({ policyId, timePolicyId })),
        });
      }

      await this.ensurePolicyHasControlConditions(tx, policyId);
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
      select: { organizationId: true },
    });
    if (!policy) {
      throw new NotFoundException('제어 정책을 찾을 수 없습니다.');
    }

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

      await this.ensurePolicyHasControlConditions(tx, policyId);
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
      select: { organizationId: true },
    });
    if (!policy) {
      throw new NotFoundException('제어 정책을 찾을 수 없습니다.');
    }

    await this.validatePolicyRelations(this.prisma, policy.organizationId, { allowedAppPresetIds });

    await this.prisma.$transaction(async (tx: any) => {
      await tx.controlPolicyAllowedApp.deleteMany({ where: { policyId } });
      if (allowedAppPresetIds.length > 0) {
        await tx.controlPolicyAllowedApp.createMany({
          data: allowedAppPresetIds.map((presetId) => ({ policyId, presetId })),
        });
      }

      await this.ensurePolicyHasControlConditions(tx, policyId);
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

    return this.findOneDetail(policyId, scopeOrganizationIds);
  }

  async getStats(scopeOrganizationIds?: string[]): Promise<ControlPolicyStatsDto> {
    const [totalPolicies, activePolicies, totalWorkTypes, byOrgResult] = await Promise.all([
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
      this.prisma.workType.count({
        where: scopeOrganizationIds
          ? {
              organizationId: { in: scopeOrganizationIds },
            }
          : undefined,
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
    allowedAppPresetIds?: string[];
  }): void {
    const hasAnyCondition =
      this.normalizeIds(params.zoneIds).length > 0 ||
      this.normalizeIds(params.timePolicyIds).length > 0 ||
      this.normalizeIds(params.behaviorConditionIds).length > 0 ||
      this.normalizeIds(params.allowedAppPresetIds).length > 0;

    if (!hasAnyCondition) {
      throw new BadRequestException(
        '정책에는 최소 1개 이상의 통제 조건(구역/시간 정책/행동 조건/허용앱 프리셋)이 필요합니다.',
      );
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

  private async ensurePolicyHasControlConditions(tx: any, policyId: string): Promise<void> {
    const policy = await tx.controlPolicy.findUnique({
      where: { id: policyId },
      select: {
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

    if (!policy) {
      throw new NotFoundException('제어 정책을 찾을 수 없습니다.');
    }

    const totalConditions =
      policy._count.zones +
      policy._count.timePolicies +
      policy._count.behaviors +
      policy._count.allowedApps;

    if (totalConditions === 0) {
      throw new BadRequestException(
        '정책에는 최소 1개 이상의 통제 조건(구역/시간 정책/행동 조건/허용앱 프리셋)이 필요합니다.',
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
      allowedAppPresetIds?: string[];
      employeeIds?: string[];
    },
  ): Promise<void> {
    const {
      workTypeId,
      zoneIds,
      timePolicyIds,
      behaviorConditionIds,
      allowedAppPresetIds,
      employeeIds,
    } = relationIds;

    const allowedPolicySourceOrganizationIds = await this.getSelfAndAncestorOrganizationIds(
      tx,
      organizationId,
    );

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
        where: {
          id: { in: uniqueZoneIds },
          organizationId: { in: allowedPolicySourceOrganizationIds },
        },
      });
      if (zoneCount !== uniqueZoneIds.length) {
        throw new BadRequestException('구역 ID가 유효하지 않거나 정책 조직/상위 조직과 일치하지 않습니다.');
      }
    }

    const uniqueTimePolicyIds = this.normalizeIds(timePolicyIds);
    if (uniqueTimePolicyIds.length > 0) {
      const timePolicyCount = await tx.timePolicy.count({
        where: {
          id: { in: uniqueTimePolicyIds },
          organizationId: { in: allowedPolicySourceOrganizationIds },
        },
      });
      if (timePolicyCount !== uniqueTimePolicyIds.length) {
        throw new BadRequestException('시간 정책 ID가 유효하지 않거나 정책 조직/상위 조직과 일치하지 않습니다.');
      }
    }

    const uniqueBehaviorConditionIds = this.normalizeIds(behaviorConditionIds);
    if (uniqueBehaviorConditionIds.length > 0) {
      const behaviorConditionCount = await tx.behaviorCondition.count({
        where: {
          id: { in: uniqueBehaviorConditionIds },
          organizationId: { in: allowedPolicySourceOrganizationIds },
        },
      });
      if (behaviorConditionCount !== uniqueBehaviorConditionIds.length) {
        throw new BadRequestException('행동 조건 ID가 유효하지 않거나 정책 조직/상위 조직과 일치하지 않습니다.');
      }
    }

    const uniquePresetIds = this.normalizeIds(allowedAppPresetIds);
    if (uniquePresetIds.length > 0) {
      const presetCount = await tx.allowedAppPreset.count({
        where: {
          id: { in: uniquePresetIds },
          organizationId: { in: allowedPolicySourceOrganizationIds },
        },
      });
      if (presetCount !== uniquePresetIds.length) {
        throw new BadRequestException('허용앱 프리셋 ID가 유효하지 않거나 정책 조직/상위 조직과 일치하지 않습니다.');
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

  private async getSelfAndAncestorOrganizationIds(tx: any, organizationId: string): Promise<string[]> {
    const organizations = await tx.organization.findMany({
      select: { id: true, parentId: true },
    });

    const organizationMap = new Map<string, { id: string; parentId: string | null }>(
      organizations.map((organization: { id: string; parentId: string | null }) => [organization.id, organization]),
    );

    const result: string[] = [];
    let currentId: string | null = organizationId;

    while (currentId) {
      const current = organizationMap.get(currentId);
      if (!current) {
        break;
      }

      result.push(current.id);
      currentId = current.parentId;
    }

    return result;
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
      allowedAppPresets: this.mapAllowedAppPresets(policy.allowedApps),
      zoneCount: policy._count?.zones ?? policy.zones?.length ?? 0,
      timePolicyCount: policy._count?.timePolicies ?? policy.timePolicies?.length ?? 0,
      behaviorConditionCount: policy._count?.behaviors ?? policy.behaviors?.length ?? 0,
      allowedAppCount: policy._count?.allowedApps ?? policy.allowedApps?.length ?? 0,
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
      allowedAppCount: policy.allowedApps?.length ?? 0,
      targetEmployeeCount: policy.targetEmployees?.length ?? 0,
      zones: policy.zones?.map((z: any) => z.zone) ?? [],
      timePolicies: policy.timePolicies?.map((t: any) => t.timePolicy) ?? [],
      behaviorConditions: policy.behaviors?.map((b: any) => b.behaviorCondition) ?? [],
      allowedAppPresets: this.mapAllowedAppPresets(policy.allowedApps),
      targetEmployees: policy.targetEmployees?.map((e: any) => e.employee) ?? [],
      createdAt: policy.createdAt,
      updatedAt: policy.updatedAt,
    };
  }
  private mapAllowedAppPresets(allowedApps: any[] | undefined) {
    if (!Array.isArray(allowedApps)) {
      return [];
    }

    return allowedApps
      .map((item: any) => item?.preset)
      .filter((preset: any) => !!preset?.id)
      .map((preset: any) => ({
        id: preset.id,
        name: preset.name,
        apps: Array.isArray(preset.items)
          ? preset.items
            .map((presetItem: any) => presetItem?.allowedApp)
            .filter((app: any) => !!app?.id)
            .map((app: any) => ({
              id: app.id,
              name: app.name,
              packageName: app.packageName,
              iconUrl: app.iconUrl ?? undefined,
            }))
          : [],
      }));
  }
}
