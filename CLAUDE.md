# HRMS — Project Context & Decisions

Multi-tenant HRMS SaaS, built from `HRMS_SRS_v1.0(1).docx`. This file is the
condensed decision record — read it before touching architecture, tenancy,
or security code. It exists so a fresh Claude session (or you, on another
machine) doesn't have to re-derive these calls from scratch.

**Builder context:** solo founder, occasional frontend contractor help,
building toward a working demo for a startup co-founder pitch and a paid
pilot with two customers (a startup + a hospital) inside 2–3 months.

## Why this deviates from the SRS

The SRS's own architecture (microservices on Kubernetes/EKS, Kafka, Istio,
Keycloak, Elasticsearch, schema-per-tenant, native mobile app, live
government e-filing APIs) assumes a funded, multi-person team — its own
Phase-1 roadmap prices "MVP" at 16 weeks with dedicated backend, frontend,
mobile, DevOps, QA, payroll-SME and compliance-specialist roles in parallel.
That doesn't fit one person on a 2–3 month clock. The SRS's *domain logic*
(payroll math, statutory forms, roles, compliance obligations) is kept
as-is; the *infrastructure and delivery plan* is re-cut. Full reasoning,
diagrams, cost estimates and the week-by-week plan live in the architecture
blueprint (ask the founder for the artifact link, or regenerate from this
file + the SRS if it's been lost).

## Stack (do not deviate without updating this file)

| Layer | Choice | Not this, because |
|---|---|---|
| Backend | NestJS (Node.js/TypeScript) + Prisma + PostgreSQL | Not Spring Boot/microservices — one person can't operate 10 services + a mesh + a broker |
| Frontend | React + Vite (TypeScript), client-side rendered, React Router, Tailwind + shadcn/ui | Not Next.js — this is an authenticated dashboard behind login, SSR buys nothing |
| Multi-tenancy | Shared DB, shared schema, `tenant_id` + PostgreSQL Row-Level Security | Not schema-per-tenant — RLS gives real isolation without per-tenant migration/connection tooling a solo dev would have to build |
| Background jobs | BullMQ on Redis | Not Kafka — payslip PDFs, statutory files, email sends, don't need a broker at this scale |
| Storage | S3 (private, presigned URLs) | — |
| Auth | Firebase Auth — ID token *is* the session (Bearer header, SDK-refreshed), `tenantId`/`role` as server-set custom claims. No MFA. | Not a self-issued JWT/bcrypt/TOTP stack (the original choice, kept "for one less system to run and patch") — revisited for ship speed: hosted password reset/sign-in UI beats hand-rolling it solo. Not Keycloak either, same reasoning as before. |
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

**Platform Admin (the founder's own operator role) is structurally
separate**, not a role flag inside the tenant app: its own schema
(`tenants`, `subscriptions`, `platform_admin_users`, `platform_audit_log`)
and its own Postgres role/connection with **zero grants** on tenant
business tables. Tenant metadata the platform admin legitimately needs
(name, plan, employee *count*, status) is denormalized into the platform
schema — no join into PII tables required. Genuine support access to a
tenant's data goes through a logged, time-boxed break-glass flow, not a
standing permission.

**Why not schema-per-tenant or DB-per-tenant** (both mentioned in the
SRS): both multiply migration/connection/backup operational complexity
per tenant — real engineering cost for isolation that RLS already buys at
2 tenants. Keep DB-per-tenant in mind as a *paid dedicated tier* if a
future enterprise/hospital contract demands it — not the default.

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
RBAC + tenant isolation (RLS), Platform Admin console (tenant
onboarding/enable-disable/metadata only), Employee Master, Leave
Management, role-aware Dashboard — backend and frontend both. See
`docs/BACKEND_ARCHITECTURE.md` for the full traced reference and its §8
for known gaps within these modules (line-manager leave-visibility scoping
is a known-permissive placeholder; audit log tables exist but aren't
written to yet).

**Not started:** Payroll, Attendance, Compliance exports are the next
slice — see the blueprint's 12-week plan for sequencing (payroll is the
highest-effort, highest-risk module; protect its time budget over breadth
elsewhere).

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
```

## Working conventions

- Modular monolith, not microservices — one deployable, clean internal
  module boundaries so a module *can* be split out later without a
  rewrite, but isn't split preemptively.
- OpenAPI spec (via `@nestjs/swagger`) is the source of truth for the API
  contract — lets frontend work move somewhat independently of backend
  internals.
- Prefer the simpler, more boring option on any judgment call not covered
  above — this is maintained solo.
