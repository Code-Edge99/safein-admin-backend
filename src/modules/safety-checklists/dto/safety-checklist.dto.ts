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

export class SafetyChecklistItemInputDto {
  @ApiPropertyOptional({ example: 'fall-prevention' })
  @Transform(({ value }) => normalizeOptionalString(value))
  @IsOptional()
  @IsString()
  @MaxLength(80)
  category?: string;

  @ApiProperty({ example: 'Work area guardrails are installed and stable.' })
  @IsString()
  question!: string;

  @ApiPropertyOptional({ example: 'Check every open edge before work starts.' })
  @Transform(({ value }) => normalizeOptionalString(value))
  @IsOptional()
  @IsString()
  helpText?: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  required?: boolean;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(1000)
  sortOrder?: number;
}

export class SafetyChecklistSectionInputDto {
  @ApiProperty({ example: 'Before work' })
  @IsString()
  @MaxLength(120)
  title!: string;

  @ApiPropertyOptional()
  @Transform(({ value }) => normalizeOptionalString(value))
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(1000)
  sortOrder?: number;

  @ApiProperty({ type: [SafetyChecklistItemInputDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => SafetyChecklistItemInputDto)
  items!: SafetyChecklistItemInputDto[];
}

export class CreateSafetyChecklistDto {
  @ApiPropertyOptional({ description: 'Organization that owns this checklist.' })
  @Transform(({ value }) => normalizeOptionalString(value))
  @IsOptional()
  @IsString()
  organizationId?: string;

  @ApiProperty({ example: 'Daily high-place work checklist' })
  @IsString()
  @MaxLength(200)
  title!: string;

  @ApiPropertyOptional()
  @Transform(({ value }) => normalizeOptionalString(value))
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ example: 'construction' })
  @Transform(({ value }) => normalizeOptionalString(value))
  @IsOptional()
  @IsString()
  @MaxLength(80)
  industry?: string;

  @ApiPropertyOptional({ enum: SafetyChecklistStatus, default: SafetyChecklistStatus.ACTIVE })
  @IsOptional()
  @IsEnum(SafetyChecklistStatus)
  status?: SafetyChecklistStatus;

  @ApiPropertyOptional({ example: '2026-06-24' })
  @Transform(({ value }) => normalizeOptionalString(value))
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  startDate?: string;

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

  @ApiProperty({ type: [SafetyChecklistSectionInputDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => SafetyChecklistSectionInputDto)
  sections!: SafetyChecklistSectionInputDto[];
}

export class UpdateSafetyChecklistDto {
  @ApiPropertyOptional({ example: 'Daily high-place work checklist' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;

  @ApiPropertyOptional()
  @Transform(({ value }) => normalizeOptionalString(value))
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ example: 'construction' })
  @Transform(({ value }) => normalizeOptionalString(value))
  @IsOptional()
  @IsString()
  @MaxLength(80)
  industry?: string;

  @ApiPropertyOptional({ enum: SafetyChecklistStatus })
  @IsOptional()
  @IsEnum(SafetyChecklistStatus)
  status?: SafetyChecklistStatus;

  @ApiPropertyOptional({ example: '2026-06-24' })
  @Transform(({ value }) => normalizeOptionalString(value))
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  startDate?: string;

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

  @ApiPropertyOptional({ description: 'Submitted employee name search.' })
  @Transform(({ value }) => normalizeOptionalString(value))
  @IsOptional()
  @IsString()
  employeeName?: string;

  @ApiPropertyOptional({ enum: SafetyInspectionReviewStatus })
  @IsOptional()
  @IsEnum(SafetyInspectionReviewStatus)
  reviewStatus?: SafetyInspectionReviewStatus;

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
}

export class ReviewSafetyInspectionSubmissionDto {
  @ApiProperty({ enum: SafetyInspectionReviewStatus })
  @IsEnum(SafetyInspectionReviewStatus)
  reviewStatus!: SafetyInspectionReviewStatus;

  @ApiPropertyOptional()
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
  employeeId!: string | null;
  employeeName!: string;
  organizationName!: string | null;
  status!: SafetyChecklistAssignmentStatus;
  submittedAt!: Date | null;
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
  checklistId!: string;
  checklistTitle!: string;
  employeeId!: string | null;
  employeeIdAtSubmit!: string;
  employeeNameAtSubmit!: string;
  organizationNameAtAssign!: string | null;
  groupIdAtAssign!: string | null;
  groupNameAtAssign!: string | null;
  teamIdAtAssign!: string | null;
  teamNameAtAssign!: string | null;
  inspectionDate!: Date | null;
  reviewStatus!: SafetyInspectionReviewStatus;
  oCount!: number;
  xCount!: number;
  submittedAt!: Date;
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
  submitted!: number;
  xCount!: number;
}

export class SafetyChecklistStatisticsDto {
  dateFrom!: string;
  dateTo!: string;
  summary!: SafetyChecklistStatisticsSummaryDto;
  dailyTrend!: SafetyChecklistStatisticsTrendPointDto[];
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
}

export class SafetyChecklistRepeatXItemDto {
  question!: string;
  section!: string | null;
  xCount!: number;
  totalCount!: number;
  xRate!: number;
}

export class SafetyChecklistPatternsDto {
  dateFrom!: string;
  dateTo!: string;
  repeatXItems!: SafetyChecklistRepeatXItemDto[];
}
