# 07 — Payroll Engine — Module Source of Truth

> **This file is the authoritative, detailed spec for further development of
> this module.** `docs/MODULE_SPECS.md` §7 is the one-page summary; the UI
> build prompt is `docs/ui-build-prompts/07-payroll-engine.md`.
>
> **Status:** 🟡 in progress — **Phases 1–8 backend built**: salary
> structures + formula evaluator, payroll settings, Professional Tax slabs,
> `Employee.workState`/`weeklyOffDaysOverride` (Phase 1); the pure
> `PayrollCalculator` — EPF/ESI/PT/LOP/proration math with golden-fixture
> tests (Phase 2); the full run lifecycle — `PayrollRun`/
> `PayrollRunApproval`/`PayrollLineItem`, draft assembly, recalculate,
> ad-hoc adjustments, submit-review, the two-person approval (INV-1), the
> payroll gate (INV-4), and the PROCESSED/DISBURSED immutability trigger
> (INV-2) (Phase 3); overtime claims — `OvertimeClaim` (owned by
> Attendance), manager-then-HR approval, CASH/COMP_OFF payout, and the
> calculator's new overtime earning line (Phase 4); DOB-locked payslip
> PDFs generated synchronously on `process()`, employee/HR self-service
> payslip download, and an on-demand dummy-CSV bank file behind a
> `BankFileGenerator` interface (Phase 5); and per-FY TDS slabs/regime
> config, per-employee `TdsRegimeChoice` (default NEW, HR-override
> audited), a null `DeclarationProvider`, and the annual-projection TDS
> figure now folded into every line item's `tdsDeducted`/`netPay` (Phase
> 6); and `SalaryRevision` + `ArrearsLineItem` — a backdated structure
> revision computes one arrears row per already-processed affected
> period (old-vs-new structure delta) and the next `createDraft` folds it
> into that run's `adHocAdjustments`; the Phase 3 re-process guardrails
> (mandatory reason, 409 on a second non-reprocess run) needed no new code
> (Phase 7); and `FullAndFinalSettlement` (`DRAFT → APPROVED → PAID`,
> one approval — decision 26) for a `SEPARATED` employee — unpaid salary
> for the exit month (reusing `calculatePayroll()`'s mid-month-exit
> support), leave encashment (Leave's new `getEncashableBalance()`
> contract), and gratuity, always standalone, never folded into a regular
> run (Phase 8). **Phase 9 is partially built**: the full frontend role ×
> tab matrix now exists (`apps/web/src/pages/payroll`), and a static
> RLS/grant audit of all 8 migrations passed — but the adversarial
> cross-tenant e2e suite, the ~500/~5,000-employee performance run, and
> an independent domain review of statutory rates/slabs all remain
> genuinely undone (the first two are blocked by this environment having
> no reachable Docker daemon or DB credentials; the third needs a human
> domain expert, not a self-review). See §9 Phase 9 for the detailed
> built/not-done split.
> **Highest-effort, highest-risk module — protect its time budget over
> breadth elsewhere** (`CLAUDE.md`).
> **Progress:** ~97% (see `docs/MODULE_SPECS.md` status table — keep in sync).
> **Code:** `apps/api/src/payroll` (Phases 1–8; the overtime claim workflow
> itself lives in `apps/api/src/attendance`, per decision 6). Frontend:
> `apps/web/src/pages/payroll` — built, not yet verified against a live
> backend in a browser (see §9 Phase 9).
> **Related:** `docs/MODULE_SPECS.md` §7 · module `03_EMPLOYEE_MASTER.md`
> (`ctcAnnual`, bank fields, `dateOfBirth` already on `Employee`) · module
> `05_ATTENDANCE.md` (`getLopDays(employeeId, month)` / `GET
> /attendance/lop-days`, and now `OvertimeClaim`/`getApprovedOvertime(Batch)()`
> — **both already live**, the upstream contracts this module needs) ·
> module `08_STATUTORY_COMPLIANCE.md` (hard downstream dependent — nothing
> in that module can build until this one exposes a processed-run contract)
> · `docs/TENANT_CONFIGURATION.md` (`PAYROLL` is already a recognized
> Layer-1 plan-entitlement module name; `payrollCutoffDay` already exists on
> `TenantSettings`).
> **Last synced to code:** 2026-11-23 (Phase 9 partially built — frontend
> + static RLS audit; e2e/performance/domain-review still blocked). None
> of the eight migrations is applied or e2e-verified against a real DB yet —
> `20260924090000_payroll_foundation`, `20261005090000_payroll_calc_engine`,
> `20261012090000_payroll_run_lifecycle`, `20261019090000_overtime_claims`,
> `20261026090000_payslips_and_bank_files`,
> `20261102090000_tds_and_regime_choice`,
> `20261109090000_revisions_and_arrears` and
> `20261116090000_full_and_final` are all unapplied).

---

## 0. Why this module is the one to protect

`CLAUDE.md`'s explicit call: this is the **highest-effort, highest-risk**
module in V1 — real money, real statutory exposure, real employee trust
(“did I get paid correctly”). Two invariants are non-negotiable and drive
almost every other design choice in this document:

- **Every run needs two-person approval**, and a period is **never
  processed twice** without an explicit override and reason on top of it.
- **A processed run is an immutable event record** — no in-place edits.
  Corrections are new adjusting entries, never a patch to history.

The one upstream piece this module needs that is **already built and
ready to consume**: Attendance's `getLopDays(employeeId, month)` /
`GET /attendance/lop-days?employeeId=&month=` (Company Admin/HR Manager
only). That contract was deliberately defined before Payroll started per
the cross-module dependency map's build-order note — don't re-derive LOP
from raw attendance data here, call that endpoint.

---

## 1. Purpose & scope

A configurable, India-compliant monthly payroll engine: per-employee
salary structures, statutory computation (EPF, ESI, Professional Tax,
TDS), a locked Draft→Review→Approve→Process→Disburse cycle, payslip PDFs,
and a bank disbursement file. Downstream, this module's processed runs are
the **only** input Statutory Compliance (module 08) is allowed to read —
Compliance never recomputes salary, it only reformats what Payroll already
computed.

**In scope (V1 target):**
- Salary structure builder (components, formulas, revision history,
  arrears).
- Statutory computation (EPF, PT, TDS projection, old/new regime).
- The locked processing cycle, ad-hoc payments, payslip PDFs, bank file.
- Full & Final settlement.

**Out of scope / deferred** (`CLAUDE.md` explicitly-deferred list, and
`[SHOULD]` items in the feature list below): live e-filing/payment-gateway
integrations beyond the `[SHOULD]`-tagged Razorpay Payroll API item, which
is itself v1.1, not V1. **ESI computation itself belongs here** (the rate
math), but the ESI **challan/return filing** is module 08's job, not
this module's.

---

## 2. User personas & their role in this module

| Persona | Why they touch this module | What they can do (target) | What they cannot do |
|---|---|---|---|
| **HR Manager / Company Admin** | Runs payroll, maintains salary structures, approves runs. | Build/edit salary structures; run the monthly cycle (Draft → Review → Approve → Process → Disburse); enter ad-hoc payments; process Full & Final settlements; download bank files. | Cannot approve a run alone: every run needs two distinct approvers (two-person rule), and a re-process of an already-`PROCESSED` period additionally needs an explicit override and reason — see §6 INV-1. Cannot run payroll at all until the tenant has a second active Company Admin — see §6 INV-4. Cannot edit a processed run in place — see §6 INV-2. |
| **Second approver (any other HR Manager / Company Admin)** | The second, distinct approver every run needs before it can be processed. | Approve a run someone else prepared or already approved once. | Cannot be the same account as the first approver (§12 decision 1). |
| **Employee** | Receives pay; declares tax regime; views own payslips. | View own payslips (DOB-locked PDF); view own salary structure (read-only, current + revision history); choose old/new tax regime for the FY; see own Full & Final statement when separated. | Cannot see any other employee's structure, payslip, or run data. Cannot edit their own structure or trigger a run. |
| **Line Manager** | Not a participant in this module for V1. | Nothing payroll-specific — no aggregate or per-report visibility. | Everything. |
| **Auditor** (read-only) | Reviews payroll runs and disbursement history for audit exposure. | *(Target)* read-only view of processed run summaries, approval trail, disbursement status — not a line-item drill-down into every employee's structure unless that's also needed for audit (open question, §12). | Cannot trigger, approve, or edit anything. |
| **Platform Admin** | Out of scope — separate console, no tenant PII/financial access. | — | — |

---

## 3. Functional expectations (definition of done)

**Salary structure**
1. Component builder: Basic, HRA, Special Allowance, Conveyance, LTA,
   Medical, custom allowances, PF/ESI employer contribution, gratuity
   provision (FR-PAY-001).
2. Each component is fixed / % of Basic / % of CTC / a formula
   (FR-PAY-002) — formulas must be data (a config row), never a hardcoded
   `if` branch, so a new allowance type doesn't need a deploy.
3. Minimum Basic = 50% of CTC, with a configurable floor per tenant
   (FR-PAY-003).
4. Salary revision history: effective date, revised CTC, reason, approver
   — an append-only trail, not an overwritten field (FR-PAY-004).
5. A backdated revision auto-generates arrears for the already-paid months
   it retroactively affects (FR-PAY-005).

**Statutory computation**
6. EPF on Basic+DA with the ₹15,000 ceiling, configurable to let an
   employee opt above it (FR-PAY-006).
7. State-specific Professional Tax slabs as admin-configurable lookup
   tables, not constants (FR-PAY-007) — mirrors `05_ATTENDANCE.md`'s
   `Shift`/`TenantSettings` pattern of "config table, never a hardcoded
   number."
8. Annual taxable-income projection for TDS, incorporating declared
   investments (80C/80D/HRA/LTA) — **reads** module 08's
   `InvestmentDeclaration`, does not own that data (FR-PAY-008).
9. Employee chooses old **or** new tax regime per FY (FR-PAY-009).
10. TDS re-computes whenever the projection changes mid-year — most
    notably when module 08 verifies proofs and replaces declared amounts
    with verified ones (FR-PAY-010).

**Processing**
11. Locked cycle: **Draft → Review → Approve → Process → Disbursed**
    (FR-PAY-011) — see §7 for the exact state machine.
12. Auto-import LOP days from Attendance for the pay period via
    `getLopDays(employeeId, month)` (FR-PAY-012) — **this contract already
    exists**, unlike Compliance's Payroll dependency which is still
    unbuilt.
13. Ad-hoc payments: advance, bonus, incentive, gratuity payout
    (FR-PAY-013).
14. Payslip PDF, password-protected with the employee's DOB in `DDMMYYYY`
    format (FR-PAY-014) — requires `Employee.dateOfBirth` to be present;
    decide the fallback for employees missing it before building (§12).
15. NEFT/RTGS bank file in HDFC/ICICI/SBI/Axis formats (FR-PAY-015).
16. Full & Final settlement: unpaid salary, leave encashment, gratuity,
    advance recovery (FR-PAY-016) — leave encashment reads Leave's balance
    data (module 04), does not recompute it.
17. `[SHOULD]` Razorpay Payroll API disbursement + webhook (FR-PAY-017) —
    v1.1, not V1.
18. Processed runs are immutable event records (FR-PAY-018) — see §6
    INV-2.

---

## 4. Technical design (target — nothing built yet)

### 4.1 Row scoping

Target `PayrollService.scopeFor(user)`, mirroring the pattern already
established in modules 03/05/08:

