import { ConfigService } from '@nestjs/config';

export type RuntimeStage = 'local' | 'dev' | 'prod';

function normalizeStage(rawStage?: string): RuntimeStage {
  const value = (rawStage || '').trim().toLowerCase();

  if (value === 'prod' || value === 'production') {
    return 'prod';
  }

  if (value === 'dev' || value === 'development') {
    return 'dev';
  }

  return 'local';
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
  return nodeEnv === 'production' ? 'prod' : 'local';
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
