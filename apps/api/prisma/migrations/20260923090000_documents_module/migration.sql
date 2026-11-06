-- ============================================================================
-- Module 09 (Documents) — promote `documents` from an Employee-Master-only
-- table to the shared home for every user-uploaded file
-- (docs/modules/09_DOCUMENTS.md §4.1):
--
-- 1. Owner typing: `owner_type` + `owner_id` (NULL for EMPLOYEE_PROFILE).
--    `employee_id` stays the subject employee and drives visibility.
-- 2. Malware scan state. Existing rows start PENDING_SCAN — they were never
--    scanned — and the documents `sweep` job scans them on its first run.
-- 3. Soft delete (`deleted_at`/`deleted_by_id`) + uploader id.
-- 4. Leave attachments move out of the four `leave_requests.attachment_*`
--    columns into `documents` rows (owner_type = LEAVE_REQUEST); the
--    columns are dropped. Object keys are not rewritten.
-- 5. hrms_app loses DELETE on `documents` (RULE-6: hard delete is no longer
--    an app operation). ON DELETE CASCADE from employees still works — FK
--    cascades run with the table owner's privileges.
-- ============================================================================

CREATE TYPE "public"."DocumentOwnerType" AS ENUM ('EMPLOYEE_PROFILE', 'LEAVE_REQUEST', 'REGULARIZATION');
CREATE TYPE "public"."DocumentScanStatus" AS ENUM ('PENDING_SCAN', 'CLEAN', 'INFECTED', 'SCAN_FAILED');

ALTER TABLE "public"."documents"
  ADD COLUMN "owner_type" "public"."DocumentOwnerType" NOT NULL DEFAULT 'EMPLOYEE_PROFILE',
  ADD COLUMN "owner_id" UUID,
  ADD COLUMN "scan_status" "public"."DocumentScanStatus" NOT NULL DEFAULT 'PENDING_SCAN',
  ADD COLUMN "scanned_at" TIMESTAMP(3),
  ADD COLUMN "scan_signature" TEXT,
  ADD COLUMN "uploaded_by_id" UUID,
  ADD COLUMN "deleted_at" TIMESTAMP(3),
  ADD COLUMN "deleted_by_id" UUID;

CREATE INDEX "documents_tenant_id_employee_id_idx" ON "public"."documents"("tenant_id", "employee_id");
CREATE INDEX "documents_tenant_id_owner_type_owner_id_idx" ON "public"."documents"("tenant_id", "owner_type", "owner_id");

INSERT INTO "public"."documents"
  ("id", "tenant_id", "employee_id", "owner_type", "owner_id", "label", "category",
   "storage_key", "mime_type", "size_bytes", "uploaded_at")
SELECT
  gen_random_uuid(), lr."tenant_id", lr."employee_id", 'LEAVE_REQUEST', lr."id",
  lr."attachment_name", 'OTHER', lr."attachment_key",
  COALESCE(lr."attachment_mime_type", 'application/octet-stream'),
  COALESCE(lr."attachment_size_bytes", 0), lr."updated_at"
FROM "public"."leave_requests" lr
WHERE lr."attachment_key" IS NOT NULL;

ALTER TABLE "public"."leave_requests"
  DROP COLUMN "attachment_key",
  DROP COLUMN "attachment_name",
  DROP COLUMN "attachment_mime_type",
  DROP COLUMN "attachment_size_bytes";

REVOKE DELETE ON "public"."documents" FROM hrms_app;
