-- ============================================================================
-- Per-seat pricing + per-tenant negotiated rate.
--
-- Pricing model change: a plan no longer carries a flat "price per month".
-- It carries a LIST PRICE PER SEAT PER MONTH. The amount a tenant pays is
-- `price_per_seat * seats`, computed at display time — never stored.
--
-- Negotiation: every deal gets a bespoke rate. `subscriptions.price_per_seat`
-- is the NEGOTIATED per-seat rate for that one tenant, snapshotted at
-- assign-time (defaults to the plan's list rate, operator can tune it up or
-- down). A renewal KEEPS the negotiated rate (it's the contract term) while
-- still re-snapshotting modules/features. An explicit plan change resets the
-- rate to the new plan's list price.
--
-- `plans.seats_included` stays, but now just means "default seat count
-- pre-filled in the onboarding wizard", not a bundled allotment.
-- ============================================================================

-- Plan: price_monthly (flat) -> list_price_per_seat (per seat / month).
ALTER TABLE "platform"."plans" RENAME COLUMN "price_monthly" TO "list_price_per_seat";

-- Subscription: price_monthly (flat snapshot) -> price_per_seat (negotiated).
ALTER TABLE "platform"."subscriptions" RENAME COLUMN "price_monthly" TO "price_per_seat";

-- The seeded plan figures were whole-plan monthly amounts (7500 / 18500 /
-- 48000). Reset them to sensible per-seat list prices. Operators edit these
-- from the Plans screen; these are just the starting catalog.
UPDATE "platform"."plans" SET "list_price_per_seat" = 199 WHERE "key" = 'STARTER';
UPDATE "platform"."plans" SET "list_price_per_seat" = 349 WHERE "key" = 'GROWTH';
UPDATE "platform"."plans" SET "list_price_per_seat" = 599 WHERE "key" = 'ENTERPRISE';

-- Every existing subscription held a whole-plan monthly figure in the
-- renamed column. Re-point it at its plan's new per-seat list rate so the
-- computed monthly total is sane; operators re-negotiate per tenant after.
UPDATE "platform"."subscriptions" s
SET "price_per_seat" = p."list_price_per_seat"
FROM "platform"."plans" p
WHERE p."key" = s."plan"::text;

-- Grants unchanged: RENAME preserves them. hrms_platform already holds full
-- CRUD on platform.plans (plan_catalog migration) and platform.subscriptions
-- (roles_and_rls migration). hrms_app still has zero grants on platform.*.
