import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
  HttpException,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { Request, Response } from 'express';
import { AuditAction, Prisma } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import {
  createRequestLogSummary,
  isImportantReadRequest,
  isLowValueRequestPath,
  stripApiPrefix,
} from '@/common/utils/system-log-summary.util';

@Injectable()
export class RequestLoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger(RequestLoggingInterceptor.name);
  constructor(private readonly prisma: PrismaService) {}
  private readonly maxSerializedLength = 400;
  private readonly maxObjectDepth = 4;
  private readonly maxArrayLength = 20;
  private readonly slowReadRequestWarnMs = 1500;

  private isAuditAccountForeignKeyViolation(error: unknown): boolean {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError)) {
      return false;
    }

    if (error.code !== 'P2003') {
      return false;
    }

    const fieldName = String((error.meta as any)?.field_name || '');
    return fieldName.includes('audit_logs_accountId_fkey') || fieldName.toLowerCase().includes('accountid');
  }

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

          void this.persistAuditLog(request, safeUrl, statusCode, durationMs, undefined, responseBody);
        },
        error: (error) => {
          const durationMs = Date.now() - startedAt;
          const statusCode = this.resolveErrorStatusCode(error, response.statusCode);
          this.logger.warn(
            `${request.method} ${safeUrl} ${statusCode} ${durationMs}ms`,
          );
          void this.persistAuditLog(request, safeUrl, statusCode, durationMs, error);
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

  private shouldPersist(method: string, statusCode: number, safeUrl: string): boolean {
    if (safeUrl.startsWith('/api/docs') || isLowValueRequestPath(safeUrl)) {
      return false;
    }

    if (statusCode >= 400) {
      return true;
    }

    const normalizedMethod = method.toUpperCase();

    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(normalizedMethod)) {
      return true;
    }

    if (['GET', 'HEAD'].includes(normalizedMethod)) {
      return isImportantReadRequest(safeUrl);
    }

    return false;
  }

  private resolveAction(method: string, safeUrl: string, statusCode: number): AuditAction {
    const normalizedMethod = method.toUpperCase();
    const lowerUrl = safeUrl.toLowerCase();

    if (statusCode >= 400) {
      return AuditAction.UPDATE;
    }

    if (lowerUrl.includes('/activate')) {
      return AuditAction.ACTIVATE;
    }

    if (lowerUrl.includes('/deactivate')) {
      return AuditAction.DEACTIVATE;
    }

    if (normalizedMethod === 'POST') {
      return AuditAction.CREATE;
    }

    if (normalizedMethod === 'DELETE') {
      return AuditAction.DELETE;
    }

    return AuditAction.UPDATE;
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

  private async persistAuditLog(
    request: Request,
    safeUrl: string,
    statusCode: number,
    durationMs: number,
    error?: unknown,
    responseBody?: unknown,
  ): Promise<void> {
    if (!this.shouldPersist(request.method, statusCode, safeUrl)) {
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
    const query = this.sanitizeValue(request.query || {}, 0);
    const requestBody = this.sanitizeValue(request.body || {}, 0);
    const normalizedMethod = request.method.toUpperCase();
    const requestSummary = createRequestLogSummary({
      method: normalizedMethod,
      path: safeUrl,
      statusCode,
      durationMs,
    });
    const actor = user
      ? this.sanitizeValue(
          {
            id: user.id,
            username: user.username,
            name: user.name,
            role: user.role,
            organizationId: user.organizationId,
          },
          0,
        )
      : null;
    const responseSummary = this.sanitizeResponseBody(responseBody);

    const errorMessage = error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : undefined;

    const auditLogData: Prisma.AuditLogUncheckedCreateInput = {
      accountId,
      organizationId,
      action: this.resolveAction(normalizedMethod, safeUrl, statusCode),
      resourceType,
      resourceId,
      resourceName: `${normalizedMethod} ${safeUrl}`,
      ipAddress: request.ip,
      changesAfter: {
        schemaVersion: 'system-log-v1',
        eventKind: 'http-request',
        category: requestSummary.category,
        summary: {
          action: requestSummary.action,
          target: requestSummary.target,
          details: requestSummary.details,
          severity: requestSummary.severity,
          result: requestSummary.result,
          category: requestSummary.category,
        } as Prisma.InputJsonObject,
        method: normalizedMethod,
        path: safeUrl,
        statusCode,
        durationMs,
        userAgent: normalizedUserAgent,
        query,
        requestBody,
        response: responseSummary,
        actor,
        errorMessage: errorMessage || null,
      },
    };

    try {
      await this.prisma.auditLog.create({ data: auditLogData });
    } catch (persistError) {
      if (accountId && this.isAuditAccountForeignKeyViolation(persistError)) {
        try {
          await this.prisma.auditLog.create({
            data: {
              ...auditLogData,
              accountId: null,
            },
          });
          return;
        } catch (fallbackError) {
          const fallbackMessage = fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
          this.logger.warn(`audit_log 저장 실패(fallback): ${fallbackMessage}`);
          return;
        }
      }

      const message = persistError instanceof Error ? persistError.message : String(persistError);
      this.logger.warn(`audit_log 저장 실패: ${message}`);
    }
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

  private sanitizeResponseBody(responseBody: unknown): any {
    if (!responseBody || typeof responseBody !== 'object') {
      return null;
    }

    const body = responseBody as Record<string, unknown>;
    const payload = (body.data && typeof body.data === 'object')
      ? (body.data as Record<string, unknown>)
      : body;

    return this.sanitizeValue(
      {
        id: payload.id,
        createdAt: payload.createdAt,
        updatedAt: payload.updatedAt,
        createdById: payload.createdById,
        updatedById: payload.updatedById,
      },
      0,
    );
  }
}
