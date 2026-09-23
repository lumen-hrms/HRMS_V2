# HRMS — Project Context & Decisions

Multi-tenant HRMS SaaS. The domain model was seeded from an early spec
draft (`HRMS_SRS_v1.0(1).docx`) that is **no longer maintained or
followed** — this file and `docs/` are the source of truth now. This file
is the condensed decision record — read it before touching architecture,
tenancy, or security code. It exists so a fresh Claude session (or you, on
another machine) doesn't have to re-derive these calls from scratch.

**Team context:** a dedicated project team (backend, frontend, infra) is
building this as a production-grade implementation, delivered in
structured module slices. First customers are a startup and a hospital.
This is a solid build, not a throwaway demo — favour correctness and
clean module boundaries over cutting corners for speed.

## Architecture rationale

A fully distributed architecture (microservices on Kubernetes/EKS, Kafka,
Istio, Keycloak, Elasticsearch, schema-per-tenant, native mobile app,
live government e-filing APIs) is more infrastructure than the current
scale warrants — it carries the operational cost of a large service
estate before there's load or a customer base to justify it. The domain
scope (payroll math, statutory forms, roles, compliance obligations) is
built in full; the delivery vehicle is a **modular monolith** with clean
internal boundaries so a module *can* be split out later without a
rewrite. Full reasoning, diagrams and the delivery plan live in the
architecture blueprint (ask the team lead for the link).

## Stack (do not deviate without updating this file)

| Layer | Choice | Not this, because |
|---|---|---|
| Backend | NestJS (Node.js/TypeScript) + Prisma + PostgreSQL | Not Spring Boot/microservices — a modular monolith covers the same domain scope without the operational cost of 10 services + a mesh + a broker at this scale |
| Frontend | React + Vite (TypeScript), client-side rendered, React Router, Tailwind + shadcn/ui | Not Next.js — this is an authenticated dashboard behind login, SSR buys nothing |
| Multi-tenancy | **Hybrid.** Default = *pooled*: shared DB, shared schema, `tenant_id` + PostgreSQL Row-Level Security. Premium = *dedicated*: database-per-tenant, plan-gated, for enterprise / regulated customers. The tenant→datasource mapping is a runtime lookup, never hardcoded. | Not schema-per-tenant — it carries silo's fan-out-migration cost without silo's physical isolation or independent-scaling upside. Not silo-for-everyone — per-tenant DB / provisioning / migration / backup ops isn't worth it for SMB tenants that pooling + RLS already isolate. |
| Background jobs | BullMQ on Redis | Not Kafka — payslip PDFs, statutory files, email sends, don't need a broker at this scale |
| Storage | S3 (private, presigned URLs) | — |
| Auth | Firebase Auth — ID token *is* the session (Bearer header, SDK-refreshed), `tenantId`/`role` as server-set custom claims. No MFA. | Not a self-issued JWT/bcrypt/TOTP stack (the original choice) — a hosted, audited password reset/sign-in UI beats maintaining our own. Not Keycloak either — one less system to run and patch. |
| Hosting | AWS ap-south-1 (Mumbai), managed services: ECS Fargate, RDS, S3, CloudFront | Not EKS/Kubernetes — stays in-region for the "India-compliant" story without container-orchestration ops overhead |

## Multi-tenancy — the load-bearing decision

