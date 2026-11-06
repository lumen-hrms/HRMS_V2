import { SetMetadata } from '@nestjs/common';

export const REQUIRES_FEATURE_KEY = 'requiresFeature';

/** Gates a controller/handler behind a plan feature flag
 *  (`platform.subscriptions.features`, e.g. `biometricIntegration`) —
 *  enforced by `EntitlementGuard`. No decorator = no feature check. */
export const RequiresFeature = (feature: string) => SetMetadata(REQUIRES_FEATURE_KEY, feature);
