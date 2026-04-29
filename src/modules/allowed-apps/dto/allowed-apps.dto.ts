import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsBoolean,
  IsNumber,
  IsArray,
  IsIn,
} from 'class-validator';
import { Type } from 'class-transformer';

// ============ AllowedApp DTOs ============

export class CreateAllowedAppDto {
  @ApiProperty({ description: '앱 이름' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({ description: '패키지 이름 (고유)' })
  @IsString()
  @IsNotEmpty()
  packageName: string;

  @ApiPropertyOptional({ description: '카테고리' })
  @IsString()
  @IsOptional()
  category?: string;

  @ApiPropertyOptional({ description: '플랫폼 (android | ios)', default: 'android' })
  @IsString()
  @IsOptional()
  @IsIn(['android', 'ios'])
  platform?: string;

  @ApiPropertyOptional({ description: '아이콘 URL' })
  @IsString()
  @IsOptional()
  iconUrl?: string;

  @ApiPropertyOptional({ description: '전역 앱 여부', default: false })
  @IsBoolean()
  @IsOptional()
  isGlobal?: boolean;
}

export class UpdateAllowedAppDto extends PartialType(CreateAllowedAppDto) {}

export class AllowedAppResponseDto {
  @ApiProperty({ description: '앱 ID' })
  id: string;

  @ApiProperty({ description: '앱 이름' })
  name: string;

  @ApiProperty({ description: '패키지 이름' })
  packageName: string;

  @ApiPropertyOptional({ description: '카테고리' })
  category?: string;

  @ApiProperty({ description: '플랫폼 (android | ios)' })
  platform: string;

  @ApiPropertyOptional({ description: '아이콘 URL' })
  iconUrl?: string;

  @ApiProperty({ description: '전역 앱 여부' })
  isGlobal: boolean;

  @ApiProperty({ description: '프리셋 포함 수' })
  presetCount: number;

  @ApiProperty({ description: '설치 직원 수 (허용앱을 설치한 고유 직원 수)' })
  installedCount: number;

  @ApiProperty({ description: '생성일시' })
  createdAt: Date;

  @ApiProperty({ description: '수정일시' })
  updatedAt: Date;
}

export class AllowedAppFilterDto {
  @ApiPropertyOptional({ description: '검색어 (이름/패키지)' })
  @IsString()
  @IsOptional()
  search?: string;

  @ApiPropertyOptional({ description: '카테고리' })
  @IsString()
  @IsOptional()
  category?: string;

  @ApiPropertyOptional({ description: '전역 앱 여부' })
  @IsOptional()
  isGlobal?: boolean;

  @ApiPropertyOptional({ description: '플랫폼 필터 (android | ios | all)', default: 'all' })
  @IsString()
  @IsOptional()
  @IsIn(['all', 'android', 'ios'])
  platform?: string;

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

export class AllowedAppListResponseDto {
  @ApiProperty({ type: [AllowedAppResponseDto] })
  data: AllowedAppResponseDto[];

  @ApiProperty()
  total: number;

  @ApiProperty()
  page: number;

  @ApiProperty()
  limit: number;

  @ApiProperty()
  totalPages: number;
}

export class RefreshAllowedAppIconsDto {
  @ApiPropertyOptional({ description: '플랫폼 필터 (android | ios | all)', default: 'all' })
  @IsString()
  @IsOptional()
  @IsIn(['all', 'android', 'ios'])
  platform?: string;

  @ApiPropertyOptional({ description: '앱 ID 목록 (미지정 시 전체)' })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  appIds?: string[];
}

export class RefreshAllowedAppIconsResponseDto {
  @ApiProperty({ description: '대상 앱 수' })
  total: number;

  @ApiProperty({ description: '아이콘 갱신 처리 성공 수 (변경+유지)' })
  refreshed: number;

  @ApiProperty({ description: '아이콘 URL 변경 수' })
  updated: number;

  @ApiProperty({ description: '아이콘 URL 동일 수' })
  unchanged: number;

  @ApiProperty({ description: '스토어에서 아이콘 미조회 수' })
  missing: number;

  @ApiProperty({ description: '조회 실패 수' })
  failed: number;

  @ApiProperty({ description: '처리 결과 상세' })
  results: Array<{
    id: string;
    packageName: string;
    platform: string;
    status: 'updated' | 'unchanged' | 'missing' | 'failed';
    previousIconUrl?: string | null;
    iconUrl?: string | null;
    message?: string;
  }>;
}

// ============ AllowedAppPreset DTOs ============

export class CreateAllowedAppPresetDto {
  @ApiProperty({ description: '프리셋 이름' })
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

  @ApiPropertyOptional({ description: '프리셋 플랫폼 (android | ios)', default: 'android' })
  @IsString()
  @IsOptional()
  @IsIn(['android', 'ios'])
  platform?: string;

  @ApiPropertyOptional({ description: '앱 ID 목록' })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  appIds?: string[];
}

export class UpdateAllowedAppPresetDto extends PartialType(CreateAllowedAppPresetDto) {}

export class AllowedAppPresetResponseDto {
  @ApiProperty({ description: '프리셋 ID' })
  id: string;

  @ApiProperty({ description: '프리셋 이름' })
  name: string;

  @ApiPropertyOptional({ description: '설명' })
  description?: string;

  @ApiPropertyOptional({ description: '현장 정보' })
  organization?: {
    id: string;
    name: string;
  };

  @ApiProperty({ description: '플랫폼 (android | ios)' })
  platform: string;

  @ApiProperty({ description: '포함된 앱 수' })
  appCount: number;

  @ApiProperty({ description: '연결된 정책 수' })
  policyCount: number;

  @ApiProperty({ description: '생성일시' })
  createdAt: Date;

  @ApiProperty({ description: '수정일시' })
  updatedAt: Date;
}

export class AllowedAppPresetDetailDto extends AllowedAppPresetResponseDto {
  @ApiProperty({ description: '포함된 앱 목록' })
  apps: AllowedAppResponseDto[];
}

export class AllowedAppPresetFilterDto {
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

  @ApiPropertyOptional({ description: '플랫폼 필터 (android | ios | all)', default: 'all' })
  @IsString()
  @IsOptional()
  @IsIn(['all', 'android', 'ios'])
  platform?: string;

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

export class AllowedAppPresetListResponseDto {
  @ApiProperty({ type: [AllowedAppPresetResponseDto] })
  data: AllowedAppPresetResponseDto[];

  @ApiProperty()
  total: number;

  @ApiProperty()
  page: number;

  @ApiProperty()
  limit: number;

  @ApiProperty()
  totalPages: number;
}

export class AssignAppsToPresetDto {
  @ApiProperty({ description: '앱 ID 목록' })
  @IsArray()
  @IsString({ each: true })
  appIds: string[];
}

export class AllowedAppStatsDto {
  @ApiProperty({ description: '전체 앱 수' })
  totalApps: number;

  @ApiProperty({ description: '전역 앱 수' })
  globalApps: number;

  @ApiProperty({ description: '전체 프리셋 수' })
  totalPresets: number;

  @ApiProperty({ description: '카테고리별 앱 수' })
  byCategory: Record<string, number>;

  @ApiProperty({ description: '플랫폼별 앱 수' })
  byPlatform: Record<string, number>;
}
