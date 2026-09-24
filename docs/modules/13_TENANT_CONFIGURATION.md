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
> **Code:** `apps/api/src/tenant-config` (wizard progress state only — see
> §4.2), `apps/api/src/platform-admin/entitlements.ts` (Layer 1),
> `apps/api/src/attendance/attendance.service.ts` (Layer 2 shifts +
> settings + the general `tenant_settings` fields, read and CRUD),
> `apps/api/src/leave/leave.service.ts` (holidays CRUD — shared by Leave
> and Attendance), `apps/api/src/common/guards/entitlement.guard.ts`
> (`EntitlementGuard`). Web:
> `apps/web/src/pages/attendance/settings-tab.tsx` (Settings screen),
> `apps/web/src/components/setup-wizard/setup-wizard.tsx` (first-run
> wizard).
> **Related:** `docs/TENANT_CONFIGURATION.md` (primary mechanism doc) ·
> `CLAUDE.md`'s "V1 module scope" · module `05_ATTENDANCE.md` (the main
> consumer of Layer 2 config) · module `04_LEAVE_MANAGEMENT.md` (holidays,
> `TenantSettings.allowLopRequests`/`fyStartMonth`) · module
> `02_PLATFORM_ADMIN.md` (Layer 1 plan assignment/entitlement snapshot).
> **Last synced to code:** 2026-09-24 (spec written; no code change —
> module was already 100%, see `docs/TENANT_CONFIGURATION.md`).

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
  onboarding, editable by a Company Admin through in-app Settings screens
  and a skippable/resumable first-run wizard.
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
| Company Admin | Owns Layer 2 end-to-end: first-run wizard, and any later edit via Settings | Attendance → Settings tab; first-run setup wizard |
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
2. **First-run wizard:** a Company Admin's first login walks work
   week/timezone → default shift → holidays → leave types → payroll
   cut-off. Skippable (defaults already cover it) and resumable
   (`TenantSettings.setupWizardStatus`/`setupWizardStep`, `GET`/`PATCH
   /api/tenant-config/wizard`) — closing the browser mid-wizard doesn't
   lose progress or force a restart.
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

---

## 4. Technical design

### 4.1 API surface (as it exists today, across host modules)

| Method | Path | Roles | Layer |
|---|---|---|---|
| `GET` | `/api/tenant-config/wizard` | any tenant role | wizard progress (Layer 2 bookkeeping) |
| `PATCH` | `/api/tenant-config/wizard` | Company Admin | wizard progress |
| `GET` | `/api/attendance/settings` | Company Admin, HR Manager, Auditor | Layer 2 — `attendance_settings` + general `tenant_settings` fields (timezone, weeklyOffDays, payrollCutoffDay) |
| `PATCH` | `/api/attendance/settings` | Company Admin | same — a single DTO covers both `attendance_settings` and the general `tenant_settings` fields; the service splits them into two `tenantPrisma` writes internally |
| `GET` | `/api/attendance/shifts` | any tenant role | Layer 2 — shift catalogue |
| `POST` \| `PATCH` \| `DELETE` | `/api/attendance/shifts[/:id]` | Company Admin, HR Manager | shift CRUD |
| `GET` | `/api/leave/holidays?year=` | any tenant role | Layer 2 — holiday calendar (shared by Leave + Attendance) |
| `POST` \| `PATCH` \| `DELETE` | `/api/leave/holidays[/:id]` | Company Admin, HR Manager | holiday CRUD |
| `PATCH` | `/api/platform-admin/tenants/:id/plan` | Platform operator | Layer 1 — plan change re-derives entitlements (module 02) |

Note the asymmetry on `/api/attendance/settings`: **read** is open to
Auditor (governance visibility) but **write** is Company Admin only —
narrower than the shift-CRUD routes, which also allow HR Manager. This
reflects that the general `tenant_settings` fields (timezone, week
shape, payroll cutoff) are closer to a company-wide policy decision than
day-to-day shift management.

### 4.2 `apps/api/src/tenant-config` — what it actually owns

Deliberately thin: **only** the wizard's skippable/resumable progress
state (`setupWizardStatus`/`setupWizardStep` on `TenantSettings`). The
wizard's steps themselves call the *existing* Attendance/Leave endpoints
above — this module doesn't duplicate that write surface, it just tracks
"how far did the Company Admin get." See the service's own doc comment
in `tenant-config.service.ts` for the same note in the code.

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
  onboarding, before any Company Admin action — every Layer 2 table is
  seeded, not left empty pending the wizard.
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
| Run / resume the first-run setup wizard | — | — | — | ✅ | — | — |
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
- [x] Unit: wizard state is idempotent-resumable — re-fetching after a
      partial `PATCH` returns the last-saved step, not a reset
      (`tenant-config.service.spec.ts`).
- [x] E2E: a plan change replaces `enabledModules`/`features` wholesale
      (no stale flags from the previous plan) — covered under module 02's
      e2e suite.
- [x] `npm run test:api`, `tsc -p apps/api`, repo-root `npm run lint`,
      `npm run build` (web) all clean — this module has no code change in
      this pass (2026-09-24 sync was doc-only).

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
