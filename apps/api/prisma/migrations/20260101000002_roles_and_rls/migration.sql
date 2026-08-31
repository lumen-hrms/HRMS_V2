-- ============================================================================
-- Roles, grants and Row-Level Security policies.
--
-- This migration is the enforcement point for the product's core promise:
-- one tenant can never read or write another tenant's rows, even if there
-- is a bug in application-layer WHERE clauses.
--
-- Three Postgres roles exist after this migration:
--   * the role in DATABASE_URL (whoever runs `prisma migrate deploy`, e.g.
--     hrms_superuser) — owns all objects, used ONLY for migrations. Never
--     used by the running application.
--   * hrms_app       — used by the NestJS API for all tenant-business
--                       queries. Has CRUD on `public` tables only, is NOT a
--                       superuser, and critically does NOT have BYPASSRLS,
--                       so the RLS policies below always apply to it.
--   * hrms_platform  — used by the platform-admin module. Has CRUD on
--                       `platform` tables only. Has ZERO grants on the
--                       `public` schema, so it is architecturally incapable
--                       of querying tenant/employee/leave data, independent
--                       of any application code.
--
-- Passwords below are for local development only. In any shared/staging/
-- production environment, rotate them via `ALTER ROLE ... PASSWORD` and
-- inject the real values through environment variables / a secrets
-- manager — never commit real credentials.
-- ============================================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hrms_app') THEN
    CREATE ROLE hrms_app LOGIN PASSWORD 'hrms_app_pw' NOBYPASSRLS NOSUPERUSER NOCREATEDB NOCREATEROLE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hrms_platform') THEN
    CREATE ROLE hrms_platform LOGIN PASSWORD 'hrms_platform_pw' NOBYPASSRLS NOSUPERUSER NOCREATEDB NOCREATEROLE;
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- hrms_app: full CRUD on tenant tables in `public`, nothing in `platform`.
-- ---------------------------------------------------------------------------
GRANT USAGE ON SCHEMA public TO hrms_app;

GRANT SELECT, INSERT, UPDATE, DELETE ON
  public.users,
  public.departments,
  public.employees,
  public.documents,
  public.leave_types,
  public.leave_balances,
  public.leave_requests,
  public.audit_log
TO hrms_app;

-- Explicitly revoke any accidental grants on the platform schema.
REVOKE ALL ON SCHEMA platform FROM hrms_app;

-- ---------------------------------------------------------------------------
-- hrms_platform: full CRUD on platform tables only. No access whatsoever to
-- the `public` schema — not even USAGE — so it cannot resolve tenant table
-- names, let alone query them.
-- ---------------------------------------------------------------------------
GRANT USAGE ON SCHEMA platform TO hrms_platform;

GRANT SELECT, INSERT, UPDATE, DELETE ON
  platform.tenants,
  platform.subscriptions,
  platform.platform_admin_users,
  platform.platform_audit_log
TO hrms_platform;

REVOKE ALL ON SCHEMA public FROM hrms_platform;

-- ---------------------------------------------------------------------------
-- Row-Level Security on every tenant-owned table.
--
-- FORCE ROW LEVEL SECURITY is applied in addition to ENABLE so that even the
-- table owner (the migration role) is subject to the policy for any
-- connection that isn't a superuser/BYPASSRLS role — defense in depth in
-- case the app is ever misconfigured to connect as the owner role.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'users', 'departments', 'employees', 'documents',
    'leave_types', 'leave_balances', 'leave_requests', 'audit_log'
  ]
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', t);

    EXECUTE format(
      'DROP POLICY IF EXISTS tenant_isolation ON public.%I', t
    );

    -- current_setting(..., true) returns NULL rather than raising when the
    -- session variable has not been set for this connection/transaction —
    -- and NULL = anything is never true, so an unset tenant context sees
    -- and writes ZERO rows (fail closed, not fail open).
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON public.%I
         USING (tenant_id = current_setting(''app.current_tenant_id'', true)::uuid)
         WITH CHECK (tenant_id = current_setting(''app.current_tenant_id'', true)::uuid)',
      t
    );
  END LOOP;
END
$$;
