import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsEnum,
  IsNumber,
  IsBoolean,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';

export enum BehaviorConditionTypeEnum {
  DISTANCE = 'distance',
  WALKING = 'walking',
  WALKING_SPEED = 'walkingSpeed',
  VEHICLE_SPEED = 'vehicleSpeed',
  COMPOSITE = 'composite',
}

export class CreateBehaviorConditionDto {
  @ApiProperty({ description: '조건명' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({ description: '조건 유형', enum: BehaviorConditionTypeEnum })
  @IsEnum(BehaviorConditionTypeEnum)
  type: BehaviorConditionTypeEnum;

  @ApiPropertyOptional({ description: '이동 거리 임계값 (미터)' })
  @IsNumber()
  @Min(0)
  @IsOptional()
  distanceThreshold?: number;

  @ApiPropertyOptional({ description: '걸음 수 임계값' })
  @IsNumber()
  @Min(0)
  @IsOptional()
  stepsThreshold?: number;

  @ApiPropertyOptional({ description: '속도 임계값 (km/h)' })
  @IsNumber()
  @Min(0)
  @IsOptional()
  speedThreshold?: number;

  @ApiPropertyOptional({ description: '설명' })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiProperty({ description: '조직 ID' })
  @IsString()
  @IsNotEmpty()
  organizationId: string;

  @ApiPropertyOptional({ description: '작업 유형 ID' })
  @IsString()
  @IsOptional()
  workTypeId?: string;

  @ApiPropertyOptional({ description: '활성 상태', default: true })
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}

export class UpdateBehaviorConditionDto extends PartialType(CreateBehaviorConditionDto) {}

export class BehaviorConditionResponseDto {
  @ApiProperty({ description: '조건 ID' })
  id: string;

  @ApiProperty({ description: '조건명' })
  name: string;

  @ApiProperty({ description: '조건 유형' })
  type: string;

  @ApiPropertyOptional({ description: '이동 거리 임계값' })
  distanceThreshold?: number;

  @ApiPropertyOptional({ description: '걸음 수 임계값' })
  stepsThreshold?: number;

  @ApiPropertyOptional({ description: '속도 임계값' })
  speedThreshold?: number;

  @ApiPropertyOptional({ description: '설명' })
  description?: string;

  @ApiProperty({ description: '활성 상태' })
  isActive: boolean;

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

  @ApiProperty({ description: '연결된 정책 수' })
  policyCount: number;

  @ApiProperty({ description: '생성일시' })
  createdAt: Date;

  @ApiProperty({ description: '수정일시' })
  updatedAt: Date;
}

export class BehaviorConditionFilterDto {
  @ApiPropertyOptional({ description: '검색어 (이름)' })
  @IsString()
  @IsOptional()
  search?: string;

  @ApiPropertyOptional({ description: '조건 유형', enum: BehaviorConditionTypeEnum })
  @IsEnum(BehaviorConditionTypeEnum)
  @IsOptional()
  type?: BehaviorConditionTypeEnum;

  @ApiPropertyOptional({ description: '조직 ID' })
  @IsString()
  @IsOptional()
  organizationId?: string;

  @ApiPropertyOptional({ description: '작업 유형 ID' })
  @IsString()
  @IsOptional()
  workTypeId?: string;

  @ApiPropertyOptional({ description: '활성 상태' })
  @IsOptional()
  isActive?: boolean;

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

export class BehaviorConditionListResponseDto {
  @ApiProperty({ type: [BehaviorConditionResponseDto] })
  data: BehaviorConditionResponseDto[];

  @ApiProperty()
  total: number;

  @ApiProperty()
  page: number;

  @ApiProperty()
  limit: number;

  @ApiProperty()
  totalPages: number;
}

export class BehaviorConditionStatsDto {
  @ApiProperty({ description: '전체 조건 수' })
  totalConditions: number;

  @ApiProperty({ description: '활성 조건 수' })
  activeConditions: number;

  @ApiProperty({ description: '유형별 조건 수' })
  byType: Record<string, number>;
}
