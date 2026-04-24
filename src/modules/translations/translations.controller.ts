import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { AppLanguage } from '@prisma/client';
import { SkipTransform } from '@/common/decorators/skip-transform.decorator';
import { ContentTranslationService } from '@/common/translation/translation.service';
import { resolveAppLanguage } from '@/common/translation/app-language.util';
import { JwtAuthGuard } from '@/modules/auth/guards/jwt-auth.guard';
import {
  SupportedTranslationLanguageDto,
  TranslationRebuildRequestDto,
  TranslationRebuildResponseDto,
  TranslationTestRequestDto,
  TranslationTestResponseDto,
} from './dto/translation-test.dto';
import { TranslationsService } from './translations.service';

@ApiTags('번역')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@SkipTransform()
@Controller('translations')
export class TranslationsController {
  constructor(
    private readonly contentTranslationService: ContentTranslationService,
    private readonly translationsService: TranslationsService,
  ) {}

  @Get('languages')
  @ApiOperation({ summary: '현재 지원 언어 목록 조회' })
  @ApiResponse({ status: 200, type: [SupportedTranslationLanguageDto] })
  getSupportedLanguages(): SupportedTranslationLanguageDto[] {
    return this.translationsService.getSupportedLanguages();
  }

  @Post('test')
  @ApiOperation({ summary: '번역 API 테스트 번역' })
  @ApiResponse({ status: 200, type: TranslationTestResponseDto })
  async testTranslation(@Body() dto: TranslationTestRequestDto): Promise<TranslationTestResponseDto> {
    const targetLanguage = resolveAppLanguage(dto.targetLanguage);
    const sourceLanguage = dto.sourceLanguage
      ? resolveAppLanguage(dto.sourceLanguage)
      : undefined;

    const translatedText = await this.contentTranslationService.translatePreview({
      text: dto.text,
      targetLanguage,
      sourceLanguage,
      isHtml: dto.isHtml === true,
    });

    return {
      text: dto.text,
      targetLanguage,
      sourceLanguage: sourceLanguage ?? AppLanguage.ko,
      translatedText,
      isHtml: dto.isHtml === true,
    };
  }

  @Post('rebuild')
  @ApiOperation({ summary: '번역 영역 수동 재생성' })
  @ApiResponse({ status: 200, type: TranslationRebuildResponseDto })
  rebuildTranslations(@Body() dto: TranslationRebuildRequestDto): Promise<TranslationRebuildResponseDto> {
    return this.translationsService.rebuildTranslations(dto);
  }
}