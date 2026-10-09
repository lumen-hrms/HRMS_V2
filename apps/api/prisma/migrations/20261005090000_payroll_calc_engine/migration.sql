-- ============================================================================
-- Module 07 (Payroll) Phase 2 — calculation engine
-- (docs/modules/07_PAYROLL_ENGINE.md §9 Phase 2, §12 decision 14).
--
-- * employees.weekly_off_days_override: a per-employee override of the
--   tenant's weekly off-days, for staff whose off days differ from the
--   tenant default (e.g. rotational shift staff). Empty (the default)
--   falls back to the tenant's TenantSettings.weeklyOffDays — Prisma can't
--   express an optional list. Drives the working-day count the calculation
--   engine prorates LOP and mid-month join/exit pay against.
-- ============================================================================

-- AlterTable
ALTER TABLE "public"."employees" ADD COLUMN     "weekly_off_days_override" INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[];
