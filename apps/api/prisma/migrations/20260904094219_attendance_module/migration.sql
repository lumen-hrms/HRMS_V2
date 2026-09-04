-- CreateEnum
CREATE TYPE "public"."AttendanceStatus" AS ENUM ('PRESENT', 'LATE', 'ON_LEAVE', 'WEEKLY_OFF', 'HOLIDAY', 'ABSENT', 'PENDING_REGULARIZATION');

-- CreateEnum
CREATE TYPE "public"."AttendanceSource" AS ENUM ('WEB', 'BIOMETRIC');

-- CreateEnum
CREATE TYPE "public"."RegularizationReasonType" AS ENUM ('MISSED_PUNCH_IN', 'MISSED_PUNCH_OUT', 'WRONG_PUNCH_TIME', 'FORGOT_TO_CLOCK_IN', 'FORGOT_TO_CLOCK_OUT', 'ON_DUTY_FIELD_WORK', 'OTHER');

-- CreateEnum
CREATE TYPE "public"."RegularizationStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');

-- CreateTable
CREATE TABLE "public"."attendance_records" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "check_in_at" TIMESTAMP(3),
    "check_out_at" TIMESTAMP(3),
    "status" "public"."AttendanceStatus" NOT NULL DEFAULT 'ABSENT',
    "source" "public"."AttendanceSource" NOT NULL DEFAULT 'WEB',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "attendance_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."attendance_breaks" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "attendance_record_id" UUID NOT NULL,
    "start_at" TIMESTAMP(3) NOT NULL,
    "end_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attendance_breaks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."regularization_requests" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "attendance_record_id" UUID,
    "target_date" DATE NOT NULL,
    "reason_type" "public"."RegularizationReasonType" NOT NULL,
    "requested_check_in_at" TIMESTAMP(3),
    "requested_check_out_at" TIMESTAMP(3),
    "note" TEXT,
    "status" "public"."RegularizationStatus" NOT NULL DEFAULT 'PENDING',
    "approver_id" UUID,
    "decided_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "regularization_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "attendance_records_tenant_id_idx" ON "public"."attendance_records"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "attendance_records_tenant_id_employee_id_date_key" ON "public"."attendance_records"("tenant_id", "employee_id", "date");

-- CreateIndex
CREATE INDEX "attendance_breaks_tenant_id_idx" ON "public"."attendance_breaks"("tenant_id");

-- CreateIndex
CREATE INDEX "attendance_breaks_attendance_record_id_idx" ON "public"."attendance_breaks"("attendance_record_id");

-- CreateIndex
CREATE INDEX "regularization_requests_tenant_id_idx" ON "public"."regularization_requests"("tenant_id");

-- CreateIndex
CREATE INDEX "regularization_requests_tenant_id_employee_id_idx" ON "public"."regularization_requests"("tenant_id", "employee_id");

-- AddForeignKey
ALTER TABLE "public"."attendance_records" ADD CONSTRAINT "attendance_records_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."attendance_breaks" ADD CONSTRAINT "attendance_breaks_attendance_record_id_fkey" FOREIGN KEY ("attendance_record_id") REFERENCES "public"."attendance_records"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."regularization_requests" ADD CONSTRAINT "regularization_requests_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."regularization_requests" ADD CONSTRAINT "regularization_requests_attendance_record_id_fkey" FOREIGN KEY ("attendance_record_id") REFERENCES "public"."attendance_records"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ============================================================================
-- Grants + Row-Level Security for the three new tables, following exactly
-- the pattern established in 20260101000002_roles_and_rls/migration.sql —
-- hrms_app gets CRUD, then RLS is enabled+forced with the same
-- fail-closed tenant_isolation policy keyed on app.current_tenant_id.
-- ============================================================================

GRANT SELECT, INSERT, UPDATE, DELETE ON
  public.attendance_records,
  public.attendance_breaks,
  public.regularization_requests
TO hrms_app;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'attendance_records', 'attendance_breaks', 'regularization_requests'
  ]
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', t);

    EXECUTE format(
      'DROP POLICY IF EXISTS tenant_isolation ON public.%I', t
    );

    EXECUTE format(
      'CREATE POLICY tenant_isolation ON public.%I
         USING (tenant_id = current_setting(''app.current_tenant_id'', true)::uuid)
         WITH CHECK (tenant_id = current_setting(''app.current_tenant_id'', true)::uuid)',
      t
    );
  END LOOP;
END
$$;
