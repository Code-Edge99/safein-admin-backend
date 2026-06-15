const LEGACY_HARD_DELETED_EMPLOYEE_NAME = '하드삭제 사용자';
const DELETED_EMPLOYEE_DISPLAY_NAME = '삭제된 사용자';

export function resolveEmployeeDisplayName(
  name?: string | null,
  fallback = '',
): string {
  const displayName = name || fallback;

  return displayName === LEGACY_HARD_DELETED_EMPLOYEE_NAME
    ? DELETED_EMPLOYEE_DISPLAY_NAME
    : displayName;
}
