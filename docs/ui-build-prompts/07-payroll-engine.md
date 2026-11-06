# Payroll Engine — UI Build Prompt

> **✅ Built 2026-11-23 (module 07 Phase 9):** `apps/web/src/pages/payroll/`
> now exists — a tabbed shell (My Pay / Structures / Payroll Run /
> Settings) plus `structure-editor.tsx` and `fnf.tsx` as their own routes,
> covering every screen below marked LIVE. It has not been exercised
> against a live backend in a browser (no Firebase/DB credentials in the
> environment it was built in) — see `docs/modules/07_PAYROLL_ENGINE.md`
> §9 Phase 9. This file remains useful as the detailed per-screen target
> spec (and for the still-`TODO(api)` screens below); where it and the
> actual code disagree, the code wins, per `docs/README.md`'s convention.

**What this is:** a single, rigidly-structured prompt for building every screen
of the Payroll Engine module UI. Written as a technical specification, not a
conversation, so a UI build tool (or an AI agent) renders production-grade
layouts with all overlays and states instead of guessing.

**How to use:** paste everything below the `─── PROMPT ───` line into your build
tool. It carries the frontend stack, the design tokens, the data dictionary,
and the per-role screen map. Pair it with:

- `docs/modules/07_PAYROLL_ENGINE.md` — the module source of truth (personas,
  flows, invariants, permission matrix, the phased build plan in §9, and the
  decisions in §12).
- `docs/MODULE_SPECS.md` §7 — condensed product behaviour and happy path.
- `docs/TENANT_CONFIGURATION.md` — where per-tenant rules live.
- `apps/api/src/payroll` — current backend code.

**Output target:** `apps/web/src/pages/payroll/` (does not exist yet — see the
file layout in §9).

