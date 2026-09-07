# 01 — Identity & Access (Auth · RBAC · Multi-tenancy) — Module Source of Truth

> **This file is the authoritative, detailed spec for further development of
> this module.** `docs/MODULE_SPECS.md` §1 is the one-page summary; this is
> the long form — personas, flows, technical + functional expectations,
> permission matrix, acceptance criteria.
>
> **Status:** ✅ auth / RBAC / tenant-isolation live and test-verified ·
> 🟡 login audit trail not wired (backend) · 🟡 access-management screens built
> against a mock client (`VITE_ACCESS_MOCK`) — `/api/access/*` endpoints pending ·
> 🟡 Line-Manager row-scoping permissive in Leave.
> **Progress:** ~90% (see `docs/MODULE_SPECS.md` status table — keep both in sync).
> **Code:** `apps/api/src/auth`, `apps/api/src/firebase`,
> `apps/api/src/common/{guards,decorators,tenancy}`, `apps/api/src/prisma`,
> `apps/web/src/lib/auth`, `apps/web/src/context/auth-context.tsx`,
> `apps/web/src/components/protected-route.tsx` (route guard),
> `apps/web/src/pages/access` + `apps/web/src/lib/access` (access-management UI).
> **Related:** `CLAUDE.md` (multi-tenancy decision, guard chain, security
> non-negotiables) · `docs/BACKEND_ARCHITECTURE.md` §2–4 (mechanism traced
> from source — **note:** its §3 still describes the pre-Firebase self-issued
> JWT/bcrypt/MFA stack and is stale; this file reflects the current Firebase
> decision) · `docs/TENANT_CONFIGURATION.md` (plan entitlements vs tenant config).
> **Last synced to code:** 2026-09-08.

---

## 1. Purpose & scope

Identity & Access is the module every request passes through before it can
reach any tenant data. It answers three questions on every call:

1. **Who is this?** — a valid, unexpired Firebase ID token.
2. **Which tenant are they acting in, and are they allowed there?** — the
   token's `tenantId` custom claim must match the tenant the request landed
   on (subdomain), and the user must exist and be active in that tenant.
3. **May they do this action?** — their `role` custom claim must satisfy the
   route's `@Roles(...)`, and service-layer scoping must allow the specific
   rows.

**In scope:** tenant login (Firebase hosted), platform-admin login (separate
Firebase project/claim), subdomain→tenant resolution, the request guard
chain, Postgres Row-Level Security (RLS) session-variable wiring, the fixed
V1 role set, service-layer row scoping, and the (not-yet-built) login audit
log.

**Out of scope / deferred** (do not build without a scope discussion —
`CLAUDE.md` → "Explicitly deferred"): MFA/TOTP, SSO (Google / Azure AD),
custom role/permission builder, approval-delegation, SCIM provisioning,
API keys / service accounts, session-device management UI.

---

## 2. User personas & their role in this module

The six V1 personas (`CLAUDE.md` → "Roles"). This module **defines** them;
every other module consumes them.

