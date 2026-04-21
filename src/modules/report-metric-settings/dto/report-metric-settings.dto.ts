import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsNumber, Max, Min } from 'class-validator';

export class ReportMetricSettingsDto {
  @ApiProperty({ description: '안정 점수 계산식 - 앱 제어 차단 가중치', example: 1 })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(10)
  complianceAppBlockWeight: number;

  @ApiProperty({ description: '안정 점수 계산식 - 행동 차단 가중치', example: 1 })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(10)
  complianceBehaviorBlockWeight: number;

  @ApiProperty({ description: '직원 안정 점수 배지 - 우수 최소값(%)', example: 95 })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 1 })
  @Min(0)
  @Max(100)
  complianceBadgeExcellentMin: number;

  @ApiProperty({ description: '직원 안정 점수 배지 - 양호 최소값(%)', example: 85 })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 1 })
  @Min(0)
  @Max(100)
  complianceBadgeGoodMin: number;

  @ApiProperty({ description: '직원 안정 점수 배지 - 보통 최소값(%)', example: 70 })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 1 })
  @Min(0)
  @Max(100)
  complianceBadgeFairMin: number;

  @ApiProperty({ description: '현장 상태 - 위험 판정 안정 점수 미만 기준(%)', example: 80 })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 1 })
  @Min(0)
  @Max(100)
  siteRiskComplianceDangerBelow: number;

  @ApiProperty({ description: '현장 상태 - 주의 판정 안정 점수 미만 기준(%)', example: 90 })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 1 })
  @Min(0)
  @Max(100)
  siteRiskComplianceWarningBelow: number;

  @ApiProperty({ description: '현장 상태 - 위험 판정 직원 1인당 위반 건수 이상 기준', example: 1.5 })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  siteRiskViolationsPerEmployeeDangerAbove: number;

  @ApiProperty({ description: '현장 상태 - 주의 판정 직원 1인당 위반 건수 이상 기준', example: 0.7 })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  siteRiskViolationsPerEmployeeWarningAbove: number;

  @ApiProperty({ description: '현장 상태 - 위험 판정 총 차단 건수 이상 기준', example: 30 })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  siteRiskTotalViolationsDangerAbove: number;

  @ApiProperty({ description: '현장 상태 - 주의 판정 총 차단 건수 이상 기준', example: 12 })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  siteRiskTotalViolationsWarningAbove: number;

  @ApiProperty({ description: '현장 상태 점수 - 안정 점수 항목 가중치', example: 1 })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(10)
  siteRiskComplianceWeight: number;

  @ApiProperty({ description: '현장 상태 점수 - 직원 1인당 위반 항목 가중치', example: 1 })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(10)
  siteRiskViolationsPerEmployeeWeight: number;

  @ApiProperty({ description: '현장 상태 점수 - 총 차단 항목 가중치', example: 1 })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(10)
  siteRiskTotalViolationsWeight: number;

  @ApiProperty({ description: '현장 상태 점수 - 위험 판정 최소 점수', example: 100 })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 1 })
  @Min(0)
  @Max(1000)
  siteRiskDangerScoreMin: number;

  @ApiProperty({ description: '현장 상태 점수 - 주의 판정 최소 점수', example: 60 })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 1 })
  @Min(0)
  @Max(1000)
  siteRiskWarningScoreMin: number;
}

export class ReportMetricSettingsResponseDto extends ReportMetricSettingsDto {
  @ApiPropertyOptional({ description: '마지막 수정 일시' })
  updatedAt?: Date | null;

  @ApiPropertyOptional({ description: '마지막 수정자 이름' })
  updatedByName?: string | null;
}