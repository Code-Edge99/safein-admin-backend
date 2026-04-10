export type SystemLogCategory = 'auth' | 'audit' | 'control' | 'batch';

export type SystemLogSeverity = 'info' | 'warning' | 'error' | 'success';

export type SystemLogResult = 'success' | 'failure';

export type PersistLogLevel = 'log' | 'warn' | 'error' | 'debug' | 'verbose';

export interface ParsedHttpRequestMessage {
  method: string;
  path: string;
  statusCode: number;
  durationMs: number | null;
}

export interface SystemLogSummary {
  action: string;
  target: string;
  details: string;
  severity: SystemLogSeverity;
  result: SystemLogResult;
  category: SystemLogCategory;
}

type ResourceInfo = {
  label: string;
  category: SystemLogCategory;
};

const RESOURCE_MATCHERS: Array<{ matcher: RegExp; info: ResourceInfo }> = [
  { matcher: /^\/auth\/login(?:\/|$)/, info: { label: '관리자 로그인', category: 'auth' } },
  { matcher: /^\/auth\/logout(?:\/|$)/, info: { label: '관리자 로그아웃', category: 'auth' } },
  { matcher: /^\/dashboard(?:\/|$)/, info: { label: '대시보드', category: 'audit' } },
  { matcher: /^\/accounts(?:\/|$)/, info: { label: '계정 관리', category: 'audit' } },
  { matcher: /^\/employees(?:\/|$)/, info: { label: '직원 관리', category: 'audit' } },
  { matcher: /^\/organizations(?:\/|$)/, info: { label: '현장 관리', category: 'audit' } },
  { matcher: /^\/zones(?:\/|$)/, info: { label: '구역 관리', category: 'audit' } },
  { matcher: /^\/time-policies(?:\/|$)/, info: { label: '시간관리', category: 'audit' } },
  { matcher: /^\/behavior-conditions(?:\/|$)/, info: { label: '행동관리', category: 'audit' } },
  { matcher: /^\/(?:control-policies|policies)(?:\/|$)/, info: { label: '통제 정책', category: 'audit' } },
  { matcher: /^\/allowed-apps(?:\/|$)/, info: { label: '허용앱 관리', category: 'audit' } },
  { matcher: /^\/permissions(?:\/|$)/, info: { label: '권한 관리', category: 'audit' } },
  { matcher: /^\/maps(?:\/|$)/, info: { label: '지도', category: 'audit' } },
  { matcher: /^\/audit-logs(?:\/|$)/, info: { label: '감사 로그', category: 'audit' } },
  { matcher: /^\/login-history(?:\/|$)/, info: { label: '로그인 이력', category: 'auth' } },
  { matcher: /^\/control-logs(?:\/|$)/, info: { label: '제어 로그', category: 'control' } },
  { matcher: /^\/devices(?:\/|$)/, info: { label: '디바이스 관리', category: 'batch' } },
  { matcher: /^\/health(?:\/|$)/, info: { label: '시스템 상태', category: 'batch' } },
];

const IMPORTANT_READ_PREFIXES = [
  '/dashboard',
  '/accounts',
  '/employees',
  '/organizations',
  '/zones',
  '/time-policies',
  '/behavior-conditions',
  '/control-policies',
  '/policies',
  '/allowed-apps',
  '/permissions',
  '/devices',
  '/login-history',
  '/control-logs',
  '/audit-logs',
  '/maps',
] as const;

export function normalizeRequestPath(path: string): string {
  const rawPath = String(path || '').trim();
  if (!rawPath) {
    return '/';
  }

  const withoutHost = rawPath.replace(/^https?:\/\/[^/]+/i, '');
  const withoutQuery = withoutHost.split('?')[0] || '/';

  return withoutQuery.startsWith('/') ? withoutQuery : `/${withoutQuery}`;
}

export function stripApiPrefix(path: string): string {
  const normalized = normalizeRequestPath(path);
  if (normalized === '/api') {
    return '/';
  }

  return normalized.startsWith('/api/') ? normalized.slice(4) : normalized;
}

function resolveResourceInfo(path: string): ResourceInfo {
  const routePath = stripApiPrefix(path).toLowerCase();
  for (const { matcher, info } of RESOURCE_MATCHERS) {
    if (matcher.test(routePath)) {
      return info;
    }
  }

  return { label: '관리자 기능', category: 'audit' };
}

