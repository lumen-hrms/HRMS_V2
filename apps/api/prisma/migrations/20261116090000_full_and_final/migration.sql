-- ============================================================================
-- Module 07 (Payroll) Phase 8 — Full & Final settlement
-- (docs/modules/07_PAYROLL_ENGINE.md §9 Phase 8).
--
-- * full_and_final_settlements: standalone off-cycle record, never folded
--   into a PayrollRun (decision 7). One per employee ever (unique FK).
-- * leave_types.is_encashable (module 04): new column this module reads,
--   same cross-module pattern as Employee.workState (Phase 1).
-- * payroll_settings: five new leave-encashment/gratuity config columns.
-- * RLS keyed on tenant_id like every other tenant table.
-- ============================================================================

-- CreateEnum
CREATE TYPE "public"."FullAndFinalSettlementStatus" AS ENUM ('DRAFT', 'APPROVED', 'PAID');

-- AlterTable
ALTER TABLE "public"."leave_types" ADD COLUMN "is_encashable" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "public"."payroll_settings"
  ADD COLUMN "leave_encashment_divisor" DECIMAL(5,2) NOT NULL DEFAULT 26,
  ADD COLUMN "leave_encashment_components" TEXT[] NOT NULL DEFAULT ARRAY['BASIC']::TEXT[],
  ADD COLUMN "gratuity_eligibility_years" INTEGER NOT NULL DEFAULT 5,
  ADD COLUMN "gratuity_days_per_year" DECIMAL(5,2) NOT NULL DEFAULT 15,
  ADD COLUMN "gratuity_month_divisor" DECIMAL(5,2) NOT NULL DEFAULT 26;

-- CreateTable
CREATE TABLE "public"."full_and_final_settlements" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "separation_date" DATE NOT NULL,
    "unpaid_salary_days" INTEGER NOT NULL,
    "unpaid_salary_amount" DECIMAL(14,2) NOT NULL,
    "leave_encashment_days" DECIMAL(6,2) NOT NULL,
    "leave_encashment_amount" DECIMAL(14,2) NOT NULL,
    "gratuity_years_of_service" INTEGER NOT NULL,
    "gratuity_amount" DECIMAL(14,2) NOT NULL,
    "advance_recovery_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "net_settlement" DECIMAL(14,2) NOT NULL,
    "calculation_snapshot" JSONB NOT NULL DEFAULT '{}',
    "status" "public"."FullAndFinalSettlementStatus" NOT NULL DEFAULT 'DRAFT',
    "prepared_by" UUID NOT NULL,
    "approved_by" UUID,
    "approved_at" TIMESTAMP(3),
    "paid_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "full_and_final_settlements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "full_and_final_settlements_employee_id_key" ON "public"."full_and_final_settlements"("employee_id");

-- CreateIndex
CREATE INDEX "full_and_final_settlements_tenant_id_idx" ON "public"."full_and_final_settlements"("tenant_id");

-- AddForeignKey
ALTER TABLE "public"."full_and_final_settlements" ADD CONSTRAINT "full_and_final_settlements_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

GRANT SELECT, INSERT, UPDATE ON public.full_and_final_settlements TO hrms_app;

ALTER TABLE public.full_and_final_settlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.full_and_final_settlements FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON public.full_and_final_settlements;

CREATE POLICY tenant_isolation ON public.full_and_final_settlements
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
