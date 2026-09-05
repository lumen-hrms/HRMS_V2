-- ============================================================================
-- Tenant configuration foundation.
--
-- Adds the layer that lets one rented platform serve tenants with different
-- HR rules:
--   * platform.subscriptions gains plan ENTITLEMENTS (enabled_modules,
--     features) — the commercial boundary, set from `plan` at onboarding.
--   * public.tenant_settings / shifts / holidays / attendance_settings —
--     the tenant's own operational HR config (work week, shift times,
--     payroll cut-off, attendance mode, regularization guardrails), managed
--     by the Company Admin in-app, seeded with working defaults on tenant
--     creation.
--   * public.punches — capture-channel-agnostic raw attendance events
--     (web / biometric / import all land here identically).
--   * public.employees.shift_id — optional per-employee shift override.
--
-- Every new `public` table follows the exact grants + fail-closed RLS
-- pattern from 20260101000002_roles_and_rls / 20260904094219_attendance_module.
-- ============================================================================

-- CreateEnum
CREATE TYPE "public"."PunchDirection" AS ENUM ('IN', 'OUT');

-- CreateEnum
CREATE TYPE "public"."ShiftType" AS ENUM ('FIXED', 'FLEXI', 'ROTATIONAL');

-- CreateEnum
CREATE TYPE "public"."AttendanceMode" AS ENUM ('SELF_SERVICE', 'ROSTER', 'OFF');

-- CreateEnum
CREATE TYPE "public"."RegularizationUnactionedBehavior" AS ENUM ('AUTO_APPROVE', 'AUTO_REJECT');

-- AlterEnum
-- New capture channels for the punch pipeline. (PostgreSQL 12+ allows
-- ADD VALUE outside an explicit transaction block; none of the new values
-- are referenced elsewhere in this migration.)
ALTER TYPE "public"."AttendanceSource" ADD VALUE 'GPS';
ALTER TYPE "public"."AttendanceSource" ADD VALUE 'IMPORT';
ALTER TYPE "public"."AttendanceSource" ADD VALUE 'MANUAL';

-- AlterTable
ALTER TABLE "platform"."subscriptions"
  ADD COLUMN "enabled_modules" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "features" JSONB NOT NULL DEFAULT '{}';

-- AlterTable
ALTER TABLE "public"."employees" ADD COLUMN "shift_id" UUID;

-- CreateTable
CREATE TABLE "public"."tenant_settings" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Kolkata',
    "weekly_off_days" INTEGER[] DEFAULT ARRAY[0, 6]::INTEGER[],
    "payroll_cutoff_day" INTEGER NOT NULL DEFAULT 25,
    "leave_approval_levels" INTEGER NOT NULL DEFAULT 2,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenant_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."shifts" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "type" "public"."ShiftType" NOT NULL DEFAULT 'FIXED',
    "start_time" TEXT NOT NULL,
    "end_time" TEXT NOT NULL,
    "grace_minutes" INTEGER NOT NULL DEFAULT 15,
    "min_hours_full_day" DECIMAL(4,2) NOT NULL DEFAULT 8,
    "min_hours_half_day" DECIMAL(4,2) NOT NULL DEFAULT 4,
    "core_start_time" TEXT,
    "core_end_time" TEXT,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shifts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."holidays" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "name" TEXT NOT NULL,
    "is_optional" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "holidays_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."attendance_settings" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "mode" "public"."AttendanceMode" NOT NULL DEFAULT 'SELF_SERVICE',
    "capture_methods" "public"."AttendanceSource"[] DEFAULT ARRAY['WEB']::"public"."AttendanceSource"[],
    "regularization_window_days" INTEGER NOT NULL DEFAULT 7,
    "regularization_monthly_cap" INTEGER NOT NULL DEFAULT 3,
    "unactioned_behavior" "public"."RegularizationUnactionedBehavior" NOT NULL DEFAULT 'AUTO_APPROVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "attendance_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."punches" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "at" TIMESTAMP(3) NOT NULL,
    "direction" "public"."PunchDirection" NOT NULL,
    "source" "public"."AttendanceSource" NOT NULL DEFAULT 'WEB',
    "device_id" TEXT,
    "raw_ref" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "punches_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tenant_settings_tenant_id_key" ON "public"."tenant_settings"("tenant_id");

-- CreateIndex
CREATE INDEX "tenant_settings_tenant_id_idx" ON "public"."tenant_settings"("tenant_id");

-- CreateIndex
CREATE INDEX "shifts_tenant_id_idx" ON "public"."shifts"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "shifts_tenant_id_name_key" ON "public"."shifts"("tenant_id", "name");

-- CreateIndex
CREATE INDEX "holidays_tenant_id_idx" ON "public"."holidays"("tenant_id");

-- CreateIndex
CREATE INDEX "holidays_tenant_id_date_idx" ON "public"."holidays"("tenant_id", "date");

-- CreateIndex
CREATE UNIQUE INDEX "holidays_tenant_id_date_name_key" ON "public"."holidays"("tenant_id", "date", "name");

-- CreateIndex
CREATE UNIQUE INDEX "attendance_settings_tenant_id_key" ON "public"."attendance_settings"("tenant_id");

-- CreateIndex
CREATE INDEX "attendance_settings_tenant_id_idx" ON "public"."attendance_settings"("tenant_id");

-- CreateIndex
CREATE INDEX "punches_tenant_id_idx" ON "public"."punches"("tenant_id");

-- CreateIndex
CREATE INDEX "punches_tenant_id_employee_id_at_idx" ON "public"."punches"("tenant_id", "employee_id", "at");

-- AddForeignKey
ALTER TABLE "public"."employees" ADD CONSTRAINT "employees_shift_id_fkey" FOREIGN KEY ("shift_id") REFERENCES "public"."shifts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."punches" ADD CONSTRAINT "punches_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ============================================================================
-- Grants + Row-Level Security for the new `public` tables, identical in
-- shape to every other tenant table (see 20260101000002_roles_and_rls).
-- ============================================================================

GRANT SELECT, INSERT, UPDATE, DELETE ON
  public.tenant_settings,
  public.shifts,
  public.holidays,
  public.attendance_settings,
  public.punches
TO hrms_app;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'tenant_settings', 'shifts', 'holidays', 'attendance_settings', 'punches'
  ]
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', t);

    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON public.%I', t);

    -- current_setting(..., true) -> NULL when unset, and NULL = anything is
    -- never true, so an unset tenant context sees/writes ZERO rows.
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON public.%I
         USING (tenant_id = current_setting(''app.current_tenant_id'', true)::uuid)
         WITH CHECK (tenant_id = current_setting(''app.current_tenant_id'', true)::uuid)',
      t
    );
  END LOOP;
END
$$;
