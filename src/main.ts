import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { TransformInterceptor } from './common/interceptors/transform.interceptor';
import { RequestLoggingInterceptor } from './common/interceptors/request-logging.interceptor';
import { FIXED_ADMIN_UNLIMITED_TOKEN } from './modules/auth/auth.constants';
import { readStageConfig, resolveRuntimeStage } from './common/config/stage.config';
import { PrismaService } from './prisma/prisma.service';
import {
  PersistentAuditLogger,
  parseBoolean,
  parsePersistLogLevels,
} from './common/utils/persistent-audit.logger';

const MASTER_ADMIN_USERNAME = 'master-admin';

function createUnlimitedAdminToken(configService: ConfigService): string | null {
  const token = FIXED_ADMIN_UNLIMITED_TOKEN?.trim();
  return token ? token : null;
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const configService = app.get(ConfigService);
  const prismaService = app.get(PrismaService);

  const persistentLogger = new PersistentAuditLogger(prismaService, {
    source: 'admin-backend',
    enabled: parseBoolean(configService.get<string>('SYSTEM_LOG_PERSIST_ENABLED'), true),
    levels: parsePersistLogLevels(configService.get<string>('SYSTEM_LOG_PERSIST_LEVELS')),
  });
  app.useLogger(persistentLogger);

  const runtimeStage = resolveRuntimeStage(configService);
  if (runtimeStage === 'prod') {
    const jwtSecret = configService.get<string>('JWT_SECRET');
    if (!jwtSecret || jwtSecret.length < 32) {
      throw new Error('JWT_SECRET must be set and at least 32 characters in production.');
    }
  }

  // Global prefix
  app.setGlobalPrefix('api');

  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginEmbedderPolicy: false,
    }),
  );

  // CORS
  const corsOrigin = readStageConfig(configService, 'CORS_ORIGIN', {
    dev: 'http://localhost:5173',
    prod: 'http://localhost:5173',
  });
  const parsedOrigins = corsOrigin
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  const hasWildcard = parsedOrigins.some((origin) => origin === '*');

  if (hasWildcard && parsedOrigins.length > 1) {
    throw new Error('CORS_ORIGIN cannot include wildcard together with explicit origins.');
  }

  app.enableCors({
    origin: hasWildcard
      ? true
      : parsedOrigins.length === 1
        ? parsedOrigins[0]
        : parsedOrigins,
    credentials: !hasWildcard,
  });

  // Global filters / interceptors
  app.useGlobalFilters(new AllExceptionsFilter());
  app.useGlobalInterceptors(app.get(RequestLoggingInterceptor), new TransformInterceptor());

  // Validation
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: {
        enableImplicitConversion: true,
      },
    }),
  );

  // Swagger
  const unlimitedAdminToken = createUnlimitedAdminToken(configService);
  const swaggerConfig = new DocumentBuilder()
    .setTitle('Safein Admin API')
    .setDescription(
      `Safein Admin Backend API Documentation\n\n` +
      `개발용 마스터 계정: ${MASTER_ADMIN_USERNAME} / Safein!2345\n` +
      `무제한 Bearer 토큰은 아래 Authorize 설명 또는 서버 로그를 확인하세요.`,
    )
    .setVersion('1.0')
    .addBearerAuth({
      type: 'http',
      scheme: 'bearer',
      bearerFormat: 'JWT',
      description: unlimitedAdminToken
        ? `개발용 무제한 토큰 (만료 없음)\n${unlimitedAdminToken}`
        : '무제한 토큰이 비어있습니다. auth.constants 설정을 확인하세요.',
    })
    .build();
  const swaggerDocument = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api/docs', app, swaggerDocument);

  const port = configService.get('PORT', 3000);
  await app.listen(port);

  persistentLogger.log(`Application is running on: http://localhost:${port}/api`, 'Bootstrap');
  persistentLogger.log(`Swagger docs: http://localhost:${port}/api/docs`, 'Bootstrap');
}

bootstrap();
