# Backend Architecture — Full Project Understanding

> **Status:** merged to `main`. Originally written from the cloud build
> agent's in-progress branch (`worktree-agent-a3b9c35364bc8192b`) at its
> foundation + auth/tenancy/employees/leave/dashboard checkpoint; the agent
> went on to add the test suite, frontend, and CI workflow described below,
> and the branch was merged into `main` after independently re-running the
> full test suite against a fresh, disposable Postgres 17 instance (not
> Docker — 7 unit + 12 e2e tests, all passing) as a second check beyond the
> agent's own report. Read `CLAUDE.md` first for the *why* behind these
> decisions — this file documents the *what* and *where*, traced from the
> actual source, so it stays accurate as the code evolves.

## 1. Repo layout as built

```
hrms/
├── apps/
│   ├── api/                         NestJS backend
│   │   ├── src/
│   │   │   ├── auth/                 login, refresh, MFA, JWT strategies
│   │   │   ├── platform-admin/       SaaS-operator console (separate DB role)
│   │   │   ├── employees/            employee/department CRUD, docs, bulk import
│   │   │   ├── leave/                leave types, balances, apply/approve
│   │   │   ├── dashboard/            role-aware home screen aggregation
│   │   │   ├── storage/              S3/MinIO wrapper
│   │   │   ├── prisma/               tenant + platform Prisma clients, RLS wrapper
│   │   │   ├── common/
│   │   │   │   ├── guards/           JwtAuthGuard, TenantGuard, RolesGuard, PlatformJwtAuthGuard
│   │   │   │   ├── decorators/       @Public(), @Roles(), @CurrentUser()
│   │   │   │   └── tenancy/          TenantResolutionMiddleware
│   │   │   ├── config/               typed configuration.ts (env → AppConfig)
│   │   │   ├── app.module.ts
│   │   │   └── main.ts
│   │   ├── prisma/
│   │   │   ├── schema.prisma         multi-schema: `public` (tenant) + `platform`
│   │   │   ├── seed.ts                (in progress at time of writing)
│   │   │   └── migrations/
│   │   │       ├── 20260101000001_init/              tables, enums
│   │   │       └── 20260101000002_roles_and_rls/      DB roles + RLS policies
│   │   └── test/                     auth.e2e-spec.ts, tenant-isolation.e2e-spec.ts, fixtures
│   └── web/                          Vite + React app — design system + pages, wired to the API
├── .github/workflows/ci.yml           lint + unit + e2e (real Postgres service container) + build, on every PR
├── docker-compose.yml                 Postgres 16 + MinIO (S3-compatible), for local dev
└── package.json                       npm workspaces root (apps/*, packages/*)
```

**What's real:** every file listed under `apps/api/src/*` and `apps/web/src/*` above contains working, wired logic — not stubs. This has been verified twice independently: once by the build agent (which `initdb`'d its own throwaway Postgres cluster, since it had no Docker in its sandbox, and drove the real HTTP API — catching and fixing a real bug where `EmployeesController`/`LeaveController` were missing `JwtAuthGuard`/`TenantGuard` entirely), and again after merge by re-running the full suite (7 unit + 12 e2e tests) against a fresh disposable Postgres instance as a second check before merging to `main`.

## 2. The multi-tenancy mechanism, traced end to end

This is the part worth understanding precisely, because it's the product's core trust promise. Four pieces, in the order a request actually hits them:

### 2.1 `TenantResolutionMiddleware` — runs before auth

File: `src/common/tenancy/tenant-resolution.middleware.ts`. Registered in `app.module.ts` for every route except `platform-admin/*`.

- Reads the tenant identifier from either the `Host` header's subdomain (production: `acme.hrms-platform.com` → `acme`) or an `X-Tenant-Subdomain` header (local dev — no DNS/hosts-file wiring needed), depending on `TENANT_RESOLUTION_MODE`.
- Looks up `platform.tenants` **using the `hrms_platform` connection** — this is the one and only place tenant *routing* metadata is read, and it never touches the `public` (tenant business data) schema.
- Rejects with 404 if the subdomain doesn't match a tenant, 403 if the tenant is `SUSPENDED`.
- Attaches `req.tenantId`, `req.tenantSubdomain`, `req.tenantStatus`.
- Runs pre-auth deliberately, because the login endpoint itself needs to know which tenant's `users` row to check.

