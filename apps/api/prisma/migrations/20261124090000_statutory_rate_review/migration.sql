-- ============================================================================
-- Module 07 (Payroll) Phase 9 — statutory rate review
-- (docs/modules/07_PAYROLL_ENGINE.md §12 decision 11).
--
-- * EPF wage ceiling default raised 15,000 -> 25,000 per the Sept 2026
--   wage-ceiling notification (S.O. 5109(E), effective 2026-09-17). Also
--   backfills any existing tenant row still sitting on the old default —
--   a tenant that deliberately customized epf_ceiling away from 15,000 is
--   left untouched.
-- * New payroll_settings.gratuity_max_amount column: the statutory ₹20L
--   gratuity cap (notification S.O. 1420(E)), tenant-editable like every
--   other figure in this table.
-- ============================================================================

ALTER TABLE "public"."payroll_settings"
  ALTER COLUMN "epf_ceiling" SET DEFAULT 25000;

UPDATE "public"."payroll_settings"
  SET "epf_ceiling" = 25000
  WHERE "epf_ceiling" = 15000;

ALTER TABLE "public"."payroll_settings"
  ADD COLUMN "gratuity_max_amount" DECIMAL(12,2) NOT NULL DEFAULT 2000000;
