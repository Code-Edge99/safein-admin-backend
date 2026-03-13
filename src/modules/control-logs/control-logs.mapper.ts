import { ControlLogResponseDto } from './dto';
import { decryptLocation } from '../../common/security/location-crypto';

export function toControlLogResponseDto(log: any): ControlLogResponseDto {
  const location = decryptLocation(log);

  return {
    id: log.id,
    type: log.type,
    action: log.action,
    timestamp: log.timestamp,
    originalTimestamp: log.originalTimestamp || undefined,
    latitude: location?.latitude,
    longitude: location?.longitude,
    reason: log.reason,
    appName: log.appName,
    packageName: log.packageName,
    behaviorDistance: log.behaviorDistance,
    behaviorSteps: log.behaviorSteps,
    behaviorSpeed: log.behaviorSpeed,
    employee: log.employee
      ? {
          id: log.employee.referenceId || log.employee.id,
          employeeId: log.employee.id,
          name: log.employee.name,
          organizationId: log.employee.organizationId || undefined,
          organizationName: log.employee.organization?.name || undefined,
          siteId: log.employee.siteId || undefined,
          siteName: log.employee.site?.name || undefined,
        }
      : undefined,
    organizationId: log.organizationId || log.device?.organizationId || undefined,
    organizationName: log.organization?.name || log.device?.organization?.name || undefined,
    siteId: log.employee?.siteId || undefined,
    siteName: log.employee?.site?.name || undefined,
    device: log.device,
    policy: log.policy,
    zone: log.zone,
    zoneId: log.zone?.id || log.zoneId || undefined,
    zoneName: log.zone?.name || undefined,
    createdAt: log.createdAt,
  };
}
