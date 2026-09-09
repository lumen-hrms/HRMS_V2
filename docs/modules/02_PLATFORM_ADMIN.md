# 02 — Platform Admin (Operator Console) — Module Source of Truth

> **This file is the authoritative, detailed spec for further development of
> this module.** `docs/MODULE_SPECS.md` §2 is the one-page summary.
>
> **Status:** ✅ tenant onboarding (hosted reset-link email — no
> operator-typed password) / enable-disable / metadata live ·
> ✅ full operator console UI (`/platform-admin/*`: login, tenants list,
> new-tenant wizard, tenant detail w/ 4 tabs, **Plans catalog**, audit
> screen) · ✅ **operator-editable `platform.plans`** (pricing / seats /
> modules / features / isolation tier) with snapshot-at-assign +
> re-snapshot-on-renewal; `PATCH .../plan` + `POST .../renew` live ·
> 🟡 `PlatformAuditLog` written for create / status / plan-change / renewal /
> plan-edit — read API pending · 🔴 refresh-headcount route · 🔴 billing /
> seat enforcement · 🔴 break-glass.
> **Progress:** ~96% of the intended V1 slice (see `docs/MODULE_SPECS.md`).
> **Code:** `apps/api/src/platform-admin`, `apps/api/src/prisma`
> (`PlatformPrismaClientProvider`), `apps/web/src/pages/platform-admin`
> (`console.tsx` gate → `shell.tsx` + `tenants`/`tenant-new`/`tenant-detail`/
> `audit` + `components/` + `lib/`).
> **Related:** `CLAUDE.md` ("Platform Admin is structurally separate") ·
> `docs/BACKEND_ARCHITECTURE.md` §2.5–2.6, §3, §5 ·
> `docs/TENANT_CONFIGURATION.md` (layer 1 = plan entitlements, set here) ·
> module `01_IDENTITY_AND_ACCESS.md`.
> **Last synced to code:** 2026-09-09 (operator plan catalog: platform.plans + Plans screen, snapshot/renewal model, PATCH .../plan + POST .../renew).

---

## 1. Purpose & scope

The founder's own operator console for running the SaaS: create tenants,
control their lifecycle, and see the denormalized metadata needed to
operate the business — **without any technical ability to read tenant PII.**

The load-bearing design point (`CLAUDE.md`): this is **not a role inside the
tenant app**. It has its own Postgres schema (`platform`), its own DB role
(`hrms_platform`) with **zero grants on `public`**, its own Firebase project,
and its own auth guard (`PlatformJwtAuthGuard`). "Even the founder can't
casually see tenant data" is enforced by Postgres refusing the query, not by
an application `if`.

**In scope (V1):** platform-admin login; create tenant + seed first Company
Admin; list tenants with subscription info; enable / suspend / set-trial;
denormalized headcount; plan/entitlement assignment (layer 1 of
`TENANT_CONFIGURATION.md`).

**In scope (next):** platform audit log writes; subscription lifecycle (seat
counting vs plan, expiry → auto-suspend); logged, time-boxed **break-glass**
support access.

**Out of scope / deferred:** self-serve tenant signup, billing provider
integration (Razorpay/Stripe), usage metering, multi-operator RBAC within the
console, per-tenant feature-flag UI beyond plan defaults, dunning emails.

---

## 2. User personas & their role in this module

