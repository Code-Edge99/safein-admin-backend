import { ConfigService } from '@nestjs/config';
import { request as httpsRequest } from 'node:https';
import { readStageConfig, resolveRuntimeStage } from '../config/stage.config';

type SlackLogLevel = 'log' | 'warn' | 'error' | 'debug' | 'verbose';

type SlackLogNotifierOptions = {
  enabled: boolean;
  source: string;
  webhookUrl?: string;
  token?: string;
  channel?: string;
  levels: Set<SlackLogLevel>;
  flushIntervalMs?: number;
  maxBatchSize?: number;
  maxMessageLength?: number;
  maxEntryLength?: number;
};

type SlackQueueEntry = {
  level: SlackLogLevel;
  context: string;
  message: string;
  trace: string | null;
  timestamp: string;
};

type SlackApiResponse<T extends Record<string, unknown> = Record<string, unknown>> = T & {
  ok: boolean;
  error?: string;
  response_metadata?: {
    next_cursor?: string;
  };
};

type SlackConversation = {
  id: string;
  name?: string;
  name_normalized?: string;
};

class SlackRateLimitError extends Error {
  constructor(public readonly retryAfterMs: number) {
    super(`Slack API rate limited. Retry after ${retryAfterMs}ms.`);
  }
}

export class SlackLogNotifier {
  private readonly enabled: boolean;
  private readonly source: string;
  private readonly webhookUrl?: string;
  private readonly token?: string;
  private readonly channel?: string;
  private readonly levels: Set<SlackLogLevel>;
  private readonly flushIntervalMs: number;
  private readonly maxBatchSize: number;
  private readonly maxMessageLength: number;
  private readonly maxEntryLength: number;
  private readonly queue: SlackQueueEntry[] = [];
  private flushTimer: NodeJS.Timeout | null = null;
  private flushInFlight = false;
  private resolvedChannelId: string | null = null;

  constructor(options: SlackLogNotifierOptions) {
    this.source = options.source;
    this.webhookUrl = options.webhookUrl?.trim() || undefined;
    this.token = options.token?.trim() || undefined;
    this.channel = options.channel?.trim() || undefined;
    this.levels = options.levels;
    this.flushIntervalMs = options.flushIntervalMs ?? 3_000;
    this.maxBatchSize = options.maxBatchSize ?? 10;
    this.maxMessageLength = options.maxMessageLength ?? 3_500;
    this.maxEntryLength = options.maxEntryLength ?? 320;
    this.enabled = options.enabled && (Boolean(this.webhookUrl) || (Boolean(this.token) && Boolean(this.channel)));
  }

  notify(level: SlackLogLevel, message: unknown, context?: string, trace?: string): void {
    if (!this.enabled || !this.levels.has(level)) {
      return;
    }

    const normalizedMessage = this.normalizeMessage(message);
    if (!normalizedMessage) {
      return;
    }

    const normalizedContext = this.normalizeMessage(context) || 'Application';
    const normalizedTrace = this.normalizeMessage(trace) || null;

    this.queue.push({
      level,
      context: normalizedContext,
      message: normalizedMessage,
      trace: normalizedTrace,
      timestamp: new Date().toISOString(),
    });

    if (this.queue.length >= this.maxBatchSize) {
      void this.flushNow();
      return;
    }

    this.ensureFlushTimer(this.flushIntervalMs);
  }

