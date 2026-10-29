# Tenant Configuration — how one platform serves many tenants

> **Audience:** developers touching onboarding, settings, attendance, leave,
> or payroll. This is the model for *where per-tenant rules live* and *who
> sets them*. Read `CLAUDE.md` (multi-tenancy) and `docs/MODULE_SPECS.md`
> (per-module contracts) alongside it. For the module-shaped view (personas,
> permission matrix, acceptance criteria) see `docs/modules/13_TENANT_CONFIGURATION.md` —
> this file stays the primary reference for the mechanism itself.
>
> **Status:** 2026-09-18 — **100%**, and module 05 (Attendance), the main
> consumer of this config, reached 100% the same day too — the nightly
> finalization job and regularization-approval enforcement that used to be
> listed here as "module 05's gap" are built. Schema + onboarding defaults
> + seed, the `EntitlementGuard` (Layer 1 enforcement),
> `attendance.service.ts` reading `Shift`/`TenantSettings` instead of
> hardcoded constants, in-app Settings screens (shift catalogue CRUD +
> attendance/general settings), and — since 2026-10-29 — a **mandatory
> full-screen company setup** (replacing the old skippable wizard) are all
> live. See "Company setup" and "Build status" below.

---

## The three layers

Mixing these up is the classic multi-tenant mistake. Keep them separate.

| Layer | Question it answers | Stored in | Set by | When |
|---|---|---|---|---|
| **1. Plan entitlements** | *What is this tenant allowed to use?* | `platform.subscriptions` (`enabled_modules`, `features`) | **Platform operator (founder)** | Onboarding; re-derived on plan change |
| **2. Tenant business config** | *How do this tenant's HR rules work?* | `public.*` config tables (RLS-scoped) | **Company Admin, in-app** | Company setup (mandatory) on first login; editable anytime |
| **3. Per-employee override** | *Does this person differ from the tenant default?* | `public.employees.shift_id` (more later) | Tenant HR | Per employee / group |

Rule of thumb: *"Is Payroll available?"* / *"Can they connect a biometric
device?"* → **Layer 1 (plan)**. *"Is the work day 8h or 9h? 5-day or
6-day week?"* → **Layer 2 (tenant settings)**. Never put layer-2 rules in
the plan or ask them at onboarding.

---

## Layer 1 — Plan entitlements

**Source of truth:** `apps/api/src/platform-admin/entitlements.ts`
(`PLAN_ENTITLEMENTS` map). Derived from `subscription.plan` at onboarding
and written to two columns on `platform.subscriptions`:

- `enabled_modules: string[]` — which modules the tenant may use.
  Values: `CORE_HR` (always on), `LEAVE`, `ATTENDANCE`, `PAYROLL`, `COMPLIANCE`.
- `features: jsonb` — capability flags:
  `biometricIntegration`, `customRoles`, `apiAccess`.

| Plan | Modules | Features |
|---|---|---|
| `TRIAL` / `STARTER` | CORE_HR, LEAVE | — |
| `GROWTH` | + ATTENDANCE, PAYROLL | — |
| `ENTERPRISE` | + COMPLIANCE | biometricIntegration, customRoles, apiAccess |

**Onboarding:** `CreateTenantDto.plan` (`STARTER` \| `GROWTH` \|
`ENTERPRISE`, default `STARTER`) drives this. Tenant `status` still starts
`TRIAL` regardless — status and plan are orthogonal.

**Built:** `EntitlementGuard` (`apps/api/src/common/guards/entitlement.guard.ts`)
blocks a route when the tenant's `Subscription.enabledModules` doesn't
include the module named by a `@RequiresModule(...)` decorator, or
`Subscription.features` doesn't have a flag named by `@RequiresFeature(...)`
set to `true`. Wired onto `LeaveController` (`@RequiresModule('LEAVE')`) and
`AttendanceController` (`@RequiresModule('ATTENDANCE')`) — both sit in the
guard chain after `JwtAuthGuard`/`TenantGuard` (needs `request.user.tenantId`)
and query `platform.subscriptions` directly (that table isn't on the
tenant-scoped Prisma client). No decorator on a route = no check, same
opt-in shape as `RolesGuard`. `@RequiresFeature('biometricIntegration')` is
ready for the future punch-ingest endpoint whenever that's built.

