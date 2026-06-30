import {
  CallHandler,
  ExecutionContext,
  HttpException,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { HttpFileLogger } from '@/common/utils/http-file.logger';
import {
  isLowValueRequestPath,
  stripApiPrefix,
} from '@/common/utils/system-log-summary.util';

@Injectable()
export class RequestLoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger(RequestLoggingInterceptor.name);
  private readonly maxSerializedLength = 400;
  private readonly maxObjectDepth = 4;
  private readonly maxArrayLength = 20;
  private readonly slowReadRequestWarnMs = 1500;

  private readonly sensitiveQueryKeys = [
    'token',
    'access_token',
    'refresh_token',
    'password',
    'authorization',
    'apikey',
    'api_key',
    'secret',
  ];

  private readonly sensitiveBodyKeys = [
    'password',
    'passwordHash',
    'token',
    'refreshToken',
    'accessToken',
    'authorization',
    'secret',
    'credential',
    'apikey',
    'apiKey',
    'privateKey',
  ];

  constructor(private readonly httpFileLogger: HttpFileLogger) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const http = context.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();

    const startedAt = Date.now();
    const safeUrl = this.sanitizeUrl(request.originalUrl || request.url);

    return next.handle().pipe(
      tap({
        next: (responseBody) => {
          const durationMs = Date.now() - startedAt;
          const statusCode = response.statusCode;
          const normalizedMethod = request.method.toUpperCase();
          const message = `${normalizedMethod} ${safeUrl} ${statusCode} ${durationMs}ms`;
          const isReadOnlySuccess = ['GET', 'HEAD', 'OPTIONS'].includes(normalizedMethod) && statusCode < 400;

          if (isReadOnlySuccess) {
            if (durationMs >= this.slowReadRequestWarnMs) {
              this.logger.warn(`${message} [slow-read]`);
            } else {
              this.logger.debug(message);
            }
          } else {
            this.logger.log(message);
          }

          this.writeHttpLog(request, safeUrl, statusCode, durationMs, undefined, responseBody);
        },
        error: (error) => {
          const durationMs = Date.now() - startedAt;
          const statusCode = this.resolveErrorStatusCode(error, response.statusCode);
          this.logger.warn(`${request.method} ${safeUrl} ${statusCode} ${durationMs}ms`);
          this.writeHttpLog(request, safeUrl, statusCode, durationMs, error);
        },
      }),
    );
  }

  private resolveErrorStatusCode(error: unknown, fallbackStatusCode?: number): number {
    if (error instanceof HttpException) {
      return error.getStatus();
    }

    const status = (error as { status?: unknown })?.status;
    if (typeof status === 'number' && Number.isFinite(status)) {
      return status;
    }

    const statusCode = (error as { statusCode?: unknown })?.statusCode;
    if (typeof statusCode === 'number' && Number.isFinite(statusCode)) {
      return statusCode;
    }

    if (typeof fallbackStatusCode === 'number' && fallbackStatusCode >= 400) {
      return fallbackStatusCode;
    }

    return 500;
  }

  private shouldWriteHttpLog(safeUrl: string): boolean {
    return !safeUrl.startsWith('/api/docs') && !isLowValueRequestPath(safeUrl);
  }

  private resolveResource(safeUrl: string): { resourceType: string; resourceId?: string } {
    const purePath = stripApiPrefix(safeUrl.split('?')[0]);
    const parts = purePath.split('/').filter(Boolean);
    const resourceType = parts[0] || 'system';
    const candidateId = parts[1];
    const resourceId = candidateId && !['create', 'update', 'delete', 'activate', 'deactivate'].includes(candidateId)
      ? candidateId
      : undefined;

    return { resourceType, resourceId };
  }

  private writeHttpLog(
    request: Request,
    safeUrl: string,
    statusCode: number,
    durationMs: number,
    error?: unknown,
    responseBody?: unknown,
  ): void {
    if (!this.shouldWriteHttpLog(safeUrl)) {
      return;
    }

    const user = (request as any).user;
    const accountId = typeof user?.id === 'string' ? user.id : null;
    const organizationId = typeof user?.organizationId === 'string' && user.organizationId.length > 0
      ? user.organizationId
      : null;
    const { resourceType, resourceId } = this.resolveResource(safeUrl);
    const userAgent = request.headers['user-agent'];
    const normalizedUserAgent = Array.isArray(userAgent)
      ? userAgent.join(', ')
      : userAgent || null;
    const normalizedMethod = request.method.toUpperCase();
    const actor = user
      ? this.sanitizeValue({
        id: user.id,
        username: user.username,
        name: user.name,
        role: user.role,
        organizationId: user.organizationId,
      }, 0)
      : null;

    this.httpFileLogger.write({
      method: normalizedMethod,
      url: safeUrl,
      route: this.resolveRoute(safeUrl),
      statusCode,
      durationMs,
      ipAddress: request.ip,
      userAgent: this.truncate(normalizedUserAgent, 120),
      resourceType,
      resourceId,
      result: statusCode >= 400 ? 'failure' : 'success',
      severity: this.resolveSeverity(statusCode),
      eventCode: this.resolveEventCode(normalizedMethod, safeUrl, statusCode, resourceType),
      actor: actor ? { accountId, organizationId, ...actor } : null,
      query: this.summarizeRecord(request.query || {}),
      request: this.summarizeRecord(request.body || {}),
      response: this.sanitizeResponseBody(responseBody),
      error: this.summarizeError(error),
    });
  }

  private sanitizeUrl(rawUrl: string): string {
    try {
      const parsed = new URL(rawUrl, 'http://localhost');

      parsed.searchParams.forEach((value, key) => {
        const lowerKey = key.toLowerCase();
        if (this.sensitiveQueryKeys.some((sensitiveKey) => lowerKey.includes(sensitiveKey))) {
          parsed.searchParams.set(key, '***');
        } else if (value.length > 200) {
          parsed.searchParams.set(key, `${value.slice(0, 60)}...`);
        }
      });

      const query = parsed.searchParams.toString();
      return query ? `${parsed.pathname}?${query}` : parsed.pathname;
    } catch {
      return rawUrl;
    }
  }

  private sanitizeValue(value: unknown, depth: number): any {
    if (value == null) {
      return value;
    }

    if (depth >= this.maxObjectDepth) {
      return '[truncated-depth]';
    }

    if (value instanceof Date) {
      return value.toISOString();
    }

    if (Array.isArray(value)) {
      const truncated = value
        .slice(0, this.maxArrayLength)
        .map((item) => this.sanitizeValue(item, depth + 1));
      if (value.length > this.maxArrayLength) {
        truncated.push(`[truncated-items:${value.length - this.maxArrayLength}]`);
      }
      return truncated;
    }

    if (typeof value === 'object') {
      const entries = Object.entries(value as Record<string, unknown>);
      const result: Record<string, any> = {};
      for (const [key, raw] of entries) {
        const lowerKey = key.toLowerCase();
        if (this.sensitiveBodyKeys.some((sensitiveKey) => lowerKey.includes(sensitiveKey.toLowerCase()))) {
          result[key] = '***';
          continue;
        }
        result[key] = this.sanitizeValue(raw, depth + 1);
      }
      return result;
    }

    if (typeof value === 'string') {
      return value.length > this.maxSerializedLength
        ? `${value.slice(0, this.maxSerializedLength)}...`
        : value;
    }

    return value;
  }

  private sanitizeResponseBody(responseBody: unknown): Record<string, any> | null {
    if (!responseBody || typeof responseBody !== 'object') {
      return null;
    }

    const body = responseBody as Record<string, unknown>;
    const payload = (body.data && typeof body.data === 'object')
      ? (body.data as Record<string, unknown>)
      : body;

    return this.summarizeRecord({
      id: payload.id,
      createdAt: payload.createdAt,
      updatedAt: payload.updatedAt,
      createdById: payload.createdById,
      updatedById: payload.updatedById,
      status: payload.status,
    });
  }

  private summarizeRecord(value: unknown): Record<string, any> | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return null;
    }

    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) {
      return null;
    }

    const identifiers: Record<string, any> = {};
    const counts: Record<string, number> = {};
    const fields: string[] = [];

    for (const [key, raw] of entries) {
      if (raw === undefined) {
        continue;
      }

      const lowerKey = key.toLowerCase();
      const isSensitive = this.sensitiveBodyKeys.some((sensitiveKey) => lowerKey.includes(sensitiveKey.toLowerCase()));
      const isIdentifier = lowerKey === 'id'
        || lowerKey.endsWith('id')
        || lowerKey.endsWith('ids')
        || lowerKey.includes('code')
        || lowerKey.includes('type')
        || lowerKey.includes('status');

      if (Array.isArray(raw)) {
        counts[key] = raw.length;
      }

      if (isIdentifier) {
        identifiers[key] = isSensitive ? '***' : this.sanitizeValue(raw, 0);
        continue;
      }

      fields.push(key);
    }

    return this.omitEmpty({
      fields: fields.length > 0 ? fields : null,
      ids: Object.keys(identifiers).length > 0 ? identifiers : null,
      counts: Object.keys(counts).length > 0 ? counts : null,
    });
  }

  private summarizeError(error: unknown): Record<string, any> | null {
    if (!error) {
      return null;
    }

    if (error instanceof Error) {
      return this.omitEmpty({
        name: error.name,
        message: this.truncate(error.message, 160),
      });
    }

    if (typeof error === 'string') {
      return { message: this.truncate(error, 160) };
    }

    return { message: this.truncate(String(error), 160) };
  }

  private resolveRoute(safeUrl: string): string {
    return stripApiPrefix(safeUrl.split('?')[0]).toLowerCase();
  }

  private resolveEventCode(method: string, safeUrl: string, statusCode: number, resourceType: string): string {
    const resourceCode = this.toCode(resourceType || 'system');
    const actionCode = this.resolveEventActionCode(method, safeUrl);
    const resultCode = statusCode >= 400 ? 'FAIL' : 'OK';

    return `HTTP_${resourceCode}_${actionCode}_${resultCode}`;
  }

  private resolveEventActionCode(method: string, safeUrl: string): string {
    const normalizedMethod = method.toUpperCase();
    const path = safeUrl.split('?')[0].toLowerCase();

    if (path.includes('/activate') || path.includes('/toggle-active')) {
      return 'ACTIVATE';
    }

    if (path.includes('/deactivate')) {
      return 'DEACTIVATE';
    }

    if (path.includes('/start')) {
      return 'START';
    }

    if (path.includes('/end')) {
      return 'END';
    }

    if (path.includes('/assign')) {
      return 'ASSIGN';
    }

    if (path.includes('/unassign')) {
      return 'UNASSIGN';
    }

    if (normalizedMethod === 'POST') {
      return 'CREATE';
    }

    if (normalizedMethod === 'DELETE') {
      return 'DELETE';
    }

    return 'UPDATE';
  }

  private resolveSeverity(statusCode: number): 'success' | 'warning' | 'error' {
    if (statusCode >= 500) {
      return 'error';
    }
    if (statusCode >= 400) {
      return 'warning';
    }
    return 'success';
  }

  private toCode(value: string): string {
    const code = value.replace(/[^a-z0-9]+/gi, '_').replace(/^_+|_+$/g, '').toUpperCase();
    return code || 'SYSTEM';
  }

  private omitEmpty<T extends Record<string, any>>(value: T): Record<string, any> {
    const result: Record<string, any> = {};

    for (const [key, raw] of Object.entries(value)) {
      if (raw === null || raw === undefined) {
        continue;
      }

      if (Array.isArray(raw) && raw.length === 0) {
        continue;
      }

      if (typeof raw === 'object' && !Array.isArray(raw) && Object.keys(raw).length === 0) {
        continue;
      }

      result[key] = raw;
    }

    return result;
  }

  private truncate(value: string | null | undefined, maxLength: number): string | null {
    if (!value) {
      return null;
    }

    if (value.length <= maxLength) {
      return value;
    }

    if (maxLength <= 3) {
      return value.slice(0, maxLength);
    }

    return `${value.slice(0, maxLength - 3)}...`;
  }
}
