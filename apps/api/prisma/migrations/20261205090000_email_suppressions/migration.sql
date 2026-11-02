-- ============================================================================
-- SES bounce / complaint handling (module 10 §4.4).
--
-- `email_suppressions` holds addresses SES reported as a permanent bounce or
-- a spam complaint (via the configuration set → SNS → POST
-- /api/notifications/ses-events). `SesEmailSender` refuses to send to them.
-- Platform schema, no tenant column: like SES's own account-level list, a
-- dead mailbox is dead for every tenant. hrms_platform needs UPDATE (repeat
-- events bump the counter) and DELETE (an operator lifts a suppression from
-- the console — audited in platform_audit_log).
-- ============================================================================

-- CreateEnum
CREATE TYPE "platform"."EmailSuppressionReason" AS ENUM ('BOUNCE', 'COMPLAINT');

-- CreateTable
CREATE TABLE "platform"."email_suppressions" (
    "email" TEXT NOT NULL,
    "reason" "platform"."EmailSuppressionReason" NOT NULL,
    "detail" TEXT,
    "event_count" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_event_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "email_suppressions_pkey" PRIMARY KEY ("email")
);

GRANT SELECT, INSERT, UPDATE, DELETE ON platform.email_suppressions TO hrms_platform;
