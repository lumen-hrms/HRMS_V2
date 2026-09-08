# HRMS — Module Specifications (Developer Guide)

> **Audience:** anyone on the team picking up a module to build or extend.
> For each module this gives: the **expectation** (what "done" means),
> the **feature list** it owns, the **happy-path user journey**, and the
> **functionalities / API surface** as they exist today.
>
> Read `CLAUDE.md` first (the *why* behind architecture choices) and
> `docs/BACKEND_ARCHITECTURE.md` (the *what/where*, traced from source). This
> file sits between them: it's the per-module product+dev contract.
>
> **This file is the index / summary.** Each module has a deep spec in
> `docs/modules/NN_MODULE_NAME.md` — personas & how each uses the module,
> full technical + functional expectations, flows, invariants, permission
> matrix, acceptance criteria. The per-module `**Deep spec:**` link points to
> it. Modules without a link yet are still to be written.
>
> **Priority tags:** `[MUST]` = V1-blocking, `[SHOULD]` = v1.1 target,
> `[COULD]` = later. Where V1 deliberately narrows a feature, it's called
> out under **Scope cut**. (`FR-XXX` tags are legacy references to an early
> spec draft that is no longer maintained — ignore them; this file and the
> code are the source of truth.)
>
> **Last synced to code:** 2026-09-08 (commit `ceaccac` + Identity & Access
> `access` module & `LoginAuditEntry`; Firebase emulator removed
> (dev/tests/CI all real Firebase); shared **Supabase** dev DB; + **Platform
> Admin operator console** — full UI at `/platform-admin/*` (tenants list,
> new-tenant wizard, tenant detail 4 tabs, audit screen), onboarding via
> reset-link email, `tenant.created` + `tenant.status_changed` written to
> `platform_audit_log`; + in-progress Leave UI rebuild, see
> `docs/LEAVE_UI_SPECS.md`).
>
> **Keep the status table + per-module progress bars current on every change** —
> if a commit moves a module, move its bar (status mark, ASCII bar, %), its
> `**Status:**` line, and the `Last synced to code` date in the **same
> commit**. This is a standing, non-optional rule — see `CLAUDE.md` →
> "Keeping module status in sync".

---

## Status legend

| Mark | Meaning |
|---|---|
| ✅ **Done** | Backend + frontend wired, persists to real Postgres, has tests or manual verification |
| 🟡 **Partial** | Core path works; named gaps remain (listed per module) |
| 🔴 **Not started** | No code yet — spec here is the build target |

| Module | Status | Progress |
|---|---|---|
| 1. Identity & Access (Auth + RBAC + Tenancy) | ✅ | `███████████████████░` 97% — auth/RBAC/tenancy live; `access` module wired (Users, role/status/reset, login+access audit, My Account) with e2e RBAC + append-only tests; `LoginAuditEntry` table written on every session outcome. Remaining: `BAD_CREDENTIALS`/`TENANT_SUSPENDED` not server-observable (§1 gaps); Line-Manager leave scoping (§4) |
| 2. Platform Admin | ✅ | `███████████████████░` 94% — full operator console UI (tenants list, new-tenant wizard, tenant detail tabs, audit screen); onboarding now emails a reset link; `tenant.created` + `tenant.status_changed` written to `platform_audit_log`. Pending: audit *read* API, `PATCH .../plan`, refresh-headcount API, break-glass |
| 3. Employee Master + Org Structure | 🟡 | `█████████████████░░░` 85% |
| 4. Leave Management | 🟡 | `█████████████████░░░` 86% — BE ~80%; FE rebuild underway (foundation + Employee + Line Manager screens done; HR / Company Admin / Auditor screens next) |
| 5. Attendance & Time Tracking | 🟡 | `███████████░░░░░░░░░░` 55% |
| 6. Dashboard | ✅ | `█████████████████░░░` 85% |
| 7. Payroll Engine | 🔴 | `░░░░░░░░░░░░░░░░░░░░` 0% |
| 8. Statutory Compliance | 🔴 | `░░░░░░░░░░░░░░░░░░░░` 0% |
| 9. Documents | 🟡 | `████████████░░░░░░░░` 60% (lives inside Employee Master today) |
| 10. Notifications | 🔴 | `░░░░░░░░░░░░░░░░░░░░` 0% |
| 11. Reports & Analytics | 🔴 | `██░░░░░░░░░░░░░░░░░░` 10% (only the Dashboard aggregates exist) |
| 12. Audit Log | 🟡 | `█████░░░░░░░░░░░░░░░` 25% — `login_audit_entries` + `audit_log` are append-only (no `UPDATE`/`DELETE` grant) and written by Identity & Access (sign-in outcomes, role/status/reset/login-created); no aggregation/retention-purge/UI yet |
| 13. Tenant Configuration | 🟡 | `██████░░░░░░░░░░░░░░` 30% — schema + onboarding defaults landed; guard, Settings UI, engine wiring next. See `docs/TENANT_CONFIGURATION.md` |

Deferred to a later phase — **do not build without a scope discussion**
(`CLAUDE.md` → "Explicitly deferred"): Onboarding, Recruitment/ATS,
Performance Management, Expense Management, Helpdesk, HR Analytics/ML,
AI HR Assistant, LMS, OKR, native mobile app, biometric-device integration,
live e-filing APIs, SSO.

---

## Conventions every module follows

- **Guard chain (tenant routes):** `JwtAuthGuard` → `TenantGuard` →
  `RolesGuard`. Add `@Roles(...)` on a handler to restrict; no decorator =
  any authenticated user in the tenant. `@Public()` skips JWT (still
  tenant-scoped).
