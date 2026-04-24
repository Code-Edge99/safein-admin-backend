import {
  BadGatewayException,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppLanguage, Prisma, TranslationJobStatus, TranslatableEntityType } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import { resolveRuntimeStage } from '../config/stage.config';

type TranslationFieldInput = {
  fieldKey: string;
  content: string;
  isHtml?: boolean;
};

type QueueEntityTranslationsParams = {
  entityType: TranslatableEntityType;
  entityId: string;
  sourceUpdatedAt: Date;
  fields: TranslationFieldInput[];
  skipLanguages?: AppLanguage[];
};

type TranslateFieldsOptions = {
  requireTranslation?: boolean;
};

type TranslationApiBatchResponse = {
  items?: Array<{
    translated_text?: string;
  }>;
};

type TranslationApiMultiLangResponse = {
  results?: Partial<Record<AppLanguage, {
    translated_text?: string;
  }>>;
};

type TranslationApiMultiLangHtmlResponse = {
  results?: Partial<Record<AppLanguage, {
    translated_html?: string;
  }>>;
};

class TranslationApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const TRANSLATION_JOB_POLL_MS = 15_000;
const TRANSLATION_JOB_STALE_MS = 5 * 60_000;
const TRANSLATION_JOB_MAX_BACKOFF_MS = 15 * 60_000;

const TRANSLATION_API_DEFAULT_DEV_BASE_URL = 'http://121.138.71.156:8010';
const TRANSLATION_API_DEFAULT_TIMEOUT_MS = 60_000;

const ALL_APP_LANGUAGES = Object.values(AppLanguage);

