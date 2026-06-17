import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export function normalizeOptionalString(value: unknown): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  const trimmed = String(value).trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function parseStringArray(value: unknown): string[] {
  if (value === undefined || value === null || value === '') {
    return [];
  }

  if (Array.isArray(value)) {
    return value
      .map((entry) => String(entry ?? '').trim())
      .filter(Boolean);
  }

  const raw = String(value).trim();
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed
        .map((entry) => String(entry ?? '').trim())
        .filter(Boolean);
    }
  } catch {
    // multipart fallback below
  }

  return raw
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export function normalizeOptionalInt(value: unknown): number | undefined {
  const normalized = normalizeOptionalString(value);
  if (normalized === undefined) {
    return undefined;
  }

  return Number(normalized);
}

export class CreateTbmDto {
  @ApiProperty({
    description: '생성 주체 직원 ID. 관리자 페이지에는 직원 로그인 세션이 없으므로 작성자(생성 주체)를 직접 지정합니다. 같은 회사 범위 안의 활성 직원이어야 합니다.',
    example: '01011112222',
  })
  @Transform(({ value }) => normalizeOptionalString(value))
  @IsString()
  authorEmployeeId!: string;

  @ApiProperty({ description: 'TBM 제목. 입력한 원문(한국어) 그대로 저장됩니다.', example: '고소작업 안전교육' })
  @IsString()
  @MaxLength(200)
  title!: string;

  @ApiProperty({ description: '작업 장소. 목록에도 표시됩니다.', example: 'A동 3층 외벽' })
  @IsString()
  @MaxLength(200)
  location!: string;

  @ApiProperty({ description: '작업 내용. 번역 대상에 포함됩니다.', example: '외벽 보수 작업 전 안전수칙 공유' })
  @IsString()
  workContent!: string;

  @ApiPropertyOptional({
    description: '위험요소 목록. multipart 요청에서는 JSON 문자열 배열을 권장합니다. 예: `["추락","낙하물"]`',
    type: [String],
    example: ['추락', '낙하물'],
  })
  @Transform(({ value }) => parseStringArray(value))
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  hazards?: string[];

  @ApiPropertyOptional({
    description: '안전수칙 목록. multipart 요청에서는 JSON 문자열 배열을 권장합니다. 예: `["안전대 착용","작업 전 발판 확인"]`',
    type: [String],
    example: ['안전대 착용', '작업 전 발판 확인'],
  })
  @Transform(({ value }) => parseStringArray(value))
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  safetyRules?: string[];

  @ApiPropertyOptional({
    description: '교육 예정일 UTC ISO 문자열. 서버는 전달된 UTC 시각을 KST 날짜로 환산해 저장합니다. 생략하면 서버 KST 기준 오늘 날짜가 저장됩니다.',
    example: '2026-06-16T15:00:00.000Z',
  })
  @Transform(({ value }) => normalizeOptionalString(value))
  @IsOptional()
  @IsDateString()
  @Matches(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/)
  scheduledDate?: string;

  @ApiProperty({
    description: '참석자(교육 대상) 직원 ID 목록. 같은 회사 범위 안의 활성 직원이어야 합니다. multipart 요청에서는 JSON 문자열 배열을 권장합니다.',
    type: [String],
    example: ['01012345678', '01098765432'],
  })
  @Transform(({ value }) => parseStringArray(value))
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  attendeeEmployeeIds!: string[];

  @ApiPropertyOptional({
    description: '원본 음성과 함께 보관할 스크립트 텍스트. 값이 있으면 번역 대상에 포함합니다.',
    example: '오늘 작업 전 안전대 착용 상태를 반드시 확인합니다.',
  })
  @Transform(({ value }) => normalizeOptionalString(value))
  @IsOptional()
  @IsString()
  transcriptText?: string;

  @ApiPropertyOptional({ description: '원본 음성 길이(초). 전달값만 저장합니다.', example: 82 })
  @Transform(({ value }) => normalizeOptionalInt(value))
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(24 * 60 * 60)
  audioDurationSec?: number;
}
