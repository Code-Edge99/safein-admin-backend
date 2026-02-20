import { Injectable, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CreateWorkTypeDto,
  UpdateWorkTypeDto,
  WorkTypeResponseDto,
  WorkTypeDetailDto,
} from './dto';

@Injectable()
export class WorkTypesService {
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

  private assertWorkTypeInScope(
    workType: { organizationId: string },
    scopeOrganizationIds?: string[],
  ): void {
    if (!scopeOrganizationIds) return;
    if (!scopeOrganizationIds.includes(workType.organizationId)) {
      throw new NotFoundException('근무 유형을 찾을 수 없습니다.');
    }
  }

  async create(dto: CreateWorkTypeDto, scopeOrganizationIds?: string[]): Promise<WorkTypeResponseDto> {
    this.ensureOrganizationInScope(dto.organizationId, scopeOrganizationIds);

    // 조직 존재 여부 확인
    const organization = await this.prisma.organization.findUnique({
      where: { id: dto.organizationId },
    });

    if (!organization) {
      throw new NotFoundException('조직을 찾을 수 없습니다.');
    }

    const workType = await this.prisma.workType.create({
      data: {
        name: dto.name,
        description: dto.description,
        organizationId: dto.organizationId,
        isActive: dto.isActive ?? true,
      },
      include: {
        organization: true,
        _count: {
          select: { employees: true },
        },
      },
    });

    return this.toResponseDto(workType);
  }

  async findAll(organizationId?: string, scopeOrganizationIds?: string[]): Promise<WorkTypeResponseDto[]> {
    if (organizationId) {
      this.ensureOrganizationInScope(organizationId, scopeOrganizationIds);
    }

    const where = organizationId
      ? { organizationId }
      : scopeOrganizationIds
        ? { organizationId: { in: scopeOrganizationIds } }
        : {};

    const workTypes = await this.prisma.workType.findMany({
      where,
      include: {
        organization: true,
        _count: {
          select: { employees: true },
        },
        controlPolicy: {
          select: { id: true },
        },
      },
      orderBy: { name: 'asc' },
    });

    return workTypes.map((wt) => this.toResponseDto(wt));
  }

  async findOne(id: string, scopeOrganizationIds?: string[]): Promise<WorkTypeDetailDto> {
    const workType = await this.prisma.workType.findUnique({
      where: { id },
      include: {
        organization: true,
        _count: {
          select: { employees: true },
        },
        controlPolicy: {
          select: { id: true, name: true },
        },
      },
    });

    if (!workType) {
      throw new NotFoundException('근무 유형을 찾을 수 없습니다.');
    }

    this.assertWorkTypeInScope(workType, scopeOrganizationIds);

    return {
      ...this.toResponseDto(workType),
      controlPolicyId: workType.controlPolicy?.id,
      controlPolicyName: workType.controlPolicy?.name,
    };
  }

  async update(
    id: string,
    dto: UpdateWorkTypeDto,
    scopeOrganizationIds?: string[],
  ): Promise<WorkTypeResponseDto> {
    await this.findOne(id, scopeOrganizationIds); // 존재 여부 확인

    // 조직 존재 여부 확인
    if (dto.organizationId) {
      this.ensureOrganizationInScope(dto.organizationId, scopeOrganizationIds);
      const organization = await this.prisma.organization.findUnique({
        where: { id: dto.organizationId },
      });
      if (!organization) {
        throw new NotFoundException('조직을 찾을 수 없습니다.');
      }
    }

    const workType = await this.prisma.workType.update({
      where: { id },
      data: dto,
      include: {
        organization: true,
        _count: {
          select: { employees: true },
        },
      },
    });

    return this.toResponseDto(workType);
  }

  async remove(id: string, scopeOrganizationIds?: string[]): Promise<void> {
    const workType = await this.prisma.workType.findUnique({
      where: { id },
      include: {
        _count: {
          select: { employees: true },
        },
        controlPolicy: {
          select: { id: true },
        },
      },
    });

    if (!workType) {
      throw new NotFoundException('근무 유형을 찾을 수 없습니다.');
    }

    this.assertWorkTypeInScope(workType, scopeOrganizationIds);

    if (workType._count.employees > 0) {
      throw new BadRequestException(
        '해당 근무 유형을 사용 중인 직원이 있어 삭제할 수 없습니다.',
      );
    }

    await this.prisma.$transaction(async (tx) => {
      if (workType.controlPolicy) {
        await tx.controlPolicy.delete({
          where: { id: workType.controlPolicy.id },
        });
      }

      await tx.workType.delete({
        where: { id },
      });
    });
  }

  async toggleActive(id: string, scopeOrganizationIds?: string[]): Promise<WorkTypeResponseDto> {
    const workType = await this.prisma.workType.findUnique({ where: { id } });
    if (!workType) {
      throw new NotFoundException('근무 유형을 찾을 수 없습니다.');
    }

    this.assertWorkTypeInScope(workType, scopeOrganizationIds);

    const updated = await this.prisma.workType.update({
      where: { id },
      data: { isActive: !workType.isActive },
      include: {
        organization: true,
        _count: { select: { employees: true } },
      },
    });
    return this.toResponseDto(updated);
  }

  private toResponseDto(workType: any): WorkTypeResponseDto {
    return {
      id: workType.id,
      name: workType.name,
      description: workType.description,
      organizationId: workType.organizationId,
      organizationName: workType.organization?.name,
      isActive: workType.isActive,
      createdAt: workType.createdAt,
      updatedAt: workType.updatedAt,
      employeeCount: workType._count?.employees,
      hasPolicy: !!workType.controlPolicy,
    };
  }
}
