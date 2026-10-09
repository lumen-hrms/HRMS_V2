-- ============================================================================
-- Module 07 (Payroll) Phase 5 — payslips and bank files
-- (docs/modules/07_PAYROLL_ENGINE.md §9 Phase 5).
--
-- * payroll_line_items.payslip_file_key: S3 key of the generated,
--   DOB-locked payslip PDF, set during process() for any employee with a
--   dateOfBirth on file. Written while the run is still APPROVED (one
--   statement before the run flips to PROCESSED in the same transaction),
--   so the INV-2 immutability trigger from Phase 3 does not reject it.
-- * PAYSLIP_READY notification template.
-- No new table, no new grant/RLS — payslip_file_key rides the existing
-- payroll_line_items UPDATE grant and RLS policy from Phase 3.
-- ============================================================================

-- AlterTable
ALTER TABLE "public"."payroll_line_items" ADD COLUMN "payslip_file_key" TEXT;

-- AlterEnum
ALTER TYPE "public"."NotificationTemplate" ADD VALUE 'PAYSLIP_READY';