| Persona | Relationship to this module | What they can do | What they cannot do |
|---|---|---|---|
| **Platform Admin** (founder / operator) | The **only** persona with access. Separate identity store (`platform.platform_admin_users`), separate Firebase project, `type: platform_admin` token claim, no `tenantId`. | Everything in §1: onboard tenants, set plan, suspend/resume, read denormalized metadata, (next) initiate break-glass, read the platform audit log. | Cannot open any tenant app; cannot query `public.*` (the DB connection physically cannot); cannot read employee / leave / payroll data; cannot silently enter a tenant (break-glass is logged + time-boxed). |
| **Company Admin** | *Product* of this module — created here as a tenant's first login — but has **no access** to the console. | — (interacts only by receiving their seeded login and, later, being affected by a suspend/resume). | Cannot see the console, other tenants, or platform metadata. |
| **HR Manager / Line Manager / Employee** | None. Never aware this module exists. | — | — |
| **Auditor** (tenant) | None here. The **platform** audit trail is read by the Platform Admin, not a tenant Auditor. A tenant Auditor only ever sees their own tenant's `AuditLog`. | — | — |
| **(future) Support Engineer** | A future sub-persona of Platform Admin operating the **break-glass** flow: a logged, time-boxed, reason-carrying grant of read access to one tenant. Not a standing role. | Request → (approve) → time-boxed scoped read of one tenant, every action audited; access auto-expires. | No standing access; no write; no bulk/multi-tenant access. |

### How the Platform Admin actually uses it

- **Onboarding a pilot customer:** create the tenant (name, subdomain,
  plan), enter the customer admin's email; the system provisions the tenant
  rows *and* — over a correctly-scoped `hrms_app` connection, never
  `hrms_platform` — seeds the first `COMPANY_ADMIN` `users` row and sets its
  Firebase claims. Hand the customer their subdomain; they self-serve a
  password reset.
- **Operating:** glance at the tenant list — plan, status, employee
  **count**, renewal date — to see who's on trial, who's near a seat limit,
  who hasn't paid. Suspend a non-paying tenant (locks out every one of its
  users immediately); resume on payment.
- **Supporting:** when a customer reports "leave balance looks wrong", the
  operator cannot just look. They open a **break-glass** request with a
  reason and a short TTL; the grant is audited; it expires automatically.
  *(Flow not built yet — design before building.)*

---

## 3. Functional expectations (definition of done)

1. **Structural isolation holds.** `hrms_platform` has zero grants on
   `public` — verified by test. The console cannot read tenant PII under any
   code path.
2. **Onboarding is atomic-ish.** Creating a tenant creates `Tenant` +
   `Subscription`, then seeds the first Company Admin. **If seeding the admin
   fails, the tenant row is rolled back** — no tenant is left where nobody
   can log in.
3. **Suspend is immediate and total.** `PATCH .../status` → `SUSPENDED`
   locks out every user of that tenant at `TenantResolutionMiddleware` on
   their next request.
4. **Metadata is denormalized, never joined.** Name, plan, employee
   **count**, status live in `platform.tenants` — the console never joins
   into a PII table.
5. **Every operator action is audited.** Tenant create, status change, plan
   change, break-glass grant/use — actor, action, target, before/after,
   timestamp — to `PlatformAuditLog` (append-only). *(Not yet written — see §9.)*
6. **Plan entitlements are authoritative for module availability.**
   `Subscription.enabledModules` / `features` is layer 1 of
   `TENANT_CONFIGURATION.md`; tenant-side config cannot enable a module the
   plan doesn't include.
7. **Break-glass, when built:** no standing access; time-boxed; reason
   required; every action within the window audited; auto-revoked at expiry.

---

## 4. Technical design

### 4.1 Isolation mechanism (from `BACKEND_ARCHITECTURE.md` §2.5–2.6)

| Role | Used by | Grants |
|---|---|---|
| migration/owner role | `prisma migrate deploy` only | owns all objects; never used at runtime |
| `hrms_app` | all tenant business queries | CRUD on `public.*` only; `NOBYPASSRLS` |
| `hrms_platform` | this module | CRUD on `platform.*` only; **zero grants on `public`, not even `USAGE`** |

The **one deliberate exception**: `PlatformAdminService.seedCompanyAdmin()`
and `.refreshHeadcount()` need to write a new tenant's `public.users` /
read a count. They do **not** use `hrms_platform` — they use the
`hrms_app`-backed `TenantPrismaClientProvider`, scoped to the one new tenant
via `withTenantContext()`, exactly like a normal request. So `hrms_platform`
itself never touches `public`; the exception is a correctly-scoped second
connection, not a privilege escalation.

### 4.2 Auth (parallel to tenant auth, never shared)

