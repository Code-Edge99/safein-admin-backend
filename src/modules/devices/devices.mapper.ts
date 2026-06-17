import { Buffer } from 'node:buffer';
import { AppLanguage } from '@prisma/client';
import { DeviceResponseDto } from './dto';
import { resolveEmployeeDisplayName } from '../../common/utils/employee-display-name.util';
import { normalizeAppLanguage } from '../../common/translation/app-language.util';

function decodeJwtPayload(token?: string | null): Record<string, unknown> | null {
  if (!token) {
    return null;
  }

  const payloadSegment = token.split('.')[1];
  if (!payloadSegment) {
    return null;
  }

  try {
    const normalized = payloadSegment.replace(/-/g, '+').replace(/_/g, '/');
    const padding = normalized.length % 4 === 0 ? '' : '='.repeat(4 - (normalized.length % 4));
    const payload = JSON.parse(Buffer.from(`${normalized}${padding}`, 'base64').toString('utf8'));
    return payload && typeof payload === 'object' && !Array.isArray(payload)
      ? payload as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function resolveTokenLanguage(token?: string | null): AppLanguage | undefined {
  return normalizeAppLanguage(decodeJwtPayload(token)?.language) ?? undefined;
}

export function toDeviceResponseDto(device: any): DeviceResponseDto {
  const lastLoginLanguage = device.token?.lastLoginLanguage ?? resolveTokenLanguage(device.token?.refreshToken);

  return {
    id: device.id,
    deviceId: device.deviceId,
    employeeId: device.employee?.referenceId || device.employeeId,
    employeeName: device.employee ? resolveEmployeeDisplayName(device.employee.name) : undefined,
    organizationId: device.organizationId,
    organizationName: device.organization?.name,
    os: device.os,
    osVersion: device.osVersion,
    model: device.model,
    manufacturer: device.manufacturer,
    appVersion: device.appVersion,
    status: device.status,
    deviceStatus: device.deviceStatus,
    lastCommunication: device.lastCommunication,
    registeredAt: device.registeredAt,
    deactivatedAt: device.deactivatedAt,
    deactivatedReason: device.deactivatedReason,
    tokenInfo: device.token
      ? {
          isValid: device.token.isValid,
          lastLogin: device.token.lastLogin ?? undefined,
          lastLoginLanguage,
          expiresAt: device.token.expiresAt ?? undefined,
        }
      : undefined,
    pushToken: device.pushToken,
    pushTokenCheckedAt:
      device.pushToken || (device.pushTokenStatus && device.pushTokenStatus !== 'NONE')
        ? device.updatedAt
        : undefined,
    pushTokenStatus: device.pushTokenStatus,
    mdmEnrollmentStatus: device.mdmEnrollmentStatus,
    mdmVerifiedAt: device.mdmVerifiedAt,
    lastMdmCheckinAt: device.lastMdmCheckinAt,
    lastInstalledAppsSyncAt: device.lastInstalledAppsSyncAt,
    mdmManualUnblockUntilLogin: device.mdmManualUnblockUntilLogin,
    mdmManualUnblockReason: device.mdmManualUnblockReason,
    mdmManualUnblockSetAt: device.mdmManualUnblockSetAt,
    createdAt: device.createdAt,
    updatedAt: device.updatedAt,
  };
}
