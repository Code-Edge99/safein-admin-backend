function toObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, unknown>;
}

function toStringOrEmpty(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function resolveActorFromChanges(changesAfter: unknown): {
  actorName: string;
  actorIdentifier: string;
  actorType: 'admin' | 'employee' | 'system';
} {
  const payload = toObject(changesAfter);
  const actor = toObject(payload?.actor);

  if (!actor) {
    return { actorName: '', actorIdentifier: '', actorType: 'system' };
  }

  const adminName = toStringOrEmpty(actor.name);
  const adminUsername = toStringOrEmpty(actor.username);
  if (adminName || adminUsername) {
    return {
      actorName: adminName || adminUsername,
      actorIdentifier: adminUsername || toStringOrEmpty(actor.id),
      actorType: 'admin',
    };
  }

  const employeeId = toStringOrEmpty(actor.employeeId);
  const employeeAccountId = toStringOrEmpty(actor.employeeAccountId);
  if (employeeId || employeeAccountId) {
    return {
      actorName: employeeId || employeeAccountId,
      actorIdentifier: employeeAccountId || employeeId,
      actorType: 'employee',
    };
  }

  return { actorName: '', actorIdentifier: '', actorType: 'system' };
}

export function toAuditLogResponseDto(log: any) {
  const actorFromChanges = resolveActorFromChanges(log.changesAfter);

  return {
    id: log.id,
    accountId: log.accountId,
    userName: log.account?.name || actorFromChanges.actorName || '',
    username: log.account?.username || actorFromChanges.actorIdentifier || '',
    actorType: log.account ? 'admin' : actorFromChanges.actorType,
    action: log.action,
    resourceType: log.resourceType,
    resourceId: log.resourceId,
    resourceName: log.resourceName,
    organizationId: log.organizationId,
    changesBefore: log.changesBefore,
    changesAfter: log.changesAfter,
    ipAddress: log.ipAddress,
    timestamp: log.timestamp,
    createdAt: log.createdAt,
  };
}