---

## Layer 2 — Tenant business config

All RLS-scoped `public` tables, seeded with working defaults on tenant
creation (`PlatformAdminService.seedTenantRows`, mirrored in
`prisma/seed.ts`) so a new tenant functions before anyone opens Settings.

### `tenant_settings` (one row per tenant)

| Field | Default | Meaning |
|---|---|---|
| `timezone` | `Asia/Kolkata` | Wall-clock shift times + "today" boundaries resolve against this |
| `weekly_off_days` | `[0, 6]` | Days of week off. `0` = Sunday … `6` = Saturday. `[0,6]` = 5-day week |
| `payroll_cutoff_day` | `25` | Day of month the payroll period locks — the hard deadline the attendance/regularization auto-resolve flow hangs on |
| `leave_approval_levels` | `2` | Leave approval chain depth (1 or 2 for V1) |

A **6-day week** is `weekly_off_days = [0]` (Sunday only). "2nd & 4th
Saturday off" is a later enhancement — needs a small pattern type, not a
flat day list.

### `shifts` (catalogue — one or more per tenant)

| Field | Default (seeded "General" shift) | Meaning |
|---|---|---|
| `name` | `General` | Unique per tenant |
| `type` | `FIXED` | `FIXED` \| `FLEXI` (flexi-start + core hours) \| `ROTATIONAL` (roster-assigned) |
| `start_time` / `end_time` | `09:00` / `18:00` | Wall-clock `HH:MM`, tenant timezone |
| `grace_minutes` | `15` | Late only after start + grace |
| `min_hours_full_day` | `8.00` | Below this → half-day / absent |
| `min_hours_half_day` | `4.00` | |
| `core_start_time` / `core_end_time` | `null` | FLEXI shifts: window that must be covered |
| `is_default` | `true` for "General" | The fallback for employees with no `Employee.shift_id`. Exactly one per tenant |

**This replaces the hardcoded `SHIFT_START_HOUR` / `GRACE_MINUTES` /
`TARGET_HOURS` constants in `attendance.service.ts`.** `resolveShift()`
resolves `Employee.shiftId` (layer 3 override) if set, else the tenant's one
`isDefault` shift (seeded at onboarding); `clockIn()`'s late/on-time call and
`today()`'s `targetHours` (progress-ring goal) both read from the resolved
shift now, not a constant.

### `holidays`

`{ date, name, is_optional }`, unique on `(tenant, date, name)`. **Shared
by Leave and Attendance** — Leave's working-day count and Attendance's
daily-status engine both read this. Seed adds Republic Day / Independence
Day / Gandhi Jayanti for demo tenants; real tenants manage their own via
Settings.

### `attendance_settings` (one row per tenant)

| Field | Default | Meaning |
|---|---|---|
| `mode` | `SELF_SERVICE` | `SELF_SERVICE` (web clock-in, startup) \| `ROSTER` (roster + device punches, clock-in button hidden) \| `OFF` (leave-only / trust-based) |
| `capture_methods` | `[WEB]` | Accepted punch channels. Frontend hides the clock-in button when `WEB` is absent |
| `regularization_window_days` | `7` | Employee must raise a correction within N days |
| `regularization_monthly_cap` | `3` | Max regularizations per employee per month |
| `unactioned_behavior` | `AUTO_APPROVE` | At payroll cut-off, requests a manager never actioned are `AUTO_APPROVE` (lenient) or `AUTO_REJECT` (strict) |

---

## Layer 3 — Per-employee override

`Employee.shift_id` (nullable FK → `shifts`, `ON DELETE SET NULL`).
`NULL` ⇒ the tenant's `is_default` shift. Hospital rota staff get a
`ROTATIONAL` shift assigned here; desk staff inherit the default. Later:
`Employee.work_week_override`, and a `ShiftAssignment` table (employee ×
date) for true rotational rostering in `ROSTER` mode.

