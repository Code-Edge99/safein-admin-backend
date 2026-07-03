import { EmployeeResponseDto } from './dto';
import { resolveOrganizationClassification } from '../../common/utils/organization-scope.util';
import { resolveEmployeeDisplayName } from '../../common/utils/employee-display-name.util';

const RECENT_ACTIVE_THRESHOLD_MS = 15 * 60 * 1000;

export function toEmployeeResponseDto(employee: any): EmployeeResponseDto {
  const isFieldReviewStatus = employee?.status === 'EXCEPTION'
    && employee?.organization
    && resolveOrganizationClassification(employee.organization) === 'COMPANY';
  const latestCommunicationAt = Array.isArray(employee?.devices)
    ? employee.devices
      .map((device: any) => device?.lastCommunication)
      .filter(Boolean)
      .sort((left: Date, right: Date) => right.getTime() - left.getTime())[0]
    : null;
  const isRecentlyActive = latestCommunicationAt
    ? Date.now() - latestCommunicationAt.getTime() <= RECENT_ACTIVE_THRESHOLD_MS
    : false;

  return {
    id: employee.referenceId || employee.id,
    employeeId: employee.id,
    name: resolveEmployeeDisplayName(employee.name),
    organizationId: employee.organizationId,
    organizationName: employee.organization?.name,
    position: employee.position,
    role: employee.role,
    email: employee.email,
    status: isFieldReviewStatus ? 'FIELD_REVIEW' : employee.status,
    memo: employee.memo,
    createdAt: employee.createdAt,
    updatedAt: employee.updatedAt,
    pendingMdmUdid: employee.pendingMdmUdid ?? undefined,
    deletedAt: employee.deletedAt ?? undefined,
    purgeAfterAt: employee.purgeAfterAt ?? undefined,
    deletedReason: employee.deletedReason ?? undefined,
    originalEmployeeId: employee.originalEmployeeId ?? undefined,
    latestCommunicationAt: latestCommunicationAt ?? undefined,
    isRecentlyActive,
  };
}