### 2.2 `JwtStrategy` + `JwtAuthGuard` — authentication

File: `src/auth/strategies/jwt.strategy.ts`. Validates the bearer access token's signature/expiry and returns `{ sub, tenantId, role, email, employeeId }` as `req.user`. Note the JWT's own `tenantId` claim is independent of the subdomain-resolved `req.tenantId` set in step 2.1 — they get cross-checked next.

### 2.3 `TenantGuard` — the cross-check that actually stops cross-tenant token replay

File: `src/common/guards/tenant.guard.ts`. Runs after `JwtAuthGuard`. Rejects the request unless `req.user.tenantId === req.tenantId`. This is what stops a **valid, correctly-signed** token issued for tenant A from being used against tenant B's subdomain — signature validity alone isn't enough, the tenant claim has to match where the request is actually landing.

### 2.4 `TenantPrismaService` + `withTenantContext` — the database-level backstop

Files: `src/prisma/tenant-prisma.service.ts`, `src/prisma/with-tenant-context.ts`.

Every tenant-scoped query goes through `TenantPrismaService.client`, a request-scoped (`Scope.REQUEST`) accessor. Under the hood, `withTenantContext()` wraps every Prisma operation in a transaction:

```sql
SELECT set_config('app.current_tenant_id', '<tenantId>', TRUE);
-- then, same transaction, same connection:
<the actual query>
```

This matters because Prisma pools connections per query normally — `set_config` has to run on the *exact* connection the query itself uses, which is only guaranteed inside an explicit transaction. `tenantId` here comes only from `req.tenantId`/`req.user.tenantId`, which the request itself cannot forge (see 2.1–2.3). If no tenant was resolved, `TenantPrismaService.tenantId` throws rather than falling back to anything — **fail closed**.

The actual enforcement is a Postgres **Row-Level Security** policy applied to every tenant table (migration `20260101000002_roles_and_rls`):

```sql
CREATE POLICY tenant_isolation ON public.<table>
  USING      (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
```

Two details worth knowing:
- `current_setting(..., true)` returns `NULL` instead of erroring when unset — and `NULL = anything` is never true in SQL, so a request that somehow reached the DB with no tenant context set sees **zero rows**, not an error and not all rows. Fail closed by construction, not by convention.
- `FORCE ROW LEVEL SECURITY` (not just `ENABLE`) is set on every table, so even the table-owning role is subject to the policy unless it's a superuser — defense in depth against the app ever being misconfigured to connect as the owner/migration role.

### 2.5 Postgres roles — isolation that doesn't depend on the app being correct

Also in `20260101000002_roles_and_rls`:

| Role | Used by | Grants | Notes |
|---|---|---|---|
| (migration role, e.g. `hrms_superuser`) | `prisma migrate deploy` only | owns all objects | never used by the running app |
| `hrms_app` | `TenantPrismaClientProvider` — all tenant business queries | CRUD on `public.*` tables only | `NOBYPASSRLS` — RLS always applies, no escape hatch |
| `hrms_platform` | `PlatformPrismaClientProvider` — platform-admin module | CRUD on `platform.*` tables only | **zero grants on `public`, not even `USAGE`** — cannot resolve tenant table names, let alone query them |

This is the concrete mechanism behind "even the founder can't casually see tenant data": it's not a permission checkbox in application code, it's that the platform admin's database connection is physically incapable of running a query against `public.employees` — Postgres itself refuses it, independent of anything the API code does or is tricked into doing.

### 2.6 One deliberate exception, and why it's safe

`PlatformAdminService.seedCompanyAdmin()` and `.refreshHeadcount()` (in `src/platform-admin/platform-admin.service.ts`) need to write into a brand-new tenant's `public.users`/`public.employees` (to create the first Company Admin login, and to denormalize a headcount back into `platform.tenants.employeeCount`). These do **not** use the `hrms_platform` connection — they use the separate `hrms_app`-backed `TenantPrismaClientProvider`, scoped to one tenant via the same `withTenantContext()` helper as ordinary requests. So `hrms_platform` itself never touches `public` under any code path; the exception is implemented via a different, correctly-scoped connection, not a privilege escalation on the platform role.

