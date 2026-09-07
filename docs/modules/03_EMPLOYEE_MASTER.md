# 03 — Employee Master + Org Structure — Module Source of Truth

> **This file is the authoritative, detailed spec for further development of
> this module.** `docs/MODULE_SPECS.md` §3 is the one-page summary; the UI
> build prompt is `docs/ui-build-prompts/03-employee-master.md`.
>
> **Status:** 🟡 — core CRUD + documents + bulk-import API live; several
> field groups and the org hierarchy are partial.
> **Progress:** ~85% (see `docs/MODULE_SPECS.md` status table — keep in sync).
> **Code:** `apps/api/src/employees` (`EmployeesService`,
> `EmployeesController`, `DocumentsController`, `DepartmentsController`),
> `apps/api/src/storage`, `apps/web/src/pages/employees`,
> `apps/web/src/pages/{departments,org-chart}.tsx`.
> **Related:** `docs/MODULE_SPECS.md` §3, §9 · `docs/BACKEND_ARCHITECTURE.md`
> §4 (`scopeFor`), §5 (`employees/`), §6 (data model) ·
> module `01_IDENTITY_AND_ACCESS.md` (linked-login provisioning) ·
> module `09_DOCUMENTS.md` (storage — currently lives inside this module).
> **Last synced to code:** 2026-09-08.

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

**In scope (V1, partial):** full field set in the UI (some marked
`TODO(api)`), Department + single reporting line, org chart, bulk import
(API done, UI pending), documents (upload/list/download).

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
2. **Full field set present** (see §4.2). Fields not yet in the API render
   in the UI marked `TODO(api)` behind the final layout so the backend has a
   target.
3. **Lifecycle is a state machine.** Only allowed transitions are offered;
   each requires its mandatory date + a reason; illegal transitions are
   impossible from the UI and rejected by the API.
4. **Bulk import never fails the batch.** One bad row → that row reports
   `error` with a message; good rows import; the user re-uploads only the
   failures.
5. **Documents are safe by construction.** Stored under a tenant/entity-
   prefixed key; metadata in `public.documents`; handed back only as a
   ≤ 5-minute presigned URL; MIME allow-list (PDF/JPG/PNG) + 10 MB cap
   enforced at the controller.
6. **Sensitive fields are protected.** PAN + bank account are KMS
   field-encrypted (on top of at-rest); shown masked; "reveal" is
   permissioned (HR/Admin) **and logged**. Aadhaar: **last 4 digits only** —
   the full 12 is never accepted or stored.
7. **Org chart is correct and usable** — reflects `reportingManagerId`,
   supports expand/collapse, search-to-focus, and role-scoped rooting.
8. **Linked-login provisioning is transactional with the employee** — create
   employee + Firebase user + claims + `users` row in one flow (module 01
   §5.3); privilege ceiling enforced.

---

## 4. Technical design

### 4.1 Row scoping (`BACKEND_ARCHITECTURE.md` §4)

```ts
EmployeesService.scopeFor(user):
  EMPLOYEE     → { id: user.employeeId }
  LINE_MANAGER → { OR: [{ id: user.employeeId }, { reportingManagerId: user.employeeId }] }
  default      → {}   // HR_MANAGER / COMPANY_ADMIN / AUDITOR
```

> **Gap:** the `LINE_MANAGER` branch is a **direct-reports-only** filter
> today; "indirect reports" (the full subtree) is not yet walked. Decide
> whether V1 needs the recursive subtree here (§12).

### 4.2 Data model — `Employee`, by field group

Legend: ✅ in API · 🟡 partial · `TODO(api)` not yet modelled.

**Identity & personal** — `employeeCode` ✅ (unique per tenant) ·
`firstName` ✅ · `lastName` ✅ · `personalEmail` ✅ · `phone` ✅ ·
`dateOfBirth` ✅ · `gender` ✅ (`MALE|FEMALE|OTHER|UNDISCLOSED`) ·
`maritalStatus` `TODO(api)` · `bloodGroup` `TODO(api)` · `nationality`
`TODO(api)` · `photoUrl` `TODO(api)`.

