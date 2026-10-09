-- ============================================================================
-- Module 07 (Payroll) Phase 4 — overtime claims
-- (docs/modules/07_PAYROLL_ENGINE.md §4.2, §9 Phase 4, decision 6).
--
-- * overtime_claims is owned by module 05 (Attendance) — the workflow lives
--   in AttendanceService, Payroll only reads getApprovedOvertime(Batch)().
--   One claim per employee per month (unique index).
-- * payroll_settings gains overtimeEnabled/overtimeMultiplier (off by
--   default, so no tenant's payroll changes until a Company Admin opts in).
-- * RLS keyed on tenant_id like every other tenant table.
-- ============================================================================

-- CreateEnum
CREATE TYPE "public"."OvertimeClaimStatus" AS ENUM ('PENDING_MANAGER', 'PENDING_HR', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "public"."OvertimePayoutMode" AS ENUM ('CASH', 'COMP_OFF');

-- AlterEnum
ALTER TYPE "public"."NotificationTemplate" ADD VALUE 'OVERTIME_CLAIM_PENDING_APPROVAL';
ALTER TYPE "public"."NotificationTemplate" ADD VALUE 'OVERTIME_CLAIM_DECIDED';

-- AlterTable
ALTER TABLE "public"."payroll_settings" ADD COLUMN     "overtime_enabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "overtime_multiplier" DECIMAL(4,2) NOT NULL DEFAULT 2.0;

-- CreateTable
CREATE TABLE "public"."overtime_claims" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "month" VARCHAR(7) NOT NULL,
    "hours" DECIMAL(6,2) NOT NULL,
    "payout_mode" "public"."OvertimePayoutMode" NOT NULL,
    "status" "public"."OvertimeClaimStatus" NOT NULL DEFAULT 'PENDING_MANAGER',
    "manager_approver_id" UUID,
    "manager_decided_at" TIMESTAMP(3),
    "hr_approver_id" UUID,
    "hr_decided_at" TIMESTAMP(3),
    "rejection_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "overtime_claims_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "overtime_claims_tenant_id_idx" ON "public"."overtime_claims"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "overtime_claims_employee_id_month_key" ON "public"."overtime_claims"("employee_id", "month");

-- AddForeignKey
ALTER TABLE "public"."overtime_claims" ADD CONSTRAINT "overtime_claims_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

GRANT SELECT, INSERT, UPDATE ON public.overtime_claims TO hrms_app;

ALTER TABLE public.overtime_claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.overtime_claims FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON public.overtime_claims;

CREATE POLICY tenant_isolation ON public.overtime_claims
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
