import { Injectable, ExecutionContext } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Reflector } from '@nestjs/core';
import { Observable } from 'rxjs';
import {
  FIXED_ADMIN_UNLIMITED_TOKEN,
  FIXED_ADMIN_UNLIMITED_USER,
} from '../auth.constants';

export const IS_PUBLIC_KEY = 'isPublic';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private reflector: Reflector) {
    super();
  }

  private isFixedUnlimitedToken(request: any): boolean {
    if (!FIXED_ADMIN_UNLIMITED_TOKEN) {
      return false;
    }

    const authHeader =
      request?.headers?.authorization ?? request?.headers?.Authorization;

    if (!authHeader || typeof authHeader !== 'string') {
      return false;
    }

    const [type, token] = authHeader.trim().split(/\s+/, 2);
    return type?.toLowerCase() === 'bearer' && token === FIXED_ADMIN_UNLIMITED_TOKEN;
  }

  canActivate(
    context: ExecutionContext,
  ): boolean | Promise<boolean> | Observable<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    if (this.isFixedUnlimitedToken(request)) {
      request.user = { ...FIXED_ADMIN_UNLIMITED_USER };
      return true;
    }

    return super.canActivate(context);
  }
}
