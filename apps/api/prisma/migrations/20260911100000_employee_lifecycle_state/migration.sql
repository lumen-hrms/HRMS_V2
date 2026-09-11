-- Employee lifecycle state machine (module 03 §4.4), replacing the old
-- EmploymentStatus enum. Backfills existing rows onto the new state set
-- before dropping the old column/type, so no data is lost:
--   ACTIVE, ON_LEAVE -> CONFIRMED   (day-to-day leave lives on
--                                    AttendanceRecord/LeaveRequest, not here)
--   SUSPENDED        -> SUSPENDED
--   RESIGNED, TERMINATED -> SEPARATED

CREATE TYPE "public"."EmployeeLifecycleState" AS ENUM (
  'PRE_JOINING', 'PROBATION', 'CONFIRMED', 'NOTICE_PERIOD', 'SUSPENDED', 'SEPARATED'
);

ALTER TABLE "public"."employees"
  ADD COLUMN "lifecycle_state" "public"."EmployeeLifecycleState" NOT NULL DEFAULT 'PROBATION',
  ADD COLUMN "probation_end_date" TIMESTAMP(3),
  ADD COLUMN "confirmation_date" TIMESTAMP(3),
  ADD COLUMN "notice_start_date" TIMESTAMP(3),
  ADD COLUMN "last_working_date" TIMESTAMP(3);

UPDATE "public"."employees"
SET "lifecycle_state" = CASE "employment_status"
  WHEN 'ACTIVE' THEN 'CONFIRMED'
  WHEN 'ON_LEAVE' THEN 'CONFIRMED'
  WHEN 'SUSPENDED' THEN 'SUSPENDED'
  WHEN 'RESIGNED' THEN 'SEPARATED'
  WHEN 'TERMINATED' THEN 'SEPARATED'
END::"public"."EmployeeLifecycleState";

ALTER TABLE "public"."employees" DROP COLUMN "employment_status";

DROP TYPE "public"."EmploymentStatus";