| Persona | Why they touch this module | What they can do here | What they cannot do |
|---|---|---|---|
| **Platform Admin** (founder/operator) | Owns tenant creation and the platform-admin login. Structurally separate — own Firebase project, own DB role, `type: platform_admin` claim. | Log in to the operator console; create tenants; set a tenant's first Company Admin; suspend/resume a tenant (locks out all its users). Their claims are managed outside the tenant app. | Cannot log in to any tenant app; cannot read tenant PII; cannot self-assign a tenant role. |
| **Company Admin** | The tenant's own top-level administrator. The only tenant persona that can grant or change logins and roles for other users in their tenant. | Log in; view/manage which employees have a login and what role each holds; deactivate a user's access; trigger a password reset for a user; see the tenant's login/access audit trail (when built). | Cannot change their own tenant's plan entitlements (Platform Admin only); cannot create custom roles (fixed set in V1); cannot see other tenants. |
| **HR Manager** | Provisions logins as a side-effect of onboarding employees (Employee Master creates a linked `User` + Firebase user + claims). | Log in; create an employee **with** a linked login (choosing a role at or below HR Manager); send a password-reset link; deactivate a leaver's login. | Cannot grant `COMPANY_ADMIN`; cannot edit the audit log; cannot change another user's role after creation without Company Admin (V1 rule — see §6). |
| **Line Manager** | Consumer only — needs a login and the `LINE_MANAGER` role so downstream modules can scope "my team". | Log in; refresh their own session. | No user-administration capability. |
| **Employee** | Consumer only — the base authenticated persona. | Log in; reset their own password (Firebase hosted flow); view their own session/profile identity. | Cannot see or change any role; cannot see other users' access. |
| **Auditor** (read-only) | Reviews the access-control posture: who has which role, recent logins, role changes. | Log in; **read** the user list, role assignments, and the login/access audit trail. | Every mutating control is absent — no create/edit/deactivate/reset, forms render disabled. |

### How each persona actually uses it

- **Platform Admin** never appears inside a tenant. They authenticate against
  a separate Firebase project; their token carries `type: platform_admin` and
  **no** `tenantId`, so it can never satisfy the tenant guard chain. See
  module `02_PLATFORM_ADMIN.md`.
- **Company Admin** is the escalation point for anything role-related. In V1
  there is no self-service "invite user" flow independent of Employee Master —
  a login is always attached to an employee record. Company Admin's unique
  power is **changing an existing user's role** and **granting
  `COMPANY_ADMIN`**.
- **HR Manager** creates most logins, but only up to their own privilege
  ceiling. The role dropdown at employee-creation time excludes
  `COMPANY_ADMIN` for an HR Manager actor.
- **Line Manager / Employee** interact with this module only through the
  login screen and the silent token refresh the Firebase SDK performs. Their
  "identity" is read by every other module via `useAuth()` /
  `@CurrentUser()`.
- **Auditor** gets a full read of the access posture and the trail, and
  nothing else. Treat any Auditor write attempt as a bug.

---

## 3. Functional expectations (definition of done)

1. **Tenant-scoped login.** A user at `acme.hrms-platform.com` who signs in
   with valid credentials for an **active** `acme` user reaches the app;
   the same credentials on `globex.hrms-platform.com` are rejected.
2. **Cross-tenant isolation is layered and each layer is independently
   sufficient for its job:** (a) subdomain↔claim cross-check, (b)
   service-layer row scoping, (c) Postgres RLS. A bug in any one layer alone
   must not leak another tenant's rows. The adversarial suite
   (`test/tenant-isolation.e2e-spec.ts`) is the definition of done and a
   **P0 gate** — a regression here is a P0 incident, not a bug.
3. **Fail closed.** No resolved tenant ⇒ request rejected before the DB.
   No RLS session var ⇒ queries return **zero rows**, never all rows.
4. **Claims are server-authoritative.** `tenantId` and `role` are set only
   via the Firebase Admin SDK, server-side, at user creation / role change.
   A claim the client could set is never trusted.
5. **Suspending a tenant is immediate.** A `SUSPENDED` tenant's users get
   403 at the resolution layer on their **next request**, not just next login.
6. **Role changes take effect on next token refresh** (≤ 1 h, or immediately
   if the user re-authenticates) — acceptable for V1; document the window.
7. **Deactivating a user** blocks their next request even with a still-valid
   token (the `users` row is checked, not just the token).
8. **Every login outcome is recorded** — success and failure, with IP,
   user-agent, tenant, timestamp, reason — retained 2 years. *(Not yet
   built — highest-value gap; see §9.)*
9. **The app's Postgres role never has `BYPASSRLS`** and never connects as
   the migration/owner role at runtime.

---

## 4. Technical design

