import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsBoolean,
  IsNumber,
  IsArray,
} from 'class-validator';
import { Type } from 'class-transformer';

// ============ HarmfulApp DTOs ============

export class CreateHarmfulAppDto {
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

export class UpdateHarmfulAppDto extends PartialType(CreateHarmfulAppDto) {}

export class HarmfulAppResponseDto {
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

  @ApiProperty({ description: '설치 직원 수 (유해앱을 설치한 고유 직원 수)' })
  installedCount: number;

  @ApiProperty({ description: '생성일시' })
  createdAt: Date;

  @ApiProperty({ description: '수정일시' })
  updatedAt: Date;
}

export class HarmfulAppFilterDto {
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

export class HarmfulAppListResponseDto {
  @ApiProperty({ type: [HarmfulAppResponseDto] })
  data: HarmfulAppResponseDto[];

  @ApiProperty()
  total: number;

  @ApiProperty()
  page: number;

  @ApiProperty()
  limit: number;

  @ApiProperty()
  totalPages: number;
}

// ============ HarmfulAppPreset DTOs ============

export class CreateHarmfulAppPresetDto {
  @ApiProperty({ description: '프리셋 이름' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiPropertyOptional({ description: '설명' })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiProperty({ description: '플랫폼 (android | ios)', default: 'android' })
  @IsString()
  @IsNotEmpty()
  platform: string;

  @ApiProperty({ description: '조직 ID' })
  @IsString()
  @IsNotEmpty()
  organizationId: string;

  @ApiPropertyOptional({ description: '작업 유형 ID' })
  @IsString()
  @IsOptional()
  workTypeId?: string;

  @ApiPropertyOptional({ description: '앱 ID 목록' })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  appIds?: string[];
}

export class UpdateHarmfulAppPresetDto extends PartialType(CreateHarmfulAppPresetDto) {}

export class HarmfulAppPresetResponseDto {
  @ApiProperty({ description: '프리셋 ID' })
  id: string;

  @ApiProperty({ description: '프리셋 이름' })
  name: string;

  @ApiPropertyOptional({ description: '설명' })
  description?: string;

  @ApiProperty({ description: '플랫폼 (android | ios)' })
  platform: string;

  @ApiPropertyOptional({ description: '조직 정보' })
  organization?: {
    id: string;
    name: string;
  };

  @ApiPropertyOptional({ description: '작업 유형 정보' })
  workType?: {
    id: string;
    name: string;
  };

  @ApiProperty({ description: '포함된 앱 수' })
  appCount: number;

  @ApiProperty({ description: '연결된 정책 수' })
  policyCount: number;

  @ApiProperty({ description: '생성일시' })
  createdAt: Date;

  @ApiProperty({ description: '수정일시' })
  updatedAt: Date;
}

export class HarmfulAppPresetDetailDto extends HarmfulAppPresetResponseDto {
  @ApiProperty({ description: '포함된 앱 목록' })
  apps: HarmfulAppResponseDto[];
}

export class HarmfulAppPresetFilterDto {
  @ApiPropertyOptional({ description: '검색어 (이름)' })
  @IsString()
  @IsOptional()
  search?: string;

  @ApiPropertyOptional({ description: '플랫폼 필터 (android | ios)', default: 'all' })
  @IsString()
  @IsOptional()
  platform?: string;

  @ApiPropertyOptional({ description: '조직 ID' })
  @IsString()
  @IsOptional()
  organizationId?: string;

  @ApiPropertyOptional({ description: '작업 유형 ID' })
  @IsString()
  @IsOptional()
  workTypeId?: string;

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

export class HarmfulAppPresetListResponseDto {
  @ApiProperty({ type: [HarmfulAppPresetResponseDto] })
  data: HarmfulAppPresetResponseDto[];

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

export class HarmfulAppStatsDto {
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
