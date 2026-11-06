-- ============================================================================
-- Module 07 (Payroll) Phase 7 — re-process, revisions, arrears
-- (docs/modules/07_PAYROLL_ENGINE.md §9 Phase 7).
--
-- * salary_revisions: append-only history (no UPDATE/DELETE grant).
-- * arrears_line_items: PENDING until a DRAFT run folds it into that run's
--   adHocAdjustments (payroll-run.service.ts assembleLineItems), then
--   FOLDED — never a rewrite of the original (already-immutable, INV-2)
--   PayrollLineItem.
-- * RLS keyed on tenant_id like every other tenant table.
-- ============================================================================

-- CreateEnum
CREATE TYPE "public"."ArrearsLineItemStatus" AS ENUM ('PENDING', 'FOLDED');

-- CreateTable
CREATE TABLE "public"."salary_revisions" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "previous_structure_id" UUID,
    "new_structure_id" UUID NOT NULL,
    "effective_date" DATE NOT NULL,
    "reason" TEXT NOT NULL,
    "approved_by" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "salary_revisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."arrears_line_items" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "revision_id" UUID NOT NULL,
    "period" TEXT NOT NULL,
    "original_run_id" UUID NOT NULL,
    "previous_net_pay" DECIMAL(14,2) NOT NULL,
    "revised_net_pay" DECIMAL(14,2) NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "status" "public"."ArrearsLineItemStatus" NOT NULL DEFAULT 'PENDING',
    "folded_into_run_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "arrears_line_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "salary_revisions_tenant_id_idx" ON "public"."salary_revisions"("tenant_id");

-- CreateIndex
CREATE INDEX "salary_revisions_tenant_id_employee_id_idx" ON "public"."salary_revisions"("tenant_id", "employee_id");

-- CreateIndex
CREATE INDEX "arrears_line_items_tenant_id_idx" ON "public"."arrears_line_items"("tenant_id");

-- CreateIndex
CREATE INDEX "arrears_line_items_tenant_id_employee_id_status_idx" ON "public"."arrears_line_items"("tenant_id", "employee_id", "status");

-- AddForeignKey
ALTER TABLE "public"."salary_revisions" ADD CONSTRAINT "salary_revisions_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."arrears_line_items" ADD CONSTRAINT "arrears_line_items_revision_id_fkey" FOREIGN KEY ("revision_id") REFERENCES "public"."salary_revisions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."arrears_line_items" ADD CONSTRAINT "arrears_line_items_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

GRANT SELECT, INSERT ON public.salary_revisions TO hrms_app;
GRANT SELECT, INSERT, UPDATE ON public.arrears_line_items TO hrms_app;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'salary_revisions', 'arrears_line_items'
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
