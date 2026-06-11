import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsBoolean, IsEnum, IsOptional, IsString, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export enum PermissionActorTypeEnum {
  SUPER_ADMIN = 'SUPER_ADMIN',
  COMPANY_MANAGER = 'COMPANY_MANAGER',
  GROUP_MANAGER = 'GROUP_MANAGER',
}

export enum PermissionTargetRoleEnum {
  COMPANY_MANAGER = 'COMPANY_MANAGER',
  GROUP_MANAGER = 'GROUP_MANAGER',
}

export class PermissionMatrixRowDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  code: string;

  @ApiProperty()
  name: string;

  @ApiProperty()
  category: string;

  @ApiPropertyOptional()
  description?: string;

  @ApiProperty({ description: '현재 대상 역할 기준 활성 여부' })
  enabled: boolean;

  @ApiProperty({ description: '현재 사용자가 이 권한을 대상 역할에 부여할 수 있는지 여부' })
  assignable: boolean;

  @ApiPropertyOptional()
  lastModified?: Date;

  @ApiPropertyOptional()
  modifiedBy?: string;
}

export class PermissionMatrixResponseDto {
  @ApiPropertyOptional({ description: '현재 편집/조회 중인 회사 ID' })
  scopeOrganizationId?: string;

  @ApiPropertyOptional({ description: '현재 편집/조회 중인 회사명' })
  scopeOrganizationName?: string;

  @ApiProperty({ enum: PermissionTargetRoleEnum })
  targetRole: PermissionTargetRoleEnum;

  @ApiProperty({ description: '현재 사용자가 수정 가능한지 여부' })
  canEdit: boolean;

  @ApiProperty({ type: [PermissionMatrixRowDto] })
  data: PermissionMatrixRowDto[];

  @ApiProperty()
  total: number;

  @ApiProperty()
  page: number;

  @ApiProperty()
  limit: number;

  @ApiProperty()
  totalPages: number;
}

export class EffectivePermissionsResponseDto {
  @ApiProperty({ enum: PermissionActorTypeEnum })
  actorType: PermissionActorTypeEnum;

  @ApiProperty({ type: [String] })
  codes: string[];

  @ApiPropertyOptional()
  companyOrganizationId?: string;

  @ApiPropertyOptional()
  companyOrganizationName?: string;

  @ApiPropertyOptional({ description: '현재 적용 중인 커스텀 역할 ID(그룹 담당자 한정)' })
  companyRoleId?: string;

  @ApiPropertyOptional({ description: '현재 적용 중인 커스텀 역할명(그룹 담당자 한정)' })
  companyRoleName?: string;
}

// ============ 커스텀 역할(Company Role) DTOs ============

export class RoleAssignablePermissionDto {
  @ApiProperty()
  code: string;

  @ApiProperty()
  name: string;

  @ApiProperty()
  category: string;

  @ApiPropertyOptional()
  description?: string;

  @ApiProperty({ description: '그룹 담당자 기본 권한(천장)에 포함되어 역할에 부여 가능한지 여부' })
  assignable: boolean;
}

export class CompanyRoleDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  name: string;

  @ApiPropertyOptional()
  description?: string;

  @ApiProperty()
  isActive: boolean;

  @ApiProperty({ type: [String], description: '역할에 부여된 권한 코드(저장값)' })
  permissionCodes: string[];

  @ApiProperty({ description: '현재 그룹 기본 권한과 교집합된 실효 권한 수' })
  effectivePermissionCount: number;

  @ApiProperty({ description: '상위 권한에서 차단되어 동작하지 않는 권한 수' })
  blockedPermissionCount: number;

  @ApiProperty({ description: '이 역할을 배정받은 그룹 담당자 계정 수' })
  assignedAccountCount: number;

  @ApiPropertyOptional()
  updatedAt?: Date;

  @ApiPropertyOptional()
  modifiedBy?: string;
}

export class CompanyRoleListResponseDto {
  @ApiPropertyOptional()
  scopeOrganizationId?: string;

  @ApiPropertyOptional()
  scopeOrganizationName?: string;

  @ApiProperty()
  canEdit: boolean;

  @ApiProperty({ type: [RoleAssignablePermissionDto], description: '역할에 부여 가능한 권한 카탈로그(천장 표시 포함)' })
  assignablePermissions: RoleAssignablePermissionDto[];

  @ApiProperty({ type: [CompanyRoleDto] })
  roles: CompanyRoleDto[];
}

export class CreateCompanyRoleDto {
  @ApiProperty({ description: '역할 이름' })
  @IsString()
  name: string;

  @ApiPropertyOptional({ description: '역할 설명' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({ type: [String], description: '부여할 권한 코드 목록' })
  @IsArray()
  @IsString({ each: true })
  permissionCodes: string[];

  @ApiPropertyOptional({ description: '활성 여부', default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ description: '대상 회사 조직 ID(슈퍼관리자 전용)' })
  @IsOptional()
  @IsString()
  organizationId?: string;
}

export class UpdateCompanyRoleDto {
  @ApiPropertyOptional({ description: '역할 이름' })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({ description: '역할 설명' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ type: [String], description: '부여할 권한 코드 목록' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  permissionCodes?: string[];

  @ApiPropertyOptional({ description: '활성 여부' })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ description: '대상 회사 조직 ID(슈퍼관리자 전용)' })
  @IsOptional()
  @IsString()
  organizationId?: string;
}

export class UpdateCompanyPermissionDto {
  @ApiProperty({ description: '활성 여부' })
  @IsBoolean()
  enabled: boolean;

  @ApiPropertyOptional({ description: '대상 회사/조직 ID' })
  @IsOptional()
  @IsString()
  organizationId?: string;

  @ApiPropertyOptional({ description: '권한 적용 대상 역할', enum: PermissionTargetRoleEnum })
  @IsOptional()
  @IsEnum(PermissionTargetRoleEnum)
  targetRole?: PermissionTargetRoleEnum;
}

export class BulkUpdateCompanyPermissionItemDto extends UpdateCompanyPermissionDto {
  @ApiProperty({ description: '권한 ID 또는 코드' })
  @IsString()
  permissionId: string;
}

export class BulkUpdateCompanyPermissionsDto {
  @ApiProperty({ type: [BulkUpdateCompanyPermissionItemDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BulkUpdateCompanyPermissionItemDto)
  updates: BulkUpdateCompanyPermissionItemDto[];
}

export class UpdateCompanyPermissionResultDto {
  @ApiProperty()
  success: boolean;

  @ApiProperty()
  changed: boolean;

  @ApiProperty()
  enabled: boolean;

  @ApiPropertyOptional()
  lastModified?: Date;

  @ApiPropertyOptional()
  modifiedBy?: string;
}

export class BulkUpdateCompanyPermissionsResultDto {
  @ApiProperty()
  success: boolean;

  @ApiProperty()
  updated: number;
}