```
EMPLOYEE                      → own payslips, own structure (read-only),
                                 own regime choice, own FnF statement
HR_MANAGER / COMPANY_ADMIN    → all employees' structures, all runs
                                 (create/review/approve/process/disburse)
AUDITOR                       → read-only on processed run summaries +
                                 approval trail (exact depth TBD, §12)
```

### 4.2 Data model (draft — confirm before implementing; this is the
contract module 08 will build against, so get it right the first time)

**`SalaryStructure`** — one active structure per employee at a time.
`employeeId` · `ctcAnnual` (mirrors `Employee.ctcAnnual`, the "headline
reference figure" module 03 already stores — this table is where the
actual structure that figure summarizes lives) · `effectiveFrom` ·
`status` (`ACTIVE`/superseded — never deleted, a revision creates a new
row and closes the old one's validity).

**`SalaryComponent`** — `structureId` · `type` (`BASIC · DA · HRA ·
SPECIAL_ALLOWANCE · CONVEYANCE · LTA · MEDICAL · CUSTOM · PF_EMPLOYER ·
ESI_EMPLOYER · GRATUITY_PROVISION`) · `calculationMode` (`FIXED · PERCENT_
OF_BASIC · PERCENT_OF_CTC · FORMULA`) · `value` (Decimal, meaning depends
on `calculationMode`) · `formula?` (stored expression, only for
`FORMULA`).

**`SalaryRevision`** *(✅ built Phase 7, 2026-11-09)* — the append-only
history feature 4 requires. `employeeId` · `previousStructureId` ·
`newStructureId` · `effectiveDate` · `reason` · `approvedBy` ·
`createdAt`. Backdated revisions (feature 5) drive `ArrearsLineItem`
generation (one row per already-`PROCESSED` affected period), never a
rewrite of past `PayrollLineItem`s (INV-2 forbids that). `ArrearsLineItem`
(`PENDING → FOLDED`) sits pending until the next `createDraft` folds it
into that run's `adHocAdjustments` (decision 25 for what the delta
includes/excludes).

**`ProfessionalTaxSlab`** — config table (feature 7). `state` ·
`grossFrom` · `grossTo` · `monthlyAmount`. Admin-editable, seeded with
known-good state defaults at tenant onboarding.

**`PayrollSettings`** — one row per tenant: `epfCeiling` (default 15000) ·
`epfOptAboveCeiling` policy · `minBasicPercent` (default 50) ·
`overtimeEnabled` · `overtimeMultiplier` (default 2.0).

**`TaxSlab`** / **`TaxRegimeConfig`** *(✅ built Phase 6, 2026-11-02)* —
config tables for TDS, per tenant/financial year/regime (`OLD`/`NEW`):
slab boundaries and rates (`TaxSlab`) and the regime-wide standard
deduction, cess, and 87A rebate threshold/max (`TaxRegimeConfig`), seeded
lazily per FY — same editable-not-constant posture as `ProfessionalTaxSlab`
(UNVERIFIED FY2024-25-shaped defaults, decision 11, Phase 9 review).

