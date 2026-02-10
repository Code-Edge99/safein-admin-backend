import { Injectable, UnauthorizedException, BadRequestException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../../prisma/prisma.service';
import { LoginDto, ChangePasswordDto, TokenResponseDto, AuthUserDto } from './dto';
import { AccountStatus, LoginStatus } from '@prisma/client';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
  ) {}

  async login(loginDto: LoginDto): Promise<TokenResponseDto> {
    const { username, password } = loginDto;

    const account = await this.prisma.account.findUnique({
      where: { username },
      include: {
        organization: true,
      },
    });

    if (!account) {
      throw new UnauthorizedException('잘못된 아이디 또는 비밀번호입니다.');
    }

    if (account.status !== AccountStatus.ACTIVE) {
      throw new UnauthorizedException('비활성화된 계정입니다.');
    }

    const isPasswordValid = await bcrypt.compare(password, account.passwordHash);

    if (!isPasswordValid) {
      // 로그인 실패 기록
      await this.prisma.adminLoginHistory.create({
        data: {
          accountId: account.id,
          ipAddress: '',
          userAgent: '',
          status: LoginStatus.FAILED,
          failReason: 'INVALID_PASSWORD',
        },
      });

      throw new UnauthorizedException('잘못된 아이디 또는 비밀번호입니다.');
    }

    // 로그인 성공 기록
    await this.prisma.adminLoginHistory.create({
      data: {
        accountId: account.id,
        ipAddress: '',
        userAgent: '',
        status: LoginStatus.SUCCESS,
      },
    });

    // 마지막 로그인 시간 업데이트
    await this.prisma.account.update({
      where: { id: account.id },
      data: { lastLogin: new Date() },
    });

    const payload = {
      sub: account.id,
      username: account.username,
      role: account.role,
      organizationId: account.organizationId,
    };

    const accessToken = this.jwtService.sign(payload);

    return {
      accessToken,
      tokenType: 'Bearer',
      expiresIn: 86400, // 1 day in seconds
      user: {
        id: account.id,
        username: account.username,
        name: account.name,
        email: account.email,
        role: account.role,
        organization: account.organization
          ? { id: account.organization.id, name: account.organization.name }
          : undefined,
      },
    };
  }

  async validateUser(userId: string): Promise<AuthUserDto | null> {
    const account = await this.prisma.account.findUnique({
      where: { id: userId },
      include: {
        organization: true,
      },
    });

    if (!account || account.status !== AccountStatus.ACTIVE) {
      return null;
    }

    return {
      id: account.id,
      username: account.username,
      name: account.name,
      role: account.role,
      organizationId: account.organizationId || '',
    };
  }

  async changePassword(userId: string, dto: ChangePasswordDto): Promise<void> {
    const { currentPassword, newPassword, confirmPassword } = dto;

    if (newPassword !== confirmPassword) {
      throw new BadRequestException('새 비밀번호가 일치하지 않습니다.');
    }

    const account = await this.prisma.account.findUnique({
      where: { id: userId },
    });

    if (!account) {
      throw new UnauthorizedException('계정을 찾을 수 없습니다.');
    }

    const isPasswordValid = await bcrypt.compare(currentPassword, account.passwordHash);

    if (!isPasswordValid) {
      throw new BadRequestException('현재 비밀번호가 올바르지 않습니다.');
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);

    await this.prisma.account.update({
      where: { id: userId },
      data: {
        passwordHash: hashedPassword,
      },
    });

    // 감사 로그 기록
    await this.prisma.auditLog.create({
      data: {
        accountId: userId,
        action: 'UPDATE',
        resourceType: 'Account',
        resourceId: userId,
        resourceName: '비밀번호 변경',
      },
    });
  }

  async getProfile(userId: string): Promise<AuthUserDto> {
    const user = await this.validateUser(userId);

    if (!user) {
      throw new UnauthorizedException('사용자를 찾을 수 없습니다.');
    }

    return user;
  }
}