---

## The capture abstraction (`punches`)

The bit that makes *"start with web punching, drop in a machine webhook
later"* real without a rewrite.

```
web "Clock in"  ─┐
biometric webhook ┼─►  public.punches  ──►  nightly finalization  ──►  attendance_records
CSV import       ─┘   { at, direction,      (holiday → weekly-off →      (daily rollup:
manual (HR)      ─┘     source, deviceId,     approved leave → punches)     status, hours)
                        rawRef }
```

- **`punches`** is the source of truth: `{ employeeId, at, direction
  (IN/OUT), source (WEB/BIOMETRIC/GPS/IMPORT/MANUAL), deviceId?, rawRef? }`.
- **`attendance_records`** stays as the per-day rollup;
  `check_in_at`/`check_out_at` become a denormalized convenience (first
  IN / last OUT), not the primary record.
- Integrating a device for a client = implement `POST /attendance/ingest`
  (authed by a per-tenant device key), map their payload to `punches`
  rows — a small job — gated behind `features.biometricIntegration`.

**Current state:** the `punches` table exists; nothing writes to it yet.
The existing web clock-in still writes `attendance_records` directly. The
finalization job and the punch write-path are the next slice.

---

## Onboarding flow

1. **Platform operator** creates the tenant with a `plan` →
   `entitlementsForPlan(plan)` populates `subscription.enabled_modules` +
   `features`. First Company Admin is seeded (existing flow).
2. `seedTenantRows(tenantId, …)` writes the admin's `users` row,
   `tenant_settings` + `attendance_settings` + the default `General` shift
   + payroll settings/PT slabs, all in one transaction.
3. **Company Admin**, on first login, completes **company setup** (below).
   Until it's submitted nobody in the workspace can use the app.

---

## Company setup (mandatory first run)

`apps/api/src/setup` + `apps/web/src/pages/setup`. Replaces the old
skippable wizard (owner decision, 2026-10-29): setup must be complete so
there's no half-configured tenant.

**The gate.** No `tenant_setups` row, or `completed_at` null, means setup is
incomplete. `JwtAuthGuard` reads the row with its per-request user lookup;
`TenantGuard` then answers **403 `SETUP_INCOMPLETE`** on every route except
`/api/setup/*`, `/api/auth/*` and `/api/access/me` — for every role, so it's
enforced by the API, not just hidden in the UI. The web app sends a Company
Admin to `/setup` and shows everyone else "Your workspace is being set up".
The nightly accrual and attendance-finalization jobs skip incomplete
tenants. Every tenant that existed before this shipped goes through setup
once (owner decision), pre-filled from its current config; for them setup
only adds and updates, never deletes.

**Steps** (each must be error-free to continue; dependencies only flow forward):

