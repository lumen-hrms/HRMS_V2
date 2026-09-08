# HRMS Platform

A multi-tenant HRMS SaaS — modular monolith API (NestJS + Prisma + PostgreSQL)
and a React/Vite dashboard. Built as a working, wired end-to-end slice for a
founder pitch and a hospital pilot: real auth, real database persistence,
real tenant isolation enforced by PostgreSQL Row-Level Security — no mock
data.

## Architecture at a glance

- **Multi-tenancy**: one shared Postgres database/schema. Every tenant table
  carries `tenant_id` and is protected by an RLS policy keyed off the
  session variable `app.current_tenant_id`. The Postgres role the API uses
  for tenant queries (`hrms_app`) has **no BYPASSRLS** — the isolation is
  enforced by Postgres itself, not by every query author remembering a
  `WHERE tenant_id = ...` clause.
- **Platform admin is architecturally separate**: tenant metadata
  (`tenants`, `subscriptions`, `platform_admin_users`, `platform_audit_log`)
  lives in its own `platform` Postgres schema, read/written by a distinct
  role (`hrms_platform`) that has **zero grants on `public`**. The platform
  console cannot query employee/leave data even if the application code
  tried to — see `apps/api/test/tenant-isolation.e2e-spec.ts`, which proves
  this with a raw query and asserts Postgres itself returns "permission
  denied".
- **Guard chain**: `JwtAuthGuard -> TenantGuard -> RolesGuard` on every
  tenant route. `TenantGuard` cross-checks the tenant claimed by the JWT
  against the tenant resolved from the request's subdomain/header, so a
  valid token for tenant A is rejected outright against tenant B's
  subdomain — independent of RLS.
- **Auth**: bcrypt (cost 12), JWT access (15m) + refresh (30d, httpOnly
  cookie, rotated with reuse detection), TOTP MFA (enforced for
  `COMPANY_ADMIN`/`HR_MANAGER`, enrolled on first login), account lockout
  after 5 failed attempts (30 min cooldown).

See `apps/api/prisma/schema.prisma` and
`apps/api/prisma/migrations/20260101000002_roles_and_rls/migration.sql` for
the actual DDL.

## Stack

- **API**: NestJS 10 (CommonJS, Jest) + Prisma 5 + PostgreSQL. Deliberately
  pinned to these versions rather than whatever a scaffolding tool's
  "latest" resolves to — this is a solo founder's codebase, boring and
  well-documented beats bleeding-edge.
- **Web**: Vite + React + TypeScript, Tailwind CSS v4, small hand-written
  UI primitives in the shadcn style, React Router.
- **Storage**: any S3-compatible store (MinIO locally) for employee
  documents, accessed via presigned URLs — nothing is served directly
  through the API process.

## Running it locally

Prerequisites: Docker, Node.js 22+, and a **Firebase project** — dev, tests
and CI all use real Firebase (there is no local Auth emulator). You need the
project's service-account JSON + Web API key server-side and the web app
config client-side.

`scripts\dev.bat` (Windows) / `./scripts/dev.sh` (macOS/Linux) does the whole
sequence — Postgres + MinIO, deps, migrate, seed, then the API + web dev
servers. It checks `apps/api/.env` / `apps/web/.env` for the required
Firebase values and prints exactly what's missing.

```bash
# 1. Start Postgres + MinIO  (data persists in the hrms_pg_data volume)
docker compose up -d

# 2. API
cd apps/api
npm install
cp .env.example .env
#   Fill in from the Firebase console:
#     FIREBASE_PROJECT_ID           – Project settings > General
#     FIREBASE_SERVICE_ACCOUNT_JSON – Project settings > Service accounts >
#                                     "Generate new private key" (whole JSON, one line)
#     FIREBASE_WEB_API_KEY          – Project settings > General > Web API Key
npm run prisma:generate
npm run prisma:migrate        # applies schema + creates hrms_app/hrms_platform roles + RLS
npm run prisma:seed           # OPTIONAL: seeds 3 demo tenants as Firebase users — prints logins
npm run start:dev             # http://localhost:3000/api

# 3. Web (separate terminal)
cd apps/web
npm install
cp .env.example .env          # set VITE_FIREBASE_API_KEY / _AUTH_DOMAIN / _PROJECT_ID
                              # to the SAME project
npm run dev                   # http://localhost:5173, proxies /api to :3000
```

Open http://localhost:5173, enter a tenant subdomain plus an email/password.
If you ran the seed, use a subdomain of `acme` / `beta` / `gamma` and any
seeded account (all share password `Passw0rd!123`). There is no MFA — the
Firebase ID token is the session.

The **e2e suite signs in against the same real Firebase project**
(`test/utils/fixtures.ts`) — it creates users named `e2e-*@example.test` and
deletes them in `afterAll`. It needs `FIREBASE_SERVICE_ACCOUNT_JSON` +
`FIREBASE_WEB_API_KEY` + `FIREBASE_PROJECT_ID` in `apps/api/.env.test`
(gitignored; mirror `.env.example`); CI reads them from repo secrets of the
same names.

The platform-admin console is a separate route: http://localhost:5173/platform-admin,
login `founder@hrms-platform.dev` / `Passw0rd!123`.

### Seeded users (dev reference)

Every account below is a real Firebase Auth user (see "Auth" above), created
idempotently by `npm run prisma:seed`. All 14 tenant users + the platform
admin share the same password — **dev-only, rotate before any real pilot
use**, since it's printed in plaintext by the seed script.

