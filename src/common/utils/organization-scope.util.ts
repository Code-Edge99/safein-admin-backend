import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';

export const CODEEDGE_ROOT_ORGANIZATION_ID = 'org-codeedge';
export const LEGACY_ROOT_ORGANIZATION_ID = 'org-root';
const ROOT_ORGANIZATION_IDS = new Set<string>([
  CODEEDGE_ROOT_ORGANIZATION_ID,
  LEGACY_ROOT_ORGANIZATION_ID,
]);

export type OrganizationNodeClassification = 'ADMIN' | 'COMPANY' | 'GROUP' | 'UNIT';

type OrganizationNode = {
  id: string;
  parentId: string | null;
  teamCode: string | null;
};

export function resolveOrganizationClassification(org: OrganizationNode): OrganizationNodeClassification {
  if (ROOT_ORGANIZATION_IDS.has(org.id)) {
    return 'ADMIN';
  }

  if (org.parentId && ROOT_ORGANIZATION_IDS.has(org.parentId)) {
    return 'COMPANY';
  }

  if (org.teamCode) {
    return 'UNIT';
  }

  return 'GROUP';
}

export function ensureOrganizationInScope(
  organizationId: string | undefined,
  scopeOrganizationIds?: string[],
): void {
  if (!organizationId || !scopeOrganizationIds) return;
  if (!scopeOrganizationIds.includes(organizationId)) {
    throw new ForbiddenException('요청한 현장은 접근 권한 범위를 벗어났습니다.');
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

export async function assertGroupOrganization(
  prisma: { organization: { findUnique: (args: any) => Promise<any> } },
  organizationId: string,
): Promise<void> {
  const organization = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { id: true, parentId: true, teamCode: true },
  });

  if (!organization) {
    throw new NotFoundException('현장을 찾을 수 없습니다.');
  }

  const classification = resolveOrganizationClassification(organization);
  if (classification !== 'GROUP') {
    throw new BadRequestException('정책/조건은 그룹 현장에서만 관리할 수 있습니다. 그룹을 선택해주세요.');
  }
}

export async function assertCompanyOrGroupOrganization(
  prisma: { organization: { findUnique: (args: any) => Promise<any> } },
  organizationId: string,
): Promise<void> {
  const organization = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { id: true, parentId: true, teamCode: true },
  });

  if (!organization) {
    throw new NotFoundException('현장을 찾을 수 없습니다.');
  }

  const classification = resolveOrganizationClassification(organization);
  if (classification !== 'COMPANY' && classification !== 'GROUP') {
    throw new BadRequestException('정책/조건은 회사 또는 그룹 현장에서만 관리할 수 있습니다.');
  }
}

export async function assertUnitOrganization(
  prisma: {
    organization: {
      findUnique: (args: any) => Promise<any>;
    };
  },
  organizationId: string,
): Promise<void> {
  const organization = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: {
      id: true,
      parentId: true,
      teamCode: true,
      _count: {
        select: {
          children: true,
        },
      },
    },
  });

  if (!organization) {
    throw new NotFoundException('현장을 찾을 수 없습니다.');
  }

  const classification = resolveOrganizationClassification(organization);
  if (classification !== 'UNIT') {
    throw new BadRequestException('직원은 단위 현장에만 배정할 수 있습니다. 단위를 선택해주세요.');
  }

  if (Number(organization?._count?.children ?? 0) > 0) {
    throw new BadRequestException('단위 현장에 하위 현장이 있어 직원 배정이 불가능합니다. 구조를 먼저 정리해주세요.');
  }
}

/**
 * 현장이 리프 노드(하위 현장 없음)인지 검증합니다.
 * 직원, 정책, 구역 등 리소스는 리프 현장에만 연결할 수 있습니다.
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
      '하위 현장이 있는 현장에는 직원이나 정책을 직접 배정할 수 없습니다. 하위(말단) 현장을 선택해주세요.',
    );
  }
}
