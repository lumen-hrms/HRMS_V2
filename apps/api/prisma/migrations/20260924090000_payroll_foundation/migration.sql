-- ============================================================================
-- Module 07 (Payroll) Phase 1 — salary structures + payroll config
-- (docs/modules/07_PAYROLL_ENGINE.md §4.2, §9 Phase 1).
--
-- * employees.work_state drives Professional Tax slab selection.
-- * salary_structures: exactly one ACTIVE structure per employee (partial
--   unique index below — Prisma can't express it).
-- * hrms_app gets full CRUD on the config tables and components (components
--   are replaced on structure edit) but no DELETE on salary_structures —
--   history is superseded, never deleted.
-- * RLS keyed on tenant_id like every other tenant table.
-- ============================================================================

-- CreateEnum
CREATE TYPE "public"."IndianState" AS ENUM ('ANDHRA_PRADESH', 'ARUNACHAL_PRADESH', 'ASSAM', 'BIHAR', 'CHHATTISGARH', 'GOA', 'GUJARAT', 'HARYANA', 'HIMACHAL_PRADESH', 'JHARKHAND', 'KARNATAKA', 'KERALA', 'MADHYA_PRADESH', 'MAHARASHTRA', 'MANIPUR', 'MEGHALAYA', 'MIZORAM', 'NAGALAND', 'ODISHA', 'PUNJAB', 'RAJASTHAN', 'SIKKIM', 'TAMIL_NADU', 'TELANGANA', 'TRIPURA', 'UTTAR_PRADESH', 'UTTARAKHAND', 'WEST_BENGAL', 'ANDAMAN_AND_NICOBAR_ISLANDS', 'CHANDIGARH', 'DADRA_AND_NAGAR_HAVELI_AND_DAMAN_AND_DIU', 'DELHI', 'JAMMU_AND_KASHMIR', 'LADAKH', 'LAKSHADWEEP', 'PUDUCHERRY');

-- CreateEnum
CREATE TYPE "public"."SalaryComponentType" AS ENUM ('BASIC', 'DA', 'HRA', 'SPECIAL_ALLOWANCE', 'CONVEYANCE', 'LTA', 'MEDICAL', 'CUSTOM', 'PF_EMPLOYER', 'ESI_EMPLOYER', 'GRATUITY_PROVISION');

-- CreateEnum
CREATE TYPE "public"."SalaryCalculationMode" AS ENUM ('FIXED', 'PERCENT_OF_BASIC', 'PERCENT_OF_CTC', 'FORMULA');

-- CreateEnum
CREATE TYPE "public"."SalaryStructureStatus" AS ENUM ('ACTIVE', 'SUPERSEDED');

-- AlterTable
ALTER TABLE "public"."employees" ADD COLUMN     "work_state" "public"."IndianState";

-- CreateTable
CREATE TABLE "public"."salary_structures" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "ctc_annual" DECIMAL(14,2) NOT NULL,
    "effective_from" DATE NOT NULL,
    "status" "public"."SalaryStructureStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "salary_structures_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."salary_components" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "structure_id" UUID NOT NULL,
    "type" "public"."SalaryComponentType" NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "calculation_mode" "public"."SalaryCalculationMode" NOT NULL,
    "value" DECIMAL(14,4),
    "formula" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "salary_components_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."professional_tax_slabs" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "state" "public"."IndianState" NOT NULL,
    "gross_from" DECIMAL(12,2) NOT NULL,
    "gross_to" DECIMAL(12,2),
    "monthly_amount" DECIMAL(10,2) NOT NULL,
    "february_amount" DECIMAL(10,2),

    CONSTRAINT "professional_tax_slabs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."payroll_settings" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "min_basic_percent" DECIMAL(5,2) NOT NULL DEFAULT 50,
    "epf_ceiling" DECIMAL(10,2) NOT NULL DEFAULT 15000,
    "allow_epf_above_ceiling" BOOLEAN NOT NULL DEFAULT false,
    "epf_employee_rate" DECIMAL(5,2) NOT NULL DEFAULT 12,
    "eps_rate" DECIMAL(5,2) NOT NULL DEFAULT 8.33,
    "epf_employer_rate" DECIMAL(5,2) NOT NULL DEFAULT 3.67,
    "epf_admin_rate" DECIMAL(5,2) NOT NULL DEFAULT 0.5,
    "edli_rate" DECIMAL(5,2) NOT NULL DEFAULT 0.5,
    "esi_wage_ceiling" DECIMAL(10,2) NOT NULL DEFAULT 21000,
    "esi_employee_rate" DECIMAL(5,3) NOT NULL DEFAULT 0.75,
    "esi_employer_rate" DECIMAL(5,3) NOT NULL DEFAULT 3.25,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payroll_settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "salary_structures_tenant_id_idx" ON "public"."salary_structures"("tenant_id");

-- CreateIndex
CREATE INDEX "salary_structures_tenant_id_employee_id_idx" ON "public"."salary_structures"("tenant_id", "employee_id");

-- CreateIndex
CREATE INDEX "salary_components_tenant_id_idx" ON "public"."salary_components"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "salary_components_structure_id_code_key" ON "public"."salary_components"("structure_id", "code");

-- CreateIndex
CREATE INDEX "professional_tax_slabs_tenant_id_idx" ON "public"."professional_tax_slabs"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "professional_tax_slabs_tenant_id_state_gross_from_key" ON "public"."professional_tax_slabs"("tenant_id", "state", "gross_from");

-- CreateIndex
CREATE UNIQUE INDEX "payroll_settings_tenant_id_key" ON "public"."payroll_settings"("tenant_id");

-- CreateIndex
CREATE INDEX "payroll_settings_tenant_id_idx" ON "public"."payroll_settings"("tenant_id");

-- AddForeignKey
ALTER TABLE "public"."salary_structures" ADD CONSTRAINT "salary_structures_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."salary_components" ADD CONSTRAINT "salary_components_structure_id_fkey" FOREIGN KEY ("structure_id") REFERENCES "public"."salary_structures"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- One ACTIVE structure per employee.
CREATE UNIQUE INDEX "salary_structures_one_active_per_employee"
  ON "public"."salary_structures"("tenant_id", "employee_id")
  WHERE "status" = 'ACTIVE';

GRANT SELECT, INSERT, UPDATE ON public.salary_structures TO hrms_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON
  public.salary_components,
  public.professional_tax_slabs,
  public.payroll_settings
  TO hrms_app;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'salary_structures', 'salary_components', 'professional_tax_slabs', 'payroll_settings'
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