## 3. Auth flow in detail

Two entirely parallel auth systems exist — tenant users and platform admins never share a login, a token type, or a guard:

| | Tenant users | Platform admins |
|---|---|---|
| Table | `public.users` | `platform.platform_admin_users` |
| Login endpoint | `POST /api/auth/login` | `POST /api/platform-admin/auth/login` |
| Passport strategy | `JwtStrategy` (`'jwt'`) | `PlatformJwtStrategy` (`'platform-jwt'`) |
| Token discriminator | `tenantId` claim present | `type: 'platform_admin'` claim required |
| Guard | `JwtAuthGuard` + `TenantGuard` | `PlatformJwtAuthGuard` only (no tenant concept) |

A platform-admin token can never satisfy the tenant guard chain (no `tenantId` claim to match against a subdomain) and a tenant token can never satisfy `PlatformJwtStrategy.validate()` (missing `type: 'platform_admin'`) — cross-use fails by construction, not by an if-check that could be forgotten.

**Password + lockout** (`auth.service.ts`): bcrypt cost 12. On login, if the user doesn't exist, a fixed dummy hash is compared anyway so response timing doesn't reveal account existence. 5 failed attempts locks the account for 30 minutes (`lockedUntil`); a successful login resets the counter.

**MFA** (`mfa.service.ts`, TOTP via `otplib`): required for `COMPANY_ADMIN` and `HR_MANAGER` roles (`MFA_REQUIRED_ROLES`). First login without MFA enrolled returns `mfa_enrollment_required` + a QR code; the client must complete `POST /auth/mfa/enroll/verify` with a code from an authenticator app before getting tokens. Subsequent logins for MFA-required roles return `mfa_required` and need `POST /auth/mfa/verify`. Both flows use a short-lived (10 min) signed "challenge token" carrying the intent (`mfa_enroll` vs `mfa_verify`) so the two flows can't be confused.

**Tokens:** 15-minute access token (`jwt.accessTtl`), 30-day refresh token delivered as an `httpOnly`, `sameSite=lax`, path-scoped (`/api/auth`) cookie — never readable from JS, never sent to unrelated routes. Refresh tokens are **rotated and hashed**: `auth.service.ts` stores only a SHA-256 hash of the current refresh token (`refreshTokenHash`) and issues a new one on every refresh call. If a refresh token is presented whose hash doesn't match what's stored, that's refresh-token reuse (a stolen/replayed token) — the service treats it as a compromise signal and **revokes the session entirely** rather than just rejecting the one request.

## 4. Authorization layers (guard chain)

Applied per-controller via `@UseGuards(...)`, in this order where all three are present:

1. **`JwtAuthGuard`** — valid, unexpired signature. Routes marked `@Public()` (e.g. `login`) skip this.
2. **`TenantGuard`** — JWT's tenant matches the subdomain-resolved tenant (§2.3). For `@Public()` routes it still requires *a* tenant to have been resolved (so login itself is tenant-scoped), just not a JWT.
3. **`RolesGuard`** — if a handler has `@Roles('COMPANY_ADMIN', 'HR_MANAGER')` etc., the authenticated user's role must be in that list. No decorator = no restriction beyond auth+tenant.

**Below the guard layer**, `employees.service.ts` adds a fourth layer that guards can't express — "own reports only" / "own data only" — via `scopeFor(user)`:

```ts
EMPLOYEE     → { id: user.employeeId }
LINE_MANAGER → { OR: [{ id: user.employeeId }, { reportingManagerId: user.employeeId }] }
default      → {} // no extra restriction beyond RLS
```

This is layered *on top of* RLS, not instead of it — RLS guarantees cross-tenant isolation; this is ordinary same-tenant, per-row authorization that any single-tenant app would also need (an Employee shouldn't see a colleague's salary/leave data even within the same company).

