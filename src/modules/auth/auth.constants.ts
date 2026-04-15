export const FIXED_ADMIN_LOGIN_USERNAME = 'admin';
export const FIXED_ADMIN_LOGIN_PASSWORD = 'admin123';
export const FIXED_ADMIN_PASSWORD_HASH = '$2b$10$KSiKi4XakiG/QIKckkLcquvtaK4LlAdp.gfA9WtwzE6OWvnV/NxBi';
export const FIXED_ADMIN_ORGANIZATION_ID = 'org-codeedge';
export const FIXED_ADMIN_ORGANIZATION_NAME = 'CodeEdge';

export const FIXED_ADMIN_USER = {
  id: 'acc-admin',
  username: FIXED_ADMIN_LOGIN_USERNAME,
  name: '슈퍼 관리자',
  email: 'admin@safein.kr',
  role: 'SUPER_ADMIN',
  organizationId: FIXED_ADMIN_ORGANIZATION_ID,
  organizationName: FIXED_ADMIN_ORGANIZATION_NAME,
} as const;