| Tenant (subdomain) | Email                  | Role           |
| ------------------- | ----------------------- | -------------- |
| — (platform admin)  | `founder@hrms-platform.dev` | Platform Admin |
| Acme Hospitals (`acme`) | `admin@acme.test`    | Company Admin  |
| Acme Hospitals (`acme`) | `hr@acme.test`       | HR Manager     |
| Acme Hospitals (`acme`) | `manager@acme.test`  | Line Manager   |
| Acme Hospitals (`acme`) | `employee@acme.test` | Employee       |
| Acme Hospitals (`acme`) | `employee2@acme.test`| Employee       |
| Acme Hospitals (`acme`) | `auditor@acme.test`  | Auditor        |
| Beta Textiles (`beta`)  | `admin@beta.test`    | Company Admin  |
| Beta Textiles (`beta`)  | `hr@beta.test`       | HR Manager     |
| Beta Textiles (`beta`)  | `manager@beta.test`  | Line Manager   |
| Beta Textiles (`beta`)  | `employee@beta.test` | Employee       |
| Gamma Logistics (`gamma`) | `admin@gamma.test` | Company Admin  |
| Gamma Logistics (`gamma`) | `hr@gamma.test`    | HR Manager     |
| Gamma Logistics (`gamma`) | `employee@gamma.test` | Employee    |

**Password for all 15 accounts above: `Passw0rd!123`**

**Why a header instead of real subdomains locally?** `TENANT_RESOLUTION_MODE=header`
in `.env` makes the API resolve the tenant from an `X-Tenant-Subdomain`
header instead of parsing it out of the `Host` header — avoids needing
`/etc/hosts` entries or wildcard local DNS for a demo. Set it to `subdomain`
in any real deployment; the login page's "Company subdomain" field is what
gets sent as that header either way, so the UI doesn't change.

### Running tests

```bash
cd apps/api
npm test          # unit tests (business logic, no DB)
npm run test:e2e  # tenant-isolation + auth suites against a real Postgres
```

The e2e suite needs a real Postgres reachable via the `.env.test` URLs (same
`docker compose up -d postgres` works fine — just run migrations against it
too, or point `.env.test` at a separate throwaway database). This is not
optional scaffolding: `test/tenant-isolation.e2e-spec.ts` is the executable
version of the product's core promise — a tenant can never read or write
another tenant's data, and the platform role can't touch tenant tables at
all.

CI (`.github/workflows/ci.yml`) runs this same suite against a Postgres
service container on every PR, plus lint/build for both apps.

## What's implemented

- **Foundation**: Docker Compose (Postgres + MinIO), full Prisma schema for
  both the `platform` and tenant (`public`) sides, hand-written RLS
  migration, seed script producing 3 realistic demo tenants with a small
  reporting hierarchy, leave types/balances, and one pending leave request
  each.
- **Auth & tenancy**: login, JWT issuance/refresh (rotation + reuse
  detection), TOTP MFA enrollment + verification for admin roles, account
  lockout, the full guard chain, and an e2e test suite that actually proves
  isolation against a real database (not asserted by inspection).
- **Platform admin**: MFA-gated console to create a tenant (which seeds its
  first Company Admin login), list tenants with plan/employee-count/status,
  and enable/disable a tenant. Verified that its DB role cannot query
  tenant tables at the Postgres level.
- **Employee Master**: CRUD, departments, self-referential reporting
  hierarchy with an org-chart view, document upload/download via MinIO
  presigned URLs, Excel bulk import with a per-row success/error report
  (API only — no UI yet, see below).
- **Leave**: leave type configuration, per-year balances, apply/cancel,
  two-level approval (reporting manager, then HR Manager/Company Admin),
  LOP flagging when the balance is insufficient.
- **Dashboard**: role-aware home — headcount/department breakdown for
  admins, leave balance + pending approvals for everyone else.
- **Frontend**: a considered small design system (tokens for light/dark,
  both verified to actually apply), login/MFA flow, dashboard, employee
  list/detail/create with document upload, org chart, departments, leave
  apply/my-requests/approvals/type-config, and the standalone platform
  admin console.
- **CI**: GitHub Actions running lint + unit tests + the full e2e
  tenant-isolation suite (against a real Postgres service container) + build
  for both apps on every PR.

## What's not implemented yet (explicitly out of scope for this pass)

Payroll engine, attendance/biometric, statutory compliance filing, native
mobile, SSO, custom role builder, recruitment/performance/expense/helpdesk/AI
modules — all per the original scope. Additionally, deferred *within* what
was scoped, for time:

- Bulk employee import and the team leave calendar exist as tested API
  endpoints (`POST /employees/bulk-import`, `GET /leave/calendar`) but have
  no frontend screen yet.
- Leave day counting is calendar-days-inclusive; there's no holiday/weekend
  calendar yet, so LOP/day-count math doesn't exclude weekends.
- Login audit log (who logged in, from where) is not wired up yet, though
  the `audit_log` table exists in the schema for it.

## Repo layout

```
apps/api      NestJS API (auth, tenancy, platform-admin, employees, leave, dashboard)
apps/web      React/Vite dashboard + platform-admin console
docker-compose.yml   Postgres + MinIO for local dev
.github/workflows/ci.yml
```

## A note on the local Postgres roles

`prisma/migrations/20260101000002_roles_and_rls/migration.sql` creates
`hrms_app` / `hrms_platform` with **hard-coded development passwords**.
That's fine for `docker compose up` on a laptop; rotate them
(`ALTER ROLE ... PASSWORD ...`) and inject real values via your secrets
manager before this touches a shared environment. The role in `DATABASE_URL`
(the one that runs migrations) should always be a superuser/owner role and
is **never** used by the running API process — only `TENANT_DATABASE_URL`
and `PLATFORM_DATABASE_URL` are.
