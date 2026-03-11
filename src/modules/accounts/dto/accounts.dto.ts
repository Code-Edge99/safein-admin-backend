import { ApiProperty, ApiPropertyOptional, PartialType, OmitType } from '@nestjs/swagger';
import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsEmail,
  IsEnum,
  IsNumber,
  MinLength,
} from 'class-validator';
import { Type, Transform } from 'class-transformer';
import { normalizeOptionalPhoneNumber } from '../../../common/utils/phone.util';

// Enum 정의
export enum AdminRoleEnum {
  SUPER_ADMIN = 'SUPER_ADMIN',
  SITE_ADMIN = 'SITE_ADMIN',
  VIEWER = 'VIEWER',
}

export enum AccountStatusEnum {
  ACTIVE = 'ACTIVE',
  INACTIVE = 'INACTIVE',
}

// ============ Account DTOs ============

export class CreateAccountDto {
  @ApiProperty({ description: '사용자명 (로그인 ID)' })
  @IsString()
  @IsNotEmpty()
  username: string;

  @ApiProperty({ description: '비밀번호' })
  @IsString()
  @MinLength(8)
  password: string;

  @ApiProperty({ description: '이름' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({ description: '이메일' })
  @IsEmail()
  email: string;

  @ApiPropertyOptional({ description: '전화번호' })
  @Transform(({ value }) => normalizeOptionalPhoneNumber(value))
  @IsString()
  @IsOptional()
  phone?: string;

  @ApiProperty({ description: '역할', enum: AdminRoleEnum })
  @IsEnum(AdminRoleEnum)
  role: AdminRoleEnum;

  @ApiPropertyOptional({ description: '조직 ID' })
  @IsString()
  @IsOptional()
  organizationId?: string;
}

export class UpdateAccountDto extends PartialType(
  OmitType(CreateAccountDto, ['password', 'username'] as const),
) {
  @ApiPropertyOptional({ description: '사용자명 (로그인 ID)' })
  @IsString()
  @IsOptional()
  username?: string;

  @ApiPropertyOptional({ description: '상태', enum: AccountStatusEnum })
  @IsEnum(AccountStatusEnum)
  @IsOptional()
  status?: AccountStatusEnum;
}

export class ChangePasswordDto {
  @ApiProperty({ description: '현재 비밀번호' })
  @IsString()
  @IsNotEmpty()
  currentPassword: string;

  @ApiProperty({ description: '새 비밀번호' })
  @IsString()
  @MinLength(8)
  newPassword: string;
}

export class ResetPasswordDto {
  @ApiProperty({ description: '새 비밀번호' })
  @IsString()
  @MinLength(8)
  newPassword: string;
}

export class AccountResponseDto {
  @ApiProperty({ description: '계정 ID' })
  id: string;

  @ApiProperty({ description: '사용자명' })
  username: string;

  @ApiProperty({ description: '이름' })
  name: string;

  @ApiProperty({ description: '이메일' })
  email: string;

  @ApiPropertyOptional({ description: '전화번호' })
  phone?: string;

  @ApiProperty({ description: '역할', enum: AdminRoleEnum })
  role: AdminRoleEnum;

  @ApiPropertyOptional({ description: '조직 정보' })
  organization?: {
    id: string;
    name: string;
  };

  @ApiProperty({ description: '상태', enum: AccountStatusEnum })
  status: AccountStatusEnum;

  @ApiPropertyOptional({ description: '마지막 로그인' })
  lastLogin?: Date;

  @ApiProperty({ description: '생성일시' })
  createdAt: Date;

  @ApiProperty({ description: '수정일시' })
  updatedAt: Date;
}

export class AccountFilterDto {
  @ApiPropertyOptional({ description: '검색어 (이름/사용자명/이메일)' })
  @IsString()
  @IsOptional()
  search?: string;

  @ApiPropertyOptional({ description: '역할', enum: AdminRoleEnum })
  @IsEnum(AdminRoleEnum)
  @IsOptional()
  role?: AdminRoleEnum;

  @ApiPropertyOptional({ description: '상태', enum: AccountStatusEnum })
  @IsEnum(AccountStatusEnum)
  @IsOptional()
  status?: AccountStatusEnum;

  @ApiPropertyOptional({ description: '조직 ID' })
  @IsString()
  @IsOptional()
  organizationId?: string;

  @ApiPropertyOptional({ description: '페이지 번호', default: 1 })
  @IsNumber()
  @IsOptional()
  @Type(() => Number)
  page?: number;

  @ApiPropertyOptional({ description: '페이지 크기', default: 20 })
  @IsNumber()
  @IsOptional()
  @Type(() => Number)
  limit?: number;
}

export class AccountListResponseDto {
  @ApiProperty({ type: [AccountResponseDto] })
  data: AccountResponseDto[];

  @ApiProperty()
  total: number;

  @ApiProperty()
  page: number;

  @ApiProperty()
  limit: number;

  @ApiProperty()
  totalPages: number;
}

export class AccountStatsDto {
  @ApiProperty({ description: '전체 계정 수' })
  total: number;

  @ApiProperty({ description: '활성 계정 수' })
  active: number;

  @ApiProperty({ description: '비활성 계정 수' })
  inactive: number;

  @ApiProperty({ description: '역할별 계정 수' })
  byRole: Record<string, number>;
}