**`Employee.workState`** *(new field on module 03's `Employee`)* —
`IndianState` enum (all states and UTs), nullable; drives Professional Tax
slab selection. Required before an employee is included in a run. Hybrid/
remote staff use the state of the office they're attached to; HR can
override.

**`OvertimeClaim`** *(owned by Attendance, module 05)* — `employeeId` ·
`month` · `hours` · `status` (`PENDING_MANAGER → PENDING_HR → APPROVED |
REJECTED`) · `payoutMode` (`CASH | COMP_OFF`, chosen by the employee when
claiming). Same manager-then-HR approval for both modes. Payroll reads only
fully `APPROVED` `CASH` hours via `getApprovedOvertime(employeeId, month)`;
`COMP_OFF` claims convert to a Leave comp-off credit and never touch
Payroll.

**`TdsRegimeChoice`** *(✅ built Phase 6, 2026-11-02)* — `employeeId` ·
`financialYear` · `regime` (`OLD`/`NEW`) · `setByUserId` (null = the
employee's own choice; set = an HR/Admin override, always audited —
decision 8). No row for an (employee, FY) defaults to `NEW`. Read by the
TDS projection; kept alongside (not merging into) the pre-existing
`Employee.taxRegime` field — see decision 24. Module 08's
`InvestmentDeclaration.regime` should mirror/reference this, not
duplicate it.

**`PayrollRun`** — one per tenant per pay period. `period` (`YYYY-MM`) ·
`status` (`DRAFT → REVIEW → APPROVED → PROCESSED → DISBURSED`, see §7) ·
`preparedBy` · `isReprocess` + `reprocessReason` (populated only for a
re-process) · `processedAt` · `disbursedAt`.

**`PayrollRunApproval`** — `runId` · `approverId` · `approvedAt`;
`@@unique([runId, approverId])`. A run reaches `APPROVED` only when two
distinct approvers are recorded (INV-1). Replaces first/second-approver
columns so the trail is append-only and auditable.

**`PayrollLineItem`** — one per employee per `PayrollRun`. `runId` ·
`employeeId` · `grossEarnings` · per-component breakdown (JSON snapshot of
the `SalaryComponent`s that applied, **not** a live FK — the whole point
of immutability is that this row must still make sense after the
employee's structure later changes) · `lopDays` (from
`getLopDays`) · `epfEmployee` / `epfEmployer` · `esiEmployee` /
`esiEmployer` · `professionalTax` · `tdsDeducted` · `adHocAdjustments`
(JSON: advance/bonus/incentive/gratuity-payout entries) · `netPay` ·
`payslipFileKey` (S3, private, DOB-locked PDF) · `bankFileBatchId?`.
**Never updated after the run reaches `PROCESSED`** — a correction is a
new adjusting `PayrollLineItem` referencing the original, or (more
commonly) folded into the next period's run, never an `UPDATE` on this
row.

**`FullAndFinalSettlement`** *(✅ built Phase 8, 2026-11-16)* —
`employeeId` (`@unique` — at most one ever) · `separationDate` ·
`unpaidSalaryDays`/`unpaidSalaryAmount` · `leaveEncashmentDays`/
`leaveEncashmentAmount` (reads Leave's balance via
`getEncashableBalance()`, module 04, does not recompute it) ·
`gratuityYearsOfService`/`gratuityAmount` · `advanceRecoveryAmount` ·
`netSettlement` · `calculationSnapshot` (the unpaid-salary EPF/ESI/PT
breakdown, same audit pattern as `PayrollLineItem`) · `status`
(`DRAFT → APPROVED → PAID`) · `preparedBy`/`approvedBy`/`approvedAt`/
`paidAt`. **Not built:** `generatedRunId` — dropped; decision 7 already
resolved the "folded into a regular run" TBD below as "never," so there
was nothing to link (decision 26).

**Not modeled here:** `InvestmentDeclaration` — that belongs to module 08
(already spec'd there); this module only **reads** it for the TDS
projection (feature 8), never owns or writes it.

### 4.3 API surface (target)

| Method | Path | Notes |
|---|---|---|
| `GET`/`POST`/`PATCH` | `/api/payroll/structures/:employeeId` | `@Roles(HR_MANAGER, COMPANY_ADMIN)` write; employee can `GET` own, read-only |
| `POST` | `/api/payroll/structures/:employeeId/revise` | Creates a `SalaryRevision`; backdated → triggers arrears calc into the next open run. **Live (Phase 7)** |
| `GET` · `PUT` | `/api/payroll/config/pt-slabs?state=` · `/config/pt-slabs/:state` | List slabs; `PUT` atomically replaces one state's whole slab set (must start at 0, be contiguous, end open-ended). **Live (Phase 1)** |
| `GET`/`PATCH` | `/api/payroll/config/tax-slabs` | Old/new regime slabs, standard deduction, cess, rebate per FY |
| `GET`/`PATCH` | `/api/payroll/config/settings` | Statutory rates: Basic floor, EPF (ceiling, opt-above, EPF/EPS/admin/EDLI rates), ESI. `GET` also for Auditor. **Live (Phase 1)** |
| `POST`/`PATCH` | `/api/payroll/regime/:employeeId` | Employee sets own regime choice for the current FY (or HR on their behalf — TBD, §12) |
| `POST` | `/api/payroll/runs?period=YYYY-MM` | Creates a `DRAFT` run; 409 if a `PROCESSED`/`DISBURSED` run already exists for that period and `isReprocess` isn't set |
| `GET` | `/api/payroll/runs/:id` | Run detail + line items |
| `PATCH` | `/api/payroll/runs/:id/line-items/:employeeId` | Only while `DRAFT`/`REVIEW` — ad-hoc adjustments |
| `POST` | `/api/payroll/runs/:id/recalculate` | Re-runs the calculation engine over current line items, still `DRAFT`/`REVIEW` only |
| `POST` | `/api/payroll/runs/:id/submit-review` | `DRAFT → REVIEW` |
| `POST` | `/api/payroll/runs/:id/approve` | Records the caller's approval; the run moves `REVIEW → APPROVED` only once two distinct approvers have approved (INV-1); 409 if the tenant fails the payroll gate (INV-4) |
| `POST` | `/api/payroll/runs/:id/process` | `APPROVED → PROCESSED` — the immutability boundary; generates payslip PDFs + bank file |
| `POST` | `/api/payroll/runs/:id/disburse` | `PROCESSED → DISBURSED`; records `NET_PAID` per employee |
| `GET` | `/api/payroll/runs/:id/bank-file?format=HDFC\|ICICI\|SBI\|AXIS` | Downloads the disbursement file |
| `GET` | `/api/payroll/payslips/:employeeId?period=YYYY-MM` | Own payslip (employee), or any (HR/Admin) |
| `POST`/`GET`/`PATCH` | `/api/payroll/fnf/:employeeId` | Full & Final settlement generate/view/adjust-advance. **Live (Phase 8)** |
| `POST` | `/api/payroll/fnf/:employeeId/approve` · `/mark-paid` | `DRAFT → APPROVED → PAID`. **Live (Phase 8)** |

All routes: `JwtAuthGuard → TenantGuard → RolesGuard`, plus
`@RequiresModule('PAYROLL')` (`EntitlementGuard`, already the pattern for
Leave/Attendance) from the first controller — `PAYROLL` is already a
recognized Layer-1 module name in `TENANT_CONFIGURATION.md`.

### 4.4 Configuration dependencies

- **Layer 1 (plan entitlement):** `PAYROLL` already exists as a module
  name — gate from day one.
- **Layer 2 (tenant business config):** `TenantSettings.payrollCutoffDay`
  already exists (defaults `25`) and is already the deadline Attendance's
  regularization auto-resolve hangs on — this module should run its cycle
  against the same field, not introduce a second cutoff-day setting.
  `ProfessionalTaxSlab` and EPF-ceiling config (§4.2) are new Layer-2-style
  tables this module introduces — follow `05_ATTENDANCE.md`'s
  `Shift`/`AttendanceSettings` precedent (seeded defaults at onboarding,
  editable via a Settings screen), don't hardcode them even for the first
  cut.

---

## 5. Core flows (target)

### 5.1 Monthly run (happy path, mirrors `MODULE_SPECS.md` §7)

1. HR/Company Admin → **Payroll → New run** for `2026-09`.
2. System assembles a `DRAFT`: each active employee's current
   `SalaryStructure` × that period's `getLopDays()` result × statutory
   deductions (EPF/PT/TDS) × any ad-hoc items.
3. Manager reviews line items (`REVIEW`), fixes ad-hoc entries,
   `POST .../recalculate` as needed.
4. `POST .../approve` by two distinct users → `APPROVED` (INV-1). If this
   period already has a `PROCESSED` run, this must be an explicit
   re-process with a reason.
5. `POST .../process` → `PROCESSED`, immutable from this point; payslip
   PDFs generated (DOB-locked); bank file generated.
6. `POST .../disburse` → bank file downloaded (or, v1.1, a Razorpay call)
   → `DISBURSED`; per-employee `netPay` recorded as paid.
7. Employees see the payslip in self-service; the run's numbers become
   the only thing module 08 is allowed to read for that period's
   EPF/ESI/24Q filings.

### 5.2 Backdated salary revision → arrears — ✅ built Phase 7

1. HR revises an employee's CTC effective 2 months ago (e.g. a delayed
   appraisal).
2. `POST .../structures/:employeeId/revise` with the backdated
   `effectiveDate` creates the new `SalaryStructure` + a `SalaryRevision`
   row.
3. The difference between what was already paid under the old structure
   and what should have been paid under the new one, for each affected
   already-`PROCESSED` period, becomes an `ArrearsLineItem` folded into
   the **next open** run — never a rewrite of the historical
   `PayrollLineItem`s (INV-2).

### 5.3 Full & Final settlement — ✅ built Phase 8

1. Employee's lifecycle state moves to `SEPARATED` (module 03), which
   requires `lastWorkingDate` to be set (module 03's own lifecycle rule).
2. HR calls `POST /payroll/fnf/:employeeId` → system computes unpaid
   salary days/amount for the separation month (`employedTo =
   lastWorkingDate`), reads Leave's encashable balance (module 04's
   `getEncashableBalance()`), the configured gratuity formula, stores a
   `DRAFT` settlement.
3. HR optionally adjusts `advanceRecoveryAmount` (`PATCH`, `DRAFT` only,
   recomputes `netSettlement`), then `POST .../approve` (one approval,
   decision 26) and `POST .../mark-paid` once actually disbursed —
   always a standalone off-cycle record, never folded into a regular run
   (decision 7).

---

## 6. Business rules & invariants

- **INV-1** — two-person rule: every `PayrollRun` needs approvals from two
  distinct users (HR Manager or Company Admin) before it can be processed;
  the preparer may be one of them. A `(tenant, period)` can only be
  `PROCESSED`/`DISBURSED` once unless the new run carries `isReprocess`
  and a reason. Enforced at the service layer via `PayrollRunApproval`, not
  assumed from a UI checkbox.
- **INV-2** — a `PayrollLineItem` is never updated once its parent run
  reaches `PROCESSED`. Corrections are new rows (an adjusting entry or a
  fold into the next period), full stop — this is the same principle as
  module 08's INV-2 mirrors from this module.
- **INV-3** — Basic must be ≥ 50% of CTC unless the tenant's configured
  floor says otherwise; enforced when a `SalaryStructure` is saved, not
  just at calculation time.
- **INV-4** — payroll gate: a tenant can create or approve a run only while
  it has at least two active Company Admins. Onboarding with one admin is
  fine; Payroll simply stays blocked, with a clear error, until a second is
  added (and again if the count later drops below two).
- **RULE-1** — EPF wages are capped at the ceiling (default ₹15,000)
  unless the employee has opted above it; the ceiling itself is tenant
  config, never a constant.
- **RULE-2** — TDS is re-projected whenever the inputs change: a new
  `TdsRegimeChoice`, a new `SalaryRevision`, or module 08 verifying
  investment-declaration proofs. This module owns the recompute trigger;
  module 08 only supplies the verified numbers.
- **RULE-3** — a payslip PDF is never generated for an employee missing
  `dateOfBirth`: the employee is excluded and listed to HR (§12 decision 2);
  never a silent "no password" fallback.
- **RULE-5** — LOP days = `ABSENT` + approved unpaid-leave days (whole
  days, §12 decision 3). Deduction = monthly pay × LOP days ÷ working days,
  where working days exclude tenant weekly-offs and declared non-optional
  holidays (decision 4).
- **RULE-6** — overtime is paid only from fully approved `OvertimeClaim`s
  (manager then HR) approved before `payrollCutoffDay`; otherwise it rolls
  into the next month (decision 6).
- **RULE-7** — an employee with no `workState` or no active structure is
  excluded from a run and listed as an exception, never silently paid.
- **RULE-4** — Leave encashment in a Full & Final settlement reads Leave's
  balance (module 04) as authoritative; this module must not independently
  recompute leave balance.

---

## 7. States (target)

**`PayrollRun.status`:** `DRAFT → REVIEW → APPROVED → PROCESSED →
DISBURSED` (linear; no state is skippable). Re-entering `DRAFT` for an
already-`PROCESSED` period is only possible via the explicit
`isReprocess` path (INV-1), which starts a **new** `PayrollRun` row, not a
transition backward on the existing one — the old run stays immutable and
intact.

**`SalaryStructure.status`:** `ACTIVE` (exactly one per employee) →
superseded (closed by a later revision's `effectiveFrom`, never deleted).

**`FullAndFinalSettlement.status`:** *(✅ built Phase 8)* `DRAFT →
APPROVED → PAID` — one approval moves `DRAFT → APPROVED` (decision 26),
not INV-1's two-person rule.

---

## 8. Permission matrix (target)

| Capability | Employee | Line Manager | HR Manager / Company Admin | Auditor |
|---|:--:|:--:|:--:|:--:|
| View own salary structure / revision history | own (read-only) | — | ✓ (all) | — (decision 9: no per-employee pay) |
| Edit salary structure / revise | — | — | ✓ | — |
| Manage PT slabs / EPF config | — | — | ✓ | — |
| Choose tax regime | own | — | ✓ *(audited override, decision 8)* | — |
| Create / review / recalculate a run | — | — | ✓ | — |
| Approve a run (two distinct approvers required) | — | — | ✓ | — |
| Start a re-process (reason required) | — | — | ✓ | — |
| Process / disburse a run | — | — | ✓ | — |
| View own payslip | own | — | — | — |
| View any payslip / run line items | — | — | ✓ | ✓ (read-only) |
| Generate / view Full & Final settlement | own (view final statement only) | — | ✓ | ✓ (read-only) |

---

## 9. Phase-wise execution plan

Sizes are rough estimates for one backend + one frontend dev working in
parallel (~13 weeks total, in line with the blueprint's 12-week plan —
"structure + statutory + single-run before FnF, arrears, and Razorpay").
"Status %" is what to write into the `MODULE_SPECS.md` status table when the
phase exits.

| # | Phase | Size | Status % on exit |
|---|---|---|---|
| 0 | Decisions and contracts | 3–4 days | 0% |
| 1 | Schema and config foundation | ~1.5 wk | 12% |
| 2 | Calculation engine (pure functions) | ~1.5 wk | 25% |
| 3 | Run lifecycle (single run) | ~2 wk | 48% |
| 4 | Overtime claims (Attendance) + Payroll consumption | ~1 wk | 58% |
| 5 | Payslips and bank files | ~1.5 wk | 70% |
| 6 | TDS and regime choice | ~2 wk | 82% |
| 7 | Re-process, revisions, arrears | ~1.5 wk | 91% |
| 8 | Full & Final settlement | ~1 wk | 97% |
| 9 | Hardening and sign-off | ~1 wk | 100% |

### Rules that apply to every phase (`CLAUDE.md`)

- Tests ship in the **same change** as the code (unit test with a hand-built
  fake of `TenantPrismaService`, per `employees.service.spec.ts`; an
  authorization/permission test for every changed role rule).
- Update the `MODULE_SPECS.md` status row, `**Status:**` line and
  `Last synced` date in the same commit.
- Before calling a phase done: `npm run test:api`; if frontend was touched,
  `npm run build` and `npm run lint` from the repo root.
- New tenant tables: `tenant_id`, `@@index([tenantId])`, RLS policy in a
  migration. Money is `NUMERIC`/`Prisma.Decimal`, never float. Every
  controller carries `@RequiresModule('PAYROLL')` from its first commit.
- Migrations are applied to the shared Supabase dev DB only by the schema
  owner (`./scripts/dev.sh migrate`).

### Phase 0 — Decisions and contracts (no feature code)

- Record the decisions in §12 (done 2026-09-24) and fold them into this spec.
- Add the tax-slab config tables, `Employee.workState` and the overtime
  contract to the spec (done — §4.2, §4.3).
- Write `docs/ui-build-prompts/07-payroll-engine.md` (copy the canonical
  §2.2 tokens block byte-identical from an existing prompt).
- Agree the **processed-run contract** with module 08's owner: `period`,
  `status`, per-employee PF wages, EPS/EPF split, ESI wages, TDS deducted.
  Record it in both deep specs.
- Fix stale cross-references (§10: Documents and Notifications now exist).
- **Exit:** every question that blocks Phases 1–3 has a written answer.

### Phase 1 — Foundation: schema and config — ✅ backend built 2026-09-24

**Built:**
- **Migration** `20260924090000_payroll_foundation` (written offline, **not yet
  applied or run against a real DB** — needs `./scripts/dev.sh migrate` by the
  schema owner): `salary_structures` (one `ACTIVE` per employee via a partial
  unique index), `salary_components`, `professional_tax_slabs`,
  `payroll_settings`, `Employee.work_state` (`IndianState`, all 36 states/UTs).
  RLS + grants in the same migration.
- **Seeding:** `seedPayrollDefaults()` (`payroll-defaults.ts`) at tenant
  onboarding + `prisma/seed.ts`, and lazily on first read for tenants that
  predate Payroll. Rates are the column defaults; PT slabs for Karnataka,
  Maharashtra, Telangana, Andhra Pradesh, West Bengal, Gujarat — all
  **UNVERIFIED** until the Phase 9 review. States not seeded (e.g. Tamil Nadu,
  Kerala: half-yearly) are entered by the Company Admin; no slabs = no PT.
- **Module** `apps/api/src/payroll`, `@RequiresModule('PAYROLL')`. Structure
  create/read/update (INV-3 enforced at save; Employee reads own only; Auditor
  and Line Manager get 403), statutory settings read/update, PT slab
  read/replace. Every change writes an `audit_log` row **without amounts**.
- **Formula evaluator** (`formula.evaluator.ts`) — restricted grammar, no
  `eval`; `resolveMonthlyAmounts()` resolves fixed / %-of-CTC / %-of-Basic /
  formula components with cycle detection (Phase 2 reuses it).
- `TenantPrismaService.transaction()` — atomic multi-statement writes with the
  RLS variable set (used for PT slab replace).
- `Employee.workState` accepted on the HR `PATCH /employees/:id` (not on the
  Employee self-edit whitelist).
- **UI build prompt** written: `docs/ui-build-prompts/07-payroll-engine.md`.

**Deviations from the original plan:** `SalaryRevision` (→ Phase 7) and
`TaxSlab`/`TaxRegimeConfig` (→ Phase 6) tables are created in the phase that
uses them, not now; no `packages/shared-types` (the package doesn't exist in
the repo); frontend deferred until the sample UI is supplied.

**Tests:** 56 new unit tests (55 in `src/payroll`, 1 in `employees.service.spec.ts`) (evaluator injection cases, resolver +
INV-3, config validation, structure service scoping, authorization matrix).
**Not done:** RLS/e2e cross-tenant test for the new tables — needs Docker
Postgres + Firebase, unavailable when this was built; add before merge.

### Phase 2 — Calculation engine (pure functions, no DB) — ✅ backend built 2026-10-05

**Built:**
- **Migration** `20261005090000_payroll_calc_engine` (written offline, **not
  yet applied** — same caveat as Phase 1's migration): adds
  `employees.weekly_off_days_override` (`Int[]`, default `[]`, empty =
  falls back to the tenant default), the HR-only field decision 14 needed.
  Wired onto the existing `PATCH /employees/:id` (not the Employee
  self-edit whitelist), mirroring `workState`.
- **`PayrollCalculator`** (`payroll-calculator.ts`): pure function, input =
  resolved components + CTC + working/payable days + EPF/ESI config + PT
  slabs + month; output = full line-item breakdown. Covers earnings (every
  component except the employer-cost-provision types `PF_EMPLOYER`/
  `ESI_EMPLOYER`/`GRATUITY_PROVISION`, which are CTC-only and never paid to
  the employee), LOP + mid-month join/exit proration (both expressed as one
  `payableDays`/`workingDays` factor applied uniformly to every earning),
  EPF (wages = prorated Basic only, no `DA` type in V1 — decision 16;
  ceiling, opt-above, EPF/EPS/admin/EDLI split, rounded to the nearest
  rupee), ESI (eligibility checked against the *full* monthly gross,
  contribution computed on the *actual* gross paid — a simplification
  flagged for the Phase 9 domain review, since real ESI practice keeps an
  employee covered for the whole contribution period once enrolled), PT via
  `resolveProfessionalTax()` (slab lookup + February-amount override), and
  a TDS parameter defaulting to 0 until Phase 6. Refuses to return a
  negative net pay unless `allowNegativeNet` is explicitly passed — a
  negative net means a config/data error, not a valid payslip.
- **`working-days.util.ts`**: `countWorkingDays()` (mirrors the private
  helper already in `leave/leave.service.ts` — each module keeps its own
  copy, not a shared one, per the modular-monolith boundary),
  `effectiveWeeklyOffDays()` (decision 14's override-or-fallback), and
  `computePayableDays()` (working days in the full period vs. payable days
  in the employed sub-range minus whole-day LOP — covers both LOP and
  mid-month join/exit through the same mechanism).
- **`professional-tax.util.ts`**: `resolveProfessionalTax()` — slab lookup
  (left-inclusive/right-exclusive band, open-ended last slab, February
  override), decoupled from Phase 1's Prisma rows so it's independently
  testable.

**Deviations from the original plan:** none — decisions 14–17 (recorded
2026-10-05, §12) folded in exactly as planned; half-day LOP was dropped
from scope entirely (decision 15: half-day leave is always full pay), so
the calculator never needs fractional LOP days.

**Tests:** 28 new unit tests across `working-days.util.spec.ts` (9),
`professional-tax.util.spec.ts` (6), `payroll-calculator.spec.ts` (13) —
EPF at/above/below the ceiling, ESI just under/at/over ₹21,000, PT slab
boundaries (including the open-ended last slab and the February override),
LOP on a 20- and 23-working-day month, a mid-month joiner and exit, and the
two property tests (net = gross − deductions; a negative net throws unless
explicitly allowed). All hand/independently verified before being encoded
as fixtures, per `CLAUDE.md`'s testing rule. Full repo suite (`npx jest`
from `apps/api`): 30 suites, 384 tests, all green; `tsc -p . --noEmit`,
lint, and `npm run build` all clean.
**Not done:** the fixtures use hypothetical PT slab shapes for clarity, not
the actual (already-unverified) seeded rates — still correctly deferred to
the Phase 9 domain review (decision 11).

### Phase 3 — Run lifecycle (single run, no re-process) — ✅ backend built 2026-10-12

**Built:**
- **Migration** `20261012090000_payroll_run_lifecycle` (written offline,
  **not yet applied** — same caveat as Phases 1–2): `PayrollRun`,
  `PayrollRunApproval` (append-only, `@@unique([runId, approverId])`),
  `PayrollLineItem`. A partial unique index enforces at most one
  non-reprocess run per `(tenant, period)` (Prisma can't express it, same
  pattern as `salary_structures`' "one ACTIVE per employee"). A `BEFORE
  UPDATE OR DELETE` trigger on `payroll_line_items` rejects any mutation
  once its run is `PROCESSED`/`DISBURSED` (INV-2) — the real backstop, not
  just a service-layer check; `hrms_app` still gets `UPDATE`/`DELETE`
  grants for the `DRAFT`/`REVIEW` editing window, since the trigger is what
  actually enforces immutability.
- **Attendance change:** `AttendanceService.getLopDaysBatch(month)` (one
  query per tenant via `groupBy`), and `getLopDays()`/`getLopDaysBatch()`
  both now add approved unpaid-leave days on top of `ABSENT` records
  (decision 3, RULE-5) via new `LeaveService.getApprovedLopDaysBatch()`,
  which clips a leave request to the queried month and re-counts working
  days rather than prorating its stored total. Leave's `apply()` also now
  enforces decision 15 (half-day leave is never LOP, even with zero
  balance) — a one-line guard, not new schema.
- **`PayrollRunService`** (`payroll-run.service.ts`): `createDraft` (the
  payroll gate, the one-non-reprocess-run-per-period check, per-employee
  assembly via a shared pure `computeLineItem()`, exceptions for missing
  `workState`/no active structure/a calculation error, and a non-blocking
  warning when regularizations are still `PENDING` for the period —
  decision 18 below settled "warn, not block"), `recalculate` (re-derives
  every line item's figures, preserving existing ad-hoc adjustments;
  aborts with nothing written if any employee's recompute fails),
  `setLineItemAdjustments` (folds signed advance/bonus/incentive entries
  into `netPay` without touching the statutory wage base), `submitForReview`
  (`DRAFT → REVIEW`), `approve` (INV-1: an idempotent upsert per approver,
  advances to `APPROVED` only once two distinct approvers exist),
  `process` (`APPROVED → PROCESSED` — the immutability boundary; payslip
  PDFs and the bank file are Phase 5, not generated here), `disburse`
  (`PROCESSED → DISBURSED`). `getRun` gives the Auditor a reduced view —
  status, approval trail, line-item/exception counts, no amounts
  (decision 9) — and 403s anyone else outside HR/Admin/Auditor.
- **Audit + notifications:** every transition writes an `audit_log` row and
  a `PAYROLL_RUN_STATUS_CHANGED` notification (one generic template,
  switched on `status`, to `HR_ROLES`) through the existing dispatcher —
  only on an actual status change, not on every partial approval.
- **Draft assembly is synchronous**, not a BullMQ job (deviation — see
  below).

**Deviations from the original plan:**
- **No BullMQ `payroll` queue.** Draft assembly runs synchronously inside
  the `POST /runs` request. The plan called for a queue "same pattern as
  Leave and Attendance," but introducing async job infrastructure for a
  request-timeout risk that hasn't materialized yet (the two current
  tenants are small) is exactly the kind of speculative complexity
  `CLAUDE.md` asks to avoid. Revisit at the Phase 9 performance test
  (~500/~5,000 employees) if synchronous assembly proves too slow.
- **Employees excluded from every run, not just exceptioned:**
  `lifecycleState IN ('SEPARATED', 'PRE_JOINING')` employees are filtered
  out entirely before assembly (not listed as an exception) — a separated
  employee's final pay is Phase 8's Full & Final settlement, never folded
  into a regular run (decision 7), and someone who hasn't joined yet has
  nothing to pay. `SUSPENDED`/`NOTICE_PERIOD` employees are included like
  any other active employee — whether a suspended employee should be paid
  at all isn't decided anywhere in this spec; flagged in "Still open" below
  rather than silently guessed.
- **`epfEmployer` is one summed total** (EPS + employer PF + admin charge +
  EDLI), not the four-way split — `PayrollLineItem.calculationSnapshot`
  (JSON) keeps the full split, so a future compliance filing (module 08's
  ECR) reads the detail from there, not from a scalar column.
- **No run-listing endpoint.** Only `GET /runs/:id` exists, matching the
  Phase 0 API-surface table exactly — the table never specified a list
  endpoint, so one wasn't added (HR gets the id from the `POST /runs`
  response).

**Tests:** 28 new unit tests — `PayrollRunService` (25: the full state
machine, INV-1's idempotent-double-approval case, INV-4 on both create and
approve, exception classification, the P2002 → 409 race mapping, the
Auditor's reduced view, `recalculate`'s all-or-nothing guarantee) plus 2
`LeaveService` (decision 15, `getApprovedLopDaysBatch` clipping) and 3
`AttendanceService` (the combined `ABSENT` + leave LOP figure, the batch
form) — all hand/independently verified before being hardcoded, per
`CLAUDE.md`. Full repo suite: 31 suites, 420 tests, all green; `tsc -p .
--noEmit`, lint, and `npm run build` all clean.
**Not done:** the full-cycle **e2e** test (Draft → Disbursed against a real
Postgres, the double-create concurrency race against the real partial
unique index, the immutability trigger actually firing, RLS cross-tenant
isolation for the three new tables) — needs Docker Postgres + Firebase,
unavailable when this was built; add before merge, same standing gap as
Phases 1–2's tables.

**Compliance unlock:** module 08's ECR and ESI work can start reading a
`PROCESSED` run's `PayrollLineItem` rows now — the processed-run contract
(`period`, `status`, per-employee PF wages via `calculationSnapshot.epf`,
ESI wages via `calculationSnapshot.esi`) exists; `tdsDeducted` stays `0`
until Phase 6.

### Phase 4 — Overtime claims (Attendance) + Payroll consumption — ✅ backend built 2026-10-19

**Built:**
- **Migration** `20261019090000_overtime_claims` (written offline, **not
  yet applied** — same caveat as Phases 1–3): `OvertimeClaim` (Attendance-
  owned; one claim per employee per month — `@@unique([employeeId, month])`
  — `PENDING_MANAGER → PENDING_HR → APPROVED | REJECTED`), plus two new
  `NotificationTemplate` values, plus `PayrollSettings.overtimeEnabled`
  (default `false`) and `overtimeMultiplier` (default `2.0`).
- **`AttendanceService`** (`attendance.service.ts`): `createOvertimeClaim()`
  — the employee claims that month's already-tracked total (`stats()`'s
  `overtimeHours` computation, extracted into a shared `sumOvertimeHours()`
  helper so both paths agree); starts `PENDING_MANAGER` with a reporting
  manager, `PENDING_HR` without one (same Leave L1/L2 fallback). A second
  claim for the same month 409s (the unique index). `decideOvertimeClaim()`
  — mirrors Leave's `approve()`/`reject()` shape: a direct reporting
  manager or HR/Admin decides at `PENDING_MANAGER`, only HR/Admin at
  `PENDING_HR`; HR approval of a `COMP_OFF` claim calls the new
  `LeaveService.creditOvertimeCompOff(employeeId, hours ÷ shiftHours, month)`
  exactly once (the claim's own status transition is the idempotency
  boundary, same pattern as every other one-shot ledger write in this
  codebase — no separate check needed). `getApprovedOvertime(employeeId,
  month)` / `getApprovedOvertimeBatch(month)` — the Payroll-facing contract,
  0 for anything not `APPROVED`+`CASH`. `getShiftHours(employeeId)` exposes
  `resolveShift()`'s result for the hourly-rate calc below.
- **`LeaveService.creditOvertimeCompOff()`**: a fractional-day sibling to
  the existing whole-day `creditCompOff()` (which stays untouched — this is
  an additive method, not a signature change, per the surgical-changes
  rule since `creditCompOff` is used by Attendance's own weekly-off/holiday
  clock-in flow and is already 100% done).
- **New notification templates** `OVERTIME_CLAIM_PENDING_APPROVAL` /
  `OVERTIME_CLAIM_DECIDED` (mirroring Leave's `LEAVE_PENDING_APPROVAL`/
  `LEAVE_DECIDED` shape) — a deliberate addition over reusing
  `REGULARIZATION_PENDING_APPROVAL`, which would have sent a factually
  wrong "attendance correction" email for an overtime claim.
- **`PayrollCalculator`**: a new optional `overtime: { hours, hourlyRate,
  multiplier }` input adds one `OVERTIME`-coded earning line, additive and
  **never prorated by `payableFactor`** (it's already a fixed hours-based
  amount, independent of LOP) — folded into `grossEarnings` (so it's
  included in ESI wages and PT) but never into EPF wages (which remain
  Basic-only per decision 16, untouched by this change). `PayrollRunService`
  resolves the hourly rate itself — `fullMonthlyBasic ÷ (workingDays ×
  shiftHoursPerDay)` — rather than the calculator reaching for it, keeping
  the calculator a pure function of its inputs. Overtime is only wired in
  at all when `PayrollSettings.overtimeEnabled` is true (off by default, so
  no existing tenant's payroll changes until a Company Admin opts in).

**Deviations from the original plan:**
- **No automated cutoff "roll-over."** The plan's wording — "must be fully
  approved before `payrollCutoffDay`, otherwise it rolls into the next
  month" — doesn't specify a mechanism, and `OvertimeClaim.month` is fixed
  at creation (one claim per employee per month). Building automatic
  cross-month hour-shifting wasn't attempted; the natural behaviour is
  simpler and matches "roll into the next month" closely enough: if a
  claim isn't `APPROVED` by the time a period's run is created, it's
  simply absent from that run (an exception isn't even raised — Payroll
  just sees 0 hours); once approved later, HR can fold the pay in through
  the existing ad-hoc-adjustment escape hatch (`setLineItemAdjustments`,
  Phase 3) on whichever run is still open. Flagged as decision 21.
- **Hourly-rate basis is Basic only, not "Basic + DA.​"** The plan's formula
  was written before decision 16 (no `DA` component type in V1) existed;
  updated to match.
- **No distinct "overtime" line-item column.** The approved `CASH` amount
  lives inside `PayrollLineItem.calculationSnapshot` (as an `OVERTIME`
  earning) and is folded into `grossEarnings`/`netPay` like any other
  earning — no separate scalar column was added, consistent with Phase 3's
  decision to keep scalar columns to summary figures only.

**Tests:** 20 new unit tests — `AttendanceService` (14: claim creation and
its validations, the manager-then-HR state machine including the
"same-account-twice" and already-decided guards, the COMP_OFF→Leave credit
call with the correct fractional days, `getApprovedOvertime`/batch),
`LeaveService.creditOvertimeCompOff` (2), `PayrollCalculator` overtime (3:
included/excluded from the right wage bases, zero-hours no-op, never
prorated by LOP), `PayrollRunService` (2: wired in only when
`overtimeEnabled`, shift-hours lookup skipped entirely when disabled) —
all hand/independently verified before being hardcoded. Full repo suite:
31 suites, 444 tests, all green; `tsc -p . --noEmit`, lint, and `npm run
build` all clean.
**Not done:** the same standing gap as every prior phase — none of the
four migrations has run against a real Postgres, and no RLS/e2e
cross-tenant test exists yet for `overtime_claims`.

**Exit:** approved `CASH` overtime shows up correctly in a run's gross pay;
unapproved or `COMP_OFF` overtime does not (verified by the `getApprovedOvertime`
tests and the `PayrollRunService` wiring tests above).

### Phase 5 — Payslips and bank files — ✅ backend built 2026-10-26

**Built:**
- **Migration** `20261026090000_payslips_and_bank_files` (written offline,
  **not yet applied** — same caveat as Phases 1–4): adds
  `payroll_line_items.payslip_file_key` (nullable, rides the existing
  Phase 3 UPDATE grant/RLS policy — no new table) and the
  `PAYSLIP_READY` notification template.
- **`payslip-generator.ts`**: `generatePayslipPdf()` — a DOB-locked
  (`DDMMYYYY`, `payslipPassword()`) PDF via `pdfkit`'s own AES encryption
  (`userPassword`, no shell-out/`eval`); one earnings/deductions/net-pay
  page per employee per period, no company name or logo (the `tenants`
  table isn't readable from a tenant-scoped connection, and nothing in the
  spec requires a logo yet).
- **`bank-file-generator.ts`**: `BankFileGenerator` interface +
  `GenericCsvBankFileGenerator` (`BANK_FILE_GENERATORS.CSV`) — the only
  implementation, decision 12. An unknown `format` 400s with the list of
  what's actually implemented.
- **`PayrollRunService.process()`** now also: for every line item whose
  employee has a `dateOfBirth`, renders and uploads the payslip PDF
  (`StorageService`, key segment `payslip`), then — in the **same**
  transaction, and **before** the run's own status update — writes
  `payslipFileKey` onto the line item, so the Phase 3 INV-2 trigger (which
  reads the run's live status) still sees `APPROVED` and allows the write;
  only after that does the run flip to `PROCESSED`. An employee missing
  `dateOfBirth` is excluded from payslip generation and folded into the
  run's `exceptions` as `NO_DOB_FOR_PAYSLIP` (decision 2) — their pay itself
  is untouched, only the payslip PDF is skipped.
- **`PayrollRunService.getPayslipDownloadUrl(employeeId, period, user)`** —
  a short-lived presigned URL, same pattern as Documents. Employee: own
  only; HR/Admin: any. 404s if the period has no processed run, or that
  employee has no `payslipFileKey` (excluded for missing DOB).
- **`PayrollRunService.getBankFile(runId, format, user)`** — generated
  **on demand** from the (by now immutable) line items, not pre-generated
  and stored; decrypts each employee's `bankAccountCiphertext`
  (`FieldEncryptionService`, already used for PAN/bank reveal in module 03)
  for the account number. An employee missing bank details (no ciphertext
  or no IFSC) is skipped, not failed — the response reports
  `skippedEmployeeCount` so HR can follow up, same "warn, don't block"
  posture as Phase 3's pending-regularizations exception.
- **Routes:** `GET /payroll/runs/:id/bank-file?format=` (HR/Admin only,
  only once `PROCESSED`/`DISBURSED`); `GET /payroll/payslips/:employeeId?
  period=` (no `@Roles` — row scoping in the service, like `getStructure`).
- **Notification:** `PAYSLIP_READY` to the employee (not the broad
  `HR_ROLES` broadcast `PAYROLL_RUN_STATUS_CHANGED` uses), one per
  successfully generated payslip, after `process()` commits.

**Deviations from the original plan:**
- **No BullMQ `payroll` queue / worker.** Same reasoning as Phase 3's
  decision 19 — payslip generation runs synchronously inside
  `POST .../process`, not on a queue. Revisit together with decision 19 at
  the Phase 9 performance test.
- **The bank file is generated on demand, not stored.** The plan's
  `PayrollLineItem.bankFileBatchId` field was dropped — since the only
  implementation is a dummy CSV and line items are already immutable once
  `PROCESSED`, regenerating from them on every `GET` is simpler than
  persisting and invalidating a cached file, and avoids a second S3 write
  path per run. Revisit if a real bank format turns out to be expensive to
  regenerate repeatedly.
- **No separate "NET_PAID" per-line-item field.** `disburse()` already
  flips the whole run to `DISBURSED` with a `disbursedAt` timestamp
  (Phase 3); every line item's "paid" state is derivable from its parent
  run, so no duplicate scalar was added.
- **No company name/logo on the payslip.** The `tenants` table has no
  `hrms_app` grant (platform-level data), so a tenant-scoped query can't
  read `Tenant.name` without a new grant nobody asked for yet. Flagged in
  "Still open."

**Tests:** 16 new unit tests — `payslip-generator.spec.ts` (4: `DDMMYYYY`
password formatting, a structural `/Encrypt` check on the output buffer in
place of a full PDF-parsing dependency, adjustments present/absent),
`bank-file-generator.spec.ts` (4: exact-fixture round-trip, header-only for
zero rows, comma/quote escaping, registry lookup), `PayrollRunService` (8:
payslip generated + line item stamped + notification sent for an employee
with a DOB, excluded with `NO_DOB_FOR_PAYSLIP` for one without, download-URL
row scoping in both directions, 404s for no-run/no-payslip, bank-file CSV
content and decryption, skipped-employee counting, unimplemented-format
400, PROCESSED-only gate). All hand/independently verified before being
hardcoded. Full repo suite: 33 suites, 467 tests, all green; `tsc -p .
--noEmit`, lint, and `npm run build` all clean.
**Not done:** the same standing gap as every prior phase — none of the
five migrations has run against a real Postgres, and no RLS/e2e
cross-tenant test exists yet confirming a presigned payslip URL or bank
file can't leak across tenants.

**Exit:** a payslip PDF only opens with `DDMMYYYY` (verified at the
generator level, not yet with a real PDF reader — see "Not done"); the
dummy CSV bank file round-trips against its fixture (verified).

### Phase 6 — TDS and regime choice — ✅ backend built 2026-11-02

**Built:**
- **Migration** `20261102090000_tds_and_regime_choice` (written offline,
  **not yet applied** — same caveat as Phases 1–5): `TaxSlab`,
  `TaxRegimeConfig` (per tenant/FY/regime, grants + RLS like every other
  table), `TdsRegimeChoice` (per tenant/employee/FY, FK to `employees`).
- **`financial-year.util.ts`**: `financialYear(period)` (April→March FY,
  `"YYYY-MM"` → `"YYYY-YY"`), `financialYearPeriods()`,
  `monthsRemainingInFinancialYear()`, `elapsedPeriodsInFinancialYear()` —
  pure, independently tested across the calendar-year boundary.
- **`tds-calculator.ts`**: `projectAnnualTax()` (progressive slab tax +
  cess + the 87A rebate) and `computeMonthlyTds()` — the annual projection
  smoothed over the months remaining in the FY, crediting TDS already
  deducted this FY: `monthly = (projectedAnnualTax − alreadyDeducted) ÷
  remainingMonths`, floored at 0 (never a refund through payroll). The
  annual projection itself is `elapsedGross + currentMonthGross ×
  remainingMonths` — a salary revision changes `currentMonthGross` and so
  re-projects correctly from the next run, satisfying the phase's exit
  criterion.
- **`declaration-provider.ts`**: `DeclarationProvider` interface +
  `NullDeclarationProvider` (always 0 exemptions), bound via a
  `DECLARATION_PROVIDER` DI token in `payroll.module.ts` — swap the binding
  when module 08's declaration workflow exists; nothing else changes.
- **`TdsService`**: `getEmployeeRegime`/`setEmployeeRegime` (own for
  Employee, any for HR/Admin; an HR/Admin override of someone else's
  regime is audited as `payroll.tds_regime_overridden` — decision 8;
  self-service is not), and `buildContext(employeeIds, period)` — one
  batched DB round trip each for regime choices, tax config, and
  elapsed-FY gross/TDS sums, mirroring the existing `ptSlabsByState`/
  `lopMap` batching pattern.
- **`PayrollConfigService`** extended with `getTaxConfig(financialYear)`
  (lazy per-FY seed, same posture as `getSettings()`),
  `replaceTaxSlabs()`, `updateTaxRegimeConfig()` — same shape as the
  existing PT-slab config surface.
- **`PayrollRunService` wiring**: `computeLineItem()` now runs
  `calculatePayroll()` once provisionally (tds=0) to get `grossEarnings`
  — gross doesn't depend on TDS — computes the monthly TDS from that
  figure via `computeMonthlyTds()`, then re-runs `calculatePayroll()` with
  the real `tds` only if it's non-zero (so the existing negative-net-pay
  guard also covers TDS pushing a line item negative). `assembleLineItems`
  and `recalculate` both batch-fetch `TdsService.buildContext()` once per
  run, same as every other per-run batched input.
- Routes: `GET/PUT /payroll/config/tax-slabs/:regime`,
  `PATCH /payroll/config/tax-regime-config/:regime`,
  `GET /payroll/config/tax-config`, `GET/PUT /payroll/tds-regime/:employeeId`
  (row scoping in the service, same pattern as `/payslips/:employeeId`).

**Deviations:**
- **Default tax slabs/config are seeded, not left empty** (unlike the
  original spec's silence on this) — same UNVERIFIED-rates posture as
  `DEFAULT_PT_SLABS` (decision 11): a reasonable FY2024-25-shaped default
  per regime so a tenant isn't blocked on Company Admin data entry before
  TDS can run at all; a Company Admin edits them per FY.
- **No re-projection "trigger" mechanism** — re-projection is just a
  property of running `computeMonthlyTds()` fresh on every `createDraft`/
  `recalculate` call, which already happens on a regime change or salary
  revision because those change the inputs (`TdsService.buildContext()`'s
  regime lookup, or `currentMonthGross`). Nothing additional was built to
  "detect" these events — the formula is naturally reactive to them.
- **`Employee.taxRegime` (module 03) is left untouched, not reused** —
  see decision 24.

**Tests:** 46 new unit tests — `financial-year.util.spec.ts` (8),
`tds-calculator.spec.ts` (12, including hand-computed slab/rebate/cess
fixtures and a mid-year revision re-projection case), `tds.service.spec.ts`
(12, regime get/set scoping + audit + `buildContext` batching), plus 12
more in `payroll-config.service.spec.ts` (tax-slab validation + config
CRUD) and 2 more in `payroll-run.service.spec.ts` (TDS folded into
`tdsDeducted`/`netPay`, and the zero-TDS no-op path). Full repo suite
(`npx jest` from `apps/api`): 36 suites, 513 tests, all green; `tsc -p .
--noEmit`, lint, and `npm run build` all clean.
**Not done:** the migration is unapplied (same standing gap as every prior
phase); no RLS/e2e cross-tenant test; the declared-exemptions figure is
always 0 until module 08 exists, so every OLD-regime projection in
practice today has no 80C/80D deduction applied — documented, not a bug.

### Phase 7 — Re-process, revisions, arrears — ✅ backend built 2026-11-09

**Built:**
- **Re-process guardrails were already built in Phase 3** and needed no
  new code: `createDraft` already rejects `isReprocess` without a reason
  (`BadRequestException`) and already 409s a second non-reprocess run for
  a period that already has one (the partial unique index on
  `(tenant_id, period) WHERE is_reprocess = false`, INV-1). A re-process
  run goes through the exact same two-person approval and payroll gate as
  every other run — nothing re-process-specific to add there.
- **Migration** `20261109090000_revisions_and_arrears` (written offline,
  **not yet applied** — same caveat as Phases 1–6): `SalaryRevision`
  (append-only — no `UPDATE`/`DELETE` grant) and `ArrearsLineItem`
  (`PENDING → FOLDED`, FK to both the revision and the employee).
- **`SalaryStructureService.revise()`** (`POST
  .../structures/:employeeId/revise`): supersedes the active structure
  (`ACTIVE → SUPERSEDED`) and creates the new one + a `SalaryRevision` row
  in one transaction (ordered the same way as every other
  supersede-then-create in this module, so the "one ACTIVE structure per
  employee" partial unique index never trips). If `effectiveDate` falls at
  or before a period the employee already has a `PROCESSED`/`DISBURSED`
  (non-reprocess) line item for, generates one `ArrearsLineItem` per such
  period: `calculatePayroll()` run twice — once with the OLD structure,
  once with the NEW — using the SAME historical `workingDays`/
  `payableDays`/month frozen on the original line item and CURRENT EPF/
  ESI/PT config on both sides, so the delta isolates exactly the
  structure change (see decision 25 for what's deliberately excluded).
- **`PayrollRunService.assembleLineItems()`** now also batch-fetches every
  `PENDING` `ArrearsLineItem` for the run's employees (same pattern as
  `ptSlabsByState`/`tdsContexts`) and, for each employee with one, folds
  the sum straight into that new line item's `adHocAdjustments` (type
  `ARREARS`) and `netPay`, then marks the arrears row(s) `FOLDED` with
  `foldedIntoRunId` set — all inside `createDraft`'s existing transaction.
  "The next open run" (per the original bullet) means literally the next
  `createDraft` call for *any* period, not a matching one.
- Route: `POST /payroll/structures/:employeeId/revise` (HR/Admin only).

**Deviations:**
- **TDS, overtime, and ad-hoc adjustments are deliberately excluded from
  the arrears delta on both sides** (decision 25) — since they're
  identical inputs on the old-structure and new-structure recomputation,
  they'd cancel out anyway; excluding them outright avoids re-projecting
  historical TDS (a much bigger problem — see "Still open") for no
  benefit.
- **Arrears fold only on `createDraft`, not on `recalculate`** — once a
  run already exists, HR can add arrears manually via the existing
  ad-hoc-adjustment endpoint, the same pattern Phase 4's decision 21 uses
  for overtime approved after a run was already created. Avoids a merge
  conflict with `recalculate`'s existing "preserve manual ad-hoc
  adjustments" behaviour.
- **Arrears become an ordinary `adHocAdjustments` entry once folded** — a
  later `PATCH .../line-items/:employeeId` call (which fully replaces the
  array) can silently drop them, same pre-existing replace-semantics as
  any other ad-hoc entry (not a new risk Phase 7 introduces).

**Tests:** 15 new unit tests — 5 in `salary-structure.service.spec.ts`
(`revise()`: no-arrears case, hand-verified multi-period delta, 404
without an active structure, audit without compensation amounts,
Basic-floor validation reused) plus 3 in `payroll-run.service.spec.ts`
(arrears folded into `adHocAdjustments`/`netPay` and marked `FOLDED`;
multiple arrears summed including a negative one; no-op when nothing's
pending) and 1 authorization-matrix line, plus regression coverage
confirming the Phase 3 re-process guardrails still hold unchanged. Full
repo suite (`npx jest` from `apps/api`): 36 suites, 521 tests, all green;
`tsc -p . --noEmit`, lint, and `npm run build` all clean.
**Not done:** the migration is unapplied (same standing gap as every
prior phase); no RLS/e2e cross-tenant test; a re-processed period's
interaction with a still-`PENDING` arrears row for that period is
untested (re-process itself works, but nothing yet verifies an arrears
row generated against the *original* run behaves sensibly once a
re-process run supersedes it).

### Phase 8 — Full & Final settlement — ✅ backend built 2026-11-16

**Built:**
- **Migration** `20261116090000_full_and_final` (written offline, **not
  yet applied** — same caveat as Phases 1–7): `FullAndFinalSettlement`
  (`DRAFT → APPROVED → PAID`, `@unique` on `employeeId` — at most one
  ever, since `SEPARATED` is a terminal lifecycle state); `leave_types
  .is_encashable` (module 04, new column — same cross-module pattern as
  `Employee.workState` in Phase 1); five new `payroll_settings` columns
  (`leaveEncashmentDivisor`/`leaveEncashmentComponents`/
  `gratuityEligibilityYears`/`gratuityDaysPerYear`/`gratuityMonthDivisor`
  — decisions 17 and 10, now actually built, not just agreed).
- **The Leave balance-read contract (the Phase 7 "still open" item) is now
  defined:** `LeaveService.getEncashableBalance(employeeId, asOfDate)` —
  sums `accrued - used` across every `isEncashable` leave type for the FY
  `asOfDate` falls in (resolved via Leave's own `fyStartMonth`, same as
  `getBalances()`). Payroll calls this and never reads `leave_balances`
  directly, the same contract shape as Attendance's `getLopDays()`.
- **`full-and-final-calculator.ts`** (pure, no DB): `completedYearsOfService()`
  (calendar-anniversary based, never negative), `calculateGratuity()`
  (0 below `gratuityEligibilityYears`, else `daysPerYear / monthDivisor x
  lastDrawnBasic x completedYears`), `calculateLeaveEncashment()`
  (`componentsMonthlyTotal / divisor x encashableDays`).
- **`FullAndFinalService.generate()`**: requires the employee be
  `SEPARATED` with a `lastWorkingDate` and `dateOfJoining` on file and an
  active salary structure (404/409/400 otherwise — fails loudly rather
  than guessing); computes the separation month's unpaid salary by
  running the existing `calculatePayroll()` with `employedTo =
  lastWorkingDate` (the same mid-month-exit path `computePayableDays()`
  already supported, just never exercised until now since Phase 3
  excludes `SEPARATED` employees from every regular run); computes leave
  encashment and gratuity via the new calculator; stores a `DRAFT` row
  with a `calculationSnapshot` of the unpaid-salary breakdown. Also
  `get()` (own/HR-Admin/reduced-for-Auditor), `updateAdvance()`
  (`DRAFT`-only, recomputes `netSettlement`), `approve()`
  (`DRAFT → APPROVED`, one approver — decision 26), `markPaid()`
  (`APPROVED → PAID`).
- Routes: `POST/GET/PATCH /payroll/fnf/:employeeId`,
  `POST /payroll/fnf/:employeeId/approve`,
  `POST /payroll/fnf/:employeeId/mark-paid`.

**Deviations:**
- **One approval, not INV-1's two-person rule** (decision 26) — decision
  7 says "its own approval" (singular), and `FullAndFinalSettlement` is
  explicitly not a `PayrollRun`, so INV-1's specific two-person language
  doesn't carry over automatically. Still gated by the same payroll gate
  (INV-4) as every other money-moving action in this module.
- **The spec's `generatedRunId?` field (for "folded into a regular run")
  was dropped** — decision 7 already resolved that TBD ("standalone...
  not folded into a monthly run"), so there was nothing to link.
- **No TDS on the Full & Final settlement.** Real gratuity/leave-
  encashment exemption limits and TDS treatment on a final settlement
  are genuinely complex and explicitly out of this phase's stated scope
  (unpaid salary, leave encashment, gratuity, advance recovery only) —
  flagged for the Phase 9 domain review, same posture as every other
  UNVERIFIED statutory figure in this module.
- **`unpaidSalaryAmount` (a scalar column) isn't named in the original
  spec's field list** (`unpaidSalaryDays` was) — added since
  `netSettlement` needs an actual rupee figure, not just a day count; the
  full EPF/ESI/PT breakdown lives in `calculationSnapshot`, not as extra
  scalar columns, to keep the table to the spec's named shape.
- **PT/EPF/ESI deductions on the final month use CURRENT config, not
  whatever was in force historically** — same simplification Phase 7's
  arrears recompute already uses for the identical reason (there's no
  "historical settings" concept in this module).

**Tests:** 32 new unit tests — `full-and-final-calculator.spec.ts` (9,
hand-computed gratuity/encashment/years-of-service fixtures),
`full-and-final.service.spec.ts` (20: the full generate/get/
updateAdvance/approve/markPaid lifecycle, every guard clause, Auditor's
reduced view), 3 in `leave.service.spec.ts` for
`getEncashableBalance()`, plus an authorization-matrix pair. Full repo
suite (`npx jest` from `apps/api`): 38 suites, 555 tests, all green;
`tsc -p . --noEmit`, lint, and `npm run build` all clean.
**Not done:** the migration is unapplied (same standing gap as every
prior phase); no RLS/e2e cross-tenant test; a re-`SEPARATED` (rehire)
scenario isn't modelled — `employeeId` is `@unique`, so a second
settlement for the same employee is impossible even if the lifecycle
machine ever allowed a path back to `SEPARATED`.
**Exit:** triggered only from the `SEPARATED` lifecycle state (module
03) — generation is rejected for any other state — and a separated
employee gets a correct, approved statement (hand-verified fixtures for
every component: unpaid salary, encashment, gratuity).

### Phase 9 — Hardening and sign-off — 🟡 partially built 2026-11-23

**Built:**
- **Frontend: the full role × tab matrix**, `apps/web/src/pages/payroll/`
  — `index.tsx` (tabbed shell: My Pay / Structures / Payroll Run /
  Settings, tabs role-gated via new `isPayrollAdmin`/`canViewPayrollModule`
  helpers in `lib/roles.ts`), `structure-editor.tsx` (create/edit/revise,
  including the Phase 7 backdated-revision flow and the Phase 6 HR-override
  tax-regime control), `fnf.tsx` (generate/view/adjust-advance/approve/
  mark-paid), and per-tab components (`tabs/my-pay.tsx`,
  `tabs/structures.tsx`, `tabs/run.tsx`, `tabs/settings.tsx`) plus shared
  pieces (`component-builder.tsx`, `pt-slab-editor.tsx`,
  `tax-slab-editor.tsx`, `adjustments-dialog.tsx`, `money.tsx`,
  `status-badge.tsx`). New `apps/web/src/lib/payroll/{client,types}.ts` —
  real API calls only, no mock store (unlike Leave's client, Payroll's
  backend was already fully live when this was built). Routes wired into
  `App.tsx` (`/payroll`, `/payroll/structures/:employeeId`,
  `/payroll/fnf/:employeeId`) and a new sidebar nav item in
  `app-layout.tsx`. `tsc -b`, `oxlint`, and `vite build` all clean;
  `npm run dev` boots and serves the page. **Not verified against a live
  backend in a browser** — no Firebase config or shared Supabase
  credentials exist in the environment this was built in (see below);
  flagged per `CLAUDE.md`'s rule to say so explicitly rather than claim a
  check that didn't happen.
- **Fixed a real Phase 8 gap found while wiring the Settings tab:**
  `UpdatePayrollSettingsDto` never actually gained the five Full & Final
  formula fields (`leaveEncashmentDivisor`/`leaveEncashmentComponents`/
  `gratuityEligibilityYears`/`gratuityDaysPerYear`/`gratuityMonthDivisor`)
  added to the Prisma model and seeded with defaults — the global
  `ValidationPipe` runs with `forbidNonWhitelisted: true`, so a `PATCH
  .../config/settings` carrying them would have 400'd outright. Added the
  five decorators; manually verified with `class-validator`'s `validate()`
  against the exact pipe options (`whitelist: true,
  forbidNonWhitelisted: true`) that the fields now pass clean.
- **Static RLS/grant audit of all 8 Payroll migrations** (the part of the
  P0 cross-tenant gate that doesn't need a live database): every new
  table across every phase has `tenant_id UUID NOT NULL`, an index on it,
  `ENABLE`/`FORCE ROW LEVEL SECURITY`, and a `tenant_isolation` policy;
  every `GRANT` matches exactly what the service layer needs (e.g.
  `payroll_run_approvals`/`salary_revisions` are append-only — `SELECT,
  INSERT` only, no `UPDATE`/`DELETE`). The two migrations with zero RLS
  statements (`..._payroll_calc_engine`, `..._payslips_and_bank_files`)
  checked out as correct, not missed — both are column-only `ALTER
  TABLE`s riding an already-RLS'd table, no `CREATE TABLE`.

**Not done (environment-blocked, not skipped by choice):**
- **Adversarial cross-tenant e2e tests and the ~500/~5,000-employee
  performance run** — both need a live Postgres with all 8 migrations
  applied. This environment has no Docker daemon reachable (`docker
  info` fails: no `docker.sock`) and no credentials for the local
  Postgres 14 instance that is running, nor for the team's shared
  Supabase instance (`apps/api/.env` doesn't exist, only
  `.env.example`). Same standing gap every prior phase already flagged;
  Phase 9 doesn't close it, it just makes it the one remaining blocker.
- **Independent domain review of statutory rates/slabs/fixtures/rounding**
  (decision 11) — this needs a human payroll/tax domain expert, not a
  self-review. The self-conducted RLS/grant audit above is real
  hardening, but it is not that review.
- Because of the two items above, **status is not moved to ✅ 100%** —
  this file's header reflects the actual remaining gate, not a declared
  sign-off.
- Razorpay (FR-PAY-017) stays v1.1, as planned.

### Compliance unlock points

- After **Phase 3**: module 08 EPF (ECR, Forms 2/5/10/12A) and ESI work.
- After **Phase 6**: module 08 Form 24Q / Form 16 work.

---

## 10. Dependencies

**Upstream:**
- Module 03 Employee Master — **new `Employee.workState` field** (Phase 1
  migration), `Employee.ctcAnnual` (headline reference
  figure this module's `SalaryStructure` must reconcile with), bank
  account fields (for the disbursement file), `dateOfBirth` (payslip
  password), lifecycle state (`SEPARATED` triggers FnF).
- Module 05 Attendance — `getLopDays(employeeId, month)` /
  `GET /attendance/lop-days` — **already live**, the one upstream
  contract already satisfied.
- Module 09 Documents / `StorageService` — **now exist on `dev`**; payslip
  PDFs are stored through them.
- Module 05 Attendance (additional work) — `getLopDaysBatch(month)`,
  LOP extended to approved unpaid leave, and the overtime claim workflow +
  `getApprovedOvertime()` (Phases 3–4).
- Module 04 Leave — encashable leave balance for Full & Final
  settlements; `LeaveType.isCompOff`/paid-leave flags are informational
  only today per that module's spec, not yet payroll-linked — confirm
  the exact balance-read contract before building §5.3.
- Module 08 Statutory Compliance — `InvestmentDeclaration` (verified
  amounts) for TDS projection. **Circular-looking but not actually
  circular:** Payroll reads Compliance's declaration data; Compliance
  reads Payroll's processed-run data. Different data, one direction each
  — not a cyclic dependency, but sequence carefully (see §9 item 3).

**Downstream (consumers of Payroll):**
- Module 08 Statutory Compliance — **every** EPF/ESI/Income-Tax feature
  is blocked on this module exposing a processed, immutable run (see that
  module's §0).
- Module 11 Reports & Analytics — payroll cost reporting (not built).
- Module 12 Audit Log — run-state transitions, structure revisions (not
  built).
- Module 10 Notifications — payslip-ready, run-approval-needed,
  regime-choice-deadline nudges. **Module now exists on `dev`** — use its
  dispatcher rather than sending mail directly.

---

## 11. Acceptance criteria / test checklist (target)

- [ ] Creating a second `PayrollRun` for a `(tenant, period)` that already
      has a `PROCESSED`/`DISBURSED` run, without `isReprocess`, is rejected.
- [ ] No run can reach `APPROVED` with fewer than two distinct approvers;
      the same account approving twice counts once.
- [ ] Run creation and approval are rejected while the tenant has fewer
      than two active Company Admins.
- [ ] A `COMP_OFF` overtime claim creates a Leave comp-off credit and adds
      nothing to the payroll run; a `CASH` claim adds an earning line.
- [ ] No `PayrollLineItem` field changes after its run reaches
      `PROCESSED` — attempt an update in a test and assert it's rejected
      or impossible by construction (e.g. no update method exists).
- [ ] A `SalaryStructure` with Basic < the configured floor (default 50%
      of CTC) is rejected at save time, not just flagged at calculation.
- [ ] EPF wages are correctly capped at the ceiling unless the employee
      has opted above it.
- [ ] `getLopDays()`'s result for a period matches what's actually
      imported into that period's draft run line items.
- [ ] A payslip PDF opens only with the employee's DOB in `DDMMYYYY`
      format as the password.
- [ ] The generated bank file, for a known-good test run, matches a real
      sample layout for at least one of HDFC/ICICI/SBI/Axis structurally
      (not just "looks plausible").
- [ ] A backdated salary revision produces arrears line items that sum
      correctly against the delta between old and new structure for each
      affected period.
- [ ] Cross-tenant: Tenant A cannot read/act on Tenant B's salary
      structures, runs, or payslips (RLS).

---

## 12. Decisions and open questions

### Decisions recorded 2026-09-24 (Phase 0)

| # | Decision |
|---|---|
| 1 | **Dual approval on every run** (two-person rule): any two distinct HR Manager/Company Admin users approve before a run is processed; the preparer may be one of them. Tenants may onboard with one Company Admin, but Payroll stays blocked until a second active Company Admin exists (INV-4). A re-process additionally needs an explicit override and reason. |
| 2 | **Missing DOB:** fail loudly. The employee is excluded from payslip generation and listed to HR; never fall back to an unprotected PDF. |
| 3 | **LOP definition:** `ABSENT` days + approved unpaid-leave days, whole days only in V1 (half-days deferred). Requires a small Attendance/Leave change (Phase 3). |
| 4 | **Proration basis:** working days only. Weekly offs (`TenantSettings.weeklyOffDays`) and declared non-optional holidays are not working days. LOP deduction = monthly pay × LOP days ÷ working days. |
| 5 | **Professional Tax state:** a per-employee `workState` (`IndianState` enum, all states and UTs), not tenant-level, since a tenant can have offices in several states and hybrid staff. Hybrid/remote staff use the state of the office they're attached to; HR can override. Required before an employee is included in a run. |
| 6 | **Overtime in V1:** Attendance tracks overtime hours; the employee claims a month's total and chooses `CASH` or `COMP_OFF`; Line Manager then HR approve. Only fully-approved `CASH` hours are paid (tenant multiplier, default 2×); `COMP_OFF` becomes a Leave comp-off credit. Workflow lives in Attendance; Payroll reads `getApprovedOvertime()`. |
| 13 | **No direct LOP offset with overtime.** An absence is covered only by comp-off leave through the normal Leave flow, not by netting overtime inside Payroll. |
| 7 | **Full & Final:** standalone off-cycle settlement with its own approval, not folded into a monthly run. |
| 8 | **Tax regime:** default NEW; employee chooses per FY; HR can move an employee to OLD on request (audited). |
| 9 | **Auditor read depth:** run summaries and approval trail only, no per-employee compensation drill-down. Revisit if tenants ask for more. |
| 10 | **Gratuity:** statutory formula (15/26 × last drawn Basic + DA × completed years, 5-year eligibility) as tenant-editable config. |
| 11 | **Domain review:** independent review of statutory rates, slabs and fixtures happens after the full module is built (Phase 9), not per phase. |
| 12 | **Bank files:** dummy generic-CSV generator first behind `BankFileGenerator`; real HDFC/ICICI/SBI/Axis formats added when a sample is supplied. Bank sandboxes are mostly API-banking, not bulk file formats (unverified). |

### Decisions recorded 2026-10-05

| # | Decision |
|---|---|
| 14 | **Working days are per-employee, not just per-tenant.** `Employee.weeklyOffDaysOverride: Int[]` (empty = falls back to the tenant's `weeklyOffDays`; Prisma can't express an optional list) — a fixed set of weekly off-days per employee, for staff whose off days differ from the tenant default (e.g. hospital shift staff). This is a static override, not a rotating per-week schedule — a true rotation needs a `ShiftAssignment` table, deliberately not built now. **Built in Phase 2** (migration `20261005090000_payroll_calc_engine`; HR-settable via `PATCH /employees/:id`, not the Employee self-edit whitelist). |
| 15 | **Half-day leave is always full pay, never LOP.** `LeaveRequest.halfDay = true` and `isLop = true` together are rejected at request-creation time. This means every fractional (`halfDay`) leave day is inherently paid, so Phase 3's extension of `getLopDays()` to include approved-unpaid-leave days only ever adds whole-day amounts — Payroll's LOP formula stays whole-day-only (decision 3 unchanged); no fractional-LOP math needed in the calculator. |
| 16 | **No `DA` component type for now.** Current tenants are dummy/test tenants with no real DA usage, so EPF/ESI wages are computed on Basic alone in V1. Additive later: a `DA` enum value next to `BASIC`, picked up the same way, if a real tenant needs it — not a rework. |
| 17 | **Leave encashment is tenant-configurable.** `LeaveType.isEncashable: boolean` (HR sets per type, same pattern as `isCompOff`); `PayrollSettings.leaveEncashmentDivisor` (default 26) and `leaveEncashmentComponents` (default: Basic) drive the per-day rate. Which types and which components count is a Phase 8 config, not hardcoded. |

Also decided by default (raise an objection to change): `pdfkit` for the
password-protected PDF; monthly cycle only; EPF split (EPF/EPS/admin/EDLI)
modelled in the engine from the start because module 08's ECR needs it.

### Decisions recorded 2026-10-12 (Phase 3)

| # | Decision |
|---|---|
| 18 | **Pending regularizations warn, not block.** The Phase 3 bullet left "block or warn" open; a run can still be created with `PENDING` regularizations for the period, surfaced as a non-blocking `PENDING_REGULARIZATIONS` exception rather than a hard stop, since blocking entirely could leave HR unable to run payroll over one slow approver. Revisit if this proves too permissive in practice. |
| 19 | **No BullMQ queue for draft assembly in V1.** Synchronous, inside the `POST /runs` request. Revisit at the Phase 9 performance test if it proves too slow at scale — see the Phase 3 deviations note. |
| 20 | **`SEPARATED`/`PRE_JOINING` employees are excluded from every regular run outright**, not listed as an exception — a separated employee's final pay belongs to Phase 8's Full & Final (decision 7), never a regular run. |

### Decisions recorded 2026-10-19 (Phase 4)

| # | Decision |
|---|---|
| 21 | **No automated cutoff roll-over for unapproved overtime.** A claim not `APPROVED` by the time a period's run is created is simply absent from it (0 hours, no exception raised) — not shifted onto the next month's claim. Once approved later, HR folds the pay into whichever run is still open via the existing ad-hoc-adjustment endpoint (Phase 3), rather than the engine doing it automatically. |

### Decisions recorded 2026-10-26 (Phase 5)

| # | Decision |
|---|---|
| 22 | **No BullMQ worker for payslip generation.** Synchronous, inside `process()`, extending Phase 3's decision 19 (no queue for draft assembly either) to the same operation for the same reason — small current tenants, avoid speculative async infrastructure. Revisit both together at the Phase 9 performance test. |
| 23 | **Bank files are generated on demand, never stored.** Dropped the spec's `PayrollLineItem.bankFileBatchId` field — regenerating a CSV from already-immutable line items on every `GET` is simpler than caching one, given only a dummy generator exists so far. |

### Decisions recorded 2026-11-02 (Phase 6)

| # | Decision |
|---|---|
| 24 | **`Employee.taxRegime` (module 03) is left alone; `TdsRegimeChoice` is the only thing Payroll's TDS projection reads.** The two were never going to disagree in practice — nothing currently writes `Employee.taxRegime` except the employee-record PATCH, which has no relationship to a specific FY — but resolving "reuse vs. replace" by touching module 03's field would be out of this module's surgical scope. `TdsRegimeChoice` is per-FY and audit-tracked (`setByUserId`), which `Employee.taxRegime` is not; if the two fields ever need to agree, that's module 03's migration to make, not Payroll silently reading a field it doesn't own. |

### Decisions recorded 2026-11-09 (Phase 7)

| # | Decision |
|---|---|
| 25 | **Arrears recompute only the structure-driven components (gross, EPF, ESI, PT), on both the old-structure and new-structure side, with everything else held at the same value so it cancels out of the delta.** TDS, overtime pay, and ad-hoc adjustments from the original period are excluded entirely rather than re-projected or re-applied — re-projecting historical TDS in particular would mean re-deriving a financial year's worth of already-deducted figures retroactively, a much larger problem than Phase 7's stated scope. The arrears amount is purely "what the new structure would have paid, minus what the old structure would have paid," for the same historical working/payable days. |

### Decisions recorded 2026-11-16 (Phase 8)

| # | Decision |
|---|---|
| 26 | **Full & Final needs one approval, not INV-1's two-person rule.** Decision 7 says "its own approval" (singular); `FullAndFinalSettlement` is explicitly never a `PayrollRun`, so INV-1's specific two-person language was written for runs, not assumed to extend here. Still blocked by the same payroll gate (INV-4) as every other money-moving Payroll action — only the approval count differs. |

### Decisions recorded 2026-11-23 (Phase 9)

| # | Decision |
|---|---|
| 27 | **The Payroll frontend client (`apps/web/src/lib/payroll/client.ts`) is real-API-only, with no mock fixture store** — unlike `lib/leave/client.ts`, which still carries one from before Leave's backend existed (`VITE_LEAVE_MOCK`). Payroll's backend was already fully built through Phase 8 by the time its frontend was started, so there was never a "backend doesn't exist yet" period to build a mock for. |
| 28 | **No `GET /payroll/runs` list endpoint exists, so the Run tab keeps a small client-side-only "recently opened" memory in `localStorage`** (`rememberRun`/`recentRuns` in the client) rather than inventing a server list. Purely a UX convenience, never read as a source of truth; HR can also open any run by pasting its id. |

### Still open

- **Risk from decision 11, still unresolved after Phase 9:** phases 2–8
  build on rates and slabs nobody independent has verified. Phase 9's
  self-conducted static RLS/grant audit is real hardening, but it is not
  the independent statutory-rates review decision 11 calls for — that
  still needs a human payroll/tax domain expert. Mitigation unchanged:
  every rate/slab cites its source in a comment and lives in config, so a
  correction is a data change, not a code change.
- **No adversarial cross-tenant e2e suite and no performance run at
  ~500/~5,000 employees** — both need a live Postgres with all 8
  migrations applied; this environment has neither a reachable Docker
  daemon nor credentials for the local Postgres instance it does have, nor
  for the team's shared Supabase. The static RLS/grant audit (every new
  table has `tenant_id NOT NULL`, RLS forced, a `tenant_isolation` policy,
  and grants matching exactly what the service layer needs) is the
  closest substitute available without one, but it is not the same
  guarantee as an actual cross-tenant request hitting a real second
  tenant's data and failing.
- **The Payroll frontend has not been exercised against a live backend in
  a browser** — `tsc -b`/`oxlint`/`vite build` all pass and the dev server
  boots, but no Firebase project or database credentials exist in this
  environment to actually log in and click through the screens. Needs a
  manual pass once those exist.
- **Rotational-shift working days (true rotation only):** decision 14 adds
  a per-employee *static* off-day override, which covers "this employee's
  off days differ from the tenant default." A schedule that rotates week
  to week still needs a `ShiftAssignment` table that doesn't exist — out
  of scope until a tenant asks for it.
- **Should a `SUSPENDED` employee be paid in a regular run?** Phase 3
  includes them like any other active employee (decision 20 only excludes
  `SEPARATED`/`PRE_JOINING`) because no spec anywhere says otherwise — this
  is a real company-policy question (unpaid suspension is common), not
  resolved here.
- **Overtime rate basis — built as Basic ÷ (working days × shift hours),
  no domain review yet.** Whether state Shops & Establishment rules should
  change the 2× default (`overtimeMultiplier`) per `workState` isn't
  modelled — today it's one multiplier per tenant, not per state.
- **Source and refresh of tax slabs** — who updates the FY tax slabs and PT
  slabs each year (Company Admin per tenant, or platform-seeded and pushed
  to tenants)?
- **Real bank-file layouts** — none sourced; needed before any real bank
  generator is built.
- **No company name/logo on the payslip** (decision 22's sibling) — the
  `tenants` table has no `hrms_app` grant today; add one (read-only, name
  only) if a real payslip needs the employer's name on it.
- **Comp-off conversion — built as a straight hours ÷ shift-full-day-hours
  fractional credit, no premium and no expiry.** `COMP_OFF` overtime always
  converts at 1× (the `overtimeMultiplier` only applies to `CASH`); the
  resulting fractional day never expires, unlike how some tenants expect
  comp-off to lapse after N days. Still open: whether Leave allows applying
  that credit against a day already marked `ABSENT` (retroactively) — not
  verified against Leave's actual request flow.
- **Payroll gate edge case** — what happens to a run already in `REVIEW`
  if the tenant drops below two Company Admins; proposed: it stays but
  cannot be approved until the count is restored.
- **No declared exemptions until module 08 exists (decision 24's sibling).**
  `NullDeclarationProvider` always returns 0, so every OLD-regime TDS
  projection today has no 80C/80D deduction applied — overstates TDS for
  any OLD-regime employee with real declarations on file, until the real
  `DeclarationProvider` is wired in.
  **A re-process's interaction with TDS already deducted is unverified.**
  `TdsService.buildContext()`'s elapsed-gross/already-deducted sum
  deliberately excludes `isReprocess` runs (`isReprocess: false`), so a
  re-processed month's revised TDS isn't currently double-counted or
  dropped from the next month's projection — but this hasn't been
  exercised against Phase 7's actual re-process flow yet, since that phase
  isn't built.
- **No independent review of the TDS slabs/rebate/cess figures yet**
  (same Phase 9 deferral as decision 11, PT slabs) — the seeded
  FY2024-25-shaped defaults in `DEFAULT_TAX_SLABS`/
  `DEFAULT_TAX_REGIME_CONFIG` are a reasonable placeholder, not a verified
  statutory figure for any specific FY.
- **Re-process vs. a still-`PENDING` arrears row against the period being
  re-processed is unverified** (decision 25's sibling) — if a revision
  generated arrears against an original run's period and that period is
  later re-processed, the arrears row still points at the now-superseded
  `originalRunId`; nothing currently reconciles the two. Narrow enough
  that it hasn't been exercised, but worth a dedicated test before this
  combination is relied on in practice.
- **`SalaryStructureService.update()` is not server-blocked once a run
  has used the structure, even though Phase 7 adds `revise()` as the
  "correct" path for that case.** This isn't a data-safety bug — every
  `PayrollLineItem` stores a full JSON snapshot, not a live FK, so
  historical runs stay correct regardless of later structure edits — but
  an in-place `update()` after a run exists silently skips arrears
  generation, where `revise()` wouldn't. Whether to add a hard block (and
  force `revise()`) or leave it as an HR judgment call (a same-period
  typo fix vs. a real raise) is a product decision, not resolved here.
- **No TDS, and no gratuity/leave-encashment exemption limits, on Full &
  Final** (decision 26's sibling) — real FnF settlements usually have
  both; explicitly out of Phase 8's stated scope (unpaid salary, leave
  encashment, gratuity, advance recovery only), flagged for the Phase 9
  domain review alongside every other UNVERIFIED statutory figure.
- **A rehire (re-`SEPARATED`) scenario isn't modelled.** `employeeId` is
  `@unique` on `FullAndFinalSettlement`, so a second settlement for the
  same employee is impossible even if the lifecycle machine ever allowed
  a path back to `SEPARATED` — not a concern today since no such path
  exists, but worth revisiting if one ever gets added.
