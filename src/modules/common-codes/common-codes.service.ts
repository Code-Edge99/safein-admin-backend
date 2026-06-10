import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CommonCodeGroupDto, CommonCodeItemDto } from './dto';

type CodeItemRow = {
  code: string;
  label: string;
  description: string | null;
  sortOrder: number;
  isActive: boolean;
  metadata: unknown;
};

type CodeGroupWithItems = {
  key: string;
  name: string;
  description: string | null;
  sortOrder: number;
  isActive: boolean;
  items: CodeItemRow[];
};

@Injectable()
export class CommonCodesService {
  constructor(private readonly prisma: PrismaService) {}

  private parseGroupKeys(groupKeys?: string): string[] {
    return Array.from(
      new Set(
        String(groupKeys || '')
          .split(',')
          .map((key) => key.trim())
          .filter((key) => key.length > 0),
      ),
    );
  }

  private findRawGroups(groupKeys?: string[]) {
    return this.prisma.codeGroup.findMany({
      where: {
        isActive: true,
        ...(groupKeys && groupKeys.length > 0 ? { key: { in: groupKeys } } : {}),
      },
      include: {
        items: {
          where: { isActive: true },
          orderBy: [
            { sortOrder: 'asc' },
            { code: 'asc' },
          ],
        },
      },
      orderBy: [
        { sortOrder: 'asc' },
        { key: 'asc' },
      ],
    });
  }

  private toItemDto(groupKey: string, item: CodeGroupWithItems['items'][number]): CommonCodeItemDto {
    return {
      groupKey,
      code: item.code,
      label: item.label,
      description: item.description,
      sortOrder: item.sortOrder,
      isActive: item.isActive,
      metadata: item.metadata ?? undefined,
    };
  }

  private toGroupDto(group: CodeGroupWithItems): CommonCodeGroupDto {
    return {
      key: group.key,
      name: group.name,
      description: group.description,
      sortOrder: group.sortOrder,
      isActive: group.isActive,
      items: group.items.map((item) => this.toItemDto(group.key, item)),
    };
  }

  async findAll(groupKeys?: string): Promise<CommonCodeGroupDto[]> {
    const parsedGroupKeys = this.parseGroupKeys(groupKeys);
    const groups = await this.findRawGroups(parsedGroupKeys);
    return groups.map((group) => this.toGroupDto(group));
  }

  async findOne(groupKey: string): Promise<CommonCodeGroupDto> {
    const groups = await this.findRawGroups([groupKey]);
    const group = groups[0];

    if (!group) {
      throw new NotFoundException(`Common code group not found: ${groupKey}`);
    }

    return this.toGroupDto(group);
  }
}
