import { Injectable, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditAction, DeviceStatus, EmployeeStatus, Prisma } from '@prisma/client';
import { randomInt } from 'crypto';
import {
  CODEEDGE_ROOT_ORGANIZATION_ID,
  assertOrganizationInScopeOrThrow,
  assertUnitOrganization,
  ensureOrganizationInScope,
  resolveOrganizationClassification,
} from '../../common/utils/organization-scope.util';
import { normalizePhoneNumber } from '../../common/utils/phone.util';
import { toOrganizationResponseDto } from './organizations.mapper';
import {
  CreateOrganizationDto,
  CreateOrganizationNodeTypeEnum,
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

  private resolveNodeTypeByTeamCode(organization: { id: string; parentId: string | null; teamCode: string | null }): 'GROUP' | 'UNIT' | 'OTHER' {
    const classification = resolveOrganizationClassification(organization);
    if (classification === 'UNIT') {
      return 'UNIT';
    }

    if (classification === 'GROUP') {
      return 'GROUP';
    }

    return 'OTHER';
  }

  private resolveAncestorCompanyId(
    organizationMap: Map<string, { id: string; parentId: string | null; teamCode: string | null }>,
    organizationId: string,
  ): string | null {
    const visited = new Set<string>();
    let current = organizationMap.get(organizationId) || null;

    while (current && !visited.has(current.id)) {
      visited.add(current.id);
      const classification = resolveOrganizationClassification(current);
      if (classification === 'COMPANY') {
        return current.id;
      }

      if (!current.parentId) {
        break;
      }

      current = organizationMap.get(current.parentId) || null;
    }

    return null;
  }

  private async assertParentSupportsChildType(
    parentId: string,
    childNodeType: CreateOrganizationNodeTypeEnum,
  ): Promise<void> {
    const parent = await this.prisma.organization.findUnique({
      where: { id: parentId },
      select: {
        id: true,
        parentId: true,
        teamCode: true,
      },
    });

    if (!parent) {
      throw new NotFoundException('상위 현장을 찾을 수 없습니다.');
    }

    if (this.resolveNodeTypeByTeamCode(parent) === 'UNIT') {
      throw new BadRequestException('단위 현장에는 하위 현장을 생성할 수 없습니다.');
    }

    const parentClassification = resolveOrganizationClassification(parent);
    if (parentClassification === 'ADMIN' && childNodeType !== CreateOrganizationNodeTypeEnum.GROUP) {
      throw new BadRequestException('관리자 루트 하위에는 회사 현장만 생성할 수 있습니다.');
    }

    if (parentClassification === 'COMPANY' && childNodeType !== CreateOrganizationNodeTypeEnum.GROUP) {
      throw new BadRequestException('회사 하위에는 그룹만 생성할 수 있습니다.');
    }

    if (parentClassification === 'GROUP' && childNodeType !== CreateOrganizationNodeTypeEnum.UNIT) {
      throw new BadRequestException('그룹 하위에는 단위만 생성할 수 있습니다.');
    }

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

  async create(
    dto: CreateOrganizationDto,
    scopeOrganizationIds?: string[],
    actorUserId?: string,
    actorRole?: string,
  ): Promise<OrganizationResponseDto> {
    this.ensureOrganizationInScope(dto.parentId || undefined, scopeOrganizationIds);
    const normalizedManagerPhone = normalizePhoneNumber(dto.managerPhone);
    let childNodeType = dto.nodeType ?? CreateOrganizationNodeTypeEnum.UNIT;

    if (dto.parentId) {
      const parent = await this.prisma.organization.findUnique({
        where: { id: dto.parentId },
        select: { id: true, parentId: true, teamCode: true },
      });

      if (!parent) {
        throw new NotFoundException('상위 현장을 찾을 수 없습니다.');
      }

      const parentClassification = resolveOrganizationClassification(parent);
      if (parentClassification === 'ADMIN') {
        if (actorRole !== 'SUPER_ADMIN') {
          throw new ForbiddenException('회사 현장은 슈퍼관리자만 생성할 수 있습니다.');
        }
        childNodeType = CreateOrganizationNodeTypeEnum.GROUP;
      }

      await this.assertParentSupportsChildType(
        dto.parentId,
        childNodeType,
      );
    }

    const isGroupNode = childNodeType === CreateOrganizationNodeTypeEnum.GROUP;

    const organization = await this.prisma.$transaction(async (tx) => {
      const createOrganization = async (teamCode: string | null) => {
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
            _count: { select: { children: true } },
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
      };

      if (isGroupNode) {
        return createOrganization(null);
      }

      for (let attempt = 0; attempt < 30; attempt += 1) {
        const teamCode = this.generateTeamCodeCandidate();

        try {
          return await createOrganization(teamCode);
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
        _count: {
          select: {
            children: true,
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
            children: true,
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
        _count: {
          select: {
            children: true,
          },
        },
      },
    });

    if (!organization) {
      throw new NotFoundException('현장을 찾을 수 없습니다.');
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
    actorRole?: string,
  ): Promise<OrganizationResponseDto> {
    await this.findOne(id, scopeOrganizationIds); // 존재 여부 확인
    const normalizedManagerPhone = normalizePhoneNumber(dto.managerPhone);
    const currentOrganization = await this.prisma.organization.findUnique({
      where: { id },
      select: { id: true, parentId: true, teamCode: true },
    });

    if (!currentOrganization) {
      throw new NotFoundException('현장을 찾을 수 없습니다.');
    }

    const movingNodeType = this.resolveNodeTypeByTeamCode(currentOrganization);
    const nextParentId = dto.parentId;
    const isUnitTransfer = Boolean(
      movingNodeType === 'UNIT'
      && nextParentId
      && nextParentId !== currentOrganization.parentId,
    );

    // 순환 참조 방지
    if (nextParentId) {
      this.ensureOrganizationInScope(nextParentId, scopeOrganizationIds);
      if (nextParentId === id) {
        throw new BadRequestException('현장은 자기 자신을 상위 현장으로 설정할 수 없습니다.');
      }

      const targetParent = await this.prisma.organization.findUnique({
        where: { id: nextParentId },
        select: { id: true, parentId: true, teamCode: true },
      });

      if (!targetParent) {
        throw new NotFoundException('상위 현장을 찾을 수 없습니다.');
      }

      if (resolveOrganizationClassification(targetParent) === 'ADMIN' && actorRole !== 'SUPER_ADMIN') {
        throw new ForbiddenException('회사 현장은 슈퍼관리자만 생성할 수 있습니다.');
      }

      // 하위 현장을 상위로 설정하는지 확인
      const descendants = await this.getDescendants(id, scopeOrganizationIds);
      if (descendants.some((d) => d.id === nextParentId)) {
        throw new BadRequestException('하위 현장을 상위 현장으로 설정할 수 없습니다.');
      }

      if (movingNodeType === 'OTHER' && nextParentId !== currentOrganization.parentId) {
        throw new BadRequestException('관리자/회사 레벨 현장은 구조 이동을 지원하지 않습니다.');
      }

      if (movingNodeType === 'UNIT' && nextParentId !== currentOrganization.parentId) {
        const organizations = await this.prisma.organization.findMany({
          select: {
            id: true,
            parentId: true,
            teamCode: true,
          },
        });

        const organizationMap = new Map(organizations.map((organization) => [organization.id, organization] as const));
        const sourceCompanyId = this.resolveAncestorCompanyId(organizationMap, currentOrganization.id);
        const targetCompanyId = this.resolveAncestorCompanyId(organizationMap, nextParentId);

        if (!sourceCompanyId || !targetCompanyId || sourceCompanyId !== targetCompanyId) {
          throw new BadRequestException('단위 현장은 같은 회사 내 그룹으로만 이관할 수 있습니다.');
        }
      }

      if (movingNodeType !== 'OTHER') {
        await this.assertParentSupportsChildType(
          nextParentId,
          movingNodeType === 'UNIT' ? CreateOrganizationNodeTypeEnum.UNIT : CreateOrganizationNodeTypeEnum.GROUP,
        );
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
          parentId: nextParentId,
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
          _count: {
            select: {
              children: true,
            },
          },
        },
      });

      // 상위 현장이 생기면 그룹으로 전환되므로 팀코드를 제거한다.
      if (nextParentId) {
        await tx.organization.update({
          where: { id: nextParentId },
          data: {
            teamCode: null,
            updatedById: actorUserId,
          },
        });
      }

      return updated;
    });

    if (isUnitTransfer && actorUserId) {
      const parentIds = [currentOrganization.parentId, nextParentId]
        .filter((parentId): parentId is string => Boolean(parentId));

      const parentRows = parentIds.length > 0
        ? await this.prisma.organization.findMany({
            where: { id: { in: parentIds } },
            select: { id: true, name: true },
          })
        : [];

      const parentNameById = new Map(parentRows.map((parent) => [parent.id, parent.name] as const));

      void this.prisma.auditLog.create({
        data: {
          accountId: actorUserId,
          organizationId: organization.id,
          action: AuditAction.UPDATE,
          resourceType: 'Organization',
          resourceId: organization.id,
          resourceName: organization.name,
          changesBefore: {
            event: 'unit_transfer',
            parentId: currentOrganization.parentId,
            parentName: currentOrganization.parentId ? (parentNameById.get(currentOrganization.parentId) || null) : null,
          },
          changesAfter: {
            event: 'unit_transfer',
            parentId: nextParentId,
            parentName: nextParentId ? (parentNameById.get(nextParentId) || null) : null,
            transferredById: actorUserId,
          },
        },
      }).catch(() => undefined);
    }

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

    const blockingEmployeeCount = await this.prisma.employee.count({
      where: {
        organizationId: id,
        status: {
          notIn: [EmployeeStatus.DELETE, EmployeeStatus.PHONE_INFO_REVIEW],
        },
      },
    });

    if (blockingEmployeeCount > 0) {
      throw new BadRequestException('직원이 소속된 현장은 삭제할 수 없습니다.');
    }

    const archivedEmployees = await this.prisma.employee.findMany({
      where: {
        organizationId: id,
        status: {
          in: [EmployeeStatus.DELETE, EmployeeStatus.PHONE_INFO_REVIEW],
        },
      },
      select: { id: true },
    });

    if (archivedEmployees.length > 0 && id !== CODEEDGE_ROOT_ORGANIZATION_ID) {
      const rootOrganization = await this.prisma.organization.findUnique({
        where: { id: CODEEDGE_ROOT_ORGANIZATION_ID },
        select: { id: true },
      });

      if (!rootOrganization) {
        throw new BadRequestException('루트 조직 정보가 없어 삭제 대기 직원 데이터를 이관할 수 없습니다.');
      }

      await this.prisma.employee.updateMany({
        where: {
          id: {
            in: archivedEmployees.map((employee) => employee.id),
          },
        },
        data: {
          organizationId: CODEEDGE_ROOT_ORGANIZATION_ID,
        },
      });
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
      include: {
        _count: {
          select: {
            children: true,
          },
        },
      },
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
      include: {
        _count: {
          select: {
            children: true,
          },
        },
      },
    });

    while (current?.parentId) {
      const parent = await this.prisma.organization.findUnique({
        where: { id: current.parentId },
        include: {
          _count: {
            select: {
              children: true,
            },
          },
        },
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

    await assertUnitOrganization(this.prisma, sourceOrganizationId);
    await assertUnitOrganization(this.prisma, dto.targetOrganizationId);

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
