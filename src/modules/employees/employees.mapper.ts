import { EmployeeResponseDto } from './dto';
import { resolveOrganizationClassification } from '../../common/utils/organization-scope.util';
import { resolveEmployeeDisplayName } from '../../common/utils/employee-display-name.util';

export function toEmployeeResponseDto(employee: any): EmployeeResponseDto {
  const isFieldReviewStatus = employee?.status === 'EXCEPTION'
    && employee?.organization
    && resolveOrganizationClassification(employee.organization) === 'COMPANY';

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
  };
}