**Hybrid isolation, two tiers. The *pooled* tier is the default; the
*dedicated* tier is a plan-gated upsell — not a rewrite of the pooled one.**
The one invariant that holds across both: the query layer resolves *which
database* and *which tenant context* from trusted server state (the
validated token's `tenantId` claim, the resolved subdomain) — **never from
a raw request parameter** — and the app's runtime Postgres role never has
`BYPASSRLS`.

### Tier 1 — Pooled (default: STARTER / GROWTH, and ENTERPRISE unless it buys isolation)

**One shared database, one shared schema.** Every tenant-owned table has a
`tenant_id` column and a Postgres RLS policy keyed to the session variable
`app.current_tenant_id`, set once per request/transaction from the
validated Firebase ID token's `tenantId` custom claim.

Enforcement is layered, not single-point:
1. Subdomain → tenant resolution; `tenantId`/`role` live as custom claims
   on the user's Firebase ID token (set server-side via the Admin SDK).
2. Application-level query scoping (wrapped Prisma client injects the
   tenant filter automatically).
3. **Database-level RLS is the real backstop** — even a raw-SQL bug can't
   leak rows across tenants.
4. Adversarial tests in CI: log in as tenant A, assert every attempt to
   read/write tenant B's data fails. This suite is non-negotiable —
   treat a regression here as a P0, not a bug.

### Tier 2 — Dedicated (database-per-tenant)

A tenant whose subscription carries the *dedicated* isolation entitlement
gets its **own Postgres database** (own credentials, own encryption key,
own backup/PITR schedule, own capacity). Sold to enterprise / regulated
customers (e.g. a hospital with a contractual "our data is physically
separate" clause). Not the default — the operational cost per tenant only
pays off when a customer needs and pays for it.

What makes this cheap to add on top of Tier 1 rather than a fork:

- **`tenant → datasource` is a lookup, not a constant.** A tenant record
  carries its datasource (shared pool, or a dedicated connection string in
  the platform vault). `TenantPrismaService` resolves the client from that
  lookup per request; pooled tenants get the shared pool, dedicated tenants
  get a per-tenant pool from a small registry.
- **The schema and the query code are identical.** A dedicated DB runs the
  same migrations and keeps `tenant_id` + RLS (it's one tenant's worth of
  rows, but keeping the column + policy means zero branching in the query
  layer — defense in depth, not dead weight).
- **Provisioning is a platform-admin flow** (module 02): create the DB, run
  `prisma migrate deploy` against it, seed defaults, record the datasource.
  Migrations fan out: the shared DB **plus** every dedicated DB, with
  partial-failure handling.
- Entitlement lives on `Subscription` (layer 1 of `TENANT_CONFIGURATION.md`),
  same place `enabledModules` / `features` do.

**Status:** the pooled tier is fully built and test-verified. The dedicated
tier is a **design target** — the datasource-lookup indirection, the
per-tenant pool registry, the provisioning flow, and the fan-out migration
runner are not built yet. Build them before selling the tier; don't
retrofit hardcoded shared-pool assumptions in the meantime.

**Platform Admin (the platform team's operator role) is structurally
separate**, not a role flag inside the tenant app: its own schema
(`tenants`, `subscriptions`, `platform_admin_users`, `platform_audit_log`)
and its own Postgres role/connection with **zero grants** on tenant
business tables. Tenant metadata the platform admin legitimately needs
(name, plan, employee *count*, status) is denormalized into the platform
schema — no join into PII tables required. Genuine support access to a
tenant's data goes through a logged, time-boxed break-glass flow, not a
standing permission.

**Why hybrid, and not one of the pure models:**

- *Not silo (DB-per-tenant) for everyone* — per-tenant provisioning,
  migration fan-out, connection pools, and backups are real, permanent ops
  cost. Pooling + RLS already gives logical isolation the DB engine
  enforces on every query; most SMB tenants never need more.
- *Not schema-per-tenant (bridge)* — it has silo's fan-out-migration and
  `search_path` cost without silo's physical separation, independent
  scaling, or per-tenant backup/restore. Worst of both.
- *So: pool by default, silo as a paid tier.* The dedicated tenant gets
  true physical isolation; the ninety-percent case stays cheap and dense.
  This is the mainstream SaaS shape (pool default, isolate the contracts
  that require it) — Workday/Salesforce-scale systems run pooled; vendors
  in regulated verticals offer DB-per-tenant as an enterprise SKU.

## Roles (fixed for V1 — no custom role builder yet)

Platform Admin · Company Admin · HR Manager · Line Manager · Employee ·
Auditor (read-only). Guard chain per request: `JwtAuthGuard` → `TenantGuard`
(validates tenant, sets the RLS session var) → `RolesGuard`, plus
service-layer scoping for "own reports only" (Line Manager) and "own data
only" (Employee) — those can't be expressed as a static role check alone.

## Security non-negotiables

- Money: fixed-precision `NUMERIC`, never floating point.
- Timestamps: `TIMESTAMPTZ` stored UTC, displayed IST.
- Aadhaar: store **last 4 digits only**, not the full number — avoids
  regulatory ambiguity around storing full Aadhaar without UIDAI
  requesting-entity status; EPFO/UAN verification happens on their portal,
  not in this app.
- Audit log (`audit_log` table) is append-only from day one — the app's
  DB role has no `UPDATE`/`DELETE` grant on it.
- PII fields (PAN, bank account) get application-layer encryption via a
  KMS data key on top of RDS/S3 encryption-at-rest — a raw DB dump alone
  should not be enough to read them. **Built** (module 03):
  `FieldEncryptionService` (`apps/api/src/crypto`) does AES-256-GCM with a
  key from `FIELD_ENCRYPTION_KEY`; only ciphertext + a masked form are
  stored, reveal is permissioned + logged. The key today is a static team-
  vault secret, not yet a real AWS KMS-wrapped data key — that swap lands
  with the production AWS migration and only touches that one file.
- No blanket "PII must stay in India" legal claim — DPDP Act 2023 doesn't
  currently mandate that; hosting in Mumbai is a trust/latency choice, not
  a compliance requirement. Don't market it as the latter.

## Explicitly deferred (do not build without discussing scope first)

Biometric device integration (ZKTeco/eSSL), native mobile app, live
EPFO/ESIC/TRACES e-filing APIs, custom role/permission builder,
SSO (Google/Azure AD), Recruitment/ATS, Performance Management, Expense
Management, Helpdesk, AI HR Assistant, LMS, OKR, multi-region DR,
Kubernetes/Kafka/Istio. Each has a "revisit when" trigger in the full
blueprint — check there before reviving one.

## V1 module scope

**Done, merged to `main`, test-verified against real Postgres:** Auth +
RBAC + tenant isolation (RLS), the Identity & Access *management* surface
(NestJS `access` module — `GET /api/access/users` · `/access/me` ·
`PATCH .../role` · `PATCH .../status` · `POST .../password-reset` ·
`GET /api/access/audit` · `.../:id/activity` — plus the `LoginAuditEntry`
table and append-only login-audit writes on every server-observed
`POST /api/auth/session` outcome; e2e-tested in `test/access.e2e-spec.ts`;
`VITE_ACCESS_MOCK` defaults **off**), Platform Admin console (tenant
onboarding/enable-disable/metadata, plus tenant detail, audited headcount
refresh, scheduled renewal, and break-glass request tracking), Employee
Master (interactive org chart, a real photo-upload widget, and Leave's
recursive Line-Manager scoping mirror all landed 2026-09-18), role-aware
Dashboard — backend and frontend both. See `docs/BACKEND_ARCHITECTURE.md`
for the full traced reference and its §8 for known gaps within these
modules (the generic `audit_log` is now written to for access-change
events but has no aggregation/UI yet).

**Leave Management — done, 100% of its originally-scoped gaps closed,
running live:** the line-manager leave-visibility placeholder is a real
`reportingManagerId` check, holiday-aware working-day counts, request
attachments, a tenant-configurable 1-or-2-level approval chain with
escalation timers (BullMQ `leave` queue / Redis — first use of BullMQ in
this repo), a monthly/quarterly accrual job (proration-aware for mid-year
joiners), and every endpoint (team balances, balance adjustments, ledger,
settings). Every cell of the frontend's role×tab matrix is wired to
`apps/web/src/lib/leave`, whose `client.ts` defaults `USE_MOCK` to **off**
(`VITE_LEAVE_MOCK === 'true'` forces the fixture store — same inverted-default
pattern as `access/client.ts`; `LeaveService` maps every response into the
frontend's denormalized contract itself). `TenantSettings.allowLopRequests`/`fyStartMonth`,
`LeaveType.minNoticeDays`/`genderRestriction`/`requiresApproval` are all
enforced/settable (gender check fails open on unrecognized
`Employee.gender` — free-text field, no schema enum). Two features closed
last: **comp-off** — `LeaveType.isCompOff` marks a tenant's designated
type; `AttendanceService.clockIn()` detects a holiday/weekly-off day and
calls `LeaveService.creditCompOff()` (idempotent, opt-in per tenant) —
and **leave↔attendance reconciliation** — approving a request writes
`AttendanceRecord.status = 'ON_LEAVE'` for its working days (direct Prisma
access from `LeaveService`, not an `AttendanceService` import, to avoid a
circular module dependency; reversed on cancel). Both are synchronous
(at clock-in / approve-cancel time), not a nightly finalization job —
Attendance's own much bigger "nightly finalization" gap (§5 of
`docs/MODULE_SPECS.md`) stays exactly as deferred as it was. See
`docs/MODULE_SPECS.md` §4 and `docs/LEAVE_UI_SPECS.md`.

**Identity & Access — done, 100%.** `BAD_CREDENTIALS` and `TENANT_SUSPENDED`
sign-in failures staying out of the server-side login trail is an
owner-approved scope decision (`docs/modules/01_IDENTITY_AND_ACCESS.md` §9),
not an open gap — suspend/resume is logged once in `platform_audit_log`
instead. A daily BullMQ job (`LoginAuditRetentionProcessor`) purges
`login_audit_entries` past the 2-year retention window, per tenant.

**Platform Admin — done, 99%.** Tenant detail (`GET tenants/:id`), an
audited headcount-refresh route, and a scheduled renewal job (driving
`renewSubscription()` off `Subscription.renewsAt` instead of manual-only)
are all live; `platform_audit_log` is now true append-only at the DB grant
level. Break-glass has a full audited request/track/expire/revoke lifecycle
(`platform.break_glass_grants`) but doesn't yet grant an operator actual
elevated read access to a tenant's data during the grant window — that
escalation mechanism (a temporary, scoped credential or RLS bypass, itself
logged per-query) is a deliberate follow-on, the one thing keeping this
module below 100%.

**Tenant Configuration — done, 100%.** Layer 1 (plan entitlements) is now
enforced, not just stored: `EntitlementGuard` + `@RequiresModule`/
`@RequiresFeature` block a route when the tenant's plan doesn't include it,
wired onto Leave and Attendance. Layer 2 (tenant business config) has both
its engine wiring (`attendance.service.ts` reads the tenant's `Shift` +
`tenant_settings` instead of hardcoded constants) and its UI (a Settings
tab for shifts + attendance/general config, plus a skippable/resumable
first-run setup wizard for a Company Admin's first login). See
`docs/TENANT_CONFIGURATION.md`.

**Documents — done, 100%.** A shared `apps/api/src/documents` module owns
every user upload — employee profile documents, leave attachments (moved
out of `leave_requests.attachment_*`), regularization evidence: MIME
allow-list + magic-byte check + 10 MB cap before storage, a ClamAV scan
(BullMQ `documents` queue → clamd; docker-compose runs it) that must pass
before any presigned URL is issued (fail closed, self-healing sweep),
visibility = the subject employee's `scopeFor` scope, and audited *soft*
delete (`hrms_app` has no `DELETE` on `documents`). Retention purge is an
owner-approved V1 scope cut. See `docs/modules/09_DOCUMENTS.md`.

**Notifications — done, 100%.** `apps/api/src/notifications`: a singleton
`NotificationDispatcher.notify()` (explicit `tenantId`, never throws into
the caller) writes deduped `notification_log` rows and enqueues a BullMQ
`notifications` job; the worker sends via **AWS SES v2** (`SES_FROM_ADDRESS`
+ SDK default-chain credentials), retries to `FAILED`, and a sweep heals
stuck rows. Wired into Leave, Attendance regularization and Documents; an
Email log screen lets HR retry failures. Auth emails (tenant invite, admin
reset, self-service "Forgot password?" via public `POST /auth/password-reset`)
also go out through SES via `AuthEmailService` — Firebase still generates the
reset link and hosts the reset page; only the sender changed. Live-delivery checks are tracked in the
separate testing tracker, not the module %. See `docs/modules/10_NOTIFICATIONS.md`.

**Attendance — done, 100%.** Self-service clock-in/out/breaks/calendar/
stats, shift-aware late/grace/target-hours/overtime logic, a nightly
finalization job (holiday → weekly-off → punches → genuine absence,
BullMQ), full regularization approval (window/cap enforcement, approve/
reject/bulk-approve, audited, auto-resolved at the tenant's payroll
cut-off), and manager/HR team views (roster + manual marking) are all live
and plan-gated. GPS/biometric/selfie-QR capture and `POST
/attendance/ingest` stay explicitly deferred (see above), not counted
against 100%; converting overtime hours to statutory per-state pay is
Payroll's job. Payroll and Compliance exports remain **not started** — see
the blueprint's 12-week plan for sequencing (payroll is the
highest-effort, highest-risk module; protect its time budget over breadth
elsewhere).

## Keeping module status in sync — MANDATORY, no reminder needed

`docs/MODULE_SPECS.md` holds the shared source of truth for module
progress: the **status table** (✅ / 🟡 / 🔴 + progress bar + % per module)
and the **per-module `**Status:**` lines**. Every developer reads it to
know what's live without pulling the code.

**This rule is always in force. Follow it automatically — you do not need
to be asked, reminded, or given approval in the moment:**

Whenever a change in this repo moves a module's real state — code added,
removed, or reworked; a gap opened or closed; tests added; a sub-feature
finished — you MUST update `docs/MODULE_SPECS.md` **in the same change /
commit that caused the move**:
1. Adjust that module's row in the status table: mark (✅/🟡/🔴), the
   ASCII progress bar, and the `%`.
2. Update the module's `**Status:**` line and its per-module gap list so
   the named gaps still match reality.
3. Update the `**Last synced to code:**` date (and commit ref, if known)
   at the top of the file.
4. If the change also invalidates the "V1 module scope" summary in this
   file (`CLAUDE.md`), fix that too.

Keep the bar honest — estimate against "done" as defined by that module's
**Expectation** section, not against lines of code. If a change is purely
cosmetic / internal and moves no module's state, no status edit is needed;
say so briefly rather than silently skipping. If you're unsure which
module a change belongs to, pick the closest and note the ambiguity in the
commit message rather than skipping the update.

## Tests are part of the feature — MANDATORY, no reminder needed

**This rule is always in force, same standing as the status-sync rule
above:** a module or feature is not "done" until it has tests, and an
existing feature whose behavior changes must have its tests updated in the
**same change** that changes the behavior — never a follow-up.

1. **New backend logic** (a service method, a new endpoint, a state
   machine, an authorization check) gets a unit test in the same PR/commit
   — see `apps/api/src/employees/employees.service.spec.ts` for the
   pattern (a small hand-built fake of the `TenantPrismaService`/
   `FieldEncryptionService`/Firebase surface the service touches, not a
   real DB). Cover the happy path, the rejection paths (bad input, wrong
   role, wrong tenant), and any invariant the code claims to hold (e.g.
   "never leaves partial state on failure" needs a test that forces the
   failure and asserts nothing wrote).
2. **A changed authorization rule or permission matrix cell** (who can call
   what, row-scoping, a 403 path) always gets a test — these are exactly
   the bugs that don't show up by clicking around, per the adversarial
   tenant-isolation precedent in `CLAUDE.md`'s multi-tenancy section.
3. **Before calling a change finished, actually run the suite** —
   `npm run test:api` (or the project's `./scripts/dev.sh test` for the
   full local gate: unit + e2e + lint + build) — don't assume new tests
   pass from reading them.
4. **Before ending a turn that touched frontend code, run what CI runs** —
   `npm run build` (`tsc -b && vite build` for the web app) and
   `npm run lint` from the repo root, not just `vite build` alone, which
   skips the project's type-check step and misses exactly the class of
   error (unused imports, a field missing from a hand-written interface)
   that only shows up under `tsc -b`.
5. **If a change is purely cosmetic/internal and adds no new logic**
   (e.g. a copy change, a class-name tweak), no new test is needed — say
   so briefly rather than silently skipping, same as the status-sync rule.

## Project structure

```
apps/
  api/    NestJS backend — modules/{auth,platform-admin,employees,
          org-structure,leave,payroll,attendance,compliance,documents,
          notifications,reports,audit}, common/{guards,decorators},
          prisma/{schema.prisma, migrations, RLS policy SQL}
  web/    React + Vite frontend — routes/{platform,tenant}, components/
          (shadcn/ui-based design system), lib/ (API client)
packages/
  shared-types/   DTOs/enums shared by api + web
infra/            Terraform: VPC, RDS, ECS, S3, CloudFront, IAM
docs/
  UPPER_SNAKE_CASE.md   cross-cutting architecture + contracts — source of
                        truth, kept in sync with code
  modules/NN_NAME.md    one deep spec per module (personas, flows, technical
                        + functional expectations, permission matrix) —
                        source of truth
  ui-build-prompts/     lowercase NN-name.md prompts fed to a UI build tool
                        — build inputs, NOT source of truth
  README.md             the docs naming convention, in full
```

## Working conventions

- Modular monolith, not microservices — one deployable, clean internal
  module boundaries so a module *can* be split out later without a
  rewrite, but isn't split preemptively.
- OpenAPI spec (via `@nestjs/swagger`) is the source of truth for the API
  contract — lets frontend work move somewhat independently of backend
  internals.
- Prefer the simpler, more boring option on any judgment call not covered
  above — keep the codebase approachable for the whole team.
- **Dev database is shared** — one Supabase Postgres the whole team connects
  to (via the Supavisor pooler), so everyone sees the same data. Schema is
  owned centrally: the migration owner runs `./scripts/dev.sh migrate`;
  everyone else pulls + `prisma generate`. The three-role RLS isolation
  model is unchanged (created there by `20260101000002_roles_and_rls`).
  Background workers (BullMQ: emails, document scans, scheduled jobs) are
  **off on laptops** (`NODE_ENV=development`, override with
  `WORKERS_ENABLED`) and run only on the preview box — they scan the shared
  DB, so a half-configured laptop would otherwise mark the preview's rows
  failed (`apps/api/src/common/background-workers.ts`).
  Local Docker Postgres is now used **only** by the e2e suite (it
  creates/drops tenants — never point it at the shared DB). Connection
  strings live in the team vault, not git. This is a dev-infra choice; prod
  is still RDS ap-south-1 per the Stack table.
- **Testing / preview deploy** — the API runs in Docker on a single
  free-tier **AWS EC2 `t3.micro`** (`apps/api/Dockerfile`, ap-northeast-1,
  port 80, `--restart unless-stopped`, plain `node dist/main.js` + the Leave
  BullMQ worker) and the web app on **Vercel** (`apps/web/vercel.json`,
  static Vite build with a `/api/*` rewrite proxying to the box —
  browser↔Vercel is HTTPS, Vercel↔EC2 is server-side HTTP). DB stays on
  Supabase, Auth on Firebase. Full runbook + env-var lists in
  `docs/DEPLOY.md`. This is *not* the production target — that's still AWS
  ap-south-1 **with RDS** (migrate off Supabase) per the Stack table, built
  as its own infra slice. Migrations are never run from the container; the
  schema owner applies them to Supabase deliberately.
