function normalizeIdentifier(value?: string | null): string {
  return String(value ?? '').trim();
}

export function normalizePhoneEmployeeId(value?: string | null): string {
  return normalizeIdentifier(value).replace(/\D/g, '');
}

function buildEmployeeIdentifierWhere(identifier?: string | null): Array<Record<string, string>> {
  const raw = normalizeIdentifier(identifier);
  if (!raw) {
    return [];
  }

  const clauses: Array<Record<string, string>> = [{ referenceId: raw }];
  const normalizedPhone = normalizePhoneEmployeeId(raw);
  if (normalizedPhone) {
    clauses.push({ id: normalizedPhone });
  }

  return clauses;
}

export async function findEmployeeByIdentifier(
  tx: any,
  identifier: string,
  query: Record<string, unknown> = {},
): Promise<any | null> {
  const whereClauses = buildEmployeeIdentifierWhere(identifier);
  if (whereClauses.length === 0) {
    return null;
  }

  return tx.employee.findFirst({
    where: { OR: whereClauses },
    ...query,
  });
}

export async function resolveEmployeePrimaryId(tx: any, identifier: string): Promise<string | null> {
  const employee = await findEmployeeByIdentifier(tx, identifier, {
    select: { id: true },
  });

  return employee?.id ?? null;
}

export async function resolveEmployeePrimaryIds(tx: any, identifiers?: string[]): Promise<string[]> {
  const uniqueIdentifiers = Array.from(
    new Set((identifiers ?? []).map((value) => normalizeIdentifier(value)).filter(Boolean)),
  );

  if (uniqueIdentifiers.length === 0) {
    return [];
  }

  const normalizedPhoneIds = Array.from(
    new Set(uniqueIdentifiers.map((value) => normalizePhoneEmployeeId(value)).filter(Boolean)),
  );

  const employees = await tx.employee.findMany({
    where: {
      OR: [
        { referenceId: { in: uniqueIdentifiers } },
        ...(normalizedPhoneIds.length > 0 ? [{ id: { in: normalizedPhoneIds } }] : []),
      ],
    },
    select: {
      id: true,
      referenceId: true,
    },
  });

  const byReferenceId = new Map<string, string>();
  const byEmployeeId = new Map<string, string>();

  employees.forEach((employee: { id: string; referenceId: string }) => {
    byReferenceId.set(employee.referenceId, employee.id);
    byEmployeeId.set(employee.id, employee.id);
  });

  const resolvedIds = uniqueIdentifiers
    .map((identifier) => byReferenceId.get(identifier) ?? byEmployeeId.get(normalizePhoneEmployeeId(identifier)) ?? null)
    .filter((value): value is string => Boolean(value));

  return Array.from(new Set(resolvedIds));
}