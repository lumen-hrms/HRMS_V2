-- ============================================================================
-- Module 04 (Leave) — "reporting manager only" approval.
--
-- * tenant_settings.leave_single_approver: who decides a request when
--   leave_approval_levels = 1 — HR (the existing behaviour, so the default)
--   or the employee's reporting manager alone. Ignored at 2 levels.
-- No new table, so no new RLS policy.
-- ============================================================================

-- CreateEnum
CREATE TYPE "public"."LeaveSingleApprover" AS ENUM ('HR', 'MANAGER');

-- AlterTable
ALTER TABLE "public"."tenant_settings"
  ADD COLUMN "leave_single_approver" "public"."LeaveSingleApprover" NOT NULL DEFAULT 'HR';
