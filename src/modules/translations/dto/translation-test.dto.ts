import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { TranslatableEntityType } from '@prisma/client';
import { Transform } from 'class-transformer';
import { IsBoolean, IsEnum, IsIn, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { normalizeAppLanguage, SUPPORTED_APP_LANGUAGE_VALUES } from '@/common/translation/app-language.util';

export enum TranslationRebuildArea {
  NOTICE = 'NOTICE',
  CONTROL_POLICY = 'CONTROL_POLICY',
  INCIDENT_REPORT = 'INCIDENT_REPORT',
  ZONE = 'ZONE',
  TIME_POLICY = 'TIME_POLICY',
  BEHAVIOR_CONDITION = 'BEHAVIOR_CONDITION',
  ALLOWED_APP_PRESET = 'ALLOWED_APP_PRESET',
  ALLOWED_APP = 'ALLOWED_APP',
}

export class TranslationTestRequestDto {
  @ApiProperty({ description: '번역할 원문', example: '현장 기본 통제 정책' })
  @IsString()
  @IsNotEmpty()
  text: string;

  @ApiProperty({ description: '대상 언어', enum: SUPPORTED_APP_LANGUAGE_VALUES, example: 'en' })
  @Transform(({ value }) => normalizeAppLanguage(value) ?? value)
  @IsString()
  @IsIn(SUPPORTED_APP_LANGUAGE_VALUES)
  targetLanguage: string;

  @ApiPropertyOptional({ description: '원본 언어', enum: SUPPORTED_APP_LANGUAGE_VALUES, example: 'ko' })
  @Transform(({ value }) => normalizeAppLanguage(value) ?? value)
  @IsOptional()
  @IsString()
  @IsIn(SUPPORTED_APP_LANGUAGE_VALUES)
  sourceLanguage?: string;

  @ApiPropertyOptional({ description: 'HTML 여부', default: false })
  @IsOptional()
  @IsBoolean()
  isHtml?: boolean;
}

export class TranslationTestResponseDto {
  @ApiProperty({ description: '원문' })
  text: string;

  @ApiProperty({ description: '대상 언어', enum: SUPPORTED_APP_LANGUAGE_VALUES })
  targetLanguage: string;

  @ApiPropertyOptional({ description: '원본 언어', enum: SUPPORTED_APP_LANGUAGE_VALUES })
  sourceLanguage?: string;

  @ApiProperty({ description: '번역 결과' })
  translatedText: string;

  @ApiProperty({ description: 'HTML 번역 여부' })
  isHtml: boolean;
}

export class SupportedTranslationLanguageDto {
  @ApiProperty({ description: '앱 언어 코드', enum: SUPPORTED_APP_LANGUAGE_VALUES })
  appLanguage: string;

  @ApiProperty({ description: '번역 API 언어 코드', example: 'en' })
  translationLanguage: string;

  @ApiProperty({ description: '영문 언어명', example: 'English' })
  englishName: string;

  @ApiProperty({ description: '한글 언어명', example: '영어' })
  koreanName: string;
}

export class TranslationRebuildRequestDto {
  @ApiProperty({
    description: '재번역할 영역',
    enum: TranslationRebuildArea,
    example: TranslationRebuildArea.NOTICE,
  })
  @IsEnum(TranslationRebuildArea)
  area: TranslationRebuildArea;

  @ApiPropertyOptional({
    description: '특정 엔티티 ID만 재번역하려면 지정합니다. 생략하면 해당 영역 전체를 재번역합니다.',
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  entityId?: string;
}

export class TranslationRebuildResultDto {
  @ApiProperty({ description: '실제 처리된 번역 엔티티 타입', enum: TranslatableEntityType })
  entityType: TranslatableEntityType;

  @ApiProperty({ description: '처리된 레코드 수' })
  processedCount: number;

  @ApiProperty({ description: '재번역 큐에 등록한 레코드 수' })
  queuedCount: number;

  @ApiProperty({ description: '빈 값이라 기존 번역본/대기잡을 정리한 레코드 수' })
  clearedCount: number;
}

export class TranslationRebuildResponseDto {
  @ApiProperty({ description: '요청한 재번역 영역', enum: TranslationRebuildArea })
  area: TranslationRebuildArea;

  @ApiPropertyOptional({ description: '요청한 특정 엔티티 ID', nullable: true })
  entityId: string | null;

  @ApiProperty({ description: '전체 처리 대상 수' })
  processedCount: number;

  @ApiProperty({ type: [TranslationRebuildResultDto] })
  results: TranslationRebuildResultDto[];
}