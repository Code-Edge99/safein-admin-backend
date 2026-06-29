import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import {
  SafetyChecklistAssignmentStatus,
  SafetyChecklistDeploymentStatus,
  SafetyChecklistStatus,
  SafetyInspectionReviewStatus,
} from '@prisma/client';
import { PaginationDto } from '../../../common/dto';

function normalizeOptionalString(value: unknown): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  const trimmed = String(value).trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function normalizeOptionalBoolean(value: unknown): boolean | undefined {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }

  if (typeof value === 'boolean') {
    return value;
  }

  const normalized = String(value).trim().toLowerCase();
  if (['true', '1', 'yes', 'y', 'on'].includes(normalized)) {
    return true;
  }
  if (['false', '0', 'no', 'n', 'off'].includes(normalized)) {
    return false;
  }

  return value as boolean;
}

function parseStringArray(value: unknown): string[] {
  if (value === undefined || value === null || value === '') {
    return [];
  }

  if (Array.isArray(value)) {
    return value.map((entry) => String(entry ?? '').trim()).filter(Boolean);
  }

  const raw = String(value).trim();
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.map((entry) => String(entry ?? '').trim()).filter(Boolean);
    }
  } catch {
    // comma fallback below
  }

  return raw.split(',').map((entry) => entry.trim()).filter(Boolean);
}

export enum SafetyInspectionActionStatusFilter {
  NORMAL = 'NORMAL',
  ACTION_REQUIRED = 'ACTION_REQUIRED',
  NOT_SUBMITTED = 'NOT_SUBMITTED',
  ACTION_COMPLETED = 'ACTION_COMPLETED',
}

export class SafetyChecklistItemInputDto {
  @ApiPropertyOptional({ description: '점검 항목 분류', example: '추락 예방' })
  @Transform(({ value }) => normalizeOptionalString(value))
  @IsOptional()
  @IsString()
  @MaxLength(80)
  category?: string;

  @ApiProperty({ description: '점검 항목 질문', example: '작업구역 난간이 설치되어 있고 흔들림이 없습니다.' })
  @IsString()
  question!: string;

  @ApiPropertyOptional({ description: '작업자가 볼 수 있는 보조 설명', example: '작업 시작 전 개구부와 단부를 함께 확인합니다.' })
  @Transform(({ value }) => normalizeOptionalString(value))
  @IsOptional()
  @IsString()
  helpText?: string;

  @ApiPropertyOptional({ description: '필수 응답 여부', default: true })
  @IsOptional()
  @IsBoolean()
  required?: boolean;

  @ApiPropertyOptional({ description: '표시 순서', default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(1000)
  sortOrder?: number;
}

export class SafetyChecklistSectionInputDto {
  @ApiProperty({ description: '점검 구역 또는 섹션명', example: '작업 전 점검' })
  @IsString()
  @MaxLength(120)
  title!: string;

  @ApiPropertyOptional({ description: '섹션 설명' })
  @Transform(({ value }) => normalizeOptionalString(value))
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ description: '표시 순서', default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(1000)
  sortOrder?: number;

  @ApiProperty({ description: '섹션에 포함된 점검 항목 목록', type: [SafetyChecklistItemInputDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => SafetyChecklistItemInputDto)
  items!: SafetyChecklistItemInputDto[];
}

export class CreateSafetyChecklistDto {
  @ApiPropertyOptional({ description: '체크리스트를 소유할 조직 ID' })
  @Transform(({ value }) => normalizeOptionalString(value))
  @IsOptional()
  @IsString()
  organizationId?: string;

  @ApiProperty({ description: '체크리스트명', example: '고소작업 일일 안전점검' })
  @IsString()
  @MaxLength(200)
  title!: string;

  @ApiPropertyOptional({ description: '체크리스트 설명' })
  @Transform(({ value }) => normalizeOptionalString(value))
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ description: '업종 또는 현장 유형', example: '건설' })
  @Transform(({ value }) => normalizeOptionalString(value))
  @IsOptional()
  @IsString()
  @MaxLength(80)
  industry?: string;

  @ApiPropertyOptional({ description: '체크리스트 상태', enum: SafetyChecklistStatus, default: SafetyChecklistStatus.ACTIVE })
  @IsOptional()
  @IsEnum(SafetyChecklistStatus)
  status?: SafetyChecklistStatus;

  @ApiPropertyOptional({ description: '배포 시작일', example: '2026-06-24' })
  @Transform(({ value }) => normalizeOptionalString(value))
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  startDate?: string;

  @ApiPropertyOptional({ description: '배포 종료일', example: '2026-06-30' })
  @Transform(({ value }) => normalizeOptionalString(value))
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  endDate?: string;

  @ApiPropertyOptional({ description: '점검 시작 시각', example: '09:00' })
  @Transform(({ value }) => normalizeOptionalString(value))
  @IsOptional()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/)
  startTime?: string;

  @ApiPropertyOptional({ description: '점검 마감 시각', example: '17:30' })
  @Transform(({ value }) => normalizeOptionalString(value))
  @IsOptional()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/)
  endTime?: string;

