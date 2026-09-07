# Employee Master + Org Structure — UI Build Prompt

**What this is:** a single, rigidly-structured prompt for building every screen
of the Employee Master and Org Structure module UI. Written as a technical
specification, not a conversation, so a UI build tool (or an AI agent) renders
production-grade layouts with all overlays and states instead of guessing.

**How to use:** paste everything below the `─── PROMPT ───` line into your build
tool. It carries the frontend stack, the design tokens, the data dictionary,
and the per-role screen map. Pair it with:

- `docs/MODULE_SPECS.md` §3 — product behaviour, happy paths, known gaps.
- `docs/BACKEND_ARCHITECTURE.md` — how the backend is wired.
- `apps/api/src/employees` + `apps/web/src/pages/employees` — current code.

**Output target:** `apps/web/src/pages/employees/` (+ `org-chart.tsx`,
`departments.tsx`).

> **Field scope note:** this prompt lists the full SRS-driven field set
> (identity, employment, compensation-adjacent, statutory, bank, emergency
> contact, documents). Some fields aren't in the API yet — the current
> `Employee` model is lean (identity + department + manager + status + shift).
> Build the UI for the full set; mark not-yet-wired fields as `TODO(api)` and
> keep them behind the same layout so the backend has a target.

---
─── PROMPT ───

## 1. Role & Output Objective

You are a **Senior SaaS UI Architect**. Produce a **production-grade,
responsive layout** for the **Employee Master + Org Structure** module of a
multi-tenant India-focused HRMS. Output must be implementation-ready
React + TypeScript, matched to the codebase conventions in Section 2, with
**every screen, overlay, and component state rendered explicitly** (Section 8).

This is the system-of-record for people data — every other module (Leave,
Attendance, Payroll, Compliance) references it. Dense, precise, back-office
feel. Not a marketing site.

## 2. Global System

### 2.1 Frontend stack (non-negotiable — match exactly)

| Concern | Choice |
|---|---|
| Framework | **React 19** function components + hooks. No class components. |
| Build | **Vite 8**, TypeScript **strict**. `verbatimModuleSyntax` + `erasableSyntaxOnly` are on ⇒ **no `enum`, no `namespace`, no parameter properties**. Use `as const` maps + string-literal union types. Type-only imports use `import type`. |
| Routing | **React Router 7** (`BrowserRouter` + `<Routes>`, no data-router APIs). Pages: `/employees` (directory), `/employees/new`, `/employees/:id` (detail, internal tabs), `/departments`, `/org-chart`. |
| Styling | **Tailwind CSS v4** (`@import 'tailwindcss'`, `@theme inline` tokens in `src/index.css`). **No `tailwind.config.js`.** No inline hex — use tokens (2.2). |
| Components | **Hand-rolled shadcn-style primitives** in `src/components/ui` (`cva` + `clsx` + `tailwind-merge` via `cn()`). **No Radix / Headless UI.** Reuse: `button`, `card`, `badge`, `input`(+`Label`), `dialog`, `table`, `tabs`, `select`, `textarea`, `field`, `skeleton`, `empty-state`, `toast` (`useToast()`), `dropdown-menu`, `sheet`. Add primitives only if genuinely missing, in the same style. |
| Icons | **lucide-react** (v1.x). |
| Data | `src/lib/api.ts` (`api.get/post/patch`); multipart uploads build a raw `fetch` with `getAccessToken()` + `X-Tenant-Subdomain` (see current `employees/detail.tsx`). |
| Auth/role | `useAuth()` → `{ user: { role, employeeId, email } }`. Roles: `COMPANY_ADMIN`, `HR_MANAGER`, `LINE_MANAGER`, `EMPLOYEE`, `AUDITOR`. Gating helpers in `src/lib/roles.ts`. |
| Path alias | `@/*` → `src/*`. |
| Dates/money | ISO UTC strings, display **IST**, format `14 Apr 2026`. Money is `Decimal` — render `₹ 12,00,000` (Indian grouping). |

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

- **Fixed left nav panel** 240px (`w-60`), `bg-card` + right border; icon +
  label links, active = `bg-secondary`; bottom: theme toggle, user email +
  role, log out. Role-filtered.
- **Top bar**: **breadcrumbs** (`Home / Employees / <name>` or `/ Org Chart`)
  left; compact user control (avatar + role → `dropdown-menu`) right. Sticky.
- **Content canvas**: single scroll region, `p-8`, `max-w-[1200px]`. Each page
  opens with a `PageHeader` (title + description + right-aligned actions). The
  **detail page** uses an internal `Tabs` strip.
