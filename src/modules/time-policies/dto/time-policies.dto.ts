import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsEnum,
  IsNumber,
  IsBoolean,
  IsArray,
  ValidateNested,
  Min,
  Max,
} from 'class-validator';
import { Type } from 'class-transformer';

export enum DayOfWeek {
  MONDAY = 'MONDAY',
  TUESDAY = 'TUESDAY',
  WEDNESDAY = 'WEDNESDAY',
  THURSDAY = 'THURSDAY',
  FRIDAY = 'FRIDAY',
  SATURDAY = 'SATURDAY',
  SUNDAY = 'SUNDAY',
}

export enum TimePolicyStatus {
  ACTIVE = 'ACTIVE',
  INACTIVE = 'INACTIVE',
}

export class TimeSlotDto {
  @ApiProperty({ description: '시작 시간 (HH:MM 형식)', example: '09:00' })
  @IsString()
  startTime: string;

  @ApiProperty({ description: '종료 시간 (HH:MM 형식)', example: '18:00' })
  @IsString()
  endTime: string;

  @ApiProperty({ description: '적용 요일', enum: DayOfWeek, isArray: true })
  @IsArray()
  @IsEnum(DayOfWeek, { each: true })
  days: DayOfWeek[];
}

export class ExcludePeriodDto {
  @ApiProperty({ description: '예외시간 이름', example: '점심시간' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({ description: '시작 시간 (HH:MM 형식)', example: '12:00' })
  @IsString()
  start: string;

  @ApiProperty({ description: '종료 시간 (HH:MM 형식)', example: '13:00' })
  @IsString()
  end: string;
}

export class ExcludePeriodResponseDto {
  @ApiProperty({ description: '예외시간 ID' })
  id: string;

  @ApiProperty({ description: '예외시간 이름', example: '점심시간' })
  name: string;

  @ApiProperty({ description: '시작 시간 (HH:MM 형식)', example: '12:00' })
  start: string;

  @ApiProperty({ description: '종료 시간 (HH:MM 형식)', example: '13:00' })
  end: string;
}

export class CreateTimePolicyDto {
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

  @ApiPropertyOptional({ description: '작업 유형 ID (선택)' })
  @IsString()
  @IsOptional()
  workTypeId?: string;

  @ApiProperty({ description: '시간대 규칙', type: [TimeSlotDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TimeSlotDto)
  timeSlots: TimeSlotDto[];

  @ApiPropertyOptional({ description: '예외시간 목록', type: [ExcludePeriodDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ExcludePeriodDto)
  @IsOptional()
  excludePeriods?: ExcludePeriodDto[];

  @ApiPropertyOptional({ description: '우선순위 (낮을수록 높음)', default: 0 })
  @IsNumber()
  @Min(0)
  @Max(100)
  @IsOptional()
  priority?: number;

  @ApiPropertyOptional({ description: '시간대 외 제어 허용', default: false })
  @IsBoolean()
  @IsOptional()
  allowOutsideHours?: boolean;

  @ApiPropertyOptional({ description: '상태', enum: TimePolicyStatus, default: TimePolicyStatus.ACTIVE })
  @IsEnum(TimePolicyStatus)
  @IsOptional()
  status?: TimePolicyStatus;
}

export class UpdateTimePolicyDto extends PartialType(CreateTimePolicyDto) {}

export class TimePolicyResponseDto {
  @ApiProperty({ description: '정책 ID' })
  id: string;

  @ApiProperty({ description: '정책명' })
  name: string;

  @ApiPropertyOptional({ description: '설명' })
  description?: string;

  @ApiProperty({ description: '시간대 규칙' })
  timeSlots: TimeSlotDto[];

  @ApiProperty({ description: '우선순위' })
  priority: number;

  @ApiProperty({ description: '시간대 외 제어 허용' })
  allowOutsideHours: boolean;

  @ApiProperty({ description: '상태' })
  status: string;

  @ApiPropertyOptional({ description: '조직 정보' })
  organization?: {
    id: string;
    name: string;
  };

  @ApiPropertyOptional({ description: '예외시간 목록', type: [ExcludePeriodResponseDto] })
  excludePeriods?: ExcludePeriodResponseDto[];

  @ApiPropertyOptional({ description: '작업 유형 정보' })
  workType?: {
    id: string;
    name: string;
  };

  @ApiProperty({ description: '적용 직원 수' })
  affectedEmployeeCount: number;

  @ApiProperty({ description: '생성일시' })
  createdAt: Date;

  @ApiProperty({ description: '수정일시' })
  updatedAt: Date;
}

export class TimePolicyFilterDto {
  @ApiPropertyOptional({ description: '검색어 (이름)' })
  @IsString()
  @IsOptional()
  search?: string;

  @ApiPropertyOptional({ description: '조직 ID' })
  @IsString()
  @IsOptional()
  organizationId?: string;

  @ApiPropertyOptional({ description: '작업 유형 ID' })
  @IsString()
  @IsOptional()
  workTypeId?: string;

  @ApiPropertyOptional({ description: '상태', enum: TimePolicyStatus })
  @IsEnum(TimePolicyStatus)
  @IsOptional()
  status?: TimePolicyStatus;

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

export class TimePolicyListResponseDto {
  @ApiProperty({ type: [TimePolicyResponseDto] })
  data: TimePolicyResponseDto[];

  @ApiProperty()
  total: number;

  @ApiProperty()
  page: number;

  @ApiProperty()
  limit: number;

  @ApiProperty()
  totalPages: number;
}

export class CheckTimeActiveDto {
  @ApiPropertyOptional({ description: '확인할 시간 (ISO 형식, 미지정시 현재 시간)' })
  @IsOptional()
  @IsString()
  checkTime?: string;

  @ApiPropertyOptional({ description: '직원 ID' })
  @IsOptional()
  @IsString()
  employeeId?: string;

  @ApiPropertyOptional({ description: '작업 유형 ID' })
  @IsOptional()
  @IsString()
  workTypeId?: string;
}

export class TimePolicyStatsDto {
  @ApiProperty({ description: '전체 시간 정책 수' })
  totalPolicies: number;

  @ApiProperty({ description: '활성 정책 수' })
  activePolicies: number;

  @ApiProperty({ description: '조직별 정책 수' })
  byOrganization: Record<string, number>;
}
