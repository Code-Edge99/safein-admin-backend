export function toAuditLogResponseDto(log: any) {
  return {
    id: log.id,
    accountId: log.accountId,
    userName: log.account?.name || '',
    username: log.account?.username || '',
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
