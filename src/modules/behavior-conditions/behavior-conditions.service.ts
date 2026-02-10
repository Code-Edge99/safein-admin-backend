import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
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
  constructor(private prisma: PrismaService) {}

  async create(createDto: CreateBehaviorConditionDto): Promise<BehaviorConditionResponseDto> {
    const { organizationId, workTypeId, type, ...rest } = createDto;

    // Validate organization
    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
    });
    if (!org) {
      throw new BadRequestException('조직을 찾을 수 없습니다.');
    }

    // Validate work type if provided
    if (workTypeId) {
      const workType = await this.prisma.workType.findUnique({
        where: { id: workTypeId },
      });
      if (!workType) {
        throw new BadRequestException('작업 유형을 찾을 수 없습니다.');
      }
    }

    const condition = await this.prisma.behaviorCondition.create({
      data: {
        ...rest,
        type: type as any,
        organizationId,
        workTypeId,
      },
      include: {
        organization: { select: { id: true, name: true } },
        workType: { select: { id: true, name: true } },
        _count: { select: { policyBehaviors: true } },
      },
    });

    return this.toResponseDto(condition);
  }

  async findAll(filter: BehaviorConditionFilterDto): Promise<BehaviorConditionListResponseDto> {
    const { search, type, organizationId, workTypeId, isActive, page = 1, limit = 20 } = filter;
    const skip = (page - 1) * limit;

    const where: any = {};

    if (search) {
      where.name = { contains: search, mode: 'insensitive' };
    }

    if (type) {
      where.type = type;
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

    const [conditions, total] = await Promise.all([
      this.prisma.behaviorCondition.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          organization: { select: { id: true, name: true } },
          workType: { select: { id: true, name: true } },
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

  async findOne(id: string): Promise<BehaviorConditionResponseDto> {
    const condition = await this.prisma.behaviorCondition.findUnique({
      where: { id },
      include: {
        organization: { select: { id: true, name: true } },
        workType: { select: { id: true, name: true } },
        _count: { select: { policyBehaviors: true } },
      },
    });

    if (!condition) {
      throw new NotFoundException('행동 조건을 찾을 수 없습니다.');
    }

    return this.toResponseDto(condition);
  }

  async findByOrganization(organizationId: string): Promise<BehaviorConditionResponseDto[]> {
    const conditions = await this.prisma.behaviorCondition.findMany({
      where: {
        organizationId,
        isActive: true,
      },
      include: {
        organization: { select: { id: true, name: true } },
        workType: { select: { id: true, name: true } },
        _count: { select: { policyBehaviors: true } },
      },
      orderBy: { name: 'asc' },
    });

    return conditions.map((c) => this.toResponseDto(c));
  }

  async update(id: string, updateDto: UpdateBehaviorConditionDto): Promise<BehaviorConditionResponseDto> {
    await this.findOne(id);

    const { organizationId, workTypeId, type, ...rest } = updateDto;

    const updateData: any = { ...rest };

    if (organizationId) {
      const org = await this.prisma.organization.findUnique({
        where: { id: organizationId },
      });
      if (!org) {
        throw new BadRequestException('조직을 찾을 수 없습니다.');
      }
      updateData.organizationId = organizationId;
    }

    if (workTypeId !== undefined) {
      if (workTypeId) {
        const workType = await this.prisma.workType.findUnique({
          where: { id: workTypeId },
        });
        if (!workType) {
          throw new BadRequestException('작업 유형을 찾을 수 없습니다.');
        }
      }
      updateData.workTypeId = workTypeId || null;
    }

    if (type) {
      updateData.type = type;
    }

    const condition = await this.prisma.behaviorCondition.update({
      where: { id },
      data: updateData,
      include: {
        organization: { select: { id: true, name: true } },
        workType: { select: { id: true, name: true } },
        _count: { select: { policyBehaviors: true } },
      },
    });

    return this.toResponseDto(condition);
  }

  async remove(id: string): Promise<void> {
    const condition = await this.findOne(id);

    // Check if used by any policy
    if (condition.policyCount > 0) {
      throw new BadRequestException('정책에서 사용 중인 조건은 삭제할 수 없습니다.');
    }

    await this.prisma.behaviorCondition.delete({ where: { id } });
  }

  async toggleActive(id: string): Promise<BehaviorConditionResponseDto> {
    const condition = await this.prisma.behaviorCondition.findUnique({ where: { id } });

    if (!condition) {
      throw new NotFoundException('행동 조건을 찾을 수 없습니다.');
    }

    const updated = await this.prisma.behaviorCondition.update({
      where: { id },
      data: { isActive: !condition.isActive },
      include: {
        organization: { select: { id: true, name: true } },
        workType: { select: { id: true, name: true } },
        _count: { select: { policyBehaviors: true } },
      },
    });

    return this.toResponseDto(updated);
  }

  async getStats(): Promise<BehaviorConditionStatsDto> {
    const [totalConditions, activeConditions, byTypeResult] = await Promise.all([
      this.prisma.behaviorCondition.count(),
      this.prisma.behaviorCondition.count({ where: { isActive: true } }),
      this.prisma.behaviorCondition.groupBy({
        by: ['type'],
        _count: { type: true },
      }),
    ]);

    const byType: Record<string, number> = {};
    byTypeResult.forEach((item) => {
      byType[item.type] = item._count.type;
    });

    return {
      totalConditions,
      activeConditions,
      byType,
    };
  }

  private toResponseDto(condition: any): BehaviorConditionResponseDto {
    return {
      id: condition.id,
      name: condition.name,
      type: condition.type,
      distanceThreshold: condition.distanceThreshold,
      stepsThreshold: condition.stepsThreshold,
      speedThreshold: condition.speedThreshold,
      description: condition.description,
      isActive: condition.isActive,
      organization: condition.organization,
      workType: condition.workType,
      policyCount: condition._count?.policyBehaviors ?? 0,
      createdAt: condition.createdAt,
      updatedAt: condition.updatedAt,
    };
  }
}
