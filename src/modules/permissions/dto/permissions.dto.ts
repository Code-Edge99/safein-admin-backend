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