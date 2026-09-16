-- Employee Master: the remaining SRS-driven field groups (module 03 §4.2) —
-- identity/personal extras, employment extras, compensation-adjacent,
-- statutory (India, KMS-encrypted PAN + bank), bank, emergency contacts,
-- and Department/Document extensions. Purely additive/nullable — no
-- backfill needed.

CREATE TYPE "public"."EmploymentType" AS ENUM ('FULL_TIME', 'PART_TIME', 'CONTRACT', 'INTERN', 'CONSULTANT');
CREATE TYPE "public"."TaxRegime" AS ENUM ('OLD', 'NEW');
CREATE TYPE "public"."BankAccountType" AS ENUM ('SAVINGS', 'CURRENT');
CREATE TYPE "public"."DocumentCategory" AS ENUM ('OFFER_LETTER', 'ID_PROOF', 'ADDRESS_PROOF', 'EDUCATION', 'EXPERIENCE', 'OTHER');

ALTER TABLE "public"."employees"
  ADD COLUMN "marital_status" TEXT,
  ADD COLUMN "blood_group" TEXT,
  ADD COLUMN "nationality" TEXT,
  ADD COLUMN "photo_url" TEXT,
  ADD COLUMN "employment_type" "public"."EmploymentType",
  ADD COLUMN "work_location" TEXT,
  ADD COLUMN "ctc_annual" DECIMAL(14, 2),
  ADD COLUMN "pay_grade" TEXT,
  ADD COLUMN "cost_center" TEXT,
  ADD COLUMN "pan_ciphertext" TEXT,
  ADD COLUMN "pan_masked" TEXT,
  ADD COLUMN "aadhaar_last4" TEXT,
  ADD COLUMN "uan" TEXT,
  ADD COLUMN "pf_number" TEXT,
  ADD COLUMN "esic_number" TEXT,
  ADD COLUMN "tax_regime" "public"."TaxRegime",
  ADD COLUMN "bank_account_holder_name" TEXT,
  ADD COLUMN "bank_account_ciphertext" TEXT,
  ADD COLUMN "bank_account_masked" TEXT,
  ADD COLUMN "bank_ifsc" TEXT,
  ADD COLUMN "bank_name" TEXT,
  ADD COLUMN "bank_branch" TEXT,
  ADD COLUMN "bank_account_type" "public"."BankAccountType";

ALTER TABLE "public"."departments"
  ADD COLUMN "code" TEXT,
  ADD COLUMN "head_employee_id" UUID;

ALTER TABLE "public"."documents"
  ADD COLUMN "category" "public"."DocumentCategory" NOT NULL DEFAULT 'OTHER',
  ADD COLUMN "uploaded_by_name" TEXT;

CREATE TABLE "public"."emergency_contacts" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "employee_id" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "relationship" TEXT NOT NULL,
  "phone" TEXT NOT NULL,
  "alt_phone" TEXT,
  "address" TEXT,
  "is_primary" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "emergency_contacts_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "emergency_contacts_tenant_id_idx" ON "public"."emergency_contacts"("tenant_id");
CREATE INDEX "emergency_contacts_tenant_id_employee_id_idx" ON "public"."emergency_contacts"("tenant_id", "employee_id");

ALTER TABLE "public"."emergency_contacts"
  ADD CONSTRAINT "emergency_contacts_employee_id_fkey"
  FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ============================================================================
-- Grant + Row-Level Security for the one new table, following exactly the
-- pattern established in 20260101000002_roles_and_rls/migration.sql.
-- ============================================================================

GRANT SELECT, INSERT, UPDATE, DELETE ON public.emergency_contacts TO hrms_app;

ALTER TABLE public.emergency_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.emergency_contacts FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON public.emergency_contacts
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
