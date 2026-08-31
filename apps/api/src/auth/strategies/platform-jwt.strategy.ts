import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ConfigService } from '@nestjs/config';
import { ExtractJwt, Strategy } from 'passport-jwt';
import type { AppConfig } from '../../config/configuration';

export interface PlatformAccessTokenPayload {
  sub: string;
  email: string;
  type: 'platform_admin';
}

export interface AuthenticatedPlatformAdmin {
  sub: string;
  email: string;
}

/**
 * Separate strategy (and, architecturally, could use a separate secret) from
 * the tenant JwtStrategy. A platform-admin token can never satisfy the
 * tenant JwtStrategy's guard chain and vice versa, because `validate` here
 * rejects anything without `type: 'platform_admin'`, and the tenant
 * TenantGuard requires a `tenantId` claim that platform tokens never carry.
 */
@Injectable()
export class PlatformJwtStrategy extends PassportStrategy(Strategy, 'platform-jwt') {
  constructor(config: ConfigService<AppConfig, true>) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get('jwt.accessSecret', { infer: true }),
    });
  }

  validate(payload: PlatformAccessTokenPayload): AuthenticatedPlatformAdmin {
    if (payload.type !== 'platform_admin') {
      throw new UnauthorizedException('Not a platform admin token');
    }
    return { sub: payload.sub, email: payload.email };
  }
}
