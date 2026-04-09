import { IsOptional, IsDateString, IsString, IsEnum } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { PaginationDto } from './pagination.dto';

export class DateRangeFilterDto {
  @ApiPropertyOptional({ description: '시작 날짜 (ISO8601)' })
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @ApiPropertyOptional({ description: '종료 날짜 (ISO8601)' })
  @IsOptional()
  @IsDateString()
  endDate?: string;
}

export class OrganizationFilterDto {
  @ApiPropertyOptional({ description: '현장 ID' })
  @IsOptional()
  @IsString()
  organizationId?: string;

  @ApiPropertyOptional({ description: '하위 현장 포함 여부' })
  @IsOptional()
  includeSubOrganizations?: boolean = true;
}

export class SearchFilterDto {
  @ApiPropertyOptional({ description: '검색어' })
  @IsOptional()
  @IsString()
  search?: string;
}

export class BaseFilterDto extends PaginationDto {
  @ApiPropertyOptional({ description: '현장 ID' })
  @IsOptional()
  @IsString()
  organizationId?: string;

  @ApiPropertyOptional({ description: '검색어' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ description: '시작 날짜 (ISO8601)' })
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @ApiPropertyOptional({ description: '종료 날짜 (ISO8601)' })
  @IsOptional()
  @IsDateString()
  endDate?: string;
}

export enum ActiveStatus {
  ALL = 'all',
  ACTIVE = 'active',
  INACTIVE = 'inactive',
}

export class StatusFilterDto {
  @ApiPropertyOptional({ description: '상태 필터', enum: ActiveStatus })
  @IsOptional()
  @IsEnum(ActiveStatus)
  status?: ActiveStatus = ActiveStatus.ALL;
}
