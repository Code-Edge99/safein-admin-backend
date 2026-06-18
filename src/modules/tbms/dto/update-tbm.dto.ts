import { ApiPropertyOptional } from '@nestjs/swagger';
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
import { normalizeOptionalInt, normalizeOptionalString, parseStringArray } from './create-tbm.dto';

export class UpdateTbmDto {
  @ApiPropertyOptional({ description: 'TBM 제목', example: '고소작업 안전교육' })
  @Transform(({ value }) => normalizeOptionalString(value))
  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;

  @ApiPropertyOptional({ description: '작업 장소', example: 'A동 3층 외벽' })
  @Transform(({ value }) => normalizeOptionalString(value))
  @IsOptional()
  @IsString()
  @MaxLength(200)
  location?: string;

  @ApiPropertyOptional({ description: '작업 내용', example: '외벽 보수 작업 전 안전수칙 공유' })
  @Transform(({ value }) => normalizeOptionalString(value))
  @IsOptional()
  @IsString()
  workContent?: string;

  @ApiPropertyOptional({ description: '위험요소 목록', type: [String], example: ['추락', '낙하물'] })
  @Transform(({ value }) => (value === undefined ? undefined : parseStringArray(value)))
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  hazards?: string[];

  @ApiPropertyOptional({ description: '안전수칙 목록', type: [String], example: ['안전대 착용'] })
  @Transform(({ value }) => (value === undefined ? undefined : parseStringArray(value)))
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  safetyRules?: string[];

  @ApiPropertyOptional({ description: '교육 예정일시 UTC ISO 문자열. 날짜와 시간을 그대로 저장합니다.', example: '2026-06-17T00:30:00.000Z' })
  @Transform(({ value }) => normalizeOptionalString(value))
  @IsOptional()
  @IsDateString()
  @Matches(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/)
  scheduledDate?: string;

  @ApiPropertyOptional({
    description: '참석자 직원 ID 목록. 전달하면 참석자 전체를 이 목록으로 교체합니다. 유지되는 참석자의 확인 상태는 보존됩니다.',
    type: [String],
    example: ['01012345678', '01098765432'],
  })
  @Transform(({ value }) => (value === undefined ? undefined : parseStringArray(value)))
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  attendeeEmployeeIds?: string[];

  @ApiPropertyOptional({ description: '스크립트 텍스트', example: '오늘 작업 전 안전대 착용 상태를 확인합니다.' })
  @Transform(({ value }) => normalizeOptionalString(value))
  @IsOptional()
  @IsString()
  transcriptText?: string;

  @ApiPropertyOptional({ description: '새 음성 파일과 함께 전달하는 음성 길이(초)', example: 82 })
  @Transform(({ value }) => normalizeOptionalInt(value))
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(24 * 60 * 60)
  audioDurationSec?: number;

  @ApiPropertyOptional({
    description: '삭제할 첨부파일 ID 목록. 전달한 ID의 첨부파일을 제거합니다.',
    type: [String],
    example: ['att-001'],
  })
  @Transform(({ value }) => (value === undefined ? undefined : parseStringArray(value)))
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  removeAttachmentIds?: string[];

  @ApiPropertyOptional({
    description: '원본 음성 삭제 여부. `true`이면 기존 음성을 제거합니다. 새 음성 파일을 함께 업로드하면 교체됩니다.',
    example: false,
  })
  @Transform(({ value }) => {
    if (value === undefined || value === null) {
      return undefined;
    }
    if (typeof value === 'boolean') {
      return value;
    }
    return String(value).trim().toLowerCase() === 'true';
  })
  @IsOptional()
  removeAudio?: boolean;
}
