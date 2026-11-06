# 13 — Tenant Configuration — Module Source of Truth

> **This file is the authoritative, detailed spec for further development of
> this module** in the same personas/permission-matrix/acceptance-criteria
> shape every other `docs/modules/NN_*.md` uses. **It does not replace**
> `docs/TENANT_CONFIGURATION.md`, which stays the primary reference for the
> *mechanism* — the three-layer model (plan entitlements / tenant business
> config / per-employee override), the full field-by-field schema tables,
> and the capture-abstraction (`punches`) design. This file is the
> module-shaped companion: who uses it, the API surface as it exists today
> across the modules that host it, the permission matrix, and acceptance
> criteria. `docs/MODULE_SPECS.md` doesn't carry a numbered §13 section (the
> status table stops at 12) — this module's status has always lived in
> `docs/TENANT_CONFIGURATION.md`'s own "Build status" table and in
> `CLAUDE.md`'s "Tenant Configuration — done, 100%" paragraph; this file
> doesn't introduce a second source of truth for that.
>
> **Status:** ✅ 100% — see `docs/TENANT_CONFIGURATION.md`'s "Build status"
> table for the itemized list. The one deliberately-deferred piece,
> `POST /attendance/ingest` (biometric/CSV device ingestion), is out of V1
> scope per `CLAUDE.md`'s "Explicitly deferred" list, not a gap in this
> module.
> **Code:** `apps/api/src/setup` (mandatory company setup — draft, validation,
> one-transaction submit; §3.3), `apps/api/src/tenant-config` (company profile
> — §4.2), `apps/api/src/common/guards/tenant.guard.ts` (the
> `SETUP_INCOMPLETE` gate), `apps/api/src/platform-admin/entitlements.ts` (Layer 1),
> `apps/api/src/attendance/attendance.service.ts` (Layer 2 shifts +
> settings + the general `tenant_settings` fields, read and CRUD),
> `apps/api/src/leave/leave.service.ts` (holidays CRUD — shared by Leave
> and Attendance), `apps/api/src/common/guards/entitlement.guard.ts`
> (`EntitlementGuard`). Web:
> `apps/web/src/pages/attendance/settings-tab.tsx` (Settings screen),
> `apps/web/src/pages/setup` (full-screen company setup),
> `apps/web/src/components/setup-gate.tsx` (routing gate),
> `apps/web/src/pages/company-settings.tsx` (company profile).
> **Related:** `docs/TENANT_CONFIGURATION.md` (primary mechanism doc) ·
> `CLAUDE.md`'s "V1 module scope" · module `05_ATTENDANCE.md` (the main
> consumer of Layer 2 config) · module `04_LEAVE_MANAGEMENT.md` (holidays,
> `TenantSettings.allowLopRequests`/`fyStartMonth`) · module
> `02_PLATFORM_ADMIN.md` (Layer 1 plan assignment/entitlement snapshot).
> **Last synced to code:** 2026-10-29 — the skippable wizard was replaced by
> a mandatory full-screen company setup (§3.3).

---

## 1. Purpose & scope

One codebase, many tenants, each with different work weeks, shift
patterns, holiday calendars, regularization guardrails, and plan
entitlements. This module is the answer to "where does a given rule live,
and who's allowed to change it" — the three-layer model in
`docs/TENANT_CONFIGURATION.md` — plus the concrete surfaces (API + UI)
that read and write each layer.

**In scope (V1), spanning the modules that host each layer:**
- **Layer 1 (plan entitlements)** — `enabledModules`/`features` on
  `platform.subscriptions`, set at onboarding from `plan`, enforced by
  `EntitlementGuard` + `@RequiresModule`/`@RequiresFeature`.
- **Layer 2 (tenant business config)** — `tenant_settings`, `shifts`,
  `holidays`, `attendance_settings`: seeded with working defaults at
  onboarding, captured for real in the mandatory company setup, and
  editable afterwards by a Company Admin through in-app Settings screens.
- **Layer 3 (per-employee override)** — `Employee.shiftId`.

**Out of scope for V1 (explicitly deferred, per `CLAUDE.md`):**
- `POST /attendance/ingest` (biometric/CSV device ingestion) — the
  `punches` table and the `features.biometricIntegration` gate exist;
  nothing writes to `punches` yet (web clock-in still writes
  `attendance_records` directly). Per-client integration work, not a
  generic V1 deliverable.
