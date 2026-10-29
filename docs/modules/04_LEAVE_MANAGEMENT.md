# 04 — Leave Management — Module Source of Truth

> **This file is the authoritative, detailed spec for further development of
> this module.** `docs/MODULE_SPECS.md` §4 is the one-page summary; the UI
> build prompt is `docs/ui-build-prompts/04-leave-management.md`; the
> per-screen frontend API contract is `docs/LEAVE_UI_SPECS.md`.
>
> **Status:** ✅ 100% — backend fully wired and tested; the frontend live
> path is built and runs against the real API by default; every
> originally-tracked feature gap is closed, including the mock-default flip
> (see §9).
> **Progress:** 100% (see `docs/MODULE_SPECS.md` status table — keep in sync).
> **Code:** `apps/api/src/leave` (`LeaveService`/`LeaveController` +
> `leave-escalation.processor.ts` / `leave-accrual.processor.ts` on the
> BullMQ `leave` queue), `apps/web/src/pages/leave`, `apps/web/src/lib/leave`
> (typed client + fixture/mock layer).
> **Related:** `docs/MODULE_SPECS.md` §4 · `docs/LEAVE_UI_SPECS.md` (live vs.
> planned endpoint inventory, kept in sync with the frontend contract) ·
> `docs/TENANT_CONFIGURATION.md` (`Holiday`, `TenantSettings.weeklyOffDays`/
> `fyStartMonth`/`leaveApprovalLevels`/`leaveEscalationDays` — shared with
> Attendance) · `docs/BACKEND_ARCHITECTURE.md` §4 (`scopeFor`-style row
> scoping), §6 (data model) · module `03_EMPLOYEE_MASTER.md`
> (`reportingManagerId`, `dateOfJoining`, `gender`) · module
> `05_ATTENDANCE.md` (comp-off credit on clock-in; `ON_LEAVE` reconciliation
> this module writes into `AttendanceRecord`) · module `12_AUDIT_LOG.md`
> (`LeaveApproval`/`LeaveLedgerEntry` are Leave's own append-only trails,
> separate from the generic `audit_log`).
> **Last synced to code:** 2026-10-29 — entitlement engine (§4.4), year-end
> carry-forward, opening balances via company setup, optional holidays as
> opt-in Restricted Holiday leave, holiday import, leave-year holiday list.

---

## 1. Purpose & scope

Configurable leave types with quotas and carry-forward; per-employee
per-year balances (annual-initialized or auto-accrued); a
tenant-configurable 1-or-2-level approval workflow with escalation timers;
a shared holiday calendar so day counts are working-days, not raw calendar
days; and reconciliation with Attendance (LOP flagging, `ON_LEAVE` sync,
comp-off crediting).

**In scope (V1) — all closed:** leave type CRUD with quota/carry-forward/
accrual-frequency/gender-restriction/min-notice/comp-off marker; yearly
balance initialization + auto-accrual (with new-joiner proration); holiday
calendar CRUD; apply with attachment; 1-or-2-level approval with
escalation; team calendar; LOP flagging and Attendance sync; comp-off
credit; cancel with balance reversal; decision/escalation history; HR
balance adjustments; a balance-movement ledger.

**Out of scope / deferred:** a balance-expiry email (no expiry event
exists — see §9); a nightly attendance finalization job consuming
`ON_LEAVE` rows as authoritative input (module 05's own much larger gap,
unaffected by anything here); leave encashment (no field models it — that's
unrelated Full & Final Settlement prose that lives in Payroll's scope, not
Leave's); more than 2 approval levels (the old SRS's "up to 4" is stale —
the schema/FE contract cap V1 at 2, per `CLAUDE.md`).

---

## 2. User personas & their role in this module

| Persona | Why they touch this module | What they can do | What they cannot do |
|---|---|---|---|
| **Employee** | Applies for leave, tracks their own balance. | View own balances/ledger; apply (dates, type, reason, attachment); view own request history + decision timeline; cancel own request; view the team calendar. | Cannot see anyone else's balance or requests; cannot approve/reject; cannot adjust balances; no leave-type/holiday/settings admin. |
| **Line Manager** | First-level approver for direct reports. | Everything Employee can, plus: see **team balances** (direct reports); approve/reject L1 for their reports' requests; see the pending-approvals queue. | Cannot approve L2 (unless also HR/Admin); cannot edit leave types/holidays/settings; cannot adjust balances. |
| **HR Manager** | Owns tenant leave configuration and the L2/backstop approval layer. | Everything Line Manager can (across all employees, not just reports) plus: create/edit leave types; CRUD holidays; approve/reject any request at any level; manual balance adjustments (with note, ledgered); view the balance ledger; read `leave/settings`. | Cannot change `TenantSettings` (Company-Admin-only write). |
| **Company Admin** | Same operational surface as HR Manager, plus settings owner. | Everything HR Manager can, plus `PATCH /leave/settings` (approval levels, LOP policy, FY start month, escalation days). | — |
| **Auditor** (read-only) | Reviews balance movements and approval decisions for compliance. | View the balance ledger (`GET /balances/ledger`), all requests (`GET /requests`), decision history on any request. | Every mutating control absent. |
| **Platform Admin** | Out of scope — separate console, cannot read `public.leave_requests`. | — | — |

