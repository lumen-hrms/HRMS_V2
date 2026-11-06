-- Add the FK the schema declares (Tenant.breakGlassGrants) — split from the
-- previous migration only because it was written after that one already
-- applied to the shared dev DB.
ALTER TABLE "platform"."break_glass_grants"
    ADD CONSTRAINT "break_glass_grants_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "platform"."tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
