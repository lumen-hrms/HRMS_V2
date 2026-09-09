-- CreateEnum
CREATE TYPE "public"."AccrualFrequency" AS ENUM ('ANNUAL', 'MONTHLY', 'QUARTERLY');

-- CreateEnum
CREATE TYPE "public"."LeaveApprovalDecision" AS ENUM ('APPROVED', 'REJECTED', 'ESCALATED');

-- CreateEnum
CREATE TYPE "public"."LeaveLedgerSource" AS ENUM ('ACCRUAL', 'CARRY_FORWARD', 'REQUEST_APPROVED', 'REQUEST_CANCELLED', 'HR_ADJUSTMENT');

-- AlterTable
ALTER TABLE "public"."leave_requests" ADD COLUMN     "attachment_key" TEXT,
ADD COLUMN     "attachment_mime_type" TEXT,
ADD COLUMN     "attachment_name" TEXT,
ADD COLUMN     "attachment_size_bytes" INTEGER;

-- AlterTable
ALTER TABLE "public"."leave_types" ADD COLUMN     "accrual_frequency" "public"."AccrualFrequency" NOT NULL DEFAULT 'ANNUAL';

-- AlterTable
ALTER TABLE "public"."tenant_settings" ADD COLUMN     "leave_escalation_days" INTEGER NOT NULL DEFAULT 3;

-- CreateTable
CREATE TABLE "public"."leave_approvals" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "leave_request_id" UUID NOT NULL,
    "level" INTEGER NOT NULL,
    "approver_id" UUID,
    "decision" "public"."LeaveApprovalDecision" NOT NULL,
    "decided_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "comment" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "leave_approvals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."leave_ledger_entries" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "leave_type_id" UUID NOT NULL,
    "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "delta" DECIMAL(6,2) NOT NULL,
    "balance_after" DECIMAL(6,2) NOT NULL,
    "source" "public"."LeaveLedgerSource" NOT NULL,
    "note" TEXT,
    "actor_user_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "leave_ledger_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "leave_approvals_tenant_id_idx" ON "public"."leave_approvals"("tenant_id");

-- CreateIndex
CREATE INDEX "leave_approvals_tenant_id_leave_request_id_idx" ON "public"."leave_approvals"("tenant_id", "leave_request_id");

-- CreateIndex
CREATE INDEX "leave_ledger_entries_tenant_id_idx" ON "public"."leave_ledger_entries"("tenant_id");

-- CreateIndex
CREATE INDEX "leave_ledger_entries_tenant_id_employee_id_leave_type_id_idx" ON "public"."leave_ledger_entries"("tenant_id", "employee_id", "leave_type_id");

-- AddForeignKey
ALTER TABLE "public"."leave_approvals" ADD CONSTRAINT "leave_approvals_leave_request_id_fkey" FOREIGN KEY ("leave_request_id") REFERENCES "public"."leave_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."leave_approvals" ADD CONSTRAINT "leave_approvals_approver_id_fkey" FOREIGN KEY ("approver_id") REFERENCES "public"."employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."leave_ledger_entries" ADD CONSTRAINT "leave_ledger_entries_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."leave_ledger_entries" ADD CONSTRAINT "leave_ledger_entries_leave_type_id_fkey" FOREIGN KEY ("leave_type_id") REFERENCES "public"."leave_types"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ============================================================================
-- Grants + Row-Level Security for the new `public` tables, identical in
-- shape to every other tenant table (see 20260101000002_roles_and_rls).
-- ============================================================================

GRANT SELECT, INSERT, UPDATE, DELETE ON
  public.leave_approvals,
  public.leave_ledger_entries
TO hrms_app;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'leave_approvals', 'leave_ledger_entries'
  ]
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', t);

    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON public.%I', t);

    -- current_setting(..., true) -> NULL when unset, and NULL = anything is
    -- never true, so an unset tenant context sees/writes ZERO rows.
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON public.%I
         USING (tenant_id = current_setting(''app.current_tenant_id'', true)::uuid)
         WITH CHECK (tenant_id = current_setting(''app.current_tenant_id'', true)::uuid)',
      t
    );
  END LOOP;
END
$$;
