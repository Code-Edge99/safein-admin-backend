import { IsString, IsNotEmpty, IsOptional, IsBoolean, IsEnum } from 'class-validator';
import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { normalizeOptionalPhoneNumber } from '../../../common/utils/phone.util';

export enum OrganizationClassificationEnum {
  ADMIN = 'ADMIN',
  COMPANY = 'COMPANY',
  GROUP = 'GROUP',
  UNIT = 'UNIT',
}

export enum CreateOrganizationNodeTypeEnum {
  GROUP = 'GROUP',
  UNIT = 'UNIT',
}

export class CreateOrganizationDto {
  @ApiProperty({ description: '현장명' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiPropertyOptional({ description: '상위 현장 ID' })
  @IsOptional()
  @IsString()
  parentId?: string;

  @ApiPropertyOptional({
    description: '생성할 하위 현장 유형 (GROUP: 그룹, UNIT: 단위)',
    enum: CreateOrganizationNodeTypeEnum,
    default: CreateOrganizationNodeTypeEnum.UNIT,
  })
  @IsOptional()
  @IsEnum(CreateOrganizationNodeTypeEnum)
  nodeType?: CreateOrganizationNodeTypeEnum;

  @ApiPropertyOptional({ description: '주소' })
  @IsOptional()
  @IsString()
  address?: string;

  @ApiPropertyOptional({ description: '상세 주소' })
  @IsOptional()
  @IsString()
  detailAddress?: string;

  @ApiPropertyOptional({ description: '설명' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ description: '현장 담당자명' })
  @IsOptional()
  @IsString()
  managerName?: string;

  @ApiPropertyOptional({ description: '현장 담당자 연락처' })
  @IsOptional()
  @Transform(({ value }) => normalizeOptionalPhoneNumber(value))
  @IsString()
  managerPhone?: string;

  @ApiPropertyOptional({ description: '비상 연락처' })
  @IsOptional()
  @IsString()
  emergencyContact?: string;

  @ApiPropertyOptional({ description: '활성 상태', default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateOrganizationDto extends PartialType(CreateOrganizationDto) {}

export class OrganizationResponseDto {
  @ApiProperty({ description: '현장 ID' })
  id: string;

  @ApiProperty({ description: '현장명' })
  name: string;

  @ApiProperty({
    description: '현장 분류 (관리자/회사/그룹/단위)',
    enum: OrganizationClassificationEnum,
  })
  classification: OrganizationClassificationEnum;

  @ApiPropertyOptional({ description: '상위 현장 ID' })
  parentId: string | null;

  @ApiPropertyOptional({ description: '주소' })
  address?: string;

  @ApiPropertyOptional({ description: '상세 주소' })
  detailAddress?: string;

  @ApiPropertyOptional({ description: '설명' })
  description?: string;

  @ApiPropertyOptional({ description: '현장 담당자명' })
  managerName?: string;

  @ApiPropertyOptional({ description: '현장 담당자 연락처' })
  managerPhone?: string;

  @ApiPropertyOptional({ description: '비상 연락처' })
  emergencyContact?: string;

  @ApiPropertyOptional({ description: '단위 현장 팀코드 (5자리 대문자/숫자)' })
  teamCode?: string | null;

  @ApiProperty({ description: '활성 상태' })
  isActive: boolean;

  @ApiPropertyOptional({ description: '생성자 계정 ID' })
  createdById?: string;

  @ApiPropertyOptional({ description: '수정자 계정 ID' })
  updatedById?: string;

  @ApiPropertyOptional({ description: '생성자 이름' })
  createdByName?: string;

  @ApiPropertyOptional({ description: '수정자 이름' })
  updatedByName?: string;

  @ApiProperty({ description: '직원 수' })
  employeeCount: number;

  @ApiProperty({ description: '생성일시' })
  createdAt: Date;

  @ApiProperty({ description: '수정일시' })
  updatedAt: Date;
}

export class OrganizationTreeDto extends OrganizationResponseDto {
  @ApiPropertyOptional({ description: '하위 현장 목록', type: [OrganizationTreeDto] })
  children?: OrganizationTreeDto[];

  @ApiPropertyOptional({ description: '장치 수' })
  deviceCount?: number;
}

export class OrganizationStatsDto {
  @ApiProperty({ description: '현장 ID' })
  organizationId: string;

  @ApiProperty({ description: '현장명' })
  organizationName: string;

  @ApiProperty({ description: '총 직원 수' })
  totalEmployees: number;

  @ApiProperty({ description: '활성 장치 수' })
  activeDevices: number;

  @ApiProperty({ description: '총 장치 수' })
  totalDevices: number;

  @ApiProperty({ description: '하위 현장 수' })
  childOrganizations: number;
}

export class TransferResourcesDto {
  @ApiProperty({ description: '이관 대상 현장 ID' })
  @IsString()
  @IsNotEmpty()
  targetOrganizationId: string;
}

export class TransferResourcesResultDto {
  @ApiProperty({ description: '이관된 직원 수' })
  employees: number;
}
