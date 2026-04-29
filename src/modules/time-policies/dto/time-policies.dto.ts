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
  ValidateIf,
  Matches,
} from 'class-validator';
import { Type } from 'class-transformer';

const TIME_ONLY_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

export enum DayOfWeek {
  MONDAY = 'MONDAY',
  TUESDAY = 'TUESDAY',
  WEDNESDAY = 'WEDNESDAY',
  THURSDAY = 'THURSDAY',
  FRIDAY = 'FRIDAY',
  SATURDAY = 'SATURDAY',
  SUNDAY = 'SUNDAY',
}

export class TimeSlotDto {
  @ApiProperty({ description: '시작 시간 (HH:MM 형식)', example: '09:00' })
  @IsString()
  @Matches(TIME_ONLY_PATTERN, { message: '시작 시간은 HH:MM 형식이어야 합니다.' })
  startTime: string;

  @ApiProperty({ description: '종료 시간 (HH:MM 형식)', example: '18:00' })
  @IsString()
  @Matches(TIME_ONLY_PATTERN, { message: '종료 시간은 HH:MM 형식이어야 합니다.' })
  endTime: string;

  @ApiProperty({ description: '적용 요일', enum: DayOfWeek, isArray: true })
  @IsArray()
  @IsEnum(DayOfWeek, { each: true })
  days: DayOfWeek[];
}

export class ExcludePeriodDto {
  @ApiProperty({ description: '예외시간 사유', example: '점심시간' })
  @IsString()
  @IsNotEmpty()
  reason: string;

  @ApiPropertyOptional({ description: '시작 시간 (HH:MM 형식)', example: '12:00' })
  @ValidateIf((value: ExcludePeriodDto) => !value.startTime)
  @IsString()
  @Matches(TIME_ONLY_PATTERN, { message: '예외 시작 시간은 HH:MM 형식이어야 합니다.' })
  start?: string;

  @ApiPropertyOptional({ description: '시작 시간 별칭 (HH:MM 형식)', example: '12:00' })
  @ValidateIf((value: ExcludePeriodDto) => !value.start)
  @IsString()
  @Matches(TIME_ONLY_PATTERN, { message: '예외 시작 시간은 HH:MM 형식이어야 합니다.' })
  startTime?: string;

  @ApiPropertyOptional({ description: '종료 시간 (HH:MM 형식)', example: '13:00' })
  @ValidateIf((value: ExcludePeriodDto) => !value.endTime)
  @IsString()
  @Matches(TIME_ONLY_PATTERN, { message: '예외 종료 시간은 HH:MM 형식이어야 합니다.' })
  end?: string;

  @ApiPropertyOptional({ description: '종료 시간 별칭 (HH:MM 형식)', example: '13:00' })
  @ValidateIf((value: ExcludePeriodDto) => !value.end)
  @IsString()
  @Matches(TIME_ONLY_PATTERN, { message: '예외 종료 시간은 HH:MM 형식이어야 합니다.' })
  endTime?: string;
}

export class ExcludePeriodResponseDto {
  @ApiProperty({ description: '예외시간 ID' })
  id: string;

  @ApiProperty({ description: '예외시간 사유', example: '점심시간' })
  reason: string;

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

  @ApiProperty({ description: '현장 ID' })
  @IsString()
  @IsNotEmpty()
  organizationId: string;

  @ApiProperty({ description: '시간대 규칙', type: [TimeSlotDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TimeSlotDto)
  timeSlots: TimeSlotDto[];

  @ApiPropertyOptional({ description: '시작 시간 레거시 필드(HH:MM). timeSlots 미사용 시 허용' })
  @IsString()
  @Matches(TIME_ONLY_PATTERN, { message: '시작 시간은 HH:MM 형식이어야 합니다.' })
  @IsOptional()
  startTime?: string;

  @ApiPropertyOptional({ description: '종료 시간 레거시 필드(HH:MM). timeSlots 미사용 시 허용' })
  @IsString()
  @Matches(TIME_ONLY_PATTERN, { message: '종료 시간은 HH:MM 형식이어야 합니다.' })
  @IsOptional()
  endTime?: string;

  @ApiPropertyOptional({ description: '적용 요일 레거시 필드. timeSlots 미사용 시 허용', enum: DayOfWeek, isArray: true })
  @IsArray()
  @IsEnum(DayOfWeek, { each: true })
  @IsOptional()
  days?: DayOfWeek[];

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

  @ApiPropertyOptional({ description: '현장 정보' })
  organization?: {
    id: string;
    name: string;
  };

  @ApiPropertyOptional({ description: '예외시간 목록', type: [ExcludePeriodResponseDto] })
  excludePeriods?: ExcludePeriodResponseDto[];

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

  @ApiPropertyOptional({ description: '현장 ID' })
  @IsString()
  @IsOptional()
  organizationId?: string;

  @ApiPropertyOptional({ description: '정책 생성용 상위 owner 현장(회사/그룹/팀)까지 함께 포함할지 여부' })
  @IsOptional()
  @Type(() => Boolean)
  includePolicySourceOrganizations?: boolean;

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
}

export class TimePolicyStatsDto {
  @ApiProperty({ description: '전체 시간 정책 수' })
  totalPolicies: number;

  @ApiProperty({ description: '활성 정책 수' })
  activePolicies: number;

  @ApiProperty({ description: '현장별 정책 수' })
  byOrganization: Record<string, number>;
}
