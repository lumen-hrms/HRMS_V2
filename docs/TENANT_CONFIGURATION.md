# Tenant Configuration — how one platform serves many tenants

> **Audience:** developers touching onboarding, settings, attendance, leave,
> or payroll. This is the model for *where per-tenant rules live* and *who
> sets them*. Read `CLAUDE.md` (multi-tenancy) and `docs/MODULE_SPECS.md`
> (per-module contracts) alongside it.
>
> **Status:** foundation landed (migration `20260905000001_tenant_configuration`).
> Schema + onboarding defaults + seed are in. The enforcement guard, the
> in-app Settings screens, and the attendance engine that consumes this
> config are the next slices (see "Build status" at the end).

---

## The three layers

Mixing these up is the classic multi-tenant mistake. Keep them separate.

| Layer | Question it answers | Stored in | Set by | When |
|---|---|---|---|---|
| **1. Plan entitlements** | *What is this tenant allowed to use?* | `platform.subscriptions` (`enabled_modules`, `features`) | **Platform operator (founder)** | Onboarding; re-derived on plan change |
| **2. Tenant business config** | *How do this tenant's HR rules work?* | `public.*` config tables (RLS-scoped) | **Company Admin, in-app** | Setup wizard on first login; editable anytime |
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

**Not yet built:** an `EntitlementGuard` that blocks routes for modules
not in `enabled_modules`, and a `@RequiresFeature('biometricIntegration')`
check on the future punch-ingest endpoint. The columns exist and are
populated; nothing reads them yet.

---

## Layer 2 — Tenant business config

All RLS-scoped `public` tables, seeded with working defaults on tenant
creation (`PlatformAdminService.seedTenantDefaults`, mirrored in
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
`TARGET_HOURS` constants in `attendance.service.ts`** — that refactor is
part of the next slice.

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
2. `seedTenantDefaults(tenantId)` writes `tenant_settings` +
   `attendance_settings` + the default `General` shift.
3. **Company Admin**, on first login, walks a **setup wizard** (work week
   → shift(s) → holidays → leave types → payroll cut-off). Skippable
   (defaults already applied), resumable. — *wizard UI not built yet.*

---

## Build status

| Piece | State |
|---|---|
| Schema: entitlement columns, `tenant_settings`, `shifts`, `holidays`, `attendance_settings`, `punches`, `employees.shift_id` | ✅ migration `20260905000001` |
| Onboarding: `plan` → entitlements; `seedTenantDefaults` | ✅ |
| Seed script parity (defaults + demo holidays per tenant) | ✅ |
| `EntitlementGuard` (block modules not in plan) + `@RequiresFeature` | 🔴 next |
| `attendance.service.ts` reads `shifts` / `tenant_settings` instead of hardcoded constants | 🔴 next |
| Nightly finalization job (punches + leave + holidays → status) | 🔴 next |
| Regularization approval + guardrails (cap, window, auto-resolve at cutoff) | 🔴 next |
| In-app Settings screens + first-run setup wizard | 🔴 next |
| `POST /attendance/ingest` for biometric/CSV (per-tenant device key) | 🔴 per-client, deferred |
