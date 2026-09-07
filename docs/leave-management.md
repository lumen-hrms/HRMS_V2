# Leave Management — UI Build Prompt

**What this is:** a single, rigidly-structured prompt for building every screen
of the Leave module UI. Written as a technical specification, not a
conversation, so a UI build tool (or an AI agent) renders production-grade
layouts with all overlays and states instead of guessing.

**How to use:** paste everything below the `─── PROMPT ───` line into your build
tool. It already carries the frontend stack, the design tokens, the data
dictionary, and the per-role screen map. Pair it with:

- `docs/LEAVE_UI_SPECS.md` — the API contract (endpoint inventory, `live` vs
  `planned`, per-screen contracts).
- `apps/web/src/lib/leave/types.ts` — the exact TypeScript types the screens
  bind to.
- `apps/web/src/lib/leave/client.ts` — the `leaveApi` client every screen calls.

**Output target:** `apps/web/src/pages/leave/` (tabs in `tabs/`, shared bits in
`components/` + `shared.tsx`, tabbed shell in `index.tsx`).

---
─── PROMPT ───

## 1. Role & Output Objective

You are a **Senior SaaS UI Architect**. Produce a **production-grade,
responsive layout** for the **Leave Management** module of a multi-tenant HR
platform (India-focused HRMS). Output must be implementation-ready React +
TypeScript, matched to the existing codebase conventions in Section 2, with
**every screen, overlay, and component state rendered explicitly** (Section 8).

This is an authenticated back-office module behind a login — dense, precise,
system-of-record feel. Not a marketing site, not a consumer app.

## 2. Global System

### 2.1 Frontend stack (non-negotiable — match exactly)

| Concern | Choice |
|---|---|
| Framework | **React 19** function components + hooks. No class components. |
| Build | **Vite 8**, TypeScript **strict**. `verbatimModuleSyntax` + `erasableSyntaxOnly` are on ⇒ **no `enum`, no `namespace`, no parameter properties**. Use `as const` maps and string-literal union types instead. Type-only imports must use `import type`. |
| Routing | **React Router 7** (`BrowserRouter` + `<Routes>`, no data-router APIs). Leave is one route `/leave`; sub-views are **tabs**, not routes. |
| Styling | **Tailwind CSS v4** (`@import 'tailwindcss'`, `@theme inline` tokens in `src/index.css`). **No `tailwind.config.js`.** No inline hex — use the tokens in 2.2. |
| Components | **Hand-rolled shadcn-style primitives** in `src/components/ui`, built with `cva` + `clsx` + `tailwind-merge` exposed as `cn()`. **No Radix, no `@radix-ui/*`, no Headless UI.** Reuse existing primitives: `button`, `card`, `badge`, `input`(+`Label`), `dialog`, `table`, `tabs`, `select`, `textarea`, `field`, `skeleton`, `empty-state`, `toast` (context + `useToast()`), `dropdown-menu`, `sheet`. Add new primitives in the same style only if genuinely missing. |
| Icons | **lucide-react** (v1.x). |
| Data | `src/lib/api.ts` (`api.get/post/patch`) for real calls; `src/lib/leave/client.ts` (`leaveApi`) is the module's typed client with a fixture/mock mode. Screens call `leaveApi`, never `fetch` directly. |
| Auth/role | `useAuth()` → `{ user: { role, employeeId, email } }`. Roles: `COMPANY_ADMIN`, `HR_MANAGER`, `LINE_MANAGER`, `EMPLOYEE`, `AUDITOR`. Role gating helpers in `src/lib/roles.ts`. |
| Path alias | `@/*` → `src/*`. |
| Dates/money | Timestamps are ISO UTC strings, display in **IST**, format like `11–12 Aug 2026`. Day counts are decimals (`Decimal(6,2)`) — render `1.5d`. |

<!-- CANONICAL §2.2 — keep this block byte-identical in docs/leave-management.md
     and docs/employee-master.md (and any future module prompt). -->
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

- **Fixed left nav panel**, 240px (`w-60`), `bg-card` + right border. Module
  links with lucide icon + label; active = `bg-secondary`. Bottom: theme
  toggle (light/system/dark), user email + role, log out. Nav items are
  **role-filtered**.
- **Top bar** across the content area: **breadcrumbs** (`Home / Leave /
  <active tab>`) on the left; on the right a compact user control (avatar +
  role, opens a `dropdown-menu`). Sticky.
- **Content canvas**: single scroll region, `p-8`, `max-w-[1200px]`. Page
  starts with a `PageHeader` (title + one-line description + right-aligned
  actions), then a `Tabs` strip (underline style), then the active tab's
  multi-section content.