  @ApiPropertyOptional({ description: '배포 대상 직원 ID 목록', type: [String] })
  @Transform(({ value }) => parseStringArray(value))
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  targetEmployeeIds?: string[];

  @ApiProperty({ description: '체크리스트 섹션과 항목 목록', type: [SafetyChecklistSectionInputDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => SafetyChecklistSectionInputDto)
  sections!: SafetyChecklistSectionInputDto[];
}

export class UpdateSafetyChecklistDto {
  @ApiPropertyOptional({ description: '체크리스트명', example: '고소작업 일일 안전점검' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;

  @ApiPropertyOptional({ description: '체크리스트 설명' })
  @Transform(({ value }) => normalizeOptionalString(value))
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ description: '업종 또는 현장 유형', example: '건설' })
  @Transform(({ value }) => normalizeOptionalString(value))
  @IsOptional()
  @IsString()
  @MaxLength(80)
  industry?: string;

  @ApiPropertyOptional({ description: '체크리스트 상태', enum: SafetyChecklistStatus })
  @IsOptional()
  @IsEnum(SafetyChecklistStatus)
  status?: SafetyChecklistStatus;

  @ApiPropertyOptional({ description: '배포 시작일', example: '2026-06-24' })
  @Transform(({ value }) => normalizeOptionalString(value))
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  startDate?: string;

  @ApiPropertyOptional({ description: '배포 종료일', example: '2026-06-30' })
  @Transform(({ value }) => normalizeOptionalString(value))
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  endDate?: string;

  @ApiPropertyOptional({ description: '점검 시작 시각', example: '09:00' })
  @Transform(({ value }) => normalizeOptionalString(value))
  @IsOptional()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/)
  startTime?: string;

  @ApiPropertyOptional({ description: '점검 마감 시각', example: '17:30' })
  @Transform(({ value }) => normalizeOptionalString(value))
  @IsOptional()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/)
  endTime?: string;

  @ApiPropertyOptional({ type: [String] })
  @Transform(({ value }) => parseStringArray(value))
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  targetEmployeeIds?: string[];

  @ApiPropertyOptional({ type: [SafetyChecklistSectionInputDto] })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => SafetyChecklistSectionInputDto)
  sections?: SafetyChecklistSectionInputDto[];
}

export class CreateSafetyChecklistDeploymentDto {
  @ApiProperty({ example: '2026-06-24' })
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  startDate!: string;

  @ApiPropertyOptional({ example: '2026-06-30' })
  @Transform(({ value }) => normalizeOptionalString(value))
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  endDate?: string;

  @ApiPropertyOptional({ example: '09:00' })
  @Transform(({ value }) => normalizeOptionalString(value))
  @IsOptional()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/)
  startTime?: string;

  @ApiPropertyOptional({ example: '17:30' })
  @Transform(({ value }) => normalizeOptionalString(value))
  @IsOptional()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/)
  endTime?: string;

  @ApiPropertyOptional({ type: [String] })
  @Transform(({ value }) => parseStringArray(value))
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  targetEmployeeIds?: string[];
}

export class SafetyChecklistFilterDto extends PaginationDto {
  @ApiPropertyOptional()
  @Transform(({ value }) => normalizeOptionalString(value))
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ enum: SafetyChecklistStatus })
  @IsOptional()
  @IsEnum(SafetyChecklistStatus)
  status?: SafetyChecklistStatus;

  @ApiPropertyOptional()
  @Transform(({ value }) => normalizeOptionalString(value))
  @IsOptional()
  @IsString()
  organizationId?: string;

  @ApiPropertyOptional({ description: '슈퍼관리자 회사 필터 ID' })
  @Transform(({ value }) => normalizeOptionalString(value))
  @IsOptional()
  @IsString()
  companyId?: string;
}

