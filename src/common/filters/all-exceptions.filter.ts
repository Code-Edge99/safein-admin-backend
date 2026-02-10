import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { Prisma } from '@prisma/client';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'Internal server error';
    let errorCode = 'INTERNAL_ERROR';

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const errorResponse = exception.getResponse();
      message = typeof errorResponse === 'string' 
        ? errorResponse 
        : (errorResponse as any).message || message;
      errorCode = (errorResponse as any).error || 'HTTP_ERROR';
    } else if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      // Prisma specific errors
      switch (exception.code) {
        case 'P2002': // Unique constraint violation
          status = HttpStatus.CONFLICT;
          message = '이미 존재하는 데이터입니다.';
          errorCode = 'DUPLICATE_ENTRY';
          break;
        case 'P2025': // Record not found
          status = HttpStatus.NOT_FOUND;
          message = '요청한 데이터를 찾을 수 없습니다.';
          errorCode = 'NOT_FOUND';
          break;
        case 'P2003': // Foreign key constraint
          status = HttpStatus.BAD_REQUEST;
          message = '참조하는 데이터가 존재하지 않습니다.';
          errorCode = 'FOREIGN_KEY_VIOLATION';
          break;
        default:
          message = 'Database error';
          errorCode = `DB_ERROR_${exception.code}`;
      }
    } else if (exception instanceof Prisma.PrismaClientValidationError) {
      status = HttpStatus.BAD_REQUEST;
      message = '유효하지 않은 데이터입니다.';
      errorCode = 'VALIDATION_ERROR';
    }

    // Log the error
    this.logger.error(
      `${request.method} ${request.url} - ${status} - ${message}`,
      exception instanceof Error ? exception.stack : undefined,
    );

    response.status(status).json({
      success: false,
      message,
      errorCode,
      timestamp: new Date().toISOString(),
      path: request.url,
    });
  }
}
