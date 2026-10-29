-- Module 04 (Leave) — policy recalculation (Leave › Settings): reverses this
-- leave year's policy credits so the entitlement engine can re-apply them
-- with a corrected go-live date / the current rounding rules.

-- AlterEnum
ALTER TYPE "public"."LeaveLedgerSource" ADD VALUE 'ACCRUAL_REVERSAL';