### 4.1 Request pipeline (order matters)

```
Request
  │
  ├─ TenantResolutionMiddleware        (pre-auth; every route except platform-admin/*)
  │     • subdomain (prod) or X-Tenant-Subdomain header (dev) → tenant
  │     • looks up platform.tenants via the hrms_platform connection ONLY
  │     • 404 if unknown subdomain · 403 if tenant SUSPENDED
  │     • sets req.tenantId, req.tenantSubdomain, req.tenantStatus
  │
  ├─ JwtAuthGuard                      (Firebase ID token verification)
  │     • verifies signature + expiry via Firebase Admin SDK
  │     • @Public() routes skip this (login/session), but still tenant-scoped
  │     • req.user = { uid, tenantId, role, email, employeeId? }  (from claims)
  │
  ├─ TenantGuard                       (the cross-check)
  │     • rejects unless req.user.tenantId === req.tenantId
  │     • also re-asserts the tenant is ACTIVE and the users row is active
  │     • this is what stops a valid Tenant-A token replayed at Tenant-B
  │
  ├─ RolesGuard                        (static RBAC)
  │     • if handler has @Roles(...), req.user.role must be in the list
  │     • no decorator ⇒ any authenticated tenant user
  │
  └─ TenantPrismaService.client        (RLS backstop)
        • wraps every op in a txn:
          SELECT set_config('app.current_tenant_id', '<tenantId>', TRUE);
          <query>
        • tenantId comes only from req.tenantId — unforgeable
        • RLS policy on every public.* table:
          USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
        • FORCE ROW LEVEL SECURITY on every table (owner not exempt)
```

### 4.2 Below the guard — service-layer row scoping

Guards express "which roles"; they cannot express "own data only" / "own
reports only". That lives in services, e.g. `EmployeesService.scopeFor(user)`:

```ts
EMPLOYEE     → { id: user.employeeId }
LINE_MANAGER → { OR: [{ id: user.employeeId }, { reportingManagerId: user.employeeId }] }
default      → {}   // Company Admin / HR / Auditor — unrestricted within RLS
```

