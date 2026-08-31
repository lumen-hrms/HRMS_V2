import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ConfigService } from '@nestjs/config';
import { ExtractJwt, Strategy } from 'passport-jwt';
import type { AppConfig } from '../../config/configuration';
import type { AuthenticatedUser } from '../../common/decorators/current-user.decorator';

export interface AccessTokenPayload {
  sub: string;
  tenantId: string;
  role: string;
  email: string;
  employeeId?: string | null;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(config: ConfigService<AppConfig, true>) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get('jwt.accessSecret', { infer: true }),
    });
  }

  validate(payload: AccessTokenPayload): AuthenticatedUser {
    // Whatever is returned here becomes `req.user`. TenantGuard cross-checks
    // payload.tenantId against the tenant resolved from the subdomain/header
    // before any tenant-scoped query can happen.
    return {
      sub: payload.sub,
      tenantId: payload.tenantId,
      role: payload.role,
      email: payload.email,
      employeeId: payload.employeeId ?? null,
    };
  }
}
