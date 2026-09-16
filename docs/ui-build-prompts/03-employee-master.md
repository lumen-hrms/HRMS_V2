# Employee Master + Org Structure — UI Build Prompt

**What this is:** a single, rigidly-structured prompt for building every screen
of the Employee Master and Org Structure module UI. Written as a technical
specification, not a conversation, so a UI build tool (or an AI agent) renders
production-grade layouts with all overlays and states instead of guessing.

**How to use:** paste everything below the `─── PROMPT ───` line into your build
tool. It carries the frontend stack, the design tokens, the data dictionary,
and the per-role screen map. Pair it with:

- `docs/modules/03_EMPLOYEE_MASTER.md` — the module source of truth
  (personas, flows, technical + functional expectations, permissions matrix).
- `docs/MODULE_SPECS.md` §3 — condensed product behaviour, happy paths, known gaps.
- `docs/BACKEND_ARCHITECTURE.md` — how the backend is wired.
- `apps/api/src/employees` + `apps/web/src/pages/employees` — current code.

**Output target:** `apps/web/src/pages/employees/` (+ `org-chart.tsx`,
`departments.tsx`).

> **Field scope note (updated 2026-09-11):** the full SRS-driven field set
> below is **live in the API** — identity/personal, employment,
> compensation-adjacent, statutory (KMS-encrypted PAN), bank
> (KMS-encrypted account number), emergency contacts, and document
> category/delete are all real endpoints today (`docs/modules/
> 03_EMPLOYEE_MASTER.md` §4). `apps/web/src/pages/employees/{detail,list}.tsx`
> now render this prompt's target header-banner + internal-tabs detail page
> and stat-tile + filter directory (§5.1/§5.2 below) — that part of the
> redesign is **done**. `org-chart.tsx` is the one page still on the old
> plain-nested-list rendering (§5.6) — its search/expand/zoom/export
> interactivity is the remaining redesign work. Only two things below are still
> genuinely `TODO(api)`: BU→Dept→Team hierarchy (`parentDepartmentId` —
> deliberately deferred, not planned for V1) and org-chart PNG/PDF export
> (deferred). Everything else marked `TODO(api)` in earlier drafts of this
> prompt is now real — build against it, don't stub it.

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
(free text — no schema enum; render `MALE|FEMALE|OTHER|UNDISCLOSED` as
suggested options but don't hard-validate against them) · `maritalStatus`
(`SINGLE|MARRIED|OTHER`) · `bloodGroup` (free text, e.g. `O+`) ·
`nationality` · `photoUrl` (a plain URL string today — **no upload widget
exists**; render a text input, not a dropzone, unless you're also asked to
build that upload flow).

**Employment** — `designation` · `departmentId` (→ Department) ·
`employmentType` (`FULL_TIME|PART_TIME|CONTRACT|INTERN|CONSULTANT`) ·
`dateOfJoining` · `workLocation` · `reportingManagerId` (→ Employee) ·
`shiftId` (→ Shift; `null` = tenant default) · `lifecycleState` (see 3.2) ·
`probationEndDate` / `confirmationDate` / `noticeStartDate` /
`lastWorkingDate` (each written only by its matching lifecycle transition —
never directly editable).

**Compensation-adjacent** (full salary *structure* lives in Payroll, module
07, not built) — `ctcAnnual` (`NUMERIC(14,2)`) · `payGrade` · `costCenter`.

**Statutory (India)** — `pan` (write via `PATCH .../sensitive-fields`; the
GET response never includes it — only `panMasked`, e.g. `ABCDE****F`) ·
`aadhaarLast4` (**exactly 4 digits — never the full 12**, per `CLAUDE.md`) ·
`uan` · `pfNumber` · `esicNumber` · `taxRegime` (`OLD|NEW`).

**Bank (disbursement)** — `bankAccountHolderName` · `bankAccountNumber`
(write-only via `PATCH .../sensitive-fields`; GET returns `bankAccountMasked`,
e.g. `••••1234`) · `bankIfsc` · `bankName` · `bankBranch` ·
`bankAccountType` (`SAVINGS|CURRENT`).

**Reveal** — a masked PAN/bank-account row plus an eye icon
(HR/Admin/Auditor only) that calls `POST /employees/:id/reveal
{field, reason}` and shows the decrypted value inline for the rest of the
session. Every reveal is audited server-side (actor, field, reason,
timestamp — never the value); build the UI as if that's already true,
because it is.

**Emergency contacts** (0..n, full CRUD) — `id` · `name` · `relationship` ·
`phone` · `altPhone` · `address` · `isPrimary` (server unsets the previous
primary when a new one is set — reflect that in the UI without a client-side
"are you sure" beyond the normal save action).

**Documents** (0..n) — `id` · `label` · `category`
(`OFFER_LETTER|ID_PROOF|ADDRESS_PROOF|EDUCATION|EXPERIENCE|OTHER`,
editable inline via `PATCH /documents/:id/category`) · `mimeType`
(`application/pdf|image/jpeg|image/png` — server enforces this allow-list,
so a client-side check is a courtesy, not the real gate) · `sizeBytes`
(≤ 10 MB, also server-enforced) · `uploadedAt` · `uploadedByName` (captured
server-side from the uploading actor). Delete is a **hard delete**
(`DELETE /documents/:id` — S3 object + row both removed, no undo).

**Reporting (read-only, derived)** — `reportingManager` {`firstName`,`lastName`}
· `directReports` [{`id`,`firstName`,`lastName`,`designation`}]. Note: a Line
Manager's visibility (directory, detail, documents, org chart) is the
**full recursive subtree**, not just direct reports — the API already
resolves this; the UI doesn't need its own recursion, just render whatever
the scoped list/tree endpoints return.

**Linked login (optional, create-time)** — `loginEmail` · `loginRole`
(`COMPANY_ADMIN|HR_MANAGER|LINE_MANAGER|EMPLOYEE|AUDITOR`) ·
`loginTempPassword`. Creating one provisions a Firebase user + custom claims.

**Department** — `id` · `name` · `code` · `headEmployeeId` (a plain
reference, not a relation — no employee-picker validation needed beyond
"pick any employee in the tenant") · `employeeCount` (derived).
`parentDepartmentId` for BU→Dept→Team **does not exist and is not planned
for V1** — don't build a hierarchy picker; flat Department is the whole
model. Edit and delete-with-reassign (`PATCH`/`DELETE /departments/:id`)
are both real endpoints.

### 3.2 Lifecycle state — labels & allowed transitions

This is the **live API enum** — `EmployeeLifecycleState`:
`PRE_JOINING | PROBATION | CONFIRMED | NOTICE_PERIOD | SUSPENDED | SEPARATED`.
New employees default to `PROBATION`. The transition graph, each edge
naming the date field it requires (server-validated — a bad edge 400s):

- `PRE_JOINING` (grey) → `PROBATION` (no date needed).
- `PROBATION` (amber) → `CONFIRMED` (needs `confirmationDate`) ·
  `SEPARATED` (needs `lastWorkingDate`) · `SUSPENDED` (no date).
- `CONFIRMED` (teal) → `NOTICE_PERIOD` (needs `noticeStartDate`) ·
  `SUSPENDED` (no date).
- `NOTICE_PERIOD` (amber) → `SEPARATED` (needs `lastWorkingDate`; triggers
  FnF later, module 07 not built) · `CONFIRMED` (withdrawal, no date).
- `SUSPENDED` (red) → `PROBATION` or `CONFIRMED` (caller picks which, no
  date) — there's no server-tracked "prior state" to auto-return to.
- `SEPARATED` (grey) — terminal; record read-only except documents.
- Disable/hide transition buttons that aren't allowed from the current
  state (mirror `apps/web/src/pages/employees/detail.tsx`'s
  `LIFECYCLE_TRANSITIONS` map — keep the UI and the API's graph in sync by
  construction, don't hand-maintain two copies that can drift). Every
  transition → confirm modal capturing the required date + a reason →
  `PATCH /employees/:id/lifecycle {targetState, effectiveDate?, reason}`.
  A `SEPARATED` target disables the employee's linked login server-side —
  show that consequence in the confirm modal, not just after the fact.

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
| Directory (list) | own record only | own + reports (recursive) | all | all | all (read-only) |
| Employee detail — view | own | own + reports (recursive) | all | all | all (read-only) |
| Employee detail — edit personal/contact | own only | — | all | all | — |
| Employee detail — edit employment/comp/statutory/bank | — | — | ✅ | ✅ | — |
| Reveal masked PAN/bank (logged) | — | — | ✅ | ✅ | ✅ (read, logged) |
| Emergency contacts — CRUD | own only | — | all | all | — |
| Add employee / linked login | — | — | ✅ | ✅ | — |
| Lifecycle transitions | — | — | ✅ | ✅ | — |
| Bulk import | — | — | ✅ | ✅ | — |
| Documents — upload | own only | — | ✅ | ✅ | — |
| Documents — delete / set category | — | — | ✅ | ✅ | — |
| Documents — download | own | reports (recursive) | ✅ | ✅ | ✅ |
| Departments — view / edit / delete | — | view | ✅ | ✅ | view |
| Org Chart | ✅ (self-centred) | ✅ (team-centred, recursive) | ✅ | ✅ | ✅ |

Every row above is **server-enforced today** — `PATCH /employees/:id`
403s a Line Manager or Auditor outright, and silently drops any field
outside an Employee's own whitelist rather than 403ing the whole request
(so build the self-edit form as a genuinely reduced field set, not a full
form with disabled fields). Any read-only cell / `AUDITOR`: render the
full screen, strip every mutating control, show forms disabled.

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
Header: avatar (or initials if `photoUrl` unset), `firstName lastName`,
`employeeCode · designation`, lifecycle pill, and a **Change status** button
(HR/Admin only — `PATCH .../lifecycle`). Tabs:

1. **Profile** — Identity & personal fields (3.1). HR/Admin edit any field;
   an Employee viewing their own record gets a **visibly smaller** edit
   form (only `personalEmail`/`phone`/`gender`/`maritalStatus`/
   `bloodGroup`/`nationality`/`photoUrl` — no employment/comp fields in
   that dialog at all, not just disabled ones).
2. **Employment** — Employment fields + Shift, HR/Admin edit only
   (`PATCH /employees/:id`); shows probation/confirmation/notice/
   last-working dates as a small timeline, populated only once the matching
   transition has happened.
3. **Compensation & Statutory** — comp-adjacent + statutory fields.
   PAN/Aadhaar masked by default; PAN's "reveal" (HR/Admin/Auditor,
   `POST .../reveal`) is logged server-side. `aadhaarLast4` shows
   `XXXX-XXXX-1234`. Edits go through `PATCH .../sensitive-fields`, a
   separate call from the rest of the Employment tab.
4. **Bank** — bank fields via the same `PATCH .../sensitive-fields`
   endpoint; account number masked with the same reveal pattern as PAN. No
   penny-drop verification exists or is planned — don't build a placeholder
   for it.
5. **Emergency Contacts** — list of contact cards (`GET .../emergency-contacts`);
   **Add contact** (drawer, `POST`); per-card edit (`PATCH`) / delete
   (`DELETE`); primary badge — setting a new primary silently unsets the old
   one server-side, no separate confirmation needed for that side effect.
6. **Documents** — upload dropzone (drag + click; mime/size guard from 3.3,
   server re-enforces both) · category dropdown per row (inline
   `PATCH .../category`) · list: label, category, type icon, size, uploaded
   date/by · row actions: Download (5-min presigned URL) · **Delete**
   (confirm — this is a hard delete, no undo). Empty = "No documents
   uploaded".
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

### 5.4 Bulk Import  (`/employees/import`, live — see `apps/web/src/pages/employees/import.tsx`)
- Step 1: **Download template** — the columns `bulkImport()` actually reads
  today: required `employeeCode`, `firstName`, `lastName`; optional
  `personalEmail`, `phone`, `designation`. (Department-by-name and
  manager-by-code resolution **don't exist** — don't imply them in the
  template or column reference.)
- Step 2: choose a file → upload directly. A client-side preview step is a
  nice-to-have, not required — the per-row result table in step 3 already
  tells the operator what happened, so don't block the redesign on
  building one if time is short.
- Step 3: `POST /employees/bulk-import` → **result table**: Row · Status
  (`ok` green / `error` red) · Message. Summary: "X created, Y failed".
  **Download failed rows** to fix & re-upload only those.
- States: upload-in-progress, per-row error rows, empty (no file chosen yet).

### 5.5 Departments  (`/departments`) — live
- **Toolbar:** **New department** (HR/Admin) · search.
- **Table columns:** Name · Code · Head (employee link) · Employees (count)
  · Actions (`dropdown-menu`: Edit · Delete). **No "Parent department"
  column** — that field doesn't exist (3.1).
- **New / Edit → modal:** name, code, head (`select` of employees) —
  `POST`/`PATCH /departments[/:id]`. **Delete → modal** requires choosing a
  target department to reassign that dept's employees into
  (`DELETE /departments/:id {reassignToDepartmentId?}` — server blocks the
  delete with a count if employees exist and no target was chosen).
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
- **Add / Edit Emergency Contact** — form (3.1); `POST`/`PATCH
  /employees/:id/emergency-contacts[/:contactId]` — live.
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
triggers so a backend developer can map each control to an API call. **All
of the following are live** (`docs/modules/03_EMPLOYEE_MASTER.md` §4.5):

- `GET /api/employees` (row-scoped, Line Manager = recursive subtree) ·
  `GET /api/employees/:id` (ciphertext stripped, masked fields only) ·
  `GET /api/employees/org-chart` (rooted per role) ·
  `POST /api/employees` (HR/Admin) ·
  `PATCH /api/employees/:id` (any — self-only + whitelisted for Employee,
  full set for HR/Admin, 403 for Line Manager/Auditor) ·
  `PATCH /api/employees/:id/lifecycle` (HR/Admin) ·
  `PATCH /api/employees/:id/sensitive-fields` (HR/Admin) ·
  `POST /api/employees/:id/reveal` (HR/Admin/Auditor) ·
  `GET`/`POST`/`PATCH`/`DELETE /api/employees/:id/emergency-contacts[/:contactId]`
  (read: row-scoped; write: self or HR/Admin) ·
  `POST /api/employees/bulk-import` (HR/Admin) ·
  `GET /api/employees/:id/documents` (row-scoped) ·
  `POST /api/employees/:id/documents?label=&category=` (multipart; HR/Admin
  any employee, Employee own only) ·
  `GET /api/documents/:id/download-url` (row-scoped, 5-min presigned) ·
  `PATCH /api/documents/:id/category` · `DELETE /api/documents/:id`
  (both HR/Admin) ·
  `GET`/`POST`/`PATCH`/`DELETE /api/departments[/:id]` (write: HR/Admin).
- **Genuinely not built, don't wire:** org-chart PNG/PDF export;
  BU→Dept→Team hierarchy (no `parentDepartmentId` — not planned for V1);
  bulk-import "save as draft".

## 9. Deliverable & file layout

```
apps/web/src/pages/employees/
  list.tsx        # Directory: stat tiles, filters, bulk bar, table
  detail.tsx      # Header banner + 7 internal tabs      [done]
  create.tsx      # Sectioned Add Employee form
  import.tsx      # Bulk import (template / result)     [already live]
  components/     # employee-quick-view.tsx, section-edit-dialog.tsx,
                  # lifecycle-dialog.tsx, emergency-contact-form.tsx,
                  # document-list.tsx, masked-field.tsx  [not yet split
                  # out — detail.tsx/list.tsx keep every dialog inline
                  # today; extracting is a nice-to-have, not required]
apps/web/src/pages/departments.tsx   # edit/delete already live
apps/web/src/pages/org-chart.tsx   # tree, search, zoom, focus, export —
                                     # rooting-per-role is live; the
                                     # interactivity (search/zoom/focus) and
                                     # PNG/PDF export are the redesign's job
```

Constraints recap: React 19 + TS strict (no enums), Tailwind v4 tokens only,
hand-rolled `components/ui` primitives (no Radix), `api.*` for data + raw
`fetch` for uploads, role-gated screens, masked sensitive fields with logged
reveal, Aadhaar last-4 only, every state explicit, all overlays rendered
together. **This is a visual/UX redesign against a fully real backend** —
every endpoint annotated in §8 is live; nothing here should be built as a
stub or a fixture unless §8 explicitly says so.
