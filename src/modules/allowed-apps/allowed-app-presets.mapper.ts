import { AllowedAppPresetDetailDto, AllowedAppPresetResponseDto } from './dto';

export function toAllowedAppPresetResponseDto(
  preset: any,
  normalizePlatform: (platform?: string) => 'android' | 'ios',
): AllowedAppPresetResponseDto {
  return {
    id: preset.id,
    name: preset.name,
    description: preset.description,
    organization: preset.organization,
    workType: preset.workType,
    platform: normalizePlatform(preset.platform),
    appCount: preset._count?.items || 0,
    policyCount: preset._count?.policyPresets || 0,
    createdAt: preset.createdAt,
    updatedAt: preset.updatedAt,
  };
}

export function toAllowedAppPresetDetailDto(
  preset: any,
  normalizePlatform: (platform?: string) => 'android' | 'ios',
): AllowedAppPresetDetailDto {
  return {
    ...toAllowedAppPresetResponseDto(preset, normalizePlatform),
    apps: preset.items?.map((item: any) => ({
      id: item.allowedApp.id,
      name: item.allowedApp.name,
      packageName: item.allowedApp.packageName,
      category: item.allowedApp.category,
      platform: normalizePlatform(item.allowedApp.platform),
      iconUrl: item.allowedApp.iconUrl,
      isGlobal: item.allowedApp.isGlobal,
      presetCount: 0,
      createdAt: item.allowedApp.createdAt,
      updatedAt: item.allowedApp.updatedAt,
    })) || [],
  };
}
