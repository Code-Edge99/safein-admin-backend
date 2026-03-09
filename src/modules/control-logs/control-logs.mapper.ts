import { ControlLogResponseDto } from './dto';

export function toControlLogResponseDto(log: any): ControlLogResponseDto {
  return {
    id: log.id,
    type: log.type,
    action: log.action,
    timestamp: log.timestamp,
    latitude: log.latitude ? Number(log.latitude) : undefined,
    longitude: log.longitude ? Number(log.longitude) : undefined,
    reason: log.reason,
    appName: log.appName,
    packageName: log.packageName,
    behaviorDistance: log.behaviorDistance,
    behaviorSteps: log.behaviorSteps,
    behaviorSpeed: log.behaviorSpeed,
    employee: log.employee
      ? {
          id: log.employee.id,
          name: log.employee.name,
          organizationId: log.employee.organizationId || undefined,
          organizationName: log.employee.organization?.name || undefined,
        }
      : undefined,
    organizationId: log.organizationId || log.device?.organizationId || undefined,
    organizationName: log.organization?.name || log.device?.organization?.name || undefined,
    device: log.device,
    policy: log.policy,
    zone: log.zone,
    zoneId: log.zone?.id || log.zoneId || undefined,
    zoneName: log.zone?.name || undefined,
    createdAt: log.createdAt,
  };
}