**Employment** — `designation` ✅ · `departmentId` ✅ (→ `Department`) ·
`employmentType` `TODO(api)` (`FULL_TIME|PART_TIME|CONTRACT|INTERN|CONSULTANT`) ·
`dateOfJoining` ✅ · `workLocation` `TODO(api)` · `reportingManagerId` ✅
(→ `Employee`, self-referential) · `shiftId` 🟡 (→ `Shift`; `null` = tenant
default — see `TENANT_CONFIGURATION.md`) · `lifecycleState` 🟡 (see §4.4) ·
`probationEndDate` / `confirmationDate` / `noticeStartDate` /
`lastWorkingDate` — all `TODO(api)`.

**Compensation-adjacent** — `ctcAnnual` (Decimal) · `payGrade` ·
`costCenter` — all `TODO(api)`. Full salary **structure** lives in Payroll
(module 07), not here; this is only the headline number for reference/reports.

**Statutory (India)** — all `TODO(api)`: `pan` (KMS-encrypted; masked
`ABCDE****F`) · `aadhaarLast4` (**exactly 4 digits — never the full 12**) ·
`uan` (12 digits) · `pfNumber` · `esicNumber` (17 digits) · `taxRegime`
(`OLD|NEW`).

**Bank (disbursement)** — `TODO(api)` / not yet KMS-encrypted:
`accountHolderName` · `bankAccountNumber` (KMS-encrypted; masked `••••1234`) ·
`ifsc` (`^[A-Z]{4}0[A-Z0-9]{6}$`) · `bankName` · `branch` · `accountType`
(`SAVINGS|CURRENT`).

**Emergency contacts** (0..n) — `TODO(api)`: `name` · `relationship` ·
`phone` · `altPhone` · `address` · `isPrimary` (exactly one).

**Documents** (0..n) — ✅ upload/list/download; `category` `TODO(api)`.
Fields: `id` · `label` · `category`
(`OFFER_LETTER|ID_PROOF|ADDRESS_PROOF|EDUCATION|EXPERIENCE|OTHER`) ·
`mimeType` (`application/pdf|image/jpeg|image/png`) · `sizeBytes` (≤ 10 MB) ·
`uploadedAt` · `uploadedByName` `TODO(api)`.

**Derived (read-only)** — `reportingManager {firstName,lastName}` ·
`directReports [{id,firstName,lastName,designation}]`.

**Linked login (create-time, optional)** — `loginEmail` · `loginRole`
(`COMPANY_ADMIN|HR_MANAGER|LINE_MANAGER|EMPLOYEE|AUDITOR`) ·
`loginTempPassword` (or "send reset link"). Provisions a Firebase user +
claims + `public.users` row (module 01).

### 4.3 `Department`

`id` ✅ · `name` ✅ · `code` `TODO(api)` · `headEmployeeId` `TODO(api)` ·
`parentDepartmentId` `TODO(api)` (for BU→Dept→Team) · `employeeCount`
(derived).

### 4.4 Lifecycle state machine

Current API enum: `ACTIVE · ON_LEAVE · SUSPENDED · RESIGNED · TERMINATED`.
**Target set to render + map to:**

```
PRE_JOINING ──(on/after dateOfJoining)──▶ PROBATION
PROBATION ──(needs confirmationDate)──▶ CONFIRMED
PROBATION ──────────────────────────────▶ SEPARATED
CONFIRMED ──(needs noticeStartDate)────▶ NOTICE_PERIOD
CONFIRMED ─────────────────────────────▶ SUSPENDED  (side state)
PROBATION ─────────────────────────────▶ SUSPENDED  (side state)
NOTICE_PERIOD ──(needs lastWorkingDate; triggers FnF later)──▶ SEPARATED
NOTICE_PERIOD ──(withdrawal)───────────▶ CONFIRMED
SEPARATED ── terminal (record read-only except documents)
SUSPENDED ──▶ back to prior active state
```

Every transition → confirm modal capturing the required date + a reason;
writes an audit row (module 12); `SEPARATED` cascades to module 01 (disable
login) and later module 07 (FnF).

### 4.5 API surface (`BACKEND_ARCHITECTURE.md` §5)

