import { ConsoleLogger } from '@nestjs/common';
import { AuditAction, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  createApplicationLogSummary,
  PersistLogLevel,
} from './system-log-summary.util';
import { SlackLogNotifier } from './slack-log.notifier';

type PersistentAuditLoggerOptions = {
  source: string;
  enabled: boolean;
  levels: Set<PersistLogLevel>;
  maxMessageLength?: number;
  slackNotifier?: SlackLogNotifier;
};

export class PersistentAuditLogger extends ConsoleLogger {
  private readonly source: string;
  private readonly enabled: boolean;
  private readonly levels: Set<PersistLogLevel>;
  private readonly maxMessageLength: number;
  private readonly slackNotifier?: SlackLogNotifier;

  constructor(
    private readonly prisma: PrismaService,
    options: PersistentAuditLoggerOptions,
  ) {
    super();
    this.source = options.source;
    this.enabled = options.enabled;
    this.levels = options.levels;
    this.maxMessageLength = options.maxMessageLength ?? 1600;
    this.slackNotifier = options.slackNotifier;
  }

  override log(message: any, context?: string): void {
    super.log(message, context);
    this.persist('log', message, context);
  }

  override warn(message: any, context?: string): void {
    super.warn(message, context);
    this.persist('warn', message, context);
  }

  override error(message: any, stack?: string, context?: string): void {
    super.error(message, stack, context);
    this.persist('error', message, context, stack);
  }

  override debug(message: any, context?: string): void {
    super.debug(message, context);
    this.persist('debug', message, context);
  }

  override verbose(message: any, context?: string): void {
    super.verbose(message, context);
    this.persist('verbose', message, context);
  }

  private persist(level: PersistLogLevel, message: unknown, context?: string, trace?: string): void {
    this.slackNotifier?.notify(level, message, context, trace);

    if (!this.enabled || !this.levels.has(level)) {
      return;
    }

    const normalizedMessage = this.normalizeMessage(message);
    if (!normalizedMessage) {
      return;
    }

    const normalizedContext = this.normalizeMessage(context) || 'Application';
    if (this.shouldSkipPersistence(level, normalizedContext, normalizedMessage)) {
      return;
    }

    // HTTP 요청 로그는 RequestLoggingInterceptor에서 구조화하여 저장하므로 중복 저장을 방지한다.
    if (normalizedContext === 'RequestLoggingInterceptor') {
      return;
    }

    const timestamp = new Date();
    const summary = createApplicationLogSummary({
      level,
      context: normalizedContext,
      message: normalizedMessage,
    });

    const traceMessage = trace ? this.truncate(this.normalizeMessage(trace), this.maxMessageLength) : null;

    void this.persistAuditLogWithFallback({
      level,
      normalizedMessage,
      normalizedContext,
      traceMessage,
      timestamp,
      summary,
    });
  }

  private shouldSkipPersistence(level: PersistLogLevel, context: string, message: string): boolean {
    if (context !== 'ContentTranslationService') {
      return false;
    }

    if (level === 'warn' || level === 'error') {
      return false;
    }

    return message.startsWith('번역 저장 완료(')
      || message.startsWith('번역 요청 완료(');
  }

  private async persistAuditLogWithFallback(params: {
    level: PersistLogLevel;
    normalizedMessage: string;
    normalizedContext: string;
    traceMessage: string | null;
    timestamp: Date;
    summary: ReturnType<typeof createApplicationLogSummary>;
  }): Promise<void> {
    const fullData = this.buildAuditLogData(params, false);

    try {
      await this.prisma.auditLog.create({ data: fullData });
      return;
    } catch (error) {
      if (!this.isValueTooLongError(error)) {
        this.reportPersistFailure(error);
        return;
      }
    }

    const compactData = this.buildAuditLogData(params, true);
    try {
      await this.prisma.auditLog.create({ data: compactData });
    } catch (error) {
      this.reportPersistFailure(error);
    }
  }

  private buildAuditLogData(
    params: {
      level: PersistLogLevel;
      normalizedMessage: string;
      normalizedContext: string;
      traceMessage: string | null;
      timestamp: Date;
      summary: ReturnType<typeof createApplicationLogSummary>;
    },
    compact: boolean,
  ): Prisma.AuditLogCreateInput {
    const resourceNameLimit = compact ? 80 : 200;
    const messageLimit = compact ? 120 : this.maxMessageLength;
    const contextLimit = compact ? 80 : this.maxMessageLength;
    const traceLimit = compact ? 120 : this.maxMessageLength;

    return {
      action: AuditAction.UPDATE,
      resourceType: 'system-log',
      resourceName: this.truncate(
        `${this.source} ${params.level.toUpperCase()} ${params.normalizedMessage}`,
        resourceNameLimit,
      ),
      changesAfter: {
        schemaVersion: 'system-log-v1',
        eventKind: 'application-log',
        category: params.summary.category,
        summary: {
          action: params.summary.action,
          target: params.summary.target,
          details: params.summary.details,
          severity: params.summary.severity,
          result: params.summary.result,
          category: params.summary.category,
        } as Prisma.InputJsonObject,
        source: this.truncate(this.source, compact ? 32 : 100),
        level: params.level,
        context: this.truncate(params.normalizedContext, contextLimit),
        message: this.truncate(params.normalizedMessage, messageLimit),
        trace: params.traceMessage ? this.truncate(params.traceMessage, traceLimit) : null,
        loggedAt: params.timestamp.toISOString(),
      },
      timestamp: params.timestamp,
    };
  }

  private isValueTooLongError(error: unknown): boolean {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2000') {
      return true;
    }

    const errorMessage = String(error);
    return errorMessage.includes('provided value for the column is too long')
      || errorMessage.includes('The provided value for the column is too long')
      || errorMessage.includes('value too long for type');
  }

  private reportPersistFailure(error: unknown): void {
    const fallback = `[PersistentAuditLogger] audit_log persist failed: ${String(error)}\n`;
    try {
      process.stderr.write(fallback);
    } catch {
      // ignore stderr failures
    }
  }

  private normalizeMessage(value: unknown): string {
    if (value === null || value === undefined) {
      return '';
    }

    if (typeof value === 'string') {
      return this.truncate(value.trim(), this.maxMessageLength);
    }

    if (value instanceof Error) {
      return this.truncate(`${value.name}: ${value.message}`, this.maxMessageLength);
    }

    try {
      return this.truncate(JSON.stringify(value), this.maxMessageLength);
    } catch {
      return this.truncate(String(value), this.maxMessageLength);
    }
  }

  private truncate(value: string, maxLength: number): string {
    if (value.length <= maxLength) {
      return value;
    }

    if (maxLength <= 3) {
      return value.slice(0, maxLength);
    }

    return `${value.slice(0, maxLength - 3)}...`;
  }
}

export function parsePersistLogLevels(raw: string | undefined): Set<PersistLogLevel> {
  const allowed: PersistLogLevel[] = ['log', 'warn', 'error', 'debug', 'verbose'];
  const parsed = (raw ?? 'log,warn,error')
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter((item): item is PersistLogLevel => allowed.includes(item as PersistLogLevel));

  return new Set(parsed.length > 0 ? parsed : ['log', 'warn', 'error']);
}

export function parseBoolean(raw: string | undefined, fallback: boolean): boolean {
  if (!raw) {
    return fallback;
  }

  const normalized = raw.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) {
    return true;
  }
  if (['0', 'false', 'no', 'off'].includes(normalized)) {
    return false;
  }

  return fallback;
}