export class SafetyInspectionSubmissionFilterDto extends PaginationDto {
  @ApiPropertyOptional()
  @Transform(({ value }) => normalizeOptionalString(value))
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional()
  @Transform(({ value }) => normalizeOptionalString(value))
  @IsOptional()
  @IsString()
  checklistId?: string;

  @ApiPropertyOptional({ description: '제출 또는 배정된 작업자 이름 검색' })
  @Transform(({ value }) => normalizeOptionalString(value))
  @IsOptional()
  @IsString()
  employeeName?: string;

  @ApiPropertyOptional({ enum: SafetyInspectionReviewStatus })
  @IsOptional()
  @IsEnum(SafetyInspectionReviewStatus)
  reviewStatus?: SafetyInspectionReviewStatus;

  @ApiPropertyOptional({ enum: SafetyInspectionActionStatusFilter })
  @Transform(({ value }) => normalizeOptionalString(value))
  @IsOptional()
  @IsEnum(SafetyInspectionActionStatusFilter)
  actionStatus?: SafetyInspectionActionStatusFilter;

  @ApiPropertyOptional({ example: '2026-06-01' })
  @Transform(({ value }) => normalizeOptionalString(value))
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  dateFrom?: string;

  @ApiPropertyOptional({ example: '2026-06-30' })
  @Transform(({ value }) => normalizeOptionalString(value))
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  dateTo?: string;

  @ApiPropertyOptional({
    description: '체크리스트 배정 기준으로 미제출 작업자를 함께 조회합니다.',
    type: Boolean,
  })
  @Transform(({ value }) => normalizeOptionalBoolean(value))
  @IsOptional()
  @IsBoolean()
  includeUnsubmitted?: boolean;

  @ApiPropertyOptional({ description: '회사 필터 ID' })
  @Transform(({ value }) => normalizeOptionalString(value))
  @IsOptional()
  @IsString()
  companyId?: string;

  @ApiPropertyOptional({ description: '그룹 필터 ID' })
  @Transform(({ value }) => normalizeOptionalString(value))
  @IsOptional()
  @IsString()
  groupId?: string;

  @ApiPropertyOptional({ description: '팀 필터 ID' })
  @Transform(({ value }) => normalizeOptionalString(value))
  @IsOptional()
  @IsString()
  teamId?: string;
}

export class SafetyInspectionAssignmentDateQueryDto {
  @ApiProperty({ description: '체크리스트 ID' })
  @Transform(({ value }) => normalizeOptionalString(value))
  @IsString()
  checklistId!: string;

  @ApiProperty({ description: '배정 당시 작업자 ID' })
  @Transform(({ value }) => normalizeOptionalString(value))
  @IsString()
  employeeIdAtAssign!: string;

  @ApiProperty({ description: '점검일', example: '2026-06-29' })
  @Transform(({ value }) => normalizeOptionalString(value))
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  inspectionDate!: string;
}

export class SafetyInspectionAssignmentDatesQueryDto {
  @ApiProperty({ description: '체크리스트 ID' })
  @Transform(({ value }) => normalizeOptionalString(value))
  @IsString()
  checklistId!: string;

  @ApiProperty({ description: '배정 당시 작업자 ID' })
  @Transform(({ value }) => normalizeOptionalString(value))
  @IsString()
  employeeIdAtAssign!: string;
}

export class SafetyInspectionAssignmentDatesResponseDto {
  @ApiProperty({ type: [String], example: ['2026-06-23', '2026-06-24'] })
  dates!: string[];
}

export class ReviewSafetyInspectionSubmissionDto {
  @ApiProperty({ description: '관리자 검토 상태', enum: SafetyInspectionReviewStatus })
  @IsEnum(SafetyInspectionReviewStatus)
  reviewStatus!: SafetyInspectionReviewStatus;

  @ApiPropertyOptional({ description: '관리자 검토 메모' })
  @Transform(({ value }) => normalizeOptionalString(value))
  @IsOptional()
  @IsString()
  reviewComment?: string;
}

