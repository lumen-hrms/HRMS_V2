-- Trial lifecycle: a READ_ONLY tenant status (trial ended, not yet converted)
-- and an operator-set trial end date on the subscription.
--
-- Existing TRIAL tenants keep trial_ends_at NULL and therefore never expire
-- automatically; the operator sets their end date from the tenant detail page.

ALTER TYPE "platform"."TenantStatus" ADD VALUE IF NOT EXISTS 'READ_ONLY';

ALTER TABLE "platform"."subscriptions" ADD COLUMN "trial_ends_at" TIMESTAMPTZ;
