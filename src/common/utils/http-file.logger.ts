import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { appendFile, mkdir } from 'node:fs/promises';
import * as path from 'node:path';

type HttpFileLoggerOptions = {
  source: string;
  filePathEnvKey: string;
  enabledEnvKey: string;
  defaultFilePrefix: string;
};

export type HttpFileLogEntry = {
  method: string;
  url: string;
  route?: string;
  statusCode: number;
  durationMs: number;
  ipAddress?: string | null;
  userAgent?: string | null;
  resourceType?: string;
  resourceId?: string;
  result?: 'success' | 'failure';
  severity?: 'success' | 'warning' | 'error';
  eventCode?: string;
  actor?: Record<string, unknown> | null;
  query?: Record<string, unknown> | null;
  request?: Record<string, unknown> | null;
  response?: Record<string, unknown> | null;
  error?: Record<string, unknown> | null;
};

@Injectable()
export class HttpFileLogger implements OnModuleDestroy {
  private readonly logger = new Logger(HttpFileLogger.name);
  private readonly source: string;
  private readonly enabled: boolean;
  private readonly configuredPath: string | null;
  private readonly defaultFilePrefix: string;
  private readonly maxBatchSize = 200;
  private readonly maxQueueSize = 5000;
  private readonly flushIntervalMs = 2000;
  private queue: Array<{ logDate: string; line: string }> = [];
  private timer: NodeJS.Timeout | null = null;
  private flushing = false;
  private droppedSinceLastWarn = 0;

  constructor(configService: ConfigService) {
    const options: HttpFileLoggerOptions = {
      source: 'admin-backend',
      filePathEnvKey: 'SAFEIN_ADMIN_HTTP_LOG_FILE_PATH',
      enabledEnvKey: 'SAFEIN_ADMIN_HTTP_LOG_FILE_ENABLED',
      defaultFilePrefix: 'admin-backend',
    };

    this.source = options.source;
    this.defaultFilePrefix = options.defaultFilePrefix;
    this.enabled = parseBoolean(
      configService.get<string>(options.enabledEnvKey) ?? configService.get<string>('SAFEIN_HTTP_LOG_FILE_ENABLED'),
      true,
    );

    const configuredPath = configService.get<string>(options.filePathEnvKey)
      ?? configService.get<string>('SAFEIN_HTTP_LOG_FILE_PATH');
    this.configuredPath = configuredPath?.trim() ? path.resolve(configuredPath.trim()) : null;

    this.timer = setInterval(() => {
      void this.flush();
    }, this.flushIntervalMs);
    this.timer.unref?.();
  }

  write(entry: HttpFileLogEntry): void {
    if (!this.enabled) {
      return;
    }

    if (this.queue.length >= this.maxQueueSize) {
      this.queue.shift();
      this.droppedSinceLastWarn += 1;
      if (this.droppedSinceLastWarn === 1 || this.droppedSinceLastWarn % 500 === 0) {
        this.logger.warn(`HTTP file log queue overflow, dropping old entries (${this.droppedSinceLastWarn})`);
      }
    }

    const timestamp = new Date();
    this.queue.push({
      logDate: this.formatLogDate(timestamp),
      line: `${JSON.stringify({
        timestamp: timestamp.toISOString(),
        source: this.source,
        ...entry,
      })}\n`,
    });

    if (this.queue.length >= this.maxBatchSize) {
      void this.flush();
    }
  }

  async flush(): Promise<void> {
    if (this.flushing || this.queue.length === 0) {
      return;
    }

    this.flushing = true;
    try {
      const batch = this.queue.splice(0, this.maxBatchSize);
      const linesByPath = new Map<string, string[]>();
      for (const item of batch) {
        const filePath = this.resolveFilePath(item.logDate);
        const lines = linesByPath.get(filePath) ?? [];
        lines.push(item.line);
        linesByPath.set(filePath, lines);
      }

      for (const [filePath, lines] of linesByPath) {
        await mkdir(path.dirname(filePath), { recursive: true });
        await appendFile(filePath, lines.join(''), 'utf8');
      }
    } catch (error) {
      this.logger.warn(`HTTP file log write failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      this.flushing = false;
      if (this.queue.length > 0) {
        void this.flush();
      }
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    await this.flush();
  }

  private resolveFilePath(logDate: string): string {
    const fileName = `${this.defaultFilePrefix}-${logDate}.log`;
    if (!this.configuredPath) {
      return path.join(process.cwd(), 'logs', fileName);
    }

    if (path.extname(this.configuredPath)) {
      return this.configuredPath;
    }

    return path.join(this.configuredPath, fileName);
  }

  private formatLogDate(date: Date): string {
    const formatter = new Intl.DateTimeFormat('sv-SE', {
      timeZone: 'Asia/Seoul',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });

    return formatter.format(date);
  }
}

function parseBoolean(raw: string | undefined, fallback: boolean): boolean {
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
