import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsEnum,
  IsNumber,
  IsDateString,
  Matches,
} from 'class-validator';
import { Type } from 'class-transformer';

const UTC_TIMESTAMP_PATTERN = /(Z|[+-]00:00|[+-]0000)$/i;

export enum ControlLogTypeEnum {
  BEHAVIOR = 'behavior',
  APP_CONTROL = 'app_control',
}

export enum ControlLogActionEnum {
  BLOCKED = 'blocked',
  ALLOWED = 'allowed',
}

export class CreateControlLogDto {
  @ApiProperty({ description: '직원 ID' })
  @IsString()
  @IsNotEmpty()
  employeeId!: string;

  @ApiProperty({ description: '디바이스 ID' })
  @IsString()
  @IsNotEmpty()
  deviceId!: string;

  @ApiPropertyOptional({ description: '정책 ID' })
  @IsString()
  @IsOptional()
  policyId?: string;

  @ApiPropertyOptional({ description: '구역 ID' })
  @IsString()
  @IsOptional()
  zoneId?: string;

  @ApiProperty({ description: '로그 유형', enum: ControlLogTypeEnum })
  @IsEnum(ControlLogTypeEnum)
  type!: ControlLogTypeEnum;

  @ApiProperty({ description: '동작', enum: ControlLogActionEnum })
  @IsEnum(ControlLogActionEnum)
  action!: ControlLogActionEnum;

  @ApiProperty({ description: '발생 시간' })
  @IsDateString()
  @Matches(UTC_TIMESTAMP_PATTERN, {
    message: 'timestamp는 UTC 기준 ISO 8601 날짜 형식이어야 합니다. (예: 2026-02-09T10:00:00.000Z)',
  })
  timestamp!: string;

  @ApiPropertyOptional({ description: '위도' })
  @IsNumber()
  @IsOptional()
  latitude?: number;

  @ApiPropertyOptional({ description: '경도' })
  @IsNumber()
  @IsOptional()
  longitude?: number;

  @ApiPropertyOptional({ description: '사유' })
  @IsString()
  @IsOptional()
  reason?: string;

  @ApiPropertyOptional({ description: '앱 이름 (앱 제어 대상)' })
  @IsString()
  @IsOptional()
  appName?: string;

  @ApiPropertyOptional({ description: '패키지 이름 (앱 제어 대상)' })
  @IsString()
  @IsOptional()
  packageName?: string;

  @ApiPropertyOptional({ description: '이동 거리 (행동 감지)' })
  @IsNumber()
  @IsOptional()
  behaviorDistance?: number;

  @ApiPropertyOptional({ description: '걸음 수 (행동 감지)' })
  @IsNumber()
  @IsOptional()
  behaviorSteps?: number;

  @ApiPropertyOptional({ description: '속도 (행동 감지)' })
  @IsNumber()
  @IsOptional()
  behaviorSpeed?: number;
}

export class ControlLogResponseDto {
  @ApiProperty({ description: '로그 ID' })
  id!: string;

  @ApiProperty({ description: '로그 유형' })
  type!: string;

  @ApiProperty({ description: '동작' })
  action!: string;

  @ApiProperty({ description: '발생 시간' })
  timestamp!: string;

  @ApiPropertyOptional({ description: '앱이 보낸 원본 발생 시각(UTC 기준 ISO 8601)' })
  originalTimestamp?: string;

  @ApiPropertyOptional({ description: '위도' })
  latitude?: number;

  @ApiPropertyOptional({ description: '경도' })
  longitude?: number;

  @ApiPropertyOptional({ description: '사유' })
  reason?: string;

  @ApiPropertyOptional({ description: '직원 정보' })
  employee?: {
    id: string;
    employeeId?: string;
    name: string;
    organizationId?: string;
    organizationName?: string;
  };

  @ApiPropertyOptional({ description: '앱 이름' })
  appName?: string;

  @ApiPropertyOptional({ description: '패키지 이름' })
  packageName?: string;

  @ApiPropertyOptional({ description: '이동 거리' })
  behaviorDistance?: number;

  @ApiPropertyOptional({ description: '걸음 수' })
  behaviorSteps?: number;