This is ordinary same-tenant authorization (an Employee must not see a
colleague's salary) layered **on top of** RLS, not instead of it.

> **Known gap:** `LeaveService.assertCanViewEmployee()`'s `LINE_MANAGER`
> branch is a permissive placeholder — it does not yet verify the
> `reportingManagerId` chain. P1 before real customer data. See §9 and
> module `04_LEAVE_MANAGEMENT.md`.

### 4.3 Identity data model

**`platform` schema** (reachable only by `hrms_platform`):
- `Tenant` — `id`, `name`, `subdomain` (unique), `status`
  (`ACTIVE|SUSPENDED|TRIAL`), denormalized `employeeCount`.
- `Subscription` — `plan`, `seats`, `enabledModules`, `features`, `renewsAt`.
- `PlatformAdminUser` — operator identity (Firebase uid + metadata).
- `PlatformAuditLog` — append-only by convention (see module 12).

**`public` schema** (reachable only by `hrms_app`, every row carries
`tenantId` + RLS):
- `User` — auth identity for a tenant person: `id`, `tenantId`, `firebaseUid`
  (unique), `email`, `role` (`UserRole` enum), `isActive`, optional 1:1
  `employeeId` → `Employee`. `@@index([tenantId])`, `@@unique([tenantId, email])`.
- `UserRole` enum — `COMPANY_ADMIN · HR_MANAGER · LINE_MANAGER · EMPLOYEE ·
  AUDITOR` (no `PLATFORM_ADMIN` here — that persona is not a tenant row).
- **`LoginAuditEntry`** *(TODO — not in schema yet)* — `id`, `tenantId`,
  `email`, `userId?`, `outcome` (`SUCCESS|BAD_CREDENTIALS|USER_INACTIVE|
  TENANT_SUSPENDED|CLAIM_MISMATCH`), `ip`, `userAgent`, `at`. Append-only
  (no `UPDATE`/`DELETE` grant for `hrms_app`), 2-year retention.

### 4.4 API surface

| Method | Path | Guard | Notes |
|---|---|---|---|
| `POST` | `/api/auth/session` | `@Public` (tenant-scoped) | Body `{ idToken }`. Verifies the Firebase token, reads `tenantId`/`role` claims, confirms an active `public.users` row in the resolved tenant, returns the session user. Writes a `LoginAuditEntry` (TODO). |
| `GET` | `/api/auth/me` | `JwtAuthGuard` + `TenantGuard` | Current `AuthenticatedUser` from the token + `users` row. |
| `POST` | `/api/auth/logout` | `JwtAuthGuard` | Client-side Firebase sign-out; server records the event (TODO audit). |
| `GET` | `/api/access/users` | `@Roles(COMPANY_ADMIN, HR_MANAGER, AUDITOR)` | List tenant users: email, role, linked employee, `isActive`, last login. *(TODO — thin wrapper over `users` + audit.)* |
| `PATCH` | `/api/access/users/:id/role` | `@Roles(COMPANY_ADMIN)` | Change role. HR Manager cannot call this in V1. Sets the Firebase custom claim + updates the row + audit. *(TODO.)* |
| `PATCH` | `/api/access/users/:id/status` | `@Roles(COMPANY_ADMIN, HR_MANAGER)` | Activate / deactivate a login. *(TODO — today handled implicitly via employee lifecycle.)* |
| `POST` | `/api/access/users/:id/password-reset` | `@Roles(COMPANY_ADMIN, HR_MANAGER)` | Trigger the Firebase hosted reset email. *(TODO.)* |
| `GET` | `/api/access/audit` | `@Roles(COMPANY_ADMIN, AUDITOR)` | Login + role-change trail, filterable. *(TODO — depends on `LoginAuditEntry`.)* |

Custom claims (`tenantId`, `role`, and for the operator `type:
platform_admin`) are **set server-side via the Admin SDK** at user creation
(tenant onboarding, employee-with-login creation) and at role change. Never
trust a claim the client could set.

### 4.5 Frontend

- `apps/web/src/lib/auth` — Firebase client init, `useAuth()` →
  `{ user: { role, employeeId, email, uid }, loading }`, silent token
  refresh, `Authorization: Bearer <idToken>` on every `api.*` call.
- `apps/web/src/lib/roles.ts` — role predicates (`isAdmin`, `canManageUsers`,
  `atLeast(role)`), used for nav filtering and control gating.
- Route guards in `apps/web/src/components/protected-route.tsx` —
  unauthenticated → login. Wrong-persona / `SUSPENDED` full-page states are
  handled in `apps/web/src/pages/login.tsx` + `components/auth/*` today.
- Login screens: tenant split-panel "Lumen" design and a separate
  platform-admin login (already redesigned — see recent commits). The
  in-app **password reset** is the `AuthResetPanel` on the same screen
  (Firebase `sendPasswordResetEmail`).
- **Access management** (`apps/web/src/pages/access`, `apps/web/src/lib/access`):
  - `/access` — tabbed page, nav-gated to `COMPANY_ADMIN` / `HR_MANAGER` /
    `AUDITOR`.
    - **Users** tab — stat tiles, search + role + status filters, CSV export,
      table (email · linked employee · role · auth status · last sign-in),
      row `dropdown-menu` actions, 25/page pagination. Row → **User Detail**
      slide-over (`components/user-detail-sheet.tsx`) with a merged recent-
      activity feed. Footer/actions gated: Company Admin gets **Change role**
      + **Deactivate/Reactivate** + **Send reset**; HR Manager drops Change
      role; Auditor gets no mutating control.
    - **Audit** tab (`COMPANY_ADMIN`, `AUDITOR`) — sub-tabs **Sign-in
      activity** (`LoginAuditEntry`, outcome-coded) and **Access changes**
      (`AccessAuditEntry`), date/outcome/action filters, CSV export,
      append-only read-only.
  - `/account` — **My Account** for every authenticated persona: read-only
    identity card + "Change my password" (self-serve Firebase reset).
    "Sign out everywhere" is shown disabled (planned).
  - Role predicates: `apps/web/src/lib/roles.ts` — `canViewAccessModule`,
    `canManageUsers`, `canChangeUserRole`, `canReadAudit`, `assignableRoles`
    (RULE-2 ceiling).
  - **All mutations run through `apps/web/src/lib/access/client.ts` behind
    `VITE_ACCESS_MOCK` (default on)** — fixture store mirrors the server
    rules (privilege ceiling, keep ≥1 active Company Admin, no self-
    deactivation) so the screens round-trip before the API exists.

### 4.6 Configuration & environment

- `TENANT_RESOLUTION_MODE` = `subdomain` (prod) | `header` (dev).
- Two runtime DB URLs: `TENANT_DATABASE_URL` (`hrms_app`, `NOBYPASSRLS`) and
  `PLATFORM_DATABASE_URL` (`hrms_platform`, zero grants on `public`); a third
  connection string for `prisma migrate deploy` only.
- Firebase: tenant project + separate platform-admin project; Admin SDK
  service-account credentials server-side only.

---

## 5. Core flows

### 5.1 Tenant user logs in (happy path)

1. User visits `acme.hrms-platform.com` → SPA resolves tenant `acme`
   (subdomain; `X-Tenant-Subdomain: acme` in dev).
2. User enters email + password → SPA calls Firebase
   `signInWithEmailAndPassword` → receives an ID token (claims already set
   server-side at provisioning).
3. SPA `POST /api/auth/session` with `{ idToken }`.
4. Backend: verify token → read `tenantId` / `role` claims → assert
   `claims.tenantId === req.tenantId` → confirm an **active** `public.users`
   row for that `firebaseUid` in `acme` → return the session user →
   write a `SUCCESS` `LoginAuditEntry` *(TODO)*.
5. SPA stores nothing secret; the Firebase SDK holds the session and
   auto-refreshes the token. Every API call carries
   `Authorization: Bearer <idToken>`.
6. Each subsequent request runs the full pipeline in §4.1.

### 5.2 Login failure paths (all must record an audit entry — TODO)

| Situation | Result |
|---|---|
| Wrong password / unknown email | Firebase rejects client-side; SPA shows a generic "invalid credentials" (no account-existence leak). No server call. |
| Valid Firebase user, but `tenantId` claim ≠ subdomain | `POST /api/auth/session` → 403 `CLAIM_MISMATCH`. |
| Valid user, `isActive = false` | 403 `USER_INACTIVE`. |
| Tenant `SUSPENDED` | 403 `TENANT_SUSPENDED` at `TenantResolutionMiddleware` — before auth even runs. |
| Token expired mid-session | SDK refreshes silently; if refresh fails (user disabled in Firebase), SPA routes to login. |

### 5.3 HR Manager creates an employee with a login

1. HR Manager → Employee Master → **Add employee**, fills details, ticks
   **Create login**, picks a role (dropdown excludes `COMPANY_ADMIN` for an
   HR actor).
2. `POST /api/employees` (see module 03) → in one flow: create `Employee`
   row → create Firebase user → set `tenantId` + `role` custom claims via
   Admin SDK → create linked `public.users` row (`isActive = true`).
3. HR shares the subdomain; the new user does a hosted password reset on
   first sign-in.
4. Audit: `user.created` + `role.assigned` entries *(TODO)*.

### 5.4 Company Admin changes a user's role

1. Company Admin → **Access › Users** → row → **Change role**.
2. `PATCH /api/access/users/:id/role` → update `users.role` → set the new
   Firebase custom claim → write `role.changed { before, after, actor }` to
   the audit log *(TODO)*.
3. New role is effective on the user's **next token refresh** (≤ 1 h) or
   immediately on re-login. The UI tells the admin this.

### 5.5 Company Admin deactivates a leaver

1. Employee Master lifecycle transition to `SEPARATED` (module 03) →
   cascades here: `users.isActive = false` and the Firebase user is disabled.
2. Any existing token fails at `TenantGuard`'s active-user re-check on the
   next request; token refresh fails at the SDK.

### 5.6 Auditor reviews access posture

1. Auditor → **Access › Users** (read-only list) and **Access › Audit**
   (login outcomes + role changes, filter by user / outcome / date).
2. No mutating controls render. `GET /api/access/users`, `GET /api/access/audit`.

---

## 6. Business rules & invariants

- **INV-1** — `hrms_app` is `NOBYPASSRLS`; the runtime app never connects as
  the owner/migration role. Enforced in migration `20260101000002_roles_and_rls`.
- **INV-2** — `hrms_platform` has zero grants on `public` (not even `USAGE`).
- **INV-3** — `app.current_tenant_id` is set only from `req.tenantId` /
  `req.user.tenantId`, inside the same transaction as the query.
- **INV-4** — a request with no resolved tenant is rejected before any DB
  access; a query with no RLS var set returns zero rows.
- **RULE-1** — `role` and `tenantId` claims are set only by the server
  (Admin SDK). Any client-supplied claim is ignored.
- **RULE-2** — privilege ceiling: an actor may only assign a role ≤ their
  own. Only `COMPANY_ADMIN` may assign `COMPANY_ADMIN`. HR Manager caps at
  `HR_MANAGER`.
- **RULE-3** — exactly one persona type per token. A `platform_admin` token
  has no `tenantId`; a tenant token has no `type: platform_admin`. Cross-use
  fails by construction.
- **RULE-4** — role set is **fixed** for V1 (`CLAUDE.md`). No custom roles,
  no per-module permission flags, no delegation.
- **RULE-5** — deactivation is checked on every request against the `users`
  row, so it does not wait for token expiry.
- **RULE-6** — login audit entries are append-only; `hrms_app` holds no
  `UPDATE`/`DELETE` grant on that table.

---

## 7. States

**Tenant:** `TRIAL → ACTIVE ⇄ SUSPENDED` (Platform Admin sets; see module 02).
`SUSPENDED` blocks all tenant traffic at resolution.

**User (`public.users`):** `ACTIVE ⇄ INACTIVE`. `INACTIVE` set on employee
`SEPARATED`, or manually by Company Admin / HR. Reactivation restores access
+ re-enables the Firebase user.

**Session:** held entirely by the Firebase SDK client-side; server is
stateless per request. No server session store to expire.

---

## 8. Permission matrix

| Capability | Platform Admin | Company Admin | HR Manager | Line Manager | Employee | Auditor |
|---|:--:|:--:|:--:|:--:|:--:|:--:|
| Log in to a tenant app | — | ✅ | ✅ | ✅ | ✅ | ✅ |
| Log in to the operator console | ✅ | — | — | — | — | — |
| View tenant user list + roles | — | ✅ | ✅ | — | — | ✅ (read) |
| Create a login (via Employee Master) | — | ✅ | ✅ (≤ HR_MANAGER) | — | — | — |
| Change an existing user's role | — | ✅ | — | — | — | — |
| Grant `COMPANY_ADMIN` | — | ✅ | — | — | — | — |
| Activate / deactivate a login | — | ✅ | ✅ | — | — | — |
| Trigger a password reset for another user | — | ✅ | ✅ | — | — | — |
| Reset own password (hosted flow) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Read the login / access audit trail | — | ✅ | — | — | — | ✅ (read) |
| Suspend / resume a tenant | ✅ | — | — | — | — | — |

---

## 9. Known gaps / TODO (priority order)

1. **Login audit log** (functional exp. #8) — **backend still open.** Add
   `LoginAuditEntry` table + append-only grant + write on every
   `POST /api/auth/session` outcome (success and every failure code), with
   IP + user-agent + tenant. 2-year retention. **Highest-value gap.** Feeds
   module 12 and the Auditor screens. *(The Auditor/Admin UI for it is built —
   `apps/web/src/pages/access` `Audit` tab — reading a fixture store until
   this lands.)*
2. **Tighten Line-Manager row scoping in Leave** — replace the permissive
   `assertCanViewEmployee()` `LINE_MANAGER` branch with a real
   `reportingManagerId`-chain check. P1 before real customer data.
3. **Access-management API** — `GET /api/access/users`, `PATCH .../role`,
   `PATCH .../status`, `POST .../password-reset`, `GET /api/access/audit`.
   **Screens done** (`apps/web/src/pages/access`, built to this contract
   behind `VITE_ACCESS_MOCK`); the NestJS `access` module is the remaining
   work — flip the mock flag off once it exists. Today role/login management
   is still only a side-effect of Employee Master server-side.
4. **Role-change propagation window** — document (and surface in the UI) the
   ≤ 1 h claim-refresh delay; consider a force-refresh signal later.
5. **Update `docs/BACKEND_ARCHITECTURE.md` §3** — it still documents the
   removed self-issued-JWT/bcrypt/MFA/refresh-cookie stack. Rewrite to the
   Firebase model to keep the traced reference honest.
6. **Decide SSO re-entry** for the hospital pilot (`FR-AUTH-003`) — currently
   deferred; hospitals often require Azure AD.

---

## 10. Dependencies

**Upstream (this module needs):**
- `platform.tenants` / `platform.subscriptions` — created by module 02.
- Firebase projects (tenant + platform-admin) and Admin SDK credentials.

**Downstream (modules that need this):**
- **Every** tenant module — consumes `req.user` (`role`, `employeeId`,
  `tenantId`) and relies on the guard chain + RLS.
- Module 03 Employee Master — creates linked `users` rows + Firebase users.
- Module 12 Audit Log — consumes login outcomes and role-change events.
- Module 06 Dashboard — branches entirely on `req.user.role`.

---

## 11. Acceptance criteria / test checklist

- [ ] `test/tenant-isolation.e2e-spec.ts` green: logged in as Tenant A, every
      read/write against Tenant B's data fails (404/403/zero-rows) at each
      layer independently. **P0 gate.**
- [ ] `test/auth.e2e-spec.ts` green: valid login, expired token, claim
      mismatch (A token at B), inactive user, suspended tenant.
- [ ] A query executed with no `app.current_tenant_id` set returns zero rows
      (not an error, not all rows).
- [ ] `hrms_app` cannot `SELECT` from `platform.*`; `hrms_platform` cannot
      `SELECT` from `public.*`.
- [ ] Suspending a tenant 403s an already-authenticated user's next request.
- [ ] Deactivating a user 403s their next request with a still-valid token.
- [ ] HR Manager cannot assign `COMPANY_ADMIN` (API rejects, UI hides it).
- [ ] Every `POST /api/auth/session` outcome writes exactly one append-only
      audit entry (once #9.1 lands).

---

## 12. Open questions / decisions needed

- **Role-change latency** — is ≤ 1 h acceptable long-term, or do we need a
  server-pushed token-revocation on role change?
- **Break-glass** — when a support engineer needs tenant access, does that
  identity live here or entirely in module 02's break-glass flow? (Current
  plan: module 02.)
- **Auditor scope** — should Auditor see *failed* login emails (possible PII
  / enumeration concern) or only aggregate failure counts?
- **SSO** — if the hospital pilot needs Azure AD, does it federate through
  Firebase, or do we add a parallel OIDC path?
