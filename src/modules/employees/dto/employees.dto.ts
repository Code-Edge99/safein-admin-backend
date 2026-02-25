import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsUUID,
  IsEmail,
  IsEnum,
  IsArray,
  IsDateString,
  Matches,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { BaseFilterDto } from '../../../common/dto';

export enum EmployeeStatusEnum {
  ACTIVE = 'ACTIVE',
  RESIGNED = 'RESIGNED',
  EXCEPTION = 'EXCEPTION',
  LEAVE = 'LEAVE',
}

export class CreateEmployeeDto {
  @ApiProperty({ description: '직원 ID (로그인 ID)' })
  @IsString()
  @IsNotEmpty()
  employeeCode: string;

  @ApiProperty({ description: '직원 이름' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({ description: '조직 ID' })
  @IsString()
  @IsNotEmpty()
  organizationId: string;

  @ApiProperty({ description: '현장 ID' })
  @IsString()
  @IsNotEmpty()
  siteId: string;

  @ApiPropertyOptional({ description: '직급/직책' })
  @IsOptional()
  @IsString()
  position?: string;

  @ApiPropertyOptional({ description: '역할' })
  @IsOptional()
  @IsString()
  role?: string;

  @ApiPropertyOptional({ description: '이메일' })
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiProperty({ description: '전화번호 (중복 불가, 필수)' })
  @IsString()
  @IsNotEmpty()
  @Matches(/^01[0-9]-?\d{3,4}-?\d{4}$/, {
    message: '전화번호 형식이 올바르지 않습니다. (예: 010-1234-5678)',
  })
  phone: string;

  @ApiPropertyOptional({ description: '근무 유형 ID' })
  @IsOptional()
  @IsString()
  workTypeId?: string;

  @ApiPropertyOptional({ description: '상태', enum: EmployeeStatusEnum, default: 'ACTIVE' })
  @IsOptional()
  @IsEnum(EmployeeStatusEnum)
  status?: EmployeeStatusEnum;

  @ApiPropertyOptional({ description: '입사일' })
  @IsOptional()
  @IsDateString()
  hireDate?: string;
}

export class UpdateEmployeeDto extends PartialType(CreateEmployeeDto) {
  @ApiPropertyOptional({ description: '새 비밀번호 (수정 시 선택)', minLength: 8 })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @Matches(/^.{8,}$/, {
    message: '새 비밀번호는 최소 8자 이상이어야 합니다.',
  })
  newPassword?: string;

  @ApiPropertyOptional({ description: '새 비밀번호 확인 (수정 시 선택)' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  confirmPassword?: string;
}

export class EmployeeResponseDto {
  @ApiProperty({ description: '직원 ID' })
  employeeId: string;

  @ApiPropertyOptional({ description: '직원 ID (호환 필드)' })
  employeeCode?: string;

  @ApiProperty({ description: '직원 이름' })
  name: string;

  @ApiProperty({ description: '조직 ID' })
  organizationId: string;

  @ApiPropertyOptional({ description: '조직명' })
  organizationName?: string;

  @ApiProperty({ description: '현장 ID' })
  siteId: string;

  @ApiPropertyOptional({ description: '현장명' })
  siteName?: string;

  @ApiPropertyOptional({ description: '직급/직책' })
  position?: string;

  @ApiPropertyOptional({ description: '역할' })
  role?: string;

  @ApiPropertyOptional({ description: '이메일' })
  email?: string;

  @ApiPropertyOptional({ description: '전화번호' })
  phone?: string;

  @ApiPropertyOptional({ description: '근무 유형 ID' })
  workTypeId?: string;

  @ApiPropertyOptional({ description: '근무 유형명' })
  workTypeName?: string;

  @ApiProperty({ description: '상태' })
  status: string;

  @ApiPropertyOptional({ description: '입사일' })
  hireDate?: Date;

  @ApiProperty({ description: '생성일시' })
  createdAt: Date;

  @ApiProperty({ description: '수정일시' })
  updatedAt: Date;
}

export class EmployeeDetailDto extends EmployeeResponseDto {
  @ApiPropertyOptional({ description: '장치 목록' })
  devices?: DeviceSummaryDto[];

  @ApiPropertyOptional({ description: '제외 설정 목록' })
  exclusions?: EmployeeExclusionDto[];
}

export class DeviceSummaryDto {
  @ApiProperty({ description: '장치 ID' })
  id: string;

  @ApiProperty({ description: '장치 식별자' })
  deviceId: string;

  @ApiProperty({ description: '장치 모델' })
  model: string;

  @ApiProperty({ description: 'OS 타입' })
  os: string;

  @ApiProperty({ description: '상태' })
  status: string;

  @ApiPropertyOptional({ description: '마지막 통신 시간' })
  lastCommunication?: Date;
}

export class EmployeeExclusionDto {
  @ApiProperty({ description: '제외 ID' })
  id: string;

  @ApiPropertyOptional({ description: '시작일' })
  startDate?: Date;

  @ApiPropertyOptional({ description: '종료일' })
  endDate?: Date;

  @ApiPropertyOptional({ description: '사유' })
  reason?: string;

  @ApiProperty({ description: '활성 상태' })
  isActive: boolean;
}

export class EmployeeFilterDto extends BaseFilterDto {
  @ApiPropertyOptional({ description: '근무 유형 ID' })
  @IsOptional()
  @IsUUID()
  workTypeId?: string;

  @ApiPropertyOptional({ description: '상태 필터', enum: EmployeeStatusEnum })
  @IsOptional()
  @IsEnum(EmployeeStatusEnum)
  status?: EmployeeStatusEnum;

  @ApiPropertyOptional({ description: '현장 ID' })
  @IsOptional()
  @IsUUID()
  siteId?: string;
}

export class BulkEmployeeActionDto {
  @ApiProperty({ description: '직원 ID 목록' })
  @IsArray()
  @IsUUID('4', { each: true })
  employeeIds: string[];
}

export class BulkAssignWorkTypeDto extends BulkEmployeeActionDto {
  @ApiProperty({ description: '근무 유형 ID' })
  @IsUUID()
  workTypeId: string;
}

export class BulkMoveOrganizationDto extends BulkEmployeeActionDto {
  @ApiProperty({ description: '대상 조직 ID' })
  @IsUUID()
  targetOrganizationId: string;
}