| | Platform admin |
|---|---|
| Identity table | `platform.platform_admin_users` |
| Login endpoint | `POST /api/platform-admin/auth/session` |
| Token discriminator | `type: 'platform_admin'` claim required; **no `tenantId`** |
| Guard | `PlatformJwtAuthGuard` only (no tenant concept, no `TenantGuard`) |
| Resolution middleware | **skipped** for `platform-admin/*` routes |

A platform-admin token can never satisfy the tenant guard chain (no
`tenantId` to match a subdomain); a tenant token can never satisfy
`PlatformJwtStrategy` (no `type: platform_admin`). Cross-use fails by
construction.

### 4.3 Data model (`platform` schema)

- **`Tenant`** — `id`, `name`, `subdomain` (unique, lowercase, DNS-safe),
  `status` (`ACTIVE|SUSPENDED|TRIAL`), `employeeCount` (denormalized),
  `createdAt`, `createdByAdminId`.
- **`Subscription`** — `tenantId` (1:1), `plan`
  (`STARTER|GROWTH|ENTERPRISE|PILOT`), `seats` (int), `enabledModules`
  (string[]), `features` (jsonb — e.g. `{ biometricIntegration: false }`),
  `status` (`TRIALING|ACTIVE|PAST_DUE|CANCELLED`), `trialEndsAt`, `renewsAt`.
- **`PlatformAdminUser`** — `id`, `firebaseUid` (unique), `email`, `name`,
  `isActive`, `createdAt`.
- **`PlatformAuditLog`** — `id`, `actorAdminId`, `action`
  (`tenant.created|tenant.status_changed|tenant.plan_changed|
  breakglass.requested|breakglass.used|breakglass.expired`), `targetTenantId`,
  `before` (jsonb), `after` (jsonb), `ip`, `at`. **Append-only** —
  `hrms_platform` must have no `UPDATE`/`DELETE` grant on it (enforce in the
  roles migration; see module 12).
- **`BreakGlassGrant`** *(TODO — not in schema)* — `id`, `adminId`,
  `tenantId`, `reason`, `grantedAt`, `expiresAt`, `revokedAt`,
  `accessCount`. The tenant-side reads it performs run over a special
  audited, read-only, time-boxed `hrms_app` context.

### 4.4 API surface

| Method | Path | Guard | Notes |
|---|---|---|---|
| `POST` | `/api/platform-admin/auth/session` | `@Public` | `{ idToken }` from the platform-admin Firebase project; verifies `type: platform_admin`. |
| `GET` | `/api/platform-admin/tenants` | `PlatformJwtAuthGuard` | List: name, subdomain, status, plan, seats, `employeeCount`, `trialEndsAt`, `renewsAt`. |
| `POST` | `/api/platform-admin/tenants` | `PlatformJwtAuthGuard` | `createTenant()` — `Tenant` + `Subscription`, then seed first Company Admin via the `hrms_app` connection; **rollback the tenant on seed failure**. |
| `GET` | `/api/platform-admin/tenants/:id` | `PlatformJwtAuthGuard` | Detail + subscription + recent platform-audit entries for this tenant. |
| `PATCH` | `/api/platform-admin/tenants/:id/status` | `PlatformJwtAuthGuard` | `ACTIVE` / `SUSPENDED` / `TRIAL`. Enforced at resolution layer → immediate lockout. Audit. |
| `PATCH` | `/api/platform-admin/tenants/:id/plan` | `PlatformJwtAuthGuard` | Change `plan` → re-derive `enabledModules` / `seats` / `features`. Audit. *(TODO — partial.)* |
| `POST` | `/api/platform-admin/tenants/:id/refresh-headcount` | `PlatformJwtAuthGuard` | `refreshHeadcount()` writes `employeeCount`. *(Also runs on a schedule — TODO.)* |
| `GET` | `/api/platform-admin/audit` | `PlatformJwtAuthGuard` | Platform audit trail, filterable by tenant / action / date. *(TODO — depends on writes.)* |
| `POST` | `/api/platform-admin/tenants/:id/breakglass` | `PlatformJwtAuthGuard` | Open a time-boxed, reason-carrying read grant. *(TODO — design first.)* |

