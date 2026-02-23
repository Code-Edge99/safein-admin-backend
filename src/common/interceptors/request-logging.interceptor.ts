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

@Injectable()
export class RequestLoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger(RequestLoggingInterceptor.name);
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
          this.logger.log(
            `${request.method} ${safeUrl} ${response.statusCode} ${Date.now() - startedAt}ms`,
          );
        },
        error: () => {
          this.logger.warn(
            `${request.method} ${safeUrl} ${response.statusCode} ${Date.now() - startedAt}ms`,
          );
        },
      }),
    );
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