| # | Step | Captures |
|---|---|---|
| 1 | Company | `company_profiles` (legal name, address, state, PIN, contact, optional GSTIN/CIN) + the **go-live date** (`tenant_settings.go_live_date`) |
| 2 | Departments | at least one |
| 3 | Your profile | the submitting admin's own employee record, linked to their login (or "I'm not an employee") |
| 4 | Work week & shifts | time zone, weekly offs, shifts, exactly one default |
| 5 | Attendance rules | mode, capture methods, regularization window/cap, unactioned behaviour, payroll cut-off |
| 6 | Holidays | manual entry or CSV/XLSX import (`date, name, type`) |
| 7 | Leave policy | leave-year start, approval levels, escalation, LOP, leave types (incl. Restricted Holiday / comp-off, and event-based maternity / adoption / commissioning mother / miscarriage / paternity / marriage presets) |
| 8 | Import employees | optional employee file (strict: departments must exist, the admin's own code is reserved) |
| 9 | Opening balances | optional `employeeCode, leaveTypeCode, openingBalance` file for companies migrating from another HRMS |
| 10 | Review & submit | summary, every error/warning, submit |

Payroll is **not** a setup step: a company can go live on the 1st and set
payroll up at month end. The dashboard shows a "Set up payroll" card until
the first salary structure exists.

**Draft.** `PUT /api/setup/draft` saves the configuration; files go up
through `POST /api/setup/files/:kind` and their rows never travel back to
the browser. The whole draft is AES-256-GCM encrypted in
`tenant_setups.draft_ciphertext` (an employee file can carry PAN/bank
numbers) — so setup needs `FIELD_ENCRYPTION_KEY`. A browser can't forge an
`existingId`: only ids of real rows survive a save, and saved departments
and holidays always come from the DB.

**Submit** (`POST /api/setup/submit`) is **strict** — one error anywhere
blocks it — and writes company profile, settings, departments, shifts,
holidays, leave types, the admin's employee record, imported employees
(manager-first, so every reporting line points at an existing row),
opening balances and policy-default leave credits in **one transaction**.
The first statement claims the `tenant_setups` row, so a double-click or a
second admin waits and then fails instead of writing twice. Firebase logins
can't join a DB transaction: they're provisioned after the commit, and any
that fail are kept on `tenant_setups.result` for `POST
/api/setup/logins/retry` (dashboard card).

**Mid-year edge cases** (go-live is the anchor — `leave-entitlement.ts`):

| Case | Behaviour |
|---|---|
| Company goes live mid-year | Leave for anyone without an opening balance is prorated from go-live (owner decision); monthly/quarterly types accrue from the go-live period on |
| Employee in the opening-balance file | ANNUAL types: exactly the imported balance (no grant on top). MONTHLY/QUARTERLY: the balance + accrual from go-live |
| Joined after the leave-year start / in the future | Prorated from the joining date; nothing credited before they join |
| Go-live mid-month | That month is credited prorated and rounded to whole days — 2 days/month gives 2 from the 1st, 1 from mid-month, 0 for the last few days |
| Go-live before the current leave year | Warning: everyone gets this year's full entitlement |
| Go-live within 30 days of year end | Warning; carry-forward rolls balances into the new year |
| Negative balance in the old system | Error — enter 0 |
| Holiday in an already-processed payroll month | Error (a paid month can't change) |
| Days before go-live | Never marked ABSENT by finalization, so no LOP in the first payroll |
| Go-live entered wrong | Leave › Settings › **Recalculate policy credits** — preview, then reverse and re-apply this year's credits with the corrected date |

---

## Build status

| Piece | State |
|---|---|
| Schema: entitlement columns, `tenant_settings`, `shifts`, `holidays`, `attendance_settings`, `punches`, `employees.shift_id` | ✅ migration `20260905000001` |
| Onboarding: `plan` → entitlements; `seedTenantRows` | ✅ |
| Seed script parity (defaults + demo holidays per tenant) | ✅ |
| `EntitlementGuard` (block modules not in plan) + `@RequiresFeature` | ✅ wired onto Leave + Attendance |
| `attendance.service.ts` reads `shifts` / `tenant_settings` instead of hardcoded constants | ✅ |
| In-app Settings screens (shift catalogue CRUD; attendance mode/capture/regularization guardrails; general tenant_settings — timezone/weekly-offs/payroll-cutoff) | ✅ `apps/web/src/pages/attendance/settings-tab.tsx`, a Settings tab on the Attendance page for Company Admin/HR Manager |
| Company setup (mandatory, full-screen) | ✅ `apps/api/src/setup` + `apps/web/src/pages/setup` — 10 steps, encrypted server-side draft, strict one-transaction submit, `SETUP_INCOMPLETE` gate in `TenantGuard`, migration `20261201090000_company_setup`. Replaced the skippable wizard (`setup_wizard_*` columns dropped) |
| Company profile | ✅ `company_profiles`; `GET`/`PATCH /api/tenant-config/company-profile`; web `/company` |
| Nightly finalization job (punches + leave + holidays → status) | ✅ `AttendanceFinalizationProcessor` (module 05) |
| Regularization approval + guardrails enforcement (cap, window, auto-resolve at cutoff) | ✅ (module 05) |
| `POST /attendance/ingest` for biometric/CSV (per-tenant device key) | 🔴 per-client, deferred |