`leave.service.ts` has a known, called-out gap here: `assertCanViewEmployee()`'s `LINE_MANAGER` branch is currently permissive ("kept permissive here for MVP scope") rather than verifying `reportingManagerId` — worth tightening before this handles real customer data, even though RLS/tenant-scoping still bound the blast radius to same-tenant.

## 5. Module-by-module reference

### `auth/` — `AuthService`, `AuthController`, `MfaService`
Endpoints: `POST /auth/login`, `/auth/mfa/verify`, `/auth/mfa/enroll/verify`, `/auth/refresh`, `/auth/logout`, `GET /auth/me`. `AuthService.hashPassword()` is a static method other modules (`PlatformAdminService`, `EmployeesService`) reuse when creating users, so bcrypt cost/config lives in exactly one place.

### `platform-admin/` — `PlatformAdminService`, `PlatformAdminController`
Mirrors the tenant auth flow (own bcrypt/lockout/MFA logic against `platform_admin_users`) plus tenant lifecycle:
- `POST /platform-admin/tenants` — `createTenant()`: creates the `Tenant` + `Subscription` row, then seeds that tenant's first `COMPANY_ADMIN` user via the `hrms_app`-backed connection (§2.6). If seeding the admin fails, the tenant row is deleted — **no tenant is left in a state where nobody can log in**.
- `GET /platform-admin/tenants` — list with subscription info, for the operator console.
- `PATCH /platform-admin/tenants/:id/status` — `ACTIVE` / `SUSPENDED` / `TRIAL`. `SUSPENDED` is enforced at the tenant-resolution layer (§2.1), so suspending a tenant immediately locks out every user of that tenant, not just new logins.

### `employees/` — `EmployeesService`, plus `EmployeesController` / `DocumentsController` / `DepartmentsController`
- CRUD on `Employee` and `Department`, with the `scopeFor()` row-scoping described in §4.
- `orgChart()` — fetches all employees for the tenant, builds a manager→reports tree in memory (not a recursive SQL CTE — fine at hundreds of employees, revisit if a tenant gets large).
- Document upload: `uploadDocument()` writes the file to S3/MinIO under `tenants/<tenantId>/employees/<employeeId>/<uuid>-<filename>` (via `StorageService`) and records metadata in `public.documents`; downloads only ever hand back a 5-minute presigned URL (`getDocumentDownloadUrl`), never a direct object reference.
- `bulkImport()` — parses an uploaded `.xlsx` (via `exceljs`), requires `employeeCode`/`firstName`/`lastName` columns, inserts row-by-row and returns a per-row success/error report rather than failing the whole batch on one bad row.

### `leave/` — `LeaveService`, `LeaveController`
- Leave types (`LeaveType`) carry `annualQuota` and `carryForwardCap`; `initializeYearlyBalances()` upserts a `LeaveBalance` row per employee per year.
- `apply()` computes an inclusive calendar-day count (documented as a deliberate MVP simplification — no working-day/holiday calendar yet), checks `accrued - used` against the requested days, and flags `isLop` (loss-of-pay) if the balance is insufficient — but still creates the request rather than blocking it, so an LOP leave request still needs an approval decision.
- **Two-level approval**, driven by `LeaveRequestStatus`: `PENDING_L1 → PENDING_L2 → APPROVED` (or `REJECTED`/`CANCELLED` at either stage). If an employee has no `reportingManagerId`, their request starts at `PENDING_L2` directly (skips a nonexistent L1). Balance deduction (`adjustBalance`) only happens on final `APPROVED`, and only if `!isLop`.
- `cancel()` reverses a balance deduction if cancelling an already-approved, non-LOP request.
- `pendingApprovals()` / `teamCalendar()` — the two queries the Dashboard and a manager's "things to act on" view are built from.

