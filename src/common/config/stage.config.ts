import { ConfigService } from '@nestjs/config';

export type RuntimeStage = 'dev' | 'prod';

function normalizeStage(rawStage?: string): RuntimeStage {
  const value = (rawStage || '').trim().toLowerCase();

  if (value === 'prod' || value === 'production') {
    return 'prod';
  }

  return 'dev';
}

function readString(configService: ConfigService, key: string): string | undefined {
  const value = configService.get<string>(key);
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function resolveRuntimeStage(configService: ConfigService): RuntimeStage {
  const explicitStage = readString(configService, 'APP_STAGE');
  if (explicitStage) {
    return normalizeStage(explicitStage);
  }

  const nodeEnv = readString(configService, 'NODE_ENV');
  return nodeEnv === 'production' ? 'prod' : 'dev';
}

export function readStageConfig(
  configService: ConfigService,
  baseKey: string,
  defaults: Record<RuntimeStage, string>,
): string {
  const stage = resolveRuntimeStage(configService);
  const stageKey = `${baseKey}_${stage.toUpperCase()}`;
  return readString(configService, stageKey) || readString(configService, baseKey) || defaults[stage];
}

/**
 * ConfigModule load 팩토리 — .env 파일의 KEY_DEV / KEY_PROD 값을
 * 현재 APP_STAGE에 맞게 KEY로 자동 매핑합니다.
 * process.env에도 반영하므로 Prisma 등 외부 라이브러리도 올바른 값을 읽습니다.
 *
 * 예: APP_STAGE=prod → DATABASE_URL_PROD 값을 DATABASE_URL로 설정
 */
export function createStageConfigLoader() {
  return () => {
    const raw = (process.env.APP_STAGE || '').trim().toLowerCase();
    let stage: string;
    if (raw === 'prod' || raw === 'production') stage = 'PROD';
    else stage = 'DEV';

    const suffix = `_${stage}`;
    const resolved: Record<string, string> = {};

    for (const [key, value] of Object.entries(process.env)) {
      if (key.endsWith(suffix) && value !== undefined) {
        const baseKey = key.slice(0, -suffix.length);
        resolved[baseKey] = value;
        process.env[baseKey] = value;
      }
    }

    return resolved;
  };
}