### 4.5 Frontend

`apps/web/src/pages/platform-admin` behind `apps/web/src/routes/platform`
route guards (platform-admin token required; a tenant token → 403). Separate
login screen (already redesigned — split-panel). Screens: Tenants list,
New-tenant wizard, Tenant detail, (next) Audit log, (next) Break-glass.

### 4.6 Configuration

- `PLATFORM_DATABASE_URL` — `hrms_platform` role.
- Separate Firebase project for platform admins; Admin SDK credentials for
  both projects server-side.
- Plan → entitlement mapping table (code or `platform` config) — the source
  for `enabledModules` / `seats` / `features` on plan assignment.

---

## 5. Core flows

### 5.1 Onboard a tenant (happy path)

1. Platform Admin → **Tenants** → **New tenant**.
2. Enters: company name, subdomain (validated: lowercase, DNS-safe, unique),
   plan, first admin's email (+ name).
3. `POST /api/platform-admin/tenants`:
   a. Create `platform.tenants` + `platform.subscriptions` (plan →
      `enabledModules`/`seats`/`features`).
   b. Over the **`hrms_app`** connection scoped to the new `tenantId`
      (`withTenantContext`): create the `public.users` `COMPANY_ADMIN` row;
      create the Firebase user in the tenant project; set `tenantId` +
      `role` custom claims.
   c. If (b) throws → delete the `platform.tenants` row and report failure.
   d. On success → write `PlatformAuditLog { action: 'tenant.created' }`
      *(TODO)*.
4. Platform Admin shares `acme.hrms-platform.com`; the customer admin runs a
   hosted password reset and logs in.
5. `TENANT_CONFIGURATION.md` layer-2 setup wizard runs on that first login
   (tenant-side).

### 5.2 Suspend / resume a tenant

1. **Tenants** → row → **Suspend** (confirm modal, reason).
2. `PATCH .../status { status: 'SUSPENDED', reason }` → `platform.tenants.status`
   updated → audit entry.
3. Effect: `TenantResolutionMiddleware` now returns 403 for every request to
   that subdomain — existing sessions included, next request.
4. **Resume**: `PATCH .../status { status: 'ACTIVE' }` → access restored;
   audit entry.

### 5.3 Change a tenant's plan

1. **Tenant detail** → **Change plan** → pick plan → confirm.
2. `PATCH .../plan` → re-derive `enabledModules` / `seats` / `features` on
   `Subscription`; audit `{ before, after }`.
3. Tenant-side: modules removed by the new plan stop resolving (guarded by
   the entitlement check — `TENANT_CONFIGURATION.md`); a lowered seat count
   surfaces a warning if headcount already exceeds it (does not delete data).

### 5.4 Headcount refresh

- On demand from Tenant detail, **and** on a schedule (BullMQ, e.g. hourly):
  `refreshHeadcount()` counts `public.employees` (over `hrms_app`, per
  tenant) and writes `platform.tenants.employeeCount`. Never a live join
  from the console.

### 5.5 Break-glass support access *(TODO — target flow)*

1. Support engineer (a Platform Admin) opens **Break-glass** for tenant X,
   enters a reason and a TTL (e.g. 60 min). `POST .../breakglass`.
2. *(Optional second-operator approval — decide in §7.)*
3. A `BreakGlassGrant` row is written; audit `breakglass.requested`.
4. Within the window, a dedicated **read-only, audited** tenant context lets
   the engineer view (not mutate) the specific tenant's data; every read is
   audited `breakglass.used`.
5. At `expiresAt` (or manual revoke) the grant is dead; audit
   `breakglass.expired`.

---

## 6. Business rules & invariants

- **INV-1** — `hrms_platform` never gains any grant on `public`. The only
  path from this module into `public` is the `hrms_app`-backed, per-tenant
  `withTenantContext()` used by `seedCompanyAdmin` / `refreshHeadcount`.
- **INV-2** — no tenant is ever persisted without a working Company Admin
  login (rollback on seed failure).
