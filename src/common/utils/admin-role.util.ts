import { AdminRole } from '@prisma/client';

/**
 * 관리자 역할이 슈퍼관리자인지 판정한다.
 * role 값이 Prisma enum(AdminRole) 또는 평문 문자열('SUPER_ADMIN') 어느 쪽으로 들어와도
 * 동일하게 처리하기 위해 두 형태를 모두 비교한다.
 */
export function isSuperAdminRole(role?: AdminRole | string | null): boolean {
  return role === AdminRole.SUPER_ADMIN || role === 'SUPER_ADMIN';
}
