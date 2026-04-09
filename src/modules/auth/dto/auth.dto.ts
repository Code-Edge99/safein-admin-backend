import { IsString, IsNotEmpty, MinLength, IsEmail, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';

export class LoginDto {
  @ApiProperty({ description: '사용자 아이디', example: 'admin' })
  @IsString()
  @IsNotEmpty()
  username!: string;

  @ApiProperty({ description: '비밀번호', example: 'password123' })
  @IsString()
  @IsNotEmpty()
  @MinLength(6)
  password!: string;
}

export class ChangePasswordDto {
  @ApiProperty({ description: '현재 비밀번호' })
  @IsString()
  @IsNotEmpty()
  currentPassword!: string;

  @ApiProperty({ description: '새 비밀번호' })
  @IsString()
  @IsNotEmpty()
  @MinLength(8)
  newPassword!: string;

  @ApiProperty({ description: '새 비밀번호 확인' })
  @IsString()
  @IsNotEmpty()
  confirmPassword!: string;
}

export class UpdateProfileDto {
  @ApiProperty({ description: '사용자 이름' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  name!: string;

  @ApiProperty({ description: '이메일' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  @IsEmail()
  @MaxLength(100)
  email!: string;
}

export class TokenResponseUserOrganizationDto {
  @ApiProperty({ description: '현장 ID' })
  id!: string;

  @ApiProperty({ description: '현장명' })
  name!: string;
}

export class TokenResponseUserDto {
  @ApiProperty({ description: '사용자 ID' })
  id!: string;

  @ApiProperty({ description: '사용자 아이디' })
  username!: string;

  @ApiProperty({ description: '사용자 이름' })
  name!: string;

  @ApiProperty({ description: '이메일' })
  email!: string;

  @ApiProperty({ description: '역할' })
  role!: string;

  @ApiProperty({ description: '소속 현장', required: false, type: TokenResponseUserOrganizationDto })
  organization?: TokenResponseUserOrganizationDto;
}

export class TokenResponseDto {
  @ApiProperty({ description: 'JWT 액세스 토큰' })
  accessToken!: string;

  @ApiProperty({ description: 'JWT 리프레시 토큰', required: false })
  refreshToken?: string;

  @ApiProperty({ description: '토큰 타입' })
  tokenType!: string;

  @ApiProperty({ description: '액세스 토큰 만료 시간 (초)' })
  expiresIn!: number;

  @ApiProperty({ description: '리프레시 토큰 만료 시간 (초)', required: false })
  refreshExpiresIn?: number;

  @ApiProperty({ description: '사용자 정보', type: TokenResponseUserDto })
  user!: TokenResponseUserDto;
}

export class RefreshTokenDto {
  @ApiProperty({ description: '리프레시 토큰' })
  @IsString()
  @IsNotEmpty()
  refreshToken!: string;
}

export class AuthUserDto {
  @ApiProperty({ description: '사용자 ID' })
  id!: string;

  @ApiProperty({ description: '사용자 아이디' })
  username!: string;

  @ApiProperty({ description: '사용자 이름' })
  name!: string;

  @ApiProperty({ description: '이메일', required: false })
  email?: string;

  @ApiProperty({ description: '역할' })
  role!: string;

  @ApiProperty({
    description: '소속 현장',
    required: false,
    type: TokenResponseUserOrganizationDto,
  })
  organization?: TokenResponseUserOrganizationDto;

  @ApiProperty({ description: '현장 ID' })
  organizationId!: string;

  @ApiPropertyOptional({ description: '마지막 로그인 시각' })
  lastLogin?: Date;

  @ApiPropertyOptional({ description: '계정 생성 시각' })
  createdAt?: Date;

  @ApiPropertyOptional({ description: '마지막 비밀번호 변경 시각' })
  lastPasswordChangedAt?: Date;
}