function resolveStatusDescription(statusCode: number): string {
  if (statusCode >= 500) return '서버 오류';
  if (statusCode >= 400) return '요청 실패';
  if (statusCode >= 300) return '리다이렉션';
  if (statusCode >= 200) return '정상 처리';
  return '처리 상태 미확인';
}

function resolveActionVerb(method: string): string {
  switch (method.toUpperCase()) {
    case 'POST':
      return '등록';
    case 'PUT':
    case 'PATCH':
      return '수정';
    case 'DELETE':
      return '삭제';
    case 'GET':
    case 'HEAD':
    case 'OPTIONS':
    default:
      return '조회';
  }
}

export function severityFromHttpStatus(statusCode: number): SystemLogSeverity {
  if (statusCode >= 500) return 'error';
  if (statusCode >= 400) return 'warning';
  return 'info';
}

export function severityFromLogLevel(level: string): SystemLogSeverity {
  const normalized = level.trim().toLowerCase();
  if (normalized === 'error') return 'error';
  if (normalized === 'warn' || normalized === 'warning') return 'warning';
  if (normalized === 'log') return 'success';
  return 'info';
}

export function parseHttpRequestMessage(message: string): ParsedHttpRequestMessage | null {
  const matched = message
    .trim()
    .match(/^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+(\S+)\s+(\d{3})(?:\s+(\d+)ms)?(?:\s+\[[^\]]+\])?$/i);

  if (!matched) {
    return null;
  }

  const statusCode = Number(matched[3]);
  if (!Number.isFinite(statusCode)) {
    return null;
  }

  const durationMs = matched[4] ? Number(matched[4]) : null;

  return {
    method: matched[1].toUpperCase(),
    path: matched[2],
    statusCode,
    durationMs: Number.isFinite(durationMs as number) ? durationMs : null,
  };
}

export function isLowValueRequestPath(path: string): boolean {
  const routePath = stripApiPrefix(path).toLowerCase();

  if (routePath === '/favicon.ico') {
    return true;
  }

  if (routePath === '/health' || routePath.startsWith('/health/')) {
    return true;
  }

  if (routePath.startsWith('/docs') || routePath.startsWith('/swagger') || routePath.includes('api-json')) {
    return true;
  }

  return false;
}

export function isImportantReadRequest(path: string): boolean {
  const routePath = stripApiPrefix(path).toLowerCase();
  return IMPORTANT_READ_PREFIXES.some((prefix) => routePath === prefix || routePath.startsWith(`${prefix}/`));
}

export function createRequestLogSummary(params: {
  method: string;
  path: string;
  statusCode: number;
  durationMs?: number | null;
}): SystemLogSummary {
  const normalizedMethod = params.method.toUpperCase();
  const normalizedPath = normalizeRequestPath(params.path);
  const routePath = stripApiPrefix(normalizedPath);
  const resource = resolveResourceInfo(routePath);
  const isFailure = params.statusCode >= 400;
  const actionVerb = resolveActionVerb(normalizedMethod);

  let action = `${resource.label} ${actionVerb}${isFailure ? ' 실패' : ''}`;
  if (routePath.toLowerCase().startsWith('/auth/login')) {
    action = `관리자 로그인 ${isFailure ? '실패' : '성공'}`;
  } else if (routePath.toLowerCase().startsWith('/auth/logout')) {
    action = `관리자 로그아웃${isFailure ? ' 실패' : ''}`;
  }

  const details = `처리 결과: ${params.statusCode} (${resolveStatusDescription(params.statusCode)})`;

  return {
    action,
    target: resource.label,
    details,
    severity: severityFromHttpStatus(params.statusCode),
    result: isFailure ? 'failure' : 'success',
    category: resource.category,
  };
}

export function createApplicationLogSummary(params: {
  level: PersistLogLevel;
  context: string;
  message: string;
}): SystemLogSummary {
  const severity = severityFromLogLevel(params.level);
  const action = params.level === 'error'
    ? '시스템 오류 기록'
    : params.level === 'warn'
      ? '시스템 경고 기록'
      : params.level === 'debug'
        ? '시스템 디버그 기록'
        : params.level === 'verbose'
          ? '시스템 상세 기록'
          : '시스템 로그 기록';

  return {
    action,
    target: params.context || '애플리케이션',
    details: `메시지: ${params.message}`,
    severity,
    result: params.level === 'error' ? 'failure' : 'success',
    category: 'batch',
  };
}