export class SendSafetyChecklistPushMessageDto {
  @ApiProperty({
    description: '오늘 미제출 작업자에게 보낼 푸시 메시지 본문',
    example: '아직 안전점검이 제출되지 않았습니다. 작업 전 점검을 완료해주세요.',
    maxLength: 500,
  })
  @Transform(({ value }) => String(value ?? '').trim())
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  message!: string;
}

export class SafetyChecklistPushMessageResultDto {
  @ApiProperty({ description: '발송 요청 대상 작업자 수', example: 4 })
  targetEmployeeCount!: number;

  @ApiProperty({ description: '발송 가능한 푸시 토큰/기기 수', example: 4 })
  targetDeviceCount!: number;

  @ApiProperty({ description: 'FCM 발송 성공 기기 수', example: 4 })
  successCount!: number;

  @ApiProperty({ description: 'FCM 발송 실패 기기 수', example: 0 })
  failedCount!: number;
}

export class SafetyChecklistCandidateFilterDto {
  @ApiPropertyOptional({ description: '슈퍼관리자 회사 필터 ID' })
  @Transform(({ value }) => normalizeOptionalString(value))
  @IsOptional()
  @IsString()
  companyId?: string;
}

export class SafetyChecklistCandidateCompanyDto {
  id!: string;
  name!: string;
}

export class SafetyChecklistCandidateEmployeeDto {
  id!: string;
  name!: string;
  organizationId!: string;
  organizationName!: string;
  groupId!: string | null;
  groupName!: string | null;
  teamId!: string | null;
  teamName!: string | null;
  position!: string | null;
  role!: string | null;
}

export class SafetyChecklistCandidateTeamDto {
  id!: string;
  name!: string;
  employees!: SafetyChecklistCandidateEmployeeDto[];
}

export class SafetyChecklistCandidateGroupDto {
  id!: string;
  name!: string;
  teams!: SafetyChecklistCandidateTeamDto[];
}

export class SafetyChecklistCandidateResponseDto {
  companies!: SafetyChecklistCandidateCompanyDto[];
  groups!: SafetyChecklistCandidateGroupDto[];
  total!: number;
}

export class SafetyChecklistItemDto {
  id!: string;
  category!: string | null;
  question!: string;
  helpText!: string | null;
  required!: boolean;
  sortOrder!: number;
}

export class SafetyChecklistSectionDto {
  id!: string;
  title!: string;
  description!: string | null;
  sortOrder!: number;
  items!: SafetyChecklistItemDto[];
}

export class SafetyChecklistListItemDto {
  id!: string;
  organizationId!: string;
  organizationName!: string;
  title!: string;
  description!: string | null;
  industry!: string | null;
  status!: SafetyChecklistStatus;
  currentVersionId!: string | null;
  latestVersion!: number | null;
  latestDeploymentStartDate!: Date | null;
  latestDeploymentEndDate!: Date | null;
  latestDeploymentStartTime!: string | null;
  latestDeploymentEndTime!: string | null;
  todayTargetCount!: number;
  todaySubmittedCount!: number;
  deploymentCount!: number;
  assignmentCount!: number;
  submissionCount!: number;
  createdAt!: Date;
  updatedAt!: Date;
}

export class SafetyChecklistListResponseDto {
  data!: SafetyChecklistListItemDto[];
  total!: number;
  page!: number;
  limit!: number;
  totalPages!: number;
}

export class SafetyChecklistDeploymentDto {
  id!: string;
  status!: SafetyChecklistDeploymentStatus;
  titleSnapshot!: string;
  startDate!: Date;
  endDate!: Date | null;
  startTime!: string;
  endTime!: string;
  assignmentCount!: number;
  createdAt!: Date;
}

export class SafetyChecklistAssignmentDto {
  id!: string;
  deploymentId!: string;
  employeeId!: string | null;
  employeeIdAtAssign!: string;
  employeeNameAtAssign!: string;
  organizationNameAtAssign!: string | null;
  groupIdAtAssign!: string | null;
  groupNameAtAssign!: string | null;
  teamIdAtAssign!: string | null;
  teamNameAtAssign!: string | null;
  inspectionDate!: Date;
  startedAt!: Date | null;
  dueAt!: Date | null;
  status!: SafetyChecklistAssignmentStatus;
  submittedAt!: Date | null;
}

