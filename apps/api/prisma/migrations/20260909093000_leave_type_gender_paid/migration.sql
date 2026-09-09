-- LeaveType: gender restriction + paid flag. Additive with defaults, no backfill needed.
CREATE TYPE "public"."GenderRestriction" AS ENUM ('ANY', 'MALE', 'FEMALE');

ALTER TABLE "public"."leave_types"
  ADD COLUMN "gender_restriction" "public"."GenderRestriction" NOT NULL DEFAULT 'ANY',
  ADD COLUMN "paid" BOOLEAN NOT NULL DEFAULT true;
