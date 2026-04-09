import { Injectable, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { DeviceStatus, Prisma } from '@prisma/client';
import { randomInt } from 'crypto';
import { assertOrganizationInScopeOrThrow, ensureOrganizationInScope, assertLeafOrganization } from '../../common/utils/organization-scope.util';
import { normalizePhoneNumber } from '../../common/utils/phone.util';
import { toOrganizationResponseDto } from './organizations.mapper';
import {
  CreateOrganizationDto,
  UpdateOrganizationDto,
  OrganizationResponseDto,
  OrganizationTreeDto,
  OrganizationStatsDto,
  TransferResourcesDto,
  TransferResourcesResultDto,
} from './dto';

@Injectable()
export class OrganizationsService {
  private static readonly TEAM_CODE_CHARSET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

  constructor(private readonly prisma: PrismaService) {}

  private generateTeamCodeCandidate(): string {
    let value = '';
    for (let index = 0; index < 5; index += 1) {
      const randomIndex = randomInt(OrganizationsService.TEAM_CODE_CHARSET.length);
      value += OrganizationsService.TEAM_CODE_CHARSET[randomIndex];
    }
    return value;
  }

  private async issueLeafTeamCodeIfMissing(organizationId: string): Promise<string | null> {
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const teamCode = this.generateTeamCodeCandidate();

      try {
        return await this.prisma.$transaction(async (tx) => {
          const current = await tx.organization.findUnique({
            where: { id: organizationId },
            select: {
              teamCode: true,
              _count: {
                select: {
                  children: true,
                },
              },
            },
          });

          if (!current) {
            return null;
          }

          // 팀코드는 말단(리프) 현장에만 유지한다.
          if (current._count.children > 0) {
            return null;
          }

          if (current.teamCode) {
            return current.teamCode;
          }

          await tx.organization.update({
            where: { id: organizationId },
            data: {
              teamCode,
            },
          });

          return teamCode;
        });
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          continue;
        }

        throw error;
      }
    }

    return null;
  }

  private ensureOrganizationInScope(
    organizationId: string | undefined,
    scopeOrganizationIds?: string[],
  ): void {
    ensureOrganizationInScope(organizationId, scopeOrganizationIds);
  }

  private assertOrganizationInScope(
    organization: { id: string },
    scopeOrganizationIds?: string[],
  ): void {
    assertOrganizationInScopeOrThrow(organization.id, scopeOrganizationIds, '현장을 찾을 수 없습니다.');
  }

  async create(dto: CreateOrganizationDto, scopeOrganizationIds?: string[], actorUserId?: string): Promise<OrganizationResponseDto> {
    this.ensureOrganizationInScope(dto.parentId || undefined, scopeOrganizationIds);
    const normalizedManagerPhone = normalizePhoneNumber(dto.managerPhone);

    // 상위 현장 검증
    if (dto.parentId) {
      const parent = await this.prisma.organization.findUnique({
        where: { id: dto.parentId },
        include: {
          _count: {
            select: {
              children: true,
              employees: true,
              zones: true,
              timePolicies: true,
              behaviorConditions: true,
              allowedAppPresets: true,
              controlPolicies: true,
            },
          },
        },
      });
      if (!parent) {
        throw new NotFoundException('상위 현장을 찾을 수 없습니다.');
      }
      // 상위가 단위(리프)이고 직원이나 정책이 있으면 하위 생성 차단
      if (parent._count.children === 0) {
        const c = parent._count;
        if (c.employees > 0 || c.zones > 0 || c.timePolicies > 0 ||
            c.behaviorConditions > 0 || c.allowedAppPresets > 0 || c.controlPolicies > 0) {
          throw new BadRequestException(
            '해당 현장에 직원이나 정책이 배정되어 있어 하위 현장을 생성할 수 없습니다. 직원과 정책을 먼저 제거해주세요.',
          );
        }
      }
    }

    const organization = await this.prisma.$transaction(async (tx) => {
      for (let attempt = 0; attempt < 30; attempt += 1) {
        const teamCode = this.generateTeamCodeCandidate();

        try {
          const created = await tx.organization.create({
            data: {
              name: dto.name,
              address: dto.address,
              detailAddress: dto.detailAddress,
              description: dto.description,
              managerName: dto.managerName,
              managerPhone: normalizedManagerPhone || undefined,
              emergencyContact: dto.emergencyContact,
              teamCode,
              createdById: actorUserId,
              updatedById: actorUserId,
              parentId: dto.parentId || null,
              isActive: dto.isActive ?? true,
            } as any,
            include: {
              createdBy: { select: { id: true, name: true, username: true } },
              updatedBy: { select: { id: true, name: true, username: true } },
            },
          });

          // 부모가 기존 단위였다면 하위 현장 생성과 함께 그룹으로 전환되므로 팀코드를 제거한다.
          if (dto.parentId) {
            await tx.organization.update({
              where: { id: dto.parentId },
              data: {
                teamCode: null,
                updatedById: actorUserId,
              },
            });
          }

          return created;
        } catch (error) {
          if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
            continue;
          }
          throw error;
        }
      }

      throw new BadRequestException('팀코드 생성에 실패했습니다. 잠시 후 다시 시도해주세요.');
    });

    return this.toResponseDto(organization);
  }

  async findAll(scopeOrganizationIds?: string[]): Promise<OrganizationResponseDto[]> {
    const organizations = await this.prisma.organization.findMany({
      where: scopeOrganizationIds ? { id: { in: scopeOrganizationIds } } : undefined,
      include: {
        createdBy: {
          select: {
            id: true,
            name: true,
            username: true,
          },
        },
        updatedBy: {
          select: {
            id: true,
            name: true,
            username: true,
          },
        },
      },
      orderBy: [{ name: 'asc' }],
    });

    return organizations.map(org => this.toResponseDto(org));
  }

  async findTree(scopeOrganizationIds?: string[]): Promise<OrganizationTreeDto[]> {
    const organizations = await this.prisma.organization.findMany({
      where: scopeOrganizationIds ? { id: { in: scopeOrganizationIds } } : undefined,
      include: {
        createdBy: {
          select: {
            id: true,
            name: true,
            username: true,
          },
        },
        updatedBy: {
          select: {
            id: true,
            name: true,
            username: true,
          },
        },
        _count: {
          select: {
            employees: true,
            devices: true,
          },
        },
      },
      orderBy: [{ name: 'asc' }],
    });

    const organizationIdSet = new Set(organizations.map((org) => org.id));

    // 현장 트리 구조로 변환
    const buildTree = (parentId: string | null): OrganizationTreeDto[] => {
      return organizations
        .filter((org) => org.parentId === parentId)
        .map((org) => ({
          ...this.toResponseDto(org),
          employeeCount: org._count.employees,
          deviceCount: org._count.devices,
          children: buildTree(org.id),
        }));
    };

    if (scopeOrganizationIds) {
      const scopedRoots = organizations.filter(
        (org) => !org.parentId || !organizationIdSet.has(org.parentId),
      );

      return scopedRoots.map((org) => ({
        ...this.toResponseDto(org),
        employeeCount: org._count.employees,
        deviceCount: org._count.devices,
        children: buildTree(org.id),
      }));
    }

    return buildTree(null);
  }

  async findOne(id: string, scopeOrganizationIds?: string[]): Promise<OrganizationResponseDto> {
    this.ensureOrganizationInScope(id, scopeOrganizationIds);

    const organization = await this.prisma.organization.findUnique({
      where: { id },
      include: {
        createdBy: {
          select: {
            id: true,
            name: true,
            username: true,
          },
        },
        updatedBy: {
          select: {
            id: true,
            name: true,
            username: true,
          },
        },
      },
    });

    if (!organization) {
      throw new NotFoundException('현장을 찾을 수 없습니다.');
    }

    if (!organization.teamCode) {
      const issuedTeamCode = await this.issueLeafTeamCodeIfMissing(organization.id);
      if (issuedTeamCode) {
        organization.teamCode = issuedTeamCode;
      }
    }

    return this.toResponseDto(organization);
  }

  async findOneWithStats(id: string, scopeOrganizationIds?: string[]): Promise<OrganizationStatsDto> {
    this.ensureOrganizationInScope(id, scopeOrganizationIds);

    const organization = await this.prisma.organization.findUnique({
      where: { id },
      include: {
        _count: {
          select: {
            employees: true,
            children: true,
            devices: true,
          },
        },
      },
    });

    if (!organization) {
      throw new NotFoundException('현장을 찾을 수 없습니다.');
    }

    // 활성 장치 수 조회
    const activeDeviceCount = await this.prisma.device.count({
      where: {
        organizationId: id,
        status: DeviceStatus.NORMAL,
      },
    });

    return {
      organizationId: organization.id,
      organizationName: organization.name,
      totalEmployees: organization._count.employees,
      totalDevices: organization._count.devices,
      activeDevices: activeDeviceCount,
      childOrganizations: organization._count.children,
    };
  }

  async update(
    id: string,
    dto: UpdateOrganizationDto,
    scopeOrganizationIds?: string[],
    actorUserId?: string,
  ): Promise<OrganizationResponseDto> {
    await this.findOne(id, scopeOrganizationIds); // 존재 여부 확인
    const normalizedManagerPhone = normalizePhoneNumber(dto.managerPhone);

    // 순환 참조 방지
    if (dto.parentId) {
      this.ensureOrganizationInScope(dto.parentId, scopeOrganizationIds);
      if (dto.parentId === id) {
        throw new BadRequestException('현장은 자기 자신을 상위 현장으로 설정할 수 없습니다.');
      }

      // 하위 현장을 상위로 설정하는지 확인
      const descendants = await this.getDescendants(id, scopeOrganizationIds);
      if (descendants.some((d) => d.id === dto.parentId)) {
        throw new BadRequestException('하위 현장을 상위 현장으로 설정할 수 없습니다.');
      }

      const parent = await this.prisma.organization.findUnique({
        where: { id: dto.parentId },
        include: {
          _count: {
            select: {
              children: true,
              employees: true,
              zones: true,
              timePolicies: true,
              behaviorConditions: true,
              allowedAppPresets: true,
              controlPolicies: true,
            },
          },
        },
      });
      if (!parent) {
        throw new NotFoundException('상위 현장을 찾을 수 없습니다.');
      }

      if (parent._count.children === 0) {
        const c = parent._count;
        if (
          c.employees > 0
          || c.zones > 0
          || c.timePolicies > 0
          || c.behaviorConditions > 0
          || c.allowedAppPresets > 0
          || c.controlPolicies > 0
        ) {
          throw new BadRequestException(
            '해당 현장에 직원이나 정책이 배정되어 있어 하위 현장을 생성할 수 없습니다. 직원과 정책을 먼저 제거해주세요.',
          );
        }
      }
    }

    const organization = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.organization.update({
        where: { id },
        data: {
          name: dto.name,
          address: dto.address,
          detailAddress: dto.detailAddress,
          description: dto.description,
          managerName: dto.managerName,
          managerPhone: dto.managerPhone === undefined ? undefined : normalizedManagerPhone || null,
          emergencyContact: dto.emergencyContact,
          updatedById: actorUserId,
          parentId: dto.parentId,
          isActive: dto.isActive,
        } as any,
        include: {
          createdBy: {
            select: {
              id: true,
              name: true,
              username: true,
            },
          },
          updatedBy: {
            select: {
              id: true,
              name: true,
              username: true,
            },
          },
        },
      });

      // 상위 현장이 생기면 그룹으로 전환되므로 팀코드를 제거한다.
      if (dto.parentId) {
        await tx.organization.update({
          where: { id: dto.parentId },
          data: {
            teamCode: null,
            updatedById: actorUserId,
          },
        });
      }

      return updated;
    });

    return this.toResponseDto(organization);
  }

  async remove(id: string, scopeOrganizationIds?: string[]): Promise<void> {
    this.ensureOrganizationInScope(id, scopeOrganizationIds);

    const organization = await this.prisma.organization.findUnique({
      where: { id },
      include: {
        _count: {
          select: {
            children: true,
            employees: true,
            zones: true,
            timePolicies: true,
            behaviorConditions: true,
            allowedAppPresets: true,
            controlPolicies: true,
          },
        },
      },
    });

    if (!organization) {
      throw new NotFoundException('현장을 찾을 수 없습니다.');
    }

    this.assertOrganizationInScope(organization, scopeOrganizationIds);

    if (organization._count.children > 0) {
      throw new BadRequestException('하위 현장이 있는 현장은 삭제할 수 없습니다.');
    }

    if (organization._count.employees > 0) {
      throw new BadRequestException('직원이 소속된 현장은 삭제할 수 없습니다.');
    }

    if (
      organization._count.zones > 0 ||
      organization._count.timePolicies > 0 ||
      organization._count.behaviorConditions > 0 ||
      organization._count.allowedAppPresets > 0 ||
      organization._count.controlPolicies > 0
    ) {
      throw new BadRequestException('하위 정책/조건 데이터가 남아 있어 현장을 삭제할 수 없습니다. 관련 데이터를 먼저 정리해주세요.');
    }

    await this.prisma.organization.delete({
      where: { id },
    });
  }

  async getDescendants(id: string, scopeOrganizationIds?: string[]): Promise<OrganizationResponseDto[]> {
    this.ensureOrganizationInScope(id, scopeOrganizationIds);

    const allOrgs = await this.prisma.organization.findMany({
      where: scopeOrganizationIds ? { id: { in: scopeOrganizationIds } } : undefined,
    });
    const descendants: OrganizationResponseDto[] = [];

    const findDescendants = (parentId: string) => {
      const children = allOrgs.filter((org) => org.parentId === parentId);
      for (const child of children) {
        descendants.push(this.toResponseDto(child));
        findDescendants(child.id);
      }
    };

    findDescendants(id);
    return descendants;
  }

  async getAncestors(id: string, scopeOrganizationIds?: string[]): Promise<OrganizationResponseDto[]> {
    this.ensureOrganizationInScope(id, scopeOrganizationIds);

    const ancestors: OrganizationResponseDto[] = [];
    let current = await this.prisma.organization.findUnique({
      where: { id },
    });

    while (current?.parentId) {
      const parent = await this.prisma.organization.findUnique({
        where: { id: current.parentId },
      });
      if (parent) {
        if (scopeOrganizationIds && !scopeOrganizationIds.includes(parent.id)) {
          break;
        }
        ancestors.unshift(this.toResponseDto(parent));
        current = parent;
      } else {
        break;
      }
    }

    return ancestors;
  }

  private toResponseDto(org: any): OrganizationResponseDto {
    return toOrganizationResponseDto(org);
  }

  async transferResources(
    sourceOrganizationId: string,
    dto: TransferResourcesDto,
    scopeOrganizationIds?: string[],
  ): Promise<TransferResourcesResultDto> {
    this.ensureOrganizationInScope(sourceOrganizationId, scopeOrganizationIds);
    this.ensureOrganizationInScope(dto.targetOrganizationId, scopeOrganizationIds);

    if (sourceOrganizationId === dto.targetOrganizationId) {
      throw new BadRequestException('원본 현장과 대상 현장이 동일합니다.');
    }

    const [source, target] = await Promise.all([
      this.prisma.organization.findUnique({ where: { id: sourceOrganizationId } }),
      this.prisma.organization.findUnique({ where: { id: dto.targetOrganizationId } }),
    ]);

    if (!source) throw new NotFoundException('원본 현장을 찾을 수 없습니다.');
    if (!target) throw new NotFoundException('대상 현장을 찾을 수 없습니다.');

    await assertLeafOrganization(this.prisma, dto.targetOrganizationId);

    const result = await this.prisma.$transaction(async (tx) => {
      const employees = await tx.employee.updateMany({
        where: { organizationId: sourceOrganizationId },
        data: { organizationId: dto.targetOrganizationId },
      });

      // 장치도 직원과 함께 이관
      await tx.device.updateMany({
        where: { organizationId: sourceOrganizationId },
        data: { organizationId: dto.targetOrganizationId },
      });

      // employeeCount 갱신
      const [sourceCount, targetCount] = await Promise.all([
        tx.employee.count({ where: { organizationId: sourceOrganizationId } }),
        tx.employee.count({ where: { organizationId: dto.targetOrganizationId } }),
      ]);
      await Promise.all([
        tx.organization.update({ where: { id: sourceOrganizationId }, data: { employeeCount: sourceCount } }),
        tx.organization.update({ where: { id: dto.targetOrganizationId }, data: { employeeCount: targetCount } }),
      ]);

      return {
        employees: employees.count,
      };
    });

    return result;
  }
}
