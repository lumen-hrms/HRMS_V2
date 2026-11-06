-- ============================================================================
-- Module 02 (Platform Admin) — close two remaining gaps:
--
-- 1. Break-glass control plane: `platform.break_glass_grants` records who
--    requested time-boxed support access to a tenant, why, and its
--    lifecycle (ACTIVE/EXPIRED/REVOKED). This is the auditable record the
--    console's Break-glass dialog/status sheet were already built against
--    (TODO(api) in apps/web/src/pages/platform-admin/components/
--    breakglass-*.tsx). It does NOT itself widen `hrms_platform`'s grants —
--    actually escalating a read against one tenant's `public` schema for the
--    grant's lifetime is a separate connection-pool mechanism, deliberately
--    still deferred (see docs/MODULE_SPECS.md module 02).
--
-- 2. `platform_audit_log` true append-only: the original roles_and_rls
--    migration granted hrms_platform full CRUD on every platform table,
--    audit log included. Revoke UPDATE/DELETE here — same append-only
--    invariant CLAUDE.md already requires for `public.audit_log` and
--    `login_audit_entries`.
-- ============================================================================

-- CreateEnum
CREATE TYPE "platform"."BreakGlassStatus" AS ENUM ('ACTIVE', 'EXPIRED', 'REVOKED');

-- CreateTable
CREATE TABLE "platform"."break_glass_grants" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "requested_by" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "platform"."BreakGlassStatus" NOT NULL DEFAULT 'ACTIVE',
    "access_count" INTEGER NOT NULL DEFAULT 0,
    "granted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),
    "revoked_by" TEXT,

    CONSTRAINT "break_glass_grants_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "break_glass_grants_tenant_id_idx" ON "platform"."break_glass_grants"("tenant_id");
CREATE INDEX "break_glass_grants_status_expires_at_idx" ON "platform"."break_glass_grants"("status", "expires_at");

GRANT SELECT, INSERT, UPDATE ON platform.break_glass_grants TO hrms_platform;

-- Append-only audit log: writes stay allowed, edits/deletes don't.
REVOKE UPDATE, DELETE ON platform.platform_audit_log FROM hrms_platform;
