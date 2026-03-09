import { DeviceResponseDto } from './dto';

export function toDeviceResponseDto(device: any): DeviceResponseDto {
  return {
    id: device.id,
    deviceId: device.deviceId,
    employeeId: device.employeeId,
    employeeName: device.employee?.name,
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
