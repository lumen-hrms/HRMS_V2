-- ============================================================================
-- Module 04 (Leave) — event-based leave: maternity, paternity, marriage and
-- the maternity edge cases (adoption, commissioning mother, miscarriage).
--
-- * leave_types.grant_mode: ACCRUED (the existing yearly/periodic credit) or
--   ON_EVENT (no balance; each request names its event and is granted that
--   event's days). The other new columns configure ON_EVENT types.
-- * leave_requests.event_date: the delivery / birth / marriage date.
-- * LeaveLedgerSource.EVENT_GRANT: the event's days, credited at approval.
-- No new table, so no new RLS policy — both tables already have one.
-- ============================================================================

-- CreateEnum
CREATE TYPE "public"."LeaveGrantMode" AS ENUM ('ACCRUED', 'ON_EVENT');

-- AlterEnum
ALTER TYPE "public"."LeaveLedgerSource" ADD VALUE 'EVENT_GRANT';

-- AlterTable
ALTER TABLE "public"."leave_types"
  ADD COLUMN "grant_mode" "public"."LeaveGrantMode" NOT NULL DEFAULT 'ACCRUED',
  ADD COLUMN "days_per_event" DECIMAL(6,2),
  ADD COLUMN "reduced_days_per_event" DECIMAL(6,2),
  ADD COLUMN "reduced_after_events" INTEGER,
  ADD COLUMN "count_calendar_days" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "max_events_per_employment" INTEGER,
  ADD COLUMN "event_label" TEXT,
  ADD COLUMN "event_window_days_before" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "event_window_days_after" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "min_service_days" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "requires_document" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "statutory_maternity" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "public"."leave_requests" ADD COLUMN "event_date" DATE;
