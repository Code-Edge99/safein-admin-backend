import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';

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

/**
 * 조직이 리프 노드(하위 조직 없음)인지 검증합니다.
 * 직원, 정책, 구역 등 리소스는 리프 조직에만 연결할 수 있습니다.
 */
export async function assertLeafOrganization(
  prisma: { organization: { count: (args: any) => Promise<number> } },
  organizationId: string,
): Promise<void> {
  const childCount = await prisma.organization.count({
    where: { parentId: organizationId },
  });
  if (childCount > 0) {
    throw new BadRequestException(
      '하위 조직이 있는 조직에는 직원이나 정책을 직접 배정할 수 없습니다. 하위(말단) 조직을 선택해주세요.',
    );
  }
}
