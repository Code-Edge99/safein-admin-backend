import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { Request, Response } from 'express';
import { AuditAction } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';

@Injectable()
export class RequestLoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger(RequestLoggingInterceptor.name);
  constructor(private readonly prisma: PrismaService) {}

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

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const http = context.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();

    const startedAt = Date.now();
    const safeUrl = this.sanitizeUrl(request.originalUrl || request.url);

    return next.handle().pipe(
      tap({
        next: () => {
          const durationMs = Date.now() - startedAt;
          const statusCode = response.statusCode;
          this.logger.log(
            `${request.method} ${safeUrl} ${statusCode} ${durationMs}ms`,
          );
          void this.persistAuditLog(request, safeUrl, statusCode, durationMs);
        },
        error: (error) => {
          const durationMs = Date.now() - startedAt;
          const statusCode = response.statusCode || 500;
          this.logger.warn(
            `${request.method} ${safeUrl} ${statusCode} ${durationMs}ms`,
          );
          void this.persistAuditLog(request, safeUrl, statusCode, durationMs, error);
        },
      }),
    );
  }

  private shouldPersist(method: string, statusCode: number, safeUrl: string): boolean {
    if (safeUrl.startsWith('/api/docs')) {
      return false;
    }

    if (statusCode >= 400) {
      return true;
    }

    return ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method.toUpperCase());
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
    const purePath = safeUrl.split('?')[0];
    const parts = purePath.split('/').filter(Boolean);
    const apiIndex = parts[0] === 'api' ? 1 : 0;
    const resourceType = parts[apiIndex] || 'system';
    const candidateId = parts[apiIndex + 1];
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

    const errorMessage = error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : undefined;

    try {
      await this.prisma.auditLog.create({
        data: {
          accountId,
          organizationId,
          action: this.resolveAction(request.method, safeUrl, statusCode),
          resourceType,
          resourceId,
          resourceName: `${request.method.toUpperCase()} ${safeUrl}`,
          ipAddress: request.ip,
          changesAfter: {
            statusCode,
            durationMs,
            userAgent: request.headers['user-agent'] || null,
            errorMessage: errorMessage || null,
          },
        },
      });
    } catch (persistError) {
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
}