| Method | Path | Roles | Notes |
|---|---|---|---|
| `GET` | `/api/employees` | any (row-scoped) | Directory list; filters: dept, lifecycle, employment type, search. |
| `GET` | `/api/employees/:id` | any (row-scoped) | Full record. |
| `GET` | `/api/employees/org-chart` | Admin / HR / Line Manager / Auditor | In-memory manager→reports tree (not a SQL CTE — fine at hundreds; revisit for large tenants). |
| `POST` | `/api/employees` | Company Admin, HR Manager | Create; optional linked login (privilege ceiling applies). |
| `PATCH` | `/api/employees/:id` | Company Admin, HR Manager | Update any field group; also the lifecycle-transition endpoint (target date + reason). |
| `POST` | `/api/employees/bulk-import` | Company Admin, HR Manager | Multipart `file` (`.xlsx`). Requires `employeeCode`/`firstName`/`lastName` columns. Returns `[{ row, status: 'ok'|'error', message }]`. Never fails the batch. |
| `GET` | `/api/employees/:id/documents` | any (tenant, row-scoped) | List metadata. |
| `POST` | `/api/employees/:id/documents?label=` | Company Admin, HR Manager (Employee: own, upload only) | Multipart. Enforce MIME allow-list + 10 MB **at the controller** (gap — confirm). |
| `GET` | `/api/documents/:id/download-url` | any (tenant) | 5-minute presigned URL. |
| `GET` / `POST` | `/api/departments` | list: any · create: Admin / HR | |
| `PATCH` / `DELETE` | `/api/departments/:id` | Admin / HR | `TODO(api)` — edit + delete-with-reassign. |

`TODO(api)` endpoints: emergency-contacts CRUD; document delete + category;
statutory/bank/comp field persistence + masked-reveal audit; lifecycle-date
fields; department hierarchy; org-chart export; bulk "save as draft".

### 4.6 Storage (see module 09)

`StorageService` (`@aws-sdk/client-s3`, MinIO in dev / S3 in prod, same code
path). Key: `tenants/<tid>/employees/<eid>/<uuid>-<filename>`. API never
lists a bucket or returns a raw key.

### 4.7 Configuration dependencies

- Default `Shift` + weekly-off from `TENANT_CONFIGURATION.md` (for
  `shiftId = null`).
- KMS data key for PAN / bank field encryption (`CLAUDE.md` security
  non-negotiables) — **must be wired before real employee data is loaded**.

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

### 5.2 Bulk import

1. HR downloads the `.xlsx` template (required: `employeeCode`, `firstName`,
   `lastName`; optional: department name, manager code, designation, DOJ,
   email).
2. Upload → client-side parse → preview (first 20 rows, count, detected
   columns, obvious problems flagged).
3. `POST /api/employees/bulk-import` → server parses with `exceljs`, inserts
   row-by-row → returns per-row `[{ row, status, message }]`.
4. Result table: "X created, Y failed"; **Download failed rows** as `.xlsx`
   to fix and re-upload only those.

### 5.3 Employee edits their own contact details

1. Employee → **My Profile** → Profile tab → **Edit** (only contact +
   emergency fields are editable).
2. `PATCH /api/employees/:id` with the whitelisted field subset (server
   rejects any field outside the Employee-editable set).

### 5.4 Lifecycle: confirm after probation

1. HR → employee detail → **Change status** → target `CONFIRMED` (only shown
   when current = `PROBATION`).
2. Modal captures `confirmationDate` + reason → `PATCH /api/employees/:id` →
   state updated → audit row (module 12).

### 5.5 Lifecycle: offboarding

1. `CONFIRMED → NOTICE_PERIOD` (capture `noticeStartDate` + reason).
2. `NOTICE_PERIOD → SEPARATED` (capture `lastWorkingDate` + reason) → cascade:
   disable linked login (module 01); flag for FnF (module 07, later); record
   read-only except documents.

### 5.6 Reveal a masked field (Auditor / HR)

1. Compensation & Statutory / Bank tab → field shows masked → **Reveal**.
2. Confirm modal ("this view is logged") → server decrypts via KMS, returns
   the value, writes an audit row `{ actor, field, employeeId, at }`.

### 5.7 Org chart focus

1. Any persona opens **Org Chart** — rooted per role (Employee: self;
   Line Manager: self + subtree; HR/Admin/Auditor: top).
2. Search a name → path auto-expands, pans to the node; click → quick-view
   drawer; double-click → re-root ("focus") with a breadcrumb back to top.

---

## 6. Business rules & invariants

- **INV-1** — `employeeCode` is unique per tenant; enforced by a
  `@@unique([tenantId, employeeCode])` and an async UI check.
- **INV-2** — Aadhaar: only `aadhaarLast4` exists anywhere — schema, API,
  logs, exports. Reject any input longer than 4 digits.
