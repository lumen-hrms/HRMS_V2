# 03 — Employee Master + Org Structure — Module Source of Truth

> **This file is the authoritative, detailed spec for further development of
> this module.** `docs/MODULE_SPECS.md` §3 is the one-page summary; the UI
> build prompt is `docs/ui-build-prompts/03-employee-master.md`.
>
> **Status:** 🟡 — the full field set (identity/personal, employment,
> compensation-adjacent, statutory with KMS encryption, bank, emergency
> contacts), the lifecycle state machine, bulk-import UI, document
> hardening, and department edit/delete-with-reassign are all live. Only
> the org chart's client-side polish (search/expand/zoom) and the
> deliberately-deferred BU→Dept→Team hierarchy remain.
> **Progress:** ~97% (see `docs/MODULE_SPECS.md` status table — keep in sync).
> **Code:** `apps/api/src/employees` (`EmployeesService`,
> `EmployeesController`, `DocumentsController`, `DepartmentsController`),
> `apps/api/src/storage`, `apps/api/src/crypto` (`FieldEncryptionService`),
> `apps/web/src/pages/employees`, `apps/web/src/pages/{departments,org-chart}.tsx`.
> **Related:** `docs/MODULE_SPECS.md` §3, §9 · `docs/BACKEND_ARCHITECTURE.md`
> §4 (`scopeFor`), §5 (`employees/`), §6 (data model) ·
> module `01_IDENTITY_AND_ACCESS.md` (linked-login provisioning; the
> `SEPARATED` cascade reuses `AccessService.setStatus()`'s Firebase-disable
> sequence) · module `09_DOCUMENTS.md` (storage — currently lives inside
> this module).
> **Last synced to code:** 2026-09-11 — migrations
> `20260911100000_employee_lifecycle_state` +
> `20260911120000_employee_full_field_set` (**neither yet applied to the
> shared Supabase dev DB** — the schema owner needs to run
> `./scripts/dev.sh migrate`).

---

## 1. Purpose & scope

The **system of record for people data**. Every other module (Leave,
Attendance, Payroll, Compliance, Dashboard, Org Chart) references an
`Employee` row. This module owns:

- the employee record — identity, employment, compensation-adjacent,
  statutory (India), bank, emergency contacts;
- the employment **lifecycle** (pre-joining → separated);
- **documents** attached to an employee (today the only Documents surface —
  see module 09);
- the **org structure** — departments and the reporting hierarchy — and an
  interactive **org chart**;
- **bulk onboarding** via an Excel template with per-row validation.

**In scope (V1):** full field set, in the UI and persisted — identity/personal,
employment, compensation-adjacent, statutory (KMS-encrypted PAN, bank),
emergency contacts; Department (with edit/delete-and-reassign) + single
reporting line; org chart (rooted per role; search/expand/zoom still
pending); bulk import (both API and UI); documents (upload/list/download/
delete/category, MIME+size enforced server-side).

**Out of scope / deferred:** no-code custom field builder (`FR-EMP-008`),
multiple reporting lines / dotted-line (`FR-ORG-003`), BU→Dept→Team multi-level
hierarchy (decision pending), org-chart PDF/PNG export (client-side later),
penny-drop bank verification, background-verification workflow.

---

## 2. User personas & their role in this module