> **Build-target note — read before building:** the module is being built in
> phases (spec §9). **Live today (Phases 1–8):** salary-structure read/create/
> edit (`/api/payroll/structures/:employeeId`), payroll settings read/update
> (`/api/payroll/config/settings`, now including `overtimeEnabled`/
> `overtimeMultiplier`), Professional Tax slab read/replace
> (`/api/payroll/config/pt-slabs`), `workState`/weekly-off-override on the
> employee update route, the full run lifecycle: create
> (`POST /api/payroll/runs`), detail (`GET .../runs/:id` — reduced for
> Auditor, no amounts), ad-hoc adjustments (`PATCH
> .../runs/:id/line-items/:employeeId`), recalculate, submit-review, approve
> (two distinct approvers), process, and disburse — and, in **Attendance's**
> API (not this module's), the `OvertimeClaim` workflow: create
> (`POST /api/attendance/overtime-claims`), list own (`GET` same path),
> approve/reject (`POST .../:id/approve`|`/reject`). A run's line items now
> include approved `CASH` overtime pay automatically when the tenant has it
> enabled — nothing extra to call from Payroll's own screens for that.
> **Also live (Phase 5):** the payslip PDF itself — `GET
> /api/payroll/payslips/:employeeId?period=YYYY-MM` returns a short-lived
> presigned download URL (own for Employee, any for HR/Admin); it opens
> only with the employee's DOB (`DDMMYYYY`) as the password. The bank
> disbursement file — `GET /api/payroll/runs/:id/bank-file?format=CSV`
> (HR/Admin only, once `PROCESSED`/`DISBURSED`) — returns `{filename,
> mimeType, content, skippedEmployeeCount}` as JSON (not a streamed
> download — build the client-side Blob/download from `content`); only
> `format=CSV` (a generic, not-bank-specific layout) is implemented today,
> any other value 400s, so the format picker should offer CSV only until a
> real HDFC/ICICI/SBI/Axis layout is built. **Also live (Phase 6):** TDS.
> `tdsDeducted`/`netPay` on every line item now reflect a real annual-
> projection figure (no longer hardcoded 0) — nothing extra to call for
> that, same as overtime. Tax-regime choice —
> `GET/PUT /api/payroll/tds-regime/:employeeId?financialYear=YYYY-YY`
> (own for Employee, any for HR/Admin; `PUT` body `{financialYear, regime}`)
> — defaults to `NEW` when nothing's been set. Tax-slab/regime-config admin
> — `GET /api/payroll/config/tax-config?financialYear=YYYY-YY` (both
> regimes), `PUT /api/payroll/config/tax-slabs/:regime?financialYear=`,
> `PATCH /api/payroll/config/tax-regime-config/:regime?financialYear=`
> (HR/Admin only) — lazily seeded with UNVERIFIED placeholder slabs on
> first read for a FY, same editable-not-constant posture as PT slabs.
> **Also live (Phase 7):** structure revision + arrears —
> `POST /api/payroll/structures/:employeeId/revise` (HR/Admin only; body
> `{ctcAnnual, effectiveDate, components, reason}`) supersedes the active
> structure and, if `effectiveDate` falls at or before an already-
> `PROCESSED`/`DISBURSED` period, generates arrears for each such period
> — response includes `arrearsGenerated`/`arrearsPeriods`. There is no
> endpoint to list a pending arrears balance directly; arrears show up
> folded into the *next* `POST /api/payroll/runs` call's line items, as an
> `adHocAdjustments` entry with `type: "ARREARS"`. Re-process itself
> (`isReprocess`/`reprocessReason` on run creation) was already live from
> Phase 3. **Also live (Phase 8):** Full & Final — `POST/GET/PATCH
> /api/payroll/fnf/:employeeId` (generate/view/adjust the advance recovery
> figure, `PATCH` only while `DRAFT`) and `POST .../approve` ·
> `POST .../mark-paid` (`DRAFT → APPROVED → PAID`, one approval — not the
> run lifecycle's two-person rule). Only generated for a `SEPARATED`
> employee with `dateOfJoining`/`lastWorkingDate` on file and an active
> salary structure; 404/409/400 otherwise. There is no list endpoint for
> who's awaiting a settlement — the trigger is HR opening a specific
> separated employee's record.
> The overtime **claim/approval screen itself** is Attendance's UI
> (`ui-build-prompts/05-attendance.md`), not this prompt — this prompt only
> needs to *display* approved overtime inside a run's line items (§3.4).
> Build the still-not-built screens to the target spec but mark every
> control `TODO(api)` and keep them behind the same layout so the backend
> has a UI to build against. Do not invent endpoints that aren't in
> `docs/modules/07_PAYROLL_ENGINE.md` §4.3.
>
> **Visual reference:** a sample UI will be supplied separately. This prompt
> is the functional and data contract; when the sample arrives, it governs
> layout and look, and the tokens in §2.2 still govern colour.

---
─── PROMPT ───

## 1. Role & Output Objective

You are a **Senior SaaS UI Architect**. Produce a **production-grade,
responsive layout** for the **Payroll Engine** module of a multi-tenant
India-focused HRMS. Output must be implementation-ready React + TypeScript,
matched to the codebase conventions in Section 2, with **every screen,
overlay, and component state rendered explicitly** (Section 8).

This module moves real money. It must feel **precise, calm, and auditable**:
numbers right-aligned in tabular figures, irreversible actions (process,
disburse) guarded by explicit confirmation, and every locked/immutable state
visibly locked. Dense, back-office feel for HR/Admin surfaces; the employee's
"My pay" surface should feel simple and reassuring. Not a marketing site.

## 2. Global System

### 2.1 Frontend stack (non-negotiable — match exactly)

| Concern | Choice |
|---|---|
| Framework | **React 19** function components + hooks. No class components. |
| Build | **Vite 8**, TypeScript **strict**. `verbatimModuleSyntax` + `erasableSyntaxOnly` are on ⇒ **no `enum`, no `namespace`, no parameter properties**. Use `as const` maps + string-literal union types. Type-only imports use `import type`. |
| Routing | **React Router 7** (`BrowserRouter` + `<Routes>`, no data-router APIs). Pages: `/payroll` (runs overview), `/payroll/runs/:id` (run detail), `/payroll/structures` (employee list) and `/payroll/structures/:employeeId` (structure editor), `/payroll/settings` (statutory config), `/payroll/me` (employee "My pay"), `/payroll/fnf/:employeeId` (Full & Final). |
| Styling | **Tailwind CSS v4** (`@import 'tailwindcss'`, `@theme inline` tokens in `src/index.css`). **No `tailwind.config.js`.** No inline hex — use tokens (2.2). |
| Components | **Hand-rolled shadcn-style primitives** in `src/components/ui` (`cva` + `clsx` + `tailwind-merge` via `cn()`). **No Radix / Headless UI.** Reuse: `button`, `card`, `badge`, `input`(+`Label`), `dialog`, `table`, `tabs`, `select`, `textarea`, `field`, `skeleton`, `empty-state`, `toast` (`useToast()`), `dropdown-menu`, `sheet`. Build a `stepper` and a `money` display helper if missing, matching primitive style. |
| Icons | **lucide-react** (v1.x). |
| Data | `src/lib/api.ts` (`api.get/post/patch/put`). |
| Auth/role | `useAuth()` → `{ user: { role, employeeId, email } }`. Roles: `COMPANY_ADMIN`, `HR_MANAGER`, `LINE_MANAGER`, `EMPLOYEE`, `AUDITOR`. Gating helpers in `src/lib/roles.ts`. |
| Path alias | `@/*` → `src/*`. |
| Dates/money | ISO UTC strings, display **IST**, format `14 Apr 2026`. **Money arrives from the API as decimal strings** (never floats) — parse and format with `Intl.NumberFormat('en-IN')`, currency ₹, two decimals, Indian digit grouping (`₹12,00,000.00`). Never do arithmetic on money in JS floats; compute totals server-side or with a decimal helper. |

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
  role, log out. Role-filtered — the **Payroll** group shows `Runs`,
  `Structures`, `Settings` for `HR_MANAGER`/`COMPANY_ADMIN` (`AUDITOR`:
  `Runs` summary + `Settings` read-only), and only `My pay` for `EMPLOYEE`.
  `LINE_MANAGER` sees no Payroll entry.
- **Top bar**: **breadcrumbs** (`Home / Payroll / Runs / September 2026`) left;
  compact user control (avatar + role → `dropdown-menu`) right. Sticky.
- **Content canvas**: single scroll region, `p-8`, `max-w-[1200px]`. Each page
  opens with a `PageHeader` (title + description + right-aligned actions).
- **Payroll gate banner** (HR/Admin, top of every Payroll page when
  triggered): "Payroll is paused — add a second Company Admin to enable
  payroll runs." Links to Access management. Run-creating and approving
  controls are disabled while shown. **LIVE**: the gate state comes from the
  409 `POST /runs`/`.../approve` return when the tenant has fewer than two
  active Company Admins (INV-4) — surface its message, don't guess the
  count client-side.
- Responsive: `< lg` collapses nav to an icon rail; tables scroll inside their
  own `overflow-x-auto`; page body never scrolls horizontally.

### 2.4 Component state rules

**Show every interactive component in all states, labelled:** Default · Hover ·
Focus-visible (2px `--ring`) · Active · Disabled (`opacity-50`,
`pointer-events-none`) · **Loading/Skeleton** (tables → `SkeletonRows`; cards →
pulsing block of same footprint; buttons → inline spinner + "…" + disabled) ·
**Empty** (`EmptyState`: icon, title, one-liner, optional action) · **Error**
(inline field errors: red text + red control border; form-level error line
above the submit row; failed loads → retryable inline error, never a blank
screen) · **Selected/expanded** (row selected, drawer target) · **Locked**
(a processed run or a superseded structure: read-only, lock icon, muted).

## 3. Data Model & Validation

Render **these exact field names**. No lorem — use realistic Indian names,
amounts, and IST dates.

### 3.1 Salary structure — fields *(LIVE)*

`id` · `employeeId` · `ctcAnnual` (decimal string) · `monthlyCtc` (derived) ·
`basicPercentOfCtc` (derived, 2 dp) · `effectiveFrom` (date) · `status`
(`SalaryStructureStatus`: `ACTIVE|SUPERSEDED`) · `components[]`.

**Component:** `id` · `type` (`SalaryComponentType`: `BASIC|DA|HRA|
SPECIAL_ALLOWANCE|CONVEYANCE|LTA|MEDICAL|CUSTOM|PF_EMPLOYER|ESI_EMPLOYER|
GRATUITY_PROVISION`) · `code` (UPPER_SNAKE; equals `type` for standard
components, tenant-chosen for `CUSTOM`) · `name` · `calculationMode`
(`SalaryCalculationMode`: `FIXED|PERCENT_OF_BASIC|PERCENT_OF_CTC|FORMULA`) ·
`value` (FIXED = **monthly** amount; PERCENT_* = percentage; FORMULA = none) ·
`formula` (FORMULA only) · `sortOrder` · `monthlyAmount` (derived, read-only).

**Formula grammar (show as inline help):** numbers, `+ − × ÷`, parentheses,
and references to component codes plus `CTC` (monthly CTC). Example:
`CTC - BASIC - HRA - CONVEYANCE`. No functions.

### 3.2 Payroll settings — fields *(LIVE)*

`minBasicPercent` · `epfCeiling` · `allowEpfAboveCeiling` · `epfEmployeeRate` ·
`epsRate` · `epfEmployerRate` · `epfAdminRate` · `edliRate` · `esiWageCeiling` ·
`esiEmployeeRate` · `esiEmployerRate`. Show a persistent note: "Default values
are unverified starting points — confirm with your payroll advisor."

### 3.3 Professional Tax slab — fields *(LIVE)*

`state` (`IndianState` — all 36 states/UTs, as a searchable `select` with
human labels: `KARNATAKA` → "Karnataka") · slabs: `grossFrom` · `grossTo`
(null = open-ended, last slab only) · `monthlyAmount` · `februaryAmount?`.
A slab applies when `grossFrom ≤ monthly gross < grossTo`.

### 3.4 Payroll run — fields *(LIVE)*

`id` · `period` (`YYYY-MM`) · `status` (`DRAFT|REVIEW|APPROVED|PROCESSED|
DISBURSED`) · `isReprocess` · `reprocessReason?` · `preparedBy` · `approvals[]`
(`{approverId, approvedAt}` — `approverName` isn't resolved by the API yet,
look it up client-side) · `processedAt?` · `disbursedAt?` · `exceptions[]`
(`{employeeId?, type, detail}` — `type` is `NO_WORK_STATE|NO_SALARY_STRUCTURE|
CALCULATION_ERROR|PENDING_REGULARIZATIONS|NO_DOB_FOR_PAYSLIP` — the last one
added in Phase 5: the employee was still paid, only their payslip PDF was
skipped). No `GET /runs` list endpoint yet — the overview screen below is
`TODO(api)` for that reason even though run actions themselves are live.

**Line item (`PayrollLineItem`):** `employeeId` · `workingDays` · `payableDays`
· `lopDays` · `grossEarnings` (already includes any approved overtime pay) ·
`epfEmployee` · `epfEmployer` · `esiEmployee` · `esiEmployer` ·
`professionalTax` · `tdsDeducted` (**LIVE**, Phase 6: a real annual-
projection figure, no longer hardcoded 0) ·
`adHocAdjustments[]` (`{type, amount, note?}`, signed) · `netPay` ·
`calculationSnapshot` (full breakdown JSON — don't render raw, it's for
debugging/compliance; read `calculationSnapshot.overtimePay` and
`calculationSnapshot.earnings` (look for `code: "OVERTIME"`) for the
overtime figure itself — **LIVE**, Phase 4. There is no separate
`overtimeAmount` scalar column). There is no `payslipStatus` field on the
line item either — **LIVE** (Phase 5): call `GET
/api/payroll/payslips/:employeeId?period=YYYY-MM` and treat a 404 as "no
payslip" (missing DOB, or the run isn't processed yet), a 200 as a
presigned URL ready to open/download. The Auditor's `GET .../runs/:id`
returns a reduced shape instead — no `lineItems`, just
`lineItemCount`/`exceptionCount` — build its summary view from that, not
from the full line-item array.

**Exceptions** (employees excluded from the run, or just missing their
payslip): missing `workState`, no active structure, a calculation error,
pending regularizations for the period (tenant-wide, no `employeeId`), or
(Phase 5) missing `dateOfBirth` (the employee was still paid) — listed
with a fix link where one applies.

### 3.4b Tax regime choice — fields *(LIVE, Phase 6)*

`GET/PUT /api/payroll/tds-regime/:employeeId?financialYear=YYYY-YY` (own
for Employee, any for HR/Admin). Response: `{employeeId, financialYear,
regime: "OLD"|"NEW", setByUserId}` — `setByUserId` is `null` for a
self-service choice, an HR/Admin's `userId` when they moved the employee
(always audited server-side). `PUT` body: `{financialYear, regime}`. No
row yet for an (employee, FY) returns `regime: "NEW"` (the default), not
a 404.

### 3.4c Full & Final settlement — fields *(LIVE, Phase 8)*

`employeeId` · `separationDate` · `unpaidSalaryDays`/`unpaidSalaryAmount`
· `leaveEncashmentDays`/`leaveEncashmentAmount` · `gratuityYearsOfService`/
`gratuityAmount` (0 if `gratuityYearsOfService` is below the tenant's
configured eligibility, default 5) · `advanceRecoveryAmount` ·
`netSettlement` (may be negative if a large advance is owed) · `status`
(`DRAFT|APPROVED|PAID`) · `preparedBy`/`approvedBy`/`approvedAt`/`paidAt`.
The Auditor's `GET` returns a reduced shape — `employeeId`,
`separationDate`, `status`, `approvedAt`, `paidAt` only, no amounts (same
posture as a run's Auditor view).

### 3.6 Status → chip colour

Run: `DRAFT` neutral · `REVIEW` warning · `APPROVED` `lumen-info-soft` ·
`PROCESSED` success (+ lock icon) · `DISBURSED` success (solid). Structure:
`ACTIVE` success · `SUPERSEDED` muted. Exceptions: warning. Full & Final:
`DRAFT` neutral · `APPROVED` `lumen-info-soft` · `PAID` success (solid).

### 3.7 Validation rules (must be visible)

- **Basic floor:** the editor shows "Basic is 48.00% of CTC — minimum 50%" in
  destructive text and disables Save while below `minBasicPercent`. (Server
  enforces the same rule.)
- **Exactly one BASIC** component; standard component codes are fixed to their
  type and not editable; `CUSTOM` codes must be UPPER_SNAKE and unique.
- `FIXED`/`PERCENT_*` require `value`; `FORMULA` requires `formula` and no
  `value`; percentages ≤ 100. Formula errors (syntax, unknown reference,
  circular reference) surface inline under the field with the server message.
- **PT slabs:** must start at 0, be contiguous, and end open-ended — show
  gaps/overlaps live in the editor, disable Save until valid.
- **Structure edit warning:** once a payroll run has used a structure,
  prefer **Revise** (§5.4, LIVE Phase 7) over the in-place editor — a
  revision tracks the change as a `SalaryRevision` and generates arrears
  for any already-processed period it backdates into; a plain `PATCH`
  edit does neither (and, as of Phase 7, isn't server-blocked from being
  used post-use either — show the warning banner, don't rely on a hard
  block).
- **Run approval:** needs **two distinct approvers**; the Approve button shows
  "1 of 2 approvals" and is disabled for a user who already approved. A
  **re-process** additionally requires a reason (min 10 characters).
- **Process** and **Disburse** → confirm modal stating the action is
  irreversible; Process explicitly says the run becomes immutable.

## 4. Roles & screen access

`PLATFORM_ADMIN` is out of scope (separate operator console).

| Screen / capability | EMPLOYEE | LINE_MANAGER | HR_MANAGER | COMPANY_ADMIN | AUDITOR |
|---|:--:|:--:|:--:|:--:|:--:|
| My pay (own structure, LIVE; payslip download, LIVE Phase 5) | own | — | — | — | — |
| Structures list + editor | own, read-only | — | edit | edit | — *(no per-employee pay)* |
| Revise structure (arrears on backdating) | — | — | LIVE | LIVE | — |
| Settings (statutory config) | — | — | edit | edit | view |
| Runs overview (list) | — | — | `TODO(api)` — no list endpoint | `TODO(api)` — no list endpoint | `TODO(api)` |
| Run detail, adjustments, recalculate | — | — | LIVE | LIVE | summary only (LIVE, no amounts) |
| Approve a run (two distinct approvers) | — | — | LIVE | LIVE | — |
| Process / disburse | — | — | LIVE | LIVE | — |
| Re-process (reason required) | — | — | LIVE | LIVE | — |
| Download bank file | — | — | LIVE (CSV only) | LIVE (CSV only) | — |
| Download own/any payslip | own, LIVE | — | any, LIVE | any, LIVE | — |
| Tax regime (own vs. set-for-employee) | own, LIVE | — | set for employee, LIVE (audited) | set for employee, LIVE (audited) | — |
| Tax-slab / regime config | — | — | edit, LIVE | edit, LIVE | view, LIVE |
| Full & Final | own statement, LIVE | — | generate/adjust/approve/pay, LIVE | generate/adjust/approve/pay, LIVE | read-only reduced, LIVE |

Every `TODO(api)` cell: build the screen to spec, gate it behind the role,
render all its controls **disabled with a "Coming soon" tooltip** or wire
them to a clearly-labelled mock — do not silently omit the screen. The
Auditor never sees individual employees' salary structures or line items —
their run detail renders from the reduced `getRun` shape (§3.4), not by
hiding columns client-side from the full one.

## 5. Primary page views

For **each** view: top metrics → action toolbar → table/grid columns → per-row
actions → pagination/empty/skeleton → overlays it can open.

### 5.1 Runs overview  (`/payroll`) — `TODO(api)` list, HR/Admin (Auditor: summary)

- **Stat tiles (row of 4):** Current period status · Employees in run · Gross
  total · Net total.
- **Toolbar:** **New run** (period `select`, defaults to the current month;
  disabled with the gate banner if the tenant fails the two-admin rule) —
  **LIVE** (`POST /api/payroll/runs`, `{period, isReprocess?, reprocessReason?}`).
- **Table columns:** Period · Status (chip) · Employees · Gross · Net ·
  Approvals (`1/2`) · Processed at · Actions (kebab: **Open**, **Start
  re-process** on processed runs). **`TODO(api)`:** there is no `GET /runs`
  list endpoint yet, so this table has nothing to list from — render it from
  a client-side cache of runs created/opened this session plus a manual
  "Open by period" fallback until the backend adds one.
- Empty = "No payroll runs yet" + New run. Preview banner (5.9) only applies
  to the list itself, not to New run (which is live).

### 5.2 Run detail  (`/payroll/runs/:id`) — LIVE

- **Stepper** across the top: Draft → Review → Approved → Processed →
  Disbursed, current step highlighted, processed+ steps with a lock icon.
- **Summary strip:** totals (gross, deductions, net), employee count, LOP days
  total, exceptions count.
- **Exceptions panel** (collapsible, warning tone): excluded employees with the
  reason and a **Fix** link (employee form for `workState`, structure editor
  for a missing structure); a `PENDING_REGULARIZATIONS` exception has no
  employee and no fix link — just the count and a note that attendance for
  the period may still change.
- **Line-item table columns:** Employee · Dept · LOP days · Gross · EPF · ESI ·
  PT · TDS · Overtime (LIVE — read from `calculationSnapshot`, §3.4) ·
  Adjustments · Net · Actions
  (kebab: **Breakdown**, **Add adjustment** while Draft/Review — LIVE,
  `PATCH .../line-items/:employeeId`). Right-aligned tabular figures; sticky
  first column; search + department filter. Not rendered at all for the
  Auditor (§3.4) — show the summary strip only.
- **Approvals panel:** the two approver slots (id + timestamp or "Waiting" —
  approver *name* isn't resolved by the API, join against the employee/user
  list client-side or show the id).
- **Primary action** swaps by state: **Submit for review** → **Approve** →
  **Process** → **Disburse** — all LIVE. Processed runs are fully read-only
  (Locked state) with **Start re-process** (LIVE) and **Download bank
  file** (LIVE, Phase 5 — `GET .../bank-file?format=CSV`; only CSV is
  implemented, so hide/disable any other format option) actions.

### 5.3 Structures list  (`/payroll/structures`) — HR/Admin

- **Toolbar:** search, department filter, filter "Missing structure".
- **Table columns:** Employee (avatar, name, code) · Department · Work state ·
  CTC (annual) · Basic % of CTC · Effective from · Status. Row → editor.
  Employees with no structure show a "Create structure" action. *(Reads the
  employee list; each structure via `GET /api/payroll/structures/:employeeId`.)*

### 5.4 Structure editor  (`/payroll/structures/:employeeId`) — LIVE

- **Header:** employee identity, `ctcAnnual` input, `effectiveFrom` date,
  and a small **Tax regime** control — **LIVE** (Phase 6): shows the
  employee's current regime (`GET .../tds-regime/:employeeId?financialYear=`)
  with an HR-only "Move to OLD/NEW" action (`PUT` same path) — this is the
  audited override path (decision 8); server-side it's indistinguishable
  from the employee's own self-service change in §5.6 except for who's
  calling it.
- **Live summary:** monthly CTC · Basic % of CTC (with floor indicator) ·
  total of components · unallocated amount (informational).
- **Component builder table:** rows for each component — Type · Code · Name ·
  Mode (`select`) · Value or Formula (input swaps by mode) · Monthly amount
  (read-only, computed) · row actions (edit, remove, drag-reorder for
  `sortOrder`). **Add component** menu (standard types not yet used + Custom).
  Quick-start button: "Use standard template" (Basic 50% of CTC, HRA 40% of
  Basic, Special allowance = balancing formula).
- **Save** → `POST` (new) or `PATCH` (existing). Server validation messages
  render inline against the offending row.
- **Revise** action (header, next to Save) — **LIVE** (Phase 7): opens the
  same component builder plus an `effectiveDate` picker (may be backdated)
  and a required `reason` textarea (min 10 characters) — `POST
  .../structures/:employeeId/revise`. The response carries
  `arrearsGenerated`/`arrearsPeriods`; if non-zero, show a confirmation
  toast naming the corrected periods ("Arrears generated for 2026-07,
  2026-08 — will be folded into the next payroll run") rather than a
  table, since there's no endpoint to list pending arrears directly (6.2's
  modal, or inline on this page — builder's choice).
- **Revision history** section: `TODO(api)` — there's no `GET` list
  endpoint for `SalaryRevision` yet, only the `revise()` write path above
  — table placeholder.

### 5.5 Settings  (`/payroll/settings`) — LIVE, HR/Admin edit, Auditor view

- **Statutory rates** card: `PayrollSettings` form (3.2), grouped: Basic floor ·
  EPF (ceiling, opt-above toggle, employee/EPS/EPF/admin/EDLI rates) · ESI
  (ceiling, rates). Save/cancel inline.
- **Professional Tax** card: state `select`, slab table (3.3) with add/remove
  row, live gap/overlap validation, **Save slabs** (replaces the state's whole
  set). States with no slabs show "No PT deducted for this state."
- **Income tax slabs** card — **LIVE** (Phase 6): a financial-year `select`
  (defaults to the current FY), regime tabs (`NEW`/`OLD`), a slab table like
  3.3 (`incomeFrom`/`incomeTo`/`ratePercent`) with add/remove row and the
  same live gap/overlap validation, plus a small regime-config form
  (standard deduction, cess %, 87A rebate threshold/max). `GET
  /api/payroll/config/tax-config?financialYear=` lazily seeds UNVERIFIED
  placeholder figures on first read for a FY, so this card is never empty.
  **Save slabs** → `PUT .../tax-slabs/:regime?financialYear=`; **Save
  config** → `PATCH .../tax-regime-config/:regime?financialYear=`.
- **Overtime** card — **LIVE**: `overtimeEnabled` toggle, `overtimeMultiplier`
  number input (default `2.0`×), part of the same `PATCH .../config/settings`
  call as the statutory rates card above.
- **Full & Final formulas** card — **LIVE** (Phase 8), same `PATCH
  .../config/settings` call: leave-encashment divisor (default 26) and a
  multi-select of component codes (`leaveEncashmentComponents`, default
  `["BASIC"]`) · gratuity eligibility years (default 5), days-per-year
  (default 15), month-divisor (default 26) — the familiar 15/26, 5-year
  rule, all tenant-editable.
- Auditor sees the same layout fully disabled.

### 5.6 My pay  (`/payroll/me`) — EMPLOYEE

- **Payslips** table — **LIVE** (Phase 5), with a caveat: there's no "list my
  payslips" endpoint, only `GET /api/payroll/payslips/:employeeId?period=`
  for a period you already know. Build the period list client-side (e.g. the
  last 12 months) and call that endpoint per period on demand — a 404 means
  no payslip for that period (not yet processed, or DOB missing). Columns:
  Period · **Download** (opens the presigned URL from a successful call).
  Helper text: "Your payslip PDF opens with your date of birth as DDMMYYYY."
- **My salary structure** (LIVE, read-only): component breakdown with monthly
  amounts, annual CTC, effective date. Empty = "Your salary structure hasn't
  been set up yet."
- **Tax regime** — **LIVE** (Phase 6): New (default) / Old radio/toggle,
  current financial year, with a one-line explainer. `GET/PUT
  /api/payroll/tds-regime/:employeeId?financialYear=` — the employee can
  change their own regime directly (no approval step); defaults to `NEW`
  when nothing's been set yet.

### 5.7 Full & Final  (`/payroll/fnf/:employeeId`) — LIVE (Phase 8), HR/Admin (employee: own view)

- **Generate** button (HR/Admin, only shown for a `SEPARATED` employee
  with no existing settlement) → `POST /api/payroll/fnf/:employeeId`;
  surface the 404/409/400 reasons inline (no `lastWorkingDate`/
  `dateOfJoining`/active structure on file, or one already exists).
- Statement layout: unpaid salary days/amount · leave encashment
  days/amount · gratuity years-of-service/amount (0 and a "not yet
  eligible" note if below the tenant's configured years) · advance
  recovery (editable number input while `DRAFT`, `PATCH` on save,
  recomputes net settlement) · net settlement (may render negative in
  destructive text if a large advance is owed). **Approve** (`DRAFT`
  only, one approval — no "1 of 2" counter, unlike a run) and **Mark
  paid** (`APPROVED` only) actions, each a confirm modal. Standalone
  off-cycle (not part of a monthly run) — there's no bank-file
  integration for it.
- Employee's own view: read-only, same fields, no action buttons.

### 5.8 Employee form addition *(LIVE API — small change to module 03's screen)*

Add a **Work state** `select` (all 36 states/UTs) to the employee edit form
(HR/Admin only; the Employee self-edit form must not show it). Helper text:
"Determines Professional Tax. Use the state of the office this person is
attached to."

### 5.9 `TODO(api)` preview banner

Every `TODO(api)` screen shows a persistent banner: "Preview — not yet wired to
live data", plus a first-visit info toast. Render with realistic mock rows.

## 6. Secondary views & overlays

Render on the same canvas as the primary screens (Section 8), each labelled
with its trigger + API call (or `TODO(api)`).

### 6.1 Slide-over drawers (`sheet`, right, max-w-md)

- **Line-item breakdown** — LIVE data from `calculationSnapshot`, trigger: run
  detail row. Earnings by component, each deduction with its basis (e.g.
  "EPF: 12% of ₹15,000 wage ceiling"), LOP calculation (`monthly pay × LOP
  days ÷ working days`), overtime (LIVE — `calculationSnapshot.overtimePay`,
  "hours × hourly rate × multiplier"), adjustments, net.
- **Payslip preview** — **LIVE** (Phase 5), trigger: My pay / run detail.
  The API returns a presigned download URL, not inline content — so
  "preview" is just a download button that opens `url` from `GET
  .../payslips/:employeeId?period=`; there's no in-browser PDF render step
  since the file is password-protected (the browser's own PDF viewer will
  prompt for the DOB password on open).

### 6.2 Modals (`dialog`, centered, max-w-md)

- **New run** — LIVE — period select → `POST /api/payroll/runs`.
- **Add / edit component** — form per 3.1/3.7 (client-side only until Save).
- **Add adjustment** — LIVE — employee, type (advance/bonus/incentive/
  gratuity payout), signed amount, note →
  `PATCH .../runs/:id/line-items/:employeeId`.
- **Approve run** — LIVE — shows "1 of 2 approvals", explains dual approval.
- **Process run** — LIVE — irreversible/immutable warning + typed
  confirmation of the period.
- **Disburse run** — LIVE the status transition; the bank file is a
  separate action (run detail's **Download bank file**, §5.2), not part of
  this modal — disburse, then download, in either order once PROCESSED.
- **Start re-process** — LIVE — required reason textarea (min 10
  characters, matching the server's `BadRequestException`), warns that a
  new run will be created and needs two approvals again.
- **Replace PT slabs** — confirm when the change removes existing slabs.

### 6.3 Inline

- Settings section save/cancel states; run-detail filters; structure editor
  live validation; PT slab live gap/overlap markers.

## 7. Toasts & micro-states

- **Toasts** (`useToast`, bottom-right, 4s, stacked, icon + title + optional
  description + close):
  - success: "Salary structure saved", "Payroll settings updated", "Professional
    Tax slabs saved for Karnataka", "Run submitted for review", "Approval
    recorded — 1 of 2", "Run processed", "Run disbursed".
  - info: "Preview only — this screen isn't wired to live data yet".
  - error: "Basic must be at least 50% of CTC", "Circular reference in formula",
    "This employee already has an active salary structure", "Payroll is paused —
    a second Company Admin is required", "Couldn't save — check the highlighted
    fields".
- **Validation warnings** stay inline on the form, not as toasts.
- **Empty states** per Section 5. **Skeletons** per Section 2.4 — never a bare
  full-page spinner.

## 8. Canvas rendering order (render everything at once)

Do **not** render only the primary page. On the same canvas, lay out
**simultaneously**, each clearly labelled:

1. **Primary workspaces** — Runs overview, Run detail (one instance each in
   Draft, Review with 1/2 approvals, and Processed/Locked), Structures list,
   Structure editor (valid, and with the Basic-floor error), Settings (rates +
   PT slabs + placeholder cards), My pay, Full & Final.
2. **All slide-over drawers** (6.1) — shown open beside the main view.
3. **All modals** (6.2) — shown open, tiled above the main view.
4. **All toast variants** (7) — anchored bottom-right, stacked.
5. **State gallery** — for the run-detail line-item table and the component
   builder, show Default · Hover · Focus · Disabled · Skeleton · Empty · Error ·
   Locked side by side. Include the payroll-gate banner state.

Annotate every overlay and action control with the HTTP method + endpoint it
triggers (or `TODO(api)` if it doesn't exist yet):

- **Live:** `GET /api/payroll/structures/:employeeId` ·
  `POST /api/payroll/structures/:employeeId` ·
  `PATCH /api/payroll/structures/:employeeId` ·
  `GET /api/payroll/config/settings` · `PATCH /api/payroll/config/settings` ·
  `GET /api/payroll/config/pt-slabs?state=` ·
  `PUT /api/payroll/config/pt-slabs/:state` ·
  `PATCH /api/employees/:id` (`workState`/`weeklyOffDaysOverride`, HR/Admin) ·
  `POST /api/payroll/runs` · `GET /api/payroll/runs/:id` ·
  `PATCH /api/payroll/runs/:id/line-items/:employeeId` ·
  `POST /api/payroll/runs/:id/recalculate` ·
  `POST /api/payroll/runs/:id/submit-review` ·
  `POST /api/payroll/runs/:id/approve` ·
  `POST /api/payroll/runs/:id/process` ·
  `POST /api/payroll/runs/:id/disburse` ·
  `GET /api/payroll/runs/:id/bank-file?format=CSV` ·
  `GET /api/payroll/payslips/:employeeId?period=` ·
  `GET /api/payroll/tds-regime/:employeeId?financialYear=` ·
  `PUT /api/payroll/tds-regime/:employeeId` ·
  `GET /api/payroll/config/tax-config?financialYear=` ·
  `PUT /api/payroll/config/tax-slabs/:regime?financialYear=` ·
  `PATCH /api/payroll/config/tax-regime-config/:regime?financialYear=` ·
  `POST /api/payroll/structures/:employeeId/revise` ·
  `POST /api/payroll/fnf/:employeeId` ·
  `GET /api/payroll/fnf/:employeeId` ·
  `PATCH /api/payroll/fnf/:employeeId` ·
  `POST /api/payroll/fnf/:employeeId/approve` ·
  `POST /api/payroll/fnf/:employeeId/mark-paid` ·
  (Attendance's API)
  `POST /api/attendance/overtime-claims` ·
  `GET /api/attendance/overtime-claims` ·
  `POST /api/attendance/overtime-claims/:id/approve` ·
  `POST /api/attendance/overtime-claims/:id/reject`.
- **`TODO(api)`:** a `GET /api/payroll/runs` list · a `SalaryRevision`
  history list.

## 9. Deliverable & file layout

```
apps/web/src/pages/payroll/
  index.tsx          # Runs overview                                  [new, TODO(api) — no list endpoint]
  run-detail.tsx     # Run detail + stepper                           [new, LIVE]
  structures.tsx     # Employee structure list                        [new]
  structure-editor.tsx  # Component builder                           [new, LIVE]
  settings.tsx       # Statutory rates + PT slabs (+ placeholders)    [new, LIVE]
  my-pay.tsx         # Employee payslips + own structure              [new, LIVE]
  fnf.tsx            # Full & Final                                   [new, LIVE]
  components/        # run-stepper.tsx, line-items-table.tsx,
                     # exceptions-panel.tsx, approvals-panel.tsx,
                     # component-builder.tsx, pt-slab-editor.tsx,
                     # tax-slab-editor.tsx, tds-regime-control.tsx,
                     # revise-structure-dialog.tsx,
                     # money.tsx, payroll-gate-banner.tsx,
                     # line-item-drawer.tsx, payslip-preview-drawer.tsx,
                     # run-action-dialogs.tsx
apps/web/src/lib/payroll/   # typed client + types (money as decimal strings)
```

Constraints recap: React 19 + TS strict (no enums), Tailwind v4 tokens only,
hand-rolled `components/ui` primitives (no Radix), `api.*` for data, money as
decimal strings formatted `en-IN`, role-gated screens, every state explicit,
`TODO(api)` screens clearly banner-marked and built to spec rather than
omitted, all overlays rendered together.
