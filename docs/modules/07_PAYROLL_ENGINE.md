# 07 — Payroll Engine — Module Source of Truth

> **This file is the authoritative, detailed spec for further development of
> this module.** `docs/MODULE_SPECS.md` §7 is the one-page summary; there is
> no UI build prompt yet (`docs/ui-build-prompts/07-payroll-engine.md` is not
> written — add it when this module is picked up for implementation).
>
> **Status:** 🔴 not started. **No code exists** at the target location
> (`apps/api/src/payroll`). This entire document describes the build
> target, not current behaviour — there is no "today" to describe.
> **Highest-effort, highest-risk module — protect its time budget over
> breadth elsewhere** (`CLAUDE.md`).
> **Progress:** 0% (see `docs/MODULE_SPECS.md` status table — keep in sync).
> **Code:** none yet. Target: `apps/api/src/payroll`,
> `apps/web/src/pages/payroll`.
> **Related:** `docs/MODULE_SPECS.md` §7 · module `03_EMPLOYEE_MASTER.md`
> (`ctcAnnual`, bank fields, `dateOfBirth` already on `Employee`) · module
> `05_ATTENDANCE.md` (`getLopDays(employeeId, month)` / `GET
> /attendance/lop-days` — **already live**, the one upstream contract this
> module needs that already exists) · module `08_STATUTORY_COMPLIANCE.md`
> (hard downstream dependent — nothing in that module can build until this
> one exposes a processed-run contract) · `docs/TENANT_CONFIGURATION.md`
> (`PAYROLL` is already a recognized Layer-1 plan-entitlement module name;
> `payrollCutoffDay` already exists on `TenantSettings`).
> **Last synced to code:** 2026-09-24 (spec written, Phase 0 decisions recorded in §12,
> phased plan in §9; no code to sync to).

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

**`SalaryRevision`** — the append-only history feature 4 requires.
`employeeId` · `previousStructureId` · `newStructureId` · `effectiveDate`
· `reason` · `approvedBy` · `createdAt`. Backdated revisions (feature 5)
drive `ArrearsLineItem` generation into the next run, not a rewrite of
past `PayrollLineItem`s (INV-2 forbids that).

**`ProfessionalTaxSlab`** — config table (feature 7). `state` ·
`grossFrom` · `grossTo` · `monthlyAmount`. Admin-editable, seeded with
known-good state defaults at tenant onboarding.

**`PayrollSettings`** — one row per tenant: `epfCeiling` (default 15000) ·
`epfOptAboveCeiling` policy · `minBasicPercent` (default 50) ·
`overtimeEnabled` · `overtimeMultiplier` (default 2.0).

**`TaxSlab`** / **`TaxRegimeConfig`** — config tables for TDS, per
financial year and regime (`OLD`/`NEW`): slab boundaries and rates,
standard deduction, cess, 87A rebate threshold. Seeded with the current FY;
never constants. (Added 2026-09-24 — the original spec covered PT slabs
only.)

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

**`TdsRegimeChoice`** — `employeeId` · `financialYear` · `regime`
(`OLD`/`NEW`) — read by the TDS projection; also the field module 08's
`InvestmentDeclaration.regime` should mirror/reference, not duplicate.

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

**`FullAndFinalSettlement`** — `employeeId` · `separationDate` ·
`unpaidSalaryDays` · `leaveEncashmentAmount` (reads Leave's balance, module
04, does not recompute it) · `gratuityAmount` · `advanceRecoveryAmount` ·
`netSettlement` · `status` · `generatedRunId?` (if folded into a regular
run rather than a standalone off-cycle payment — TBD, §12).

