# 06 — Dashboard — Module Source of Truth

> **This file is the authoritative, detailed spec for further development of
> this module.** `docs/MODULE_SPECS.md` §6 is the one-page summary; the UI
> build prompt is `docs/ui-build-prompts/06-dashboard.md`.
>
> **Status:** ✅ 100%. One role-branched endpoint (`GET /api/dashboard`)
> renders every live role's home screen — org aggregates for
> Company Admin/HR Manager, a personal leave + attendance view for
> everyone else — plus a shared own-attendance "today" snapshot for anyone
> with a linked employee record, gated on the tenant's `ATTENDANCE` plan
> entitlement. The two items intentionally **not** built — an upcoming
> payslip date and admin payroll-cost/attrition tiles — are blocked on
> Payroll (module 07, not started) and are not counted against 100%, the
> same treatment `docs/MODULE_SPECS.md` already gives Attendance's own
> Payroll-blocked items (overtime-to-pay conversion, `getLopDays`).
> **Read** endpoint stays a single composed `GET /api/dashboard` (§4.1); the
> frontend additionally offers **quick actions** — clock in/out + break
> toggle, and approve/reject on a pending leave request — that call
> Attendance's and Leave's *own already-existing* endpoints directly (§4.6),
> not a new Dashboard-owned mutation surface.
> **Code:** `apps/api/src/dashboard` (`DashboardController`, no separate
> service — the controller composes `LeaveService` + `AttendanceService` +
> a direct `TenantPrismaService` read), `apps/web/src/pages/dashboard.tsx`.
> **Related:** `docs/MODULE_SPECS.md` §6 · module `04_LEAVE_MANAGEMENT.md`
> (`pendingApprovals`, `getBalances`, `listForEmployee` — this module reads
> them, doesn't own them) · module `05_ATTENDANCE.md` (`AttendanceService
> .today()` — this module's only other read dependency) ·
> `docs/TENANT_CONFIGURATION.md` (the `ATTENDANCE` entitlement gate) ·
> module `07_PAYROLL_ENGINE.md` (not built — the two remaining blocked
> tiles) · module `11_REPORTS_AND_ANALYTICS` *(not yet written as its own
> deep spec — `MODULE_SPECS.md` §11 notes the Dashboard aggregates are
> currently its only implemented content)*.
> **Last synced to code:** 2026-09-22 (quick-actions pass, same day).

---

## 1. Purpose & scope

A single role-aware home screen at `/`. The **server**, not the frontend,
decides what a signed-in user sees — one endpoint (`GET /api/dashboard`)
branches on `user.role` and returns a shaped payload, so "what does an HR
Manager see vs. an Employee" lives in one place instead of being assembled
from several frontend-side calls per role.

**In scope (V1):** admin org aggregates (headcount, department breakdown,
pending-approvals count); a personal view (own leave balances, own pending
approvals — non-empty for a Line Manager with reports awaiting L1, own 5
most recent leave requests); an own-attendance "today" snapshot shared by
both views, entitlement-gated; quick actions on that snapshot (clock in,
clock out, start/end break) and on each pending-approval row (approve,
reject) — every action is a direct call to Attendance's or Leave's existing
endpoint (§4.6), followed by a full re-fetch of `GET /api/dashboard` (no
optimistic local state, no dashboard-owned mutation logic).

**Out of scope / deferred:** anything that requires Payroll (module 07, not
started) — an upcoming payslip date, payroll cost, attrition rate, average
tenure. These are **the** remaining line items on Dashboard's original
feature list and stay unbuilt because their data source doesn't exist yet,
not because of a scope cut. Revisit once module 07 lands.

---

## 2. User personas & their role in this module

| Persona | Why they touch this module | What they see | What they cannot do |
|---|---|---|---|
| **Company Admin / HR Manager** | Lands here after login for an org-level pulse. | Headcount, department breakdown, pending-approvals count (org-wide), own attendance "today" snapshot (with inline **clock in/out**/**break** buttons — §4.6). | Cannot see other individuals' attendance/leave detail from this screen — that's Employee Master / Leave / Attendance's job; the admin view has no per-request list to act on (only the count), so approve/reject isn't reachable from here for this role. |
| **Line Manager** | Lands here after login; needs to know what's waiting on them. | Own leave balances, pending approvals from direct + recursive reports (with inline **Approve**/**Reject** buttons — §4.6), own 5 most recent leave requests, own attendance "today" snapshot (with inline **clock in/out**/**break** buttons). | Cannot see anyone else's attendance/leave detail beyond the pending-approval summary row; the full decision history/comment trail still lives on Leave's own Approvals screen — the dashboard's buttons are a quick path, not a replacement for it. |
| **Employee** | Default landing screen. | Own leave balances, own pending items (e.g. a cancellation awaiting their own action, if any), own 5 most recent leave requests, own attendance "today" snapshot. | Cannot see anyone else's data — every field here is `user.employeeId`-scoped. |
| **Auditor** (read-only) | No dedicated dashboard behavior defined. | Falls through to the personal-view branch (not an admin role) with an empty/near-empty personal view, since an Auditor typically has no `employeeId`. Not a designed experience — see §12. | — |
| **Platform Admin** | Out of scope — separate console (`/platform-admin`), never hits this endpoint (no tenant `employeeId`). | — | — |

### How each persona actually uses it (today)

- **Company Admin / HR Manager:** logs in → dashboard shows org headcount,
  a department-breakdown bar list, and a pending-approvals count tile →
  clicks through to Leave/Employee Master for detail. If they also have a
  linked `Employee` record (common for a small-company Company Admin who is
  also an employee), they additionally see their own attendance card.
- **Line Manager / Employee:** logs in → sees leave balances, a pending-
  approvals list (Line Manager only — non-empty when reports have requests
  awaiting L1), and their 5 most recent leave requests, plus their own
  attendance "today" card above the grid.

---

## 3. Functional expectations (definition of done)

1. **One endpoint, server-decided shape.** `GET /api/dashboard` is the only
   call the frontend makes to render the home screen; the response's
   `view` discriminant (`'admin' | 'employee'`) tells the frontend which
   layout to render — no client-side role branching for *what data to
   fetch*, only for *how to lay it out*.
2. **The attendance snapshot is universal, not role-gated.** Every caller
   with a linked `employeeId` gets their own `todayAttendance`, on both the
   `admin` and `employee` response shapes — an admin who is also an
   employee (small-company Company Admin, common case) sees their own
   clock-in state exactly like anyone else. Scoped to the *caller's own*
   record — there is no "team attendance today" tile here (that's
   Attendance module's own **Team** tab, module 05 §5.5).
3. **Entitlement-respecting.** A tenant on a plan without the `ATTENDANCE`
   module never receives `todayAttendance` data — the field comes back
   `null`, not an error and not silently-wrong data. Dashboard has no
   single `@RequiresModule` decorator (its response shape legitimately
   varies per role, unlike a module whose every route needs the same
   entitlement), so this check is inline, reading
   `platform.subscriptions.enabledModules` the same way `EntitlementGuard`
   does (see §4.3) — kept in sync with that guard's behavior deliberately.
4. **No feature invented ahead of its data source.** Payslip date and
   payroll/attrition tiles are not stubbed, mocked, or `TODO(api)`-ed on
   the frontend — they simply don't render, because Payroll doesn't exist.
   Contrast with, e.g., Attendance's `TODO(api)` manager screens (module 05
   §9), which render disabled controls against a real spec because the
   *screen* is designed even though the *backend* isn't — Dashboard has no
   such screen designed yet for Payroll data, so there's nothing to render
   as a placeholder.
5. **Quick actions call the owning module's endpoint, never a Dashboard-
   specific one.** Clock in/out/break and leave approve/reject are Attendance's
   and Leave's own authorization, validation, and audit paths (module 05 §4.4,
   module 04 §4) — Dashboard adds no new backend route, no new
   `DecideLeaveDto`/business rule, and no bypass of either module's
   `@Roles`/row-scoping. After any action, the frontend re-fetches the whole
   `GET /api/dashboard` payload rather than patching local state — the
   server-computed shape stays the single source of truth (§3 item 1).

---

## 4. Technical design

### 4.1 No dedicated service — a composing controller

Unlike every other module in this codebase, `DashboardController` has no
`DashboardService`. It composes three existing read paths directly:

- `TenantPrismaService.client.employee.count()` /
  `.department.findMany()` — org aggregates, admin view only.
- `LeaveService.pendingApprovals()` / `.getBalances()` /
  `.listForEmployee()` — both views (module 04 owns the row-scoping logic
  behind these; Dashboard just calls them with the current `user`).
- `AttendanceService.today()` — both views, when entitled (§4.3).

This is deliberate: Dashboard has no business logic or invariants of its
own to enforce — it's a read-only aggregation of other modules' already-
scoped data. A service layer here would just be a pass-through.

### 4.2 Row scoping

Dashboard performs no row-scoping of its own. Every read either:
- goes through `LeaveService`, which applies its own `scopeFor(user)`
  (Line Manager → recursive-subtree reports; Employee → own record only —
  module 04), or
- goes through `AttendanceService.today(user)`, which resolves
  `user.employeeId` internally and throws `BadRequestException` if absent
  (caught here by checking `user.employeeId` before calling — Dashboard
  treats "no linked employee" as "no snapshot", not an error), or
- is the admin-only org-wide aggregate (`employee.count()`,
  `department.findMany()`), correctly unscoped by employee since it's a
  tenant-wide count already isolated by RLS (`app.current_tenant_id`).

### 4.3 Attendance entitlement gate

```ts
private async hasAttendanceEntitlement(tenantId: string): Promise<boolean> {
  const subscription = await this.platformPrisma.subscription.findUnique({ where: { tenantId } });
  return subscription?.enabledModules.includes('ATTENDANCE') ?? false;
}
```

This queries `platform.subscriptions` via the injected (`@Global`)
`PlatformPrismaClientProvider` — the same table `EntitlementGuard` reads for
`@RequiresModule('ATTENDANCE')`-decorated routes (Attendance's own
controller, module 05 §4). Dashboard can't use `@RequiresModule` at the
controller level because the *whole route* must still succeed for a tenant
without `ATTENDANCE` — only the one field is conditional. If this check and
`EntitlementGuard`'s ever diverge, that's a bug to fix, not an intentional
difference — they exist to answer the identical question ("does this
tenant's plan include Attendance?").

### 4.4 API surface

| Method | Path | Notes |
|---|---|---|
| `GET` | `/api/dashboard` | `JwtAuthGuard + TenantGuard` only (no `@Roles` — every authenticated tenant user gets a response, just shaped differently). Returns `{ view: 'admin', headcount, departmentBreakdown, pendingApprovalsCount, todayAttendance }` for `COMPANY_ADMIN`/`HR_MANAGER`, or `{ view: 'employee', leaveBalances, pendingApprovals, myRecentRequests, todayAttendance }` for everyone else. `todayAttendance` is `{ status, checkInAt, checkOutAt, isOnBreak, effectiveMs, targetHours } \| null` — `null` when the caller has no linked employee or the tenant lacks the `ATTENDANCE` entitlement. |

### 4.5 `todayAttendance` shape

Derived 1:1 from `AttendanceService.today(user)` (module 05 §4.4's
`GET /attendance/today` — Dashboard calls the same service method directly
rather than re-implementing it):

```ts
{
  status: AttendanceStatus | null;   // null if no AttendanceRecord yet today
  checkInAt: Date | null;
  checkOutAt: Date | null;
  isOnBreak: boolean;
  effectiveMs: number;               // worked time so far, excl. breaks
  targetHours: number;               // from the resolved Shift
}
```

The frontend derives its own display state (not clocked in / working / on
break / day complete) from these fields rather than the API sending a
pre-rendered label — same "server sends data, frontend renders" split the
rest of the app follows.

### 4.6 Quick actions (frontend-only wiring, no new backend surface)

`apps/web/src/pages/dashboard.tsx` calls two *existing* endpoint families
directly (`src/lib/api.ts`'s plain `api.post`, not the `leaveApi`/attendance
client wrappers those modules' own pages use — Dashboard has no per-module
context to construct, so it hits the HTTP surface directly):

| Action | Calls | Guard already enforced by that endpoint |
|---|---|---|
| Clock in | `POST /attendance/clock-in` | self-service, any authenticated tenant user with `employeeId` (module 05 §4.4) |
| Clock out | `POST /attendance/clock-out` | same |
| Start / end break | `POST /attendance/break/start` \| `/break/end` | same |
| Approve a pending leave request | `POST /leave/requests/:id/approve` | `@Roles('LINE_MANAGER','HR_MANAGER','COMPANY_ADMIN')` (module 04 §4) |
| Reject a pending leave request | `POST /leave/requests/:id/reject` | same |

Buttons render with the exact same enable/disable rules Attendance's own
Today card uses (module 05 §5.1): Clock In only when not clocked in; Take/
End Break only while clocked in; Clock Out disabled while on break. The
approve/reject buttons on a pending-approval row render with no separate
confirm step or reason field — this **mirrors the existing precedent** in
`apps/web/src/pages/leave/tabs/approvals.tsx`'s row-level decide buttons
(`DecideLeaveDto.comment` is optional server-side either way), not a new
UX convention invented for Dashboard. Every action shows a toast
(`useToast()`) on failure with the server's error message, and both success
and failure paths re-run `GET /api/dashboard` before releasing the busy
state, so the whole screen — attendance card, balances, approvals list —
reflects the new state, not just the row that changed.

**Not built:** a comment/reason box for reject (Leave's own Approvals tab
is still the place for that), bulk-approve from the dashboard, and any
action on someone else's attendance record (Attendance's Team tab, module
05 §5.5, remains the only place for that).

---

## 5. Core flows

### 5.1 Any user, landing on `/`

1. `GET /api/dashboard`.
2. Server resolves `user.role` → branches to admin aggregates or personal
   view; in parallel (or as a preceding await), resolves
   `todayAttendance` if `user.employeeId` is set and the tenant's plan
   includes `ATTENDANCE`.
3. Frontend renders the shared `TodayAttendanceCard` (if `todayAttendance`
   is non-null) above the role-specific grid, then the admin or employee
   grid.

### 5.2 Tenant without the `ATTENDANCE` entitlement

1. Same request, same branching.
2. `hasAttendanceEntitlement()` returns `false` →
   `AttendanceService.today()` is never called → `todayAttendance: null`.
3. Frontend renders nothing for that slot — no empty card, no upsell
   banner (V1 scope; an "upgrade to unlock Attendance" prompt is a product
   decision for later, not built).

### 5.3 Quick action from the dashboard (clock in/out, break, approve/reject)

1. User clicks a button on the attendance card or a pending-approval row.
2. Frontend calls the corresponding Attendance/Leave endpoint directly
   (§4.6), disabling the relevant control(s) while the call is in flight.
3. On success: a success toast; on failure: an error toast with the
   server's message (e.g. Attendance's `BadRequestException` for "already
   clocked in").
4. Either way, `GET /api/dashboard` re-fetches — the attendance card and
   the pending-approvals list both reflect the new server state; there is
   no separate "optimistically remove this row" step.

---

## 6. Business rules & invariants

- **INV-1** — `todayAttendance` reflects the *caller's own* record only,
  regardless of role. There is no dashboard-level "who's in today" org
  view — that already exists, properly scoped, as Attendance's own Team
  tab (module 05 §5.5); Dashboard does not duplicate it.
- **INV-2** — the entitlement check (§4.3) runs before, not instead of,
  the `user.employeeId` check — both must pass for a snapshot to be
  computed; neither check throws, both degrade to `null`.
- **INV-3** — Dashboard never queries Payroll data, because there is
  none. No placeholder, mock, or hardcoded stand-in value is rendered for
  the payslip-date or payroll-cost tiles.
- **INV-4** — Dashboard owns no mutation logic. Every quick action (§4.6)
  is a direct call to an endpoint Attendance or Leave already exposes and
  already authorizes/validates/audits; a change to what's allowed (e.g. a
  new regularization rule) is made in that module, never duplicated here.

---

## 7. States

`todayAttendance` has no state machine of its own — it's a read-through of
Attendance's own record state (module 05 §7) for "today" only, refreshed on
every dashboard load (no client-side caching/polling).

---

## 8. Permission matrix

| Capability | Employee | Line Manager | HR Manager | Company Admin | Auditor | Platform Admin |
|---|:--:|:--:|:--:|:--:|:--:|:--:|
| View own leave balances / pending / recent requests | ✅ | ✅ | — *(admin view instead)* | — *(admin view instead)* | falls through, near-empty | — (no route) |
| View pending approvals from reports | — | ✅ (recursive subtree) | ✅ (org-wide, via admin view) | ✅ (org-wide, via admin view) | — | — |
| **Approve / reject a pending request inline** | — | ✅ | — *(sees only a count, not the list, on the admin view — §2)* | — *(same)* | — | — |
| View org headcount / department breakdown | — | — | ✅ | ✅ | — | — |
| View own attendance "today" snapshot | ✅ (if linked + entitled) | ✅ | ✅ | ✅ | — (no employee record) | — |
| **Clock in/out, start/end break from the dashboard** | ✅ (same condition) | ✅ | ✅ | ✅ | — | — |
| View anyone else's attendance/leave from this screen | — | — | — | — | — | — |

---

## 9. Known gaps / TODO

1. **Payslip date and payroll/attrition tiles** — blocked on Payroll
   (module 07, not started). Not a Dashboard defect; revisit once that
   module exists and defines a stable "next payslip date" / cost-summary
   contract, the same way Attendance's `getLopDays()` is the pre-agreed
   contract Payroll will consume (module 05 §9 item 7).
2. **Auditor experience is undefined** — an Auditor has no `employeeId` in
   the common case and isn't an `ADMIN_ROLES` role, so they fall through to
   the personal-view branch and see an almost-entirely-empty screen (no
   balances, no pending items, `todayAttendance: null`). Not wrong, just
   never designed — see §12.
3. **No caching/polling** — every navigation to `/` re-fetches from
   scratch; acceptable at current scale, revisit if the endpoint becomes a
   bottleneck (unlikely — it's a handful of indexed reads).
4. **No reason box on the dashboard's reject button** — matches the
   existing row-level precedent in Leave's own Approvals tab (§4.6), but if
   product wants rejects *from the dashboard specifically* to require a
   reason, that's a small addition to the dashboard's reject handler (pass
   a `comment` in the `DecideLeaveDto` body), not a backend change.

---

## 10. Dependencies

**Upstream (Dashboard reads from):**
- Module 04 Leave — `pendingApprovals`, `getBalances`, `listForEmployee`.
- Module 05 Attendance — `today()`, gated on the `ATTENDANCE` entitlement
  from `TENANT_CONFIGURATION.md`.
- Tenant Prisma client directly — `employee.count()`,
  `department.findMany()` (admin aggregates only; no dedicated Employee
  Master service method exists for this specific shape, and none is
  needed for a two-field count).

**Downstream:** none — nothing in the codebase depends on Dashboard's own
`GET /api/dashboard` output; it is a terminal read surface. The quick
actions (§4.6) call *into* Attendance/Leave directly rather than the other
way round.

**Blocked on:** Module 07 Payroll (not started) — the two remaining
feature-list items (§9 item 1).

---

## 11. Acceptance criteria / test checklist

- [x] Admin role receives `{ view: 'admin', headcount, departmentBreakdown,
      pendingApprovalsCount }`.
- [x] Non-admin role receives `{ view: 'employee', leaveBalances,
      pendingApprovals, myRecentRequests }`.
- [x] `todayAttendance` is populated (matches `AttendanceService.today()`'s
      shape) when the caller has a linked employee and the tenant's plan
      includes `ATTENDANCE`.
- [x] `todayAttendance` is `null` when the tenant's plan does **not**
      include `ATTENDANCE` — and `AttendanceService.today()` is not called
      in that case (verified via a Jest spy in
      `dashboard.controller.spec.ts`, not just the response shape).
- [x] `todayAttendance` is `null` when the caller has no `employeeId`.
- [x] `todayAttendance` renders on the **admin** response too, for an
      admin who is also a linked employee.
- [ ] Cross-tenant: not separately re-tested here — Dashboard has no
      tenant-scoping logic of its own; it inherits RLS + `LeaveService`'s /
      `AttendanceService`'s own tested scoping (module 04 §11, module 05
      §11 already cover this).
- [x] Clock-in/out and break buttons on the dashboard call the same
      `/attendance/*` endpoints Attendance's own Today card uses, and are
      exercised there (module 05 §11) — Dashboard adds no new backend
      behavior to test.
- [x] Approve/reject buttons on a dashboard pending-approval row call
      `/leave/requests/:id/{approve,reject}`, exercised by Leave's own
      suite (module 04 §11) — same reasoning.
- [ ] Not e2e/browser-verified — no test credentials for a live Line
      Manager/Company Admin session in this environment (same caveat as
      several other modules' latest passes).

---

## 12. Open questions / decisions needed

- **Auditor's dashboard experience** — should an Auditor see a read-only
  org summary (like the admin view, minus any action-oriented tiles) instead
  of falling through to an empty personal view? No customer has asked for
  this yet; revisit if one does.
- **Attendance-entitlement upsell** — when `todayAttendance` is `null`
  purely because the plan lacks `ATTENDANCE` (as opposed to no linked
  employee), should the frontend show a soft "upgrade to unlock Attendance"
  prompt instead of nothing? Deferred as a product/pricing-page decision,
  not a dashboard engineering task.
- **Caching** — worth adding if/when this endpoint's read set grows (e.g.
  once Payroll/Reports tiles land); not needed at today's scale.