- Responsive: `< lg` collapses nav to an icon rail; tables scroll inside their
  own `overflow-x-auto`; page body never scrolls horizontally; the org chart
  gets pinch/scroll zoom on touch.

### 2.4 Component state rules

**Show every interactive component in all states, labelled:** Default · Hover ·
Focus-visible (2px `--ring`) · Active · Disabled (`opacity-50`,
`pointer-events-none`) · **Loading/Skeleton** (tables → `SkeletonRows`; cards →
pulsing block of same footprint; buttons → inline spinner + "…" + disabled) ·
**Empty** (`EmptyState`: icon, title, one-liner, optional action) · **Error**
(inline field errors: red text + red control border; form-level error line
above the submit row; failed loads → retryable inline error, never a blank
screen) · **Selected/expanded** (row selected, tree node expanded, drawer
target).

## 3. Data Model & Validation

Render **these exact field names**. Group them into the detail-page tabs shown.
No lorem — use realistic Indian names, departments, IFSC codes, etc.

### 3.1 Employee — fields by section

**Identity & personal** — `employeeCode` (unique per tenant) · `firstName` ·
`lastName` · `personalEmail` · `phone` · `dateOfBirth` · `gender`
(`MALE|FEMALE|OTHER|UNDISCLOSED`) · `maritalStatus`
(`SINGLE|MARRIED|OTHER`) *(TODO(api))* · `bloodGroup` *(TODO(api))* ·
`nationality` *(TODO(api))* · `photoUrl` *(TODO(api))*.

**Employment** — `designation` · `departmentId` (→ Department) ·
`employmentType` (`FULL_TIME|PART_TIME|CONTRACT|INTERN|CONSULTANT`)
*(TODO(api))* · `dateOfJoining` · `workLocation` *(TODO(api))* ·
`reportingManagerId` (→ Employee) · `shiftId` (→ Shift; `null` = tenant
default) · `lifecycleState` (see 3.2) · `probationEndDate` *(TODO(api))* ·
`confirmationDate` *(TODO(api))* · `noticeStartDate` *(TODO(api))* ·
`lastWorkingDate` *(TODO(api))*.

**Compensation-adjacent** *(all TODO(api); full salary structure lives in
Payroll)* — `ctcAnnual` (Decimal) · `payGrade` · `costCenter`.

**Statutory (India)** *(all TODO(api))* — `pan` (store encrypted; show
masked `ABCDE****F`) · `aadhaarLast4` (**last 4 digits only** — never accept or
store the full 12; per `CLAUDE.md`) · `uan` · `pfNumber` · `esicNumber` ·
`taxRegime` (`OLD|NEW`).

**Bank (for disbursement)** *(TODO(api) / not yet KMS-encrypted)* —
`accountHolderName` · `bankAccountNumber` (encrypted; show masked `••••1234`) ·
`ifsc` · `bankName` · `branch` · `accountType` (`SAVINGS|CURRENT`).

**Emergency contacts** (0..n) *(TODO(api))* — `name` · `relationship` ·
`phone` · `altPhone` · `address` · `isPrimary` (exactly one).

**Documents** (0..n) — `id` · `label` · `category`
(`OFFER_LETTER|ID_PROOF|ADDRESS_PROOF|EDUCATION|EXPERIENCE|OTHER`) *(category
TODO(api))* · `mimeType` (`application/pdf|image/jpeg|image/png`) · `sizeBytes`
(≤ 10 MB) · `uploadedAt` · `uploadedByName` *(TODO(api))*.

**Reporting (read-only, derived)** — `reportingManager` {`firstName`,`lastName`}
· `directReports` [{`id`,`firstName`,`lastName`,`designation`}].

**Linked login (optional, create-time)** — `loginEmail` · `loginRole`
(`COMPANY_ADMIN|HR_MANAGER|LINE_MANAGER|EMPLOYEE|AUDITOR`) ·
`loginTempPassword`. Creating one provisions a Firebase user + custom claims.

**Department** — `id` · `name` · `code` *(TODO(api))* · `headEmployeeId`
*(TODO(api))* · `parentDepartmentId` *(TODO(api), for BU→Dept→Team)* ·
`employeeCount` (derived).

### 3.2 Lifecycle state — labels & allowed transitions

Current API enum: `ACTIVE · ON_LEAVE · SUSPENDED · RESIGNED · TERMINATED`.
**SRS target (render this set, map to API):**
`PRE_JOINING → PROBATION → CONFIRMED → NOTICE_PERIOD → SEPARATED`
(plus `SUSPENDED` as a side state from `CONFIRMED`/`PROBATION`).

