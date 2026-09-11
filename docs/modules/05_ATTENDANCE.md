# 05 — Attendance & Time Tracking — Module Source of Truth

> **This file is the authoritative, detailed spec for further development of
> this module.** `docs/MODULE_SPECS.md` §5 is the one-page summary; the UI
> build prompt is `docs/ui-build-prompts/05-attendance.md`.
>
> **Status:** 🟡 — employee self-service (clock-in/out, breaks, calendar,
> stats) and regularization **request/list/cancel** are live; the config
> foundation (`shifts`, `holidays`, `tenant_settings`, `attendance_settings`,
> `punches`) has landed but `attendance.service.ts` mostly still runs on
> hardcoded constants, and there is no approver-side flow, manager view, or
> finalization job yet.
> **Progress:** ~55% (see `docs/MODULE_SPECS.md` status table — keep in sync).
> **Code:** `apps/api/src/attendance` (`AttendanceService`,
> `AttendanceController`), `apps/web/src/pages/attendance`.
> **Related:** `docs/MODULE_SPECS.md` §5 · `docs/TENANT_CONFIGURATION.md`
> (shifts, holidays, tenant/attendance settings, the `punches` capture
> abstraction — **read this before touching the service**) ·
> `docs/BACKEND_ARCHITECTURE.md` §4 (`scopeFor`), §6 (data model) ·
> module `03_EMPLOYEE_MASTER.md` (`Employee.shiftId`, `reportingManagerId`) ·
> module `04_LEAVE_MANAGEMENT.md` (comp-off credit on clock-in;
> leave→attendance reconciliation writes `ON_LEAVE` directly) ·
> module `07_PAYROLL_ENGINE.md` (month-end LOP consumer, not built).
> **Last synced to code:** 2026-09-11.

---

## 1. Purpose & scope

Per-employee daily attendance: clock-in/out with breaks, a monthly calendar
and stats view, and a regularisation (correction-request) workflow. Feeds
Leave (holiday/weekly-off detection for comp-off, `ON_LEAVE` reconciliation
— both already built from Attendance's side, see module 04 §4/§5) and will
feed Payroll's month-end LOP computation once that module exists.

**In scope (V1):** self-service clock-in/out/breaks; "today" status; monthly
calendar + stats; regularisation request/list/cancel (employee side); the
tenant config foundation (shifts, holidays, tenant/attendance settings,
`punches` capture table) that the engine is meant to run on.

**Out of scope / deferred** (`CLAUDE.md` explicitly-deferred list):
biometric device integration (ZKTeco/eSSL), GPS geo-fenced check-in, selfie/QR
check-in, native mobile app. These are **capture channels** — the `punches`
abstraction (§4.6) is designed so adding one later is a small job (map a
device payload to `Punch` rows) behind `subscription.features
.biometricIntegration`, not a rewrite.

---

## 2. User personas & their role in this module

| Persona | Why they touch this module | What they can do | What they cannot do |
|---|---|---|---|
| **Employee** | Clocks in/out daily; needs to see and correct their own record. | Clock in/out, start/end break; view own "today" card, monthly calendar, monthly stats; raise/list/cancel their own regularisation requests. | Cannot see any colleague's attendance; cannot approve/reject a regularisation (even their own); cannot mark attendance manually; no shift/holiday/settings admin. |
| **Line Manager** | Owns approval of their reports' corrections *(target — not built)*. | *(Target)* view team "today" roster, approve/reject a report's regularisation within the configured window; see team calendar. **Today:** none of this exists — every route is self-service only. | Cannot edit shifts/holidays/settings (HR/Admin only). |
| **HR Manager** | Owns tenant attendance config and exception handling. | *(Target)* mark attendance manually with a reason (audited); approve/reject any regularisation; bulk-approve; manage `Shift`/`Holiday`/`AttendanceSettings`; run/inspect the finalization job. **Today:** can read/write `Holiday` and `TenantSettings` (shared with Leave, module 04) but has **no attendance-specific admin surface**. | Cannot bypass the append-only audit trail once built. |
| **Company Admin** | Same operational surface as HR Manager for this module. | Same as HR Manager, plus first-run setup wizard *(not built)*. | — |
| **Auditor** (read-only) | Reviews attendance decisions for compliance / labour-law exposure. | *(Target)* view any employee's attendance history, regularisation decisions, and the finalization/audit trail, read-only. **Today:** no attendance read surface exists for this role at all — gap. | Every mutating control absent. |
| **Platform Admin** | Out of scope — separate console, cannot read `public.attendance_records`. | — | — |

### How each persona actually uses it (today vs. target)

- **Employee (live today):** opens **Attendance** → sees the "Today" card
  (clock in / break / clock out buttons, current status) → **Calendar** tab
  for the month grid → **Stats** tab for present/absent/late/hours →
  **Regularisation** tab to raise a request for a missed punch and cancel it
  while pending.
- **Line Manager / HR Manager / Company Admin (target, not built):** would
  land on a **team roster** for "who hasn't clocked in today", a **pending
  regularisation queue** with approve/reject, and a **Settings** area for
  shifts/holidays/regularisation guardrails. None of this exists yet — see
  §9.
- **Auditor (target, not built):** would get a read-only version of the
  manager surface plus the decision audit trail.

---

## 3. Functional expectations (definition of done)

1. **Attendance is derived from punches, not typed by hand.** A day's
   `AttendanceRecord` should be the rollup of `Punch` rows (+ holiday +
   weekly-off + approved leave), computed by a nightly job — not written
   ad-hoc at clock-in time as the sole source. *(Not yet true — see §9 gap 1
   and 3; today `clockIn()`/`clockOut()` write `AttendanceRecord` directly
   and nothing writes to `punches`.)*
2. **Shift-aware status.** Late/on-time, full/half-day, and expected hours
   come from the employee's resolved `Shift` (own `shiftId` or the tenant's
   `isDefault` shift), never a hardcoded constant.
