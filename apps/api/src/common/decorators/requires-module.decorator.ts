import { SetMetadata } from '@nestjs/common';

/** Mirrors `platform-admin/entitlements.ts`'s `MODULES` — the values a
 *  `Subscription.enabledModules` array can contain. */
export type TenantModule = 'CORE_HR' | 'LEAVE' | 'ATTENDANCE' | 'PAYROLL' | 'COMPLIANCE';

export const REQUIRES_MODULE_KEY = 'requiresModule';

/** Gates a controller/handler behind the tenant's plan having this module
 *  enabled (`platform.subscriptions.enabled_modules`) — enforced by
 *  `EntitlementGuard`. No decorator = no module check. */
export const RequiresModule = (module: TenantModule) => SetMetadata(REQUIRES_MODULE_KEY, module);
