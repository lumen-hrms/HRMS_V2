-- ============================================================================
-- Module 07 (Payroll) Phase 3 — run lifecycle
-- (docs/modules/07_PAYROLL_ENGINE.md §4.2, §6, §9 Phase 3).
--
-- * payroll_runs: at most one non-reprocess row per (tenant, period) —
--   partial unique index below, Prisma can't express it (same pattern as
--   salary_structures' "one ACTIVE per employee").
-- * payroll_run_approvals: append-only (INV-1) — no UPDATE/DELETE grant.
-- * payroll_line_items: immutable once its run is PROCESSED/DISBURSED
--   (INV-2) — enforced by a trigger, the real backstop per CLAUDE.md,
--   not just the service layer. hrms_app still gets UPDATE/DELETE grants
--   for the DRAFT/REVIEW editing window; the trigger is what actually
--   blocks mutation after PROCESSED.
-- * RLS keyed on tenant_id like every other tenant table.
-- ============================================================================

-- CreateEnum
CREATE TYPE "public"."PayrollRunStatus" AS ENUM ('DRAFT', 'REVIEW', 'APPROVED', 'PROCESSED', 'DISBURSED');

-- AlterEnum
ALTER TYPE "public"."NotificationTemplate" ADD VALUE 'PAYROLL_RUN_STATUS_CHANGED';

-- CreateTable
CREATE TABLE "public"."payroll_runs" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "period" TEXT NOT NULL,
    "status" "public"."PayrollRunStatus" NOT NULL DEFAULT 'DRAFT',
    "is_reprocess" BOOLEAN NOT NULL DEFAULT false,
    "reprocess_reason" TEXT,
    "prepared_by" UUID NOT NULL,
    "exceptions" JSONB NOT NULL DEFAULT '[]',
    "processed_at" TIMESTAMP(3),
    "disbursed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payroll_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."payroll_run_approvals" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "run_id" UUID NOT NULL,
    "approver_id" UUID NOT NULL,
    "approved_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payroll_run_approvals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."payroll_line_items" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "run_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "calculation_snapshot" JSONB NOT NULL DEFAULT '{}',
    "working_days" INTEGER NOT NULL,
    "payable_days" INTEGER NOT NULL,
    "lop_days" INTEGER NOT NULL,
    "gross_earnings" DECIMAL(14,2) NOT NULL,
    "epf_employee" DECIMAL(14,2) NOT NULL,
    "epf_employer" DECIMAL(14,2) NOT NULL,
    "esi_employee" DECIMAL(14,2) NOT NULL,
    "esi_employer" DECIMAL(14,2) NOT NULL,
    "professional_tax" DECIMAL(14,2) NOT NULL,
    "tds_deducted" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "ad_hoc_adjustments" JSONB NOT NULL DEFAULT '[]',
    "net_pay" DECIMAL(14,2) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payroll_line_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "payroll_runs_tenant_id_idx" ON "public"."payroll_runs"("tenant_id");

-- CreateIndex
CREATE INDEX "payroll_runs_tenant_id_period_idx" ON "public"."payroll_runs"("tenant_id", "period");

-- CreateIndex
CREATE INDEX "payroll_run_approvals_tenant_id_idx" ON "public"."payroll_run_approvals"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "payroll_run_approvals_run_id_approver_id_key" ON "public"."payroll_run_approvals"("run_id", "approver_id");

-- CreateIndex
CREATE INDEX "payroll_line_items_tenant_id_idx" ON "public"."payroll_line_items"("tenant_id");

-- CreateIndex
CREATE INDEX "payroll_line_items_tenant_id_employee_id_idx" ON "public"."payroll_line_items"("tenant_id", "employee_id");

-- CreateIndex
CREATE UNIQUE INDEX "payroll_line_items_run_id_employee_id_key" ON "public"."payroll_line_items"("run_id", "employee_id");

-- AddForeignKey
ALTER TABLE "public"."payroll_run_approvals" ADD CONSTRAINT "payroll_run_approvals_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "public"."payroll_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."payroll_line_items" ADD CONSTRAINT "payroll_line_items_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "public"."payroll_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."payroll_line_items" ADD CONSTRAINT "payroll_line_items_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- At most one non-reprocess run per (tenant, period) — INV-1.
CREATE UNIQUE INDEX "payroll_runs_one_regular_per_period"
  ON "public"."payroll_runs"("tenant_id", "period")
  WHERE "is_reprocess" = false;

-- A PayrollLineItem is immutable once its run is PROCESSED/DISBURSED (INV-2).
-- The real backstop: this fires regardless of what the service layer does.
CREATE OR REPLACE FUNCTION public.reject_processed_line_item_mutation()
RETURNS trigger AS $$
DECLARE
  run_status "public"."PayrollRunStatus";
BEGIN
  SELECT status INTO run_status FROM public.payroll_runs WHERE id = OLD.run_id;
  IF run_status IN ('PROCESSED', 'DISBURSED') THEN
    RAISE EXCEPTION 'payroll_line_items: cannot % a line item whose run has status % (INV-2)', lower(TG_OP), run_status;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER payroll_line_items_immutable
  BEFORE UPDATE OR DELETE ON public.payroll_line_items
  FOR EACH ROW EXECUTE FUNCTION public.reject_processed_line_item_mutation();

GRANT SELECT, INSERT, UPDATE ON public.payroll_runs TO hrms_app;
GRANT SELECT, INSERT ON public.payroll_run_approvals TO hrms_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.payroll_line_items TO hrms_app;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'payroll_runs', 'payroll_run_approvals', 'payroll_line_items'
  ]
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', t);

    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON public.%I', t);

    -- Unset session var -> NULL -> zero rows (fail closed), same as every table.
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON public.%I
         USING (tenant_id = current_setting(''app.current_tenant_id'', true)::uuid)
         WITH CHECK (tenant_id = current_setting(''app.current_tenant_id'', true)::uuid)',
      t
    );
  END LOOP;
END
$$;