- Responsive: below `lg`, left nav collapses to an icon rail / drawer; tables
  scroll inside their own `overflow-x-auto`; the page body never scrolls
  horizontally.

### 2.4 Component state rules

**Every interactive component must be shown in all of these states**, labelled:

- **Default**, **Hover**, **Focus-visible** (2px ring `--ring`), **Active/
  pressed**, **Disabled** (`opacity-50`, `pointer-events-none`).
- **Loading — Skeleton**: tables show `SkeletonRows`; stat tiles show a pulsing
  block of the same footprint; buttons show an inline spinner + "…" text and go
  disabled.
- **Empty**: `EmptyState` (icon, title, one-line description, optional primary
  action).
- **Error**: inline field errors (red text + red border on the control);
  form-level error as a red line above the submit row; failed loads show a
  retryable inline error, not a blank screen.
- **Selected / expanded** where applicable (table row selected, drawer target).

## 3. Data Model & Validation

Render **these exact field names and types** (from
`apps/web/src/lib/leave/types.ts`). Do not invent fields or use lorem text.

### 3.1 Entities & fields

**LeaveType**
`id` · `name` · `code` (2–3 char, e.g. CL/SL/EL) · `annualQuota` (number, days) ·
`carryForwardCap` (number, days) · `accrualFrequency` (`ANNUAL|MONTHLY|QUARTERLY`) ·
`genderRestriction` (`ANY|FEMALE|MALE`) · `minNoticeDays` (number) ·
`paid` (bool) · `requiresApproval` (bool) · `active` (bool) ·
`colorToken` (CSS var string, for calendar chips).

**LeaveBalance**
`leaveTypeId` · `leaveType` {`id`,`name`,`code`,`colorToken`} · `year` ·
`accrued` · `carriedForward` · `used` · `pending`.
Derived: **`available = accrued + carriedForward − used − pending`**.
`entitled = accrued + carriedForward`.

**LeaveRequest**
`id` · `employeeId` · `employee` {`id`,`firstName`,`lastName`,`department`} ·
`leaveType` {`id`,`name`,`code`,`colorToken`} ·
`status` (`PENDING_L1|PENDING_L2|APPROVED|REJECTED|CANCELLED`) ·
`startDate` · `endDate` · `days` (decimal) · `halfDay` (bool) · `reason` (string|null) ·
`isLop` (bool — Loss of Pay) · `attachmentName` (string|null) · `createdAt` ·
`approvals`: `LeaveApprovalStep[]`.

**LeaveApprovalStep**
`level` (1|2) · `approverName` · `approverRole` · `decidedAt` (string|null) ·
`decision` (`APPROVED|REJECTED|null`) · `comment` (string|null).

**CreateLeaveRequestInput** — `leaveTypeId` · `startDate` · `endDate` ·
`halfDay?` · `reason?`.
**LeaveRequestPreview** (client-side, no submit) — `days` · `availableBefore` ·
`availableAfter` · `isLop` · `lopDays` · `firstApprover`.

**Holiday** — `id` · `date` (ISO date) · `name` · `optional` (bool).

**TeamCalendarEntry** — `requestId` · `employeeId` · `employeeName` ·
`leaveTypeCode` · `colorToken` · `startDate` · `endDate` · `status`.

**TeamBalanceRow** — `employeeId` · `employeeName` · `department` ·
`balances: LeaveBalance[]`.

**LeaveLedgerEntry** — `id` · `employeeId` · `employeeName` · `leaveTypeCode` ·
`at` · `delta` (+credit / −debit) · `balanceAfter` ·
`source` (`ACCRUAL|CARRY_FORWARD|REQUEST_APPROVED|REQUEST_CANCELLED|HR_ADJUSTMENT`) ·
`note` (string|null) · `actorName`.
**BalanceAdjustmentInput** — `employeeId` · `leaveTypeId` · `year` · `delta` (signed) · `note`.

**LeaveSettings** — `approvalLevels` (1|2) · `allowLopRequests` (bool) ·
`fyStartMonth` (1–12; India default 4 = April).

### 3.2 Status → label / colour

`PENDING_L1` → "Pending — Manager" (amber) · `PENDING_L2` → "Pending — HR"
(amber) · `APPROVED` → "Approved" (teal) · `REJECTED` → "Rejected" (red) ·
`CANCELLED` → "Cancelled" (neutral). `isLop` → separate amber "LOP" pill.

### 3.3 Form validation rules (must be visible)

- Mandatory fields unfilled → **red border on the control + red helper text**;
  submit button **disabled** until the form is minimally valid.
