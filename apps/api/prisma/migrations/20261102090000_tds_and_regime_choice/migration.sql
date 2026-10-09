-- ============================================================================
-- Module 07 (Payroll) Phase 6 — TDS and regime choice
-- (docs/modules/07_PAYROLL_ENGINE.md §9 Phase 6, §12 decision 8).
--
-- * tax_slabs / tax_regime_configs: per-tenant, per-financial-year, per-regime
--   config, same editable-not-constant posture as professional_tax_slabs
--   (§12 decision 11 — unverified rates, domain review deferred to Phase 9).
-- * tds_regime_choices: per-employee, per-FY. No row = defaults to NEW.
-- * RLS keyed on tenant_id like every other tenant table.
-- ============================================================================

-- CreateTable
CREATE TABLE "public"."tax_slabs" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "financial_year" TEXT NOT NULL,
    "regime" "public"."TaxRegime" NOT NULL,
    "income_from" DECIMAL(14,2) NOT NULL,
    "income_to" DECIMAL(14,2),
    "rate_percent" DECIMAL(5,2) NOT NULL,

    CONSTRAINT "tax_slabs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."tax_regime_configs" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "financial_year" TEXT NOT NULL,
    "regime" "public"."TaxRegime" NOT NULL,
    "standard_deduction" DECIMAL(12,2) NOT NULL,
    "cess_percent" DECIMAL(5,2) NOT NULL,
    "rebate_threshold" DECIMAL(14,2) NOT NULL,
    "rebate_max_amount" DECIMAL(12,2) NOT NULL,

    CONSTRAINT "tax_regime_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."tds_regime_choices" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "financial_year" TEXT NOT NULL,
    "regime" "public"."TaxRegime" NOT NULL,
    "set_by_user_id" UUID,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tds_regime_choices_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "tax_slabs_tenant_id_idx" ON "public"."tax_slabs"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "tax_slabs_tenant_id_financial_year_regime_income_from_key" ON "public"."tax_slabs"("tenant_id", "financial_year", "regime", "income_from");

-- CreateIndex
CREATE INDEX "tax_regime_configs_tenant_id_idx" ON "public"."tax_regime_configs"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "tax_regime_configs_tenant_id_financial_year_regime_key" ON "public"."tax_regime_configs"("tenant_id", "financial_year", "regime");

-- CreateIndex
CREATE INDEX "tds_regime_choices_tenant_id_idx" ON "public"."tds_regime_choices"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "tds_regime_choices_tenant_id_employee_id_financial_year_key" ON "public"."tds_regime_choices"("tenant_id", "employee_id", "financial_year");

-- AddForeignKey
ALTER TABLE "public"."tds_regime_choices" ADD CONSTRAINT "tds_regime_choices_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

GRANT SELECT, INSERT, UPDATE, DELETE ON
  public.tax_slabs,
  public.tax_regime_configs,
  public.tds_regime_choices
  TO hrms_app;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'tax_slabs', 'tax_regime_configs', 'tds_regime_choices'
  ]
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', t);

    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON public.%I', t);

    -- Unset session var -> NULL -> zero rows (fail closed), same as every table.
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON public.%I
         USING (tenant_id = current_setting(''app.current_tenant_id'', true)::uuid)
         WITH CHECK (tenant_id = current_setting(''app.current_tenant_id'', true)::uuid)',
      t
    );
  END LOOP;
END
$$;
