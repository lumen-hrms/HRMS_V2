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
| Multi-tenancy | Shared DB, shared schema, `tenant_id` + PostgreSQL Row-Level Security | Not schema-per-tenant — RLS gives real isolation without per-tenant migration/connection tooling to build and maintain |
| Background jobs | BullMQ on Redis | Not Kafka — payslip PDFs, statutory files, email sends, don't need a broker at this scale |
| Storage | S3 (private, presigned URLs) | — |
| Auth | Firebase Auth — ID token *is* the session (Bearer header, SDK-refreshed), `tenantId`/`role` as server-set custom claims. No MFA. | Not a self-issued JWT/bcrypt/TOTP stack (the original choice) — a hosted, audited password reset/sign-in UI beats maintaining our own. Not Keycloak either — one less system to run and patch. |
| Hosting | AWS ap-south-1 (Mumbai), managed services: ECS Fargate, RDS, S3, CloudFront | Not EKS/Kubernetes — stays in-region for the "India-compliant" story without container-orchestration ops overhead |

## Multi-tenancy — the load-bearing decision

**One shared database, one shared schema.** Every tenant-owned table has a
`tenant_id` column and a Postgres RLS policy keyed to the session variable
`app.current_tenant_id`, set once per request/transaction from the
validated Firebase ID token's `tenantId` custom claim — never from a raw
request parameter. The app's Postgres role must **never** have
`BYPASSRLS`.

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

**Platform Admin (the platform team's operator role) is structurally
separate**, not a role flag inside the tenant app: its own schema
(`tenants`, `subscriptions`, `platform_admin_users`, `platform_audit_log`)
and its own Postgres role/connection with **zero grants** on tenant
business tables. Tenant metadata the platform admin legitimately needs
(name, plan, employee *count*, status) is denormalized into the platform
schema — no join into PII tables required. Genuine support access to a
tenant's data goes through a logged, time-boxed break-glass flow, not a
standing permission.

**Why not schema-per-tenant or DB-per-tenant:** both multiply
migration/connection/backup operational complexity per tenant — real
engineering cost for isolation that RLS already buys. Keep DB-per-tenant
in mind as a *paid dedicated tier* if a future enterprise/hospital
contract demands it — not the default.

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
  should not be enough to read them.
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
onboarding/enable-disable/metadata only), Employee Master, role-aware
Dashboard — backend and frontend both. See `docs/BACKEND_ARCHITECTURE.md`
for the full traced reference and its §8 for known gaps within these
modules (the generic `audit_log` is now written to for access-change
events but has no aggregation/UI yet).

**Leave Management (backend ~95% done, frontend mid-rebuild):** all six
backend gaps tracked in `docs/MODULE_SPECS.md` §4 are closed — the
line-manager leave-visibility placeholder is now a real
`reportingManagerId` check, holiday-aware working-day counts, request
attachments, a tenant-configurable 1-or-2-level approval chain with
escalation timers (new BullMQ `leave` queue / Redis — first use of BullMQ
in this repo), a minimal monthly/quarterly accrual job, and the remaining
planned endpoints (team balances, balance adjustments, ledger, settings).
Frontend is still being rebuilt role-by-role against
`apps/web/src/lib/leave` behind `VITE_LEAVE_MOCK` (default on): Employee
and Line Manager screens are done; HR/Company Admin screens (All
Requests, Leave Types CRUD, Balance Adjustments, Ledger, Settings) exist
in code but aren't wired into `pages/leave/index.tsx` yet, and the Auditor
slice hasn't been built. See `docs/MODULE_SPECS.md` §4 and
`docs/LEAVE_UI_SPECS.md`.

**Identity & Access — remaining gaps** (`docs/modules/01_IDENTITY_AND_ACCESS.md`
§9): `BAD_CREDENTIALS` and `TENANT_SUSPENDED` sign-in failures aren't
server-observable so aren't in the login trail (suspend/resume is logged
once in `platform_audit_log` instead); no 2-year retention purge job yet.

**Not started:** Payroll, Attendance, Compliance exports are the next
slice — see the blueprint's 12-week plan for sequencing (payroll is the
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
  Local Docker Postgres is now used **only** by the e2e suite (it
  creates/drops tenants — never point it at the shared DB). Connection
  strings live in the team vault, not git. This is a dev-infra choice; prod
  is still RDS ap-south-1 per the Stack table.
