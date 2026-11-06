# DB_REGION_MOVE — move the shared dev DB from Tokyo to Mumbai

**Status:** planned (owner-approved 2026-10-30), not yet run. When it's
done, update `DEPLOY.md` (diagram, §1, §2a note, env examples) and the
"Dev database is shared" bullet in `CLAUDE.md`, then mark this file done.

## Why

The shared Supabase Postgres lives in **ap-northeast-1 (Tokyo)**; the
preview API box and the team's laptops are in/near **ap-south-1 (Mumbai)**.
Measured 2026-10-30 from a laptop in India:

| | network RTT | one query via the transaction pooler | one RLS-wrapped query (`withTenantContext`) |
|---|---|---|---|
| Tokyo (today) | ~125 ms | ~580 ms | ~810 ms |

A query costs ~4–5 round trips (Prisma's `pgbouncer=true` mode + the
BEGIN / `set_config` / query / COMMIT batch), and a screen makes several
in sequence, which is the 5–7 s wait on every click. Mumbai-to-Mumbai
round trips are ~1–2 ms (preview box) and ~20–40 ms from laptops in
India, so the same query should take roughly 10–200 ms. It also matches the
production region in the `CLAUDE.md` Stack table.

(`pgbouncer=true` has to stay. Without it, 172 of 200 concurrent
transactions failed with `prepared statement "sN" does not exist`
through the transaction pooler.)

Supabase can't change an existing project's region, so this is a **new
project + data copy**. Firebase Auth, Redis and the EC2 box are untouched.
Users keep their Firebase logins, because `users.firebase_uid` is copied as-is.

## Who / when

The **schema owner** runs it (same person who runs `./scripts/dev.sh
migrate`). Allow about 1 hour, with a **write freeze** during the copy
(steps 3–6). Tell the team first. Needs `psql` / `pg_dump` at a major
version **≥ the Supabase server's** (`psql --version`; Supabase shows its
version under Settings → Infrastructure).

## Steps

### 1. Create the new project

Supabase dashboard → New project → **Region: South Asia (Mumbai)
`ap-south-1`**. Pick the same plan as the current one. Save the new
`postgres` password in the team vault. From **Connect**, copy:

- the **session pooler** URL (`:5432`, user `postgres.<NEW_REF>`), used
  for migrations and the copy below
- the **transaction pooler** host (`:6543`), used by the app at runtime

Below, `OLD` and `NEW` are the session-pooler URLs of each project, e.g.
`postgresql://postgres.<REF>:<PW>@aws-0-<region>.pooler.supabase.com:5432/postgres?sslmode=require`.

### 2. Build the schema on NEW

```bash
cd apps/api
DATABASE_URL="$NEW" npx prisma migrate deploy
```

This creates both schemas, every RLS policy and grant, and the
`hrms_app` / `hrms_platform` roles. The roles get the **dev-only**
passwords from `20260101000002_roles_and_rls`, so rotate them right away to
fresh values from the vault:

```bash
psql "$NEW" -c "ALTER ROLE hrms_app PASSWORD '<new app pw>'" \
            -c "ALTER ROLE hrms_platform PASSWORD '<new platform pw>'"
```

### 3. Freeze writes

- Preview box: `ssh` in → `docker stop hrms-api`.
- Everyone stops their local API (`./scripts/dev.sh` / `npm run dev`).

### 4. Copy the data

Data only. Both schemas, every table except Prisma's migration ledger
(NEW already has its own from step 2):

```bash
pg_dump "$OLD" --data-only --schema=public --schema=platform \
  --exclude-table=public._prisma_migrations \
  --no-owner --no-privileges -f hrms-data.sql

psql "$NEW" --single-transaction -v ON_ERROR_STOP=1 \
  -c "SET session_replication_role = replica" -f hrms-data.sql
```

`session_replication_role = replica` skips FK checks while tables load in
dump order. That's the approach in Supabase's own migration guide. The
`postgres` role bypasses the FORCE'd RLS policies, which the seed script
already relies on. `--single-transaction` means a failure leaves NEW
empty, not half-loaded. Fix the cause and rerun step 4.

Delete `hrms-data.sql` afterwards: it contains PII (encrypted PAN/bank
fields included, plus names, emails and phone numbers).

### 5. Verify

Compare exact row counts table by table. Nothing printed = identical:

```bash
cat > counts.sh <<'SH'
psql "$1" -At <<'SQL' | psql "$1" -At
SELECT string_agg(format('SELECT %L, count(*) FROM %I.%I', n.nspname||'.'||c.relname, n.nspname, c.relname), ' UNION ALL ') || ' ORDER BY 1'
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE c.relkind = 'r' AND n.nspname IN ('public','platform') AND c.relname <> '_prisma_migrations';
SQL
SH
diff <(bash counts.sh "$OLD") <(bash counts.sh "$NEW") && echo "row counts match"
```

### 6. Point everything at NEW

New connection strings, with the same shape as today and only the host and ref
changed:

```
DATABASE_URL=postgresql://postgres.<NEW_REF>:<PW>@aws-0-ap-south-1.pooler.supabase.com:5432/postgres?sslmode=require
TENANT_DATABASE_URL=postgresql://hrms_app.<NEW_REF>:<PW>@aws-0-ap-south-1.pooler.supabase.com:6543/postgres?sslmode=require&pgbouncer=true&connection_limit=5
PLATFORM_DATABASE_URL=postgresql://hrms_platform.<NEW_REF>:<PW>@aws-0-ap-south-1.pooler.supabase.com:6543/postgres?sslmode=require&pgbouncer=true&connection_limit=5
```

(Use the host exactly as **Connect** shows it. Some projects get
`aws-1-…` instead of `aws-0-…`.)

1. Update the team vault entry.
2. Preview box: edit `~/hrms/apps/api/.env`, then **recreate** the
   container. `--env-file` is only read at `docker run`, so a plain
   `docker start`/`restart` keeps the old Tokyo URLs:
   ```bash
   docker rm -f hrms-api
   docker run -d --name hrms-api --restart unless-stopped \
     --env-file apps/api/.env -p 80:3000 --network hrms hrms-api
   curl http://localhost/api/health
   ```
3. Tell the team to update `apps/api/.env` and restart.

**Document storage:** if `S3_ENDPOINT` points at the *old project's*
Supabase Storage (`https://<OLD_REF>.supabase.co/storage/v1/s3`), copy the
bucket too before switching. For example, use `rclone sync old:hrms-documents
new:hrms-documents` with two S3 remotes, then update `S3_ENDPOINT` and the keys.
If documents live in AWS S3 / MinIO, nothing to do.

### 7. Smoke test

`DEPLOY.md` §5. Also sign in as one user per role and open
Employees / Leave / Reports. Every screen should load in well under a second.

### 8. Clean up

Keep the old project **paused, not deleted, for one week** as the
rollback. Rollback means putting the old URLs back in step 6, which loses any writes
made on NEW. Then delete it, and update `DEPLOY.md` / `CLAUDE.md` as noted at the top.
