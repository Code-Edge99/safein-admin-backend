import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsEnum,
  IsNumber,
  IsArray,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export enum ZoneTypeEnum {
  danger = 'danger',
  normal = 'normal',
  work = 'work',
  safe = 'safe',
}

export enum ZoneShapeEnum {
  polygon = 'polygon',
  circle = 'circle',
}

export class CoordinateDto {
  @ApiProperty({ description: '위도' })
  @IsNumber()
  @IsOptional()
  latitude?: number;

  @ApiPropertyOptional({ description: '경도 (lng)' })
  @IsNumber()
  @IsOptional()
  lng?: number;

  @ApiPropertyOptional({ description: '경도 (legacy longitude)' })
  @IsNumber()
  @IsOptional()
  longitude?: number;

  @ApiPropertyOptional({ description: '위도 (lat)' })
  @IsNumber()
  @IsOptional()
  lat?: number;

}

export interface ZoneCoordinatePoint {
  lat?: number;
  lng?: number;
  latitude?: number;
  longitude?: number;
}


export class CreateZoneDto {
  @ApiProperty({ description: '구역명' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiPropertyOptional({ description: '구역 설명' })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiProperty({ description: '구역 유형', enum: ZoneTypeEnum })
  @IsEnum(ZoneTypeEnum)
  type: ZoneTypeEnum;

  @ApiProperty({ description: '구역 형태', enum: ZoneShapeEnum })
  @IsEnum(ZoneShapeEnum)
  shape: ZoneShapeEnum;

  @ApiProperty({ description: '좌표 목록', type: [CoordinateDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CoordinateDto)
  coordinates: CoordinateDto[];

  @ApiPropertyOptional({ description: '반경 (원형 구역, 미터)' })
  @IsNumber()
  @IsOptional()
  radius?: number;

  @ApiProperty({ description: '현장 ID' })
  @IsString()
  @IsNotEmpty()
  organizationId: string;

  @ApiPropertyOptional({ description: '그룹 ID' })
  @IsString()
  @IsOptional()
  groupId?: string;

}

export class UpdateZoneDto extends PartialType(CreateZoneDto) {}

export class ZoneResponseDto {
  @ApiProperty({ description: '구역 ID' })
  id: string;

  @ApiProperty({ description: '구역명' })
  name: string;

  @ApiPropertyOptional({ description: '구역 설명' })
  description?: string;

  @ApiProperty({ description: '구역 유형' })
  type: string;

  @ApiProperty({ description: '구역 형태' })
  shape: string;

  @ApiProperty({ description: '좌표 데이터' })
  coordinates: ZoneCoordinatePoint[];

  @ApiPropertyOptional({ description: '반경' })
  radius?: number;

  @ApiPropertyOptional({ description: '최소 위도(BBox)' })
  bboxMinLat?: number;

  @ApiPropertyOptional({ description: '최소 경도(BBox)' })
  bboxMinLng?: number;

  @ApiPropertyOptional({ description: '최대 위도(BBox)' })
  bboxMaxLat?: number;

  @ApiPropertyOptional({ description: '최대 경도(BBox)' })
  bboxMaxLng?: number;

  @ApiPropertyOptional({ description: '중심 위도(원형 구역)' })
  centerLat?: number;

  @ApiPropertyOptional({ description: '중심 경도(원형 구역)' })
  centerLng?: number;

  @ApiPropertyOptional({ description: '그룹 ID' })
  groupId?: string;

  @ApiPropertyOptional({ description: '현장 정보' })
  organization?: {
    id: string;
    name: string;
  };

  @ApiProperty({ description: '생성일시' })
  createdAt: Date;

  @ApiProperty({ description: '수정일시' })
  updatedAt: Date;
}

export class ZoneFilterDto {
  @ApiPropertyOptional({ description: '검색어 (이름)' })
  @IsString()
  @IsOptional()
  search?: string;

  @ApiPropertyOptional({ description: '구역 유형', enum: ZoneTypeEnum })
  @IsEnum(ZoneTypeEnum)
  @IsOptional()
  type?: ZoneTypeEnum;

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

export class ZoneListResponseDto {
  @ApiProperty({ type: [ZoneResponseDto] })
  data: ZoneResponseDto[];

  @ApiProperty()
  total: number;

  @ApiProperty()
  page: number;

  @ApiProperty()
  limit: number;

  @ApiProperty()
  totalPages: number;
}

export class CheckPointInZoneDto {
  @ApiProperty({ description: '위도' })
  @IsNumber()
  latitude: number;

  @ApiPropertyOptional({ description: '경도 (lng)' })
  @IsNumber()
  @IsOptional()
  lng?: number;

  @ApiPropertyOptional({ description: '경도 (legacy longitude)' })
  @IsNumber()
  @IsOptional()
  longitude?: number;
}

export class ZoneStatsDto {
  @ApiProperty({ description: '전체 구역 수' })
  totalZones: number;

  @ApiProperty({ description: '활성 구역 수' })
  activeZones: number;

  @ApiProperty({ description: '유형별 구역 수' })
  byType: Record<string, number>;
}

export class ZoneDetailStatsDto {
  @ApiProperty({ description: '금일 통제 건수' })
  todayBlocks: number;

  @ApiProperty({ description: '최근 7일 통제 건수' })
  weeklyBlocks: number;

  @ApiProperty({ description: '최근 30일 통제 건수' })
  monthlyBlocks: number;

  @ApiProperty({ description: '최근 30일 구역 출입 건수' })
  monthlyEntries: number;

  @ApiProperty({ description: '최근 30일 통제를 경험한 고유 직원 수' })
  uniqueEmployees: number;

  @ApiPropertyOptional({ description: '마지막 통제 시각' })
  lastViolationAt: string | null;
}
