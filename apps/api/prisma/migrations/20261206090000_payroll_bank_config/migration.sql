-- ============================================================================
-- Company bank details for the payroll bank advice file.
--
-- One row per tenant: the account salaries are paid FROM, used only to pick the
-- bank-file format and to tell own-bank from other-bank rows. The app never
-- moves money. The account number is encrypted at the application layer (only
-- ciphertext + a masked form are stored), same as employee bank accounts.
-- ============================================================================

-- CreateTable
CREATE TABLE "public"."payroll_bank_config" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "bank_code" TEXT NOT NULL,
    "account_holder_name" TEXT NOT NULL,
    "account_ciphertext" TEXT NOT NULL,
    "account_masked" TEXT NOT NULL,
    "ifsc" TEXT NOT NULL,
    "bank_name" TEXT,
    "branch" TEXT,
    "default_payment_mode" TEXT NOT NULL DEFAULT 'NEFT',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payroll_bank_config_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "payroll_bank_config_tenant_id_key" ON "public"."payroll_bank_config"("tenant_id");

GRANT SELECT, INSERT, UPDATE ON public.payroll_bank_config TO hrms_app;

ALTER TABLE public.payroll_bank_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payroll_bank_config FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON public.payroll_bank_config;
-- Unset session var -> NULL -> zero rows (fail closed), same as every table.
CREATE POLICY tenant_isolation ON public.payroll_bank_config
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
