-- LeaveType: designated comp-off type flag. Additive, defaulted, no backfill needed.
ALTER TABLE "public"."leave_types" ADD COLUMN "is_comp_off" BOOLEAN NOT NULL DEFAULT false;

-- New ledger source for comp-off credits. Not used by any existing row until
-- LeaveService.creditCompOff() starts writing it.
ALTER TYPE "public"."LeaveLedgerSource" ADD VALUE 'COMP_OFF_CREDIT';
