import { BadRequestException, NotFoundException } from '@nestjs/common';
import {
  assertConditionOwnerOrganization,
  assertPolicyOwnerOrganization,
  CODEEDGE_ROOT_ORGANIZATION_ID,
} from './organization-scope.util';

type MockOrganization = {
  id: string;
  parentId: string | null;
  teamCode: string | null;
};

function createPrismaMock(organization: MockOrganization | null) {
  return {
    organization: {
      findUnique: jest.fn().mockResolvedValue(organization),
    },
  };
}

describe('assertConditionOwnerOrganization', () => {
  it('allows company owners', async () => {
    const prisma = createPrismaMock({
      id: 'company-1',
      parentId: CODEEDGE_ROOT_ORGANIZATION_ID,
      teamCode: null,
    });

    await expect(assertConditionOwnerOrganization(prisma, 'company-1')).resolves.toBeUndefined();
  });

  it('allows group owners', async () => {
    const prisma = createPrismaMock({
      id: 'group-1',
      parentId: 'company-1',
      teamCode: null,
    });

    await expect(assertConditionOwnerOrganization(prisma, 'group-1')).resolves.toBeUndefined();
  });

  it('allows unit owners', async () => {
    const prisma = createPrismaMock({
      id: 'unit-1',
      parentId: 'group-1',
      teamCode: 'TEAM-001',
    });

    await expect(assertConditionOwnerOrganization(prisma, 'unit-1')).resolves.toBeUndefined();
  });

  it('rejects admin owners', async () => {
    const prisma = createPrismaMock({
      id: CODEEDGE_ROOT_ORGANIZATION_ID,
      parentId: null,
      teamCode: null,
    });

    await expect(assertConditionOwnerOrganization(prisma, CODEEDGE_ROOT_ORGANIZATION_ID)).rejects.toThrow(
      BadRequestException,
    );
  });

  it('rejects missing organizations', async () => {
    const prisma = createPrismaMock(null);

    await expect(assertConditionOwnerOrganization(prisma, 'missing-org')).rejects.toThrow(NotFoundException);
  });
});

describe('assertPolicyOwnerOrganization', () => {
  it('allows company owners', async () => {
    const prisma = createPrismaMock({
      id: 'company-1',
      parentId: CODEEDGE_ROOT_ORGANIZATION_ID,
      teamCode: null,
    });

    await expect(assertPolicyOwnerOrganization(prisma, 'company-1')).resolves.toBeUndefined();
  });

  it('allows group owners', async () => {
    const prisma = createPrismaMock({
      id: 'group-1',
      parentId: 'company-1',
      teamCode: null,
    });

    await expect(assertPolicyOwnerOrganization(prisma, 'group-1')).resolves.toBeUndefined();
  });

  it('allows unit owners', async () => {
    const prisma = createPrismaMock({
      id: 'unit-1',
      parentId: 'group-1',
      teamCode: 'TEAM-001',
    });

    await expect(assertPolicyOwnerOrganization(prisma, 'unit-1')).resolves.toBeUndefined();
  });

  it('rejects admin owners', async () => {
    const prisma = createPrismaMock({
      id: CODEEDGE_ROOT_ORGANIZATION_ID,
      parentId: null,
      teamCode: null,
    });

    await expect(assertPolicyOwnerOrganization(prisma, CODEEDGE_ROOT_ORGANIZATION_ID)).rejects.toThrow(
      BadRequestException,
    );
  });
});