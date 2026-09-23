# Dashboard — UI Build Prompt

**What this is:** a single, rigidly-structured prompt for building the
Dashboard module's one screen. Written as a technical specification, not a
conversation, so a UI build tool (or an AI agent) renders a production-grade
layout with all states instead of guessing.

**How to use:** paste everything below the `─── PROMPT ───` line into your
build tool. It carries the frontend stack, the design tokens, the data
dictionary, and the per-role screen map. Pair it with:

- `docs/modules/06_DASHBOARD.md` — the module source of truth (personas,
  flows, technical + functional expectations, permissions matrix, and what's
  live vs. deliberately not built).
- `docs/MODULE_SPECS.md` §6 — condensed product behaviour, happy path,
  known gaps.
- `apps/api/src/dashboard` + `apps/web/src/pages/dashboard.tsx` — current
  code.

**Output target:** `apps/web/src/pages/dashboard.tsx` (currently a single
file — this prompt keeps it that way; the module has one screen, no tabs,
no sub-routes).

> **Build-target note — read before building:** this module is **100%
> done** for everything its data sources support. Every card below is
> **live** against the real API, including the quick-action buttons (§5.2,
> §5.4) — Clock In/Take Break/End Break/Clock Out on the attendance card,
> Approve/Reject on a pending-approval row. Those buttons call Attendance's
> and Leave's *own* existing endpoints directly (§3.4) — no new backend
> route was added for them. There is nothing to mark `TODO(api)` — the two
> feature-list items still missing (upcoming payslip date, admin
> payroll-cost/attrition tiles) are blocked on Payroll (module 07), which
> does not exist yet at all, not even as a stub — do **not** invent a
> placeholder card for them. Do not add screens, tabs, or routes beyond
> what's specified here; Dashboard is intentionally a single, dense-but-
> quick landing screen, not a mini-BI tool.

---
─── PROMPT ───

## 1. Role & Output Objective

You are a **Senior SaaS UI Architect**. Produce a **production-grade,
responsive layout** for the **Dashboard** (home screen) of a multi-tenant
India-focused HRMS. Output must be implementation-ready React + TypeScript,
matched to the codebase conventions in Section 2, with **every card,
overlay, and component state rendered explicitly** (Section 8).

This is the first screen every user sees after login, every day. It must
read at a glance — a handful of dense stat tiles and short lists, not a
dashboard-builder or a chart-heavy analytics page (that's module 11
Reports, separate and mostly unbuilt). Calm, information-forward, no
decoration for its own sake.

## 2. Global System

### 2.1 Frontend stack (non-negotiable — match exactly)

| Concern | Choice |
|---|---|
| Framework | **React 19** function components + hooks. No class components. |
| Build | **Vite 8**, TypeScript **strict**. `verbatimModuleSyntax` + `erasableSyntaxOnly` are on ⇒ **no `enum`, no `namespace`, no parameter properties**. Use `as const` maps + string-literal union types. Type-only imports use `import type`. |
| Routing | **React Router 7** (`BrowserRouter` + `<Routes>`, no data-router APIs). Single route: `/` → `DashboardPage`. No sub-routes, no tabs. |
| Styling | **Tailwind CSS v4** (`@import 'tailwindcss'`, `@theme inline` tokens in `src/index.css`). **No `tailwind.config.js`.** No inline hex — use tokens (2.2). |
| Components | **Hand-rolled shadcn-style primitives** in `src/components/ui` (`cva` + `clsx` + `tailwind-merge` via `cn()`). **No Radix / Headless UI.** Reuse: `card`, `badge`, `button`, `skeleton` (+ `Skeleton`, no `SkeletonRows` needed here), `empty-state` (`EmptyState`, icon + title + optional action). |
| Icons | **lucide-react** (v1.x). |
| Data | `src/lib/api.ts` (`api.get`/`api.post`, `isApiError`). Read: `GET /dashboard`. Quick actions (§3.4) call `POST` directly against Attendance's and Leave's own paths, not a Dashboard-specific endpoint. |
| Toasts | `useToast()` (`@/components/ui/toast`) — success/error feedback for quick actions only; nothing else on this screen toasts. |
| Auth/role | `useAuth()` → `{ user: { role, employeeId, email } }`. Roles: `COMPANY_ADMIN`, `HR_MANAGER`, `LINE_MANAGER`, `EMPLOYEE`, `AUDITOR`. |
| Path alias | `@/*` → `src/*`. |
| Dates/money | ISO UTC strings, display **IST**, format `14 Apr 2026`, times `HH:mm`. |

