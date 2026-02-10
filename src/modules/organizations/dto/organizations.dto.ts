import { IsString, IsNotEmpty, IsOptional, IsUUID, IsEnum, IsBoolean } from 'class-validator';
import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';

export enum OrganizationType {
  COMPANY = 'company',
  SITE = 'site',
  FIELD = 'field',
  DEPARTMENT = 'department',
  TEAM = 'team',
}

export class CreateOrganizationDto {
  @ApiProperty({ description: '조직명' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({ description: '조직 유형', enum: OrganizationType })
  @IsEnum(OrganizationType)
  type: OrganizationType;

  @ApiPropertyOptional({ description: '상위 조직 ID' })
  @IsOptional()
  @IsUUID()
  parentId?: string;

  @ApiPropertyOptional({ description: '활성 상태', default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateOrganizationDto extends PartialType(CreateOrganizationDto) {}

export class OrganizationResponseDto {
  @ApiProperty({ description: '조직 ID' })
  id: string;

  @ApiProperty({ description: '조직명' })
  name: string;

  @ApiProperty({ description: '조직 유형' })
  type: string;

  @ApiPropertyOptional({ description: '상위 조직 ID' })
  parentId: string | null;

  @ApiProperty({ description: '활성 상태' })
  isActive: boolean;

  @ApiProperty({ description: '직원 수' })
  employeeCount: number;

  @ApiProperty({ description: '생성일시' })
  createdAt: Date;

  @ApiProperty({ description: '수정일시' })
  updatedAt: Date;
}

export class OrganizationTreeDto extends OrganizationResponseDto {
  @ApiPropertyOptional({ description: '하위 조직 목록', type: [OrganizationTreeDto] })
  children?: OrganizationTreeDto[];

  @ApiPropertyOptional({ description: '장치 수' })
  deviceCount?: number;
}

export class OrganizationStatsDto {
  @ApiProperty({ description: '조직 ID' })
  organizationId: string;

  @ApiProperty({ description: '조직명' })
  organizationName: string;

  @ApiProperty({ description: '총 직원 수' })
  totalEmployees: number;

  @ApiProperty({ description: '활성 장치 수' })
  activeDevices: number;

  @ApiProperty({ description: '총 장치 수' })
  totalDevices: number;

  @ApiProperty({ description: '하위 조직 수' })
  childOrganizations: number;
}
