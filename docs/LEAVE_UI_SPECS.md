# Leave Module — UI Specs & API Contract

> **Purpose:** the per-screen handoff for the parallel team. The frontend for
> this module is being built first, screen-by-screen, role-by-role. This file
> is the contract the backend builds to and the tester writes cases against.
>
> Read alongside `docs/MODULE_SPECS.md` §4 (product behaviour + known gaps) and
> `CLAUDE.md` (guard chain, tenancy). **Last updated:** 2026-09-09.

## How the frontend runs today

Every Leave screen talks to `apps/web/src/lib/leave/client.ts` (`leaveApi`),
never `api` directly. That client has two modes:

| Mode | Trigger | Behaviour |
|---|---|---|
| **Mock** (default) | `VITE_LEAVE_MOCK` unset or `!= "false"` | All calls served from `apps/web/src/lib/leave/fixtures.ts`, mutations persist in-memory for the session. A "Mock data" chip shows in the page header. |
| **Live** | `VITE_LEAVE_MOCK=false` | Every `leaveApi` method now hits a real, mapped endpoint — no `planned` ones remain. Set this in `apps/web/.env`. |

Each `leaveApi` method's JSDoc names its endpoint and marks it `live` or
`planned`. Types are in `apps/web/src/lib/leave/types.ts` — promote these into
`packages/shared-types` when the backend picks the module up.

## Endpoint inventory

All endpoints below are **live** in `apps/api/src/leave`, with
`apps/web/.env` now setting `VITE_LEAVE_MOCK=false` so the frontend actually
talks to them. `LeaveService` now maps every response into the frontend's
denormalized shape itself (`toRequestDto`/`toApprovalStep`/`toBalanceDto`/
`toLedgerDto`) — the "contract deltas" that used to require client-side
adapter code are closed (see below).

