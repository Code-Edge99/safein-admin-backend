import {
  doesPolicyTargetOrganization,
  resolvePolicyOwnerFallbackIds,
  selectPreferredOwnerScopedPolicies,
} from './policy-owner-fallback.util';

describe('policy-owner-fallback util', () => {
  const organizationsById = new Map([
    ['org-codeedge', { id: 'org-codeedge', parentId: null, teamCode: null }],
    ['company-1', { id: 'company-1', parentId: 'org-codeedge', teamCode: null }],
    ['group-1', { id: 'group-1', parentId: 'company-1', teamCode: null }],
    ['unit-1', { id: 'unit-1', parentId: 'group-1', teamCode: 'TEAM-001' }],
    ['unit-2', { id: 'unit-2', parentId: 'company-1', teamCode: 'TEAM-002' }],
  ]);

  it('resolves unit, group, then company fallback for units under a group', () => {
    expect(resolvePolicyOwnerFallbackIds('unit-1', organizationsById)).toEqual(['unit-1', 'group-1', 'company-1']);
  });

  it('resolves unit then company fallback for units directly under a company', () => {
    expect(resolvePolicyOwnerFallbackIds('unit-2', organizationsById)).toEqual(['unit-2', 'company-1']);
  });

  it('treats empty targetUnitIds as all descendant units', () => {
    expect(doesPolicyTargetOrganization({ targetUnitIds: [] }, 'unit-1')).toBe(true);
  });

  it('selects the nearest owner with required conditions', () => {
    const selected = selectPreferredOwnerScopedPolicies(
      [
        {
          id: 'company-policy',
          organizationId: 'company-1',
          targetUnitIds: [],
          zones: [{ id: 'zone-1' }],
          timePolicies: [{ id: 'time-1' }],
        },
        {
          id: 'group-policy',
          organizationId: 'group-1',
          targetUnitIds: ['unit-1'],
          zones: [{ id: 'zone-2' }],
          timePolicies: [{ id: 'time-2' }],
        },
      ],
      ['group-1', 'company-1'],
      'unit-1',
      { requireRequiredConditions: true },
    );

    expect(selected.map((policy: any) => policy.id)).toEqual(['group-policy']);
  });

  it('falls back to the company when nearer owner policies are incomplete', () => {
    const selected = selectPreferredOwnerScopedPolicies(
      [
        {
          id: 'group-policy-incomplete',
          organizationId: 'group-1',
          targetUnitIds: ['unit-1'],
          zones: [],
          timePolicies: [{ id: 'time-2' }],
        },
        {
          id: 'company-policy',
          organizationId: 'company-1',
          targetUnitIds: [],
          zones: [{ id: 'zone-1' }],
          timePolicies: [{ id: 'time-1' }],
        },
      ],
      ['group-1', 'company-1'],
      'unit-1',
      { requireRequiredConditions: true },
    );

    expect(selected.map((policy: any) => policy.id)).toEqual(['company-policy']);
  });
});