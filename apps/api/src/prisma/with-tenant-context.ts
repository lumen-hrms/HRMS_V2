import type { TenantPrismaClientProvider } from './tenant-prisma-client.provider';

/**
 * Wraps every query on `raw` in a transaction that first sets the
 * `app.current_tenant_id` RLS session variable, then runs the query — the
 * Prisma-documented pattern for enforcing Postgres RLS. Shared by
 * TenantPrismaService (per-request) and PlatformAdminService (which needs
 * to bootstrap the first user of a brand-new tenant using the low-privilege
 * `hrms_app` connection rather than the platform role, since the platform
 * role has zero grants on `public`).
 */
export function withTenantContext(raw: TenantPrismaClientProvider, tenantId: string) {
  return raw.$extends({
    query: {
      $allModels: {
        async $allOperations({ args, query }) {
          const [, result] = await raw.$transaction([
            raw.$executeRaw`SELECT set_config('app.current_tenant_id', ${tenantId}, TRUE)`,
            query(args),
          ]);
          return result;
        },
      },
    },
  });
}