  private ensureFlushTimer(delayMs: number): void {
    if (this.flushTimer) {
      return;
    }

    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      void this.flushNow();
    }, Math.max(0, delayMs));
    this.flushTimer.unref();
  }

  private async flushNow(): Promise<void> {
    if (!this.enabled || this.queue.length === 0) {
      return;
    }

    if (this.flushInFlight) {
      this.ensureFlushTimer(this.flushIntervalMs);
      return;
    }

    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }

    this.flushInFlight = true;
    const entries = this.queue.splice(0, this.maxBatchSize);

    try {
      await this.postEntries(entries);
    } catch (error) {
      if (error instanceof SlackRateLimitError) {
        this.queue.unshift(...entries);
        this.ensureFlushTimer(Math.max(error.retryAfterMs, this.flushIntervalMs));
      } else {
        this.reportFailure(error);
      }
    } finally {
      this.flushInFlight = false;
      if (this.queue.length > 0 && !this.flushTimer) {
        this.ensureFlushTimer(this.queue.length >= this.maxBatchSize ? 10 : this.flushIntervalMs);
      }
    }
  }

  private async postEntries(entries: SlackQueueEntry[]): Promise<void> {
    const text = this.buildMessage(entries);

    if (this.webhookUrl) {
      await this.postEntriesToWebhook(text);
      return;
    }

    const channel = await this.resolveChannel();
    const response = await this.requestSlackApi('/api/chat.postMessage', {
      channel,
      text,
      mrkdwn: false,
      unfurl_links: false,
      unfurl_media: false,
    });

    if (response.ok) {
      return;
    }

    if (response.error === 'not_in_channel') {
      await this.joinChannel(channel);
      const retryResponse = await this.requestSlackApi('/api/chat.postMessage', {
        channel,
        text,
        mrkdwn: false,
        unfurl_links: false,
        unfurl_media: false,
      });
      if (retryResponse.ok) {
        return;
      }

      throw new Error(`Slack chat.postMessage failed after join retry: ${retryResponse.error ?? 'unknown_error'}`);
    }

    throw new Error(`Slack chat.postMessage failed: ${response.error ?? 'unknown_error'}`);
  }

  private async postEntriesToWebhook(text: string): Promise<void> {
    if (!this.webhookUrl) {
      throw new Error('Slack webhook URL is not configured.');
    }

    await this.sendWebhookRequest(JSON.stringify({
      text,
      mrkdwn: false,
      unfurl_links: false,
      unfurl_media: false,
    }));
  }

  private async resolveChannel(): Promise<string> {
    if (!this.channel) {
      throw new Error('Slack channel is not configured.');
    }

    if (this.resolvedChannelId) {
      return this.resolvedChannelId;
    }

    if (/^[CGD][A-Z0-9]+$/.test(this.channel)) {
      this.resolvedChannelId = this.channel;
      return this.channel;
    }

    const requestedName = this.channel.replace(/^#/, '').trim();
    let cursor: string | undefined;

    try {
      do {
        const params = new URLSearchParams({
          exclude_archived: 'true',
          limit: '200',
          types: 'public_channel,private_channel',
        });
        if (cursor) {
          params.set('cursor', cursor);
        }

        const response = await this.requestSlackApiGet<{ channels?: SlackConversation[] }>(
          `/api/conversations.list?${params.toString()}`,
        );

        if (!response.ok) {
          break;
        }

        const match = (response.channels ?? []).find((conversation) => {
          const candidates = [conversation.name, conversation.name_normalized]
            .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
            .map((value) => value.trim());
          return candidates.includes(requestedName);
        });

        if (match?.id) {
          this.resolvedChannelId = match.id;
          return match.id;
        }

        cursor = response.response_metadata?.next_cursor?.trim() || undefined;
      } while (cursor);
    } catch (error) {
      this.reportFailure(`Slack channel resolution failed: ${String(error)}`);
    }

    return this.channel.startsWith('#') ? this.channel : `#${this.channel}`;
  }

  private async joinChannel(channel: string): Promise<void> {
    if (!/^C[A-Z0-9]+$/.test(channel)) {
      return;
    }

    const response = await this.requestSlackApi('/api/conversations.join', { channel });
    if (!response.ok && response.error !== 'method_not_supported_for_channel_type') {
      throw new Error(`Slack conversations.join failed: ${response.error ?? 'unknown_error'}`);
    }
  }

  private buildMessage(entries: SlackQueueEntry[]): string {
    const lines = [`[${this.source}] ${entries.length}개 로그 묶음`];

    for (const entry of entries) {
      const line = this.truncate(
        `${entry.timestamp} ${entry.level.toUpperCase()} ${entry.context}: ${entry.message}${entry.trace ? ` | ${entry.trace}` : ''}`,
        this.maxEntryLength,
      );

      const nextText = `${lines.join('\n')}\n${line}`;
      if (nextText.length > this.maxMessageLength) {
        lines.push('...');
        break;
      }

      lines.push(line);
    }

    return lines.join('\n');
  }

  private async requestSlackApi<T extends Record<string, unknown>>(
    path: string,
    payload: Record<string, unknown>,
  ): Promise<SlackApiResponse<T>> {
    return this.sendRequest<T>(path, 'POST', JSON.stringify(payload));
  }

  private async requestSlackApiGet<T extends Record<string, unknown>>(
    pathWithQuery: string,
  ): Promise<SlackApiResponse<T>> {
    return this.sendRequest<T>(pathWithQuery, 'GET');
  }

  private async sendWebhookRequest(body: string): Promise<void> {
    if (!this.webhookUrl) {
      throw new Error('Slack webhook URL is not configured.');
    }

    const url = new URL(this.webhookUrl);

    return new Promise((resolve, reject) => {
      const request = httpsRequest(
        url,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json; charset=utf-8',
            'Content-Length': Buffer.byteLength(body),
          },
        },
        (response) => {
          let rawBody = '';
          response.setEncoding('utf8');
          response.on('data', (chunk) => {
            rawBody += chunk;
          });
          response.on('end', () => {
            const statusCode = response.statusCode ?? 0;
            if (statusCode === 429) {
              reject(new SlackRateLimitError(this.readRetryAfterMs(response.headers['retry-after'])));
              return;
            }

            if (statusCode < 200 || statusCode >= 300) {
              reject(new Error(`Slack webhook HTTP ${statusCode}: ${rawBody || 'empty response'}`));
              return;
            }

            resolve();
          });
        },
      );

      request.on('error', reject);
      request.write(body);
      request.end();
    });
  }

  private async sendRequest<T extends Record<string, unknown>>(
    pathWithQuery: string,
    method: 'GET' | 'POST',
    body?: string,
  ): Promise<SlackApiResponse<T>> {
    if (!this.token) {
      throw new Error('Slack token is not configured.');
    }

    const url = new URL(pathWithQuery, 'https://slack.com');

    return new Promise((resolve, reject) => {
      const request = httpsRequest(
        url,
        {
          method,
          headers: {
            Authorization: `Bearer ${this.token}`,
            'Content-Type': 'application/json; charset=utf-8',
            ...(body ? { 'Content-Length': Buffer.byteLength(body) } : {}),
          },
        },
        (response) => {
          let rawBody = '';
          response.setEncoding('utf8');
          response.on('data', (chunk) => {
            rawBody += chunk;
          });
          response.on('end', () => {
            const statusCode = response.statusCode ?? 0;
            if (statusCode === 429) {
              reject(new SlackRateLimitError(this.readRetryAfterMs(response.headers['retry-after'])));
              return;
            }

            if (statusCode < 200 || statusCode >= 300) {
              reject(new Error(`Slack API HTTP ${statusCode}: ${rawBody || 'empty response'}`));
              return;
            }

            if (!rawBody) {
              resolve({ ok: false, error: 'empty_response' } as SlackApiResponse<T>);
              return;
            }

            try {
              resolve(JSON.parse(rawBody) as SlackApiResponse<T>);
            } catch (error) {
              reject(new Error(`Slack API response parse failed: ${String(error)}`));
            }
          });
        },
      );

      request.on('error', reject);
      if (body) {
        request.write(body);
      }
      request.end();
    });
  }

  private readRetryAfterMs(rawHeader: string | string[] | undefined): number {
    const value = Array.isArray(rawHeader) ? rawHeader[0] : rawHeader;
    const seconds = Number(value);
    if (!Number.isFinite(seconds) || seconds <= 0) {
      return this.flushIntervalMs;
    }

    return seconds * 1_000;
  }

  private normalizeMessage(value: unknown): string {
    if (value === null || value === undefined) {
      return '';
    }

    if (typeof value === 'string') {
      return this.truncate(value.trim(), this.maxEntryLength);
    }

    if (value instanceof Error) {
      return this.truncate(`${value.name}: ${value.message}`, this.maxEntryLength);
    }

    try {
      return this.truncate(JSON.stringify(value), this.maxEntryLength);
    } catch {
      return this.truncate(String(value), this.maxEntryLength);
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

  private reportFailure(error: unknown): void {
    const fallback = `[SlackLogNotifier] ${String(error)}\n`;
    try {
      process.stderr.write(fallback);
    } catch {
      // ignore stderr failures
    }
  }
}

export function createSlackLogNotifierFromConfig(
  configService: ConfigService,
  source: string,
): SlackLogNotifier {
  const runtimeStage = resolveRuntimeStage(configService);

  return new SlackLogNotifier({
    enabled: runtimeStage === 'dev' && parseBoolean(
      readStageConfig(configService, 'SLACK_LOG_ENABLED', { dev: 'false', prod: 'false' }),
      false,
    ),
    source,
    webhookUrl: readStageConfig(configService, 'SLACK_LOG_WEBHOOK_URL', { dev: '', prod: '' }),
    token: readStageConfig(configService, 'SLACK_LOG_TOKEN', { dev: '', prod: '' }),
    channel: readStageConfig(configService, 'SLACK_LOG_CHANNEL', { dev: '', prod: '' }),
    levels: parseSlackLogLevels(
      readStageConfig(configService, 'SLACK_LOG_LEVELS', { dev: 'log,warn,error', prod: 'error' }),
    ),
    flushIntervalMs: parsePositiveInt(
      readStageConfig(configService, 'SLACK_LOG_FLUSH_INTERVAL_MS', { dev: '3000', prod: '3000' }),
      3_000,
    ),
    maxBatchSize: parsePositiveInt(
      readStageConfig(configService, 'SLACK_LOG_BATCH_SIZE', { dev: '10', prod: '10' }),
      10,
    ),
  });
}

function parseSlackLogLevels(raw: string | undefined): Set<SlackLogLevel> {
  const allowed: SlackLogLevel[] = ['log', 'warn', 'error', 'debug', 'verbose'];
  const parsed = (raw ?? 'log,warn,error')
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter((item): item is SlackLogLevel => allowed.includes(item as SlackLogLevel));

  return new Set(parsed.length > 0 ? parsed : ['log', 'warn', 'error']);
}

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  if (!raw) {
    return fallback;
  }

  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value) || value <= 0) {
    return fallback;
  }

  return value;
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