- **INV-3** — `subdomain` is immutable after creation in V1 (changing it
  breaks every user's bookmark and the resolution contract). Deferred:
  a rename flow.
- **INV-4** — `PlatformAuditLog` is append-only (no `UPDATE`/`DELETE` grant).
- **RULE-1** — plan/entitlements set here are the ceiling; tenant config
  (layer 2) can only narrow, never widen.
- **RULE-2** — `SUSPENDED` is a full stop, not a soft flag: no read, no
  write, no login for that tenant.
- **RULE-3** — the console shows **counts and metadata only**; if a screen
  ever needs a tenant's employee *names*, that is a design smell — revisit.
- **RULE-4** — break-glass is never standing: TTL required, reason required,
  fully audited, auto-expiring.

---

## 7. States

**Tenant lifecycle:** `TRIAL → ACTIVE ⇄ SUSPENDED`; `ACTIVE → CANCELLED`
(*TODO* — with a data-retention / export window before deletion).

**Subscription:** `TRIALING → ACTIVE → PAST_DUE → (ACTIVE | CANCELLED)`.
`PAST_DUE` past a grace period → auto `SUSPENDED` tenant (*TODO*).

**Break-glass grant:** `REQUESTED → ACTIVE → (EXPIRED | REVOKED)` (*TODO*).

---

## 8. Permission matrix

| Capability | Platform Admin | Any tenant persona |
|---|:--:|:--:|
| Access the operator console | ✅ | — |
| Create a tenant | ✅ | — |
| Suspend / resume a tenant | ✅ | — |
| Change a tenant's plan / seats | ✅ | — |
| See tenant metadata (name, plan, count, status) | ✅ | — |
| See tenant PII (employees, leave, payroll) | **— (structurally impossible)** | n/a |
| Read the platform audit log | ✅ | — |
| Initiate break-glass into a tenant | ✅ (logged, time-boxed) | — |

---

## 9. Known gaps / TODO (priority order)

**Closed** since the last sync:
- ✅ **Operator console UI** — full multi-screen console at `/platform-admin/*`
  (login, tenants list + stat tiles + filters, 3-section new-tenant wizard,
  tenant detail with 4 tabs, operator audit screen), on the real design
  system. `apps/web/src/pages/platform-admin`.
- ✅ **Onboarding via reset link** — `createTenant` seeds the Company Admin
  with a random password + a hosted password-reset email (no operator-typed
  temp password). `adminName` → Firebase `displayName`; `seats` overridable
  per plan.
- ✅ **`PlatformAuditLog` writes** for `tenant.created`,
  `tenant.status_changed`, `tenant.plan_changed`, `subscription.renewed`,
  `subscription.price_adjusted`, `plan.updated` (actor email, before/after,
  reason in `metadata`).
- ✅ **Operator-editable plan catalog** (`platform.plans`, migrations
  `20260909120000_plan_catalog` + `20260909130000_per_seat_pricing`) —
  Plans screen + `GET`/`PATCH /plans`. `entitlements.ts` stays as the seed
  + fallback. **Snapshot model:** a `Subscription` carries its own
  `enabledModules` / `features` / `seats` / `pricePerSeat` /
  `isolationTier`; editing a plan never mutates a live one. New tenants
  snapshot the current plan; `POST /tenants/:id/renew` re-snapshots (adds
  modules the plan gained, drops ones it lost, **keeps the tenant's seat
  count AND negotiated per-seat rate**). `PATCH /tenants/:id/plan` moves a
  tenant + fresh snapshot (resets the rate to the new plan's list price).
- ✅ **Per-seat pricing + per-tenant negotiation** (migration
  `20260909130000_per_seat_pricing`) — a `Plan` carries `listPricePerSeat`
  (per seat / month); a `Subscription` snapshots a **negotiated**
  `pricePerSeat` (defaults to list, operator tunes per deal at onboarding).
  **Effective monthly = `pricePerSeat × seats`**, computed at display, never
  stored. `PATCH /tenants/:id/pricing` `{pricePerSeat?, seats?, reason}` is
  the negotiation lever — adjusts commercials with no plan change
  (`subscription.price_adjusted` audit). Still a stored reference figure —
  no billing engine.

**Still open:**

1. **`GET /api/platform-admin/audit`** (read API) — rows are written; the
   console's Audit screen + tenant-detail Activity tab degrade gracefully
   until it lands. Also: `headcount.refreshed` write + enforce append-only
   in the roles migration (`hrms_platform` has no `UPDATE`/`DELETE` on
   `platform_audit_log` yet).
2. **Subscription lifecycle** — seat counting vs `seats`; `trialEndsAt` /
   `renewsAt` handling; `PAST_DUE` → grace → auto-suspend (BullMQ scheduled
   job).
3. **Scheduled headcount refresh** (BullMQ) so `employeeCount` isn't only
   on-demand.
4. **Break-glass flow** — schema (`BreakGlassGrant`), the audited read-only
   tenant context, TTL enforcement, the console screens. **Design before
   building** (`CLAUDE.md`).
5. **Scheduled renewal job** (BullMQ) — `renewSubscription()` is a manual
   operator action today; a job should process `renewsAt` and re-snapshot
   on the due date. (Also: seat counting vs `seats`, `PAST_DUE` →
   auto-suspend.)
6. **Tenant detail screen** — subscription, headcount history, per-tenant
   audit slice, danger zone (suspend / cancel).
7. **Subdomain rename** flow (deferred) — needs a redirect + claim-refresh
   story.
8. **Dedicated-DB tenant tier** (`CLAUDE.md` → "Multi-tenancy", Tier 2) —
   provisioning a database-per-tenant for enterprise / regulated customers
   is a platform-admin flow: create the DB, `prisma migrate deploy` against
   it, seed defaults, record the datasource on the tenant record. Also
   needs the fan-out migration runner (shared DB + every dedicated DB) and
   the per-tenant connection registry. **Design target — not built.**
   Blocked on the `tenant → datasource` lookup indirection landing in
   `TenantPrismaService` first.

---

## 10. Dependencies

**Upstream:** Firebase (platform-admin project) · the roles/RLS migration
(`hrms_platform` grants) · module 01 (`withTenantContext`, Admin SDK claim
setting).

**Downstream:**
- Module 01 — reads `platform.tenants` at resolution; `SUSPENDED` gate.
- `TENANT_CONFIGURATION.md` — `Subscription.enabledModules`/`features` is
  layer 1; the tenant-side entitlement guard reads it.
- Module 12 Audit Log — `PlatformAuditLog` is its platform half.
- Every module — availability gated by the plan set here.

---

## 11. Acceptance criteria / test checklist

- [ ] Test: `hrms_platform` cannot `SELECT` / `INSERT` / `USAGE` on any
      `public.*` object.
- [ ] Create-tenant seeds a working Company Admin who can log in immediately.
- [ ] Create-tenant with a forced seed failure leaves **no** `platform.tenants`
      row.
- [ ] Duplicate subdomain is rejected with a clear error.
- [ ] Suspending a tenant 403s an already-authenticated tenant user's next
      request.
- [ ] A platform-admin token is rejected by every tenant route; a tenant
      token is rejected by every `platform-admin/*` route.
- [ ] Every tenant create / status change writes exactly one append-only
      `PlatformAuditLog` row (once #9.1 lands).
- [ ] Lowering `seats` below current headcount warns but does not delete or
      block existing employees.

---

## 12. Open questions / decisions needed

- **Break-glass approval** — single operator with reason + TTL, or require a
  second operator's approval for grants over N minutes?
- **Break-glass surface** — read via a hidden read-only mirror of the tenant
  UI, or a purpose-built "support view" with a deliberately narrow field set?
- **Tenant cancellation** — retention window, self-service export, hard
  delete timing (DPDP considerations).
- **Multi-operator** — will there ever be more than one Platform Admin? If
  so, do they need differentiated permissions (billing-only vs full)?
- **Plan model** — are `PILOT` tenants a distinct plan or `TRIAL` status on a
  real plan?
