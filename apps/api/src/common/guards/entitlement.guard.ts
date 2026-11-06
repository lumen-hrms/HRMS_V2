import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PlatformPrismaClientProvider } from '../../prisma/platform-prisma-client.provider';
import { REQUIRES_MODULE_KEY, TenantModule } from '../decorators/requires-module.decorator';
import { REQUIRES_FEATURE_KEY } from '../decorators/requires-feature.decorator';
import type { AuthenticatedUser } from '../decorators/current-user.decorator';

/**
 * Layer-1 enforcement (CLAUDE.md / docs/TENANT_CONFIGURATION.md) — blocks a
 * route when the tenant's plan doesn't include the required module
 * (`@RequiresModule`) or feature flag (`@RequiresFeature`). Runs after
 * `JwtAuthGuard` (needs `request.user.tenantId`) and reads
 * `platform.subscriptions` directly — that table isn't on the tenant-scoped
 * Prisma client, so this is its own query rather than reusing `TenantGuard`.
 * No decorator on a route = no entitlement check, same "opt-in" shape as
 * `RolesGuard`.
 */
@Injectable()
export class EntitlementGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly platformPrisma: PlatformPrismaClientProvider,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredModule = this.reflector.getAllAndOverride<TenantModule | undefined>(
      REQUIRES_MODULE_KEY,
      [context.getHandler(), context.getClass()],
    );
    const requiredFeature = this.reflector.getAllAndOverride<string | undefined>(
      REQUIRES_FEATURE_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!requiredModule && !requiredFeature) return true;

    const request = context.switchToHttp().getRequest<{ user?: AuthenticatedUser }>();
    const tenantId = request.user?.tenantId;
    if (!tenantId) throw new ForbiddenException('No tenant context');

    const subscription = await this.platformPrisma.subscription.findUnique({ where: { tenantId } });
    if (!subscription) {
      throw new ForbiddenException('No active subscription for this tenant');
    }

    if (requiredModule && !subscription.enabledModules.includes(requiredModule)) {
      throw new ForbiddenException(`Your plan does not include the ${requiredModule} module`);
    }
    if (requiredFeature) {
      const features = (subscription.features as Record<string, boolean> | null) ?? {};
      if (!features[requiredFeature]) {
        throw new ForbiddenException(`Your plan does not include the "${requiredFeature}" feature`);
      }
    }
    return true;
  }
}
