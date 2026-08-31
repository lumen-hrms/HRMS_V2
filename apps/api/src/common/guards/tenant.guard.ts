import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import type { AuthenticatedUser } from '../decorators/current-user.decorator';
import type { TenantResolvedRequest } from '../tenancy/tenant-resolution.middleware';

/**
 * Runs AFTER JwtAuthGuard. Cross-checks the tenant claimed by the JWT
 * against the tenant resolved from the request's subdomain/header by
 * TenantResolutionMiddleware.
 *
 * This is what stops a stolen/valid token issued for tenant A from being
 * used against tenant B's subdomain: even though the JWT signature is
 * valid, tenantId won't match, so the request is rejected before any
 * business-logic query runs.
 */
@Injectable()
export class TenantGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    const request = context
      .switchToHttp()
      .getRequest<TenantResolvedRequest & { user?: AuthenticatedUser }>();

    if (isPublic) {
      // Public tenant-scoped routes (e.g. login) still require a tenant to
      // have been resolved by the middleware, just not a JWT.
      if (!request.tenantId) {
        throw new ForbiddenException('No tenant resolved for this request');
      }
      return true;
    }

    if (!request.user) {
      throw new ForbiddenException('No authenticated user on request');
    }
    if (!request.tenantId || request.user.tenantId !== request.tenantId) {
      throw new ForbiddenException('Token tenant does not match the requested tenant');
    }
    return true;
  }
}
