-- ============================================================================
-- Move identity/IAM to Firebase Auth. Firebase's ID token (with tenantId
-- and role as custom claims, set via the Admin SDK) becomes the session
-- artifact — there is no more app-issued JWT, refresh token, or MFA
-- secret to persist here. tenant_id/RLS enforcement (see the
-- roles_and_rls migration) is completely unaffected by this change.
--
-- NOTE: firebase_uid is added NOT NULL — this app is pre-launch with no
-- real production users, so there is no backfill step. If this is ever
-- run against a database with existing rows in `users` or
-- `platform_admin_users`, those rows must be deleted or backfilled with a
-- real Firebase UID before this migration can apply.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- public.users
-- ---------------------------------------------------------------------------
ALTER TABLE "public"."users" ADD COLUMN "firebase_uid" TEXT;
ALTER TABLE "public"."users" DROP COLUMN "password_hash";
ALTER TABLE "public"."users" DROP COLUMN "mfa_secret";
ALTER TABLE "public"."users" DROP COLUMN "mfa_enabled";
ALTER TABLE "public"."users" DROP COLUMN "failed_login_count";
ALTER TABLE "public"."users" DROP COLUMN "locked_until";
ALTER TABLE "public"."users" DROP COLUMN "refresh_token_hash";

ALTER TABLE "public"."users" ALTER COLUMN "firebase_uid" SET NOT NULL;
CREATE UNIQUE INDEX "users_firebase_uid_key" ON "public"."users"("firebase_uid");

-- ---------------------------------------------------------------------------
-- platform.platform_admin_users
-- ---------------------------------------------------------------------------
ALTER TABLE "platform"."platform_admin_users" ADD COLUMN "firebase_uid" TEXT;
ALTER TABLE "platform"."platform_admin_users" DROP COLUMN "password_hash";
ALTER TABLE "platform"."platform_admin_users" DROP COLUMN "mfa_secret";
ALTER TABLE "platform"."platform_admin_users" DROP COLUMN "mfa_enabled";
ALTER TABLE "platform"."platform_admin_users" DROP COLUMN "failed_login_count";
ALTER TABLE "platform"."platform_admin_users" DROP COLUMN "locked_until";

ALTER TABLE "platform"."platform_admin_users" ALTER COLUMN "firebase_uid" SET NOT NULL;
CREATE UNIQUE INDEX "platform_admin_users_firebase_uid_key" ON "platform"."platform_admin_users"("firebase_uid");
