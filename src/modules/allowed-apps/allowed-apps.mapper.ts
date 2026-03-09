import { AllowedAppResponseDto } from './dto';

export function toAllowedAppResponseDto(
  app: any,
  normalizePlatform: (platform?: string) => 'android' | 'ios',
  installedCount: number = 0,
): AllowedAppResponseDto {
  return {
    id: app.id,
    name: app.name,
    packageName: app.packageName,
    category: app.category,
    platform: normalizePlatform(app.platform),
    iconUrl: app.iconUrl,
    isGlobal: app.isGlobal,
    presetCount: app._count?.presetItems || 0,
    installedCount,
    createdAt: app.createdAt,
    updatedAt: app.updatedAt,
  };
}