export class SafetyChecklistTodayTargetDto {
  assignmentId!: string;
  submissionId!: string | null;
  employeeId!: string | null;
  employeeName!: string;
  organizationName!: string | null;
  groupId!: string | null;
  groupName!: string | null;
  teamId!: string | null;
  teamName!: string | null;
  inspectionDate!: Date;
  status!: SafetyChecklistAssignmentStatus;
  submitted!: boolean;
  submittedAt!: Date | null;
  reviewStatus!: SafetyInspectionReviewStatus | null;
  oCount!: number;
  xCount!: number;
  actionNeeded!: boolean;
  actionCompleted!: boolean;
}

export class SafetyChecklistTodaySummaryDto {
  date!: string;
  targetCount!: number;
  submittedCount!: number;
  normalSubmittedCount!: number;
  actionNeededCount!: number;
  actionCompletedCount!: number;
  notSubmittedCount!: number;
  pendingCount!: number;
  inProgressCount!: number;
  overdueCount!: number;
  targets!: SafetyChecklistTodayTargetDto[];
}

export class SafetyChecklistDetailDto extends SafetyChecklistListItemDto {
  sections!: SafetyChecklistSectionDto[];
  deployments!: SafetyChecklistDeploymentDto[];
  assignments!: SafetyChecklistAssignmentDto[];
  todaySummary!: SafetyChecklistTodaySummaryDto;

  @ApiProperty({ description: '최신 배포에 포함된 고유 작업자 ID 목록', type: [String] })
  latestDeploymentTargetEmployeeIds!: string[];
}

export class SafetyInspectionAttachmentDto {
  id!: string;
  originalName!: string;
  mimeType!: string;
  size!: number;
  isImage!: boolean;
  downloadUrl!: string;
  createdAt!: Date;
}

export class SafetyInspectionAnswerDto {
  id!: string;
  itemId!: string | null;
  sectionTitle!: string | null;
  category!: string | null;
  question!: string;
  answer!: boolean;
  actionText!: string | null;
  sortOrder!: number;
  attachments!: SafetyInspectionAttachmentDto[];
}

export class SafetyInspectionSubmissionListItemDto {
  id!: string;
  assignmentId!: string;
  checklistId!: string;
  checklistTitle!: string;
  employeeId!: string | null;
  employeeIdAtAssign!: string;
  employeeIdAtSubmit!: string;
  employeeNameAtSubmit!: string;
  organizationNameAtAssign!: string | null;
  groupIdAtAssign!: string | null;
  groupNameAtAssign!: string | null;
  teamIdAtAssign!: string | null;
  teamNameAtAssign!: string | null;
  inspectionDate!: Date | null;
  assignmentStatus!: SafetyChecklistAssignmentStatus | null;
  submitted!: boolean;
  reviewStatus!: SafetyInspectionReviewStatus | null;
  oCount!: number;
  xCount!: number;
  submittedAt!: Date | null;
}

export class SafetyInspectionSubmissionListResponseDto {
  data!: SafetyInspectionSubmissionListItemDto[];
  total!: number;
  page!: number;
  limit!: number;
  totalPages!: number;
}

export class SafetyInspectionSubmissionDetailDto extends SafetyInspectionSubmissionListItemDto {
  assignmentId!: string;
  organizationNameAtAssign!: string | null;
  groupIdAtAssign!: string | null;
  groupNameAtAssign!: string | null;
  teamIdAtAssign!: string | null;
  teamNameAtAssign!: string | null;
  inspectionDate!: Date;
  startedAt!: Date | null;
  dueAt!: Date | null;
  reviewComment!: string | null;
  reviewedAt!: Date | null;
  reviewedById!: string | null;
  answers!: SafetyInspectionAnswerDto[];
}

export class SafetyChecklistStatisticsFilterDto {
  @ApiPropertyOptional()
  @Transform(({ value }) => normalizeOptionalString(value))
  @IsOptional()
  @IsString()
  checklistId?: string;

  @ApiPropertyOptional({ example: '2026-06-01' })
  @Transform(({ value }) => normalizeOptionalString(value))
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  dateFrom?: string;

  @ApiPropertyOptional({ example: '2026-06-30' })
  @Transform(({ value }) => normalizeOptionalString(value))
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  dateTo?: string;