- Apply form: `leaveTypeId`, `startDate`, `endDate` required. `endDate` <
  `startDate` → inline error, no submit. `halfDay` selectable **only** when
  `startDate === endDate`; disable it otherwise. If the chosen type's
  `minNoticeDays` isn't met → amber advisory (not a hard block). If projected
  `available` goes negative and `allowLopRequests` is true → amber "X days will
  be Loss of Pay" with a confirm; if false → hard block.
- Leave Type form: `code` 2–3 chars uppercase, unique; `annualQuota` ≥ 0;
  `carryForwardCap` ≥ 0; `minNoticeDays` ≥ 0. `genderRestriction` other than
  `ANY` shows a note that non-matching employees won't see the type.
- Balance Adjustment: `delta` non-zero; `note` required (min 5 chars) — it's an
  audit reason.
- Holiday: `date` within the selected year; `name` required; `(date, name)`
  unique.
- Settings: `approvalLevels` ∈ {1,2}; `fyStartMonth` ∈ 1–12.
- All destructive actions (reject, withdraw, delete holiday,
  deactivate type) → confirm modal.

## 4. Roles & screen map

`PLATFORM_ADMIN` is out of scope (separate operator console). Tabs per role:

| Tab | EMPLOYEE | LINE_MANAGER | HR_MANAGER | COMPANY_ADMIN | AUDITOR |
|---|:--:|:--:|:--:|:--:|:--:|
| Overview | ✅ | ✅ | ✅ | ✅ | — |
| Apply | ✅ | ✅ | ✅ | ✅ | — |
| My Requests | ✅ | ✅ | ✅ | ✅ | — |
| Approvals | — | ✅ (L1) | ✅ (L2) | ✅ (L2) | — |
| Team Calendar | — | ✅ | ✅ | ✅ | — |
| Team Balances | — | ✅ | ✅ | ✅ | — |
| All Requests | — | — | ✅ | ✅ | ✅ read-only |
| Leave Types | — | — | ✅ | ✅ | ✅ read-only |
| Balance Adjustments | — | — | ✅ | ✅ | — |
| Balance Ledger | — | — | ✅ | ✅ | ✅ read-only |
| Holidays | ✅ read | ✅ read | ✅ manage | ✅ manage | ✅ read |
| Settings | — | — | ✅ read | ✅ edit | ✅ read |

`AUDITOR` and any "read" cell: **render the full screen but strip every
mutating control** (no create/edit/delete/approve/adjust buttons, no row
actions, forms shown disabled).

## 5. Primary page views

For **each tab** below, itemise: top metrics/stat tiles → action toolbar →
table/grid columns → per-row actions → pagination/empty/skeleton → which
overlays it can open.

### 5.1 Overview  *(personal, all non-auditor roles)*
- **Stat tiles (row of 3–4):** one `BalanceCard` per `LeaveType` the user is
  eligible for — big `available`, sub-line `accrued / carriedForward / used /
  pending`, thin usage bar (used = primary, pending = amber).
- **Mini-stats (row of 3):** "Requests in flight" (count of `PENDING_*`),
  "Next approved leave" (date range + type), "Next company holiday" (name +
  date).
- **Recent activity:** last 6 of the user's requests — type, date range, days,
  `createdAt`, status pill. Row → opens **Request Detail drawer**.
- States: skeleton tiles + skeleton list; empty = "No leave requests yet →
  Apply".

### 5.2 Apply  *(all non-auditor roles)*
- **Two-pane:** left = form card, right = month calendar peek.
- **Form fields:** Leave type (`select`), Start date, End date, Half day
  (checkbox, single-day only), Reason (`textarea`, optional).
- **Live impact panel** (from `leaveApi.previewRequest`, no network): Duration
  (`Xd`), Balance `before → after` (red if negative), First approver, and an
  amber **LOP warning** with `lopDays` when short.
- **Notice advisory:** amber line if `minNoticeDays` unmet.
- **Right pane:** `LeaveMonthCalendar` — company holidays + weekly-offs + the
  team's approved (solid) and pending (faded) leave chips; the proposed
  `startDate…endDate` range **highlighted** so clashes are obvious before
  submit. Month nav + "Today".
- **Submit** → `leaveApi.createRequest` → success toast (or LOP-info toast) →
  reset form → other tabs refresh.

### 5.3 My Requests  *(all non-auditor roles)*
- **Toolbar:** status filter chips with counts (`All / Pending / With HR /
  Approved / Rejected / Cancelled`).
- **Table columns:** Type (colour chip + code) · Dates (range) · Days
  (right-aligned, decimal) · Requested (`createdAt`) · Status (pill + LOP pill).
