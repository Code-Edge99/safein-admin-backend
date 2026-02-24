import { Injectable, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { OrganizationType as PrismaOrgType, DeviceStatus } from '@prisma/client';
import {
  CreateOrganizationDto,
  UpdateOrganizationDto,
  OrganizationResponseDto,
  OrganizationTreeDto,
  OrganizationStatsDto,
} from './dto';

@Injectable()
export class OrganizationsService {
  constructor(private readonly prisma: PrismaService) {}

  private ensureOrganizationInScope(
    organizationId: string | undefined,
    scopeOrganizationIds?: string[],
  ): void {
    if (!organizationId || !scopeOrganizationIds) return;
    if (!scopeOrganizationIds.includes(organizationId)) {
      throw new ForbiddenException('요청한 조직은 접근 권한 범위를 벗어났습니다.');
    }
  }

  private assertOrganizationInScope(
    organization: { id: string },
    scopeOrganizationIds?: string[],
  ): void {
    if (!scopeOrganizationIds) return;
    if (!scopeOrganizationIds.includes(organization.id)) {
      throw new NotFoundException('조직을 찾을 수 없습니다.');
    }
  }

  async create(dto: CreateOrganizationDto, scopeOrganizationIds?: string[], actorUserId?: string): Promise<OrganizationResponseDto> {
    this.ensureOrganizationInScope(dto.parentId || undefined, scopeOrganizationIds);

    // 상위 조직 검증
    if (dto.parentId) {
      const parent = await this.prisma.organization.findUnique({
        where: { id: dto.parentId },
      });
      if (!parent) {
        throw new NotFoundException('상위 조직을 찾을 수 없습니다.');
      }
    }

    const organization = await this.prisma.organization.create({
      data: {
        name: dto.name,
        type: dto.type as PrismaOrgType,
        address: dto.address,
        detailAddress: dto.detailAddress,
        description: dto.description,
        managerName: dto.managerName,
        managerPhone: dto.managerPhone,
        emergencyContact: dto.emergencyContact,
        createdById: actorUserId,
        updatedById: actorUserId,
        parentId: dto.parentId || null,
        isActive: dto.isActive ?? true,
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
      orderBy: [{ type: 'asc' }, { name: 'asc' }],
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
      orderBy: [{ type: 'asc' }, { name: 'asc' }],
    });

    const organizationIdSet = new Set(organizations.map((org) => org.id));

    // 조직 트리 구조로 변환
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
      throw new NotFoundException('조직을 찾을 수 없습니다.');
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
      throw new NotFoundException('조직을 찾을 수 없습니다.');
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

    // 순환 참조 방지
    if (dto.parentId) {
      this.ensureOrganizationInScope(dto.parentId, scopeOrganizationIds);
      if (dto.parentId === id) {
        throw new BadRequestException('조직은 자기 자신을 상위 조직으로 설정할 수 없습니다.');
      }

      // 하위 조직을 상위로 설정하는지 확인
      const descendants = await this.getDescendants(id, scopeOrganizationIds);
      if (descendants.some((d) => d.id === dto.parentId)) {
        throw new BadRequestException('하위 조직을 상위 조직으로 설정할 수 없습니다.');
      }

      const parent = await this.prisma.organization.findUnique({
        where: { id: dto.parentId },
      });
      if (!parent) {
        throw new NotFoundException('상위 조직을 찾을 수 없습니다.');
      }
    }

    const organization = await this.prisma.organization.update({
      where: { id },
      data: {
        name: dto.name,
        type: dto.type as PrismaOrgType | undefined,
        address: dto.address,
        detailAddress: dto.detailAddress,
        description: dto.description,
        managerName: dto.managerName,
        managerPhone: dto.managerPhone,
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
            employeesBySite: true,
            workTypes: true,
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
      throw new NotFoundException('조직을 찾을 수 없습니다.');
    }

    this.assertOrganizationInScope(organization, scopeOrganizationIds);

    if (organization._count.children > 0) {
      throw new BadRequestException('하위 조직이 있는 조직은 삭제할 수 없습니다.');
    }

    if (organization._count.employees > 0 || organization._count.employeesBySite > 0) {
      throw new BadRequestException('직원 또는 현장 배정이 있는 조직은 삭제할 수 없습니다.');
    }

    if (
      organization._count.workTypes > 0 ||
      organization._count.zones > 0 ||
      organization._count.timePolicies > 0 ||
      organization._count.behaviorConditions > 0 ||
      organization._count.allowedAppPresets > 0 ||
      organization._count.controlPolicies > 0
    ) {
      throw new BadRequestException('하위 정책/조건 데이터가 남아 있어 조직을 삭제할 수 없습니다. 관련 데이터를 먼저 정리해주세요.');
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
    return {
      id: org.id,
      name: org.name,
      type: org.type,
      parentId: org.parentId,
      address: org.address,
      detailAddress: org.detailAddress,
      description: org.description,
      managerName: org.managerName,
      managerPhone: org.managerPhone,
      emergencyContact: org.emergencyContact,
      isActive: org.isActive,
      createdById: org.createdById,
      updatedById: org.updatedById,
      createdByName: org.createdBy?.name || org.createdBy?.username || '시스템',
      updatedByName: org.updatedBy?.name || org.updatedBy?.username || '시스템',
      employeeCount: org.employeeCount || 0,
      createdAt: org.createdAt,
      updatedAt: org.updatedAt,
    };
  }
}
