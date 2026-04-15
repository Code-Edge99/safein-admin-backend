function toObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, unknown>;
}

function toStringOrEmpty(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

type FallbackSummary = {
  action: string;
  target: string;
  details: string;
  severity: 'info' | 'warning' | 'error' | 'success';
  result: 'success' | 'failure';
  category: 'auth' | 'audit' | 'control' | 'batch';
};

const actionLabelMap: Record<string, string> = {
  CREATE: '생성',
  UPDATE: '수정',
  DELETE: '삭제',
  ACTIVATE: '활성화',
  DEACTIVATE: '비활성화',
};

const resourceLabelMap: Record<string, string> = {
  organization: '현장',
  accounts: '계정 관리',
  employees: '직원 관리',
  organizations: '현장 관리',
  zones: '구역 관리',
  'time-policies': '시간관리',
  'behavior-conditions': '행동관리',
  'control-policies': '통제 정책',
  policies: '통제 정책',
  'allowed-apps': '허용앱 관리',
  permissions: '권한 관리',
  dashboard: '대시보드',
  maps: '지도',
  'audit-logs': '감사 로그',
  'login-history': '로그인 이력',
  'control-logs': '제어 로그',
  devices: '디바이스 관리',
  'system-log': '시스템 로그',
};

function resolveActionLabel(action: unknown): string {
  const raw = toStringOrEmpty(action);
  return actionLabelMap[raw] || raw || '수정';
}

function resolveResourceLabel(resourceType: unknown, resourceName: unknown): string {
  const rawName = toStringOrEmpty(resourceName);
  if (rawName) {
    return rawName;
  }

  const typeKey = toStringOrEmpty(resourceType).toLowerCase();
  return resourceLabelMap[typeKey] || typeKey || '관리자 기능';
}

function resolveAuditSeverity(action: string): FallbackSummary['severity'] {
  if (action === '삭제' || action === '비활성화') return 'warning';
  if (action === '생성' || action === '활성화') return 'success';
  return 'info';
}

function resolveAuditCategory(resourceType: unknown): FallbackSummary['category'] {
  const typeKey = toStringOrEmpty(resourceType).toLowerCase();
  if (typeKey === 'login-history') return 'auth';
  if (typeKey === 'control-logs') return 'control';
  if (typeKey === 'system-log' || typeKey === 'devices') return 'batch';
  return 'audit';
}

function buildUnitTransferSummary(
  log: any,
  changesBefore: Record<string, unknown> | null,
  changesAfter: Record<string, unknown> | null,
): FallbackSummary | null {
  const eventAfter = toStringOrEmpty(changesAfter?.event);
  const eventBefore = toStringOrEmpty(changesBefore?.event);
  const isUnitTransfer = eventAfter === 'unit_transfer' || eventBefore === 'unit_transfer';

  if (!isUnitTransfer) {
    return null;
  }

  const sourceGroupName = toStringOrEmpty(changesBefore?.parentName) || '-';
  const sourceGroupId = toStringOrEmpty(changesBefore?.parentId) || '-';
  const targetGroupName = toStringOrEmpty(changesAfter?.parentName) || '-';
  const targetGroupId = toStringOrEmpty(changesAfter?.parentId) || '-';
  const transferredById = toStringOrEmpty(changesAfter?.transferredById);

  const detailsParts = [
    `원본 그룹: ${sourceGroupName} (${sourceGroupId})`,
    `대상 그룹: ${targetGroupName} (${targetGroupId})`,
  ];

  if (transferredById) {
    detailsParts.push(`수행자 ID: ${transferredById}`);
  }

  return {
    action: '단위 이관',
    target: resolveResourceLabel(log.resourceType, log.resourceName),
    details: detailsParts.join(' / '),
    severity: 'info',
    result: 'success',
    category: 'audit',
  };
}

function buildFallbackSummary(
  log: any,
  changesBefore: Record<string, unknown> | null,
  changesAfter: Record<string, unknown> | null,
): FallbackSummary {
  const unitTransferSummary = buildUnitTransferSummary(log, changesBefore, changesAfter);
  if (unitTransferSummary) {
    return unitTransferSummary;
  }

  const action = resolveActionLabel(log.action);
  const target = resolveResourceLabel(log.resourceType, log.resourceName);
  const category = resolveAuditCategory(log.resourceType);
  const statusCode = typeof changesAfter?.statusCode === 'number' ? changesAfter.statusCode : null;
  const isFailure = typeof statusCode === 'number' ? statusCode >= 400 : false;

  const detailsParts = [
    `작업: ${action}`,
    `대상: ${target}`,
  ];

  if (typeof statusCode === 'number') {
    detailsParts.push(`처리 결과: ${statusCode}`);
  }

  if (log.resourceId) {
    detailsParts.push(`리소스 ID: ${log.resourceId}`);
  }

  return {
    action: `${target} ${action}${isFailure ? ' 실패' : ''}`,
    target,
    details: detailsParts.join(' / '),
    severity: isFailure ? 'warning' : resolveAuditSeverity(action),
    result: isFailure ? 'failure' : 'success',
    category,
  };
}

function hasSummary(value: Record<string, unknown> | null): boolean {
  const summary = toObject(value?.summary);
  if (!summary) {
    return false;
  }

  return Boolean(toStringOrEmpty(summary.action) && toStringOrEmpty(summary.target) && toStringOrEmpty(summary.details));
}

function enrichChangesAfter(log: any): unknown {
  const base = toObject(log.changesAfter);
  const before = toObject(log.changesBefore);
  if (!base) {
    return {
      schemaVersion: 'system-log-v1',
      eventKind: 'audit-event',
      category: resolveAuditCategory(log.resourceType),
      summary: buildFallbackSummary(log, before, null),
    };
  }

  if (hasSummary(base)) {
    return base;
  }

  return {
    ...base,
    schemaVersion: toStringOrEmpty(base.schemaVersion) || 'system-log-v1',
    eventKind: toStringOrEmpty(base.eventKind) || 'audit-event',
    category: toStringOrEmpty(base.category) || resolveAuditCategory(log.resourceType),
    summary: buildFallbackSummary(log, before, base),
  };
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
  const enrichedChangesAfter = enrichChangesAfter(log);

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
    changesAfter: enrichedChangesAfter,
    ipAddress: log.ipAddress,
    timestamp: log.timestamp,
    createdAt: log.createdAt,
  };
}