- **Row →** Request Detail drawer. If `PENDING_L1|PENDING_L2`, drawer footer
  shows **Withdraw** (→ confirm → `cancelRequest`).
- Pagination: 25/page, "showing N of M". Empty per filter. Skeleton rows.

### 5.4 Approvals  *(LINE_MANAGER = L1, HR/COMPANY_ADMIN = L2)*
- **Header line:** "N requests awaiting your decision" + bulk **Approve
  selected (k)** button when rows are checked.
- **Table columns:** select-all checkbox · Employee (name + department) ·
  Type (+ LOP pill) · Dates (`½` marker if half-day) · Days · Submitted ·
  **Decision** (inline Reject / Approve buttons).
- **Row →** Request Detail drawer with a **Comment** textarea; footer
  Approve / Reject → `leaveApi.decide(id, action, ctx, comment)`. Level acted
  on comes from the row's status.
- Bulk approve loops `decide(...,'approve')`. Decisions toast + reload +
  refresh sibling tabs. Empty = "Inbox zero".

### 5.5 Team Calendar  *(LINE_MANAGER, HR, COMPANY_ADMIN)*
- **Layout:** full-width `LeaveMonthCalendar` (left) + "away this month" list
  (right): name, date range, type chip, status pill.
- Scope: Line Manager → direct reports; HR/Admin → whole company. Month nav.
- Empty = "Nobody's off this month". Skeleton = greyed grid.

### 5.6 Team Balances  *(LINE_MANAGER, HR, COMPANY_ADMIN)*
- **Toolbar:** year switcher.
- **Matrix table:** row = report (name + department); columns = one per
  `LeaveType` (header shows colour dot + code); cell = `available` days
  (**amber ≤ 2**, **red < 0**).
- **Row expands** to a per-type breakdown grid (accrued / carried / used /
  pending). Empty = "No reports". Skeleton rows.

### 5.7 All Requests  *(HR, COMPANY_ADMIN; AUDITOR read-only)*
- **Filter bar (card):** Status `select` · Type `select` · Department `select`
  · From date · To date · Search (employee/reason) · **Clear** · **Export CSV**
  (client-side over the current result set).
- **Table columns:** Employee (name + dept) · Type (+ LOP) · Dates · Days ·
  Requested · Status. Footer: "N requests".
- **Row →** Request Detail drawer. For HR/Admin, a still-`PENDING_L2` row's
  drawer offers Approve/Reject; auditor gets no actions.
- Pagination 25/page. Empty = "No requests match these filters". Skeleton rows.

### 5.8 Leave Types  *(HR, COMPANY_ADMIN; AUDITOR read-only)*
- **Toolbar:** **New leave type** button; toggle "show inactive".
- **Table columns:** Name · Code · Annual quota · Carry-forward cap · Accrual ·
  Gender · Min notice · Paid (✓/�—) · Status (Active/Inactive) · **Actions**
  (`dropdown-menu`: Edit · Initialize balances for year… · Activate/Deactivate).
- **New / Edit → modal** (all fields from 3.1, validation from 3.3).
- **Initialize balances → modal:** pick year → `leaveApi.initializeBalances`
  → toast "Initialized N employees".
- Deactivate → confirm modal (notes existing requests keep their history).

### 5.9 Balance Adjustments  *(HR, COMPANY_ADMIN)*
- **Form card:** Employee (`select`, from directory) · Leave type (`select`) ·
  Year · Delta (signed number, e.g. `+3` / `-1`) · Note (required, audit
  reason) → **Apply adjustment** → `leaveApi.adjustBalance` → toast.
- **Recent adjustments list:** ledger entries where `source = HR_ADJUSTMENT` —
  when, employee, type, delta, balanceAfter, actor, note.
- Show the target's **current balance** for the picked type/year inline so the
  adjuster sees before/after.

### 5.10 Balance Ledger  *(HR, COMPANY_ADMIN; AUDITOR read-only)*
- **Filter bar:** Employee `select` · Leave type `select`.
- **Table columns:** When (`at`) · Employee · Type · Source (labelled) · Delta
  (green +, red −) · Balance after · Actor · Note. Newest first.
- Read-only everywhere (append-only record). Empty / skeleton.

### 5.11 Holidays  *(all roles; manage for HR/COMPANY_ADMIN)*
- **Toolbar:** year switcher (`‹ 2025  2026  2027 ›`); if `canManage`: **Add
  holiday** button.
- **Table columns:** Date · Day of week · Holiday name · Type (Gazetted /
  Optional badge) · **Actions** (delete, `canManage` only). Past dates dimmed.
