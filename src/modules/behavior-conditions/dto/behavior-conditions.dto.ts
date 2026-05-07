import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsNumber,
  IsBoolean,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { PolicyChangeNoticeDto } from '../../../common/dto/policy-change-notice.dto';

export class CreateBehaviorConditionDto {
  @ApiProperty({ description: '조건명' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiPropertyOptional({ description: '이동거리 조건 활성화 여부' })
  @IsBoolean()
  @IsOptional()
  enableDistanceCondition?: boolean;

  @ApiPropertyOptional({ description: '걸음 조건 활성화 여부' })
  @IsBoolean()
  @IsOptional()
  enableStepsCondition?: boolean;

  @ApiPropertyOptional({ description: '속도 조건 활성화 여부' })
  @IsBoolean()
  @IsOptional()
  enableSpeedCondition?: boolean;

  @ApiPropertyOptional({ description: '이동 거리 임계값 (미터)' })
  @IsNumber()
  @Min(1)
  @IsOptional()
  distanceThreshold?: number;

  @ApiPropertyOptional({ description: '걸음 수 임계값' })
  @IsNumber()
  @Min(1)
  @IsOptional()
  stepsThreshold?: number;

  @ApiPropertyOptional({ description: '속도 임계값 (km/h)' })
  @IsNumber()
  @Min(1)
  @IsOptional()
  speedThreshold?: number;

  @ApiPropertyOptional({ description: '설명' })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiProperty({ description: '현장 ID' })
  @IsString()
  @IsNotEmpty()
  organizationId: string;

}

export class UpdateBehaviorConditionDto extends PartialType(CreateBehaviorConditionDto) {}

export class BehaviorConditionResponseDto {
  @ApiProperty({ description: '조건 ID' })
  id: string;

  @ApiProperty({ description: '조건명' })
  name: string;

  @ApiProperty({ description: '이동거리 조건 활성화 여부' })
  enableDistanceCondition: boolean;

  @ApiProperty({ description: '걸음 조건 활성화 여부' })
  enableStepsCondition: boolean;

  @ApiProperty({ description: '속도 조건 활성화 여부' })
  enableSpeedCondition: boolean;

  @ApiPropertyOptional({ description: '이동 거리 임계값' })
  distanceThreshold?: number;

  @ApiPropertyOptional({ description: '걸음 수 임계값' })
  stepsThreshold?: number;

  @ApiPropertyOptional({ description: '속도 임계값' })
  speedThreshold?: number;

  @ApiPropertyOptional({ description: '설명' })
  description?: string;

  @ApiPropertyOptional({ description: '현장 정보' })
  organization?: {
    id: string;
    name: string;
  };

  @ApiProperty({ description: '연결된 정책 수' })
  policyCount: number;

  @ApiProperty({ description: '생성일시' })
  createdAt: Date;

  @ApiProperty({ description: '수정일시' })
  updatedAt: Date;

  @ApiPropertyOptional({ description: '조건 변경으로 인한 통제 정책 상태 안내', type: PolicyChangeNoticeDto })
  policyChangeNotice?: PolicyChangeNoticeDto;
}

export class BehaviorConditionFilterDto {
  @ApiPropertyOptional({ description: '검색어 (이름)' })
  @IsString()
  @IsOptional()
  search?: string;

  @ApiPropertyOptional({ description: '이동거리 조건 활성화 여부' })
  @IsBoolean()
  @IsOptional()
  @Type(() => Boolean)
  enableDistanceCondition?: boolean;

  @ApiPropertyOptional({ description: '걸음 조건 활성화 여부' })
  @IsBoolean()
  @IsOptional()
  @Type(() => Boolean)
  enableStepsCondition?: boolean;

  @ApiPropertyOptional({ description: '속도 조건 활성화 여부' })
  @IsBoolean()
  @IsOptional()
  @Type(() => Boolean)
  enableSpeedCondition?: boolean;

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