  @ApiPropertyOptional({ description: '속도' })
  behaviorSpeed?: number;

  @ApiPropertyOptional({ description: '디바이스 정보' })
  device?: {
    id: string;
    deviceId: string;
  };

  @ApiPropertyOptional({ description: '스냅샷 현장 ID' })
  organizationId?: string;

  @ApiPropertyOptional({ description: '스냅샷 현장명' })
  organizationName?: string;

  @ApiPropertyOptional({ description: '정책 정보' })
  policy?: {
    id: string;
    name: string;
  };

  @ApiPropertyOptional({ description: '구역 정보' })
  zone?: {
    id: string;
    name: string;
  };

  @ApiPropertyOptional({ description: '구역 ID(평면 필드)' })
  zoneId?: string;

  @ApiPropertyOptional({ description: '구역명(평면 필드)' })
  zoneName?: string;

  @ApiProperty({ description: '생성일시' })
  createdAt!: Date;
}

export class ControlLogFilterDto {
  @ApiPropertyOptional({ description: '검색어 (직원명/사유/앱명/패키지명/구역명/정책명)' })
  @IsString()
  @IsOptional()
  search?: string;

  @ApiPropertyOptional({ description: '현장 ID' })
  @IsString()
  @IsOptional()
  organizationId?: string;

  @ApiPropertyOptional({ description: '그룹 ID' })
  @IsString()
  @IsOptional()
  groupId?: string;

  @ApiPropertyOptional({ description: '단위 ID' })
  @IsString()
  @IsOptional()
  unitId?: string;

  @ApiPropertyOptional({ description: '직원 ID' })
  @IsString()
  @IsOptional()
  employeeId?: string;

  @ApiPropertyOptional({ description: '디바이스 ID' })
  @IsString()
  @IsOptional()
  deviceId?: string;

  @ApiPropertyOptional({ description: '정책 ID' })
  @IsString()
  @IsOptional()
  policyId?: string;

  @ApiPropertyOptional({ description: '구역 ID' })
  @IsString()
  @IsOptional()
  zoneId?: string;

  @ApiPropertyOptional({ description: '로그 유형', enum: ControlLogTypeEnum })
  @IsEnum(ControlLogTypeEnum)
  @IsOptional()
  type?: ControlLogTypeEnum;

  @ApiPropertyOptional({ description: '동작', enum: ControlLogActionEnum })
  @IsEnum(ControlLogActionEnum)
  @IsOptional()
  action?: ControlLogActionEnum;

  @ApiPropertyOptional({ description: '시작 날짜' })
  @IsDateString()
  @IsOptional()
  startDate?: string;

  @ApiPropertyOptional({ description: '종료 날짜' })
  @IsDateString()
  @IsOptional()
  endDate?: string;

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

export class ControlLogListResponseDto {
  @ApiProperty({ type: [ControlLogResponseDto] })
  data!: ControlLogResponseDto[];

  @ApiProperty()
  total!: number;

  @ApiProperty()
  page!: number;

  @ApiProperty()
  limit!: number;

  @ApiProperty()
  totalPages!: number;
}

export class ControlLogStatsDto {
  @ApiProperty({ description: '전체 로그 수' })
  totalLogs!: number;

  @ApiProperty({ description: '차단된 로그 수' })
  blockedCount!: number;

  @ApiProperty({ description: '허용된 로그 수' })
  allowedCount!: number;

  @ApiProperty({ description: '유형별 로그 수' })
  byType!: Record<string, number>;

  @ApiProperty({ description: '일별 로그 수 (최근 7일)' })
  dailyStats!: { date: string; count: number }[];
}

export class EmployeeLogStatsDto {
  @ApiProperty({ description: '직원 ID' })
  employeeId!: string;

  @ApiProperty({ description: '직원 이름' })
  employeeName!: string;

  @ApiProperty({ description: '전체 로그 수' })
  totalLogs!: number;

  @ApiProperty({ description: '차단 횟수' })
  blockedCount!: number;

  @ApiProperty({ description: '마지막 로그 시간' })
  lastLogAt?: Date;
}
