import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNumber, Max, Min } from 'class-validator';

const numberMessage = '숫자만 입력할 수 있으며 소수점은 최대 2자리까지 가능합니다.';

export class ReportMetricSettingsDto {
  @ApiProperty({ description: '안정 점수 계산식 - 앱 차단 가중치', example: 1 })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 }, { message: numberMessage })
  @Min(0, { message: '앱 차단 가중치는 0 이상이어야 합니다.' })
  @Max(10, { message: '앱 차단 가중치는 10 이하여야 합니다.' })
  complianceAppBlockWeight: number;

  @ApiProperty({ description: '안정 점수 계산식 - 행동 차단 가중치', example: 1 })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 }, { message: numberMessage })
  @Min(0, { message: '행동 차단 가중치는 0 이상이어야 합니다.' })
  @Max(10, { message: '행동 차단 가중치는 10 이하여야 합니다.' })
  complianceBehaviorBlockWeight: number;

  @ApiProperty({ description: '직원 안정 점수 배지 - 우수 최소값(%)', example: 95 })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 }, { message: numberMessage })
  @Min(0, { message: '우수 배지 기준은 0 이상이어야 합니다.' })
  @Max(100, { message: '우수 배지 기준은 100 이하여야 합니다.' })
  complianceBadgeExcellentMin: number;

  @ApiProperty({ description: '직원 안정 점수 배지 - 양호 최소값(%)', example: 85 })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 }, { message: numberMessage })
  @Min(0, { message: '양호 배지 기준은 0 이상이어야 합니다.' })
  @Max(100, { message: '양호 배지 기준은 100 이하여야 합니다.' })
  complianceBadgeGoodMin: number;

  @ApiProperty({ description: '직원 안정 점수 배지 - 보통 최소값(%)', example: 70 })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 }, { message: numberMessage })
  @Min(0, { message: '보통 배지 기준은 0 이상이어야 합니다.' })
  @Max(100, { message: '보통 배지 기준은 100 이하여야 합니다.' })
  complianceBadgeFairMin: number;

  @ApiProperty({ description: '현장 상태 - 위험 안정 점수 미만 기준(%)', example: 80 })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 }, { message: numberMessage })
  @Min(0, { message: '현장 위험 안정 점수 기준은 0 이상이어야 합니다.' })
  @Max(100, { message: '현장 위험 안정 점수 기준은 100 이하여야 합니다.' })
  siteRiskComplianceDangerBelow: number;

  @ApiProperty({ description: '현장 상태 - 주의 안정 점수 미만 기준(%)', example: 90 })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 }, { message: numberMessage })
  @Min(0, { message: '현장 주의 안정 점수 기준은 0 이상이어야 합니다.' })
  @Max(100, { message: '현장 주의 안정 점수 기준은 100 이하여야 합니다.' })
  siteRiskComplianceWarningBelow: number;

  @ApiProperty({ description: '현장 상태 - 위험 직원 1인당 위반 건수 이상 기준', example: 1.5 })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 }, { message: numberMessage })
  @Min(0, { message: '직원 1인당 위험 위반 기준은 0 이상이어야 합니다.' })
  @Max(100, { message: '직원 1인당 위험 위반 기준은 100 이하여야 합니다.' })
  siteRiskViolationsPerEmployeeDangerAbove: number;

  @ApiProperty({ description: '현장 상태 - 주의 직원 1인당 위반 건수 이상 기준', example: 0.7 })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 }, { message: numberMessage })
  @Min(0, { message: '직원 1인당 주의 위반 기준은 0 이상이어야 합니다.' })
  @Max(100, { message: '직원 1인당 주의 위반 기준은 100 이하여야 합니다.' })
  siteRiskViolationsPerEmployeeWarningAbove: number;

  @ApiProperty({ description: '현장 상태 점수 - 안정 점수 항목 가중치', example: 1 })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 }, { message: numberMessage })
  @Min(0, { message: '현장 안정 점수 가중치는 0 이상이어야 합니다.' })
  @Max(10, { message: '현장 안정 점수 가중치는 10 이하여야 합니다.' })
  siteRiskComplianceWeight: number;

  @ApiProperty({ description: '현장 상태 점수 - 직원 1인당 위반 항목 가중치', example: 1 })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 }, { message: numberMessage })
  @Min(0, { message: '직원 1인당 위반 가중치는 0 이상이어야 합니다.' })
  @Max(10, { message: '직원 1인당 위반 가중치는 10 이하여야 합니다.' })
  siteRiskViolationsPerEmployeeWeight: number;

  @ApiProperty({ description: '현장 상태 점수 - 위험 최소 점수', example: 60 })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 }, { message: numberMessage })
  @Min(0, { message: '현장 위험 점수 기준은 0 이상이어야 합니다.' })
  @Max(100, { message: '현장 위험 점수 기준은 100 이하여야 합니다.' })
  siteRiskDangerScoreMin: number;

  @ApiProperty({ description: '현장 상태 점수 - 주의 최소 점수', example: 20 })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 }, { message: numberMessage })
  @Min(0, { message: '현장 주의 점수 기준은 0 이상이어야 합니다.' })
  @Max(100, { message: '현장 주의 점수 기준은 100 이하여야 합니다.' })
  siteRiskWarningScoreMin: number;
}

export class ReportMetricSettingsResponseDto extends ReportMetricSettingsDto {
  @ApiPropertyOptional({ description: '마지막 수정 일시' })
  updatedAt?: Date | null;

  @ApiPropertyOptional({ description: '마지막 수정자 이름' })
  updatedByName?: string | null;
}