- `PRE_JOINING` (grey) → `PROBATION` on/after `dateOfJoining`.
- `PROBATION` (amber) → `CONFIRMED` (needs `confirmationDate`) or `SEPARATED`.
- `CONFIRMED` (teal) → `NOTICE_PERIOD` (needs `noticeStartDate`) or `SUSPENDED`.
- `NOTICE_PERIOD` (amber) → `SEPARATED` (needs `lastWorkingDate`; triggers FnF
  later) or back to `CONFIRMED` (withdrawal).
- `SEPARATED` (grey) — terminal; record read-only except documents.
- Disable/hide transition buttons that aren't allowed from the current state.
  Every transition → confirm modal capturing the required date + a reason.

### 3.3 Validation rules (must be visible)

- Mandatory unfilled → red border + red helper text; **submit disabled** until
  minimally valid.
- `employeeCode` required, unique (async check → inline "Code already in use").
- `firstName`, `lastName` required. `personalEmail` valid email. `phone` = 10
  digits (India) or E.164.
- `dateOfBirth` → age < 18 shows an amber advisory. `dateOfJoining` required
  unless `PRE_JOINING`; must be ≥ `dateOfBirth` + 15y.
- `ifsc` matches `^[A-Z]{4}0[A-Z0-9]{6}$`; `bankAccountNumber` 9–18 digits;
  `accountHolderName` required if any bank field is set.
- `pan` matches `^[A-Z]{5}[0-9]{4}[A-Z]$` (uppercase-normalise on blur).
  `aadhaarLast4` = exactly 4 digits — reject any input longer than 4.
- `uan` = 12 digits; `esicNumber` = 17 digits; `pfNumber` free text.
- `ctcAnnual` ≥ 0, numeric; render grouped on blur.
- Emergency contact: `name` + `relationship` + `phone` required per row;
  exactly one `isPrimary`.
- Document upload: extension/mime in {pdf, jpg, jpeg, png}, size ≤ 10 MB —
  reject client-side with a specific message before hitting the API.
- Bulk import: `.xlsx` only; parse client-side preview; the API returns
  `[{ row, status: 'ok'|'error', message }]` — **never fail the whole batch**,
  show a per-row result table, let the user re-upload only failed rows.
- Destructive actions (separate employee, delete department, remove document,
  revoke login) → confirm modal.

## 4. Roles & screen access

`PLATFORM_ADMIN` is out of scope (separate operator console).

| Screen / capability | EMPLOYEE | LINE_MANAGER | HR_MANAGER | COMPANY_ADMIN | AUDITOR |
|---|:--:|:--:|:--:|:--:|:--:|
| Directory (list) | own record only | own + reports | all | all | all (read-only) |
| Employee detail — view | own | own + reports | all | all | all (read-only) |
| Employee detail — edit personal/contact/emergency | own only | — | all | all | — |
| Employee detail — edit employment/comp/statutory/bank | — | — | ✅ | ✅ | — |
| Add employee / linked login | — | — | ✅ | ✅ | — |
| Lifecycle transitions | — | — | ✅ | ✅ | — |
| Bulk import | — | — | ✅ | ✅ | — |
| Documents — upload/delete | own (upload only) | — | ✅ | ✅ | view + download |
| Departments | — | view | ✅ | ✅ | view |
| Org Chart | ✅ (self-centred) | ✅ (team-centred) | ✅ | ✅ | ✅ |

Any read-only cell / `AUDITOR`: render the full screen, strip every mutating
control, show forms disabled.

## 5. Primary page views

For **each** view: top metrics → action toolbar → table/grid columns → per-row
actions → pagination/empty/skeleton → overlays it can open.

### 5.1 Directory  (`/employees`)
- **Stat tiles (row of 4):** Headcount · Active/Confirmed · In Probation ·
  On Notice. (Small; the full analytics live on the Dashboard.)
- **Toolbar:** search (name / code / email) · Department `select` · Lifecycle
  `select` · Employment type `select` · **Add employee** (HR/Admin) ·
  **Bulk import** (HR/Admin) · **Export CSV**.
- **Bulk-select bar** (appears when rows checked): Assign department… ·
  Assign manager… · Export selected · (count).
- **Table columns:** checkbox · Name (link → detail; avatar + code sub-line) ·
  Department · Designation · Reporting manager · Employment type · Lifecycle
  (pill) · Date of joining. Sortable: Name, Department, Date of joining.
- **Row →** navigates to detail; a kebab `dropdown-menu` offers Quick view
  (drawer) · Edit · Change status.
