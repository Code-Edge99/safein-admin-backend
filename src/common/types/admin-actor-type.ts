export const ADMIN_ACTOR_TYPES = ['SUPER_ADMIN', 'COMPANY_MANAGER', 'GROUP_MANAGER'] as const;

export type AdminActorType = (typeof ADMIN_ACTOR_TYPES)[number];