**Not modeled here:** `InvestmentDeclaration` — that belongs to module 08
(already spec'd there); this module only **reads** it for the TDS
projection (feature 8), never owns or writes it.

### 4.3 API surface (target)

| Method | Path | Notes |
|---|---|---|
| `GET`/`POST`/`PATCH` | `/api/payroll/structures/:employeeId` | `@Roles(HR_MANAGER, COMPANY_ADMIN)` write; employee can `GET` own, read-only |
| `POST` | `/api/payroll/structures/:employeeId/revise` | Creates a `SalaryRevision`; backdated → triggers arrears calc into the next open run |
| `GET`/`PATCH` | `/api/payroll/config/pt-slabs` | Professional Tax slab table CRUD |
| `GET`/`PATCH` | `/api/payroll/config/tax-slabs` | Old/new regime slabs, standard deduction, cess, rebate per FY |
| `GET`/`PATCH` | `/api/payroll/config/epf` | EPF ceiling + opt-above-ceiling toggle |
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
| `POST`/`GET` | `/api/payroll/fnf/:employeeId` | Full & Final settlement create/view |

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

### 5.2 Backdated salary revision → arrears

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

### 5.3 Full & Final settlement

1. Employee's lifecycle state moves to `SEPARATED` (module 03).
2. HR opens **Payroll → Full & Final** for that employee → system computes
   unpaid salary days, reads Leave's encashable balance (module 04), the
   configured gratuity formula, and any advance recovery.
3. HR reviews/adjusts → generates the FnF statement + payment, either as
   its own off-cycle disbursement or folded into the next regular run
   (TBD, §12).

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

**`FullAndFinalSettlement.status`:** target set TBD — at minimum
`DRAFT → APPROVED → PAID`, mirroring the run's own lifecycle shape.

---

## 8. Permission matrix (target)

| Capability | Employee | Line Manager | HR Manager / Company Admin | Auditor |
|---|:--:|:--:|:--:|:--:|
| View own salary structure / revision history | own (read-only) | — | ✓ (all) | ✓ (read-only, depth TBD §12) |
| Edit salary structure / revise | — | — | ✓ | — |
| Manage PT slabs / EPF config | — | — | ✓ | — |
| Choose tax regime | own | — | — *(unless HR-on-behalf, TBD §12)* | — |
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

### Phase 1 — Foundation: schema and config

- **Migration:** `SalaryStructure`, `SalaryComponent`, `SalaryRevision`
  (table only), `ProfessionalTaxSlab`, `PayrollSettings`, `TaxSlab`,
  `TaxRegimeConfig`; `Employee.workState` (`IndianState` enum, nullable,
  backfill from `workLocation` where it matches). RLS policies in the same
  migration.
- **Seeding:** defaults at tenant creation (`seedTenantDefaults` +
  `prisma/seed.ts`): EPF ceiling ₹15,000, min-Basic floor 50%, PT slab set,
  current-FY tax slabs. Follow the Shift/AttendanceSettings precedent.
- **Module skeleton** `apps/api/src/payroll` with `EntitlementGuard`.
- **Structure CRUD**, enforcing INV-3 (Basic ≥ floor % of CTC) at save time,
  one `ACTIVE` structure per employee.
- **Formula evaluator:** restricted grammar (numbers, component references,
  `+ − × ÷`, parentheses). No `eval`/`Function`. Unit-tested for injection
  and divide-by-zero.
- **Shared types:** DTOs/enums in `packages/shared-types`.
- **Frontend:** structure editor; Settings tab for PT slabs, EPF and tax
  config; `workState` field on the employee form.
- **Tests:** evaluator, INV-3, one-active-structure, RLS cross-tenant.
- **Exit:** HR can build and save a structure; a sub-50% Basic is rejected;
  config tables are editable and seeded for new tenants.

### Phase 2 — Calculation engine (pure functions, no DB)

- `PayrollCalculator`: input = structure + LOP days + working-day count +
  config; output = full line-item breakdown. Covers earnings, LOP
  deduction (monthly pay × LOP days ÷ working days), mid-month join/exit
  proration over working days, EPF (ceiling, opt-above, EPF/EPS/admin/EDLI
  split), ESI (₹21,000 threshold, employer/employee rates), PT by
  `workState` slab, and a TDS hook returning 0 until Phase 6.
- Working days = calendar days minus tenant `weeklyOffDays` minus declared
  non-optional `Holiday`s. Known limitation: rotational-shift staff with
  per-person offs (no `ShiftAssignment` yet).
- Rounding per statute via `Prisma.Decimal`; each rule cites its source in
  a comment.
- **Tests:** golden-file fixtures with hand-computed expected values —
  EPF at/above/below the ceiling, ESI just under and over ₹21,000, PT slab
  boundaries in at least two states, LOP on a 20- and 23-working-day month,
  mid-month joiner. Property tests: net = gross − deductions; no negative
  net without an explicit flag.
- **Exit:** fixture suite green; every fixture traces to a cited rule.
  Independent domain review is deferred to end-of-module (decision 11) —
  see risk note in §12.

### Phase 3 — Run lifecycle (single run, no re-process)

- **Migration:** `PayrollRun`, `PayrollLineItem`; unique constraint on
  `(tenant, period)` for non-reprocess runs; DB trigger rejecting `UPDATE`/
  `DELETE` on a line item whose run is `PROCESSED`/`DISBURSED`.
- **Attendance change:** add `getLopDaysBatch(month)` returning LOP for all
  employees in one query, and extend LOP = `ABSENT` + approved unpaid-leave
  days (decision 3); tests updated in the same change.
- **Endpoints:** create draft → recalculate → ad-hoc adjustments →
  submit-review → approve → process → disburse (§4.3).
- **Guards on creation:** block or warn when regularization requests for the
  period are still `PENDING` before `payrollCutoffDay`; exclude employees
  with no `workState` or no active structure and list them as exceptions.
- **Payroll gate (INV-4):** run creation and approval return a clear 409 unless the tenant has ≥ 2 active Company Admins.
- **Two-person approval (INV-1):** `PayrollRunApproval` table; `approve` records the caller and only advances the run once two distinct approvers exist.
- **BullMQ `payroll` queue** for draft assembly (same `upsertJobScheduler`/
  processor pattern as Leave and Attendance).
- **Audit + notifications:** each state transition writes an `audit_log` row
  and enqueues a notification through the existing dispatcher.
- **Tests:** full-cycle e2e; double-create concurrency; immutability trigger;
  Auditor/Employee 403s; RLS cross-tenant.
- **Exit:** a clean month runs Draft → Disbursed with correct totals.
- **Compliance unlock:** module 08's ECR and ESI work can start here — it
  needs processed runs, not TDS.

### Phase 4 — Overtime claims (Attendance) + Payroll consumption

- **Attendance owns the workflow:** monthly `OvertimeClaim` (employee claims
  the month's tracked overtime hours) → Line Manager approval → HR approval;
  same two-level pattern as Leave. Must be fully approved before
  `payrollCutoffDay`, otherwise it rolls into the next month.
- **Contract:** `getApprovedOvertime(employeeId, month)` (+ batch variant),
  documented like `getLopDays()`.
- **Payout choice:** the employee picks `CASH` or `COMP_OFF` on the claim.
  `COMP_OFF` converts approved hours to a Leave comp-off credit (hours ÷
  shift full-day hours) by extending Leave's existing comp-off credit —
  define that contract in this phase. There is no direct LOP offset in
  Payroll; comp-off leave covers an absence through the normal Leave flow.
- **Payroll side:** approved `CASH` hours become an earning line at
  hours × hourly rate × tenant multiplier (default 2×); hourly rate =
  (Basic + DA) ÷ (working days × shift hours). Overtime excluded from EPF
  wages, included in ESI wages (verify at domain review).
- **Config:** `PayrollSettings.overtimeMultiplier`, overtime on/off per
  tenant.
- **Tests:** claim state machine, both-approvals-required, cutoff roll-over,
  role/scope 403s, calculator fixtures for overtime.
- **Exit:** approved overtime shows up correctly in a run; unapproved does
  not.

### Phase 5 — Payslips and bank files

- **Payslip worker** on the `payroll` queue: DOB-locked PDF (`pdfkit` user
  password), stored via `StorageService`/Documents. Employees with no DOB are
  excluded and listed to HR (decision 2).
- **Self-service:** employee payslip list + download; HR/Admin can fetch any.
- **`BankFileGenerator` interface** with a dummy generic-CSV implementation
  first; real HDFC/ICICI/SBI/Axis formats added when a sample is supplied
  (decision 12). Each implementation gets a fixture test.
- **Disbursement recording:** `NET_PAID` per employee on `disburse`.
- **Notifications:** payslip-ready.
- **Exit:** a payslip opens only with `DDMMYYYY`; the dummy bank file
  round-trips against its fixture.

### Phase 6 — TDS and regime choice

- `TdsRegimeChoice` (default NEW; employee sets own; HR can move an employee
  to OLD on request, audited — decision 8).
- Annual projection; monthly TDS = (projected tax − already deducted) ÷
  remaining months; slabs, standard deduction, cess and 87A rebate from the
  Phase 1 config tables.
- **`DeclarationProvider` interface** with a null implementation so Payroll
  doesn't wait on module 08; the "no declaration on file" default is
  documented. Swap in the real provider when module 08's declaration
  workflow exists.
- **Re-projection triggers:** regime change, salary revision, verified
  declaration.
- **Exit:** old and new regime both match hand-computed cases across a full
  FY; a mid-year change re-projects correctly.

### Phase 7 — Re-process, revisions, arrears

- Re-process creates a **new** `PayrollRun` with `isReprocess` and a
  mandatory reason, then goes through the same two-person approval as every
  run (INV-1, built in Phase 3) and the payroll gate (INV-4).
- `SalaryRevision` flow; backdated revisions generate `ArrearsLineItem`s
  folded into the next open run — never edits to historical line items.
- **Tests:** re-process without a reason rejected; a second `PROCESSED` run for one period without `isReprocess` rejected; arrears reconcile to the
  old-vs-new delta for every affected period; original run stays untouched.
- **Exit:** re-process guardrails hold; arrears sums reconcile.

### Phase 8 — Full & Final settlement

- `FullAndFinalSettlement`: standalone off-cycle record with its own approval
  (decision 7). Unpaid salary days, leave encashment (reads Leave's balance
  through an agreed contract — define it first, like `getLopDays()`),
  gratuity (statutory formula, tenant-editable config — decision 10), advance
  recovery.
- Triggered from the `SEPARATED` lifecycle state (module 03).
- **Exit:** a separated employee gets a correct, approved statement.

### Phase 9 — Hardening and sign-off

- Adversarial cross-tenant tests for every new table and route (P0 gate, per
  `CLAUDE.md`); Auditor read-only checks; performance run at ~500 and ~5,000
  employees.
- Complete the frontend role × tab matrix; Employee, HR/Admin and Auditor
  views.
- **Independent domain review** of statutory rates, slabs, fixtures and
  rounding (decision 11) — fix findings before sign-off.
- Docs sync, status → ✅ 100%. Razorpay (FR-PAY-017) stays v1.1.

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

Also decided by default (raise an objection to change): `pdfkit` for the
password-protected PDF; monthly cycle only; EPF split (EPF/EPS/admin/EDLI)
modelled in the engine from the start because module 08's ECR needs it.

### Still open

- **Risk from decision 11:** phases 2–8 build on rates and slabs nobody
  independent has verified until Phase 9. Wrong rates would mean rework
  across fixtures and seeds. Mitigation: every rate/slab cites its source in
  a comment and lives in config, so a correction is a data change, not a
  code change.
- **DA component:** EPF wages are Basic + DA, but the component list in
  §4.2 needs an explicit `DA` type; confirm tenants use DA or whether Basic
  alone is the norm.
- **Leave encashment contract:** does module 04 need a new explicit
  "encashable balance" endpoint, or does Payroll read the existing
  balance/ledger? Define it before Phase 8, the way `getLopDays()` was.
- **Half-day LOP** — deferred by decision 3; needs Attendance to record
  half-days as a status first.
- **Rotational-shift working days** — per-person offs need a
  `ShiftAssignment` table that doesn't exist; the tenant-wide working-day
  count may be wrong for those employees.
- **Overtime rate basis** — confirm the (Basic + DA) ÷ (working days ×
  shift hours) hourly rate and whether state Shops & Establishment rules
  change the 2× default.
- **Source and refresh of tax slabs** — who updates the FY tax slabs and PT
  slabs each year (Company Admin per tenant, or platform-seeded and pushed
  to tenants)?
- **Real bank-file layouts** — none sourced; needed before any real bank
  generator is built.
- **Comp-off conversion** — hours ÷ shift full-day hours, rounding (whole
  or half days), any premium (1× vs 1.5×/2×), and expiry of overtime-sourced
  comp-off; and whether Leave already allows applying comp-off to a past
  (already-`ABSENT`) day.
- **Payroll gate edge case** — what happens to a run already in `REVIEW`
  if the tenant drops below two Company Admins; proposed: it stays but
  cannot be approved until the count is restored.
