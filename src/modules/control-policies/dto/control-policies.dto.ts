import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsNumber,
  IsBoolean,
  IsArray,
  ArrayMaxSize,
  Min,
  Max,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CreateControlPolicyDto {
  @ApiProperty({ description: '정책명' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiPropertyOptional({ description: '설명' })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiProperty({ description: '조직 ID' })
  @IsString()
  @IsNotEmpty()
  organizationId: string;

  @ApiPropertyOptional({ description: '우선순위 (1-100, 낮을수록 높음)', default: 1 })
  @IsNumber()
  @Min(1)
  @Max(100)
  @IsOptional()
  priority?: number;

  @ApiPropertyOptional({ description: '적용 구역 ID 목록' })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  zoneIds?: string[];

  @ApiPropertyOptional({ description: '적용 시간 정책 ID 목록' })
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(1)
  @IsOptional()
  timePolicyIds?: string[];

  @ApiPropertyOptional({ description: '적용 행동 조건 ID 목록' })
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(1)
  @IsOptional()
  behaviorConditionIds?: string[];

  @ApiPropertyOptional({ description: '적용 허용앱 프리셋 ID 목록' })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  allowedAppPresetIds?: string[];

  @ApiPropertyOptional({ description: '적용 대상 직원 ID 목록 (빈 배열시 전체 적용)' })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  employeeIds?: string[];

  @ApiPropertyOptional({ description: '활성 상태', default: true })
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}

export class UpdateControlPolicyDto extends PartialType(CreateControlPolicyDto) {}

export class ControlPolicyResponseDto {
  @ApiProperty({ description: '정책 ID' })
  id: string;

  @ApiProperty({ description: '정책명' })
  name: string;

  @ApiPropertyOptional({ description: '설명' })
  description?: string;

  @ApiProperty({ description: '우선순위' })
  priority: number;

  @ApiProperty({ description: '활성 상태' })
  isActive: boolean;

  @ApiProperty({
    description: '정책 상태',
    enum: ['ACTIVE', 'INACTIVE', 'REVIEW_REQUIRED'],
  })
  policyStatus: 'ACTIVE' | 'INACTIVE' | 'REVIEW_REQUIRED';

  @ApiProperty({ description: '정책 적용 여부 (필수 조건 충족 + 활성 상태)' })
  policyApplied: boolean;

  @ApiProperty({
    description: '누락된 필수 조건 목록',
    enum: ['ZONE', 'TIME_POLICY'],
    isArray: true,
  })
  missingRequiredConditions: Array<'ZONE' | 'TIME_POLICY'>;

  @ApiPropertyOptional({ description: '누락 필수 조건 안내 메시지', type: [String] })
  missingRequiredConditionMessages?: string[];

  @ApiPropertyOptional({ description: '조직 정보' })
  organization?: {
    id: string;
    name: string;
  };

  @ApiProperty({ description: '적용 구역 수' })
  zoneCount: number;

  @ApiProperty({ description: '적용 시간 정책 수' })
  timePolicyCount: number;

  @ApiProperty({ description: '적용 행동 조건 수' })
  behaviorConditionCount: number;

  @ApiProperty({ description: '적용 허용앱 프리셋 수' })
  allowedAppCount: number;

  @ApiProperty({ description: '적용 대상 직원 수' })
  targetEmployeeCount: number;

  @ApiPropertyOptional({ description: '적용 구역 목록' })
  zones?: { id: string; name: string; type?: string }[];

  @ApiPropertyOptional({ description: '적용 시간 정책 목록' })
  timePolicies?: { id: string; name: string }[];

  @ApiPropertyOptional({ description: '적용 행동 조건 목록' })
  behaviorConditions?: { id: string; name: string; type?: string }[];

  @ApiPropertyOptional({ description: '적용 허용앱 프리셋 목록' })
  allowedAppPresets?: {
    id: string;
    name: string;
    apps?: {
      id: string;
      name: string;
      packageName: string;
      iconUrl?: string;
    }[];
  }[];

  @ApiProperty({ description: '생성일시' })
  createdAt: Date;

  @ApiProperty({ description: '수정일시' })
  updatedAt: Date;
}

export class ControlPolicyDetailDto extends ControlPolicyResponseDto {
  @ApiProperty({ description: '적용 구역 목록' })
  zones: { id: string; name: string; type: string }[];

  @ApiProperty({ description: '적용 시간 정책 목록' })
  timePolicies: { id: string; name: string }[];

  @ApiProperty({ description: '적용 행동 조건 목록' })
  behaviorConditions: { id: string; name: string; type: string }[];

  @ApiProperty({ description: '적용 허용앱 프리셋 목록' })
  allowedAppPresets: {
    id: string;
    name: string;
    apps?: {
      id: string;
      name: string;
      packageName: string;
      iconUrl?: string;
    }[];
  }[];

  @ApiProperty({ description: '적용 대상 직원 목록' })
  targetEmployees: { id: string; name: string }[];
}

export class ControlPolicyFilterDto {
  @ApiPropertyOptional({ description: '검색어 (이름)' })
  @IsString()
  @IsOptional()
  search?: string;

  @ApiPropertyOptional({ description: '조직 ID' })
  @IsString()
  @IsOptional()
  organizationId?: string;

  @ApiPropertyOptional({ description: '활성 상태' })
  @IsOptional()
  isActive?: boolean;

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

export class ControlPolicyListResponseDto {
  @ApiProperty({ type: [ControlPolicyResponseDto] })
  data: ControlPolicyResponseDto[];

  @ApiProperty()
  total: number;

  @ApiProperty()
  page: number;

  @ApiProperty()
  limit: number;

  @ApiProperty()
  totalPages: number;
}

export class AssignZonesDto {
  @ApiProperty({ description: '구역 ID 목록' })
  @IsArray()
  @IsString({ each: true })
  zoneIds: string[];
}

export class AssignTimePoliciesDto {
  @ApiProperty({ description: '시간 정책 ID 목록' })
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(1)
  timePolicyIds: string[];
}

export class AssignBehaviorConditionsDto {
  @ApiProperty({ description: '행동 조건 ID 목록' })
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(1)
  behaviorConditionIds: string[];
}

export class AssignAllowedAppsDto {
  @ApiProperty({ description: '허용앱 프리셋 ID 목록' })
  @IsArray()
  @IsString({ each: true })
  allowedAppPresetIds: string[];
}

export class AssignEmployeesDto {
  @ApiProperty({ description: '직원 ID 목록' })
  @IsArray()
  @IsString({ each: true })
  employeeIds: string[];
}

export class BulkControlPolicyActionDto {
  @ApiProperty({ description: '정책 ID 목록' })
  @IsArray()
  @IsString({ each: true })
  policyIds: string[];
}

export class BulkControlPolicyStatusUpdateDto extends BulkControlPolicyActionDto {
  @ApiProperty({ description: '활성 여부' })
  @IsBoolean()
  isActive: boolean;
}

export class DispatchPolicyChangedDto {
  @ApiPropertyOptional({
    description: '정책 ID 목록 (전달 시 이 목록을 우선 대상으로 사용)',
    example: ['1f6f0b2e-5bb1-4c07-a6cb-3d7d9f0d1f20'],
  })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  policyIds?: string[];

  @ApiPropertyOptional({
    description: '조직 ID 필터 (policyIds 미전달 시 대상 정책 조회 조건)',
    example: '7af0eb0a-7f4f-4f5f-8157-2c1d2411d1a9',
  })
  @IsString()
  @IsOptional()
  organizationId?: string;

  @ApiPropertyOptional({
    description: '트리거 타입 (deactivate는 비활성 정책도 포함해서 해제 알림 전송)',
    enum: ['create', 'activate', 'update', 'deactivate'],
    default: 'update',
    example: 'update',
  })
  @IsString()
  @IsOptional()
  trigger?: 'create' | 'activate' | 'update' | 'deactivate';
}

export class ControlPolicyStatsDto {
  @ApiProperty({ description: '전체 정책 수' })
  totalPolicies: number;

  @ApiProperty({ description: '활성 정책 수' })
  activePolicies: number;

  @ApiProperty({ description: '조직별 정책 수' })
  byOrganization: Record<string, number>;
}
