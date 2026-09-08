-- CreateEnum
CREATE TYPE "public"."LoginOutcome" AS ENUM ('SUCCESS', 'USER_INACTIVE', 'CLAIM_MISMATCH', 'TOKEN_EXPIRED');

-- CreateTable
CREATE TABLE "public"."login_audit_entries" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "user_id" UUID,
    "outcome" "public"."LoginOutcome" NOT NULL,
    "ip_address" TEXT,
    "user_agent" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "login_audit_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "login_audit_entries_tenant_id_idx" ON "public"."login_audit_entries"("tenant_id");

-- CreateIndex
CREATE INDEX "login_audit_entries_tenant_id_at_idx" ON "public"."login_audit_entries"("tenant_id", "at");

-- CreateIndex
CREATE INDEX "login_audit_entries_tenant_id_user_id_outcome_idx" ON "public"."login_audit_entries"("tenant_id", "user_id", "outcome");

-- ============================================================================
-- Append-only grants + Row-Level Security for the sign-in audit trail.
--
-- Follows the grants + fail-closed RLS pattern from
-- 20260101000002_roles_and_rls / 20260904094219_attendance_module, with ONE
-- deliberate difference: hrms_app gets SELECT + INSERT only — NO UPDATE,
-- NO DELETE — so the running application is structurally incapable of
-- rewriting or erasing a login audit row (module 01 §6 RULE-6, CLAUDE.md
-- "audit log is append-only from day one").
-- ============================================================================

GRANT SELECT, INSERT ON public.login_audit_entries TO hrms_app;

ALTER TABLE "public"."login_audit_entries" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."login_audit_entries" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON public.login_audit_entries;

-- current_setting(..., true) returns NULL (not an error) when the RLS
-- session var is unset, and NULL = anything is never true — so a query with
-- no tenant context set sees and writes ZERO rows (fail closed).
CREATE POLICY tenant_isolation ON public.login_audit_entries
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ---------------------------------------------------------------------------
-- Retro-tighten public.audit_log to append-only too. The original
-- roles_and_rls migration granted hrms_app full CRUD on it; the generic
-- access-change trail (GET /api/access/audit?feed=access) and the future
-- Audit Log module (12) both rely on it being immutable in practice. RLS
-- and the existing SELECT/INSERT grant are unchanged.
-- ---------------------------------------------------------------------------
REVOKE UPDATE, DELETE ON public.audit_log FROM hrms_app;