- **Add holiday → modal:** Date (bounded to year) · Name · Optional checkbox.
- Empty = "No holidays defined for <year>".

### 5.12 Settings  *(COMPANY_ADMIN edit; HR/AUDITOR read-only)*
- **Form sections:** Approval levels (radio 1 / 2, with a one-line explanation
  of each) · Allow LOP requests (switch) · Financial-year start month
  (`select` Jan–Dec, default April). **Save** → `leaveApi.updateSettings` →
  toast. Read-only roles: same layout, all controls disabled, no Save.

## 6. Secondary views & overlays

Render these **on the same canvas** as the primary screens (Section 8), each
labelled with its trigger and the API call it fires.

### 6.1 Slide-over drawers (`sheet`, right side, max-w-md)
- **Request Detail** — trigger: any request row. Shows status + LOP + type
  chip; Leave type, Duration (`range · Xd`, `(half day)`), Reason, Attachment
  (if any). **Approval trail**: vertical timeline "Submitted → L1 → L2 →
  outcome" with per-step approver, decision, timestamp, comment; the step
  awaiting action is ringed. Footer varies by caller:
  - owner + pending → **Withdraw** (`cancelRequest`)
  - approver + pending → **Comment** textarea + **Reject** / **Approve**
    (`decide`)
  - otherwise → no footer (read-only).

### 6.2 Modals (`dialog`, centered, max-w-md)
- **New / Edit Leave Type** — `createType` / `updateType`.
- **Initialize Balances for Year** — `initializeBalances`.
- **Add Company Holiday** — `createHoliday`.
- **Confirm Reject Request** — reason textarea optional → `decide('reject')`.
- **Confirm Withdraw Request** — `cancelRequest`.
- **Confirm Deactivate Leave Type** — `updateType({active:false})`.
- **Confirm Delete Holiday** — `deleteHoliday`.

### 6.3 Inline
- Status filter chips (My Requests), bulk-select bar (Approvals), expandable
  row (Team Balances), live impact panel (Apply).

## 7. Toasts & micro-states

- **Toast system** (`useToast`), bottom-right, auto-dismiss 4s, stacked, with
  icon + title + optional description + close:
  - success: "Leave request submitted", "Request approved", "N requests
    approved", "Adjustment applied", "Settings saved", "Holiday added".
  - info: "Request withdrawn", "Flagged as Loss of Pay — X days exceed your
    balance", "Request rejected".
  - error: "Couldn't submit request", "Action failed — retry".
- **Validation warning** surfaces inline on the form (Section 2.4), not as a
  toast.
- **Empty states** per Section 5. **Skeletons** per Section 2.4 — never a bare
  spinner for a whole page.

## 8. Canvas rendering order (render everything at once)

Do **not** render only the primary page. On the same canvas, lay out
**simultaneously**, each clearly labelled:

1. **Primary workspace** — the tabbed Leave shell with, for each role, its
   default tab populated with realistic data (use the shapes in Section 3).
2. **All slide-over drawers** (6.1) — shown open, beside the main view, one per
   distinct footer variant (read-only / owner-withdraw / approver-decide).
3. **All modals** (6.2) — shown open, above the main view, tiled.
4. **All toast variants** (7) — anchored bottom-right of the frame, stacked.
5. **State gallery** — for the request table and the Apply form, show the
   Default, Hover, Focus, Disabled, Skeleton, Empty, and Error variants
   side by side.

Annotate every overlay and action button with the `leaveApi.*` method + HTTP
endpoint it triggers (see `docs/LEAVE_UI_SPECS.md`) so a backend developer can
map each control to an API call at a glance.

## 9. Deliverable & file layout

```
apps/web/src/pages/leave/
  index.tsx                 # PageHeader + role-filtered Tabs shell
  shared.tsx                # status badge, LOP pill, type chip, date fmt
  use-leave-ctx.ts          # { role, employeeId } for the client
  tabs/
    overview.tsx  apply.tsx  my-requests.tsx  approvals.tsx
    team-calendar.tsx  team-balances.tsx  all-requests.tsx
    leave-types.tsx  balance-adjustments.tsx  ledger.tsx
    holidays.tsx  settings.tsx
  components/
    request-detail-sheet.tsx  status-timeline.tsx
    balance-card.tsx  leave-month-calendar.tsx
```

Constraints recap: React 19 + TS strict (no enums), Tailwind v4 tokens only,
hand-rolled `components/ui` primitives (no Radix), `leaveApi` for all data,
role-gated tabs, every state explicit, all overlays rendered together.
