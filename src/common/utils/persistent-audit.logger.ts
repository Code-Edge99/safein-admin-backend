import { ConsoleLogger } from '@nestjs/common';
import { AuditAction } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

type PersistLogLevel = 'log' | 'warn' | 'error' | 'debug' | 'verbose';

type PersistentAuditLoggerOptions = {
  source: string;
  enabled: boolean;
  levels: Set<PersistLogLevel>;
  maxMessageLength?: number;
};

export class PersistentAuditLogger extends ConsoleLogger {
  private readonly source: string;
  private readonly enabled: boolean;
  private readonly levels: Set<PersistLogLevel>;
  private readonly maxMessageLength: number;

  constructor(
    private readonly prisma: PrismaService,
    options: PersistentAuditLoggerOptions,
  ) {
    super();
    this.source = options.source;
    this.enabled = options.enabled;
    this.levels = options.levels;
    this.maxMessageLength = options.maxMessageLength ?? 1600;
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
    if (!this.enabled || !this.levels.has(level)) {
      return;
    }

    const normalizedMessage = this.normalizeMessage(message);
    if (!normalizedMessage) {
      return;
    }

    const normalizedContext = this.normalizeMessage(context) || 'Application';
    const timestamp = new Date();

    void this.prisma.auditLog.create({
      data: {
        action: AuditAction.UPDATE,
        resourceType: 'system-log',
        resourceName: this.truncate(`${this.source} ${level.toUpperCase()} ${normalizedMessage}`, 200),
        changesAfter: {
          source: this.source,
          level,
          context: normalizedContext,
          message: normalizedMessage,
          trace: trace ? this.truncate(this.normalizeMessage(trace), this.maxMessageLength) : null,
          loggedAt: timestamp.toISOString(),
        },
        timestamp,
      },
    }).catch((error) => {
      const fallback = `[PersistentAuditLogger] audit_log persist failed: ${String(error)}\n`;
      try {
        process.stderr.write(fallback);
      } catch {
        // ignore stderr failures
      }
    });
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

    return `${value.slice(0, maxLength - 1)}...`;
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