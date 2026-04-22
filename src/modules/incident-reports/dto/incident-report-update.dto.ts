import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IncidentReportResolutionType,
  IncidentReportSeverity,
  IncidentReportStatus,
} from '@prisma/client';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateIncidentReportSeverityDto {
  @ApiProperty({ description: '변경할 심각도', enum: IncidentReportSeverity })
  @IsEnum(IncidentReportSeverity)
  severity: IncidentReportSeverity;

  @ApiPropertyOptional({ description: '심각도 변경 메모' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  comment?: string;
}

export class UpdateIncidentReportStatusDto {
  @ApiProperty({ description: '변경할 상태', enum: IncidentReportStatus })
  @IsEnum(IncidentReportStatus)
  status: IncidentReportStatus;

  @ApiPropertyOptional({ description: '상태 변경 메모' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  comment?: string;
}

export class UpdateIncidentReportAssigneeDto {
  @ApiPropertyOptional({ description: '담당 관리자 ID, null이면 담당 해제', nullable: true })
  @IsOptional()
  @IsString()
  assignedAdminId?: string | null;

  @ApiPropertyOptional({ description: '배정 메모' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  comment?: string;
}

export class CreateIncidentReportCommentDto {
  @ApiProperty({ description: '내부 코멘트' })
  @IsString()
  @MaxLength(2000)
  comment: string;
}

export class ResolveIncidentReportDto {
  @ApiProperty({ description: '해결 유형', enum: IncidentReportResolutionType })
  @IsEnum(IncidentReportResolutionType)
  resolutionType: IncidentReportResolutionType;

  @ApiProperty({ description: '해결 요약' })
  @IsString()
  resolutionSummary: string;

  @ApiPropertyOptional({ description: '추가 메모' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  comment?: string;
}