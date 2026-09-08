# Leave Module — UI Specs & API Contract

> **Purpose:** the per-screen handoff for the parallel team. The frontend for
> this module is being built first, screen-by-screen, role-by-role. This file
> is the contract the backend builds to and the tester writes cases against.
>
> Read alongside `docs/MODULE_SPECS.md` §4 (product behaviour + known gaps) and
> `CLAUDE.md` (guard chain, tenancy). **Last updated:** 2026-09-08.

## How the frontend runs today

Every Leave screen talks to `apps/web/src/lib/leave/client.ts` (`leaveApi`),
never `api` directly. That client has two modes:

| Mode | Trigger | Behaviour |
|---|---|---|
| **Mock** (default) | `VITE_LEAVE_MOCK` unset or `!= "false"` | All calls served from `apps/web/src/lib/leave/fixtures.ts`, mutations persist in-memory for the session. A "Mock data" chip shows in the page header. |
| **Live** | `VITE_LEAVE_MOCK=false` | `live` endpoints hit the real API; `planned` ones 404 until built. |

Each `leaveApi` method's JSDoc names its endpoint and marks it `live` or
`planned`. Types are in `apps/web/src/lib/leave/types.ts` — promote these into
`packages/shared-types` when the backend picks the module up.

## Endpoint inventory

All endpoints below are now **live** in `apps/api/src/leave` — flip
`VITE_LEAVE_MOCK=false` to point the frontend at them. A few response-shape
deltas remain (see below) that the frontend's `leaveApi` client will need
light adapter code for, rather than a raw pass-through.

| Method | Path | Notes |
|---|---|---|
| GET | `/api/leave/types` | |
| POST | `/api/leave/types` | Admin/HR. Accepts `accrualFrequency` now; other FE-only fields still not stored (see deltas). |
| PATCH | `/api/leave/types/:id` | Admin/HR |
| POST | `/api/leave/types/:id/initialize/:year` | Admin/HR |
| GET | `/api/leave/holidays?year=` | any (read) |
| POST · PATCH · DELETE | `/api/leave/holidays(/:id)` | Admin/HR |
| GET | `/api/leave/settings` | any (read) |
| PATCH | `/api/leave/settings` | Company Admin only (per the role matrix below — HR reads, Company Admin edits) |
| GET | `/api/leave/balances/:employeeId` | row-scoped. Does **not** yet take `?year=` (returns all years, `orderBy year desc`) — frontend can filter client-side. |
| GET | `/api/leave/team/balances?year=` | scoped: direct reports (Line Manager) / everyone (HR, Admin) |
| POST | `/api/leave/balances/adjust` | Admin/HR — body `BalanceAdjustmentInput` → returns a `LeaveLedgerEntry` (raw Prisma shape, see deltas) |
| GET | `/api/leave/balances/ledger?employeeId=&leaveTypeId=` | Admin/HR/Auditor — note **`leaveTypeId`**, not `leaveTypeCode` (no `code` field exists yet) |
| POST | `/api/leave/requests` | |
| GET | `/api/leave/requests?status=&leaveTypeId=&department=&from=&to=` | Admin/HR/Auditor. No `q=` free-text search yet — do client-side filtering on the returned page for now. |
| GET | `/api/leave/requests/:id` | row-scoped, includes `approvals` (raw `LeaveApproval[]` — see deltas) |
| POST | `/api/leave/requests/:id/attachment` | owner or Admin/HR — multipart `file`, mirrors the Employee Documents upload |
| POST | `/api/leave/requests/:id/cancel` | owner or Admin/HR |
| POST | `/api/leave/requests/:id/approve` · `/reject` | approver — accepts an optional `{ comment }` body, recorded on the `LeaveApproval` row |
| GET | `/api/leave/requests/employee/:employeeId` | row-scoped |
| GET | `/api/leave/requests/pending-approvals` | `[]` for non-approvers |
| GET | `/api/leave/calendar?from=&to=` | frontend maps rows to `TeamCalendarEntry` |

