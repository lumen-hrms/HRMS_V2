import type { Prisma } from '@prisma/client';

/**
 * Short-lived, in-process cache for the per-request identity lookups every
 * authenticated call makes before any business query runs:
 *   - subdomain -> tenant (TenantResolutionMiddleware)
 *   - firebaseUid -> user row + linked employee id (JwtAuthGuard)
 *   - tenant -> "company setup finished" (JwtAuthGuard; only `true` is
 *     cached, since setup never un-finishes)
 *
 * Why: each of those is a cross-region round trip on the dev/preview stack
 * (~0.6–0.8 s apiece), paid on every click. Correctness: every write to a
 * tenant, a user, or an employee's login link clears the matching cache
 * straight away on this instance (see `invalidateOnIdentityWrites`), so a
 * suspend / deactivate / role change bites immediately here and within
 * AUTH_CACHE_TTL_MS on any other instance — an owner-approved trade-off.
 */
export const AUTH_CACHE_TTL_MS = 30_000;
const MAX_ENTRIES = 10_000;

export class TtlCache<V> {
  private readonly entries = new Map<string, { value: V; expiresAt: number }>();

  constructor(
    private readonly ttlMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  get(key: string): V | undefined {
    const hit = this.entries.get(key);
    if (!hit) return undefined;
    if (hit.expiresAt <= this.now()) {
      this.entries.delete(key);
      return undefined;
    }
    return hit.value;
  }

  set(key: string, value: V) {
    if (this.entries.size >= MAX_ENTRIES) this.evictExpired();
    if (this.entries.size >= MAX_ENTRIES) this.entries.clear();
    this.entries.set(key, { value, expiresAt: this.now() + this.ttlMs });
  }

  clear() {
    this.entries.clear();
  }

  get size() {
    return this.entries.size;
  }

  private evictExpired() {
    const now = this.now();
    for (const [key, { expiresAt }] of this.entries) if (expiresAt <= now) this.entries.delete(key);
  }
}

export interface CachedTenant {
  id: string;
  subdomain: string;
  name: string;
  status: string;
}

export interface CachedAuthUser {
  id: string;
  role: string;
  email: string;
  isActive: boolean;
  employeeId: string | null;
}

export const tenantBySubdomain = new TtlCache<CachedTenant>(AUTH_CACHE_TTL_MS);
/** Keyed `${tenantId}:${firebaseUid}`. */
export const authUserByUid = new TtlCache<CachedAuthUser>(AUTH_CACHE_TTL_MS);
export const setupCompleteByTenant = new TtlCache<true>(AUTH_CACHE_TTL_MS);

export function clearAuthContextCaches() {
  tenantBySubdomain.clear();
  authUserByUid.clear();
  setupCompleteByTenant.clear();
}

const WRITE_ACTIONS = new Set([
  'create',
  'createMany',
  'update',
  'updateMany',
  'upsert',
  'delete',
  'deleteMany',
]);

/** True when an Employee write sets or clears its login link. */
function touchesLoginLink(args: Record<string, unknown> | undefined): boolean {
  if (!args) return false;
  return ['data', 'create', 'update'].some((k) => {
    const v = args[k];
    return !!v && typeof v === 'object' && ('userId' in v || 'user' in v);
  });
}

/**
 * Prisma middleware for both DB clients: drops cached identity data when the
 * row it was read from changes. Clears the whole cache rather than one key —
 * these writes are rare (status/role/link changes), and the params don't
 * always carry the tenant or uid.
 */
export function invalidateOnIdentityWrites(): Prisma.Middleware {
  return async (params, next) => {
    const result = await next(params);
    if (WRITE_ACTIONS.has(params.action)) {
      if (params.model === 'Tenant') tenantBySubdomain.clear();
      if (params.model === 'User') authUserByUid.clear();
      if (params.model === 'TenantSetup') setupCompleteByTenant.clear();
      if (params.model === 'Employee' && touchesLoginLink(params.args)) authUserByUid.clear();
    }
    return result;
  };
}
