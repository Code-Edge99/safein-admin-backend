export async function deactivatePoliciesWithoutConditions(tx: any, policyIds: string[]): Promise<void> {
  const uniquePolicyIds = Array.from(new Set(policyIds.filter(Boolean)));
  if (uniquePolicyIds.length === 0) return;

  const policies = await tx.controlPolicy.findMany({
    where: { id: { in: uniquePolicyIds } },
    select: {
      id: true,
      _count: {
        select: {
          zones: true,
          timePolicies: true,
          behaviors: true,
          allowedApps: true,
        },
      },
    },
  });

  const emptyPolicyIds = policies
    .filter(
      (p: any) =>
        p._count.zones + p._count.timePolicies + p._count.behaviors + p._count.allowedApps === 0,
    )
    .map((p: any) => p.id);

  const reviewRequiredPolicyIds = policies
    .filter(
      (p: any) => p._count.zones === 0
        || p._count.timePolicies === 0
        || (p._count.behaviors === 0 && p._count.allowedApps === 0),
    )
    .map((p: any) => p.id);

  if (reviewRequiredPolicyIds.length > 0) {
    await tx.controlPolicy.updateMany({
      where: { id: { in: reviewRequiredPolicyIds } },
      data: { isActive: false },
    });
  }

  if (emptyPolicyIds.length === 0) return;

  await tx.controlPolicyEmployee.deleteMany({
    where: { policyId: { in: emptyPolicyIds } },
  });
}
