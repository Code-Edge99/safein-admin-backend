import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
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

  async create(dto: CreateWorkTypeDto): Promise<WorkTypeResponseDto> {
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

  async findAll(organizationId?: string): Promise<WorkTypeResponseDto[]> {
    const where = organizationId ? { organizationId } : {};

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

  async findOne(id: string): Promise<WorkTypeDetailDto> {
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

    return {
      ...this.toResponseDto(workType),
      controlPolicyId: workType.controlPolicy?.id,
      controlPolicyName: workType.controlPolicy?.name,
    };
  }

  async update(id: string, dto: UpdateWorkTypeDto): Promise<WorkTypeResponseDto> {
    await this.findOne(id); // 존재 여부 확인

    // 조직 존재 여부 확인
    if (dto.organizationId) {
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

  async remove(id: string): Promise<void> {
    const workType = await this.prisma.workType.findUnique({
      where: { id },
      include: {
        _count: {
          select: { employees: true },
        },
      },
    });

    if (!workType) {
      throw new NotFoundException('근무 유형을 찾을 수 없습니다.');
    }

    if (workType._count.employees > 0) {
      throw new BadRequestException(
        '해당 근무 유형을 사용 중인 직원이 있어 삭제할 수 없습니다.',
      );
    }

    await this.prisma.workType.delete({
      where: { id },
    });
  }

  async toggleActive(id: string): Promise<WorkTypeResponseDto> {
    const workType = await this.prisma.workType.findUnique({ where: { id } });
    if (!workType) {
      throw new NotFoundException('근무 유형을 찾을 수 없습니다.');
    }

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
