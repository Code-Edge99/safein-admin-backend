import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthenticatedAdminRequest } from '../../../common/types/authenticated-request.type';
import { PermissionsService } from '../../permissions/permissions.service';
import { PERMISSION_CODES_KEY } from '../decorators/permission-codes.decorator';

@Injectable()
export class EffectivePermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly permissionsService: PermissionsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredCodes = this.reflector.getAllAndOverride<string[]>(PERMISSION_CODES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!requiredCodes || requiredCodes.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthenticatedAdminRequest>();
    const user = request.user;

    if (!user) {
      throw new ForbiddenException('인증 정보가 없습니다.');
    }

    if (!request.effectivePermissionCodes) {
      const effectivePermissions = await this.permissionsService.findMine({
        id: user.id,
        role: user.role,
        organizationId: user.organizationId,
        scopeOrganizationIds: request.organizationScopeIds ?? undefined,
      });

      request.effectivePermissionCodes = effectivePermissions.codes;
    }

    if (requiredCodes.some((code) => request.effectivePermissionCodes?.includes(code))) {
      return true;
    }

    throw new ForbiddenException('권한이 없습니다.');
  }
}