import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import * as bcrypt from 'bcrypt';
import {
  CreateAccountDto,
  UpdateAccountDto,
  ChangePasswordDto,
  ResetPasswordDto,
  AccountResponseDto,
  AccountFilterDto,
  AccountListResponseDto,
  AccountStatsDto,
  AdminRoleEnum,
  AccountStatusEnum,
} from './dto';

@Injectable()
export class AccountsService {
  constructor(private prisma: PrismaService) {}

  async create(dto: CreateAccountDto): Promise<AccountResponseDto> {
    // 사용자명 중복 체크
    const existing = await this.prisma.account.findUnique({
      where: { username: dto.username },
    });

    if (existing) {
      throw new ConflictException(`이미 사용 중인 사용자명입니다: ${dto.username}`);
    }

    // 비밀번호 해시
    const passwordHash = await bcrypt.hash(dto.password, 10);

    const account = await this.prisma.account.create({
      data: {
        username: dto.username,
        passwordHash,
        name: dto.name,
        email: dto.email,
        phone: dto.phone,
        role: dto.role as any,
        organizationId: dto.organizationId,
      },
      include: {
        organization: { select: { id: true, name: true } },
      },
    });

    return this.toResponseDto(account);
  }

  async findAll(filter: AccountFilterDto): Promise<AccountListResponseDto> {
    const page = filter.page || 1;
    const limit = filter.limit || 20;
    const skip = (page - 1) * limit;

    const where: any = {};

    if (filter.search) {
      where.OR = [
        { username: { contains: filter.search, mode: 'insensitive' } },
        { name: { contains: filter.search, mode: 'insensitive' } },
        { email: { contains: filter.search, mode: 'insensitive' } },
      ];
    }

    if (filter.role) {
      where.role = filter.role;
    }

    if (filter.status) {
      where.status = filter.status;
    }

    if (filter.organizationId) {
      where.organizationId = filter.organizationId;
    }

    const [data, total] = await Promise.all([
      this.prisma.account.findMany({
        where,
        skip,
        take: limit,
        include: {
          organization: { select: { id: true, name: true } },
        },
        orderBy: { name: 'asc' },
      }),
      this.prisma.account.count({ where }),
    ]);

    return {
      data: data.map((account) => this.toResponseDto(account)),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async findOne(id: string): Promise<AccountResponseDto> {
    const account = await this.prisma.account.findUnique({
      where: { id },
      include: {
        organization: { select: { id: true, name: true } },
      },
    });

    if (!account) {
      throw new NotFoundException('계정을 찾을 수 없습니다.');
    }

    return this.toResponseDto(account);
  }

  async findByUsername(username: string): Promise<AccountResponseDto> {
    const account = await this.prisma.account.findUnique({
      where: { username },
      include: {
        organization: { select: { id: true, name: true } },
      },
    });

    if (!account) {
      throw new NotFoundException('계정을 찾을 수 없습니다.');
    }

    return this.toResponseDto(account);
  }

  async update(id: string, dto: UpdateAccountDto): Promise<AccountResponseDto> {
    await this.findOne(id);

    const account = await this.prisma.account.update({
      where: { id },
      data: {
        name: dto.name,
        email: dto.email,
        phone: dto.phone,
        role: dto.role as any,
        organizationId: dto.organizationId,
        status: dto.status as any,
      },
      include: {
        organization: { select: { id: true, name: true } },
      },
    });

    return this.toResponseDto(account);
  }

  async changePassword(id: string, dto: ChangePasswordDto): Promise<void> {
    const account = await this.prisma.account.findUnique({
      where: { id },
    });

    if (!account) {
      throw new NotFoundException('계정을 찾을 수 없습니다.');
    }

    // 현재 비밀번호 확인
    const isValid = await bcrypt.compare(dto.currentPassword, account.passwordHash);
    if (!isValid) {
      throw new BadRequestException('현재 비밀번호가 일치하지 않습니다.');
    }

    // 새 비밀번호 해시
    const passwordHash = await bcrypt.hash(dto.newPassword, 10);

    await this.prisma.account.update({
      where: { id },
      data: { passwordHash },
    });
  }

  async resetPassword(id: string, dto: ResetPasswordDto): Promise<void> {
    await this.findOne(id);

    const passwordHash = await bcrypt.hash(dto.newPassword, 10);

    await this.prisma.account.update({
      where: { id },
      data: { passwordHash },
    });
  }

  async toggleStatus(id: string): Promise<AccountResponseDto> {
    const account = await this.prisma.account.findUnique({
      where: { id },
    });

    if (!account) {
      throw new NotFoundException('계정을 찾을 수 없습니다.');
    }

    const newStatus = account.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE';

    const updated = await this.prisma.account.update({
      where: { id },
      data: { status: newStatus },
      include: {
        organization: { select: { id: true, name: true } },
      },
    });

    return this.toResponseDto(updated);
  }

  async remove(id: string): Promise<void> {
    await this.findOne(id);

    await this.prisma.account.delete({
      where: { id },
    });
  }

  async getStats(): Promise<AccountStatsDto> {
    const [total, active, roleStats] = await Promise.all([
      this.prisma.account.count(),
      this.prisma.account.count({ where: { status: 'ACTIVE' } }),
      this.prisma.account.groupBy({
        by: ['role'],
        _count: true,
      }),
    ]);

    const byRole: Record<string, number> = {};
    roleStats.forEach((stat) => {
      byRole[stat.role] = stat._count;
    });

    return {
      total,
      active,
      inactive: total - active,
      byRole,
    };
  }

  private toResponseDto(account: any): AccountResponseDto {
    return {
      id: account.id,
      username: account.username,
      name: account.name,
      email: account.email,
      phone: account.phone,
      role: account.role as AdminRoleEnum,
      organization: account.organization,
      status: account.status as AccountStatusEnum,
      lastLogin: account.lastLogin,
      createdAt: account.createdAt,
      updatedAt: account.updatedAt,
    };
  }
}