<!-- CANONICAL §2.2 — keep this block byte-identical in every
     docs/ui-build-prompts/NN-*.md file (and any future module prompt). -->
### 2.2 Design system / tokens — single source of truth

**Authoritative token definitions live in `apps/web/src/index.css`** (`:root`,
`@media (prefers-color-scheme: dark)`, `:root[data-theme='dark']`). **Introduce
no new colour.** Use only these CSS variables (or their `bg-*/text-*/border-*`
Tailwind utilities). Every screen in every module uses the **same token for the
same purpose** — the semantic map below is binding, so all modules stay in
visual sync.

Look: neutral off-white canvas, deep navy primary, teal = positive/approve,
amber = caution (pending / LOP / probation / notice), restrained red =
destructive only. Neutrals carry most of the UI. Font **Inter**. One `--radius`
(`0.625rem`). **Not** generic slate/indigo.

**Core tokens** (light → dark; dark values from `index.css`, don't hardcode):

| Token | Light | Dark | Utility |
|---|---|---|---|
| `--background` | `#f7f8fa` | `#0d1117` | `bg-background` |
| `--foreground` | `#101828` | `#e6e9ee` | `text-foreground` |
| `--card` | `#ffffff` | `#141a22` | `bg-card` |
| `--border` / `--input` | `#e2e5ea` | `#262e3a` | `border-border` |
| `--primary` | `#16324f` | `#6ea8dd` | `bg-primary` / `text-primary` |
| `--primary-foreground` | `#f7f9fb` | `#0d1117` | `text-primary-foreground` |
| `--secondary` / `--muted` | `#eef1f5` | `#1b222c` | `bg-secondary` / `bg-muted` |
| `--muted-foreground` | `#5b6472` | `#97a2b0` | `text-muted-foreground` |
| `--accent` | `#eaf1f7` | `#1b2733` | `bg-accent` (hover) |
| `--success` | `#1a7f5a` | `#35c28d` | `text-success` |
| `--warning` | `#a8681a` | `#e0a942` | `text-warning` |
| `--destructive` | `#b3261e` | `#e5675f` | `bg-destructive` |
| `--ring` | `#2b5a8c` | `#6ea8dd` | `ring-ring` (2px focus) |

**Brand accent tokens** (`bg-lumen-*` / `text-lumen-*`), each with a matching
`-soft` background: `--lumen-gold` (`#d99220` → `#f5b544`), `--lumen-navy`,
`--lumen-success`, `--lumen-warning`, `--lumen-error`, `--lumen-info`,
`--lumen-purple`. Use `-soft` bg + solid `text-lumen-*` for status chips and
stat-tile icon wells.

**Semantic map (binding across all modules):**

| UI element | Token |
|---|---|
| Page canvas | `bg-background` |
| Cards, tables, modals, drawers | `bg-card` + `border-border` |
| Primary button · active nav · selected-tab underline | `--primary` |
| Secondary button · inactive chip | `--secondary` |
| Row hover · ghost-button hover | `--accent` |
| Muted labels, helper text, timestamps | `text-muted-foreground` |
| Approved / Confirmed / positive | `--success` + `--lumen-success-soft` chip |
| Pending / LOP / Probation / Notice | `--warning` + `--lumen-warning-soft` chip |
| Rejected / Suspended / error / delete | `--destructive` + `--lumen-error-soft` chip |
| Neutral status (Cancelled / info) | `--muted` / `--lumen-info-soft` |
| Focus ring (all inputs & buttons) | `ring-ring`, 2px |
| Per-entity colour dots (leave type, department) on calendars/legends | that entity's `colorToken` (a `--lumen-*` var) |

Every colour must resolve in **both** light and dark — never define one only
inside a media / `[data-theme]` block; give containers an explicit token
background (no transparent-borrow).

### 2.3 Global layout frame

- **Fixed left nav panel** 240px (`w-60`), `bg-card` + right border; icon +
  label links, active = `bg-secondary`; bottom: theme toggle, user email +
  role, log out. **Home**/**Dashboard** is the top nav item, always visible
  to every role.
- **Top bar**: breadcrumb (`Home`) left; compact user control (avatar +
  role → `dropdown-menu`) right. Sticky.
- **Content canvas**: single scroll region, `p-8`, `max-w-[1200px]`. No
  internal tabs — this page is short enough to be one continuous scroll:
  greeting header → attendance snapshot card → role-specific grid.
- Responsive: `< lg` collapses nav to an icon rail; stat-tile grids collapse
  `lg:grid-cols-3` → `sm:grid-cols-2` → `grid-cols-1`; no horizontal page
  scroll.

### 2.4 Component state rules

**Show every interactive component in all states, labelled:** Default ·
**Loading/Skeleton** — `DashboardSkeleton` renders the whole page as one
skeleton pass (header, attendance-card, three stat tiles), built from the
shared `Skeleton` primitive, never a bare spinner — this is the first thing
every user sees each day · **Empty** (`EmptyState` with a `lucide-react`
icon + title, no description needed for a one-liner — `Wallet` / "No
balances allocated yet", `CheckCircle2` / "Nothing pending. 🎉",
`CalendarClock` / "You haven't applied for leave yet") · **Error**
(`EmptyState` with an `AlertTriangle` icon, title "Couldn't load your
dashboard", and a `Button` action with a `RefreshCw` icon labelled
"Retry" that re-runs the fetch — replaces the whole content canvas, never a
blank screen).

## 3. Data Model & Validation

Render **these exact field names**. No lorem — use realistic Indian names,
dates, and IST times. Single source: `GET /api/dashboard`.

### 3.1 Response shape (discriminated on `view`)

```ts
type DashboardResponse =
  | {
      view: 'admin';
      headcount: number;
      departmentBreakdown: { name: string; count: number }[];
      pendingApprovalsCount: number;
      todayAttendance: TodayAttendanceSnapshot | null;
    }
  | {
      view: 'employee';
      leaveBalances: { id: string; accrued: string; used: string; leaveType: { name: string } }[];
      pendingApprovals: {
        id: string; days: string;
        employee: { firstName: string; lastName: string };
        leaveType: { name: string };
      }[];
      myRecentRequests: { id: string; status: string; days: string; startDate: string }[];
      todayAttendance: TodayAttendanceSnapshot | null;
    };

interface TodayAttendanceSnapshot {
  status: 'PRESENT' | 'LATE' | 'ON_LEAVE' | 'WEEKLY_OFF' | 'HOLIDAY' | 'ABSENT' | 'PENDING_REGULARIZATION' | null;
  checkInAt: string | null;   // ISO
  checkOutAt: string | null;  // ISO
  isOnBreak: boolean;
  effectiveMs: number;        // worked so far, excl. breaks
  targetHours: number;
}
```

`view` picks the layout (5.1 vs. 5.2). `todayAttendance` is independent of
`view` — render its card (5.3) whenever it is non-`null`, above the
`view`-specific grid, for **both** shapes.

### 3.2 Derived display rules

- **Attendance headline label** (not sent by the API — derive client-side):
  `isOnBreak` → "On break"; else `checkOutAt` set → "Day complete"; else
  `checkInAt` set → title-case of `status` (fallback "Present"); else "Not
  clocked in yet".
- **Attendance chip colour:** no `checkInAt` → neutral/`--secondary`;
  `status === 'LATE'` → warning; `status === 'ABSENT'` → destructive;
  otherwise → success.
- **Worked time:** format `effectiveMs` as `Xh Ym` (floor to the minute).
- **Leave balance remaining:** `Number(accrued) - Number(used)` days left,
  rendered as `"{remaining} / {accrued} days left"`.
- **Department bar width:** `count / max(1, headcount) * 100%`, a
  `bg-primary` fill inside a `bg-muted` track — reuse this exact pattern,
  don't introduce a chart library for one bar list. Render the same
  percentage as text next to the count: `"{count} ({pct.toFixed(1)}%)"`.
- **Pending-approval avatar:** a `bg-primary` / `text-primary-foreground`
  circle (`h-8 w-8 rounded-full`) showing the requester's initials —
  `employee.firstName[0] + employee.lastName[0]` — to the left of the
  name/leave-type line. No real photo lookup here (that's Employee
  Master's job); initials only.
- **Recent-request status chip:** `APPROVED` → success; `REJECTED` /
  `CANCELLED` → destructive; else (⁠`PENDING*`) → warning. Label:
  `status.replace('_', ' ')`.

### 3.3 Validation rules

No forms on this screen. The only mutating interactions are the quick
actions in §3.4 — both are single-click buttons with no input fields (no
reason/comment box on reject, matching the existing row-level precedent in
`apps/web/src/pages/leave/tabs/approvals.tsx`). Everything else is a
summary that links out to its owning module (Leave, Attendance, Employee
Master) for any deeper action or history.

### 3.4 Quick actions (call the owning module's endpoint directly)

| Button | Where it renders | Calls | Enabled when |
|---|---|---|---|
| Clock in | Attendance card | `POST /attendance/clock-in` | `!checkInAt` (not clocked in yet) |
| Take break / End break | Attendance card | `POST /attendance/break/start` \| `/break/end` | clocked in (`checkInAt` set, `checkOutAt` unset) |
| Clock out | Attendance card | `POST /attendance/clock-out` | clocked in and **not** `isOnBreak` |
| Approve | Pending-approval row | `POST /leave/requests/:id/approve` | row is rendered (already scoped to the caller) |
| Reject | Pending-approval row | `POST /leave/requests/:id/reject` | same |

All five reuse `AttendanceService`'s and `LeaveService`'s existing
authorization/validation (module 05 §4.4, module 04 §4) — nothing new is
added server-side. On click: disable the relevant button(s), call the
endpoint, `toast()` success or (`isApiError`) the server's error message,
then re-run the page's `GET /dashboard` load regardless of outcome so the
whole screen — not just the row/card that changed — reflects the new
state. No optimistic local update.

## 4. Roles & screen access

Every authenticated tenant role lands on this same route; the response
shape (not the route) branches by role.

| Card | EMPLOYEE | LINE_MANAGER | HR_MANAGER | COMPANY_ADMIN | AUDITOR |
|---|:--:|:--:|:--:|:--:|:--:|
| Org headcount / department breakdown / pending-approvals count | — | — | ✅ | ✅ | — |
| Own leave balances / pending / recent requests | ✅ | ✅ | — | — | falls through, near-empty (see module doc §12) |
| Own attendance "today" snapshot | ✅ (if linked employee + tenant has `ATTENDANCE`) | ✅ | ✅ | ✅ | — (no linked employee) |

`PLATFORM_ADMIN` never reaches this route (separate console, no tenant
session).

## 5. Primary page views

### 5.1 Header (all roles)

- `h1`: "Welcome back, {user.email}" (or a resolved display name if the
  app has one elsewhere — match whatever `useAuth()` exposes today, don't
  invent a new field).
- One-line subtext: "Here's what's happening across your organization."

### 5.2 Attendance snapshot card (all roles, when `todayAttendance` is non-null)

Full-width card, rendered directly under the header, above the
role-specific grid — shared by both `view` branches (3.1/3.2 rules):

- **Left:** "Today's attendance" label (`CardDescription`) + worked-time
  headline "Xh Ym worked" (`CardTitle`).
- **Right:** status chip (headline label, §3.2 colour rule) **+ the quick
  action buttons for the current state** (§3.4): not clocked in → **Clock
  in**; clocked in, not on break → **Take break** + **Clock out**; on break
  → **End break** (Clock out disabled while on break); day complete → no
  buttons, chip only.
- **Body row:** three inline stats — Check-in time (`HH:mm` or `—`),
  Check-out time (`HH:mm` or `—`), Target hours (`{targetHours}h`).
- **When `todayAttendance` is `null`:** render nothing in this slot — no
  empty card, no upsell banner (module doc §12 — deferred product
  decision). This is the one card in the app that's allowed to simply not
  appear.

### 5.3 Admin grid (`view === 'admin'`)

`grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4`:
- **Total headcount** stat tile (`CardDescription` + large `CardTitle`
  number).
- **Pending approvals** stat tile — same pattern.
- **Departments** stat tile — count of `departmentBreakdown` entries.
- **Headcount by department** — full-width (`sm:col-span-2 lg:col-span-3`),
  one row per department: truncated name (fixed width) + horizontal bar
  (§3.2) + `"{count} ({pct}%)"` right-aligned.

### 5.4 Employee / Line Manager grid (`view === 'employee'`)

`grid grid-cols-1 lg:grid-cols-2 gap-4`:
- **My leave balances** card — one row per leave type: name + "{remaining}
  / {accrued} days left". Empty: `EmptyState` (`Wallet` icon) "No balances
  allocated yet."
- **Pending approvals** card — one row per request: initials avatar (§3.2)
  + "{firstName} {lastName} · {leaveType.name}" + a warning badge showing
  `{days}d` + **Reject** (`X` icon, `variant="outline"`, destructive text)
  and **Approve** (`Check` icon, primary) buttons, rendered only when
  `user.role` is one the backend actually authorizes to decide
  (`LINE_MANAGER`/`HR_MANAGER`/`COMPANY_ADMIN` — §3.4; in practice this is
  always `LINE_MANAGER` here, since `HR_MANAGER`/`COMPANY_ADMIN` get the
  admin view instead, which has no per-request list to act on). Empty:
  `EmptyState` (`CheckCircle2` icon) "Nothing pending. 🎉" (Line Manager
  with no reports, or an Employee — this card still renders for an
  Employee since `pendingApprovals` is fetched unconditionally, per the
  current API contract; it will simply always be empty for a pure
  Employee — don't hide the card, render its empty state, since a future
  promotion to Line Manager should "just work" without a layout change).
- **My recent requests** card, full-width (`lg:col-span-2`) — one row per
  request: formatted `startDate` + `{days}d`, right-aligned status chip
  (§3.2). Empty: `EmptyState` (`CalendarClock` icon) "You haven't applied
  for leave yet."

## 6. Secondary views & overlays

None. This module has no drawers, modals, or secondary routes — see the
build-target note at the top of this file.

## 7. Toasts & micro-states

- **Toasts** (`useToast`): the quick actions (§3.4) are the only source —
  success ("Request approved", "Request rejected"; Attendance's own
  actions don't need a distinct success toast since the card's state
  change is itself the feedback) and error (`isApiError(err) ? err.message
  : 'Action failed'`, tone `error`). No other control on this screen
  toasts.
- **Error state:** if `GET /dashboard` fails, the page renders *only*
  `EmptyState` (`AlertTriangle` icon, "Couldn't load your dashboard",
  "Something went wrong fetching your dashboard data.") with a "Retry"
  `Button` (`RefreshCw` icon) that re-runs the fetch — not the header, not
  a blank page.
- **Loading state:** the page renders `DashboardSkeleton` in full instead
  of the real content — header skeleton, attendance-card skeleton, three
  stat-tile skeletons — never a bare spinner.

## 8. Canvas rendering order (render everything at once)

Lay out **simultaneously**, each clearly labelled:

1. **Admin view**, fully populated — header, attendance card (working
   state, with its Take break/Clock out buttons visible), the three stat
   tiles, the department-breakdown bar list with 3–5 realistic Indian
   department names.
2. **Employee/Line Manager view**, fully populated — header, attendance
   card (a *different* state than the admin example, e.g. "on break", with
   its End break button visible), leave balances (2–3 leave types), a
   non-empty pending-approvals list with visible Approve/Reject buttons on
   each row (Line-Manager case), a non-empty recent-requests list with a
   mix of status chips.
3. **Attendance card state gallery** — Not clocked in (Clock in button) ·
   Clocked in / working (Take break + Clock out buttons) · On break (End
   break button) · Day complete (no buttons), side by side.
4. **Empty-state gallery** — leave balances empty, pending approvals
   empty, recent requests empty, shown together.
5. **Loading skeleton** and **error** states for the whole page, shown
   once each.

Annotate every control with the call it makes: `GET /api/dashboard` (the
one read); `POST /attendance/clock-in` · `/clock-out` · `/break/start` ·
`/break/end`; `POST /leave/requests/:id/approve` · `/reject` (no
`TODO(api)` anywhere on this screen — see the build-target note).

## 9. Deliverable & file layout

```
apps/web/src/pages/
  dashboard.tsx   # DashboardPage + local helpers, single file (existing, expand in place):
                  #   DashboardSkeleton, TodayAttendanceCard, StatusBadge, formatHm
```

Constraints recap: React 19 + TS strict (no enums), Tailwind v4 tokens
only, hand-rolled `components/ui` primitives (no Radix), `api.get`/
`api.post` for data and quick actions, one route, quick actions call
Attendance's/Leave's own endpoints directly rather than a new Dashboard
route, no invented Payroll placeholders, every state (loading / empty /
error) explicit.
