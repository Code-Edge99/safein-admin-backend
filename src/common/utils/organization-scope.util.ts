import { ForbiddenException, NotFoundException } from '@nestjs/common';

export function ensureOrganizationInScope(
  organizationId: string | undefined,
  scopeOrganizationIds?: string[],
): void {
  if (!organizationId || !scopeOrganizationIds) return;
  if (!scopeOrganizationIds.includes(organizationId)) {
    throw new ForbiddenException('요청한 조직은 접근 권한 범위를 벗어났습니다.');
  }
}

export function assertOrganizationInScopeOrThrow(
  organizationId: string | null | undefined,
  scopeOrganizationIds: string[] | undefined,
  notFoundMessage: string,
): void {
  if (!scopeOrganizationIds) return;
  if (!organizationId || !scopeOrganizationIds.includes(organizationId)) {
    throw new NotFoundException(notFoundMessage);
  }
}
