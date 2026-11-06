-- ============================================================================
-- Public "Contact us" form (landing page) + a platform-wide settings row to
-- hold who gets notified when one arrives.
--
-- `contact_submissions` is append-only from the app's perspective (SELECT +
-- INSERT only for hrms_platform) — same instinct as the audit tables: a
-- lead record shouldn't be editable after the fact.
--
-- `platform_settings` is a singleton (id is always the literal 'singleton')
-- holding operator-editable, non-tenant config; it needs UPDATE too, since
-- an operator edits the recipient list in place from the console.
-- ============================================================================

-- CreateTable
CREATE TABLE "platform"."contact_submissions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "company" TEXT,
    "phone" TEXT,
    "message" TEXT NOT NULL,
    "ip_address" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contact_submissions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "contact_submissions_created_at_idx" ON "platform"."contact_submissions"("created_at");

-- CreateTable
CREATE TABLE "platform"."platform_settings" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "contact_notify_emails" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "platform_settings_pkey" PRIMARY KEY ("id")
);

GRANT SELECT, INSERT ON platform.contact_submissions TO hrms_platform;
GRANT SELECT, INSERT, UPDATE ON platform.platform_settings TO hrms_platform;
