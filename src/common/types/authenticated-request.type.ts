import { Request } from 'express';

export interface AuthenticatedAdminUser {
  id: string;
  role: string;
  organizationId?: string;
}

export interface AuthenticatedAdminRequest extends Request {
  user?: AuthenticatedAdminUser;
  organizationScopeIds?: string[];
  effectivePermissionCodes?: string[];
}
