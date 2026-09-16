-- Leave module: fields needed to flip the frontend off VITE_LEAVE_MOCK.
-- `code` on leave_types has existing rows to backfill before it can be
-- NOT NULL + unique per tenant — done deterministically from the name's
-- alphabetic initials, deduped with a numeric suffix on collision.

-- AlterTable: additive columns first, code nullable until backfilled
ALTER TABLE "public"."leave_types"
  ADD COLUMN "code" TEXT,
  ADD COLUMN "color_token" TEXT NOT NULL DEFAULT '#2b5a8c',
  ADD COLUMN "min_notice_days" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "active" BOOLEAN NOT NULL DEFAULT true;

-- Backfill code from name initials (e.g. "Casual Leave" -> "CAS"), deduped
-- per tenant with a numeric suffix if two names collide.
WITH derived AS (
  SELECT
    id,
    UPPER(LEFT(regexp_replace(name, '[^A-Za-z]', '', 'g'), 3)) AS base_code,
    ROW_NUMBER() OVER (
      PARTITION BY tenant_id, UPPER(LEFT(regexp_replace(name, '[^A-Za-z]', '', 'g'), 3))
      ORDER BY id
    ) AS rn
  FROM "public"."leave_types"
)
UPDATE "public"."leave_types" AS lt
SET "code" = derived.base_code || CASE WHEN derived.rn > 1 THEN derived.rn::text ELSE '' END
FROM derived
WHERE lt.id = derived.id;

ALTER TABLE "public"."leave_types" ALTER COLUMN "code" SET NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "leave_types_tenant_id_code_key" ON "public"."leave_types"("tenant_id", "code");

-- AlterTable
ALTER TABLE "public"."leave_requests" ADD COLUMN "half_day" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "public"."tenant_settings"
  ADD COLUMN "allow_lop_requests" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "fy_start_month" INTEGER NOT NULL DEFAULT 4;