- A pattern-based weekly-off type ("2nd & 4th Saturday off") — today's
  `weeklyOffDays` is a flat day-of-week list; a 6-day week with alternate
  Saturdays off needs a richer type, noted as a later enhancement in
  `docs/TENANT_CONFIGURATION.md`.
- `Employee.workWeekOverride` and a `ShiftAssignment` (employee × date)
  table for true rotational rostering — `ROSTER` mode's `Shift.type =
  ROTATIONAL` exists as a config value; the assignment mechanism to back
  it is future work.

---

## 2. User personas

| Persona | Uses | Screen |
|---|---|---|
| Platform Admin (operator) | Sets Layer 1 (plan → entitlements) at onboarding/plan change | Platform Admin console (module 02) |
| Company Admin | Owns Layer 2 end-to-end: completes company setup (mandatory, blocks the workspace until submitted), and any later edit via Settings | `/setup` (first run); Attendance → Settings tab; Company |
| HR Manager | Can edit shifts and view attendance settings (not the general `tenant_settings` fields — see §6); manages holidays | Attendance → Settings tab; Leave → Holidays |
| Line Manager / Employee | Read-only, indirectly — their day-to-day (shift times, holidays, regularization windows) is *governed* by this config, no direct screen | — |
| Auditor | Read-only on attendance settings | Attendance → Settings tab (view only) |

---

## 3. Functional expectations (definition of done)

### 3.1 Layer 1 — plan entitlements

1. Platform Admin creates a tenant with a `plan` (`TRIAL`/`STARTER` →
   `GROWTH` → `ENTERPRISE`) — `entitlementsForPlan(plan)` derives
   `enabledModules` + `features` onto `platform.subscriptions` (module 02).
2. `EntitlementGuard` blocks any route carrying `@RequiresModule('X')` or
   `@RequiresFeature('y')` when the tenant's subscription doesn't have
   it — a 403, not a silently-degraded response. Wired onto `LeaveController`
   (`@RequiresModule('LEAVE')`) and `AttendanceController`
   (`@RequiresModule('ATTENDANCE')`).
3. A plan change (`PATCH /api/platform-admin/tenants/:id/plan`, module 02)
   re-derives and overwrites `enabledModules`/`features` — never a manual
   per-flag edit by the operator.

### 3.2 Layer 2 — tenant business config

1. **Onboarding:** `seedTenantDefaults(tenantId)` writes `tenant_settings`
   (`Asia/Kolkata`, 5-day week, cutoff day 25, 2-level leave approval),
   `attendance_settings` (`SELF_SERVICE` mode, 7-day regularization
   window, cap 3, `AUTO_APPROVE`), and one default `General` `FIXED`
   shift (09:00–18:00, 15-min grace) — so a brand-new tenant functions
   before a Company Admin ever opens Settings.
2. **Company setup (mandatory):** see §3.3 — replaces the old skippable
   first-run wizard.
3. **Ongoing edits:** the same values are editable anytime via the
   Attendance → Settings tab (`GET`/`PATCH /api/attendance/settings` for
   shifts, attendance guardrails, and the general `tenant_settings`
   fields bundled into the same DTO — see §4.1) and via Leave → Holidays
   (`GET`/`POST`/`PATCH`/`DELETE /api/leave/holidays`).
4. **Attendance reads config, never constants:** `resolveShift()` uses
   `Employee.shiftId` if set, else the tenant's one `isDefault` shift;
   `clockIn()`'s late/on-time call, `today()`'s `targetHours`, holiday/
   weekly-off detection, and the regularization window/cap/auto-resolve
   behavior all read the tenant's live config — none of it is a hardcoded
   constant in `attendance.service.ts` anymore.

### 3.3 Layer 3 — per-employee override

`Employee.shiftId` (nullable FK → `shifts`, `ON DELETE SET NULL`) is set
through the ordinary Employee Master edit path (module 03) — this module
doesn't add a separate endpoint for it. `NULL` resolves to the tenant's
`isDefault` shift.

### 3.3 Company setup

Full spec — steps, draft, strict one-transaction submit, the gate, and the
mid-year edge cases — in `docs/TENANT_CONFIGURATION.md` "Company setup".
In short:

1. Until a tenant's `tenant_setups.completed_at` is set, `TenantGuard`
   answers **403 `SETUP_INCOMPLETE`** for every role on every route except
   `/api/setup/*`, `/api/auth/*` and `/api/access/me`; the web app sends
   the Company Admin to `/setup` and everyone else to a holding screen.
   Existing tenants go through it once, pre-filled, and setup never
   deletes their data.
2. Ten steps — company + go-live date, departments, the admin's own
   employee profile, work week & shifts, attendance rules, holidays
   (manual or CSV/XLSX import), leave policy, employee file, opening
   leave balances, review. Payroll is deliberately not a step.
3. Saved as an encrypted server-side draft (resume anywhere); submit is
   strict (one error blocks it) and writes everything in one transaction;
   Firebase logins are provisioned after the commit with retry.

---

## 4. Technical design

### 4.1 API surface (as it exists today, across host modules)

| Method | Path | Roles | Layer |
|---|---|---|---|
| `GET` | `/api/setup/status` | any tenant role | company setup status (+ payroll configured, failed logins) |
| `GET` \| `PUT` | `/api/setup/draft` | Company Admin | load (pre-filled) / save the encrypted draft |
| `POST` | `/api/setup/validate` | Company Admin | every issue, per step |
| `POST` \| `DELETE` | `/api/setup/files/:kind` (`employees`, `balances`) | Company Admin | upload (validated) / remove a setup file |
| `POST` | `/api/setup/holidays/import` | Company Admin | merge a holiday file into the draft |
| `POST` | `/api/setup/submit` | Company Admin | strict, one-transaction submit |
| `POST` | `/api/setup/logins/retry` | Company Admin | re-provision logins that failed after submit |
| `GET` | `/api/tenant-config/company-profile` | Company Admin, HR Manager, Auditor | company profile + go-live date |
| `PATCH` | `/api/tenant-config/company-profile` | Company Admin | edit the company profile |
| `GET` | `/api/attendance/settings` | Company Admin, HR Manager, Auditor | Layer 2 — `attendance_settings` + general `tenant_settings` fields (timezone, weeklyOffDays, payrollCutoffDay) |
| `PATCH` | `/api/attendance/settings` | Company Admin | same — a single DTO covers both `attendance_settings` and the general `tenant_settings` fields; the service splits them into two `tenantPrisma` writes internally |
| `GET` | `/api/attendance/shifts` | any tenant role | Layer 2 — shift catalogue |
| `POST` \| `PATCH` \| `DELETE` | `/api/attendance/shifts[/:id]` | Company Admin, HR Manager | shift CRUD |
| `GET` | `/api/leave/holidays?year=` \| `?from=&to=` | any tenant role | Layer 2 — holiday calendar by leave year or date range (shared by Leave + Attendance) |
| `POST` | `/api/leave/holidays/import?dryRun=` | Company Admin, HR Manager | holiday CSV/XLSX import (valid rows saved, matched on date + name) |
| `POST` \| `PATCH` \| `DELETE` | `/api/leave/holidays[/:id]` | Company Admin, HR Manager | holiday CRUD |
| `PATCH` | `/api/platform-admin/tenants/:id/plan` | Platform operator | Layer 1 — plan change re-derives entitlements (module 02) |

Note the asymmetry on `/api/attendance/settings`: **read** is open to
Auditor (governance visibility) but **write** is Company Admin only —
narrower than the shift-CRUD routes, which also allow HR Manager. This
reflects that the general `tenant_settings` fields (timezone, week
shape, payroll cutoff) are closer to a company-wide policy decision than
day-to-day shift management.

### 4.2 `apps/api/src/tenant-config` — what it actually owns

The company profile (`company_profiles`) — read/edit after setup, with the
same rules setup applies (`company-profile.ts`'s `companyProfileErrors`).
The old wizard-progress endpoints and `setup_wizard_*` columns are gone
(migration `20261201090000_company_setup`). Company setup itself lives in
`apps/api/src/setup`: it writes the Layer 2 tables directly inside its one
transaction rather than calling each module's endpoints, because those
endpoints can't share a transaction.

### 4.3 Data model

See `docs/TENANT_CONFIGURATION.md`'s field-by-field tables for
`tenant_settings`, `shifts`, `holidays`, `attendance_settings` — not
duplicated here to avoid the two docs drifting apart on schema detail.

---

## 5. Business rules & invariants

- **RULE-1** Layer 1 is never set directly by a tenant user — only a
  plan change (Platform Admin action) moves `enabledModules`/`features`.
- **RULE-2** `EntitlementGuard` fails closed: no `@RequiresModule`/
  `@RequiresFeature` decorator on a route means no entitlement check at
  all (same opt-in shape as `RolesGuard`) — a new route that *should* be
  plan-gated must remember to add the decorator; this isn't automatic.
- **RULE-3** Exactly one `shifts` row has `isDefault = true` per tenant —
  the fallback for any employee with `shiftId = NULL`.
- **RULE-4** A new tenant is fully functional immediately after
  onboarding — every Layer 2 table is seeded — but nobody can *use* it
  until company setup is submitted (RULE-6).
- **RULE-6** Setup gate: business routes answer `SETUP_INCOMPLETE` until
  `tenant_setups.completed_at` is set; enforced in `TenantGuard` for every
  role. Setup submit is all-or-nothing and never deletes existing rows.
- **RULE-5** Holidays are shared state — Leave's working-day count and
  Attendance's daily-status engine both read the same `holidays` table;
  there's no separate "attendance holidays" vs "leave holidays."

---

## 6. Permission matrix

| Capability | Employee | Line Manager | HR Manager | Company Admin | Auditor | Platform Admin |
|---|:--:|:--:|:--:|:--:|:--:|:--:|
| View attendance settings / shift catalogue / holidays | ✅ | ✅ | ✅ | ✅ | ✅ | — |
| Edit shift catalogue | — | — | ✅ | ✅ | — | — |
| Edit attendance guardrails + general `tenant_settings` (timezone, week shape, payroll cutoff) | — | — | — | ✅ | — | — |
| Manage holidays | — | — | ✅ | ✅ | — | — |
| Complete company setup (draft, upload, submit, retry logins) | — | — | — | ✅ | — | — |
| See company setup status | ✅ | ✅ | ✅ | ✅ | ✅ | — |
| Edit company profile | — | — | view | ✅ | view | — |
| Change a tenant's plan (Layer 1) | — | — | — | — | — | ✅ |

---

## 7. Acceptance criteria / test checklist

- [x] Unit: `EntitlementGuard` blocks a route when the tenant's plan
      lacks the required module/feature; allows it when present; no-op
      when the route carries no decorator.
- [x] Unit: `attendance.service.ts`'s late/on-time, `targetHours`,
      holiday/weekly-off, and regularization-guardrail logic all read
      from `resolveShift()`/`tenant_settings`/`attendance_settings`
      rather than a constant (module 05's own suite covers this in
      depth — not re-asserted here).
- [x] Unit: `seedTenantDefaults` writes all four Layer 2 tables with the
      documented defaults; the seed script (`prisma/seed.ts`) stays in
      parity with it.
- [x] Unit: company setup — every step's rules (`setup-validation.spec.ts`),
      opening balances (`opening-balances.spec.ts`), and the service:
      encrypted draft, forged `existingId`s dropped, files never sent back,
      strict submit writes nothing on error, one transaction with
      manager-first inserts, no logins/audit when the transaction fails,
      a lost submit race, failed logins recorded and retried
      (`setup.service.spec.ts`).
- [x] Unit: the `SETUP_INCOMPLETE` gate and its exempt paths
      (`tenant.guard.spec.ts`); company profile rules
      (`tenant-config.service.spec.ts`).
- [ ] E2E: `test/setup.e2e-spec.ts` — incomplete tenant gets 403 on
      business routes for every role, setup routes stay reachable, another
      tenant is unaffected, and one tenant's admin can't read another's
      draft. Written; needs the local Postgres + Firebase e2e stack to run.
- [x] E2E: a plan change replaces `enabledModules`/`features` wholesale
      (no stale flags from the previous plan) — covered under module 02's
      e2e suite.
- [x] `npm run test:api`, `tsc -p apps/api`, repo-root `npm run lint`,
      `npm run build` (web) all clean (2026-10-29).

---

## 8. Open questions / owner actions

- **`POST /attendance/ingest`** (biometric/CSV device ingestion) remains
  the one real gap, deferred per-client per `CLAUDE.md` — see
  `docs/TENANT_CONFIGURATION.md`'s "capture abstraction" section for the
  target shape (`punches` table, `features.biometricIntegration` gate)
  before building a specific integration.
- **Alternate-Saturday weekly-off pattern** — flagged in
  `docs/TENANT_CONFIGURATION.md` as a "later enhancement," not scheduled;
  revisit if a customer specifically needs it (the hospital customer's
  rota staff are the more likely trigger than the startup customer).