- **INV-3** — PAN + bank account are KMS field-encrypted at rest in the app
  layer; plaintext never leaves the service except through a logged reveal.
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
**Document:** `UPLOADED → (scanned → USABLE)` *(scan step TODO — module 09)*;
`DELETED` (soft) by HR/Admin.
**Linked login:** tracks module 01 `users.isActive`; `SEPARATED` employee ⇒
inactive login.

---

## 8. Permission matrix

| Capability | Employee | Line Manager | HR Manager | Company Admin | Auditor |
|---|:--:|:--:|:--:|:--:|:--:|
| Directory — list | own only | own + reports | all | all | all (read) |
| Employee detail — view | own | own + reports | all | all | all (read) |
| Edit personal / contact / emergency | own | — | all | all | — |
| Edit employment / comp / statutory / bank | — | — | ✅ | ✅ | — |
| Add employee / linked login | — | — | ✅ (role ≤ HR) | ✅ (any role) | — |
| Lifecycle transitions | — | — | ✅ | ✅ | — |
| Bulk import | — | — | ✅ | ✅ | — |
| Reveal masked PAN / Aadhaar / bank (logged) | — | — | ✅ | ✅ | ✅ (read, logged) |
| Documents — upload | own | — | ✅ | ✅ | — |
| Documents — delete | — | — | ✅ | ✅ | — |
| Documents — download | own | reports | ✅ | ✅ | ✅ |
| Departments — view / manage | — / — | view / — | view / ✅ | view / ✅ | view / — |
| Org chart | self-centred | team-centred | full | full | full (read) |

---

## 9. Known gaps / TODO (priority order)

1. **KMS field encryption** for PAN + bank account — wire **before** any real
   employee data is loaded (`CLAUDE.md`).
2. **Bulk-import frontend** — template download, client preview, result
   table, failed-row re-download (API already exists).
3. **Lifecycle**: persist `PRE_JOINING/PROBATION/CONFIRMED/NOTICE/SEPARATED`
   + the four date fields; implement the transition endpoint with
   validation; wire the `SEPARATED` cascade.
4. **Document controller hardening** — enforce MIME allow-list + 10 MB cap
   server-side; add document delete + `category`.
5. **Emergency contacts** — model + CRUD endpoints + UI wiring.
6. **Statutory / bank / comp field persistence** + the masked-reveal audit
   endpoint.
7. **Department** edit / delete-with-reassign; decide BU→Dept→Team hierarchy
   for V1 (§12).
8. **Org chart**: indirect-report subtree in `scopeFor`; search/expand
   polish; client-side PNG/PDF export.
9. **Line-Manager scoping** — align with module 01 §9.2 (recursive subtree).

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

- [ ] An Employee `GET /api/employees` returns exactly one row (self); a
      Line Manager returns self + reports; HR/Admin/Auditor return all.
- [ ] Cross-tenant: Tenant A user cannot fetch a Tenant B employee by id
      (404 via RLS).
- [ ] `POST /api/employees` with a duplicate `employeeCode` in the tenant is
      rejected.
- [ ] Bulk import of a file with 1 bad row in 10 → 9 `ok`, 1 `error`, no
      rollback of the 9.
- [ ] Uploading a `.exe` or an 11 MB PDF is rejected at the controller with a
      specific message.
- [ ] `GET /api/documents/:id/download-url` returns a URL that expires in
      ≤ 5 minutes and 404s cross-tenant.
- [ ] An Employee-actor `PATCH` that includes `ctcAnnual` or `designation`
      silently ignores those fields (or 403s) — only whitelisted fields apply.
- [ ] HR Manager creating a linked login cannot select `COMPANY_ADMIN`.
- [ ] Every lifecycle transition writes one audit row and rejects illegal
      target states.
- [ ] Aadhaar input of >4 digits is rejected everywhere.

---

## 12. Open questions / decisions needed

- **Org hierarchy depth** — is BU→Dept→Team (`parentDepartmentId`) a V1
  requirement, or is flat Department + reporting line enough for the two
  pilots?
- **Line-Manager visibility** — direct reports only, or the full recursive
  subtree? (Affects `scopeFor`, org chart, Leave, Dashboard.)
- **Auditor + sensitive fields** — can an Auditor reveal PAN/Aadhaar/bank
  (logged), or only ever see them masked?
- **`ctcAnnual` here vs Payroll** — keep a denormalized headline figure on
  `Employee` for reports before Payroll exists, or wait for Payroll to own
  it entirely?
- **Employee self-edit approval** — do contact-detail edits by an Employee
  need HR approval, or apply directly (current assumption: directly, audited)?
