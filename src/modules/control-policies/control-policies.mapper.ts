import { ControlPolicyDetailDto, ControlPolicyResponseDto } from './dto';

function mapAllowedAppPresets(allowedApps: any[] | undefined) {
  if (!Array.isArray(allowedApps)) {
    return [];
  }

  return allowedApps
    .map((item: any) => item?.preset)
    .filter((preset: any) => !!preset?.id)
    .map((preset: any) => ({
      id: preset.id,
      name: preset.name,
      apps: Array.isArray(preset.items)
        ? preset.items
          .map((presetItem: any) => presetItem?.allowedApp)
          .filter((app: any) => !!app?.id)
          .map((app: any) => ({
            id: app.id,
            name: app.name,
            packageName: app.packageName,
            iconUrl: app.iconUrl ?? undefined,
          }))
        : [],
    }));
}

export function toControlPolicyResponseDto(policy: any): ControlPolicyResponseDto {
  return {
    id: policy.id,
    name: policy.name,
    description: policy.description,
    priority: policy.priority,
    isActive: policy.isActive,
    organization: policy.organization,
    workType: policy.workType,
    zones: policy.zones?.map((z: any) => z.zone) ?? [],
    timePolicies: policy.timePolicies?.map((t: any) => t.timePolicy) ?? [],
    behaviorConditions: policy.behaviors?.map((b: any) => b.behaviorCondition) ?? [],
    allowedAppPresets: mapAllowedAppPresets(policy.allowedApps),
    zoneCount: policy._count?.zones ?? policy.zones?.length ?? 0,
    timePolicyCount: policy._count?.timePolicies ?? policy.timePolicies?.length ?? 0,
    behaviorConditionCount: policy._count?.behaviors ?? policy.behaviors?.length ?? 0,
    allowedAppCount: policy._count?.allowedApps ?? policy.allowedApps?.length ?? 0,
    targetEmployeeCount: policy._count?.targetEmployees ?? 0,
    createdAt: policy.createdAt,
    updatedAt: policy.updatedAt,
  };
}

export function toControlPolicyDetailDto(policy: any): ControlPolicyDetailDto {
  return {
    id: policy.id,
    name: policy.name,
    description: policy.description,
    priority: policy.priority,
    isActive: policy.isActive,
    organization: policy.organization,
    workType: policy.workType,
    zoneCount: policy.zones?.length ?? 0,
    timePolicyCount: policy.timePolicies?.length ?? 0,
    behaviorConditionCount: policy.behaviors?.length ?? 0,
    allowedAppCount: policy.allowedApps?.length ?? 0,
    targetEmployeeCount: policy.targetEmployees?.length ?? 0,
    zones: policy.zones?.map((z: any) => z.zone) ?? [],
    timePolicies: policy.timePolicies?.map((t: any) => t.timePolicy) ?? [],
    behaviorConditions: policy.behaviors?.map((b: any) => b.behaviorCondition) ?? [],
    allowedAppPresets: mapAllowedAppPresets(policy.allowedApps),
    targetEmployees: policy.targetEmployees?.map((e: any) => e.employee) ?? [],
    createdAt: policy.createdAt,
    updatedAt: policy.updatedAt,
  };
}