- Pagination 25/page, "showing N of M". Empty = "No employees visible to your
  role yet" (+ Add employee for HR/Admin). Skeleton rows.

### 5.2 Employee Detail  (`/employees/:id`) — internal tabs
Header: avatar, `firstName lastName`, `employeeCode · designation`, lifecycle
pill, and a **Change status** button (HR/Admin). Tabs:

1. **Profile** — Identity & personal fields (3.1). Edit = section modal or
   inline edit toggle (`EMPLOYEE` may edit own contact fields only).
2. **Employment** — Employment fields + Shift. HR/Admin edit; shows probation/
   confirmation/notice/last-working dates as a small timeline.
3. **Compensation & Statutory** — comp-adjacent + statutory fields, all
   **masked by default** with a "reveal" toggle that is itself permissioned
   (HR/Admin only) and logged. `aadhaarLast4` shows `XXXX-XXXX-1234`.
4. **Bank** — bank fields, account number masked; "Verify with penny-drop"
   button is a `TODO(api)` placeholder (disabled + tooltip).
5. **Emergency Contacts** — list of contact cards; **Add contact** (drawer);
   per-card edit/delete; primary badge.
6. **Documents** — upload dropzone (drag + click; mime/size guard from 3.3) ·
   list: label, category badge, type icon, size, uploaded date/by ·
   row actions: Download (5-min presigned URL) · Delete (confirm). Empty =
   "No documents uploaded".
7. **Reporting** — this employee's manager (card) + direct reports (mini
   table, link each) + a "View in org chart" button (deep-links `/org-chart`
   focused on this node).

### 5.3 Add Employee  (`/employees/new`) — sectioned form
Full-page form, sections as accordions/steps mirroring the detail tabs
(Identity → Employment → Bank → Statutory → Emergency contact → Linked login).
Only Identity + Employment are required to submit; the rest can be completed
later on the detail page. **Linked login** section: optional; `loginEmail` +
`loginRole` + `loginTempPassword` (or "send reset link" toggle). Sticky footer:
Cancel · Save as draft *(TODO(api))* · **Create employee**. On success →
navigate to the new detail page + success toast.

### 5.4 Bulk Import  (modal or `/employees/import`)
- Step 1: **Download .xlsx template** (columns incl. required
  `employeeCode`, `firstName`, `lastName`; optional department name, manager
  code, designation, DOJ, email). Link + a small column reference table.
- Step 2: **Drop .xlsx** → client-side parse → preview table (first 20 rows,
  row count, detected columns, obvious problems flagged amber).
- Step 3: **Import** → `POST /employees/bulk-import` → **result table**: Row ·
  Name · Status (`ok` green / `error` red) · Message. Summary: "X created,
  Y failed". **Download failed rows** as .xlsx to fix & re-upload.
- States: parsing skeleton, upload progress bar, per-row error rows.

### 5.5 Departments  (`/departments`)
- **Toolbar:** **New department** (HR/Admin) · search.
- **Table columns:** Name · Code · Head (employee link) · Parent department ·
  Employees (count) · Actions (`dropdown-menu`: Edit · Delete).
- **New / Edit → modal:** name, code, head (`select` of employees), parent
  (`select`). **Delete → modal** requires choosing a target department to
  reassign that dept's employees into (block delete if employees exist and no
  target chosen).
- Empty = "No departments yet".

### 5.6 Org Chart  (`/org-chart`)
- **Toolbar:** search (name/designation → highlights match, auto-expands the
  path, pans to it) · Department filter · **Expand all / Collapse all** ·
  zoom `− / reset / +` · **Export** (`dropdown-menu`: PNG · PDF) *(export =
  `TODO(api)`; wire html-to-image/canvas client-side)*.
- **Node card:** avatar, name, designation, department, "▸ N reports" toggle;
  vacancy/open-req nodes are out of scope (deferred).
- **Interactions:** click a node → **Employee quick-view drawer**;
  double-click → re-root the tree on that node ("focus"); breadcrumb above the
  canvas shows the focus path with a "back to top" reset.
- Scope by role: `EMPLOYEE` opens centred on self; `LINE_MANAGER` centred on
  self with their subtree expanded; HR/Admin/Auditor see the whole tree from
  the top.
- States: skeleton = greyed node placeholders; empty (no employees) =
  `EmptyState`; large-tree perf note — virtualise / lazy-expand beyond ~200
  nodes.

## 6. Secondary views & overlays

Render on the same canvas as the primary screens (Section 8), each labelled
with its trigger + API call.