### `dashboard/` — `DashboardController`
Single `GET /dashboard`, branches on role: admins (`COMPANY_ADMIN`/`HR_MANAGER`) get headcount + department breakdown + pending-approvals count; everyone else gets their own leave balances, their own pending approvals (non-empty if they're a Line Manager with reports awaiting L1), and their 5 most recent requests. One endpoint, shaped differently server-side rather than the frontend assembling multiple calls — keeps the "role-aware home screen" logic in one place.

### `storage/` — `StorageService`
Thin `@aws-sdk/client-s3` wrapper pointed at MinIO locally (`docker-compose.yml`) and real S3 in production via env vars only — no code path differs between the two. Bucket auto-created on boot in dev (best-effort; won't block startup if MinIO isn't up yet). All object keys are tenant- and employee-prefixed UUIDs; the API never lists bucket contents or returns a raw key, only time-boxed presigned URLs.

### `prisma/` — the tenancy plumbing
Already covered in depth in §2. Three files worth remembering by name: `TenantPrismaClientProvider` (raw `hrms_app` connection, singleton), `PlatformPrismaClientProvider` (raw `hrms_platform` connection, singleton), `TenantPrismaService` (request-scoped wrapper around the former — this is what every feature service actually injects).

### `common/` — cross-cutting
- `guards/`: `JwtAuthGuard`, `TenantGuard`, `RolesGuard`, `PlatformJwtAuthGuard` — see §3–4.
- `decorators/`: `@Public()` (skips `JwtAuthGuard`), `@Roles(...)` (read by `RolesGuard`), `@CurrentUser()` (pulls `req.user` into a handler param).
- `tenancy/`: `TenantResolutionMiddleware` (§2.1).

### `config/` — `configuration.ts`
One typed `AppConfig` object built from `process.env`, injected everywhere via `ConfigService<AppConfig, true>` (the `true` enables strict inference so `config.get('jwt.accessSecret', { infer: true })` is type-checked against the interface, not a stringly-typed lookup). Two separate DB URLs (`db.tenantUrl` for `hrms_app`, `db.platformUrl` for `hrms_platform`) — this is where the two-connection split from §2.5 is wired at the app level.

## 6. Data model (Prisma schema)

Two Postgres **schemas** in one database (`generator client { previewFeatures = ["multiSchema"] }`):

**`platform` schema** — owned/reachable only by `hrms_platform`:
`Tenant` (name, subdomain, status, denormalized `employeeCount`) → `Subscription` (plan, seats, renewsAt) · `PlatformAdminUser` (own bcrypt/MFA/lockout fields, mirroring `User`) · `PlatformAuditLog` (actor, action, target, metadata — append-only by convention, not yet DB-enforced append-only).

**`public` schema** — owned/reachable only by `hrms_app`, every table carries `tenantId` + RLS:
`User` (auth identity, one-to-one optional with `Employee`) · `Department` · `Employee` (self-referential `reportingManagerId` for the org tree, optional link to `User`) · `Document` (S3 key + metadata) · `LeaveType` · `LeaveBalance` (unique per tenant+employee+leaveType+year) · `LeaveRequest` (two-stage approval fields: `l1ApproverId`/`l1DecidedAt`, `l2ApproverId`/`l2DecidedAt`) · `AuditLog` (actor, action, target, metadata, IP — exists in schema, not yet wired to be written from every mutation).

Every tenant table has `@@index([tenantId])` at minimum — necessary since RLS adds a `tenant_id = ...` filter to literally every query against these tables.

## 7. Local dev environment

**Database:** the team shares **one Postgres — a Supabase project** (`fayiwvnyqwgqkbudgeut`, ap-northeast-1, PG 17). Connections go through Supabase's Supavisor pooler: the **session pooler** (`:5432`, user `postgres`) for `prisma migrate`, the **transaction pooler** (`:6543`, users `hrms_app.<ref>` / `hrms_platform.<ref>`, `?pgbouncer=true`) for the running API. The three-role isolation model (`hrms_app` NOBYPASSRLS, `hrms_platform` zero grants on `public`, RLS `FORCE`) is created by `20260101000002_roles_and_rls` there exactly as it is locally — verified through the pooler (`hrms_app` with no tenant context → 0 rows; `hrms_platform` → permission denied on `public.users`). Schema is owned centrally: the migration owner runs `./scripts/dev.sh migrate`; everyone else pulls + `prisma generate`. Connection strings live in the team vault, not git (`apps/api/.env` is gitignored).

**Local Docker (`docker-compose.yml`):** Postgres 16 + MinIO. Postgres here is used **only by the e2e suite** (`apps/api/.env.test`) — the suite creates and drops tenants, so it must not touch the shared DB. MinIO (S3-compatible, console `:9001`) is the local object store for both dev and tests.

`TENANT_RESOLUTION_MODE=header` lets you develop without real subdomains — send `X-Tenant-Subdomain: <subdomain>` on every request. Three distinct connection strings at runtime (`DATABASE_URL` for migrations, `TENANT_DATABASE_URL` as `hrms_app`, `PLATFORM_DATABASE_URL` as `hrms_platform`), not one, is intentional and load-bearing for the isolation model.

## 8. What's done, and what's genuinely still missing

**Done and verified** (as of the merge to `main`): foundation, auth + MFA + tenancy/RLS, platform admin, employees (CRUD, docs, bulk import), leave (types, balances, 2-level approval), dashboard, the React frontend (login/MFA flow, employee list/detail/create, leave, org chart, departments, platform-admin console — Tailwind v4 + hand-written shadcn-style primitives, light/dark tokens), the tenant-isolation + auth + Identity-&-Access e2e suite (33 tests: `test/tenant-isolation.e2e-spec.ts`, `test/auth.e2e-spec.ts`, `test/access.e2e-spec.ts`) and unit suites (leave + attendance, 19 tests), and a GitHub Actions CI workflow running all of it against a real Postgres service container + real Firebase (no emulator — CI reads `FIREBASE_SERVICE_ACCOUNT_JSON` / `FIREBASE_WEB_API_KEY` / `FIREBASE_PROJECT_ID` from repo secrets; e2e tests create `e2e-*@example.test` users and delete them in teardown) on every PR.

**Still genuinely missing** — cross-reference against `CLAUDE.md` and the architecture blueprint before assuming otherwise:

- `LeaveService.assertCanViewEmployee()`'s `LINE_MANAGER` case is a known-permissive placeholder (§4) — tighten before real customer data goes through it.
- `AuditLog` / `PlatformAuditLog`: **partially wired.** The Identity & Access `access` module writes access-change events (`access.role_changed` / `user_activated` / `user_deactivated` / `password_reset_sent` / `user_created`) to `public.audit_log`, and `PlatformAdminService.updateTenantStatus()` writes `tenant.status_changed` to `platform.platform_audit_log`. Both `login_audit_entries` and `audit_log` are now append-only for `hrms_app` — no `UPDATE`/`DELETE` grant (migration `20260908074457_identity_access_audit`). Still unwritten: employee create/update, leave approve/reject → `audit_log`. No aggregation / UI / retention-purge yet.
- No holiday-aware leave day counting — `apply()` uses an inclusive calendar-day count, not a working-day calendar (documented as a deliberate MVP simplification in the code itself).
- Login audit log (`FR-AUTH-008`): **wired.** `LoginAuditEntry` table + `AuthService.session()` writes one append-only row per server-observed `POST /api/auth/session` outcome (`SUCCESS` / `USER_INACTIVE` / `CLAIM_MISMATCH` / `TOKEN_EXPIRED`) with IP (`trust proxy` set in `main.ts`) + user-agent. `BAD_CREDENTIALS` (rejected in the Firebase client SDK) and `TENANT_SUSPENDED` (rejected in pre-auth middleware) are not server-observable — see `docs/modules/01_IDENTITY_AND_ACCESS.md` §9. Read via `GET /api/access/audit?feed=login`; the whole `access` surface is covered by `test/access.e2e-spec.ts`.
- Bulk-import and team-calendar are API-only — no frontend screen calls them yet.
- Payroll, Attendance, and Compliance-export modules haven't been started — they're the next slice per the 12-week plan, and payroll in particular should get the time budget protected (§9 of the blueprint flags it as the highest-effort, highest-risk module).

This document reflects a point-in-time read of the code as of the merge; re-check §8 against the actual repo state as work continues.
