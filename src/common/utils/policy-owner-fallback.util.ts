const CODEEDGE_ROOT_ORGANIZATION_ID = 'org-codeedge';
const LEGACY_ROOT_ORGANIZATION_ID = 'org-root';
const ROOT_ORGANIZATION_IDS = new Set<string>([
  CODEEDGE_ROOT_ORGANIZATION_ID,
  LEGACY_ROOT_ORGANIZATION_ID,
]);

export type PolicyOwnerOrganizationNode = {
  id: string;
  parentId: string | null;
  teamCode: string | null;
  appliedControlPolicyId?: string | null;
};

export type PolicySelectionContext = {
  ownerOrganizationIds: string[];
  appliedPolicyId: string | null;
  appliedByOrganizationId: string | null;
};

export type PolicyScopeCandidate = {
  organizationId: string;
  targetUnitIds?: string[] | null;
  zones?: unknown[] | null;
  timePolicies?: unknown[] | null;
  behaviors?: unknown[] | null;
  allowedApps?: unknown[] | null;
};

type OrganizationClassification = 'ADMIN' | 'COMPANY' | 'GROUP' | 'UNIT';

function resolveOrganizationClassification(node: PolicyOwnerOrganizationNode): OrganizationClassification {
  if (ROOT_ORGANIZATION_IDS.has(node.id)) {
    return 'ADMIN';
  }

  if (node.parentId && ROOT_ORGANIZATION_IDS.has(node.parentId)) {
    return 'COMPANY';
  }

  if (node.teamCode) {
    return 'UNIT';
  }

  return 'GROUP';
}

export function resolvePolicyOwnerFallbackIds(
  organizationId: string,
  organizationsById: Map<string, PolicyOwnerOrganizationNode>,
): string[] {
  return resolvePolicySelectionContext(organizationId, organizationsById).ownerOrganizationIds;
}

export function resolvePolicySelectionContext(
  organizationId: string,
  organizationsById: Map<string, PolicyOwnerOrganizationNode>,
): PolicySelectionContext {
  const result: string[] = [];
  let appliedPolicyId: string | null = null;
  let appliedByOrganizationId: string | null = null;
  let current = organizationsById.get(organizationId);

  while (current) {
    const classification = resolveOrganizationClassification(current);
    if (classification === 'COMPANY' || classification === 'GROUP' || classification === 'UNIT') {
      result.push(current.id);

      if (!appliedPolicyId) {
        const normalizedAppliedPolicyId = String(current.appliedControlPolicyId || '').trim();
        if (normalizedAppliedPolicyId.length > 0) {
          appliedPolicyId = normalizedAppliedPolicyId;
          appliedByOrganizationId = current.id;
        }
      }
    }

    const parentId = current.parentId ?? '';
    if (!parentId) {
      break;
    }

    current = organizationsById.get(parentId);
  }

  return {
    ownerOrganizationIds: Array.from(new Set(result)),
    appliedPolicyId,
    appliedByOrganizationId,
  };
}

export function doesPolicyTargetOrganization(
  policy: Pick<PolicyScopeCandidate, 'targetUnitIds'>,
  organizationId: string,
): boolean {
  const targetUnitIds = Array.isArray(policy.targetUnitIds)
    ? policy.targetUnitIds.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    : [];

  return targetUnitIds.length === 0 || targetUnitIds.includes(organizationId);
}

export function hasRequiredPolicyConditions(
  policy: Pick<PolicyScopeCandidate, 'zones' | 'timePolicies' | 'behaviors' | 'allowedApps'>,
): boolean {
  return Array.isArray(policy.zones)
    && policy.zones.length > 0
    && Array.isArray(policy.timePolicies)
    && policy.timePolicies.length > 0;
}

export function selectPreferredOwnerScopedPolicies<T extends PolicyScopeCandidate>(
  policies: T[],
  ownerOrganizationIds: string[],
  targetOrganizationId: string,
  options?: { requireRequiredConditions?: boolean },
): T[] {
  const orderedOwnerIds = Array.from(
    new Set(ownerOrganizationIds.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)),
  );
  const requireRequiredConditions = options?.requireRequiredConditions ?? false;

  for (const ownerOrganizationId of orderedOwnerIds) {
    const ownerPolicies = policies.filter(
      (policy) => policy.organizationId === ownerOrganizationId && doesPolicyTargetOrganization(policy, targetOrganizationId),
    );

    if (ownerPolicies.length === 0) {
      continue;
    }

    if (!requireRequiredConditions) {
      return ownerPolicies;
    }

    const eligiblePolicies = ownerPolicies.filter((policy) => hasRequiredPolicyConditions(policy));
    if (eligiblePolicies.length > 0) {
      return eligiblePolicies;
    }
  }

  return [];
}