### How each persona actually uses it

- **Employee** lives on **Leave → Overview** (balances by type) and
  **Apply** (form + inline team calendar); checks **My Requests** for
  status/history; cancels from there if still cancellable.
- **Line Manager** uses **Pending Approvals** (their reports' L1 queue) and
  **Team Balances**; approves/rejects with an optional comment.
- **HR Manager / Company Admin** additionally own **Leave Types**,
  **Holidays**, **Ledger**, and (Company Admin only) **Settings** — plus can
  see and act on every request tenant-wide, not just a reporting subtree.
- **Auditor** opens **Ledger** and request history read-only.

---

## 3. Functional expectations (definition of done)

1. **Working-day math, not calendar-day math.** `apply()` computes the
   requested duration excluding `Holiday` rows and
   `TenantSettings.weeklyOffDays`.
2. **Approval routing is tenant-configurable.** 1 or 2 levels per
   `TenantSettings.leaveApprovalLevels`; an employee with no
   `reportingManagerId` routes straight to L2 (HR).
3. **Balance deduction happens only on final approval**, and only if the
   request is not flagged LOP — never at apply time, never speculatively.
4. **A short balance never blocks a request** — it's still created, but
   flagged `isLop = true` if the tenant allows LOP requests
   (`TenantSettings.allowLopRequests`); if LOP requests are disallowed, the
   apply call itself should be rejected up front (confirm exact behaviour
   in `LeaveService.apply()` against this expectation — see §12).
5. **Escalation is automatic, not manual chasing.** An undecided level
   auto-escalates (or flags for HR follow-up at L2) after
   `leaveEscalationDays`, via the `leave` BullMQ queue — never a synchronous
   request-path timer.
6. **Cancellation reverses a non-LOP approved deduction** and is itself
   ledgered, symmetric with the original deduction.
7. **Every balance movement is ledgered** (`LeaveLedgerEntry`) — accrual,
   carry-forward, request deduction, cancellation reversal, HR manual
   adjustment — so the balance is always reconstructible from the ledger,
   not just a mutable counter.
8. **Comp-off and attendance reconciliation are synchronous side effects**,
   not a batch job — see module 05 §4/§5 for the Attendance-side half of
   this.

---

## 4. Technical design

### 4.1 Row scoping

No single `scopeFor` helper like Employees' — scoping is expressed per
endpoint via `@Roles()` plus service-layer checks:

- `apply` / `cancel` / `attach` / `listForEmployee` — any authenticated
  user, service enforces "own record" for non-privileged roles.
- `teamBalances` — Line Manager: direct reports (+ self); HR/Admin: all.
- `pendingApprovals` — returns `[]` for a caller who isn't an approver at
  any pending request's current level (rather than 403ing).
- `listRequests` / `ledger` — `@Roles(COMPANY_ADMIN, HR_MANAGER, AUDITOR)`
  only; tenant-wide, no further row scoping.
- `approve` / `reject` — `@Roles(LINE_MANAGER, HR_MANAGER, COMPANY_ADMIN)`;
  service checks the caller is the correct approver for the request's
  **current** level (a Line Manager can't approve L2; can't approve a
  report they're not the manager of).

> **Gap (shared with module 03 §12):** "Line Manager" scoping everywhere in
> this module is **direct-reports-only**, not the recursive subtree — same
> open question as Employee Master and Attendance.

### 4.2 Data model

**`LeaveType`** — `name` · `code` (short label, e.g. `CL`/`SL`, unique per
tenant) · `colorToken` (calendar chip colour) · `annualQuota` (Decimal) ·
`carryForwardCap` (Decimal, default 0) · `requiresApproval` (default true) ·
`minNoticeDays` (default 0, enforced in `apply()`) · `active` (soft-delete
from the apply dropdown) · `accrualFrequency` (`AccrualFrequency`:
`ANNUAL|MONTHLY|QUARTERLY`) · `genderRestriction` (`GenderRestriction`:
`ANY|MALE|FEMALE`, enforced in `apply()`) · `paid` (informational only, no
payroll linkage yet) · `isCompOff` (marks the tenant's designated comp-off
type — at most one expected per tenant, **not DB-enforced**).
`@@unique([tenantId, name])`, `@@unique([tenantId, code])`.

**`LeaveBalance`** — one row per `(tenant, employee, leaveType, year)` —
`accrued` (Decimal) · `used` (Decimal). Available = `accrued − used`,
computed at read time, not stored.

**`LeaveRequest`** — `employeeId` · `leaveTypeId` · `startDate` / `endDate` ·
`days` (Decimal, working-day count) · `halfDay` (bool) · `isLop` (bool) ·
`reason?` · `status` (`LeaveRequestStatus`: `PENDING_L1|PENDING_L2|APPROVED|
REJECTED|CANCELLED`) · `l1ApproverId?`/`l1DecidedAt?` ·
`l2ApproverId?`/`l2DecidedAt?` · single optional attachment
(`attachmentKey`/`attachmentName`/`attachmentMimeType`/`attachmentSizeBytes`
— stored the same way as Employee documents, module 09).

**`LeaveApproval`** *(append-only decision/escalation history)* —
`leaveRequestId` · `level` (Int) · `approverId?` (**null = system-generated
escalation entry**) · `decision` (`LeaveApprovalDecision`:
`APPROVED|REJECTED|ESCALATED`) · `decidedAt` · `comment?`. Backs the request
detail timeline.

**`LeaveLedgerEntry`** *(append-only balance-movement audit trail)* —
`employeeId` · `leaveTypeId` · `occurredAt` · `delta` (Decimal, signed) ·
`balanceAfter` (Decimal) · `source` (`LeaveLedgerSource` — accrual /
carry-forward / request-deduction / cancellation-reversal / manual-adjustment;
confirm exact enum values against `schema.prisma`) · `note?` ·
`actorUserId?` (null for system-driven entries like accrual).

**`Holiday`** *(shared with Attendance, module 05)* — `date` · `name` ·
`isOptional`. `@@unique([tenantId, date, name])`.

**`TenantSettings`** — the fields Leave cares about: `leaveApprovalLevels`
(1 or 2, default 2) · `leaveEscalationDays` (default 3) ·
`allowLopRequests` (default true) · `fyStartMonth` (1–12, default 4 —
India's April FY start; drives `resolveLeaveYear()`). (`weeklyOffDays` /
`timezone` / `payrollCutoffDay` are shared with Attendance, module 05.)

### 4.3 Leave-year resolution

`resolveLeaveYear()` (`leave-year.util.ts`) shifts the balance-year boundary
by `TenantSettings.fyStartMonth` so a tenant on an April–March FY buckets
balances correctly; used by `apply()` / `getBalances()` / `teamBalances()`
/ the accrual job. A calendar-year tenant (`fyStartMonth = 1`) gets ordinary
Jan–Dec buckets.

### 4.4 Entitlement (accrual, grants, carry-forward)

One engine decides what an employee is owed: the pure
`leave-entitlement.ts` (every rule unit-tested on its own) driven by
`LeaveEntitlementService` (`leave-entitlement.module.ts`, no queue
dependencies). Four callers: the **daily** `LeaveAccrualProcessor` job
(every set-up tenant), a newly created employee (single or bulk import),
company setup's submit (inside its transaction), and the "Apply now"
button on Leave Types (`POST /leave/types/:id/initialize/:year`, current
leave year only).

- **Effective start** = latest of the leave-year start, the employee's
  joining date and the tenant's go-live date (`tenant_settings.go_live_date`).
  Nothing is ever credited before it — a future joiner gets nothing until
  they join.
- **Whole days only** (owner decision): a part-month or part-year credit is
  the prorated share rounded to the nearest day, half up — with 2 days a
  month, a start on the 1st gets 2, mid-month 1, the last few days 0 (the
  next month is still credited in full). Full periods are never rounded, so
  an uneven monthly quota (15/year = 1.25/month) still adds up.
- **ANNUAL** types: one grant per leave year, the quota × the share of the
  year left after the effective start, in whole days.
  Skipped for an employee/type that has an imported `OPENING_BALANCE`.
- **MONTHLY / QUARTERLY** types: one credit per period at the period's
  start, the first prorated by days if the effective start is mid-period.
  Periods align to the leave year (April year → quarters Apr/Jul/Oct/Jan).
  The first period's share is in whole days (above).
- **Cap:** `ACCRUAL` credits in a leave year never exceed the annual
  quota; carried-forward and opening-balance days sit outside the cap.
- **Carry-forward:** in the first week of a new leave year, unused balance
  (`accrued − used`, never negative) rolls over capped by
  `carryForwardCap` as a `CARRY_FORWARD` entry dated the year start.
- **Idempotent:** a period/year/type that already has the ledger entry is
  never credited again, so a re-run, a missed day or two callers racing
  the same day change nothing.
- Comp-off types and separated employees are skipped.

**Recalculate policy credits** (Leave › Settings, Company Admin —
`POST /leave/policy/recalculate`, `LeavePolicyRecalcService`): for the
current leave year, reverses every policy credit (`ACCRUAL_REVERSAL` ledger
entries, dated in the same period so the engine nets them out), optionally
corrects `tenant_settings.go_live_date`, and re-applies the policy — one
transaction. The preview (`dryRun`, the default) runs the same writes and
rolls back, so it shows exactly what Apply will do, including balances that
go negative because leave was already taken. Never touches opening
balances, carry-forward, HR adjustments, comp-off or event-based leave;
repeatable (a second run changes nothing); audited as
`leave.policy_recalculated`.

The old "initialize" endpoint used to grant the full quota with no ledger
entry (and no proration); it now goes through the same engine, so it can't
double-credit against the job.

### 4.4b Event-based leave (maternity, paternity, marriage)

`LeaveType.grantMode = ON_EVENT` (`event-leave.ts`, rules unit-tested on
their own). No yearly balance and the entitlement engine skips these types:
each request names an **event date** and is granted that event's days.

- **Allowance:** `daysPerEvent`, dropping to `reducedDaysPerEvent` from the
  (`reducedAfterEvents` + 1)-th event (maternity: 182 → 84 from the third child).
  Requests with the same event date share one allowance, so maternity can be a
  pre- and a post-delivery request; twins are one paternity event.
- **Limits:** `maxEventsPerEmployment` (marriage 1, paternity 2, maternity
  none); an event counts once any request for it is pending or approved.
- **Window:** start date within [event − `eventWindowDaysBefore`, event +
  `eventWindowDaysAfter`] (maternity: up to 56 days before the expected
  delivery date).
- **Eligibility:** `minServiceDays` = calendar days employed in the 12
  months before the event (maternity 80 — an approximation of the Act's
  "days actually worked"). Gender **fails closed** for these types: a blank
  or unrecognised `Employee.gender` is refused with "ask HR to add it".
- **Days:** `countCalendarDays` (maternity family) or working days
  (paternity, marriage); calendar-day types can't be half days.
- **Proof:** `requiresDocument` blocks final approval until the request has
  an attachment.
- **Money:** never LOP. At final approval the days are granted
  (`EVENT_GRANT` ledger entry) and recorded as used, so the balance row
  nets to zero; cancel reverses both. `statutoryMaternity` + an
  `esicNumber` flags the request "ESI-covered — ESIC usually pays the
  benefit" for HR/payroll (payroll treatment itself is unchanged).
- `GET /leave/event-leave/:employeeId` lists what an employee can still
  take (other-gender types hidden); balances lists only ACCRUED types.

Presets (setup's suggested policy and Leave Types → Add; all editable):
Maternity 182 calendar days (84 from the 3rd child, 56 days before, 80
days' service, document), Adoption and Commissioning mother 84 days,
Miscarriage 42 days (within 7 days after) — per the Maternity Benefit Act
1961 as amended in 2017, from the build's own reading, **not yet reviewed by
a payroll/legal expert**; Paternity 5 working days within 90 days of the
birth, twice; Marriage 7 working days, once, from 15 days before to 30 days
after (owner decisions).

Known limits: earlier children from a previous HRMS can't be imported, so
the "third child" reduction only counts events recorded in Lumen; Leave
Types → Add/Edit now also exposes who can take a type, notice days and paid.

### 4.4a Holidays

Optional holidays (`Holiday.isOptional`) are **working days** for every
company-wide calculation — leave day counts, attendance status,
finalization, payroll and F&F working days all filter `isOptional: false`.
An employee opts in to one through a leave type with
`isRestrictedHoliday` — `apply()` refuses it unless every working day in
the range is an optional holiday. `GET /holidays?year=` is a **leave** year
(an April year spans two calendar years); `?from=&to=` serves month
calendars. `POST /holidays/import` takes `date, name, type` (CSV/XLSX,
`holiday-import.ts`): matched on date + name (re-import updates), never
deletes, rejects ambiguous slash dates, dates outside the current/next
leave year, and new holidays in a payroll-processed month; warns on
weekly-offs, two holidays on one date, and a list that stops early.

### 4.5 Approval routing + escalation

```
apply() → working-day count vs balance → isLop set if short
        → PENDING_L1 (or straight to PENDING_L2 if
          leaveApprovalLevels = 1, or employee has no reportingManagerId)
        → schedule an L1 escalation job for +leaveEscalationDays

L1 approve → PENDING_L2 → schedule a fresh L2 escalation job
L1 reject  → REJECTED (terminal)

L1 escalation fires (undecided) → auto-advance to PENDING_L2,
                                    log LeaveApproval{decision: ESCALATED, approverId: null}

L2 approve → APPROVED → balance deducted (only if !isLop) → LeaveLedgerEntry
           → AttendanceRecord.status = ON_LEAVE written for the working days
L2 reject  → REJECTED (terminal)
L2 escalation fires (undecided) → flag for manual HR follow-up
                                    (no auto-approve at L2 — a human must decide)
```

`LeaveEscalationProcessor` runs both the L1→L2 auto-advance and the L2
manual-follow-up flag on the same BullMQ `leave` queue (Redis — first use of
BullMQ in this repo, per `CLAUDE.md`).

### 4.6 Attendance reconciliation (both directions with module 05)

- **Comp-off credit** (Leave called from Attendance): `AttendanceService
  .clockIn()` detects a `Holiday`/weekly-off day and calls
  `LeaveService.creditCompOff()`, which credits +1 day into the tenant's
  `isCompOff` `LeaveType` — idempotent per employee/day, opt-in per tenant
  (no-op if no type has `isCompOff = true`).
- **`ON_LEAVE` sync** (Attendance called from Leave): approving a request at
  L2 (or the sole level, if `leaveApprovalLevels = 1`) writes
  `AttendanceRecord.status = 'ON_LEAVE'` for the request's working days —
  via **direct Prisma access from `LeaveService`**, deliberately **not** an
  `AttendanceService` import, to avoid a circular module dependency.
  Reversed (rows removed/reset) on cancel.
- Both are **synchronous** (at clock-in time / at approve-cancel time), not
  a nightly finalization job. This is a scope note, not a gap — Attendance's
  own much bigger "nightly finalization" work (module 05 §9 gap 3) is
  unaffected; if that job is ever built, it must treat `ON_LEAVE` rows Leave
  already wrote as authoritative rather than recomputing them.

### 4.7 API surface

| Method | Path | Roles |
|---|---|---|
| `GET` | `/api/leave/types` | any (tenant) |
| `POST` | `/api/leave/types` | Company Admin, HR Manager |
| `PATCH` | `/api/leave/types/:id` | Company Admin, HR Manager |
| `POST` | `/api/leave/types/:id/initialize/:year` ("apply policy now", current leave year only) | Company Admin, HR Manager |
| `GET` | `/api/leave/holidays?year=` (leave year) \| `?from=&to=` | any |
| `POST` | `/api/leave/holidays/import?dryRun=` | Company Admin, HR Manager |
| `POST` | `/api/leave/holidays` | Company Admin, HR Manager |
| `PATCH` / `DELETE` | `/api/leave/holidays/:id` | Company Admin, HR Manager |
| `GET` | `/api/leave/settings` | any |
| `PATCH` | `/api/leave/settings` | Company Admin |
| `GET` | `/api/leave/team/balances?year=` | any (scoped: reports for Line Manager, all for HR/Admin) |
| `POST` | `/api/leave/balances/adjust` | Company Admin, HR Manager |
| `GET` | `/api/leave/balances/ledger?employeeId=&leaveTypeCode=` | Company Admin, HR Manager, Auditor |
| `GET` | `/api/leave/balances/:employeeId?year=` | any (row-scoped); `year` defaults to the tenant's current leave year; accrued types only |
| `GET` | `/api/leave/event-leave/:employeeId` | any (row-scoped) — event-based types still available |
| `POST` | `/api/leave/policy/recalculate` `{ goLiveDate?, dryRun? }` | Company Admin — preview by default |
| `POST` | `/api/leave/requests` | any (tenant) |
| `GET` | `/api/leave/requests?status=&leaveTypeId=&department=&from=&to=` | Company Admin, HR Manager, Auditor |
| `GET` | `/api/leave/requests/employee/:employeeId` | any (row-scoped) |
| `GET` | `/api/leave/requests/pending-approvals` | any (returns `[]` if not an approver) |
| `GET` | `/api/leave/requests/:id` | row-scoped (includes `approvals[]` history) |
| `POST` | `/api/leave/requests/:id/attachment` | owner or Company Admin/HR Manager |
| `POST` | `/api/leave/requests/:id/cancel` | owner, or Company Admin/HR Manager |
| `POST` | `/api/leave/requests/:id/approve` · `/reject` | Line Manager, HR Manager, Company Admin |
| `GET` | `/api/leave/calendar?from=&to=` | any (tenant) |

**Note on route ordering:** `GET /team/balances`, `/balances/adjust`,
`/balances/ledger` are all declared **before** the dynamic
`/balances/:employeeId` in the controller — Nest matches in declaration
order, so a later static route would never be reached otherwise (e.g.
`balances/ledger` would match `:employeeId = "ledger"`). Preserve this
ordering if the controller is ever refactored.

---

## 5. Core flows

### 5.1 Employee applies (happy path)

1. Employee → **Leave** → sees balances per type (`accrued − used`).
2. **Apply** → picks type + from/to dates + reason (+ optional attachment).
3. `POST /leave/requests` → server computes a working-day count (holidays +
   weekly-offs excluded), compares to available balance, sets `isLop = true`
   if short (still creates the request, subject to `allowLopRequests`), and
   routes to `PENDING_L1` (or `PENDING_L2` per §4.5). An L1 escalation job is
   scheduled for `leaveEscalationDays` out.
4. Line Manager → **Pending Approvals** → `POST .../approve` (optional
   `{comment}`) → `PENDING_L2`; a fresh L2 escalation job is scheduled. If
   the manager doesn't act in time, the escalation job auto-advances to
   `PENDING_L2` and logs an `ESCALATED` `LeaveApproval`.
5. HR Manager approves → `APPROVED` — balance deducted **only now**, **only
   if** `!isLop`, logged as a `LeaveLedgerEntry`; `AttendanceRecord.ON_LEAVE`
   written for the working days.
6. Employee sees the request as approved; balance reflects the deduction.
   Cancelling later reverses a non-LOP approved deduction (also ledgered)
   and un-does the `ON_LEAVE` rows.

### 5.2 HR configures a new leave type

1. HR Manager → **Leave Types** → **New type** → name, code, quota,
   carry-forward cap, accrual frequency, gender restriction, notice period,
   comp-off flag.
2. `POST /leave/types` → the nightly job credits every employee what the
   new type's policy owes (§4.4); **Apply now** does the same immediately.

### 5.3 Comp-off credit (cross-module, driven from Attendance)

1. Employee clocks in on a Sunday (or a configured holiday).
2. `AttendanceService.clockIn()` detects the day is a
   holiday/weekly-off → calls `LeaveService.creditCompOff()`.
3. If the tenant has designated an `isCompOff` leave type, +1 day is
   credited, ledgered, idempotent for that employee/day.

### 5.4 HR manual balance adjustment

1. HR Manager → employee's balance → **Adjust** → enters a delta + a
   mandatory note (e.g. "correcting a migration error").
2. `POST /leave/balances/adjust` → `LeaveBalance.accrued`/`used` mutated,
   `LeaveLedgerEntry` written with `source = manual adjustment`,
   `actorUserId` set.

### 5.5 Cancel an approved request

1. Employee (own) or HR/Admin (any) → request detail → **Cancel**.
2. `POST /requests/:id/cancel` → status → `CANCELLED`; if it had been
   `APPROVED` and non-LOP, the deduction is reversed (ledgered) and the
   `ON_LEAVE` `AttendanceRecord` rows for its working days are undone.

---

## 6. Business rules & invariants

- **INV-1** — balance deduction happens **exactly once**, at final approval,
  never at apply time (RULE mirrored from module 03/05's "no speculative
  state mutation" pattern).
- **INV-2** — every balance-affecting event has exactly one corresponding
  `LeaveLedgerEntry`; the balance is always reconstructible by summing the
  ledger for an employee/type/year.
- **INV-3** — a request's approval level only ever moves forward
  (`PENDING_L1 → PENDING_L2 → APPROVED/REJECTED`) or terminates
  (`CANCELLED`) — no going backwards except the explicit escalation
  transition, which is also forward-only.
- **RULE-1** — `minNoticeDays` is enforced against `startDate` at apply
  time, per leave type.
- **RULE-2** — `genderRestriction` enforcement **fails open** when
  `Employee.gender` (free-text, no schema enum) doesn't normalize to exactly
  `MALE`/`FEMALE` — a data-quality gap must never block a legitimate
  employee (module 03's Employee update DTO doesn't currently expose
  `gender` as settable either — unrelated to Leave, only observable here).
- **RULE-3** — `isCompOff` credit is idempotent per employee/day; at most
  one `LeaveType` per tenant is expected to carry the flag (not DB-enforced
  — a tenant that sets it on two types gets undefined which one is credited;
  worth a follow-up constraint, see §12).
- **RULE-4** — cancellation of a non-LOP `APPROVED` request reverses exactly
  the amount originally deducted, symmetric with §5.1 step 5.
- **RULE-5** — escalation at L2 never auto-approves — a human must decide;
  only L1→L2 auto-advances.
- **RULE-7** — entitlement is ledger-idempotent and never credits before
  an employee's effective start (§4.4); annual accrual is capped at the
  quota, carry-forward/opening balances are not.
- **RULE-8** — Restricted Holiday leave is only valid on optional
  holidays; optional holidays are working days for everything else.
- **RULE-6** — `TenantSettings.leaveApprovalLevels` changes apply to
  **new** requests only; in-flight requests keep the routing decided at
  apply time (confirm this is actually true in `apply()` — flagged in §12
  if not yet verified).

---

## 7. States

**`LeaveRequest.status`:** `PENDING_L1 → PENDING_L2 → APPROVED | REJECTED`;
`CANCELLED` reachable from any non-terminal state by the owner or HR/Admin.
**`LeaveApproval.decision`** (append-only, one row per event):
`APPROVED | REJECTED | ESCALATED`.
**`LeaveBalance`:** not a state machine — a running total, reconstructible
from `LeaveLedgerEntry`.

---

## 8. Permission matrix

| Capability | Employee | Line Manager | HR Manager | Company Admin | Auditor |
|---|:--:|:--:|:--:|:--:|:--:|
| View own balances / requests | ✅ | ✅ | ✅ | ✅ | — |
| View team balances | — | reports | all | all | — |
| Apply for leave | ✅ | ✅ | ✅ | ✅ | — |
| Cancel own request | ✅ | ✅ | ✅ | ✅ | — |
| Cancel any request | — | — | ✅ | ✅ | — |
| Approve/reject L1 (own reports) | — | ✅ | ✅ | ✅ | — |
| Approve/reject L2 | — | — | ✅ | ✅ | — |
| Leave types — manage | — | — | ✅ | ✅ | — |
| Holidays — manage | — | — | ✅ | ✅ | — |
| Settings (approval levels, LOP policy, FY start) | — | — | view | ✅ | view |
| Balance manual adjustment | — | — | ✅ | ✅ | — |
| Balance ledger — view | — | — | ✅ | ✅ | ✅ |
| All requests tenant-wide — view | — | — | ✅ | ✅ | ✅ |
| Team calendar | ✅ | ✅ | ✅ | ✅ | — |

---

## 9. Known gaps / TODO

All originally-tracked feature gaps are closed, including the mock-default
flip: `apps/web/src/lib/leave/client.ts`'s `USE_MOCK` now reads
`import.meta.env.VITE_LEAVE_MOCK === 'true'` (inverted default, matching
`access/client.ts`), so a plain `npm run dev` / build runs against the real
API without any env var changes — set `VITE_LEAVE_MOCK=true` to force the
fixture store.

What follows is scope notes, not gaps:

- Comp-off crediting and leave→attendance reconciliation are **synchronous**
  by design (§4.6) — not duplicated by, and not dependent on, Attendance's
  own much bigger "nightly finalization job" gap (module 05 §9 gap 3).
- `genderRestriction` fails open on non-normalized `Employee.gender` (§6
  RULE-2) — a data-quality gap, not a bug, and deliberately not
  fail-closed.
- Emails on apply / approve / reject / cancel / escalation are sent via
  module 10 (Notifications); there's no email when the year-end
  carry-forward runs (it's silent, visible in the ledger).
- Restricted Holiday and opening-balance support landed with company setup
  (module 13); opening balances are only importable during setup — later
  corrections go through Balance Adjustments.

---

## 10. Dependencies

**Upstream:** module 03 Employee Master (`employeeId`,
`reportingManagerId` for approval routing, `dateOfJoining` for accrual
proration, `gender` for the restriction check) · `TENANT_CONFIGURATION.md`
(`Holiday`, `weeklyOffDays`, `fyStartMonth`, `leaveApprovalLevels`,
`leaveEscalationDays`, `allowLopRequests`) · module 09 Documents/Storage
(attachment upload, same key/presign pattern) · Redis/BullMQ (the `leave`
queue — first use of BullMQ in this repo).

**Downstream (consumers of Leave):**
- Module 05 Attendance — comp-off crediting call site (`clockIn()` →
  `creditCompOff()`); `AttendanceRecord.ON_LEAVE` rows written directly by
  this module.
- Module 06 Dashboard — own balances, pending-approvals count, recent
  requests (Line Manager / Employee views).
- Module 07 Payroll (future) — approved-leave days feed LOP computation
  alongside Attendance's own LOP contract (not built yet; the two data
  sources need reconciling when Payroll starts).
- Module 10 Notifications — `LeaveService` / `LeaveEscalationProcessor`
  call `NotificationDispatcher.notify()` on apply, L1/L2 approve, reject,
  cancel and both escalation steps (dedupe keys `leave:<id>:…`).
- Module 11 Reports — leave-derived registers (not built).
- Module 12 Audit — Leave keeps its **own** append-only trails
  (`LeaveApproval`, `LeaveLedgerEntry`) rather than writing the generic
  `audit_log` — see module 12 §"Must-cover write points".

---

## 11. Acceptance criteria / test checklist

- [ ] `apply()` computes working days correctly across a range spanning a
      `Holiday` and a `weeklyOffDays` day (both excluded).
- [ ] A request from an employee with no `reportingManagerId` routes
      straight to `PENDING_L2`.
- [ ] `TenantSettings.leaveApprovalLevels = 1` routes every new request
      straight to `PENDING_L2` (single-level approval).
- [ ] Balance is **not** deducted at apply time; **is** deducted exactly
      once, at final (L2, or sole-level) approval, only if `!isLop`.
- [ ] An undecided L1 auto-escalates to `PENDING_L2` after
      `leaveEscalationDays`, logging an `ESCALATED` `LeaveApproval` with
      `approverId = null`.
- [ ] An undecided L2 does **not** auto-approve — it stays `PENDING_L2` with
      a flag for manual HR follow-up.
- [ ] Cancelling a non-LOP `APPROVED` request reverses the exact deducted
      amount and removes/reset the `ON_LEAVE` `AttendanceRecord` rows for
      its working days.
- [ ] A `LeaveLedgerEntry` exists for every balance-affecting event; summing
      them for an employee/type/year reconstructs the stored balance.
- [ ] Comp-off credit on a holiday/weekly-off clock-in is idempotent — a
      second clock-in that day (if possible) does not double-credit.
- [ ] `genderRestriction = FEMALE` does not block an employee whose
      `gender` field is empty or an unrecognized string (fails open).
- [ ] Cross-tenant: Tenant A's Line Manager cannot approve/reject or view
      Tenant B's requests (RLS + service-layer scoping).
- [ ] A Line Manager cannot approve a request currently at `PENDING_L2`.
- [ ] `GET /balances/ledger` route resolves correctly (not shadowed by the
      dynamic `/balances/:employeeId` route).
- [x] Entitlement: full-year grant, go-live and joining-date proration,
      future joiner, opening balance skips the ANNUAL grant, monthly
      back-credit, mid-month first period, leave-year-aligned quarters,
      quota cap, idempotent re-run, carry-forward capped and once only
      (`leave-entitlement.spec.ts`, `leave-entitlement.service.spec.ts`).
- [x] Daily job skips tenants still in company setup and keeps going when
      one tenant fails (`leave-accrual.processor.spec.ts`).
- [x] Optional holidays don't reduce leave day counts; Restricted Holiday
      leave is allowed on an optional holiday and refused on a working day;
      holidays list by leave year; "apply now" refuses other years;
      holiday import previews without writing and commits valid rows only
      (`leave.service.spec.ts`, `holiday-import.spec.ts`).
- [x] Event-based leave: maternity window/182→84/split requests/service/
      gender fail-closed/no half day; adoption, commissioning mother,
      miscarriage; paternity 5 days within 90 days, 2 events, twins one
      event; marriage 7 working days once; config validation
      (`event-leave.spec.ts`); apply stores the event date and never LOPs,
      calendar-day counting, a missing document blocks approval, approval
      grants then uses, cancel reverses the grant, allowances hide
      other-gender types, balances exclude event types
      (`leave.service.spec.ts`); setup presets + opening balances refused
      for event types (`setup-validation.spec.ts`, `opening-balances.spec.ts`).
- [x] Policy recalculation: re-applies under the whole-day rule, corrects
      go-live, preview changes nothing and isn't audited, repeatable, flags
      negative balances, never touches opening balances, audits an apply,
      rejects a bad go-live (`leave-policy-recalc.service.spec.ts`).
- [x] `GET /balances/me` and `/requests/employee/me` answer 400, not 500
      (`ParseUUIDPipe`; e2e case in `tenant-isolation.e2e-spec.ts`).

---

## 12. Open questions / decisions needed

- **`allowLopRequests = false` behaviour** — does `apply()` currently reject
  the request outright when the balance is short and LOP requests are
  disallowed, or does it still create the request some other way? Confirm
  against `LeaveService.apply()` and tighten this spec once verified.
- **Mid-flight approval-level changes** — if `leaveApprovalLevels` changes
  from 2→1 while requests are `PENDING_L1`, do they stay on the 2-level path
  they started on, or does the next approval action re-evaluate against the
  new setting? (RULE-6 assumes "stays as decided at apply time" — verify.)
- **`isCompOff` multiplicity** — should the schema gain a partial unique
  index (`@@unique([tenantId, isCompOff]) where isCompOff = true`) or
  equivalent app-level guard, now that it's live and a tenant could
  misconfigure two types?
- **Leave encashment** — genuinely out of scope for this module, or should a
  `LeaveType.encashable` flag be added here even though the actual payout
  computation lives in Payroll (module 07)? No decision made yet.
- **Line-Manager visibility depth** — direct reports only, or the full
  recursive subtree (same open question as modules 03 and 05)?
