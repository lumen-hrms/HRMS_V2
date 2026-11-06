-- ============================================================================
-- Module 13 (Tenant Configuration) — mandatory full-screen company setup
-- (docs/TENANT_CONFIGURATION.md "Onboarding flow").
--
-- * tenant_setups: setup draft (encrypted) + completion marker. No row means
--   setup is incomplete — so every EXISTING tenant goes through the new
--   setup once (owner decision), pre-filled from its current settings.
-- * company_profiles: the company's legal identity (setup step 1).
-- * tenant_settings.go_live_date: leave proration anchor. Existing tenants
--   are backfilled to the day their settings row was created (they've been
--   live since onboarding); setup lets the admin change it.
-- * Drops the old skippable wizard's progress columns + enum.
-- * leave_types.is_restricted_holiday + LeaveLedgerSource.OPENING_BALANCE
--   (module 04): optional holidays become opt-in via leave, and imported
--   opening balances get their own ledger source.
-- * RLS keyed on tenant_id like every other tenant table.
-- ============================================================================

-- AlterEnum
ALTER TYPE "public"."LeaveLedgerSource" ADD VALUE 'OPENING_BALANCE';

-- AlterTable
ALTER TABLE "public"."leave_types" ADD COLUMN "is_restricted_holiday" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "public"."tenant_settings" ADD COLUMN "go_live_date" DATE;
UPDATE "public"."tenant_settings" SET "go_live_date" = ("created_at" AT TIME ZONE 'UTC')::date;
ALTER TABLE "public"."tenant_settings" DROP COLUMN "setup_wizard_status",
  DROP COLUMN "setup_wizard_step";

-- DropEnum
DROP TYPE "public"."TenantSetupWizardStatus";

-- CreateTable
CREATE TABLE "public"."company_profiles" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "legal_name" TEXT NOT NULL,
    "address_line1" TEXT NOT NULL,
    "address_line2" TEXT,
    "city" TEXT NOT NULL,
    "state" "public"."IndianState" NOT NULL,
    "pincode" TEXT NOT NULL,
    "contact_email" TEXT NOT NULL,
    "contact_phone" TEXT NOT NULL,
    "gstin" TEXT,
    "cin" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "company_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."tenant_setups" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "draft_ciphertext" TEXT,
    "draft_updated_at" TIMESTAMP(3),
    "draft_updated_by" UUID,
    "completed_at" TIMESTAMP(3),
    "completed_by" UUID,
    "result" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenant_setups_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "company_profiles_tenant_id_key" ON "public"."company_profiles"("tenant_id");
CREATE INDEX "company_profiles_tenant_id_idx" ON "public"."company_profiles"("tenant_id");
CREATE UNIQUE INDEX "tenant_setups_tenant_id_key" ON "public"."tenant_setups"("tenant_id");
CREATE INDEX "tenant_setups_tenant_id_idx" ON "public"."tenant_setups"("tenant_id");

GRANT SELECT, INSERT, UPDATE ON public.company_profiles TO hrms_app;
GRANT SELECT, INSERT, UPDATE ON public.tenant_setups TO hrms_app;

ALTER TABLE public.company_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.company_profiles FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public.company_profiles;
CREATE POLICY tenant_isolation ON public.company_profiles
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

ALTER TABLE public.tenant_setups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenant_setups FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public.tenant_setups;
CREATE POLICY tenant_isolation ON public.tenant_setups
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