| Persona | Why they touch this module | What they can do | What they cannot do |
|---|---|---|---|
| **Employee** | Their own record is here; it feeds their payslip, leave, attendance. | View **their own** full record; edit their own contact fields (personal email, phone, address, emergency contacts); upload their own documents; view themselves in the org chart (self-centred). | Cannot see any colleague's record; cannot edit employment / compensation / statutory / bank / lifecycle; cannot delete documents. |
| **Line Manager** | Needs visibility of their team for approvals and 1:1s. | View **own + direct/indirect reports'** records (read); see their subtree in the org chart and Departments (read). | Cannot edit anyone's record (not even reports'); cannot add employees; no bulk import; no lifecycle transitions. |
| **HR Manager** | Primary operator. Onboards, maintains, offboards people; manages departments and the hierarchy. | Full CRUD on all employees in the tenant; create an employee **with a linked login** (role ≤ HR_MANAGER); run bulk import; drive lifecycle transitions; upload/delete documents; reveal masked PAN/Aadhaar/bank (logged); create/edit/delete departments; edit reporting lines. | Cannot grant `COMPANY_ADMIN` on a linked login; cannot bypass the masked-reveal audit; cannot hard-delete an employee with history (separate, don't delete). |
| **Company Admin** | Same operational surface as HR Manager, plus the org-structure owner. | Everything HR Manager can do, **plus** grant `COMPANY_ADMIN` on a linked login. | Same data-integrity limits (no hard delete of employees with history). |
| **Auditor** (read-only) | Reviews people data + document trail for compliance. | View every employee record (including — decision pending in §12 — masked or revealed statutory/bank), Departments, Org Chart; download documents. | Every mutating control absent; no reveal that isn't itself read-only + logged; no export beyond what's granted. |
| **Platform Admin** | **Out of scope** — separate console, cannot read `public.employees` at all. | — | — |

### How each persona actually uses it

- **HR Manager** lives on the **Directory** (search, filter, bulk actions)
  and the **Employee Detail** tabbed page. Onboarding is either one-at-a-time
  (Add Employee form, Identity + Employment required, rest deferred) or
  **Bulk Import** (download `.xlsx` template → upload → per-row result table →
  re-upload only failed rows). Offboarding is a **lifecycle transition** to
  `NOTICE_PERIOD` then `SEPARATED`, each captured with the required date +
  reason; `SEPARATED` cascades to disable the linked login (module 01).
- **Employee** sees a single "My Profile" view — their record with only
  contact/emergency fields editable, plus a document upload area.
- **Line Manager** uses the **Reporting** tab and the **Org Chart** (centred
  on their team) — read-only — plus the directory filtered to their reports.
- **Auditor** opens the same screens with every button stripped; the
  masked-field "reveal" is available but each reveal is logged.

---

## 3. Functional expectations (definition of done)

1. **One record, role-scoped reads.** An Employee sees only themselves; a
   Line Manager sees self + reports; HR/Admin/Auditor see all — enforced by
   `EmployeesService.scopeFor(user)` on top of RLS.
2. **Full field set present — built** (see §4.2). Every field group is
   persisted and editable through the API; the UI's Personal & Employment
   and Compensation/Statutory/Bank edit dialogs cover all of it.
3. **Lifecycle is a state machine — built.** Only allowed transitions are
   offered; each requires its mandatory date + a reason; illegal transitions
   are rejected server-side (`PATCH /employees/:id/lifecycle`) and the UI's
   Change Status dialog only ever offers the current state's valid targets.
4. **Bulk import never fails the batch.** One bad row → that row reports
   `error` with a message; good rows import; the user re-uploads only the
   failures.
5. **Documents are safe by construction — built.** Stored under a
   tenant/entity-prefixed key; metadata in `public.documents`; handed back
   only as a ≤ 5-minute presigned URL; MIME allow-list (PDF/JPG/PNG) +
   10 MB cap enforced server-side (`EmployeesService.uploadDocument`);
   category + hard delete (S3 object + row) supported.
6. **Sensitive fields are protected — built.** PAN + bank account are
   AES-256-GCM field-encrypted (`FieldEncryptionService`) before storage;
   only ciphertext + a precomputed masked form are persisted; a read never
   touches the encryption key. "Reveal" is permissioned (HR/Admin/Auditor)
   **and logged** (`employee.field_revealed` audit row, value never
   included in the metadata). Aadhaar: **last 4 digits only** — the full 12
   is never accepted or stored.
7. **Org chart is correctly rooted per role — built; polish pending.**
   Reflects `reportingManagerId`; Employee/Line Manager get a subtree
   rooted at themselves, HR/Admin/Auditor get the whole tree
   (`EmployeesService.orgChart`). Expand/collapse, search-to-focus, and
   PNG/PDF export are **not built** — the frontend renders a plain nested
   list (`apps/web/src/pages/org-chart.tsx`); PNG/PDF export is explicitly
   deferred (§1).
8. **Linked-login provisioning is transactional with the employee** — create
   employee + Firebase user + claims + `users` row in one flow (module 01
   §5.3); privilege ceiling enforced.

---

## 4. Technical design

### 4.1 Row scoping (`BACKEND_ARCHITECTURE.md` §4)

```ts
EmployeesService.scopeFor(user):
  EMPLOYEE     → { id: user.employeeId }
  LINE_MANAGER → { id: { in: [user.employeeId, ...subordinateIds(user.employeeId)] } }
  default      → {}   // HR_MANAGER / COMPANY_ADMIN / AUDITOR
```

**Resolved (§12 was open, now decided):** Line Manager visibility is the
**full recursive subtree**, not direct-reports-only. `subordinateIds()` does
an in-memory BFS over `{id, reportingManagerId}` pairs (same "fine at
hundreds, revisit for large tenants" tradeoff `orgChart()` already accepts)
rather than a raw recursive CTE — a raw query would bypass the RLS session
variable this request's transaction sets (`with-tenant-context.ts` only
wraps model-level operations, not `$queryRaw`). Cycle-safe by construction
(a visited-set guard, tested). **This decision has not yet been mirrored in
modules 04 (Leave) or 05 (Attendance)**, which still scope Line Manager to
direct reports only — their own open questions still name this as pending;
align them in a follow-up pass rather than silently diverging.

### 4.2 Data model — `Employee`, by field group

Legend: ✅ in API · 🟡 partial · `TODO(api)` not yet modelled.

**Identity & personal** — `employeeCode` ✅ (unique per tenant) ·
`firstName` ✅ · `lastName` ✅ · `personalEmail` ✅ · `phone` ✅ ·
`dateOfBirth` ✅ · `gender` ✅ (settable via `PATCH /employees/:id`, free
text — no schema enum, per the `genderRestriction`-fails-open note in
module 04) · `maritalStatus` ✅ · `bloodGroup` ✅ · `nationality` ✅ ·
`photoUrl` ✅ (a settable URL string — **not** an image upload widget; no
upload flow behind it yet).

**Employment** — `designation` ✅ · `departmentId` ✅ (→ `Department`) ·
`employmentType` ✅ (`FULL_TIME|PART_TIME|CONTRACT|INTERN|CONSULTANT`) ·
`dateOfJoining` ✅ · `workLocation` ✅ · `reportingManagerId` ✅
(→ `Employee`, self-referential) · `shiftId` 🟡 (→ `Shift`; `null` = tenant
default — see `TENANT_CONFIGURATION.md`) · `lifecycleState` ✅ (see §4.4) ·
`probationEndDate` / `confirmationDate` / `noticeStartDate` /
`lastWorkingDate` ✅ (written only by the matching transition, per §4.4).

**Compensation-adjacent** — `ctcAnnual` ✅ (`NUMERIC(14,2)`, per
`CLAUDE.md`'s money non-negotiable) · `payGrade` ✅ · `costCenter` ✅. Full
salary **structure** still lives in Payroll (module 07, not built); this
stays only the headline number for reference/reports.

**Statutory (India)** — ✅ all persisted: `pan` (**KMS-encrypted** —
`panCiphertext` + a precomputed `panMasked` (`ABCDE****F`); plaintext never
stored) · `aadhaarLast4` (**exactly 4 digits — never the full 12**,
enforced by DTO validation) · `uan` · `pfNumber` · `esicNumber` ·
`taxRegime` (`OLD|NEW`). Written via the dedicated
`PATCH /employees/:id/sensitive-fields` endpoint, never the general
`PATCH /employees/:id`.

**Bank (disbursement)** — ✅ `bankAccountHolderName` ·
`bankAccountNumber` (**KMS-encrypted** — `bankAccountCiphertext` +
`bankAccountMasked` (`••••1234`); same dedicated endpoint as statutory) ·
`bankIfsc` (`^[A-Z]{4}0[A-Z0-9]{6}$`) · `bankName` · `bankBranch` ·
`bankAccountType` (`SAVINGS|CURRENT`).

**Emergency contacts** (0..n) — ✅ full CRUD: `name` · `relationship` ·
`phone` · `altPhone` · `address` · `isPrimary` (exactly one — enforced by
unsetting the prior primary in the same transaction as the new one, RULE-5;
no DB constraint, same "app-level, not DB-enforced" precedent as
`LeaveType.isCompOff`).

**Documents** (0..n) — ✅ upload/list/download/delete. Fields: `id` ·
`label` · `category` ✅ (`OFFER_LETTER|ID_PROOF|ADDRESS_PROOF|EDUCATION|
EXPERIENCE|OTHER`, settable via `PATCH /documents/:id/category`) ·
`mimeType` (`application/pdf|image/jpeg|image/png` — enforced server-side)
· `sizeBytes` (≤ 10 MB, enforced server-side) · `uploadedAt` ·
`uploadedByName` ✅ (captured from the uploading actor at write time).

**Derived (read-only)** — `reportingManager {firstName,lastName}` ·
`directReports [{id,firstName,lastName,designation}]`.

**Linked login (create-time, optional)** — `loginEmail` · `loginRole`
(`COMPANY_ADMIN|HR_MANAGER|LINE_MANAGER|EMPLOYEE|AUDITOR`) ·
`loginTempPassword` (or "send reset link"). Provisions a Firebase user +
claims + `public.users` row (module 01).

### 4.3 `Department`

`id` ✅ · `name` ✅ · `code` ✅ · `headEmployeeId` ✅ (plain reference, no
FK — deleting the head employee never cascades into the department row) ·
`parentDepartmentId` — **deliberately deferred** (§12 resolved: flat
Department + reporting line is enough for the two V1 pilots; BU→Dept→Team
revisits when a customer needs it) · `employeeCount` (derived).
`PATCH`/`DELETE /departments/:id` are both live — delete enforces RULE-6
(reassign-or-block).

### 4.4 Lifecycle state machine — built

`Employee.lifecycleState` (`EmployeeLifecycleState`), replacing the old
`ACTIVE|ON_LEAVE|SUSPENDED|RESIGNED|TERMINATED` `employmentStatus` enum
(migration `20260911100000_employee_lifecycle_state` backfilled existing
rows: `ACTIVE`/`ON_LEAVE` → `CONFIRMED`, `SUSPENDED` → `SUSPENDED`,
`RESIGNED`/`TERMINATED` → `SEPARATED`). New employees default to
`PROBATION` (the common case — HR is adding someone who already joined);
pick `PRE_JOINING` explicitly for a not-yet-started hire.

```
PRE_JOINING ─────────────────────────────▶ PROBATION
PROBATION ──(needs confirmationDate)────▶ CONFIRMED
PROBATION ──(needs lastWorkingDate)─────▶ SEPARATED
PROBATION ───────────────────────────────▶ SUSPENDED  (side state)
CONFIRMED ──(needs noticeStartDate)─────▶ NOTICE_PERIOD
CONFIRMED ────────────────────────────────▶ SUSPENDED  (side state)
NOTICE_PERIOD ──(needs lastWorkingDate; triggers FnF later)──▶ SEPARATED
NOTICE_PERIOD ──(withdrawal)────────────▶ CONFIRMED
SUSPENDED ────────────────────────────────▶ PROBATION | CONFIRMED  (caller picks)
SEPARATED ── terminal (record read-only except documents)
```

`PATCH /employees/:id/lifecycle` (`EmployeesService.transitionLifecycle()`)
validates the caller's `{targetState, effectiveDate?, reason}` against this
graph (`LIFECYCLE_TRANSITIONS`, keyed by current state, each edge naming the
date field it requires — `undefined` for a date-free move like the
`NOTICE_PERIOD → CONFIRMED` withdrawal); an edge outside the graph 400s. On
success it writes the one date field the edge requires, and — for a
`SEPARATED` target — first runs the Firebase-disable cascade (§4.5) *before*
touching the DB, so a failed identity-provider call never leaves an employee
`SEPARATED` with a still-active login. Every transition writes one
`public.audit_log` row (`action: 'employee.lifecycle_changed'`,
`metadata.module = 'employee-master'`, before/after/reason) — a generic
write, not yet routed through module 12's still-unbuilt interceptor.
Frontend: the detail page's **Change status** button opens a dialog whose
target-state `Select` and conditional date field are driven by the same
transition graph (`apps/web/src/pages/employees/detail.tsx`).

### 4.5 API surface (`BACKEND_ARCHITECTURE.md` §5)

| Method | Path | Roles | Notes |
|---|---|---|---|
| `GET` | `/api/employees` | any (row-scoped) | Directory list. |
| `GET` | `/api/employees/:id` | any (row-scoped) | Full record, ciphertext stripped (`sanitize()`), masked fields only. |
| `GET` | `/api/employees/org-chart` | Admin / HR / Line Manager / Auditor / Employee | In-memory manager→reports tree, rooted per role (§4.1). Not a SQL CTE — fine at hundreds; revisit for large tenants. |
| `POST` | `/api/employees` | Company Admin, HR Manager | Create; optional linked login (privilege ceiling applies). |
| `PATCH` | `/api/employees/:id` | Company Admin, HR Manager | Update personal/contact/employment/compensation-adjacent/reporting — **not** lifecycle or statutory/bank (their own endpoints, RULE-4/INV-3). |
| `PATCH` | `/api/employees/:id/lifecycle` | Company Admin, HR Manager | `{targetState, effectiveDate?, reason}` — validated against the §4.4 graph; cascades to disable the linked login on `SEPARATED`. |
| `PATCH` | `/api/employees/:id/sensitive-fields` | Company Admin, HR Manager | `{pan?, aadhaarLast4?, uan?, pfNumber?, esicNumber?, taxRegime?, bankAccountHolderName?, bankAccountNumber?, bankIfsc?, bankName?, bankBranch?, bankAccountType?}` — encrypts `pan`/`bankAccountNumber`, computes the masked forms, audits which fields changed (never the values). |
| `POST` | `/api/employees/:id/reveal` | Company Admin, HR Manager, Auditor | `{field: 'pan'\|'bankAccountNumber', reason}` — decrypts and returns the value; writes an `employee.field_revealed` audit row (reason logged, value never logged). |
| `GET`/`POST`/`PATCH`/`DELETE` | `/api/employees/:id/emergency-contacts[/:contactId]` | read: row-scoped · write: any authenticated (own record) or Admin/HR | RULE-5 primary-swap on create/update. |
| `POST` | `/api/employees/bulk-import` | Company Admin, HR Manager | Multipart `file` (`.xlsx`). Requires `employeeCode`/`firstName`/`lastName` columns. Returns `[{ row, status: 'ok'|'error', message }]`. Never fails the batch. Frontend: `apps/web/src/pages/employees/import.tsx` (template download, upload, per-row result table, failed-row re-download). |
| `GET` | `/api/employees/:id/documents` | row-scoped | List metadata. |
| `POST` | `/api/employees/:id/documents?label=&category=` | Admin/HR (any employee) or Employee (own record only); Line Manager/Auditor cannot upload | MIME allow-list (PDF/JPG/PNG) + 10 MB cap enforced in the service, not just the controller. |
| `GET` | `/api/documents/:id/download-url` | row-scoped (via the document's owning employee) | 5-minute presigned URL. |
| `PATCH` | `/api/documents/:id/category` | Company Admin, HR Manager | |
| `DELETE` | `/api/documents/:id` | Company Admin, HR Manager | Deletes the S3 object then the row. |
| `GET` / `POST` | `/api/departments` | list: any · create: Admin / HR | |
| `PATCH` / `DELETE` | `/api/departments/:id` | Admin / HR | `DELETE` body `{reassignToDepartmentId?}` — RULE-6. |

**Still `TODO(api)`:** org-chart PNG/PDF export (deferred, §1); bulk import
"save as draft"; a generic audit interceptor (module 12) — the sensitive-field
and lifecycle audit writes here are hand-wired, same as every other module's
audit trail today.

### 4.6 Storage (see module 09)

`StorageService` (`@aws-sdk/client-s3`, MinIO in dev / S3 in prod, same code
path). Key: `tenants/<tid>/employees/<eid>/<uuid>-<filename>`. API never
lists a bucket or returns a raw key.

### 4.7 Configuration dependencies

- Default `Shift` + weekly-off from `TENANT_CONFIGURATION.md` (for
  `shiftId = null`).
- **Field encryption key — built, interim.** `FieldEncryptionService`
  (`apps/api/src/crypto`) does AES-256-GCM with a data key from
  `FIELD_ENCRYPTION_KEY` (base64, 32 bytes; `openssl rand -base64 32`).
  Resolved lazily (not at boot), so a tenant with the var unset can still
  run the API — only a PAN/bank write or reveal fails, with a clear message.
  This is the "KMS data key" half of the envelope today; the key itself is
  a static secret in the team vault, not yet wrapped by a real AWS KMS
  master key — that lands with the production AWS migration
  (`CLAUDE.md`'s Stack table). Swapping the key source later only touches
  this one file, since callers only ever see `encrypt`/`decrypt`.

---

## 5. Core flows

### 5.1 HR adds one employee (happy path)

1. HR Manager → **Employees** → **Add employee**.
2. Fills Identity + Employment (only these required), picks department +
   reporting manager, optionally a linked login + role.
3. `POST /api/employees` → `Employee` row created (RLS stamps `tenant_id`);
   if a login was requested → Firebase user + claims + `public.users` row
   (module 01 §5.3).
4. Redirect to the new detail page → **Documents** tab → upload the signed
   offer letter → stored + metadata row.
5. Later the employee logs in and sees **only** their own record; their Line
   Manager sees them in the team list and org chart.

### 5.2 Bulk import — built (`apps/web/src/pages/employees/import.tsx`)

1. HR → **Employees → Bulk import** → downloads the `.csv` template
   (required: `employeeCode`, `firstName`, `lastName`; optional:
   `personalEmail`, `phone`, `designation` — matching what
   `bulkImport()` actually reads today; department/manager resolution by
   name isn't implemented, only by the columns the API accepts).
2. Chooses a file → uploads directly (no client-side preview step —
   simpler than the original target spec, and the per-row result table
   from step 3 covers the same need).
3. `POST /api/employees/bulk-import` → server parses with `exceljs`, inserts
   row-by-row → returns per-row `[{ row, status, message }]`.
4. Result table: "X created, Y failed"; **Download failed rows** as `.xlsx`
   to fix and re-upload only those.

### 5.3 Employee edits their own contact details — built

1. Employee opens their own detail page → **Contact & Personal** card →
   edit (pencil icon, shown only when `user.employeeId === employee.id`) →
   **Edit my contact details** dialog (a trimmed view of
   `ProfileFieldsDialog` — no employment/compensation fields rendered).
2. `PATCH /api/employees/:id` — `EmployeesService.update()` 403s if the
   actor isn't Admin/HR and isn't editing their own record, and for a
   self-edit **silently drops** any field outside the whitelist
   (`personalEmail`, `phone`, `gender`, `maritalStatus`, `bloodGroup`,
   `nationality`, `photoUrl`) rather than 403ing on the whole request —
   RULE-1. Line Manager and Auditor get a 403 on this endpoint outright;
   they have no edit rights on any employee record (module 03 §8).

### 5.4 Lifecycle: confirm after probation

1. HR → employee detail → **Change status** → target `CONFIRMED` (only shown
   when current = `PROBATION`).
2. Dialog captures `confirmationDate` + reason →
   `PATCH /api/employees/:id/lifecycle` → state updated → `audit_log` row
   written.

### 5.5 Lifecycle: offboarding

1. `CONFIRMED → NOTICE_PERIOD` (capture `noticeStartDate` + reason).
2. `NOTICE_PERIOD → SEPARATED` (capture `lastWorkingDate` + reason) → cascade:
   disable linked login (module 01's Firebase-disable sequence, run
   **before** the DB write so a failed cascade can't leave the employee
   `SEPARATED` with an active login); flag for FnF (module 07, later); record
   read-only except documents.

### 5.6 Reveal a masked field (Auditor / HR / Admin) — built

1. **Compensation, Statutory & Bank** card → a masked PAN/bank-account row
   shows an eye icon (`MaskedRow`, HR/Admin/Auditor only) → click prompts
   for a reason (`window.prompt` today — a proper confirm modal with a
   reason field is a frontend polish item, not a backend gap).
2. `POST /api/employees/:id/reveal` `{field, reason}` → server decrypts via
   `FieldEncryptionService`, returns the value (shown inline, replacing the
   masked form for the rest of the session), and writes an
   `employee.field_revealed` audit row — actor, field, employeeId, reason,
   timestamp; **the decrypted value is never written to the audit row**.

### 5.7 Org chart — rooted per role (built); focus/search not built

1. Any persona opens **Org Chart** — `GET /employees/org-chart` roots the
   tree per role: Employee/Line Manager get their own subtree, HR/Admin/
   Auditor get the whole company from the top.
2. *(Not built)* Search-to-focus, expand/collapse controls, zoom, and a
   click-to-drawer quick view — `apps/web/src/pages/org-chart.tsx` today
   renders a plain nested list with no interactivity beyond what the tree
   structure itself shows. PNG/PDF export is explicitly deferred (§1), but
   this interactivity gap is a genuine remaining item (§9).

---

## 6. Business rules & invariants

- **INV-1** — `employeeCode` is unique per tenant; enforced by a
  `@@unique([tenantId, employeeCode])` and an async UI check.
- **INV-2** — Aadhaar: only `aadhaarLast4` exists anywhere — schema, API,
  logs, exports. Reject any input longer than 4 digits.
- **INV-3** — PAN + bank account are field-encrypted (AES-256-GCM,
  `FieldEncryptionService`) at rest in the app layer; plaintext never leaves
  the service except through the logged `POST /:id/reveal` call.
- **INV-4** — an employee with downstream history (leave, attendance,
  payroll, documents) is **separated, never deleted**.
- **INV-5** — documents are only ever returned as a ≤ 5-minute presigned URL.
- **RULE-1** — Employee-editable fields are a fixed whitelist (contact +
  emergency); the API ignores anything else on an Employee-actor `PATCH`.
- **RULE-2** — linked-login role ≤ actor's role; only Company Admin may set
  `COMPANY_ADMIN`.
- **RULE-3** — bulk import is row-transactional, never batch-transactional.
- **RULE-4** — lifecycle transitions are restricted to the state machine in
  §4.4; each needs its mandatory date + reason.
- **RULE-5** — exactly one `isPrimary` emergency contact.
- **RULE-6** — deleting a department requires reassigning its employees
  (block if employees exist and no target chosen).

---

## 7. States

**Employee lifecycle:** §4.4 state machine.
**Document:** `UPLOADED → (scanned → USABLE)` *(scan step TODO — module 09,
a virus/malware scan before a document is "usable"; deferred, not blocking
V1)*; delete is a **hard delete** today (S3 object + row both removed) —
the originally-targeted soft-delete/audit-trail-preserving delete isn't
built, since module 09's scan pipeline (which a soft-delete would gate on)
doesn't exist either.
**Linked login:** tracks module 01 `users.isActive`; `SEPARATED` employee ⇒
inactive login.

---

## 8. Permission matrix

All rows below are live and enforced server-side (`EmployeesService`),
`own + reports` for Line Manager meaning the full recursive subtree (§4.1),
not direct reports only.

| Capability | Employee | Line Manager | HR Manager | Company Admin | Auditor |
|---|:--:|:--:|:--:|:--:|:--:|
| Directory — list | own only | own + reports (recursive) | all | all | all (read) |
| Employee detail — view | own | own + reports (recursive) | all | all | all (read) |
| Edit personal / contact / emergency | own | — | all | all | — |
| Edit employment / comp / statutory / bank | — | — | ✅ | ✅ | — |
| Add employee / linked login | — | — | ✅ (role ≤ HR) | ✅ (any role) | — |
| Lifecycle transitions | — | — | ✅ | ✅ | — |
| Bulk import | — | — | ✅ | ✅ | — |
| Reveal masked PAN / Aadhaar / bank (logged) | — | — | ✅ | ✅ | ✅ (read, logged) |
| Documents — upload | own | — | ✅ | ✅ | — |
| Documents — delete / set category | — | — | ✅ | ✅ | — |
| Documents — download | own | reports (recursive) | ✅ | ✅ | ✅ |
| Emergency contacts — CRUD | own | — | all | all | — |
| Departments — view / manage | — / — | view / — | view / ✅ | view / ✅ | view / — |
| Org chart | self-centred | team-centred (recursive) | full | full | full (read) |

---

## 9. Known gaps / TODO

What's left, in priority order:

1. **Org chart interactivity** — search-to-focus, expand/collapse, zoom, a
   click-to-drawer quick view. The tree is correctly rooted per role
   (§5.7) but `apps/web/src/pages/org-chart.tsx` renders it as a plain
   nested list with none of that. PNG/PDF export stays explicitly deferred
   (§1) and is not counted against this.
2. **Photo upload** — `photoUrl` is a settable URL string (edit dialog),
   not an actual image-upload widget wired to Storage (module 09). Low
   priority; no persona flow depends on it yet.
3. **Reveal UX polish** — the reveal reason is collected via
   `window.prompt` (`MaskedRow` in `detail.tsx`), not the target confirm
   modal with a "this is logged" notice. Functionally complete (the audit
   row is written correctly either way); this is a frontend-polish item.
4. **Generic audit interceptor** (module 12) — lifecycle transitions,
   sensitive-field updates, and reveals each hand-write their own
   `audit_log` row today, same pattern every other module uses; nothing
   here is blocked on the interceptor landing.
5. **Line-Manager recursive-subtree decision not yet mirrored** in modules
   04 (Leave) and 05 (Attendance) — see §4.1's resolution note and their
   own open-questions sections.

**Deliberately deferred, not gaps** (§1): no-code custom field builder,
multiple/dotted reporting lines, BU→Dept→Team hierarchy (`code` +
`headEmployeeId` are on `Department` now; `parentDepartmentId` stays out),
org-chart PNG/PDF export, penny-drop bank verification, background-
verification workflow, a document virus/malware scan (module 09) — soft
document delete was originally meant to gate on that scan pipeline, so it
stays a hard delete until module 09's scan step exists.

**Closed this pass** (2026-09-11, migrations
`20260911100000_employee_lifecycle_state` +
`20260911120000_employee_full_field_set` — **applied to the shared
Supabase dev DB** via `./scripts/dev.sh migrate`):

- Lifecycle state machine (§4.4) — states, dates, transition endpoint,
  `SEPARATED` → disable-login cascade, audited, UI wired end-to-end.
- Full field set persisted: identity/personal extras, employment extras,
  compensation-adjacent, statutory + bank via `FieldEncryptionService`
  (AES-256-GCM), with a dedicated masked-reveal endpoint.
- Emergency contacts — model + full CRUD + UI, RULE-5 primary-swap.
- Document hardening — MIME allow-list + 10 MB cap enforced server-side
  (not just documented), plus `category` and delete.
- Bulk-import frontend (`apps/web/src/pages/employees/import.tsx`).
- Department edit + delete-with-reassign (RULE-6).
- Org chart correctly rooted per role (recursive subtree resolved as the
  §12 decision, in-memory BFS, cycle-safe).
- Employee self-edit (§5.3) — was documented as a target but never
  actually wired (the endpoint was Admin/HR-only); now enforces RULE-1's
  field whitelist server-side and has a UI entry point.
- IDOR fixes on `listDocuments`/`getDocumentDownloadUrl` — neither checked
  the caller's scope against the document's owning employee before this
  pass.
- **Visual redesign, UI-only** (`docs/ui-build-prompts/03-employee-master.md`
  §5.1/§5.2) — `detail.tsx` now renders the target header-banner + 7
  internal-tabs layout (Profile / Employment / Compensation & Statutory /
  Bank / Emergency Contacts / Documents / Reporting) instead of stacked
  cards; `list.tsx` gained the target stat-tile row (Headcount / Confirmed
  / In Probation / Notice-Separated) plus search + department/lifecycle
  filters. No API changes — same endpoints, different layout. Org chart
  (`org-chart.tsx`) was **not** part of this pass; its interactivity gap
  (item 1 above) is unchanged.

---

## 10. Dependencies

**Upstream:** module 01 (linked-login provisioning, `scopeFor` uses
`req.user`) · `TENANT_CONFIGURATION.md` (default shift) · KMS · Storage
(module 09).

**Downstream (consumers of `Employee`):**
- Module 04 Leave — `employeeId`, `reportingManagerId` (approval routing).
- Module 05 Attendance — `employeeId`, `shiftId`.
- Module 07 Payroll — salary structure attaches to `employeeId`; needs
  `dateOfBirth` (payslip password), bank fields, statutory IDs, lifecycle
  (FnF on `SEPARATED`).
- Module 08 Compliance — UAN / ESIC / PAN per employee.
- Module 06 Dashboard, Org Chart — headcount, dept breakdown, tree.
- Module 11 Reports — headcount / joiners / leavers / attrition registers.
- Module 12 Audit — every create/update/lifecycle change.

---

## 11. Acceptance criteria / test checklist

- [x] A Line Manager's `list()`/`get()` scope includes indirect reports, not
      just direct ones, and never infinite-loops on a corrupt cyclic
      `reportingManagerId` chain — covered by `employees.service.spec.ts`.
- [ ] An Employee `GET /api/employees` returns exactly one row (self);
      HR/Admin/Auditor return all — **not yet covered by an automated test**
      (only the Line Manager case above is).
- [ ] Cross-tenant: Tenant A user cannot fetch a Tenant B employee by id
      (404 via RLS).
- [ ] `POST /api/employees` with a duplicate `employeeCode` in the tenant is
      rejected.
- [ ] Bulk import of a file with 1 bad row in 10 → 9 `ok`, 1 `error`, no
      rollback of the 9.
- [x] Uploading a disallowed MIME type or a file over the 10 MB cap is
      rejected server-side — covered by `employees.service.spec.ts`.
- [x] An Employee can upload only to their own record; a Line Manager cannot
      upload to anyone's — covered by `employees.service.spec.ts`.
- [ ] `GET /api/documents/:id/download-url` and `GET
      /employees/:id/documents` 404 for a caller outside the owning
      employee's scope (the IDOR fix in this pass) — **not yet covered by
      an automated test**, only manually reasoned through.
- [x] An Employee-actor `PATCH` that includes `ctcAnnual` or `designation`
      is silently dropped (not applied, not a 403 on the whole request);
      whitelisted fields (`personalEmail`, `phone`, `gender`,
      `maritalStatus`, `bloodGroup`, `nationality`, `photoUrl`) still apply
      — covered by `employees.service.spec.ts`.
- [x] A Line Manager or Auditor calling `PATCH /employees/:id` at all gets a
      403, and an Employee editing anyone but themselves gets a 403 —
      covered by `employees.service.spec.ts`.
- [ ] HR Manager creating a linked login cannot select `COMPANY_ADMIN`.
- [x] Every lifecycle transition writes one audit row and rejects illegal
      target states — covered by `employees.service.spec.ts`.
- [x] A transition requiring a date (`CONFIRMED`/`NOTICE_PERIOD`/`SEPARATED`)
      400s without one; a date-free edge (e.g. `NOTICE_PERIOD → CONFIRMED`
      withdrawal) succeeds without one.
- [x] A `SEPARATED` transition whose Firebase disable call fails leaves the
      employee's `lifecycleState` unchanged (no partial state).
- [x] `updateSensitiveFields` stores only ciphertext + a masked form for
      PAN/bank account, never plaintext, and the audit row never contains
      the value — covered by `employees.service.spec.ts`.
- [x] `revealField` 400s for a field that was never set, and its audit row
      never contains the decrypted value — covered by
      `employees.service.spec.ts`.
- [x] Creating a second `isPrimary` emergency contact unsets the previous
      one — covered by `employees.service.spec.ts`.
- [x] Deleting a non-empty department without `reassignToDepartmentId` is
      blocked; with one, employees are reassigned before the department is
      deleted — covered by `employees.service.spec.ts`.
- [ ] Aadhaar input of >4 digits is rejected everywhere.
- [ ] `FieldEncryptionService.encrypt`/`decrypt` round-trips correctly and
      rejects a tampered ciphertext — **covered**, but in
      `field-encryption.service.spec.ts`, not this module's own suite;
      listed here for completeness.

---

## 12. Open questions / decisions needed

- **Org hierarchy depth — resolved.** Flat Department + single reporting
  line is enough for the two V1 pilots; BU→Dept→Team
  (`parentDepartmentId`) stays deferred until a customer actually needs it
  (§1, §9).
- **Line-Manager visibility — resolved for this module.** Full recursive
  subtree, not direct-reports-only (§4.1). **Still open for modules 04
  (Leave) and 05 (Attendance)** — they haven't been updated to match, so
  don't assume consistency across modules until that follow-up lands.
- **Auditor + sensitive fields — resolved.** An Auditor *can* reveal
  PAN/bank (logged) — `POST /:id/reveal` allows `AUDITOR`, matching the
  permission-matrix "read, logged" row (§8). Aadhaar has no reveal concept;
  only the last 4 digits ever exist anywhere.
- **`ctcAnnual` here vs Payroll — resolved for now.** Kept as a
  denormalized headline figure on `Employee` for reports/dashboards ahead
  of Payroll (module 07) existing; revisit whether Payroll should own it
  exclusively once that module is built.
- **Employee self-edit approval — resolved.** Applies directly, audited via
  the same lifecycle/sensitive-field audit pattern — no approval step. (The
  self-edit path itself wasn't wired at all before this pass; see §9.)
- **New open question — reveal UX.** Is `window.prompt` for the reveal
  reason acceptable long-term, or does this need the target confirm-modal
  treatment before real customer data is loaded? Functionally equivalent
  either way (§9 item 3).
