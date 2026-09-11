# Attendance & Time Tracking — UI Build Prompt

**What this is:** a single, rigidly-structured prompt for building every screen
of the Attendance & Time Tracking module UI. Written as a technical
specification, not a conversation, so a UI build tool (or an AI agent) renders
production-grade layouts with all overlays and states instead of guessing.

**How to use:** paste everything below the `─── PROMPT ───` line into your build
tool. It carries the frontend stack, the design tokens, the data dictionary,
and the per-role screen map. Pair it with:

- `docs/modules/05_ATTENDANCE.md` — the module source of truth (personas,
  flows, technical + functional expectations, permissions matrix, and — read
  this carefully — what's **live today vs. target/not-built**).
- `docs/MODULE_SPECS.md` §5 — condensed product behaviour, happy paths, known gaps.
- `docs/TENANT_CONFIGURATION.md` — shifts, holidays, tenant/attendance
  settings, the `punches` capture abstraction.
- `apps/api/src/attendance` + `apps/web/src/pages/attendance` — current code.

**Output target:** `apps/web/src/pages/attendance/` (currently a single
`index.tsx` — this prompt expands it into the file layout in §9).

> **Build-target note — read before building:** this module is **~55% done**.
> Employee self-service (clock in/out, breaks, today card, calendar, stats,
> raise/list/cancel a regularisation) is **live** against the real API — build
> those screens fully wired. Everything manager/HR-facing (team roster,
> regularisation approval queue, manual marking, shift/settings admin) is
> **not built on the backend at all** — build those screens to the target
> spec but mark every control `TODO(api)` and keep them behind the same
> layout so the backend has a UI to build against. Do not invent endpoints
> that aren't in `docs/modules/05_ATTENDANCE.md` §4.4.

---
─── PROMPT ───

## 1. Role & Output Objective

You are a **Senior SaaS UI Architect**. Produce a **production-grade,
responsive layout** for the **Attendance & Time Tracking** module of a
multi-tenant India-focused HRMS. Output must be implementation-ready
React + TypeScript, matched to the codebase conventions in Section 2, with
**every screen, overlay, and component state rendered explicitly** (Section 8).

This module runs every working day for every employee — it must feel fast
and low-friction for the daily clock-in/out loop, and precise/auditable for
the manager/HR approval surfaces. Dense, precise, back-office feel where
appropriate; the "Today" card is the one place that should feel light and
immediate. Not a marketing site.

## 2. Global System

### 2.1 Frontend stack (non-negotiable — match exactly)

| Concern | Choice |
|---|---|
| Framework | **React 19** function components + hooks. No class components. |
| Build | **Vite 8**, TypeScript **strict**. `verbatimModuleSyntax` + `erasableSyntaxOnly` are on ⇒ **no `enum`, no `namespace`, no parameter properties**. Use `as const` maps + string-literal union types. Type-only imports use `import type`. |
| Routing | **React Router 7** (`BrowserRouter` + `<Routes>`, no data-router APIs). Pages: `/attendance` (Today / Calendar / Stats / Regularisation tabs), `/attendance/team` (manager/HR roster — `TODO(api)`), `/attendance/approvals` (regularisation queue — `TODO(api)`), `/attendance/settings` (shifts/holidays/guardrails — `TODO(api)`). |
| Styling | **Tailwind CSS v4** (`@import 'tailwindcss'`, `@theme inline` tokens in `src/index.css`). **No `tailwind.config.js`.** No inline hex — use tokens (2.2). |
| Components | **Hand-rolled shadcn-style primitives** in `src/components/ui` (`cva` + `clsx` + `tailwind-merge` via `cn()`). **No Radix / Headless UI.** Reuse: `button`, `card`, `badge`, `input`(+`Label`), `dialog`, `table`, `tabs`, `select`, `textarea`, `field`, `skeleton`, `empty-state`, `toast` (`useToast()`), `dropdown-menu`, `sheet`, `calendar`-style grid (build if missing, matching primitive style). |
| Icons | **lucide-react** (v1.x). |
| Data | `src/lib/api.ts` (`api.get/post/patch`). |
| Auth/role | `useAuth()` → `{ user: { role, employeeId, email } }`. Roles: `COMPANY_ADMIN`, `HR_MANAGER`, `LINE_MANAGER`, `EMPLOYEE`, `AUDITOR`. Gating helpers in `src/lib/roles.ts`. |
| Path alias | `@/*` → `src/*`. |
| Dates/money | ISO UTC strings, display **IST** (tenant `timezone`, default `Asia/Kolkata`), format `14 Apr 2026`, times `HH:mm`. |

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
  role, log out. Role-filtered — `Team`, `Approvals`, `Settings` sub-links
  under **Attendance** only render for `LINE_MANAGER`/`HR_MANAGER`/
  `COMPANY_ADMIN` (and `AUDITOR` read-only for Team/Approvals).
- **Top bar**: **breadcrumbs** (`Home / Attendance` or `/ Attendance / Team`)
  left; compact user control (avatar + role → `dropdown-menu`) right. Sticky.
- **Content canvas**: single scroll region, `p-8`, `max-w-[1200px]`. Each page
  opens with a `PageHeader` (title + description + right-aligned actions). The
  main **Attendance** page uses an internal `Tabs` strip (Today / Calendar /
  Stats / Regularisation).
- Responsive: `< lg` collapses nav to an icon rail; tables/calendar grids
  scroll inside their own `overflow-x-auto`; page body never scrolls
  horizontally; the "Today" card and its buttons stay full-width and
  thumb-friendly on mobile — this is the screen employees hit first every day.

### 2.4 Component state rules

**Show every interactive component in all states, labelled:** Default · Hover ·
Focus-visible (2px `--ring`) · Active · Disabled (`opacity-50`,
`pointer-events-none`) · **Loading/Skeleton** (tables → `SkeletonRows`; cards →
pulsing block of same footprint; buttons → inline spinner + "…" + disabled) ·
**Empty** (`EmptyState`: icon, title, one-liner, optional action) · **Error**
(inline field errors: red text + red control border; form-level error line
above the submit row; failed loads → retryable inline error, never a blank
screen) · **Selected/expanded** (row selected, calendar day selected, drawer
target).

## 3. Data Model & Validation

Render **these exact field names**. No lorem — use realistic Indian names,
dates, and IST times.

### 3.1 Attendance record — fields

`date` · `checkInAt` / `checkOutAt` (nullable, ISO, display as `HH:mm` IST) ·
`status` (`AttendanceStatus`: `PRESENT|LATE|ON_LEAVE|WEEKLY_OFF|HOLIDAY|
ABSENT|PENDING_REGULARIZATION`) · `source` (`AttendanceSource`:
`WEB|BIOMETRIC|GPS|IMPORT|MANUAL` — only `WEB` has data today; render others
only where a `TODO(api)` screen needs the concept, e.g. Settings' capture
methods) · breaks: list of `{startAt, endAt?}`.

**Status → chip colour:** `PRESENT` success · `LATE` warning · `ON_LEAVE`
`lumen-info-soft` · `WEEKLY_OFF`/`HOLIDAY` muted/neutral · `ABSENT`
destructive · `PENDING_REGULARIZATION` warning (striped or dot-accent to
distinguish from `LATE`).

### 3.2 Regularisation request — fields

`id` · `targetDate` · `reasonType` (`RegularizationReasonType`:
`MISSED_PUNCH_IN|MISSED_PUNCH_OUT|WRONG_PUNCH_TIME|FORGOT_TO_CLOCK_IN|
FORGOT_TO_CLOCK_OUT|ON_DUTY_FIELD_WORK|OTHER`) · `requestedCheckInAt?` ·
`requestedCheckOutAt?` · `note?` · `status` (`RegularizationStatus`:
`PENDING|APPROVED|REJECTED|CANCELLED`) · `approverId?` / approver name
(derived) · `decidedAt?`.

### 3.3 Shift *(read-only display today; full CRUD is `TODO(api)`, Settings screen)*

`name` · `type` (`ShiftType`: `FIXED|FLEXI|ROTATIONAL`) · `startTime` /
`endTime` (`HH:mm`) · `graceMinutes` · `minHoursFullDay` / `minHoursHalfDay`
(decimal hours) · `coreStartTime` / `coreEndTime` (FLEXI only) · `isDefault`.

### 3.4 Tenant attendance settings *(`TODO(api)`, Settings screen)*

`mode` (`AttendanceMode`: `SELF_SERVICE|ROSTER|OFF`) · `captureMethods`
(multi-select of `AttendanceSource`) · `regularizationWindowDays` ·
`regularizationMonthlyCap` · `unactionedBehavior`
(`RegularizationUnactionedBehavior`: `AUTO_APPROVE|AUTO_REJECT`).
Weekly-off days and holidays are tenant-wide and shared with Leave — link out
to the Leave module's Holiday settings rather than duplicating that screen.

### 3.5 Validation rules (must be visible)

- **Clock in** disabled if already clocked in today (button becomes
  "Clocked in at HH:mm" + shows **Start break** / **Clock out** instead).
- **Clock out** disabled until clocked in; if on an open break, clocking out
  first prompts "End your break first?" confirm (or auto-ends the break —
  pick one and be consistent; note the choice in the component).
- **Start break** disabled if already on a break or not clocked in.
  **End break** only enabled while on a break.
- Regularisation form: `targetDate` required, must be ≤ today; `reasonType`
  required; if `reasonType` is `MISSED_PUNCH_IN`/`FORGOT_TO_CLOCK_IN`,
  `requestedCheckInAt` required; if `MISSED_PUNCH_OUT`/`FORGOT_TO_CLOCK_OUT`,
  `requestedCheckOutAt` required; `WRONG_PUNCH_TIME` requires both; `note`
  required when `reasonType = OTHER`.
- Show (client-side, informational) whether the request falls within the
  tenant's `regularizationWindowDays` and under `regularizationMonthlyCap` —
  render the banner even though the API doesn't enforce it yet, so the UI is
  ready when it does (mark the check `TODO(api)-enforced` in a code comment).
- Destructive/decision actions (cancel a request, reject a regularisation,
  manual mark override) → confirm modal with a reason field where the target
  spec requires one (reject, manual mark).

## 4. Roles & screen access

`PLATFORM_ADMIN` is out of scope (separate operator console).

| Screen / capability | EMPLOYEE | LINE_MANAGER | HR_MANAGER | COMPANY_ADMIN | AUDITOR |
|---|:--:|:--:|:--:|:--:|:--:|
| Today card — clock in/out, breaks | own | — | — | — | — |
| Calendar / Stats | own | own *(+ team roster, `TODO(api)`)* | own *(+ team roster, `TODO(api)`)* | own *(+ team roster, `TODO(api)`)* | — |
| Raise / list / cancel regularisation | own | — | — | — | — |
| Approve / reject regularisation | — | `TODO(api)` | `TODO(api)` | `TODO(api)` | — |
| Manual attendance mark | — | — | `TODO(api)` | `TODO(api)` | — |
| Team roster ("who's in today") | — | `TODO(api)` (reports) | `TODO(api)` (all) | `TODO(api)` (all) | `TODO(api)` (all, read-only) |
| Settings (shifts / guardrails) | — | — | `TODO(api)` | `TODO(api)` | view `TODO(api)` |

Every `TODO(api)` cell: build the screen to spec, gate it behind the role,
render all its controls **disabled with a "Coming soon" tooltip** or wire
them to a clearly-labelled mock — do not silently omit the screen.

## 5. Primary page views

For **each** view: top metrics → action toolbar → table/grid columns → per-row
actions → pagination/empty/skeleton → overlays it can open.

### 5.1 Attendance — Today  (`/attendance`, default tab)

- **Hero card** (top, full-width, light/immediate — not dense like the rest
  of the app): large current-time clock, today's date, current status pill,
  and the primary action button that swaps by state: **Clock In** →
  **Start Break** / **Clock Out** → **End Break** / **Clock Out** → (after
  clock-out) "Day complete — X h Y m worked" summary. Shows check-in time,
  check-out time (once set), and total break time once any break has run.
- Below the hero: **This week** mini-strip (7 day chips, status colour-coded,
  click → jumps to that day in Calendar tab).
- States: hero card **loading** (skeleton clock + disabled button),
  **error** (clock-in call failed → inline retry), already-clocked-in on
  page load (restores correct button state from `GET /attendance/today`).

### 5.2 Attendance — Calendar  (`/attendance` Calendar tab)

- **Toolbar:** month `select`/arrows, legend (status → colour chips per 3.1).
- **Month grid:** one cell per day — date number, status chip/dot, check-in–
  check-out range if present. Weekly-off/holiday cells visually muted.
  Click a day → **Day Detail drawer** (6.1).
- Empty (future months with no data) renders muted "—" cells, not blank.
  Skeleton = greyed grid while loading.

### 5.3 Attendance — Stats  (`/attendance` Stats tab)

- **Stat tiles (row of 4):** Present days · Absent days · Late arrivals ·
  Total hours worked — for the selected month.
- **Secondary chart/bar** (optional but recommended): daily hours bar for
  the month, using `dataviz` conventions (categorical status colours from
  3.1, no new colours introduced).
- Month `select` shared with Calendar tab state.

### 5.4 Attendance — Regularisation  (`/attendance` Regularisation tab)

- **Toolbar:** **New request** button; status filter (`All/Pending/Approved/
  Rejected/Cancelled`).
- **Table columns:** Target date · Reason type · Requested check-in ·
  Requested check-out · Status (pill) · Decided by / at (if decided) ·
  Actions (kebab: **Cancel**, only while `PENDING`).
- Empty = "No regularisation requests yet" (+ New request action). Skeleton
  rows while loading.

### 5.5 Team  (`/attendance/team`) — `TODO(api)`, LINE_MANAGER/HR/Admin/Auditor

- **Stat tiles:** Clocked in · Not yet in · On leave · On break — for today,
  scoped to the viewer (reports for Line Manager, all for HR/Admin/Auditor).
- **Table columns:** Employee (avatar, name, code) · Department · Status
  today · Check-in time · Regularisation flag (if pending). Search + department
  filter.
- Row → **Employee Attendance quick-view drawer** (6.1) — that employee's
  Today + recent calendar, read-only from this screen.
- All data + the endpoint itself are `TODO(api)` — render with realistic
  mock rows, a persistent "Preview — not yet wired to live data" banner at
  the top of the page (reuse the pattern from other TODO(api)-heavy screens
  in this codebase if one exists, e.g. Platform Admin's break-glass dialog).

### 5.6 Approvals  (`/attendance/approvals`) — `TODO(api)`, LINE_MANAGER/HR/Admin

- **Toolbar:** status filter (default `Pending`), employee search,
  **Bulk approve** (appears when rows checked).
- **Table columns:** checkbox · Employee · Target date · Reason type ·
  Requested times · Note · Submitted at · Actions (**Approve** / **Reject**,
  each a confirm modal — Reject requires a reason).
- Empty = "No pending regularisations." Same `TODO(api)` preview banner as
  5.5.

### 5.7 Settings  (`/attendance/settings`) — `TODO(api)`, HR/Admin edit, Auditor view

- **Shifts** section: table of `Shift` rows (3.3) — **New shift** / edit /
  set-default actions. Form fields per 3.3, with a live preview of "an
  employee clocking in at HH:mm on this shift is: On time / Late".
- **Guardrails** section: form for `AttendanceSettings` (3.4) —
  mode, capture methods (multi-select chips), regularisation window/cap,
  unactioned behavior (radio: Auto-approve / Auto-reject, with a one-line
  consequence explainer for each).
- Note inline: "Weekly-off days and holidays are managed under **Leave →
  Holidays**" with a link — do not duplicate that screen here.
- Same `TODO(api)` preview banner; Auditor sees the same layout fully
  disabled.

## 6. Secondary views & overlays

Render on the same canvas as the primary screens (Section 8), each labelled
with its trigger + API call (or `TODO(api)`).

### 6.1 Slide-over drawers (`sheet`, right, max-w-md)

- **Day Detail** — trigger: Calendar cell click. Date, status, check-in/out
  times, break list, and — if a regularisation exists for that date — its
  status inline; **Raise regularisation for this day** button pre-fills the
  New Request form with `targetDate`.
- **Employee Attendance Quick View** *(`TODO(api)`)* — trigger: Team roster
  row. That employee's today status + last 7 days mini-calendar +
  **Open regularisation history** link.

### 6.2 Modals (`dialog`, centered, max-w-md)

- **New / Edit Regularisation Request** — form per 3.2/3.5 →
  `POST /attendance/regularization`.
- **Cancel Regularisation** — confirm → `POST
  /regularization/:id/cancel`.
- **Approve Regularisation** *(`TODO(api)`)* — confirm, shows the effect
  ("will set DD MMM's check-in to HH:mm").
- **Reject Regularisation** *(`TODO(api)`)* — confirm + required reason
  textarea.
- **Manual Attendance Mark** *(`TODO(api)`)* — employee `select`, date,
  status override, required reason — HR/Admin only.
- **New / Edit Shift** *(`TODO(api)`)* — form per 3.3; warn if unsetting the
  only `isDefault` shift without designating a new one.

### 6.3 Inline

- Regularisation table status filter; Calendar month nav; Stats month nav;
  Approvals bulk-select bar; Settings section save/cancel inline states.

## 7. Toasts & micro-states

- **Toasts** (`useToast`, bottom-right, 4s, stacked, icon + title + optional
  description + close):
  - success: "Clocked in", "Clocked out — 8h 12m today", "Break started",
    "Break ended", "Regularisation request submitted", "Request cancelled".
  - info: "Preview only — this screen isn't wired to live data yet"
    (first-visit toast on `TODO(api)` screens, in addition to the persistent
    banner).
  - error: "Clock-in failed — retry", "You're already clocked in today",
    "Couldn't submit request — check the required fields".
- **Validation warnings** stay inline on the form, not as toasts.
- **Empty states** per Section 5. **Skeletons** per Section 2.4 — never a
  bare full-page spinner, especially not on the Today card (it's the first
  thing an employee sees every morning).

## 8. Canvas rendering order (render everything at once)

Do **not** render only the primary page. On the same canvas, lay out
**simultaneously**, each clearly labelled:

1. **Primary workspaces** — Attendance page with all 4 tabs shown (Today
   populated in mid-day-clocked-in state, Calendar for a representative
   month, Stats with tiles + chart, Regularisation with a mixed-status
   table), Team roster, Approvals queue, Settings (Shifts + Guardrails).
2. **All slide-over drawers** (6.1) — shown open beside the main view.
3. **All modals** (6.2) — shown open, tiled above the main view.
4. **All toast variants** (7) — anchored bottom-right, stacked.
5. **State gallery** — for the Today hero card and the Regularisation table,
   show Default · Hover · Focus · Disabled · Skeleton · Empty · Error side
   by side. Include the Today card in all three of: not-clocked-in,
   clocked-in-working, on-break, and day-complete states.

Annotate every overlay and action control with the HTTP method + endpoint it
triggers (or `TODO(api)` if it doesn't exist yet) so a backend developer can
map each control to an API call:

- **Live:** `POST /api/attendance/clock-in` · `/clock-out` · `/break/start` ·
  `/break/end` · `GET /api/attendance/today` ·
  `GET /api/attendance/calendar?month=` · `GET /api/attendance/stats?month=` ·
  `POST /api/attendance/regularization` ·
  `GET /api/attendance/regularization` ·
  `POST /api/attendance/regularization/:id/cancel`.
- **`TODO(api)`:** `POST .../regularization/:id/approve` & `/reject` ·
  team-roster read (no endpoint defined yet) ·
  `POST /attendance/mark` (manual) · `GET /attendance/lop?employeeId=&month=`
  (Payroll's future contract — not a screen, but note it exists) ·
  `POST /attendance/ingest` (biometric/CSV) · Shift CRUD ·
  `AttendanceSettings` read/update.

## 9. Deliverable & file layout

```
apps/web/src/pages/attendance/
  index.tsx        # Today / Calendar / Stats / Regularisation tabs (existing file — expand)
  team.tsx          # Team roster                                   [new, TODO(api)]
  approvals.tsx     # Regularisation approval queue                 [new, TODO(api)]
  settings.tsx      # Shifts + guardrails                           [new, TODO(api)]
  components/       # today-card.tsx, month-calendar.tsx, stats-tiles.tsx,
                    # regularization-table.tsx, regularization-form-dialog.tsx,
                    # day-detail-drawer.tsx, employee-quickview-drawer.tsx,
                    # shift-form-dialog.tsx
```

Constraints recap: React 19 + TS strict (no enums), Tailwind v4 tokens only,
hand-rolled `components/ui` primitives (no Radix), `api.*` for data, role-
gated screens, every state explicit, `TODO(api)` screens clearly banner-
marked and built to spec rather than omitted, all overlays rendered together.