### 6.1 Slide-over drawers (`sheet`, right, max-w-md)
- **Employee Quick View** — trigger: directory kebab or org-chart node. Avatar,
  name, code, designation, department, manager, lifecycle, contact; buttons:
  Open full profile · (HR/Admin) Change status.
- **Add / Edit Emergency Contact** — form (3.1); `POST/PATCH` contact
  *(TODO(api))*.
- **Add / Edit Employment section** *(optional pattern)* — if you use drawers
  instead of section modals for editing.

### 6.2 Modals (`dialog`, centered, max-w-md)
- **Change Lifecycle State** — shows current → target, required date input,
  reason textarea; only valid transitions selectable (3.2) →
  `PATCH /employees/:id`.
- **Edit `<section>` details** — per detail tab (Profile / Employment /
  Compensation & Statutory / Bank).
- **Confirm Separate Employee** — captures `lastWorkingDate` + reason; warns
  that linked login will be disabled.
- **Reveal sensitive fields** — confirm + note "this view is logged" before
  unmasking PAN / Aadhaar / bank account.
- **New / Edit Department**, **Delete Department (with reassign)**.
- **Bulk Import** (5.4) if run as a modal.
- **Confirm Delete Document**, **Confirm Revoke Login**.

### 6.3 Inline
- Directory filter bar + bulk-select bar; detail-tab inline-edit toggles;
  org-chart focus breadcrumb; import per-row result rows.

## 7. Toasts & micro-states

- **Toasts** (`useToast`, bottom-right, 4s, stacked, icon + title + optional
  description + close):
  - success: "Employee created", "Profile updated", "Status changed to
    Confirmed", "Document uploaded", "Department saved", "12 employees
    imported".
  - info: "Login reset link sent", "Reveal logged for audit".
  - error: "Employee code already in use", "File exceeds 10 MB", "Upload
    failed — retry", "3 rows failed to import".
- **Validation warnings** stay inline on the form, not as toasts.
- **Empty states** per Section 5. **Skeletons** per Section 2.4 — never a bare
  full-page spinner.

## 8. Canvas rendering order (render everything at once)

Do **not** render only the primary page. On the same canvas, lay out
**simultaneously**, each clearly labelled:

1. **Primary workspaces** — Directory (populated), Employee Detail with all 7
   tabs visible as a stack or tabbed sample, Add Employee form, Bulk Import
   flow (all 3 steps), Departments table, Org Chart.
2. **All slide-over drawers** (6.1) — shown open beside the main view.
3. **All modals** (6.2) — shown open, tiled above the main view.
4. **All toast variants** (7) — anchored bottom-right, stacked.
5. **State gallery** — for the directory table and the Add Employee form, show
   Default · Hover · Focus · Disabled · Skeleton · Empty · Error side by side.

Annotate every overlay and action control with the HTTP method + endpoint it
triggers so a backend developer can map each control to an API call:

- `GET /api/employees` (row-scoped) · `GET /api/employees/:id` ·
  `GET /api/employees/org-chart` · `POST /api/employees` (HR/Admin) ·
  `PATCH /api/employees/:id` (HR/Admin) ·
  `POST /api/employees/bulk-import` (HR/Admin) ·
  `GET /api/employees/:id/documents` ·
  `POST /api/employees/:id/documents?label=` (multipart) ·
  `GET /api/documents/:id/download-url` (5-min presigned) ·
  `GET /api/departments` · `POST /api/departments` (HR/Admin).
- `TODO(api)` for: emergency contacts CRUD, document delete + category,
  statutory/bank/comp fields + masked-reveal audit, lifecycle-date fields,
  department edit/delete/hierarchy, org-chart export, bulk "draft".

## 9. Deliverable & file layout

```
apps/web/src/pages/employees/
  list.tsx        # Directory: stat tiles, filters, bulk bar, table
  detail.tsx      # Header + 7 internal tabs
  create.tsx      # Sectioned Add Employee form
  import.tsx      # Bulk import (template / preview / result)  [new]
  components/     # employee-quick-view.tsx, section-edit-dialog.tsx,
                  # lifecycle-dialog.tsx, emergency-contact-form.tsx,
                  # document-list.tsx, masked-field.tsx
apps/web/src/pages/departments.tsx
apps/web/src/pages/org-chart.tsx   # tree, search, zoom, focus, export
```

Constraints recap: React 19 + TS strict (no enums), Tailwind v4 tokens only,
hand-rolled `components/ui` primitives (no Radix), `api.*` for data + raw
`fetch` for uploads, role-gated screens, masked sensitive fields with logged
reveal, Aadhaar last-4 only, every state explicit, all overlays rendered
together.
