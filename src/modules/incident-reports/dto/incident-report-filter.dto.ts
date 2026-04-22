import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IncidentReportCategory,
  IncidentReportSeverity,
  IncidentReportStatus,
} from '@prisma/client';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class IncidentReportFilterDto {
  @ApiPropertyOptional({ description: '페이지 번호', default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ description: '페이지 크기', default: 20, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @ApiPropertyOptional({ description: '검색어(제목/설명/신고자/조직명)' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ description: '조직 ID' })
  @IsOptional()
  @IsString()
  organizationId?: string;

  @ApiPropertyOptional({ description: '상태', enum: IncidentReportStatus })
  @IsOptional()
  @IsEnum(IncidentReportStatus)
  status?: IncidentReportStatus;

  @ApiPropertyOptional({ description: '심각도', enum: IncidentReportSeverity })
  @IsOptional()
  @IsEnum(IncidentReportSeverity)
  severity?: IncidentReportSeverity;

  @ApiPropertyOptional({ description: '카테고리', enum: IncidentReportCategory })
  @IsOptional()
  @IsEnum(IncidentReportCategory)
  category?: IncidentReportCategory;

  @ApiPropertyOptional({ description: '담당 관리자 ID' })
  @IsOptional()
  @IsString()
  assignedAdminId?: string;
}