- **Row scoping below the guard** (things a static role check can't express)
  lives in the **service layer**, e.g. `EmployeesService.scopeFor(user)`:
  `EMPLOYEE` → own record only; `LINE_MANAGER` → own + direct reports;
  admins → unrestricted (within RLS).
- **Every tenant query** goes through `TenantPrismaService.client` — never the
  raw Prisma client — so the RLS session variable `app.current_tenant_id` is
  set on the same connection/transaction. New tables must carry `tenant_id`,
  an `@@index([tenantId])`, and an RLS policy in the roles/RLS migration.
- **Money:** `NUMERIC`, never float. **Timestamps:** `TIMESTAMPTZ`, stored
  UTC, displayed IST. **PII (PAN, bank a/c):** app-layer KMS encryption on
  top of at-rest. **Aadhaar:** last 4 digits only.
- **DTOs / enums shared with the frontend** go in `packages/shared-types`.
- **OpenAPI** (`@nestjs/swagger`) is the API contract — annotate new
  endpoints so the frontend can move independently.
- **Frontend:** React + Vite, React Router, Tailwind v4, hand-written
  shadcn-style primitives in `apps/web/src/components/ui`, "Lumen" design
  language. API calls through `apps/web/src/lib` client.

---

## 1. Identity & Access — Auth + RBAC + Multi-tenancy

**Deep spec:** `docs/modules/01_IDENTITY_AND_ACCESS.md` ·
**UI prompt:** `docs/ui-build-prompts/01-identity-access.md`
**Status:** ✅ auth/RBAC/tenancy · ✅ `access` module wired
(`/api/access/*`) with e2e RBAC + append-only tests · ✅ `LoginAuditEntry`
written on every session outcome · `VITE_ACCESS_MOCK` defaults off
**Code:** `apps/api/src/auth`, `apps/api/src/access`, `apps/api/src/firebase`,
`apps/api/src/common/{guards,decorators,tenancy}`, `apps/api/src/prisma`,
`apps/web/src/pages/access`, `apps/web/src/lib/access`

### Expectation

A request cannot reach tenant data unless it is (a) a valid Firebase ID
token, (b) for a user that exists and is active in **this** tenant, and
(c) allowed by role. Cross-tenant access must fail at **three**
independent layers (token/tenant cross-check, app query scoping, Postgres
RLS) — a bug in any one layer alone must not leak data. The adversarial
test suite (`test/tenant-isolation.e2e-spec.ts`) is the definition of done
and a **P0 gate**, not a nice-to-have.

### Feature list

| Feature | SRS | V1 status |
|---|---|---|
| Email/password login | FR-AUTH-001 | ✅ via Firebase Auth (hosted); frontend calls `signInWithEmailAndPassword`, backend verifies the ID token |
| Tenant-scoped login — subdomain → tenant | FR-AUTH-006 | ✅ `TenantResolutionMiddleware` (subdomain in prod, `X-Tenant-Subdomain` header in dev) |
| Predefined roles: Platform/Company Admin, HR Manager, Line Manager, Employee, Auditor | FR-RBAC-001 | ✅ `UserRole` enum + `@Roles()` + `RolesGuard` |
| Every endpoint validates tenant + role | FR-RBAC-004 | ✅ guard chain, applied per controller |
| Line Manager sees only direct/indirect reports | FR-RBAC-003 | 🟡 enforced in Employees; **permissive placeholder in Leave** |
| Account lockout after 5 failed attempts | FR-AUTH-005 | ✅ handled by Firebase Auth |
| JWT access + refresh rotation | FR-AUTH-004 | ➖ replaced — the Firebase ID token *is* the session, SDK-refreshed client-side; no server-minted tokens (see `CLAUDE.md`) |
| MFA (TOTP) for admin roles | FR-AUTH-002 | ➖ **cut for V1** — no MFA (documented decision) |
| Google / Azure AD SSO | FR-AUTH-003 | 🔴 deferred |
| Login audit log (IP, device, timestamp, outcome), 2-yr retention | FR-AUTH-008 | ✅ `LoginAuditEntry` (append-only) written on every `POST /api/auth/session` outcome the server can see (`SUCCESS`, `USER_INACTIVE`, `CLAIM_MISMATCH`, `TOKEN_EXPIRED`); read via `GET /api/access/audit?feed=login`. Retention purge job still TODO |
| Access-change trail (role change, activate/deactivate, reset, login created) | — | ✅ written to append-only `audit_log` (`access.*` actions, `metadata.module = "identity-access"`); read via `GET /api/access/audit?feed=access` |
| User administration (list logins, change role, activate/deactivate, send reset) | FR-RBAC-004 | ✅ `access` module — `@Roles`-gated + service-layer invariants (RULE-2 ceiling, keep ≥1 active Company Admin, no self-deactivation); Firebase claim + `disabled` flag kept in sync |
| Custom role builder / granular per-module permissions | FR-RBAC-002 | 🔴 deferred — roles are fixed for V1 |
| Approval delegation | FR-RBAC-005 | 🔴 deferred |

### Happy path

1. User visits `acme.hrms-platform.com` → frontend resolves tenant `acme`.
2. User enters email + password → frontend calls Firebase
   `signInWithEmailAndPassword` → gets an ID token.
3. Frontend `POST /api/auth/session` with `{ idToken }`.
4. Backend verifies the token (Firebase Admin SDK), reads the
   `tenantId` / `role` custom claims, confirms a matching active
   `public.users` row in the resolved tenant, returns the session user.
5. Frontend stores nothing secret — it holds the Firebase session and
   attaches `Authorization: Bearer <idToken>` (auto-refreshed by the SDK)
   to every API call.
6. On each request: `TenantResolutionMiddleware` sets `req.tenantId` →
   `JwtAuthGuard` verifies token → `TenantGuard` asserts
   `token.tenantId === req.tenantId` → `RolesGuard` checks `@Roles` →
   `TenantPrismaService` sets `app.current_tenant_id` → RLS filters rows.

### Functionalities / API

| Method | Path | Notes |
|---|---|---|
| `POST` | `/api/auth/session` | `@Public` — validate ID token, return session user; writes one append-only `LoginAuditEntry` per outcome |
| `GET` | `/api/auth/me` | current `AuthenticatedUser` from the token |
| `GET` | `/api/access/me` | signed-in user's own row + `tenantName` (My Account) — any tenant role |
| `GET` | `/api/access/users` | `@Roles(COMPANY_ADMIN, HR_MANAGER, AUDITOR)` — logins + linked employee + last successful sign-in |
| `PATCH` | `/api/access/users/:id/role` | `@Roles(COMPANY_ADMIN)` — RULE-2 ceiling; blocks demoting the last active Company Admin; syncs the Firebase `role` claim |
| `PATCH` | `/api/access/users/:id/status` | `@Roles(COMPANY_ADMIN, HR_MANAGER)` — no self-deactivation; keeps ≥1 active Company Admin; sets Firebase `disabled` + revokes refresh tokens on deactivate |
| `POST` | `/api/access/users/:id/password-reset` | `@Roles(COMPANY_ADMIN, HR_MANAGER)` — sends Firebase's hosted reset email via the Identity Toolkit REST API (`FIREBASE_WEB_API_KEY`) |
| `GET` | `/api/access/audit?feed=login\|access` | `@Roles(COMPANY_ADMIN, AUDITOR)` — sign-in outcomes / access-change trail; `outcome`/`action`/`from`/`to`/`q` filters |
| `GET` | `/api/access/users/:id/activity` | `@Roles(COMPANY_ADMIN, HR_MANAGER, AUDITOR)` — merged recent login + access-change feed for the detail drawer |

Custom claims (`tenantId`, `role`) are **set server-side** via the Admin
SDK when a user is created (tenant onboarding, employee-with-login
creation) and on every role change. Never trust a claim the client could set.

### Known gaps / TODO

- **`BAD_CREDENTIALS` sign-in failures are not recorded** — wrong
  password / unknown email is rejected entirely inside the Firebase client
  SDK and never reaches `POST /api/auth/session`, so the server can't log
  it. Decision (owner-approved): server-observed outcomes only for V1.
- **`TENANT_SUSPENDED` is not logged per-request** — it's rejected in
  `TenantResolutionMiddleware` before the session handler. Instead, one
  `tenant.status_changed` row is written to `platform_audit_log` on the
  operator's suspend/resume action (module 02).
- **Retention purge** — `LoginAuditEntry` has a 2-year retention
  requirement; the scheduled purge job is not built yet.
- Tighten the Line-Manager visibility placeholder in Leave (see §4).
- Decide if/when SSO (FR-AUTH-003) re-enters scope for the hospital pilot.

---

## 2. Platform Admin

**Deep spec:** `docs/modules/02_PLATFORM_ADMIN.md` ·
**UI prompt:** `docs/ui-build-prompts/02-platform-admin.md`
**Status:** ✅ core live · full operator console UI built (`/platform-admin/*`
— login, tenants list, new-tenant wizard, tenant detail w/ 4 tabs, audit
screen); `PlatformAuditLog` written for tenant create + status change · 🔴
plan-change / audit-read / break-glass backends pending
**Code:** `apps/api/src/platform-admin`, `apps/web/src/pages/platform-admin`
(`console.tsx` auth gate → `shell.tsx` + `tenants` / `tenant-new` /
`tenant-detail` / `audit` + `components/`, `lib/{types,plan-catalog,format,
platform-auth}`)

### Expectation

The founder's operator console. It is **structurally separate** from the
tenant app: its own `platform` Postgres schema, its own DB role
(`hrms_platform`) with **zero grants on `public`**, its own auth. It can
onboard tenants, enable/disable them, and see denormalized metadata
(name, plan, employee **count**, status) — it must **never** be able to
read tenant PII (employees, leave, payroll). Genuine support access is a
future logged, time-boxed break-glass flow, not a standing grant.

### Feature list

| Feature | V1 status |
|---|---|
| Platform-admin login (separate from tenant login) | ✅ Firebase, `type: platform_admin` claim, `PlatformJwtAuthGuard` |
| Create tenant (name, subdomain, plan, seats, first admin name+email) | ✅ `createTenant()` — creates `Tenant` + `Subscription` (seat ceiling per plan or override), seeds the Company Admin via the `hrms_app` connection with a **random password + a hosted password-reset email** (no operator-typed password); rolls back the tenant row if seeding fails |
| List tenants with subscription info | ✅ |
| Enable / suspend / set trial | ✅ `PATCH .../status` — `SUSPENDED` locks out every user of that tenant immediately at the resolution layer; carries an audit `reason` |
| Denormalized employee headcount per tenant | ✅ `refreshHeadcount()` writes `platform.tenants.employeeCount` (on-demand internal call; the `POST .../refresh-headcount` route is TODO) |
| Platform audit log | 🟡 written for `tenant.created` + `tenant.status_changed` (actor email, before/after, reason in `metadata`); other events + the read API pending |
| Operator console UI | ✅ full multi-screen console — see Status line |
| Billing / plan enforcement (seat limits, dunning) | 🔴 not started |
| Break-glass support access to tenant data | 🔴 not started (deliberate — design before building) |

### Happy path

1. Founder logs in at `/platform-admin` (Firebase, platform-admin project
   claim).
2. Opens "Tenants" → clicks **New tenant** → enters company name,
   subdomain, plan, and the first admin's email.
3. Backend creates `platform.tenants` + `platform.subscriptions`, then —
   over the `hrms_app` connection scoped to the new tenant — creates the
   `public.users` Company Admin row and sets their Firebase custom claims.
4. Founder shares the subdomain + tells the admin to do a password reset.
5. Later: founder can suspend a non-paying tenant → all its users get 403
   at `TenantResolutionMiddleware` on their next request.

### Functionalities / API

| Method | Path | Guard | State |
|---|---|---|---|
| `POST` | `/api/platform-admin/auth/session` | public | ✅ |
| `GET` | `/api/platform-admin/tenants` | `PlatformJwtAuthGuard` | ✅ |
| `POST` | `/api/platform-admin/tenants` | `PlatformJwtAuthGuard` | ✅ body `{companyName, subdomain, adminEmail, adminName, plan?, seats?}` — sends the admin a reset link; writes `tenant.created` |
| `PATCH` | `/api/platform-admin/tenants/:id/status` | `PlatformJwtAuthGuard` | ✅ body `{status, reason?}`; writes `tenant.status_changed` |
| `GET` | `/api/platform-admin/tenants/:id` | `PlatformJwtAuthGuard` | 🔴 TODO(api) |
| `PATCH` | `/api/platform-admin/tenants/:id/plan` | `PlatformJwtAuthGuard` | 🔴 TODO(api) |
| `POST` | `/api/platform-admin/tenants/:id/refresh-headcount` | `PlatformJwtAuthGuard` | 🔴 TODO(api) |
| `GET` | `/api/platform-admin/audit` | `PlatformJwtAuthGuard` | 🔴 TODO(api) |
| `POST` | `/api/platform-admin/tenants/:id/breakglass` | `PlatformJwtAuthGuard` | 🔴 TODO(api) — design first |

### Known gaps / TODO

- **Audit read API** — `GET /api/platform-admin/audit`. Rows are being
  written (`tenant.created`, `tenant.status_changed`); the console's Audit
  screen + tenant-detail Activity tab are built and degrade gracefully
  until this lands.
- **`PATCH /api/platform-admin/tenants/:id/plan`** — re-derive
  `enabledModules` / `seats` / `features`; write `tenant.plan_changed`.
  Change-plan dialog is built (calls it, handles 404).
- **`POST /api/platform-admin/tenants/:id/refresh-headcount`** — expose the
  existing `refreshHeadcount()` as a route; also a scheduled BullMQ job.
- **`GET /api/platform-admin/tenants/:id`** — detail endpoint (the console
  currently falls back to filtering the list).
- **Break-glass** — the whole flow (`BreakGlassGrant`, audited read-only
  tenant context, TTL). Console dialog + status sheet built as `TODO(api)`.
- Subscription lifecycle: seat counting vs plan, expiry → auto-suspend.
- Tighten `platform_audit_log` grants to true append-only (no
  `UPDATE`/`DELETE` for `hrms_platform`).

---

## 3. Employee Master + Org Structure

**Deep spec:** `docs/modules/03_EMPLOYEE_MASTER.md` ·
**UI prompt:** `docs/ui-build-prompts/03-employee-master.md`
**Status:** 🟡
**Code:** `apps/api/src/employees`, `apps/web/src/pages/employees`,
`apps/web/src/pages/org-chart.tsx`, `apps/web/src/pages/departments.tsx`

### Expectation

The single source of truth every other module references. An employee
record carries identity, employment, compensation-adjacent, statutory,
bank, and emergency-contact data; supports the employment lifecycle; and
supports documents. Reads are row-scoped by role (an Employee sees only
themselves; a Line Manager sees their reports). Bulk onboarding via Excel
must validate and report per-row rather than fail the batch.

### Feature list

| Feature | SRS | V1 status |
|---|---|---|
| Employee CRUD — personal + employment fields | FR-EMP-001/002 | ✅ |
| Bank account details for disbursement (a/c, IFSC, bank, type) | FR-EMP-003 | 🟡 fields present; **KMS field encryption not yet applied** |
| Emergency contact (name, relationship, phone, address) | FR-EMP-004 | ✅ |
| Document upload (PDF/JPG/PNG, ≤10MB) — offer letter, IDs, certs | FR-EMP-005 | 🟡 upload/list/download work; **MIME + size validation to confirm** (see §9) |
| Employee lifecycle states | FR-EMP-007 | 🟡 `EmploymentStatus` enum exists; SRS wants Pre-Joining / Probation / Confirmed / Notice / Separated — **verify enum matches** |
| Bulk import via Excel template + error report | FR-EMP-009 | 🟡 **API-only** (`POST /employees/bulk-import`); no frontend screen |
| Multi-level hierarchy (Company → BU → Dept → Team) | FR-ORG-001 | 🟡 Department + self-referential `reportingManagerId` only; no BU/Team levels |
| Interactive org chart — reporting lines, expand, search | FR-ORG-002 | 🟡 tree built in memory + rendered; search/expand polish TBD |
| Multiple reporting lines (solid + dotted) | FR-ORG-003 | 🔴 single `reportingManagerId` only |
| Org chart export PDF/PNG | FR-ORG-004 | 🔴 |
| No-code custom field builder | FR-EMP-008 | 🔴 deferred |

### Happy path (HR adds an employee)

1. HR Manager → **Employees** → **Add employee**.
2. Fills personal + employment details, picks a department and a
   reporting manager, optionally a linked login (role).
3. Submit → `POST /api/employees` → row created (RLS stamps `tenant_id`);
   if a login was requested, a `public.users` row + Firebase user +
   custom claims are created.
4. HR opens the new employee's detail page → **Documents** → uploads the
   signed offer letter → stored at
   `tenants/<tid>/employees/<eid>/<uuid>-<name>` in S3/MinIO, metadata in
   `public.documents`.
5. Employee later logs in and sees **only** their own record; their Line
   Manager sees them in their team list and the org chart.

### Happy path (bulk import)

1. HR downloads the `.xlsx` template (columns incl.
   `employeeCode`, `firstName`, `lastName` required).
2. `POST /api/employees/bulk-import` (multipart `file`).
3. Server parses with `exceljs`, inserts row-by-row, returns
   `[{ row, status: 'ok' | 'error', message }]`.
4. HR fixes the flagged rows and re-uploads only those.

### Functionalities / API

| Method | Path | Roles |
|---|---|---|
| `GET` | `/api/employees` | any (row-scoped by `scopeFor`) |
| `GET` | `/api/employees/:id` | any (row-scoped) |
| `GET` | `/api/employees/org-chart` | Admin / HR / Line Manager / Auditor |
| `POST` | `/api/employees` | Company Admin, HR Manager |
| `PATCH` | `/api/employees/:id` | Company Admin, HR Manager |
| `POST` | `/api/employees/bulk-import` | Company Admin, HR Manager |
| `GET` | `/api/employees/:id/documents` | any (tenant) |
| `POST` | `/api/employees/:id/documents` | Company Admin, HR Manager |
| `GET` | `/api/documents/:id/download-url` | any (tenant) — 5-min presigned URL |
| `GET` / `POST` | `/api/departments` | list: any · create: Admin / HR |

### Known gaps / TODO

- Frontend for bulk import (upload, template download, error table).
- Apply KMS field encryption to PAN + bank account before real data.
- Confirm `EmploymentStatus` covers all five SRS lifecycle states + add
  the transitions (e.g. Notice → Separated triggers FnF later).
- Document upload: enforce MIME allow-list + 10MB cap at the controller.
- Decide whether BU/Team hierarchy levels are V1 or deferred.

---

## 4. Leave Management

**Deep spec:** `docs/modules/04_LEAVE_MANAGEMENT.md` *(pending)* ·
**UI prompt:** `docs/ui-build-prompts/04-leave-management.md` ·
**API contract:** `docs/LEAVE_UI_SPECS.md`
**Status:** 🟡 — BE ~80%; FE being rebuilt role-by-role (UI-first, ahead of the
remaining BE). Progress + per-screen contract: `docs/LEAVE_UI_SPECS.md`.
**Code:** `apps/api/src/leave`, `apps/web/src/pages/leave`,
`apps/web/src/lib/leave` (typed client + fixture/mock layer — screens run
without the `planned` endpoints; `VITE_LEAVE_MOCK=false` switches to live)

### Expectation

Configurable leave types with quotas and carry-forward; per-employee
per-year balances; a multi-level approval workflow; balance deduction
only on final approval; and (eventually) a holiday calendar so day counts
are working-days, not raw calendar days. Approved leave must reconcile
with attendance and flag LOP when the balance is short.

### Feature list

| Feature | SRS | V1 status |
|---|---|---|
| Leave type definitions (CL/SL/EL/…); quota + carry-forward cap | FR-LVE-001 | 🟡 `LeaveType` has `annualQuota`, `carryForwardCap`; **gender restriction, accrual frequency, encashment, min-notice not modelled** (FR-LVE-002) |
| Per-employee per-year balances; init for a year | FR-LVE-004 | 🟡 `initializeYearlyBalances()` upserts; **no auto-accrual on a date, no mid-year proration** |
| Company holiday calendar (national + state optional) | FR-LVE-003 | 🔴 **not built** — `apply()` counts inclusive calendar days |
| Apply for leave (dates, type, reason, attachment) | FR-LVE-005 | 🟡 dates/type/reason ✅; **attachment not wired** |
| Multi-level approval (up to 4) + escalation timers | FR-LVE-006 | 🟡 **2 levels** (`PENDING_L1 → PENDING_L2 → APPROVED`); no escalation timers. No L1 manager ⇒ starts at L2 |
| Team calendar shown before submitting | FR-LVE-007 | 🟡 `GET /leave/calendar` exists; **no frontend screen consumes it** |
| Approved leave syncs to attendance; flags LOP | FR-LVE-008 | 🟡 `isLop` computed on apply; **no attendance sync** (Attendance module is young) |
| Comp-off credit for holiday/weekend work | FR-LVE-009 | 🔴 |
| Notifications (apply/approve/reject/expiry) | FR-LVE-010 | 🔴 (see §10) |
| Cancel — reverses an approved non-LOP deduction | — | ✅ `cancel()` |

**Scope cut:** day count is an *inclusive calendar-day* count (documented
in `apply()`), not working days — acceptable for demo, fix before a
paying customer runs payroll off it.

### Happy path (employee applies)

1. Employee → **Leave** → sees balances per type (`accrued − used`).
2. Clicks **Apply**, picks type + from/to dates + reason.
3. `POST /api/leave/requests` → server computes inclusive day count,
   compares to available balance, sets `isLop = true` if short (but still
   creates the request), routes to `PENDING_L1` (or `PENDING_L2` if the
   employee has no `reportingManagerId`).
4. Line Manager → **Leave** → **Pending approvals** → `POST
   .../requests/:id/approve` → status → `PENDING_L2`.
5. HR Manager approves → status → `APPROVED`; `adjustBalance()` deducts
   the days **only now**, and **only if** `!isLop`.
6. Employee sees the request as approved; balance reflects the deduction.
   If they later cancel, a non-LOP approved deduction is added back.

### Functionalities / API

| Method | Path | Roles |
|---|---|---|
| `GET` | `/api/leave/types` | any (tenant) |
| `POST` | `/api/leave/types` | Company Admin, HR Manager |
| `POST` | `/api/leave/types/:id/initialize/:year` | Company Admin, HR Manager |
| `GET` | `/api/leave/balances/:employeeId` | any (row-scoped) |
| `POST` | `/api/leave/requests` | any (tenant) |
| `POST` | `/api/leave/requests/:id/cancel` | any (owner) |
| `POST` | `/api/leave/requests/:id/approve` | Line Manager, HR Manager, Company Admin |
| `POST` | `/api/leave/requests/:id/reject` | Line Manager, HR Manager, Company Admin |
| `GET` | `/api/leave/requests/employee/:employeeId` | any (row-scoped) |
| `GET` | `/api/leave/requests/pending-approvals` | any (returns [] if not an approver) |
| `GET` | `/api/leave/calendar?from=&to=` | any (tenant) |

### Known gaps / TODO (priority order)

1. **Tighten `assertCanViewEmployee()` `LINE_MANAGER` branch** — currently
   permissive ("MVP scope"); must verify `reportingManagerId` chain.
   P1 before real customer data.
2. **Holiday calendar** — new `Holiday` table (tenant + date + optional +
   state); `apply()` counts working days.
3. Attachment upload on a leave request (reuse `StorageService`).
4. Team-calendar frontend on the apply screen.
5. Leave ↔ attendance reconciliation once Attendance matures (§5).
6. Richer `LeaveType` config (accrual frequency, gender, min notice,
   encashment) + scheduled accrual job (BullMQ).

---

## 5. Attendance & Time Tracking

**Status:** 🟡 — employee self-service only
**Code:** `apps/api/src/attendance`, `apps/web/src/pages/attendance`

### Expectation

Per-employee daily attendance from clock-in/out with breaks; a monthly
calendar + stats view; a regularisation (correction-request) workflow
with **manager approval within 7 days**; and month-end data that feeds
LOP into payroll. Manual marking by HR with an audit trail. Shifts and
overtime per state law. Biometric/GPS capture is **deferred**.

### Feature list

| Feature | SRS | V1 status |
|---|---|---|
| Clock-in / clock-out | — | ✅ `POST /attendance/clock-in`, `/clock-out` |
| Break start / end | — | ✅ `AttendanceBreak` rows |
| "Today" status card | FR-ESS-001 | ✅ `GET /attendance/today` |
| Monthly calendar (per-day status) | — | ✅ `GET /attendance/calendar?month=` |
| Monthly stats (present/absent/late/hours) | — | ✅ `GET /attendance/stats?month=` |
| Regularisation request (reason, subject to approval, 7-day window) | FR-ATT-009 | 🟡 employee can **create / list / cancel**; **no approver endpoint**, no 7-day enforcement |
| Manual attendance marking by HR + audit trail | FR-ATT-001 | 🔴 |
| Shift definitions (Fixed / Rotational / Flexible) | FR-ATT-006 | 🔴 — status logic assumes one implicit shift |
| Late-arrival / early-departure flags + grace period | FR-ATT-008 | 🟡 `AttendanceStatus` has a late value; grace period not configurable |
| Overtime calculation (state rates) | FR-ATT-007 | 🔴 |
| Month-end feed into payroll LOP | FR-ATT-010 | 🔴 (blocked on Payroll) |
| GPS geo-fenced check-in | FR-ATT-002 | 🔴 deferred |
| Biometric device (ZKTeco/eSSL) integration | FR-ATT-003 | 🔴 deferred (see `CLAUDE.md`) |
| Selfie / QR check-in | FR-ATT-004/005 | 🔴 deferred |

### Happy path (employee, today)

1. Employee → **Attendance** → **Clock in** (`POST /attendance/clock-in`)
   → an `AttendanceRecord` for today is opened; status computed
   (e.g. `PRESENT` / late).
2. Takes lunch → **Start break** / **End break** → `AttendanceBreak` rows;
   worked-hours exclude break time.
3. End of day → **Clock out** → record closed, total hours finalised.
4. Views the **calendar** for the month and the **stats** summary.

### Happy path (regularisation — partially built)

1. Employee forgot to clock in Tuesday → **Request regularisation** →
   picks the date, a `RegularizationReasonType`, and a note →
   `POST /attendance/regularization` → `RegularizationRequest` at
   `PENDING`.
2. *(Target, not built)* Their manager sees it in a pending queue and
   approves/rejects within 7 days; on approval the `AttendanceRecord` for
   that date is created/updated and the audit trail records who changed
   it.
3. Employee can `POST /attendance/regularization/:id/cancel` while it's
   still pending.

### Functionalities / API

| Method | Path |
|---|---|
| `POST` | `/api/attendance/clock-in` · `/clock-out` · `/break/start` · `/break/end` |
| `GET` | `/api/attendance/today` |
| `GET` | `/api/attendance/calendar?month=YYYY-MM` |
| `GET` | `/api/attendance/stats?month=YYYY-MM` |
| `POST` | `/api/attendance/regularization` |
| `GET` | `/api/attendance/regularization` |
| `POST` | `/api/attendance/regularization/:id/cancel` |

All routes are `JwtAuthGuard + TenantGuard` only (no `@Roles`) — every
route today is self-service for the calling employee.

### Known gaps / TODO (priority order)

> **Config foundation landed** (migration `20260905000001`): `shifts`,
> `holidays`, `attendance_settings`, `tenant_settings`, and the `punches`
> capture table now exist and are seeded with defaults on tenant creation.
> See `docs/TENANT_CONFIGURATION.md`. The items below are the wiring that
> consumes them.

1. **Refactor `attendance.service.ts`** to read the tenant's default
   `Shift` + `tenant_settings` (timezone, weekly-off days) instead of the
   hardcoded `SHIFT_START_HOUR` / `GRACE_MINUTES` / `TARGET_HOURS`
   constants.
2. **Punch write-path** — web clock-in writes `punches` rows (`source:
   WEB`); `attendance_records.checkInAt/checkOutAt` become first-IN /
   last-OUT derived values.
3. **Nightly finalization job** (BullMQ) — per employee/day: holiday →
   weekly-off → approved leave → punches ⇒ final status + hours. Clean
   days auto-final, no human.
4. **Regularisation approval** — `POST .../regularization/:id/approve` &
   `/reject` for `LINE_MANAGER` / `HR_MANAGER`; enforce
   `attendance_settings.regularizationWindowDays` +
   `regularizationMonthlyCap`; bulk-approve; **auto-resolve at payroll
   cut-off** per `unactionedBehavior`; write an audit row on every
   decision.
5. **Manager / HR views** — team roster for a day, pending regularisation
   queue, manual mark with reason (FR-ATT-001).
6. Overtime calculation (per-state rates) — needs the `Shift` end time,
   now available.
7. **Month-end LOP export contract for Payroll** —
   `getLopDays(employeeId, month)`; define the interface now so Payroll
   can build against it.
8. Per-tenant Settings screens + first-run setup wizard (frontend).
9. `POST /attendance/ingest` for biometric/CSV — per client, gated behind
   `subscription.features.biometricIntegration`.

---

## 6. Dashboard

**Status:** ✅
**Code:** `apps/api/src/dashboard`, `apps/web/src/pages/dashboard.tsx`

### Expectation

One role-aware home screen. The **server** decides what the user sees
(one endpoint, shaped by role) rather than the frontend assembling many
calls — keeps "what does an HR Manager see vs an Employee" in one place.

### Feature list

| Audience | Content | Status |
|---|---|---|
| Company Admin / HR Manager | Headcount, department breakdown, pending-approvals count | ✅ |
| Line Manager | Own leave balances + pending approvals from reports + recent requests | ✅ |
| Employee | Own leave balances, own pending items, 5 most recent leave requests | ✅ |
| Everyone | Attendance "today" summary, upcoming payslip date | 🔴 not on the dashboard yet (FR-ESS-001) |
| Admin | Payroll cost, attrition rate, avg tenure | 🔴 blocked on Payroll (FR-RPT-002/003) |

### Happy path

1. User logs in → lands on `/`.
2. `GET /api/dashboard` → server branches on `user.role`:
   admins get org aggregates; everyone else gets a personal view.
3. Cards render; "pending approvals" is non-empty for a Line Manager with
   reports awaiting L1.

### Functionalities / API

| Method | Path | Notes |
|---|---|---|
| `GET` | `/api/dashboard` | returns `{ view: 'admin' \| 'employee', ... }` |

### Known gaps / TODO

- Add an attendance snapshot + next-payslip date once those modules land.
- Add admin payroll/attrition tiles when Payroll + Reports exist.

---

## 7. Payroll Engine 🔴

**Status:** not started. **Highest-effort, highest-risk module — protect
its time budget over breadth elsewhere** (`CLAUDE.md`).
**Target code location:** `apps/api/src/payroll`

### Expectation

India-compliant monthly payroll: a configurable salary-structure builder,
statutory computation (EPF, ESI, PT, TDS), a **locked** processing cycle,
payslip PDFs, and a bank disbursement file. Two hard invariants:

- **Payroll is never processed twice for the same period** without
  explicit override **and** dual approval (FR-PAY intro).
- **Processed payroll runs are immutable event records — no in-place
  edits** (FR-PAY-018). Corrections are new adjusting entries.

### Feature list (all `[MUST]` unless noted)

**Salary structure**
- Component builder: Basic, HRA, Special Allowance, Conveyance, LTA,
  Medical, custom allowances, PF/ESI employer, gratuity provision
  (FR-PAY-001).
- Each component: fixed / % of Basic / % of CTC / formula (FR-PAY-002).
- Minimum Basic = 50% of CTC, configurable floor per company
  (FR-PAY-003).
- Salary revision history: effective date, revised CTC, reason, approver
  (FR-PAY-004).
- Auto-arrears on backdated revision (FR-PAY-005).

**Statutory computation**
- EPF on Basic+DA, ₹15,000 ceiling (configurable to opt above)
  (FR-PAY-006).
- State-specific Professional Tax slabs as admin-configurable lookup
  tables (FR-PAY-007).
- Annual taxable-income projection for TDS incl. declared investments
  (80C/80D/HRA/LTA) (FR-PAY-008).
- Old **and** New tax regime, employee choice per FY (FR-PAY-009).
- Re-compute TDS when projection changes mid-year (FR-PAY-010).

**Processing**
- Locked cycle: **Draft → Review → Approve → Process → Disbursed**
  (FR-PAY-011).
- Auto-import LOP days from Attendance for the pay period (FR-PAY-012) —
  depends on §5 exposing that.
- Ad-hoc payments: advance, bonus, incentive, gratuity payout
  (FR-PAY-013).
- Payslip PDF, password = employee DOB `DDMMYYYY` (FR-PAY-014).
- NEFT/RTGS bank file in HDFC/ICICI/SBI/Axis formats (FR-PAY-015).
- Full & Final settlement: unpaid salary, leave encashment, gratuity,
  advance recovery (FR-PAY-016).
- `[SHOULD]` Razorpay Payroll API disbursement + webhook (FR-PAY-017).
- Immutable run records (FR-PAY-018).

### Happy path (monthly run)

1. HR/Payroll Manager opens **Payroll → New run** for `2026-09`.
2. System assembles a **Draft**: each active employee's structure ×
   attendance (LOP) × statutory deductions × ad-hoc items.
3. Manager **Reviews** line items, fixes ad-hoc entries, re-runs
   calculation.
4. **Approve** — requires a second approver (dual approval) if this
   period was already processed once.
5. **Process** — run becomes immutable; payslip PDFs generated
   (DOB-locked); bank file generated.
6. **Disburse** — bank file downloaded (or Razorpay call); status →
   Disbursed; per-employee `NET_PAID` recorded.
7. Employees see the payslip in self-service; the amounts feed
   Compliance (§8) for ECR / challan / 24Q.

### Build notes

- `NUMERIC` everywhere; round per statute, not per float.
- Model a run as an append-only event stream (`PayrollRun` +
  `PayrollLineItem`, no updates after `PROCESSED`).
- Statutory rates/slabs/ceilings are **config tables**, never constants —
  the SRS explicitly wants Labour-Code rules as rule-engine config.
- Sequence per the blueprint's 12-week plan; do structure + statutory +
  single-run before FnF, arrears, and Razorpay.

---

## 8. Statutory Compliance 🔴

**Status:** not started. Table-stakes for the Indian market; filing
errors expose customers to penalties. **Generate files for portal upload
— do not build live e-filing APIs for V1** (`CLAUDE.md` deferred list).
**Target code location:** `apps/api/src/compliance`

### Expectation

Given a processed payroll period, produce the statutory artefacts as
downloadable files in the exact government formats, plus the
employee-facing investment-declaration workflow that feeds TDS.

### Feature list (all `[MUST]` unless noted)

**EPF**
- Monthly **ECR** text file in EPFO format (FR-CPL-001).
- UAN management + bulk UAN seeding (FR-CPL-002). *(Verification stays on
  the EPFO portal — see `CLAUDE.md` Aadhaar note.)*
- Form 2 (Nomination), Form 5 (joiners), Form 10 (leavers), Form 12A
  (monthly remittance summary) (FR-CPL-003).
- `[SHOULD]` EPFO Unified Portal API submission (FR-CPL-004) — deferred.

**ESI**
- Monthly ESI challan with correct contributions (FR-CPL-005).
- Half-yearly ESI return in ESIC format (FR-CPL-006).
- Track eligibility when gross crosses ₹21,000 (FR-CPL-007).

**Income Tax**
- Form 24Q quarterly TDS return with challan + employee-wise data
  (FR-CPL-008).
- Form 16 Part A + B, bulk PDF at FY end (FR-CPL-009).
- Investment declaration workflow — 80C/80D/HRA/LTA with proofs
  (FR-CPL-010).
- January proof-submission cycle, auto-adjust Q3/Q4 TDS on actual proofs
  (FR-CPL-011).

**POSH**
- ICC member management with term-expiry alerts (FR-CPL-012).
- Confidential complaint workflow — case number, status, 90-day timeline
  (FR-CPL-013).
- POSH Annual Report with complaint statistics (FR-CPL-014).
- `[SHOULD]` POSH training-completion tracking (FR-CPL-015).

### Happy path (monthly EPF/ESI)

1. Payroll for `2026-09` reaches **Disbursed**.
2. Compliance Manager → **Compliance → EPF → September 2026** →
   **Generate ECR**.
3. System reads the immutable payroll run, computes per-employee PF wages
   + contributions, writes the ECR text file in EPFO layout.
4. Manager downloads it, uploads to the EPFO portal, pays the challan,
   records the challan number back in the app (audit trail).
5. Same flow for the ESI challan; eligibility changes since last month
   are surfaced for review first.

### Happy path (investment declaration)

1. Start of FY: employee → **Tax → Declaration** → enters 80C/80D/HRA/LTA
   amounts → submitted.
2. Payroll's TDS projection (FR-PAY-008) uses declared amounts.
3. January: employee uploads **proofs**; Compliance verifies; verified
   amounts replace declared; Q4 TDS auto-adjusts.
4. FY end: **Generate Form 16** (bulk) — Part A from challan data, Part B
   from the annual computation.

### Build notes

- Every output is a **file in a government-specified format** — get real
  sample layouts before coding each one; they are unforgiving.
- Consumes only **processed** payroll data; never recomputes salary.
- Record every generated file + portal acknowledgement as an audit event.

---

## 9. Documents

**Status:** 🟡 — implemented **inside** Employee Master; no standalone
module.
**Code:** `apps/api/src/storage` (`StorageService`), document endpoints in
`apps/api/src/employees`.

### Expectation

Any file the platform stores goes to S3-compatible object storage under a
**tenant- and entity-prefixed key**, is recorded with metadata in
`public.documents`, and is only ever handed back to a client as a
**time-boxed presigned URL** — the API never returns a raw object key and
never lists a bucket.

### Feature list

| Feature | Status |
|---|---|
| Upload (S3/MinIO), key `tenants/<tid>/employees/<eid>/<uuid>-<name>` | ✅ |
| Metadata row in `public.documents` (label, size, content type, uploader) | ✅ |
| Download via 5-minute presigned URL | ✅ |
| MIME allow-list (PDF/JPG/PNG) + 10MB cap (FR-EMP-005) | 🟡 confirm/enforce at controller |
| Generic attachment host for other modules (leave proof, regularisation, investment proof) | 🔴 — generalise `documents` beyond employees |
| Virus/malware scan on upload | 🔴 |
| Retention / deletion policy | 🔴 |

### Happy path

Covered under §3 ("HR adds an employee" → step 4). Download: client calls
`GET /api/documents/:id/download-url` → gets a URL valid 5 minutes →
fetches the file directly from storage.

### Known gaps / TODO

- Promote to a small shared module so Leave (attachment), Attendance
  (regularisation evidence) and Compliance (proofs) reuse it instead of
  re-implementing upload.
- Enforce MIME + size; add a scan step (BullMQ job) before marking a
  document usable.

---

## 10. Notifications 🔴

**Status:** not started. **Target code location:**
`apps/api/src/notifications` (+ a BullMQ queue).

### Expectation

Asynchronous email (and later push) on workflow events, sent off a
queue — never inline in the request path.

### Feature list

| Trigger | SRS | Channel |
|---|---|---|
| Leave applied / approved / rejected / balance expiry | FR-LVE-010 | email (+ push later) |
| Leave status changes | FR-ESS-002 | push |
| Regularisation submitted / decided | FR-ATT-009 (implied) | email |
| Payslip available | FR-ESS-001 (implied) | email |
| Onboarding / overdue tasks | FR-ONB-005 | email — deferred module |
| Data-breach notice to DPO + affected employees within 72h | NFR-PRIV-005 | email |

### Happy path

1. A domain event occurs (e.g. leave approved).
2. The service enqueues a `notification.send` job (recipient, template,
   context) on Redis/BullMQ.
3. A worker renders the template and sends via the email provider;
   failures retry with backoff; each send is logged.

### Build notes

- Templates + a `notification_log` table from day one.
- Respect per-user preferences later; start with "always send" for the
  short list above.

---

## 11. Reports & Analytics 🔴 (10%)

**Status:** only the Dashboard aggregates exist. **Target code location:**
`apps/api/src/reports`.

### Expectation

Pre-built operational + statutory registers, exportable; org-wide metric
dashboards; later a custom report builder.

### Feature list

| Feature | SRS | Status |
|---|---|---|
| Headcount: active vs separated, joiners/leavers, dept-wise | FR-RPT-001 | 🟡 partial (Dashboard headcount + dept breakdown) |
| Payroll cost: monthly cost, CTC vs actual, dept-wise salary | FR-RPT-002 | 🔴 (needs Payroll) |
| Attrition: monthly rate, avg tenure, voluntary vs involuntary | FR-RPT-003 | 🔴 |
| Statutory registers: Salary, PF, ESI, Gratuity | FR-RPT-004 | 🔴 |
| `[SHOULD]` drag-drop custom report builder + scheduled email | FR-RPT-005 | 🔴 |
| `[SHOULD]` export PDF / XLSX / CSV everywhere | FR-RPT-006 | 🔴 |

### Happy path

1. Admin → **Reports** → picks a register (e.g. PF Register) + month.
2. System queries the relevant module data (Employee + Payroll), renders
   rows.
3. Admin exports to XLSX/CSV/PDF for filing or their accountant.

---

## 12. Audit Log 🟡 (15%)

**Status:** `AuditLog` (tenant) and `PlatformAuditLog` (platform) tables
exist in the schema; **nothing writes to them**.
**Code target:** an interceptor / service in `apps/api/src/audit` plus
call sites in each mutating service.

### Expectation

Append-only from day one — the app's DB role has **no `UPDATE`/`DELETE`**
grant on the audit tables (enforce in the roles/RLS migration if not
already). Every state-changing action records: actor, action, target,
before/after metadata, IP, timestamp.

### Must-cover write points

- Employee create / update / status change.
- Leave approve / reject / cancel.
- Attendance regularisation decision; manual mark.
- Tenant create / status change (→ `PlatformAuditLog`).
- Login outcomes (→ dedicated login audit, FR-AUTH-008).
- Payroll run state transitions; compliance file generation (when built).

### Happy path

An HR Manager updates an employee's salary → `EmployeesService.update()`
writes the row, then emits an audit entry `{ actor, action:
'employee.update', target: employeeId, before, after, ip }`. An Auditor
(read-only role) can later list the trail; no one can modify it.

---

## Cross-module dependency map

```
Employee Master ──┬─► Leave (employee, reporting manager)
                  ├─► Attendance (employee)
                  ├─► Payroll (salary structure, bank, DOB)
                  └─► Org chart / Dashboard

Attendance ──(month-end LOP)──► Payroll ──(processed run)──► Compliance
                                          └──► Reports (payroll cost)

Leave ──(approved days / LOP)──► Attendance ──► Payroll
Investment declaration ──► Payroll (TDS projection) ──► Compliance (Form 16/24Q)

Every mutation ──► Audit Log        Every workflow event ──► Notifications
```

Build order implication: **Payroll before Compliance**, and Attendance's
month-end LOP contract should be defined **before** Payroll starts so the
two can be built against a stable interface.

---

## Where to look

| You want… | Go to |
|---|---|
| Why a stack/architecture choice was made | `CLAUDE.md` |
| How a mechanism works, traced from source | `docs/BACKEND_ARCHITECTURE.md` |
| A module's one-page summary + happy path | this file |
| A module's **deep spec** — personas, flows, invariants, permission matrix, acceptance criteria | `docs/modules/NN_MODULE_NAME.md` |
| The prompt to build a module's UI (all personas, all screens) | `docs/ui-build-prompts/NN-module-name.md` |
| Where per-tenant config lives + who sets it | `docs/TENANT_CONFIGURATION.md` |
| The docs naming convention (which file is authoritative) | `docs/README.md` |
| Current known gaps in shipped modules | `docs/BACKEND_ARCHITECTURE.md` §8 + per-module "Known gaps" here + each deep spec's §9 |