  @ApiPropertyOptional({ description: '회사 필터 ID' })
  @Transform(({ value }) => normalizeOptionalString(value))
  @IsOptional()
  @IsString()
  companyId?: string;

  @ApiPropertyOptional({ description: '그룹 필터 ID' })
  @Transform(({ value }) => normalizeOptionalString(value))
  @IsOptional()
  @IsString()
  groupId?: string;

  @ApiPropertyOptional({ description: '팀 필터 ID' })
  @Transform(({ value }) => normalizeOptionalString(value))
  @IsOptional()
  @IsString()
  teamId?: string;
}

export class SafetyChecklistDateRangeDto {
  dateFrom!: string | null;
  dateTo!: string | null;
}

export class SafetyChecklistStatisticsSummaryDto {
  totalAssignments!: number;
  submittedCount!: number;
  notSubmittedCount!: number;
  xResponseCount!: number;
  pendingReviewCount!: number;
  actionRequiredCount!: number;
  actionCompletedCount!: number;
  actionCompletionRate!: number;
}

export class SafetyChecklistStatisticsTrendPointDto {
  date!: string;
  targetCount!: number;
  submittedCount!: number;
  submitted!: number;
  submissionRate!: number;
  xCount!: number;
  actionRequiredCount!: number;
  actionCompletedCount!: number;
  actionCompletionRate!: number;
}

export class SafetyChecklistTeamComparisonDto {
  groupId!: string | null;
  groupName!: string | null;
  teamId!: string | null;
  teamName!: string | null;
  targetCount!: number;
  submittedCount!: number;
  submissionRate!: number;
  xCount!: number;
  actionRequiredCount!: number;
  actionCompletedCount!: number;
  actionCompletionRate!: number;
}

export class SafetyChecklistStatisticsDto {
  dateFrom!: string;
  dateTo!: string;
  summary!: SafetyChecklistStatisticsSummaryDto;
  dailyTrend!: SafetyChecklistStatisticsTrendPointDto[];
  teamComparisons!: SafetyChecklistTeamComparisonDto[];
}

export class SafetyChecklistPatternsFilterDto {
  @ApiPropertyOptional()
  @Transform(({ value }) => normalizeOptionalString(value))
  @IsOptional()
  @IsString()
  checklistId?: string;

  @ApiPropertyOptional({ example: '2026-06-01' })
  @Transform(({ value }) => normalizeOptionalString(value))
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  dateFrom?: string;

  @ApiPropertyOptional({ example: '2026-06-30' })
  @Transform(({ value }) => normalizeOptionalString(value))
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  dateTo?: string;

  @ApiPropertyOptional({ description: '회사 필터 ID' })
  @Transform(({ value }) => normalizeOptionalString(value))
  @IsOptional()
  @IsString()
  companyId?: string;

  @ApiPropertyOptional({ description: '그룹 필터 ID' })
  @Transform(({ value }) => normalizeOptionalString(value))
  @IsOptional()
  @IsString()
  groupId?: string;

  @ApiPropertyOptional({ description: '팀 필터 ID' })
  @Transform(({ value }) => normalizeOptionalString(value))
  @IsOptional()
  @IsString()
  teamId?: string;
}

export class SafetyChecklistRepeatXItemDto {
  itemId!: string | null;
  checklistId!: string;
  checklistTitle!: string;
  question!: string;
  section!: string | null;
  category!: string | null;
  xCount!: number;
  totalCount!: number;
  xRate!: number;
  affectedEmployeeCount!: number;
  actionRequiredCount!: number;
  actionCompletedCount!: number;
  latestOccurredAt!: Date | null;
  recentEmployeeName!: string | null;
}

export class SafetyChecklistRepeatNonSubmitterDto {
  employeeIdAtAssign!: string;
  employeeName!: string;
  groupName!: string | null;
  teamName!: string | null;
  missedCount!: number;
  totalAssignments!: number;
  submittedCount!: number;
  submissionRate!: number;
  lastSubmittedAt!: Date | null;
}

export class SafetyChecklistPatternsDto {
  dateFrom!: string;
  dateTo!: string;
  repeatNonSubmitters!: SafetyChecklistRepeatNonSubmitterDto[];
  repeatXItems!: SafetyChecklistRepeatXItemDto[];
}
