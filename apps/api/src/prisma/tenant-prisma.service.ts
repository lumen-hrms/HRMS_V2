import { ForbiddenException, Inject, Injectable, Scope } from '@nestjs/common';
import { REQUEST } from '@nestjs/core';
import type { Request } from 'express';
import { TenantPrismaClientProvider } from './tenant-prisma-client.provider';
import { withTenantContext } from './with-tenant-context';

/**
 * Request-scoped accessor for tenant-scoped Prisma queries.
 *
 * Every query made through `.client` is wrapped in a transaction that first
 * calls `set_config('app.current_tenant_id', <tenantId>, true)` on the same
 * connection, then runs the actual query — the pattern Prisma documents for
 * enforcing Postgres RLS (`SELECT set_config(...)` must run on the exact
 * connection the query itself runs on, which is only guaranteed inside a
 * transaction since Prisma otherwise pools connections per-query).
 *
 * `tenantId` is only ever populated by TenantGuard/TenantResolutionMiddleware
 * from a source the request cannot forge:
 *   - for authenticated requests, from the validated JWT's `tenantId` claim
 *   - for pre-auth requests (login), from the subdomain/header-resolved
 *     tenant record looked up in the platform DB
 * There is no code path that lets a request set its own tenantId directly.
 */
@Injectable({ scope: Scope.REQUEST })
export class TenantPrismaService {
  constructor(
    private readonly raw: TenantPrismaClientProvider,
    @Inject(REQUEST) private readonly request: Request & { tenantId?: string },
  ) {}

  get tenantId(): string {
    if (!this.request.tenantId) {
      // Fail closed: no code path should reach a tenant-scoped query
      // without a resolved tenant. If this fires, it's a guard-ordering bug.
      throw new ForbiddenException('No tenant context resolved for this request');
    }
    return this.request.tenantId;
  }

  /**
   * A Prisma client extension where every operation is preceded, in the
   * same transaction/connection, by setting the RLS session variable to
   * this request's tenant. Safe to use exactly like a normal PrismaClient
   * for all `public` schema models.
   */
  get client() {
    return withTenantContext(this.raw, this.tenantId);
  }
}
