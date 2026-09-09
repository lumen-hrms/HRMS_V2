-- ============================================================================
-- Operator-editable plan catalog.
--
-- Moves the plan → entitlements mapping out of code-only constants
-- (platform-admin/entitlements.ts, which stays as the seed source + fallback)
-- into `platform.plans`, so Platform Admin can manage pricing / seats /
-- modules / features / isolation tier from a screen.
--
-- Semantics (deliberate): editing a Plan row NEVER mutates a live
-- Subscription. Each Subscription carries a SNAPSHOT of what its tenant is
-- promised (enabled_modules, features, seats, price_monthly, isolation_tier).
-- New tenants snapshot the current Plan at assign-time; renewal re-snapshots.
-- ============================================================================

-- CreateEnum
CREATE TYPE "platform"."IsolationTier" AS ENUM ('POOLED', 'DEDICATED');

-- CreateTable
CREATE TABLE "platform"."plans" (
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "price_monthly" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "seats_included" INTEGER NOT NULL,
    "enabled_modules" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "features" JSONB NOT NULL DEFAULT '{}',
    "isolation_tier" "platform"."IsolationTier" NOT NULL DEFAULT 'POOLED',
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "plans_pkey" PRIMARY KEY ("key")
);

-- AlterTable: Subscription gains the snapshotted price + isolation tier.
ALTER TABLE "platform"."subscriptions"
    ADD COLUMN "price_monthly" DECIMAL(12,2),
    ADD COLUMN "isolation_tier" "platform"."IsolationTier" NOT NULL DEFAULT 'POOLED';

-- Grants: same full CRUD hrms_platform has on the other platform tables
-- (roles_and_rls migration). No grant to hrms_app — plans are platform-only.
GRANT SELECT, INSERT, UPDATE, DELETE ON platform.plans TO hrms_platform;

-- Seed the 3 sellable plans from platform-admin/entitlements.ts. Idempotent
-- so a re-run (or a fresh DB that later runs the code-side seed) is safe.
INSERT INTO "platform"."plans"
    ("key", "name", "price_monthly", "currency", "seats_included",
     "enabled_modules", "features", "isolation_tier", "sort_order", "updated_at")
VALUES
    ('STARTER', 'Starter', 7500, 'INR', 50,
     ARRAY['CORE_HR','LEAVE']::TEXT[],
     '{"biometricIntegration":false,"customRoles":false,"apiAccess":false}'::jsonb,
     'POOLED', 1, CURRENT_TIMESTAMP),
    ('GROWTH', 'Growth', 18500, 'INR', 200,
     ARRAY['CORE_HR','LEAVE','ATTENDANCE','PAYROLL']::TEXT[],
     '{"biometricIntegration":false,"customRoles":false,"apiAccess":false}'::jsonb,
     'POOLED', 2, CURRENT_TIMESTAMP),
    ('ENTERPRISE', 'Enterprise', 48000, 'INR', 500,
     ARRAY['CORE_HR','LEAVE','ATTENDANCE','PAYROLL','COMPLIANCE']::TEXT[],
     '{"biometricIntegration":true,"customRoles":true,"apiAccess":true}'::jsonb,
     'POOLED', 3, CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;

-- Backfill existing subscriptions' price snapshot from the seeded plan.
UPDATE "platform"."subscriptions" s
SET "price_monthly" = p."price_monthly",
    "isolation_tier" = p."isolation_tier"
FROM "platform"."plans" p
WHERE p."key" = s."plan"::text AND s."price_monthly" IS NULL;
