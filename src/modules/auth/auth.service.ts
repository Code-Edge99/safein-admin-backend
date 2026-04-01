import { Injectable, UnauthorizedException, BadRequestException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../../prisma/prisma.service';
import {
  LoginDto,
  ChangePasswordDto,
  TokenResponseDto,
  AuthUserDto,
  UpdateProfileDto,
} from './dto';
import { AccountStatus, AdminRole, LoginStatus } from '@prisma/client';
import { FIXED_ADMIN_UNLIMITED_TOKEN, FIXED_ADMIN_UNLIMITED_USER } from './auth.constants';

interface SessionPayload {
  sub: string;
  username: string;
  role: AdminRole;
  organizationId: string | null;
}

interface RefreshPayload extends SessionPayload {
  type: 'refresh';
  sessionStartedAt: number;
  lastActivityAt: number;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  private parseDurationToSeconds(rawValue: string | number | undefined, fallbackSeconds: number): number {
    if (typeof rawValue === 'number' && Number.isFinite(rawValue) && rawValue > 0) {
      return Math.floor(rawValue);
    }

    if (typeof rawValue !== 'string' || rawValue.trim().length === 0) {
      return fallbackSeconds;
    }

    const value = rawValue.trim();
    if (/^\d+$/.test(value)) {
      return Number(value);
    }

    const match = value.match(/^(\d+)([smhd])$/i);
    if (!match) {
      return fallbackSeconds;
    }

    const amount = Number(match[1]);
    const unit = match[2].toLowerCase();

    const multiplier: Record<string, number> = {
      s: 1,
      m: 60,
      h: 3600,
      d: 86400,
    };

    return amount * (multiplier[unit] || 1);
  }

  private getAccessTokenExpiresIn(): string {
    return this.configService.get<string>('JWT_EXPIRATION', '15m');
  }

  private getRefreshTokenExpiresIn(): string {
    return this.configService.get<string>('JWT_REFRESH_EXPIRATION', '30d');
  }

  private getRefreshSecret(): string {
    return this.configService.get<string>('JWT_REFRESH_SECRET')
      || this.configService.get<string>('JWT_SECRET')
      || '';
  }

  private buildUserResponse(account: any): TokenResponseDto['user'] {
    return {
      id: account.id,
      username: account.username,
      name: account.name,
      email: account.email,
      role: account.role,
      organization: account.organization
        ? { id: account.organization.id, name: account.organization.name }
        : undefined,
    };
  }

  private issueTokens(payload: SessionPayload, user: TokenResponseDto['user']): TokenResponseDto {
    const nowSeconds = Math.floor(Date.now() / 1000);
    const accessExpiresIn = this.getAccessTokenExpiresIn();
    const refreshExpiresIn = this.getRefreshTokenExpiresIn();
    const refreshSecret = this.getRefreshSecret();

    const accessToken = this.jwtService.sign(payload, {
      expiresIn: accessExpiresIn,
    });

    const refreshTokenPayload: RefreshPayload = {
      ...payload,
      type: 'refresh',
      sessionStartedAt: nowSeconds,
      lastActivityAt: nowSeconds,
    };

    const refreshToken = this.jwtService.sign(refreshTokenPayload, {
      secret: refreshSecret,
      expiresIn: refreshExpiresIn,
    });

    return {
      accessToken,
      refreshToken,
      tokenType: 'Bearer',
      expiresIn: this.parseDurationToSeconds(accessExpiresIn, 900),
      refreshExpiresIn: this.parseDurationToSeconds(refreshExpiresIn, 2592000),
      user,
    };
  }

  private issueTokensFromRefresh(payload: RefreshPayload, user: TokenResponseDto['user']): TokenResponseDto {
    const accessExpiresIn = this.getAccessTokenExpiresIn();
    const refreshExpiresIn = this.getRefreshTokenExpiresIn();
    const refreshSecret = this.getRefreshSecret();
    const nowSeconds = Math.floor(Date.now() / 1000);

    const basePayload: SessionPayload = {
      sub: payload.sub,
      username: payload.username,
      role: payload.role,
      organizationId: payload.organizationId,
    };

    const accessToken = this.jwtService.sign(basePayload, {
      expiresIn: accessExpiresIn,
    });

    const refreshToken = this.jwtService.sign(
      {
        ...basePayload,
        type: 'refresh',
        sessionStartedAt: payload.sessionStartedAt,
        lastActivityAt: nowSeconds,
      },
      {
        secret: refreshSecret,
        expiresIn: refreshExpiresIn,
      },
    );

    return {
      accessToken,
      refreshToken,
      tokenType: 'Bearer',
      expiresIn: this.parseDurationToSeconds(accessExpiresIn, 900),
      refreshExpiresIn: this.parseDurationToSeconds(refreshExpiresIn, 2592000),
      user,
    };
  }

  private isFixedMasterAdminAccount(account: { id: string; username: string }): boolean {
    return (
      account.id === FIXED_ADMIN_UNLIMITED_USER.id
      || account.username === FIXED_ADMIN_UNLIMITED_USER.username
    );
  }

  private async getLastPasswordChangedAt(accountId: string): Promise<Date | undefined> {
    const latestLog = await this.prisma.auditLog.findFirst({
      where: {
        accountId,
        action: 'UPDATE',
        resourceType: 'Account',
        resourceName: '비밀번호 변경',
      },
      orderBy: {
        timestamp: 'desc',
      },
      select: {
        timestamp: true,
      },
    });

    return latestLog?.timestamp;
  }

  async login(
    loginDto: LoginDto,
    ipAddress?: string,
    userAgent?: string,
  ): Promise<TokenResponseDto> {
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

    if (
      account.role !== AdminRole.SUPER_ADMIN &&
      (!account.organization || !account.organization.isActive)
    ) {
      throw new UnauthorizedException('비슈퍼관리자는 활성 현장 정보가 필수입니다.');
    }

    const isPasswordValid = await bcrypt.compare(password, account.passwordHash);

    if (!isPasswordValid) {
      // 로그인 실패 기록
      await this.prisma.adminLoginHistory.create({
        data: {
          accountId: account.id,
          ipAddress: ipAddress || null,
          userAgent: userAgent || null,
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
        ipAddress: ipAddress || null,
        userAgent: userAgent || null,
        status: LoginStatus.SUCCESS,
      },
    });

    // 마지막 로그인 시간 업데이트
    await this.prisma.account.update({
      where: { id: account.id },
      data: { lastLogin: new Date() },
    });

    if (this.isFixedMasterAdminAccount(account)) {
      return {
        accessToken: FIXED_ADMIN_UNLIMITED_TOKEN,
        tokenType: 'Bearer',
        expiresIn: 2147483647,
        user: this.buildUserResponse(account),
      };
    }

    const payload: SessionPayload = {
      sub: account.id,
      username: account.username,
      role: account.role,
      organizationId: account.organizationId || null,
    };

    return this.issueTokens(payload, this.buildUserResponse(account));
  }

  async refresh(refreshToken: string): Promise<TokenResponseDto> {
    const refreshSecret = this.getRefreshSecret();
    if (!refreshSecret) {
      throw new UnauthorizedException('리프레시 토큰 설정이 유효하지 않습니다.');
    }

    let payload: RefreshPayload;
    try {
      payload = this.jwtService.verify<RefreshPayload>(refreshToken, {
        secret: refreshSecret,
      });
    } catch {
      throw new UnauthorizedException('리프레시 토큰이 유효하지 않습니다.');
    }

    if (payload.type !== 'refresh') {
      throw new UnauthorizedException('리프레시 토큰 형식이 올바르지 않습니다.');
    }

    const nowSeconds = Math.floor(Date.now() / 1000);
    const inactivityLimitSeconds = this.parseDurationToSeconds(
      this.configService.get<string>('JWT_REFRESH_INACTIVITY', '7d'),
      604800,
    );
    const absoluteLimitSeconds = this.parseDurationToSeconds(
      this.configService.get<string>('JWT_REFRESH_ABSOLUTE_EXPIRATION', '30d'),
      2592000,
    );

    if (payload.lastActivityAt && nowSeconds - payload.lastActivityAt > inactivityLimitSeconds) {
      throw new UnauthorizedException('장시간 미사용으로 세션이 만료되었습니다. 다시 로그인해주세요.');
    }

    if (payload.sessionStartedAt && nowSeconds - payload.sessionStartedAt > absoluteLimitSeconds) {
      throw new UnauthorizedException('보안 정책에 따라 세션이 만료되었습니다. 다시 로그인해주세요.');
    }

    const user = await this.validateUser(payload.sub);
    if (!user) {
      throw new UnauthorizedException('유효하지 않은 사용자입니다.');
    }

    return this.issueTokensFromRefresh(payload, {
      id: user.id,
      username: user.username,
      name: user.name,
      email: user.email || '',
      role: user.role,
      organization: user.organization,
    });
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

    if (
      account.role !== AdminRole.SUPER_ADMIN &&
      (!account.organization || !account.organization.isActive)
    ) {
      return null;
    }

    return {
      id: account.id,
      username: account.username,
      name: account.name,
      email: account.email,
      role: account.role,
      organization: account.organization
        ? { id: account.organization.id, name: account.organization.name }
        : undefined,
      organizationId: account.organizationId || '',
      lastLogin: account.lastLogin || undefined,
      createdAt: account.createdAt || undefined,
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

    const lastPasswordChangedAt = await this.getLastPasswordChangedAt(userId);

    return {
      ...user,
      lastPasswordChangedAt,
    };
  }

  async updateProfile(userId: string, dto: UpdateProfileDto): Promise<AuthUserDto> {
    const currentUser = await this.validateUser(userId);

    if (!currentUser) {
      throw new UnauthorizedException('사용자를 찾을 수 없습니다.');
    }

    const updated = await this.prisma.account.update({
      where: { id: userId },
      data: {
        name: dto.name,
        email: dto.email,
      },
      include: {
        organization: true,
      },
    });

    await this.prisma.auditLog.create({
      data: {
        accountId: userId,
        action: 'UPDATE',
        resourceType: 'Account',
        resourceId: userId,
        resourceName: '내 프로필 수정',
        changesBefore: {
          name: currentUser.name,
          email: currentUser.email || '',
        },
        changesAfter: {
          name: updated.name,
          email: updated.email || '',
        },
      },
    });

    const lastPasswordChangedAt = await this.getLastPasswordChangedAt(userId);

    return {
      id: updated.id,
      username: updated.username,
      name: updated.name,
      email: updated.email,
      role: updated.role,
      organization: updated.organization
        ? { id: updated.organization.id, name: updated.organization.name }
        : undefined,
      organizationId: updated.organizationId || '',
      lastLogin: updated.lastLogin || undefined,
      createdAt: updated.createdAt || undefined,
      lastPasswordChangedAt,
    };
  }
}