3. **Regularisation is bounded and audited.** A request must be raised
   within `AttendanceSettings.regularizationWindowDays` of the target date,
   capped at `regularizationMonthlyCap` per employee per month; every
   approve/reject writes an audit row; requests nobody actions by the
   payroll cutoff resolve per `unactionedBehavior`.
4. **Attendance reconciles with Leave, not the other way round.** Approved
   leave's `ON_LEAVE` rows (written by `LeaveService`, module 04 §5) and
   comp-off detection at clock-in (module 04's holiday/weekly-off check) are
   authoritative inputs the finalization job must respect, never recompute
   or overwrite.
5. **Manual marking is HR/Admin-only and always audited** — free-form
   attendance edits without an actor + reason are never allowed.
6. **Month-end output is a stable contract for Payroll** —
   `getLopDays(employeeId, month)` (or equivalent) must exist and be
   versioned before Payroll starts consuming it (§10, cross-module dependency
   map in `MODULE_SPECS.md`).

---

## 4. Technical design

### 4.1 Row scoping

Every route today is `JwtAuthGuard + TenantGuard` only — **no `@Roles`,
no service-layer `scopeFor`**. Every endpoint operates on the calling
employee's own data (`user.employeeId` resolved from the token), which is
correct for the self-service surface but means there is currently no
manager/HR read path at the API layer at all — that's new work, not a scope
change to an existing `scopeFor` (§9 gap 5).

Target manager/HR scoping (once built), mirroring module 03's
`EmployeesService.scopeFor`:

```ts
AttendanceService.scopeFor(user):
  EMPLOYEE     → { employeeId: user.employeeId }
  LINE_MANAGER → { employee: { reportingManagerId: user.employeeId } }  // + self
  default      → {}   // HR_MANAGER / COMPANY_ADMIN / AUDITOR
```

### 4.2 Data model

**`AttendanceRecord`** (one per employee per day) — `date` · `checkInAt` /
`checkOutAt` (currently the primary write; target: denormalized first-IN /
last-OUT convenience once `punches` is the source of truth) · `status`
(`AttendanceStatus`) · `source` (`AttendanceSource`, default `WEB`).
`@@unique([tenantId, employeeId, date])`.

**`AttendanceStatus`** — `PRESENT · LATE · ON_LEAVE · WEEKLY_OFF · HOLIDAY ·
ABSENT · PENDING_REGULARIZATION`.

**`AttendanceSource`** (both the record's write channel and a `Punch`'s
capture channel) — `WEB` (live) · `BIOMETRIC` · `GPS` · `IMPORT` · `MANUAL`
(all wired in the enum, none have a write path yet except `WEB`).

**`AttendanceBreak`** — `attendanceRecordId` · `startAt` · `endAt?` (open
while on break).

**`Punch`** *(table exists, nothing writes to it yet — §9 gap 2)* —
`employeeId` · `at` · `direction` (`PunchDirection`: `IN`/`OUT`) · `source`
(`AttendanceSource`) · `deviceId?` · `rawRef?`. The intended source of truth
per `TENANT_CONFIGURATION.md`'s capture abstraction:

```
web "Clock in"  ─┐
biometric webhook ┼─►  punches  ──►  nightly finalization  ──►  attendance_records
CSV import       ─┘
manual (HR)      ─┘
```

**`RegularizationRequest`** — `employeeId` · `attendanceRecordId?` ·
`targetDate` · `reasonType` (`RegularizationReasonType`) ·
`requestedCheckInAt?` / `requestedCheckOutAt?` · `note?` · `status`
(`RegularizationStatus`: `PENDING · APPROVED · REJECTED · CANCELLED` —
confirm exact set against `schema.prisma`) · `approverId?` · `decidedAt?`.

**`Shift`** (per `TENANT_CONFIGURATION.md`) — `name` (unique per tenant) ·
`type` (`ShiftType`: `FIXED · FLEXI · ROTATIONAL`) · `startTime` /
`endTime` (`HH:MM`, tenant timezone) · `graceMinutes` (default 15) ·
`minHoursFullDay` / `minHoursHalfDay` (Decimal) · `coreStartTime` /
`coreEndTime` (FLEXI only) · `isDefault` (exactly one per tenant — the
fallback for `Employee.shiftId = null`).

**`Holiday`** — `date` · `name` · `isOptional`. Shared with Leave (module 04)
— both the working-day count there and the daily-status engine here read the
same table.

**`TenantSettings`** — the fields Attendance cares about: `timezone`
(default `Asia/Kolkata`) · `weeklyOffDays` (`Int[]`, default `[0,6]`) ·
`payrollCutoffDay` (default `25` — the hard deadline the regularisation
auto-resolve flow hangs on). (`leaveApprovalLevels` / `leaveEscalationDays` /
`allowLopRequests` / `fyStartMonth` belong to Leave, module 04.)

**`AttendanceSettings`** — `mode` (`AttendanceMode`: `SELF_SERVICE ·
ROSTER · OFF`) · `captureMethods` (`AttendanceSource[]`, default `[WEB]` —
frontend hides the clock-in button when `WEB` is absent) ·
`regularizationWindowDays` (default 7) · `regularizationMonthlyCap`
(default 3) · `unactionedBehavior` (`RegularizationUnactionedBehavior`:
`AUTO_APPROVE · AUTO_REJECT`).

### 4.3 Current implementation vs. config foundation — the gap

`attendance.service.ts` (300 lines) still computes status against
**hardcoded constants** (`SHIFT_START_HOUR` / `GRACE_MINUTES` /
`TARGET_HOURS` — confirm exact names in source) rather than reading the
employee's resolved `Shift` and `TenantSettings.timezone`. **Partially
refactored:** `clockIn()` already reads `Holiday` and
`TenantSettings.weeklyOffDays` to set `HOLIDAY`/`WEEKLY_OFF` status
(this was needed for Leave's comp-off feature — module 04 — so it landed
early). The shift-based start-time/grace-period computation is still
outstanding. This is the **highest-priority item** in §9 — every other
target behaviour (shift-aware late detection, punch-based finalization)
builds on top of it.

### 4.4 API surface

| Method | Path | Notes |
|---|---|---|
| `POST` | `/api/attendance/clock-in` | Opens today's `AttendanceRecord`; computes status against current hardcoded constants (target: the resolved `Shift`); detects holiday/weekly-off and triggers Leave's comp-off credit (module 04). |
| `POST` | `/api/attendance/clock-out` | Closes the record; finalizes hours (excl. break time). |
| `POST` | `/api/attendance/break/start` · `/break/end` | `AttendanceBreak` rows. |
| `GET` | `/api/attendance/today` | Today's status card. |
| `GET` | `/api/attendance/calendar?month=YYYY-MM` | Per-day status for the month. |
| `GET` | `/api/attendance/stats?month=YYYY-MM` | Present/absent/late/hours summary. |
| `POST` | `/api/attendance/regularization` | `CreateRegularizationDto` — target date, reason type, requested times, note. No window/cap enforcement yet (§9 gap 4). |
| `GET` | `/api/attendance/regularization` | Own requests, any status. |
| `POST` | `/api/attendance/regularization/:id/cancel` | Owner only, while `PENDING`. |

All routes: `JwtAuthGuard + TenantGuard` only — **no `@Roles` anywhere in
this module today**; every route is implicitly self-service via
`user.employeeId`.

**Not built (target — see §9):** `POST/regularization/:id/approve` &
`/reject` (`LINE_MANAGER`/`HR_MANAGER`); a manager/HR team-roster read;
`POST /attendance/mark` (manual, HR/Admin, audited); `GET
/attendance/lop?employeeId=&month=` (the Payroll contract); `POST
/attendance/ingest` (biometric/CSV, gated on `features.biometricIntegration`);
Settings CRUD for `Shift`/`AttendanceSettings` (Holiday CRUD already exists
under `/api/leave/holidays` — module 04 — shared, not duplicated here).

### 4.5 Configuration dependencies

Read `docs/TENANT_CONFIGURATION.md` in full before changing this service —
it is the model for where each rule lives (plan entitlement vs. tenant
setting vs. per-employee override) and documents the `punches` capture
abstraction this module is built around.

---

## 5. Core flows

### 5.1 Employee, a normal day (live today)

1. Employee → **Attendance** → **Clock in** → `POST /attendance/clock-in` →
   `AttendanceRecord` opened for today; status computed (`PRESENT`/`LATE`
   against the current hardcoded start-hour/grace, or `HOLIDAY`/`WEEKLY_OFF`
   if `clockIn()`'s holiday/weekly-off check matches).
2. **Start break** / **End break** → `AttendanceBreak` rows; worked hours
   exclude break time.
3. **Clock out** → record closed, total hours finalized.
4. Views the **Calendar** tab for the month and the **Stats** tab.

### 5.2 Employee raises a regularisation (partially built)

1. Forgot to clock in yesterday → **Regularisation** → **New request** →
   picks the date, a `RegularizationReasonType`, requested check-in/out
   times, a note → `POST /attendance/regularization` → `PENDING`.
2. *(Target, not built)* Line Manager sees it in a pending queue and
   approves/rejects within the configured window; on approval the
   `AttendanceRecord` for that date is created/updated and an audit row is
   written.
3. Employee can `POST /regularization/:id/cancel` while still `PENDING`.

### 5.3 Nightly finalization (target, not built)

Per employee/day: check `Holiday` → check `TenantSettings.weeklyOffDays` →
check for an approved-leave `ON_LEAVE` row (already written synchronously by
`LeaveService` — module 04 — must be treated as authoritative, not
recomputed) → roll up that day's `Punch` rows → write/update the final
`AttendanceRecord` status + hours. Clean days resolve with no human
involvement; a day with none of the above and no punches is a genuine
unexplained absence.

### 5.4 Regularisation approval + auto-resolve at cutoff (target, not built)

1. Line Manager/HR Manager → pending queue → approve/reject (bulk supported)
   → writes an audit row; approval creates/updates the day's
   `AttendanceRecord`.
2. Anything still `PENDING` when `TenantSettings.payrollCutoffDay` hits
   resolves automatically per `AttendanceSettings.unactionedBehavior`
   (`AUTO_APPROVE` or `AUTO_REJECT`).

---

## 6. Business rules & invariants

- **INV-1** — one `AttendanceRecord` per `(tenant, employee, date)` —
  enforced by a unique constraint.
- **INV-2** — a day's status is derived, in this precedence: approved leave
  (`ON_LEAVE`) → holiday → weekly-off → punches/manual → absent. Leave's
  writes win; the finalization job must not overwrite them (module 04 §4
  "Known gaps" note, mirrored here).
- **INV-3** — comp-off crediting (module 04) happens **once** per
  employee/holiday-or-weekly-off day — idempotency lives in
  `LeaveService.creditCompOff()`, keyed off the attendance-detected day.
- **RULE-1** — a regularisation must target a date within
  `regularizationWindowDays` of "today", and an employee may not exceed
  `regularizationMonthlyCap` requests in a calendar month *(not enforced
  yet — §9 gap 4)*.
- **RULE-2** — manual attendance marking requires an actor + a reason and is
  always audited *(not built — §9 gap 5)*.
- **RULE-3** — a `Shift.isDefault` shift must exist exactly once per tenant
  (seeded as "General" on tenant creation).
- **RULE-4** — every regularisation decision (approve/reject/auto-resolve)
  writes one audit row *(not built — depends on the generic audit
  interceptor, module 12, or a dedicated `AttendanceApproval`-style table
  mirroring Leave's `LeaveApproval`)*.

---

## 7. States

**`AttendanceRecord.status`:** `PRESENT · LATE · ON_LEAVE · WEEKLY_OFF ·
HOLIDAY · ABSENT · PENDING_REGULARIZATION`.
**`RegularizationRequest.status`:** `PENDING → APPROVED | REJECTED |
CANCELLED` (owner may cancel only from `PENDING`).
**`AttendanceBreak`:** open (`endAt = null`) → closed.

---

## 8. Permission matrix

| Capability | Employee | Line Manager | HR Manager | Company Admin | Auditor |
|---|:--:|:--:|:--:|:--:|:--:|
| Clock in/out, break start/end | own | — | — | — | — |
| Today / calendar / stats | own | — *(target: + team roster)* | — *(target: + team roster)* | — *(target: + team roster)* | — |
| Raise / list / cancel regularisation | own | — | — | — | — |
| Approve / reject regularisation | — | — *(target)* | — *(target)* | — *(target)* | — |
| Manual attendance marking | — | — | — *(target)* | — *(target)* | — |
| Manage shifts / attendance settings | — | — | — *(target)* | — *(target)* | — |
| Read any employee's attendance history | — | — *(target: reports)* | — *(target: all)* | — *(target: all)* | — *(target: all, read-only)* |

**Today's reality:** every cell except "own" is unbuilt — this table is
almost entirely the target state, not current behaviour. See §9.

---

## 9. Known gaps / TODO (priority order — mirrors `MODULE_SPECS.md` §5)

> Config foundation landed (migration `20260905000001`): `shifts`,
> `holidays`, `attendance_settings`, `tenant_settings`, and the `punches`
> capture table exist and are seeded with defaults on tenant creation. The
> items below are the wiring that consumes them.

1. **Refactor `attendance.service.ts`** to read the tenant's default `Shift`
   + `TenantSettings` (timezone, weekly-off days) instead of the hardcoded
   `SHIFT_START_HOUR`/`GRACE_MINUTES`/`TARGET_HOURS` constants. *(Partially
   done: `clockIn()` already reads `Holiday` + `weeklyOffDays` — needed for
   Leave's comp-off feature. The shift-based start-time/grace-period
   refactor is the outstanding piece.)*
2. **Punch write-path** — web clock-in should write `punches` rows
   (`source: WEB`); `AttendanceRecord.checkInAt/checkOutAt` become derived
   (first-IN/last-OUT) rather than the primary write.
3. **Nightly finalization job** (BullMQ) — per employee/day: holiday →
   weekly-off → approved leave → punches ⇒ final status + hours. Clean days
   auto-final, no human. *(Holiday/weekly-off detection at clock-in, and
   `ON_LEAVE` rows from approved leave, are already written synchronously —
   see module 04 §4 — but there is still no job to finalize a day with no
   clock-in and no approved leave, i.e. a genuine unexplained absence.)*
4. **Regularisation approval** — `POST .../regularization/:id/approve` &
   `/reject` for `LINE_MANAGER`/`HR_MANAGER`; enforce
   `regularizationWindowDays` + `regularizationMonthlyCap`; bulk-approve;
   auto-resolve at payroll cutoff per `unactionedBehavior`; write an audit
   row on every decision.
5. **Manager / HR views** — team roster for a day, pending regularisation
   queue, manual mark with reason (needs a `scopeFor`-style row scoping this
   module doesn't have today — see §4.1).
6. **Overtime calculation** (per-state rates) — needs the `Shift` end time,
   already available in the schema.
7. **Month-end LOP export contract for Payroll** —
   `getLopDays(employeeId, month)`; define the interface **before** Payroll
   starts so the two build against a stable contract.
8. **Per-tenant Settings screens + first-run setup wizard** (frontend) —
   shifts, holidays (shared with Leave), attendance mode/guardrails.
9. `POST /attendance/ingest` for biometric/CSV — per client, gated behind
   `subscription.features.biometricIntegration`.
10. **Audit trail** — no attendance-specific audit rows exist yet; decide
    whether this rides the generic interceptor (module 12) or a dedicated
    append-only table mirroring Leave's `LeaveApproval`.

---

## 10. Dependencies

**Upstream:** module 03 Employee Master (`Employee.shiftId`,
`reportingManagerId` for the eventual manager scoping) ·
`TENANT_CONFIGURATION.md` (`Shift`, `Holiday`, `TenantSettings`,
`AttendanceSettings`, `punches`) · module 04 Leave (writes `ON_LEAVE` rows
this module must treat as authoritative; reads this module's
holiday/weekly-off detection for comp-off).

**Downstream (consumers of Attendance):**
- Module 07 Payroll — month-end LOP feed (`getLopDays`, not built — the
  build-order-critical interface per `MODULE_SPECS.md`'s cross-module
  dependency map).
- Module 06 Dashboard — "today" attendance snapshot (listed as a known gap
  there too).
- Module 11 Reports — attendance-derived registers (not built).
- Module 12 Audit — regularisation decisions, manual marks (not built).

---

## 11. Acceptance criteria / test checklist

- [ ] An Employee can clock in once per day; a second `clock-in` on an
      already-open record is rejected or is a no-op (confirm current
      behaviour).
- [ ] Clock-in on a `Holiday` or a `weeklyOffDays` day sets
      `HOLIDAY`/`WEEKLY_OFF` status, not `PRESENT`/`LATE`.
- [ ] Break time is excluded from the day's worked-hours total.
- [ ] `GET /attendance/calendar?month=` returns exactly one entry per day
      in the month, statuses consistent with holiday/weekly-off/punches.
- [ ] A regularisation request outside `regularizationWindowDays` is
      rejected *(target — not enforced yet)*.
- [ ] A regularisation beyond `regularizationMonthlyCap` in a month is
      rejected *(target — not enforced yet)*.
- [ ] `Line Manager`/`HR Manager` approving a regularisation creates/updates
      the correct `AttendanceRecord` and writes an audit row *(target —
      endpoint doesn't exist yet)*.
- [ ] An unactioned regularisation at `payrollCutoffDay` resolves per
      `unactionedBehavior` *(target — not built)*.
- [ ] Cross-tenant: Tenant A user cannot read/act on Tenant B's attendance
      or regularisation rows (RLS).
- [ ] The finalization job never overwrites an `ON_LEAVE` row Leave already
      wrote *(target — job doesn't exist yet, but this is the invariant it
      must respect when built)*.

---

## 12. Open questions / decisions needed

- **Line-Manager visibility depth** — direct reports only, or the full
  recursive subtree (same open question as module 03 §12)? Affects the
  target `scopeFor` here too.
- **Manual marking's relationship to regularisation** — is "HR manual mark"
  a separate code path from "regularisation approval creates the record", or
  should manual marking simply be an HR-initiated regularisation that
  auto-approves?
- **Overtime scope for V1** — full state-rate overtime calculation, or defer
  to a flat "hours over shift end" number until a customer needs statutory
  compliance on it?
- **Audit approach** — wait for the generic module-12 interceptor, or build
  a dedicated `AttendanceApproval` table now (mirroring Leave's
  `LeaveApproval`) so regularisation decisions aren't blocked on that work?
- **`punches` migration path** — once the write-path lands, does
  `AttendanceRecord.checkInAt/checkOutAt` get backfilled from historical
  data, or does the "denormalized convenience" framing only apply going
  forward?