@Injectable()
export class ContentTranslationService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ContentTranslationService.name);
  private pollingTimer: NodeJS.Timeout | null = null;
  private isProcessingJobs = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  onModuleInit(): void {
    this.startJobPolling();
  }

  onModuleDestroy(): void {
    if (this.pollingTimer) {
      clearInterval(this.pollingTimer);
      this.pollingTimer = null;
    }
  }

  async translatePreview(input: {
    text: string;
    targetLanguage: AppLanguage;
    sourceLanguage?: AppLanguage;
    isHtml?: boolean;
  }): Promise<string> {
    return this.translateText({
      ...input,
      requireTranslation: true,
    });
  }

  async translateFields(
    fields: TranslationFieldInput[],
    targetLanguage: AppLanguage,
    sourceLanguage?: AppLanguage,
    options: TranslateFieldsOptions = {},
  ): Promise<Record<string, string>> {
    const filteredFields = this.normalizeFields(fields);
    if (filteredFields.length === 0 || sourceLanguage === targetLanguage) {
      return Object.fromEntries(filteredFields.map((field) => [field.fieldKey, field.content]));
    }

    const resolvedSourceLanguage = sourceLanguage ?? AppLanguage.ko;
    try {
      return await this.translateFieldsForLanguage(
        filteredFields,
        targetLanguage,
        resolvedSourceLanguage,
        options.requireTranslation === true,
      );
    } catch (error) {
      if (options.requireTranslation === true) {
        throw this.toRequiredTranslationException(error);
      }

      this.logger.warn(`번역 API 호출 실패(target=${targetLanguage}): ${String(error)}`);
      return Object.fromEntries(filteredFields.map((field) => [field.fieldKey, field.content]));
    }
  }

  async storeEntityTranslations(
    entityType: TranslatableEntityType,
    entityId: string,
    language: AppLanguage,
    values: Record<string, string | null | undefined>,
    sourceUpdatedAt: Date,
  ): Promise<void> {
    const entries = this.normalizeFields(
      Object.entries(values).map(([fieldKey, content]) => ({ fieldKey, content: String(content ?? '') })),
    );

    if (entries.length === 0) {
      return;
    }

    const startedAt = Date.now();

    const existingRows = await this.prisma.contentTranslation.findMany({
      where: {
        entityType,
        entityId,
        language,
        fieldKey: { in: entries.map((entry) => entry.fieldKey) },
      },
      select: {
        fieldKey: true,
        sourceUpdatedAt: true,
      },
    });

    const existingByFieldKey = new Map(existingRows.map((row) => [row.fieldKey, row.sourceUpdatedAt.getTime()]));
    const sourceUpdatedAtTime = sourceUpdatedAt.getTime();

    const results = await Promise.all(
      entries.map(async (entry): Promise<'saved' | 'skipped'> => {
        const existingSourceUpdatedAt = existingByFieldKey.get(entry.fieldKey);
        if (existingSourceUpdatedAt && existingSourceUpdatedAt > sourceUpdatedAtTime) {
          return 'skipped';
        }

        await this.prisma.contentTranslation.upsert({
          where: {
            entityType_entityId_fieldKey_language: {
              entityType,
              entityId,
              fieldKey: entry.fieldKey,
              language,
            },
          },
          create: {
            entityType,
            entityId,
            fieldKey: entry.fieldKey,
            language,
            content: entry.content,
            sourceUpdatedAt,
          },
          update: {
            content: entry.content,
            sourceUpdatedAt,
          },
        });

        return 'saved';
      }),
    );

    const savedCount = results.filter((status) => status === 'saved').length;
    const skippedCount = results.length - savedCount;
    this.logger.log(
      `번역 저장 완료(entityType=${entityType}, entityId=${entityId}, language=${language}, entries=${entries.length}, saved=${savedCount}, skipped=${skippedCount}, durationMs=${Date.now() - startedAt})`,
    );
  }

  async deleteEntityTranslations(
    entityType: TranslatableEntityType,
    entityId: string,
    fieldKeys: string[],
    language?: AppLanguage,
  ): Promise<void> {
    const normalizedFieldKeys = fieldKeys
      .map((fieldKey) => fieldKey.trim())
      .filter((fieldKey) => fieldKey.length > 0);

    if (normalizedFieldKeys.length === 0) {
      return;
    }

    await this.prisma.contentTranslation.deleteMany({
      where: {
        entityType,
        entityId,
        fieldKey: { in: normalizedFieldKeys },
        ...(language ? { language } : {}),
      },
    });
  }

  async deletePendingTranslationJobs(
    entityType: TranslatableEntityType,
    entityId: string,
    fieldKeys: string[],
  ): Promise<void> {
    const normalizedFieldKeys = fieldKeys
      .map((fieldKey) => fieldKey.trim())
      .filter((fieldKey) => fieldKey.length > 0);

    if (normalizedFieldKeys.length === 0) {
      return;
    }

    await this.prisma.translationJob.deleteMany({
      where: {
        entityType,
        entityId,
        fieldKeys: { hasSome: normalizedFieldKeys },
        status: { not: TranslationJobStatus.COMPLETED },
      },
    });
  }

  queueTranslationsFromKorean(params: QueueEntityTranslationsParams): void {
    const fields = this.normalizeFields(params.fields);
    if (fields.length === 0) {
      return;
    }

    const skipLanguages = Array.from(new Set([...(params.skipLanguages ?? []), AppLanguage.ko]));
    const queuedAt = new Date();

    void this.prisma.translationJob.upsert({
      where: {
        entityType_entityId_sourceUpdatedAt: {
          entityType: params.entityType,
          entityId: params.entityId,
          sourceUpdatedAt: params.sourceUpdatedAt,
        },
      },
      create: {
        entityType: params.entityType,
        entityId: params.entityId,
        sourceUpdatedAt: params.sourceUpdatedAt,
        fieldKeys: fields.map((field) => field.fieldKey),
        fields: fields as unknown as Prisma.InputJsonValue,
        skipLanguages,
        status: TranslationJobStatus.PENDING,
        attempts: 0,
        nextAttemptAt: queuedAt,
        processingStartedAt: null,
        processedAt: null,
        lastError: null,
      },
      update: {
        fieldKeys: fields.map((field) => field.fieldKey),
        fields: fields as unknown as Prisma.InputJsonValue,
        skipLanguages,
        status: TranslationJobStatus.PENDING,
        attempts: 0,
        nextAttemptAt: queuedAt,
        processingStartedAt: null,
        processedAt: null,
        lastError: null,
      },
    }).then(() => {
      void this.processPendingJobs();
    }).catch((error) => {
      this.logger.warn(
        `번역 작업 등록 실패(entityType=${params.entityType}, entityId=${params.entityId}): ${String(error)}`,
      );
    });
  }

  private startJobPolling(): void {
    if (this.pollingTimer) {
      return;
    }

    this.pollingTimer = setInterval(() => {
      void this.processPendingJobs();
    }, TRANSLATION_JOB_POLL_MS);

    void this.processPendingJobs();
  }

  private async processPendingJobs(): Promise<void> {
    if (this.isProcessingJobs) {
      return;
    }

    this.isProcessingJobs = true;

    try {
      await this.recoverStaleJobs();

      while (true) {
        const job = await this.claimNextJob();
        if (!job) {
          break;
        }

        await this.processJob(job);
      }
    } finally {
      this.isProcessingJobs = false;
    }
  }

  private async recoverStaleJobs(): Promise<void> {
    const staleThreshold = new Date(Date.now() - TRANSLATION_JOB_STALE_MS);
    await this.prisma.translationJob.updateMany({
      where: {
        status: TranslationJobStatus.PROCESSING,
        processingStartedAt: { lt: staleThreshold },
      },
      data: {
        status: TranslationJobStatus.FAILED,
        processingStartedAt: null,
        nextAttemptAt: new Date(),
        lastError: 'stale processing lock recovered',
      },
    });
  }

  private async claimNextJob() {
    const now = new Date();
    const nextJob = await this.prisma.translationJob.findFirst({
      where: {
        status: { in: [TranslationJobStatus.PENDING, TranslationJobStatus.FAILED] },
        nextAttemptAt: { lte: now },
      },
      orderBy: [{ nextAttemptAt: 'asc' }, { createdAt: 'asc' }],
    });

    if (!nextJob) {
      return null;
    }

    const claimed = await this.prisma.translationJob.updateMany({
      where: {
        id: nextJob.id,
        status: { in: [TranslationJobStatus.PENDING, TranslationJobStatus.FAILED] },
      },
      data: {
        status: TranslationJobStatus.PROCESSING,
        processingStartedAt: now,
        lastError: null,
      },
    });

    if (claimed.count === 0) {
      return null;
    }

    return {
      ...nextJob,
      status: TranslationJobStatus.PROCESSING,
      processingStartedAt: now,
      lastError: null,
    };
  }

  private async processJob(job: Awaited<ReturnType<ContentTranslationService['claimNextJob']>>): Promise<void> {
    if (!job) {
      return;
    }

    const fields = this.parseQueuedFields(job.fields);
    if (fields.length === 0) {
      await this.prisma.translationJob.update({
        where: { id: job.id },
        data: {
          status: TranslationJobStatus.COMPLETED,
          processedAt: new Date(),
          processingStartedAt: null,
          lastError: null,
        },
      });
      return;
    }

    try {
      const skipLanguages = new Set(job.skipLanguages ?? []);
      skipLanguages.add(AppLanguage.ko);

      const targetLanguages = ALL_APP_LANGUAGES.filter((language) => !skipLanguages.has(language));
      const translatedValuesByLanguage = await this.translateFieldsToLanguages(
        fields,
        targetLanguages,
        AppLanguage.ko,
        true,
      );

      for (const language of targetLanguages) {
        const translatedValues = translatedValuesByLanguage.get(language);
        if (!translatedValues || Object.keys(translatedValues).length === 0) {
          continue;
        }

        await this.storeEntityTranslations(job.entityType, job.entityId, language, translatedValues, job.sourceUpdatedAt);
      }

      await this.prisma.translationJob.update({
        where: { id: job.id },
        data: {
          status: TranslationJobStatus.COMPLETED,
          processedAt: new Date(),
          processingStartedAt: null,
          lastError: null,
        },
      });
    } catch (error) {
      const attempts = job.attempts + 1;
      const delayMs = Math.min(2 ** Math.min(attempts, 8) * 1000, TRANSLATION_JOB_MAX_BACKOFF_MS);
      await this.prisma.translationJob.update({
        where: { id: job.id },
        data: {
          status: TranslationJobStatus.FAILED,
          attempts,
          nextAttemptAt: new Date(Date.now() + delayMs),
          processingStartedAt: null,
          processedAt: null,
          lastError: String(error),
        },
      });

      this.logger.warn(
        `번역 작업 실패(entityType=${job.entityType}, entityId=${job.entityId}, attempts=${attempts}): ${String(error)}`,
      );
    }
  }

  private normalizeFields(fields: TranslationFieldInput[]): TranslationFieldInput[] {
    const normalizedByFieldKey = new Map<string, TranslationFieldInput>();

    for (const field of fields) {
      const fieldKey = field.fieldKey.trim();
      const content = field.content.trim();
      if (!fieldKey || !content) {
        continue;
      }

      normalizedByFieldKey.set(fieldKey, {
        fieldKey,
        content,
        isHtml: field.isHtml === true,
      });
    }

    return Array.from(normalizedByFieldKey.values());
  }

  private parseQueuedFields(raw: Prisma.JsonValue): TranslationFieldInput[] {
    if (!Array.isArray(raw)) {
      return [];
    }

    const parsed: TranslationFieldInput[] = [];
    for (const entry of raw) {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
        continue;
      }

      const fieldKey = typeof entry.fieldKey === 'string' ? entry.fieldKey : '';
      const content = typeof entry.content === 'string' ? entry.content : '';
      const isHtml = entry.isHtml === true;

      if (!fieldKey.trim() || !content.trim()) {
        continue;
      }

      parsed.push({
        fieldKey: fieldKey.trim(),
        content: content.trim(),
        isHtml,
      });
    }

    return this.normalizeFields(parsed);
  }

  private getDerivedTextFieldKey(htmlFieldKey: string, fieldKeys: Set<string>): string | null {
    if (!htmlFieldKey.endsWith('Html')) {
      return null;
    }

    const textFieldKey = `${htmlFieldKey.slice(0, -4)}Text`;
    return fieldKeys.has(textFieldKey) ? textFieldKey : null;
  }

  private extractTextFromHtml(contentHtml: string): string {
    return contentHtml
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private async translateText(input: {
    text: string;
    targetLanguage: AppLanguage;
    sourceLanguage?: AppLanguage;
    isHtml?: boolean;
    requireTranslation?: boolean;
  }): Promise<string> {
    const text = input.text.trim();
    if (!text || input.sourceLanguage === input.targetLanguage) {
      return input.text;
    }

    try {
      const translated = input.isHtml === true
        ? (await this.translateHtmlToLanguages(
            text,
            input.sourceLanguage ?? AppLanguage.ko,
            [input.targetLanguage],
            input.requireTranslation === true,
          ))[input.targetLanguage]
        : (await this.translateTextToLanguages(
            text,
            input.sourceLanguage ?? AppLanguage.ko,
            [input.targetLanguage],
            input.requireTranslation === true,
          ))[input.targetLanguage];

      if (translated?.trim()) {
        return translated;
      }

      if (input.requireTranslation) {
        throw new BadGatewayException('번역 API 결과가 비어 있습니다.');
      }

      return input.text;
    } catch (error) {
      if (input.requireTranslation) {
        this.logger.warn(`번역 API 테스트/필수 번역 실패(target=${input.targetLanguage}): ${String(error)}`);
        throw this.toRequiredTranslationException(error);
      }

      if (error instanceof ServiceUnavailableException || error instanceof BadGatewayException) {
        throw error;
      }

      this.logger.warn(`번역 API 호출 실패(target=${input.targetLanguage}): ${String(error)}`);
      return input.text;
    }
  }

  private async translateFieldsForLanguage(
    fields: TranslationFieldInput[],
    targetLanguage: AppLanguage,
    sourceLanguage: AppLanguage,
    requireTranslation: boolean,
  ): Promise<Record<string, string>> {
    const translated: Record<string, string> = {};
    const fieldKeys = new Set(fields.map((field) => field.fieldKey));
    const htmlFields = fields.filter((field) => field.isHtml === true);
    const derivedTextFieldKeys = new Set(
      htmlFields
        .map((field) => this.getDerivedTextFieldKey(field.fieldKey, fieldKeys))
        .filter((fieldKey): fieldKey is string => typeof fieldKey === 'string'),
    );
    const plainFields = fields.filter((field) => field.isHtml !== true && !derivedTextFieldKeys.has(field.fieldKey));

    if (plainFields.length > 0) {
      const response = await this.requestTranslationApi<TranslationApiBatchResponse>('/translate/batch', {
        texts: plainFields.map((field) => field.content),
        source_language: sourceLanguage,
        target_language: targetLanguage,
      });

      if ((response.items?.length ?? 0) !== plainFields.length) {
        throw new BadGatewayException('번역 API 응답 개수가 요청과 일치하지 않습니다.');
      }

      plainFields.forEach((field, index) => {
        const translatedText = response.items?.[index]?.translated_text?.trim();
        if (!translatedText && requireTranslation) {
          throw new BadGatewayException('번역 API 결과가 비어 있습니다.');
        }

        translated[field.fieldKey] = translatedText || field.content;
      });
    }

    if (htmlFields.length > 0) {
      const htmlResults = await Promise.all(
        htmlFields.map(async (field) => ({
          fieldKey: field.fieldKey,
          derivedTextFieldKey: this.getDerivedTextFieldKey(field.fieldKey, fieldKeys),
          translated: (await this.translateHtmlToLanguages(field.content, sourceLanguage, [targetLanguage], requireTranslation))[targetLanguage],
          original: field.content,
        })),
      );

      for (const result of htmlResults) {
        if (!result.translated?.trim() && requireTranslation) {
          throw new BadGatewayException('번역 API HTML 결과가 비어 있습니다.');
        }

        const translatedHtml = result.translated || result.original;
        translated[result.fieldKey] = translatedHtml;
        if (result.derivedTextFieldKey) {
          translated[result.derivedTextFieldKey] = this.extractTextFromHtml(translatedHtml);
        }
      }
    }

    return translated;
  }

  private async translateFieldsToLanguages(
    fields: TranslationFieldInput[],
    targetLanguages: AppLanguage[],
    sourceLanguage: AppLanguage,
    requireTranslation: boolean,
  ): Promise<Map<AppLanguage, Record<string, string>>> {
    const uniqueTargets = Array.from(new Set(targetLanguages.filter((language) => language !== sourceLanguage)));
    const translatedByLanguage = new Map<AppLanguage, Record<string, string>>();
    if (uniqueTargets.length === 0 || fields.length === 0) {
      return translatedByLanguage;
    }

    const fieldKeys = new Set(fields.map((field) => field.fieldKey));
    const htmlFields = fields.filter((field) => field.isHtml === true);
    const derivedTextFieldKeys = new Set(
      htmlFields
        .map((field) => this.getDerivedTextFieldKey(field.fieldKey, fieldKeys))
        .filter((fieldKey): fieldKey is string => typeof fieldKey === 'string'),
    );
    const plainFields = fields.filter((field) => field.isHtml !== true && !derivedTextFieldKeys.has(field.fieldKey));

    if (plainFields.length > 0) {
      const textResults = await Promise.all(
        plainFields.map(async (field) => ({
          fieldKey: field.fieldKey,
          translated: await this.translateTextToLanguages(field.content, sourceLanguage, uniqueTargets, requireTranslation),
          original: field.content,
        })),
      );

      for (const fieldResult of textResults) {
        for (const language of uniqueTargets) {
          const current = translatedByLanguage.get(language) ?? {};
          const translatedText = fieldResult.translated[language]?.trim();
          if (!translatedText && requireTranslation) {
            throw new BadGatewayException('번역 API 결과가 비어 있습니다.');
          }

          current[fieldResult.fieldKey] = translatedText || fieldResult.original;
          translatedByLanguage.set(language, current);
        }
      }
    }

    if (htmlFields.length > 0) {
      const htmlResults = await Promise.all(
        htmlFields.map(async (field) => ({
          fieldKey: field.fieldKey,
          derivedTextFieldKey: this.getDerivedTextFieldKey(field.fieldKey, fieldKeys),
          translated: await this.translateHtmlToLanguages(field.content, sourceLanguage, uniqueTargets, requireTranslation),
          original: field.content,
        })),
      );

      for (const fieldResult of htmlResults) {
        for (const language of uniqueTargets) {
          const current = translatedByLanguage.get(language) ?? {};
          const translatedText = fieldResult.translated[language]?.trim();
          if (!translatedText && requireTranslation) {
            throw new BadGatewayException('번역 API HTML 결과가 비어 있습니다.');
          }

          const translatedHtml = translatedText || fieldResult.original;
          current[fieldResult.fieldKey] = translatedHtml;
          if (fieldResult.derivedTextFieldKey) {
            current[fieldResult.derivedTextFieldKey] = this.extractTextFromHtml(translatedHtml);
          }
          translatedByLanguage.set(language, current);
        }
      }
    }

    return translatedByLanguage;
  }

  private async translateTextToLanguages(
    text: string,
    sourceLanguage: AppLanguage,
    targetLanguages: AppLanguage[],
    requireTranslation: boolean,
  ): Promise<Partial<Record<AppLanguage, string>>> {
    const response = await this.requestTranslationApi<TranslationApiMultiLangResponse>('/translate/multilang', {
      text,
      source_language: sourceLanguage,
      target_languages: targetLanguages,
    });

    const translated: Partial<Record<AppLanguage, string>> = {};
    for (const language of targetLanguages) {
      const value = response.results?.[language]?.translated_text?.trim();
      if (!value && requireTranslation) {
        throw new BadGatewayException('번역 API 결과가 비어 있습니다.');
      }

      translated[language] = value || text;
    }

    return translated;
  }

  private async translateHtmlToLanguages(
    html: string,
    sourceLanguage: AppLanguage,
    targetLanguages: AppLanguage[],
    requireTranslation: boolean,
  ): Promise<Partial<Record<AppLanguage, string>>> {
    const response = await this.requestTranslationApi<TranslationApiMultiLangHtmlResponse>('/translate/multilang/html', {
      html,
      source_language: sourceLanguage,
      target_languages: targetLanguages,
    });

    const translated: Partial<Record<AppLanguage, string>> = {};
    for (const language of targetLanguages) {
      const value = response.results?.[language]?.translated_html?.trim();
      if (!value && requireTranslation) {
        throw new BadGatewayException('번역 API HTML 결과가 비어 있습니다.');
      }

      translated[language] = value || html;
    }

    return translated;
  }

  private async requestTranslationApi<T>(path: string, payload: Record<string, unknown>): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.getTranslationApiTimeoutMs());
    const startedAt = Date.now();
    const requestSummary = this.buildTranslationRequestSummary(path, payload);
    let responseStatus: number | null = null;

    try {
      const response = await fetch(`${this.getTranslationApiBaseUrl()}${path}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      responseStatus = response.status;

      if (!response.ok) {
        const responseText = await response.text();
        this.logger.warn(
          `번역 요청 실패(${requestSummary}, status=${response.status}, durationMs=${Date.now() - startedAt}): ${responseText}`,
        );
        throw new TranslationApiError(response.status, responseText || `HTTP ${response.status}`);
      }

      const result = await response.json() as T;
      this.logger.log(`번역 요청 완료(${requestSummary}, durationMs=${Date.now() - startedAt})`);
      return result;
    } catch (error) {
      if (responseStatus === null) {
        this.logger.warn(`번역 요청 예외(${requestSummary}, durationMs=${Date.now() - startedAt}): ${String(error)}`);
      }

      if (error instanceof Error && error.name === 'AbortError') {
        throw new TranslationApiError(504, `timeout after ${this.getTranslationApiTimeoutMs()}ms`);
      }

      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  private buildTranslationRequestSummary(path: string, payload: Record<string, unknown>): string {
    const parts = [`path=${path}`];

    if (typeof payload.source_language === 'string') {
      parts.push(`source=${payload.source_language}`);
    }

    if (typeof payload.target_language === 'string') {
      parts.push(`target=${payload.target_language}`);
    }

    if (Array.isArray(payload.target_languages)) {
      parts.push(`targets=${payload.target_languages.length}`);
    }

    if (typeof payload.text === 'string') {
      parts.push(`textChars=${payload.text.length}`);
    }

    if (typeof payload.html === 'string') {
      parts.push(`htmlChars=${payload.html.length}`);
    }

    if (Array.isArray(payload.texts)) {
      const texts = payload.texts.filter((value): value is string => typeof value === 'string');
      parts.push(`texts=${texts.length}`);
      parts.push(`textsTotalChars=${texts.reduce((total, text) => total + text.length, 0)}`);
    }

    return parts.join(', ');
  }

  private toRequiredTranslationException(error: unknown): BadGatewayException | ServiceUnavailableException {
    if (error instanceof ServiceUnavailableException || error instanceof BadGatewayException) {
      return error;
    }

    if (error instanceof TranslationApiError) {
      if (error.status === 503 || error.status === 504) {
        return new ServiceUnavailableException('번역 API를 사용할 수 없습니다. 잠시 후 다시 시도해주세요.');
      }

      return new BadGatewayException('번역 API 호출에 실패했습니다. 잠시 후 다시 시도해주세요.');
    }

    return new BadGatewayException('번역 API 호출에 실패했습니다. 잠시 후 다시 시도해주세요.');
  }

  private getTranslationApiBaseUrl(): string {
    const configuredBaseUrl = this.configService.get<string>('TRANSLATOR_API_URL')?.trim()
      || this.configService.get<string>('TRANSLATION_API_URL')?.trim();

    if (configuredBaseUrl) {
      return configuredBaseUrl.replace(/\/+$/, '');
    }

    if (resolveRuntimeStage(this.configService) === 'dev') {
      return TRANSLATION_API_DEFAULT_DEV_BASE_URL;
    }

    throw new TranslationApiError(503, 'TRANSLATOR_API_URL is not configured for the current stage.');
  }

  private getTranslationApiTimeoutMs(): number {
    const rawValue = Number(
      this.configService.get<string>('TRANSLATOR_API_TIMEOUT_MS')
      ?? this.configService.get<string>('TRANSLATION_API_TIMEOUT_MS')
      ?? TRANSLATION_API_DEFAULT_TIMEOUT_MS,
    );
    return Number.isFinite(rawValue) && rawValue > 0 ? rawValue : TRANSLATION_API_DEFAULT_TIMEOUT_MS;
  }
}