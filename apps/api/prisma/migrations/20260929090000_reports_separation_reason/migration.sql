-- ============================================================================
-- Reports & Analytics: structured separation reason on employees.
--
-- Attrition's voluntary vs involuntary split needs a machine-readable field;
-- the lifecycle transition's free-text `reason` can't be aggregated. Nullable,
-- so existing rows stay untouched (reported as "unspecified").
-- ============================================================================

-- CreateEnum
CREATE TYPE "public"."SeparationReason" AS ENUM ('VOLUNTARY', 'INVOLUNTARY', 'OTHER');

-- AlterTable
ALTER TABLE "public"."employees" ADD COLUMN "separation_reason" "public"."SeparationReason";
