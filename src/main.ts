import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { TransformInterceptor } from './common/interceptors/transform.interceptor';
import { RequestLoggingInterceptor } from './common/interceptors/request-logging.interceptor';
import { FIXED_ADMIN_UNLIMITED_TOKEN } from './modules/auth/auth.constants';

const MASTER_ADMIN_ACCOUNT_ID = 'acc-master-admin';
const MASTER_ADMIN_USERNAME = 'master-admin';

function createUnlimitedAdminToken(configService: ConfigService): string | null {
  const jwtSecret = configService.get<string>('JWT_SECRET');
  if (!jwtSecret) {
    return null;
  }

  return FIXED_ADMIN_UNLIMITED_TOKEN;
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const configService = app.get(ConfigService);

  const nodeEnv = configService.get<string>('NODE_ENV', 'development');
  if (nodeEnv === 'production') {
    const jwtSecret = configService.get<string>('JWT_SECRET');
    if (!jwtSecret || jwtSecret.length < 32) {
      throw new Error('JWT_SECRET must be set and at least 32 characters in production.');
    }
  }

  // Global prefix
  app.setGlobalPrefix('api');

  // CORS
  const corsOrigin = configService.get<string>('CORS_ORIGIN', 'http://localhost:5173');
  const parsedOrigins = corsOrigin
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  app.enableCors({
    origin: parsedOrigins.includes('*')
      ? true
      : parsedOrigins.length === 1
        ? parsedOrigins[0]
        : parsedOrigins,
    credentials: !parsedOrigins.includes('*'),
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
        : 'JWT_SECRET이 없어 무제한 토큰을 생성하지 못했습니다. 환경변수를 확인하세요.',
    })
    .build();
  const swaggerDocument = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api/docs', app, swaggerDocument);

  const port = configService.get('PORT', 3000);
  await app.listen(port);

  console.log(`🚀 Application is running on: http://localhost:${port}/api`);
  console.log(`📚 Swagger docs: http://localhost:${port}/api/docs`);
}

bootstrap();