### Contract deltas still open
- **`LeaveType`** — frontend model additionally wants `code`,
  `genderRestriction`, `minNoticeDays`, `paid`, `active`, `colorToken`.
  `accrualFrequency` is now modelled; the rest are still frontend-only —
  low priority until a customer asks (`docs/MODULE_SPECS.md` §4 gap 4).
- **`LeaveBalance`** — backend returns the raw `{ accrued, used, year,
  leaveType }` row; it does **not** compute `carriedForward` or `pending`
  (approved-but-future + in-flight days) — the frontend's client-side
  `pending` math is still load-bearing here.
- **`LeaveRequest.approvals`** — backend returns raw `LeaveApproval` rows
  (`{ level, approverId, approver: Employee | null, decision, decidedAt,
  comment }`) rather than the frontend's flattened `{ approverName,
  approverRole, ... }` — the client needs a small mapper (approverRole
  isn't stored on the approval row at all; look it up from the approver's
  employee/user record, or omit it).
- **`LeaveLedgerEntry` / balance-adjust response** — backend returns the
  raw Prisma row (`employeeId`, `leaveTypeId`, `occurredAt`, `actorUserId`)
  rather than the frontend's denormalized `{ employeeName, leaveTypeCode,
  at, actorName }` — needs a join/mapper on the client or a future backend
  denormalization pass.

## Screens by role

Tab visibility is centralised in `apps/web/src/pages/leave/index.tsx`
(`TAB_DEFS`) and `apps/web/src/lib/roles.ts`.

| Tab | Employee | Line Manager | HR Manager | Company Admin | Auditor |
|---|:--:|:--:|:--:|:--:|:--:|
| Overview | ✅ | ✅ | ✅ | ✅ | — |
| Apply | ✅ | ✅ | ✅ | ✅ | — |
| My Requests | ✅ | ✅ | ✅ | ✅ | — |
| Approvals | — | ✅ (L1) | ✅ (L2) | ✅ (L2) | — |
| Team Calendar | — | ✅ | ✅ | ✅ | — |
| Team Balances | — | ✅ | ✅ | ✅ | — |
| All Requests | — | — | ✅ | ✅ | ✅ (read-only) |
| Leave Types | — | — | ✅ | ✅ | ✅ (read-only) |
| Balance Adjustments | — | — | ✅ | ✅ | — |
| Balance Ledger | — | — | ✅ | ✅ | ✅ (read-only) |
| Holidays | ✅ (read) | ✅ (read) | ✅ (manage) | ✅ (manage) | ✅ (read) |
| Settings | — | — | ✅ (read) | ✅ (edit) | ✅ (read) |

### Build progress

> Update these bars on every change to the Leave UI. Overall = share of the
> role×tab matrix above that is built and wired to `leaveApi`.

| Slice | Bar | State |
|---|---|---|
| **Overall (Leave FE)** | `██████████████░░░░░░` ~72% | in progress |
| Foundation (primitives, role nav, `lib/leave` contract/mock) | `████████████████████` 100% | ✅ done |
| Employee — Overview, Apply, My Requests, Holidays (read) | `████████████████████` 100% | ✅ done |
| Line Manager — Approvals (L1), Team Calendar, Team Balances | `████████████████████` 100% | ✅ done |
| HR / Company Admin — All Requests, Approvals (L2), Leave Types CRUD + initialize, Holidays manage, Balance Adjustments, Settings | `░░░░░░░░░░░░░░░░░░░░` 0% | next |
| Auditor — read-only All Requests, Leave Types, Balance Ledger | `░░░░░░░░░░░░░░░░░░░░` 0% | queued |

When a slice completes, also move the module bar in `docs/MODULE_SPECS.md` §
status table (row 4) to match.

### Screen contracts — Employee (built)

**Overview** (`tabs/overview.tsx`)
`GET balances/:me?year` + `GET requests/employee/:me` + `GET holidays?year`.
Balance tiles (available big, accrued/carried/used/pending breakdown), three
mini-stats (in-flight count, next approved leave, next holiday), recent
activity list → opens detail sheet. Loading: skeletons. Empty: prompt to Apply.

**Apply** (`tabs/apply.tsx`)
Form: leave type, start, end, half-day (single-day only), reason. Live preview
via `previewRequest` (client-side math mirroring server `apply()`): duration,
balance before→after, first approver, LOP warning with LOP day count. Notice
check against `LeaveType.minNoticeDays`. Right pane: `LeaveMonthCalendar` with
company holidays + team approved/pending leave, proposed range highlighted.
Submit → `POST requests` → toast → reset → bumps a refresh key siblings watch.
Errors: end-before-start caught client-side; API errors surfaced inline.

**My Requests** (`tabs/my-requests.tsx`)
`GET requests/employee/:me`. Status filter chips with counts. Table
(type, dates, days, requested, status + LOP). Row → detail sheet; if
`PENDING_L1|PENDING_L2`, sheet offers **Withdraw** → `POST .../cancel`.

**Holidays** (`tabs/holidays.tsx`, shared with HR)
`GET holidays?year` with a year switcher. Table (date, weekday, name,
gazetted/optional). `canManage` (HR/Admin) adds "Add holiday" dialog and
per-row delete → `POST/DELETE holidays`. Past dates dimmed.

### Screen contracts — Line Manager (built)

**Approvals** (`tabs/approvals.tsx`, shared with HR for L2)
`GET requests/pending-approvals`. The acted-on level comes from each row's
status (`PENDING_L1` → manager, `PENDING_L2` → HR), so one screen serves both.
Table: select-all + per-row checkbox, employee + dept, type + LOP, dates (½
marker), days, submitted, inline Reject / Approve. Multi-select → **Approve
selected** (loops `POST .../approve`; backend should add a bulk endpoint).
Row → detail sheet with a **comment** box → `POST .../{approve|reject}` with
`{ comment }` (planned body). On decision: toast + reload + bumps the shared
refresh key so Overview / My Requests / Team views update.

**Team Calendar** (`tabs/team-calendar.tsx`)
`GET calendar?from=&to=` (month window) + `GET holidays?year`. Full-width
`LeaveMonthCalendar` (holidays + weekly-offs + one chip per person per leave
day; pending entries rendered faded) with a side list of the month's entries
(name, range, type, status). Scope by role: Line Manager → direct reports;
HR / Company Admin → whole company.

**Team Balances** (`tabs/team-balances.tsx`)
`GET team/balances?year` (planned) + `GET types` for columns. Matrix: row per
report, column per leave type, cell = days available
(`accrued + carried − used − pending`). Amber ≤ 2 days, red < 0. Row expands to
the per-type accrued/carried/used/pending breakdown. Year switcher.

## Test hooks (for the QA hire)

- Log in as each seeded role (`acme` tenant, password `Passw0rd!123`) — the
  Leave nav tab and its sub-tabs must match the matrix above exactly.
- Mock mode: applying leave then visiting Overview / My Requests must show the
  new row (shared `refreshKey`). Withdrawing must flip status to Cancelled.
- LOP: request more days than the balance shows → preview must warn and the
  created request carries `isLop`.
- Auditor must never see a mutating control (no Apply, no Add holiday, no
  approve/reject, no adjust).
- Line Manager Approvals: only `PENDING_L1` items for their reports appear.
  Approving an L1 item (2-level tenant) moves it to `PENDING_L2`, not
  `APPROVED`; rejecting ends it. Bulk approve acts on every checked row.
- After a manager decision, the employee's My Requests / Overview reflect the
  new status without a manual refresh.
- Team Calendar / Team Balances scope: Line Manager sees only reports; HR /
  Company Admin see everyone.