| Method | Path | Notes |
|---|---|---|
| GET | `/api/leave/types` | `?includeInactive=true` to include soft-deleted types |
| POST | `/api/leave/types` | Admin/HR. Persists the full frontend `LeaveType` shape, including `requiresApproval` and `isCompOff`. |
| PATCH | `/api/leave/types/:id` | Admin/HR — same field set as create |
| POST | `/api/leave/types/:id/initialize/:year` | Admin/HR |
| GET | `/api/leave/holidays?year=` | any (read) |
| POST · PATCH · DELETE | `/api/leave/holidays(/:id)` | Admin/HR |
| GET | `/api/leave/settings` | any (read) |
| PATCH | `/api/leave/settings` | Company Admin only (per the role matrix below — HR reads, Company Admin edits). `allowLopRequests` and `fyStartMonth` are now enforced by `apply()`, not just stored. |
| GET | `/api/leave/balances/:employeeId?year=` | row-scoped. `year` optional — defaults to the tenant's current leave year via `fyStartMonth` (see `resolveLeaveYear` in `leave-year.util.ts`), not the calendar year. |
| GET | `/api/leave/team/balances?year=` | scoped: direct reports (Line Manager) / everyone (HR, Admin); same `year` default as above |
| POST | `/api/leave/balances/adjust` | Admin/HR — body `BalanceAdjustmentInput` → returns a denormalized `LeaveLedgerEntry` |
| GET | `/api/leave/balances/ledger?employeeId=&leaveTypeCode=` | Admin/HR/Auditor — note **`leaveTypeCode`**, matching the frontend field name |
| POST | `/api/leave/requests` | Enforces `LeaveType.minNoticeDays`, `TenantSettings.allowLopRequests`, and `LeaveType.genderRestriction` (fails open if `Employee.gender` doesn't normalize to `MALE`/`FEMALE`) — all 400 on violation. On final (L2) approval, also writes `AttendanceRecord.ON_LEAVE` for the request's working days (reversed on cancel). |
| GET | `/api/leave/requests?status=&leaveTypeId=&department=&from=&to=` | Admin/HR/Auditor. No `q=` free-text search yet — do client-side filtering on the returned page for now. |
| GET | `/api/leave/requests/:id` | row-scoped, `approvals` returned flattened (`approverName`/`approverRole`/...) |
| POST | `/api/leave/requests/:id/attachment` | owner or Admin/HR — multipart `file`, mirrors the Employee Documents upload |
| POST | `/api/leave/requests/:id/cancel` | owner or Admin/HR |
| POST | `/api/leave/requests/:id/approve` · `/reject` | approver — accepts an optional `{ comment }` body, recorded on the `LeaveApproval` row |
| GET | `/api/leave/requests/employee/:employeeId` | row-scoped |
| GET | `/api/leave/requests/pending-approvals` | `[]` for non-approvers |
| GET | `/api/leave/calendar?from=&to=` | frontend maps rows to `TeamCalendarEntry` |

> **Route-order note:** `leave.controller.ts` declares the static
> `balances/ledger` / `balances/adjust` / `team/balances` routes *before*
> the dynamic `balances/:employeeId` — Nest matches in declaration order,
> so the static routes must come first or `:employeeId` silently swallows
> them (this was a live bug, found and fixed while wiring the frontend to
> the live API — see git history).

### Contract deltas — closed

`LeaveType` (`code`, `colorToken`, `minNoticeDays`, `active`,
`genderRestriction`, `paid`, `requiresApproval`, `isCompOff`),
`LeaveBalance` (`carriedForward`/`pending` now computed server-side),
`LeaveRequest.approvals` (flattened), and `LeaveLedgerEntry`/balance-adjust
response (denormalized) all round-trip correctly now — no client-side
adapter needed beyond what `leaveApi` already does. Nothing remains open.

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
| **Overall (Leave FE)** | `████████████████████` 100% | ✅ done |
| Foundation (primitives, role nav, `lib/leave` contract/mock) | `████████████████████` 100% | ✅ done |
| Employee — Overview, Apply, My Requests, Holidays (read) | `████████████████████` 100% | ✅ done |
| Line Manager — Approvals (L1), Team Calendar, Team Balances | `████████████████████` 100% | ✅ done |
| HR / Company Admin — All Requests, Approvals (L2), Leave Types CRUD + initialize, Holidays manage, Balance Adjustments, Settings | `████████████████████` 100% | ✅ done |
| Auditor — read-only All Requests, Leave Types, Balance Ledger, Settings | `████████████████████` 100% | ✅ done (same components, `readOnly` prop) |

All 12 role×tab cells are now wired to `leaveApi` and running **live**
(`VITE_LEAVE_MOCK=false` in `apps/web/.env`) — the response-shape deltas
that used to block this are closed (see above).

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
`GET team/balances?year` + `GET types` for columns. Matrix: row per
report, column per leave type, cell = days available
(`accrued + carried − used − pending`). Amber ≤ 2 days, red < 0. Row expands to
the per-type accrued/carried/used/pending breakdown. Year switcher.

### Screen contracts — HR / Company Admin / Auditor (built)

**All Requests** (`tabs/all-requests.tsx`, shared with Auditor read-only)
Already documented in the Employee/Line Manager section above by
implementation — wired into the tab shell as of this pass. `readOnly` hides
the detail sheet's decide action for Auditor.

**Leave Types** (`tabs/leave-types.tsx`)
`GET types` table (name, annual quota, carry-forward cap, accrual frequency,
requires-approval). Admin-only: **Add type** / **Edit** dialogs (`POST`/`PATCH
types`) expose 6 fields as form inputs (name, annual quota, carry-forward
cap, accrual frequency, requires-approval, "this is the comp-off type") —
`code`/`colorToken` are auto-derived on create,
`genderRestriction`/`paid`/`minNoticeDays`/`active` still default silently
(`ANY`/`true`/`0`/`true`). All of these persist correctly server-side (no
contract delta), there's just no form UI for the latter four yet — add one
if a customer needs to configure them directly. Per-row **Initialize
year** dialog → `POST types/:id/initialize/:year`. Auditor: table only, no
actions.

**Balance Adjustments** (`tabs/balance-adjustments.tsx`, Admin-only — not
shown to Auditor)
A form (employee, leave type, year, signed delta, note) → `POST
balances/adjust`; below it, a history table filtered client-side from
`GET balances/ledger` to `source === 'HR_ADJUSTMENT'`, refetched after every
submit.

**Balance Ledger** (`tabs/ledger.tsx`, shared with Auditor — always read-only
regardless of role)
Filter bar (employee, leave type) over `GET balances/ledger`; table with
colored credit/debit deltas and a source `Badge`.

**Settings** (`tabs/settings.tsx`)
`GET`/`PATCH settings` — approval levels (1 or 2), allow-LOP-requests
checkbox, fiscal-year-start-month. Company Admin edits; everyone else who can
reach the tab (Auditor) sees the same form disabled, no Save button.

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
- Adding/editing a leave type reflects immediately in that table and in the
  Apply tab's type dropdown; Initialize year toasts the seeded-employee count.
- A balance adjustment appears in both its own screen's history and the
  Ledger tab with `source: HR_ADJUSTMENT`.
- Auditor sees Balance Ledger and Leave Types read-only, does **not** see
  Balance Adjustments in the tab bar at all, and Settings renders disabled
  with no Save button.
- Verified end-to-end against a real login (Firebase + seeded `acme` tenant)
  as HR Manager, Company Admin, and Auditor — not just mock-mode unit checks.
- Live-mode (`VITE_LEAVE_MOCK=false`) apply → L1 approve → L2 approve →
  cancel round-trip verified directly against the API, including the
  ledger entry and balance credit/reversal.
- `allowLopRequests=false` blocks an LOP-inducing apply with a 400;
  `LeaveType.minNoticeDays` blocks a too-soon apply with a 400.
- Creating a leave type with `genderRestriction`/`paid` set now persists
  and round-trips through `GET types`.
