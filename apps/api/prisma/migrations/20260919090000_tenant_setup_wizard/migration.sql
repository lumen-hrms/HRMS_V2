-- Module 13 (Tenant Configuration) — the last piece: a skippable, resumable
-- first-run setup wizard (docs/TENANT_CONFIGURATION.md "Onboarding flow"
-- step 3). Tracks progress on tenant_settings rather than a new table —
-- there is exactly one wizard, once, per tenant.

CREATE TYPE "public"."TenantSetupWizardStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'DISMISSED', 'COMPLETED');

ALTER TABLE "public"."tenant_settings"
    ADD COLUMN "setup_wizard_status" "public"."TenantSetupWizardStatus" NOT NULL DEFAULT 'PENDING',
    ADD COLUMN "setup_wizard_step" INTEGER NOT NULL DEFAULT 0;
