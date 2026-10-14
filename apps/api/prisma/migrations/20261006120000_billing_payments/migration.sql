-- Billing & Payments (module 14): Razorpay subscription link on the
-- subscription, a payments ledger, and a webhook idempotency ledger.
-- payments / billing_events are append-only for hrms_platform.

ALTER TABLE "platform"."subscriptions"
  ADD COLUMN "razorpay_subscription_id" TEXT,
  ADD COLUMN "grace_ends_at" TIMESTAMPTZ;

CREATE UNIQUE INDEX "subscriptions_razorpay_subscription_id_key"
  ON "platform"."subscriptions"("razorpay_subscription_id");

CREATE TABLE "platform"."payments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "razorpay_payment_id" TEXT NOT NULL,
    "razorpay_subscription_id" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "paid_at" TIMESTAMP(3) NOT NULL,
    "period_end" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "payments_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "payments_tenant_id_fkey" FOREIGN KEY ("tenant_id")
      REFERENCES "platform"."tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "payments_razorpay_payment_id_key" ON "platform"."payments"("razorpay_payment_id");
CREATE INDEX "payments_tenant_id_paid_at_idx" ON "platform"."payments"("tenant_id", "paid_at");

CREATE TABLE "platform"."billing_events" (
    "event_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "tenant_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "billing_events_pkey" PRIMARY KEY ("event_id")
);

GRANT SELECT, INSERT ON platform.payments TO hrms_platform;
GRANT SELECT, INSERT ON platform.billing_events TO hrms_platform;
