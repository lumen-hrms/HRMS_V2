-- ============================================================================
-- Module 10 (Notifications) — `notification_log`: one row per
-- (event, recipient) email, QUEUED → SENT | FAILED
-- (docs/modules/10_NOTIFICATIONS.md §4.1).
--
-- hrms_app gets SELECT/INSERT/UPDATE (the send worker moves status) but no
-- DELETE — the log is the record of what was sent (RULE-7). RLS keyed on
-- tenant_id like every other tenant table.
-- ============================================================================

CREATE TYPE "public"."NotificationTemplate" AS ENUM (
  'LEAVE_PENDING_APPROVAL', 'LEAVE_DECIDED', 'LEAVE_ESCALATED', 'LEAVE_CANCELLED',
  'REGULARIZATION_PENDING_APPROVAL', 'REGULARIZATION_DECIDED', 'DOCUMENT_BLOCKED'
);
CREATE TYPE "public"."NotificationStatus" AS ENUM ('QUEUED', 'SENT', 'FAILED');

CREATE TABLE "public"."notification_log" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "template" "public"."NotificationTemplate" NOT NULL,
    "recipient_user_id" UUID NOT NULL,
    "recipient_email" TEXT NOT NULL,
    "context" JSONB NOT NULL,
    "dedupe_key" TEXT NOT NULL,
    "status" "public"."NotificationStatus" NOT NULL DEFAULT 'QUEUED',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "provider_message_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sent_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notification_log_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "notification_log_tenant_id_dedupe_key_recipient_user_id_key"
  ON "public"."notification_log"("tenant_id", "dedupe_key", "recipient_user_id");
CREATE INDEX "notification_log_tenant_id_status_created_at_idx"
  ON "public"."notification_log"("tenant_id", "status", "created_at");

GRANT SELECT, INSERT, UPDATE ON public.notification_log TO hrms_app;

ALTER TABLE "public"."notification_log" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."notification_log" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON public.notification_log;

-- Unset session var → NULL → zero rows (fail closed), same as every table.
CREATE POLICY tenant_isolation ON public.notification_log
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
