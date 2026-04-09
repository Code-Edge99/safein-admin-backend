import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, Matches } from 'class-validator';

const KST_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export class ReaggregateDayDto {
  @ApiProperty({
    description: '재집계 기준 일자(KST).',
    example: '2026-03-13',
  })
  @IsString()
  @Matches(KST_DATE_PATTERN, { message: 'date는 YYYY-MM-DD 형식이어야 합니다.' })
  date: string;

  @ApiPropertyOptional({
    description: '대상 현장 ID. 미입력 시 본인 권한 범위 전체에 대해 실행됩니다.',
    example: 'org-123',
  })
  @IsString()
  @IsOptional()
  organizationId?: string;
}
