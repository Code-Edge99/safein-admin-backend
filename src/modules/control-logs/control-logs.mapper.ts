import { ControlLogResponseDto } from './dto';
import { decryptLocation } from '../../common/security/location-crypto';
import { preferKstTimestamp } from '../../common/utils/kst-time.util';

function toUtcIsoString(value: unknown): string | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }

  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  }

  return null;
}

export function toControlLogResponseDto(log: any): ControlLogResponseDto {
  const location = decryptLocation(log);
  const timestampUtc = toUtcIsoString(log.timestamp);

  return {
    id: log.id,
    type: log.type,
    action: log.action,
    timestamp: timestampUtc || preferKstTimestamp(log.timestampKst, log.timestamp) || '',
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
