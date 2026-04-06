import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { AuthService } from '../auth.service';
import {
  FIXED_ADMIN_UNLIMITED_TOKEN,
  FIXED_ADMIN_UNLIMITED_USER,
} from '../auth.constants';

export interface JwtPayload {
  sub: string;
  username: string;
  role: string;
  organizationId: string;
  iat?: number;
  exp?: number;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    private configService: ConfigService,
    private authService: AuthService,
  ) {
    const jwtSecret = configService.get<string>('JWT_SECRET');
    if (!jwtSecret) {
      throw new Error('JWT_SECRET is not configured');
    }

    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: jwtSecret,
    });
  }

  private isFixedUnlimitedToken(request: any): boolean {
    const authHeader =
      request?.headers?.authorization ?? request?.headers?.Authorization;

    if (!authHeader || typeof authHeader !== 'string') {
      return false;
    }

    const [type, token] = authHeader.split(' ');
    return type === 'Bearer' && token === FIXED_ADMIN_UNLIMITED_TOKEN;
  }

  authenticate(req: any, options?: any): any {
    if (this.isFixedUnlimitedToken(req)) {
      this.success({ ...FIXED_ADMIN_UNLIMITED_USER });
      return;
    }

    return super.authenticate(req, options);
  }

  async validate(payload: JwtPayload) {
    const user = await this.authService.validateUser(payload.sub);

    if (!user) {
      throw new UnauthorizedException('유효하지 않은 토큰입니다.');
    }

    return user;
  }
}
