# 11 — Reports & Analytics — Module Source of Truth

> **This file is the authoritative, detailed spec for further development of
> this module.** `docs/MODULE_SPECS.md` §11 is the one-page summary.
>
> **Status:** 🔴 10% — only the Dashboard's own aggregates exist
> (`apps/api/src/dashboard/dashboard.controller.ts`: headcount, department
> breakdown, pending-approvals count); there is no `apps/api/src/reports`
> module, no register screens, and no export pipeline yet. **This module is
> currently blocked, in part, on Payroll** — see §1.1. Not built in this
> pass (2026-09-24): scoped and documented, code not started, by explicit
> owner decision (build what doesn't depend on Payroll first was one option
> considered and declined in favor of waiting — see §8).
> **Target code location:** `apps/api/src/reports` (backend, not yet
> created), a `Reports` route in `apps/web/src/pages` (frontend, not yet
> created).
> **Related:** `docs/MODULE_SPECS.md` §11 · module `06_DASHBOARD.md` (the
> aggregates this module will supersede/extend) · module
> `08_STATUTORY_COMPLIANCE.md` (the statutory registers this module
> exports depend on the same Payroll data) · `CLAUDE.md`'s "V1 module
> scope" (Payroll: "not started").
> **Last synced to code:** 2026-09-24 (spec written; no code change).

---

## 1. Purpose & scope

Org-wide metrics and pre-built registers an HR Manager or Company Admin
pulls without engineering help: headcount trends, attrition, payroll cost,
and the statutory registers (PF, ESI, Gratuity, Salary) they hand to an
accountant or file with a regulator. Later, a self-serve report builder.

### 1.1 The Payroll dependency — why this can't be "finished" independently

Two of the four `[MUST]` features in the SRS this module traces to are
**payroll-cost reporting** (FR-RPT-002) and **statutory registers**
(FR-RPT-004) — both require Payroll's computed output (a processed pay
run: gross, deductions, net, employer contributions, per employee per
period). **Payroll is not built** — there is no `apps/api/src/payroll`
module and no payroll-related Prisma model beyond
`TenantSettings.payrollCutoffDay` (a scheduling config, not payroll data)
as of this spec's sync date. `docs/MODULE_SPECS.md`'s cross-module
dependency map states this explicitly: *"Attendance ──(month-end
LOP)──► Payroll ──(processed run)──► Compliance / Reports (payroll
cost)"* — Reports sits downstream of a module that doesn't exist yet.

This means: **Reports & Analytics cannot honestly reach 100% until
Payroll lands.** Marking it done while FR-RPT-002/FR-RPT-004 are
structurally unbuildable would misrepresent the module's state, which
`CLAUDE.md`'s status-sync rule treats as a hard requirement to avoid.

**What *is* independently buildable today** (FR-RPT-001, most of
FR-RPT-003 — see §3) draws only on Employee Master + Attendance +
Leave, all of which are done. That work was scoped in this pass but
deliberately **not implemented** — the owner's call (2026-09-24) was to
hold Reports & Analytics as a single build once Payroll exists, rather
than split it into a "pre-Payroll" and "post-Payroll" pass. This file
exists so whoever picks the module up next — likely once Payroll is
merged — starts from a real plan instead of a blank slate.

**In scope (V1, once unblocked):**
- Headcount: active vs separated, joiners/leavers, department-wise
  (FR-RPT-001).
- Payroll cost: monthly cost, CTC vs actual, department-wise salary
  (FR-RPT-002 — needs Payroll).
- Attrition: monthly rate, average tenure, voluntary vs involuntary
  (FR-RPT-003 — voluntary/involuntary needs a separation-reason field
  Employee Master doesn't currently capture structured; see §3 note).
- Statutory registers: Salary, PF, ESI, Gratuity (FR-RPT-004 — needs
  Payroll).

**Out of scope for V1 (`[SHOULD]`, later):**
- Drag-drop custom report builder + scheduled email (FR-RPT-005).
- Export to PDF/XLSX/CSV *everywhere* (FR-RPT-006) — the pre-built
  registers should export from day one of *their* build; a generic
  "export any view" capability is the later, `[SHOULD]` part.

---

## 2. User personas

| Persona | Uses | Screen |
|---|---|---|
| Company Admin | All reports; exports for filing/board reporting | Reports (not yet built) |
| HR Manager | Headcount, attrition, department reports | Reports (not yet built) |
| Line Manager / Employee / Auditor | No access planned (org-wide financial/HR data) | — |
| Platform Admin | Nothing (no tenant data) | — |

---

## 3. Feature list (definition of done, once built)

| Feature | SRS | Status | Depends on |
|---|---|---|---|
| Headcount: active vs separated, joiners/leavers, dept-wise | FR-RPT-001 | 🟡 partial today (Dashboard has headcount + dept breakdown only; no joiners/leavers trend, no time-series) | Employee Master only — buildable now |
| Payroll cost: monthly cost, CTC vs actual, dept-wise salary | FR-RPT-002 | 🔴 | Payroll (not built) |
| Attrition: monthly rate, avg tenure, voluntary vs involuntary | FR-RPT-003 | 🔴 | Employee Master's `lastWorkingDate`/lifecycle history for rate + tenure; voluntary/involuntary split needs a structured separation-reason field not currently on `Employee` (today `transitionLifecycle`'s `reason` is free text, module 03 §4.4) — buildable *with a small schema addition*, not blocked on Payroll |
| Statutory registers: Salary, PF, ESI, Gratuity | FR-RPT-004 | 🔴 | Payroll (Salary/PF/ESI) + Payroll's gratuity calc (Gratuity) |
| `[SHOULD]` drag-drop custom report builder + scheduled email | FR-RPT-005 | 🔴 | All of the above existing first |
| `[SHOULD]` export PDF / XLSX / CSV everywhere | FR-RPT-006 | 🔴 | Per-report export ships with that report; this is the later generalization |

---

## 4. Happy path (target)

1. Company Admin or HR Manager opens **Reports** → picks a register (e.g.
   PF Register) + a month/quarter.
2. The backend queries the relevant module data (Employee Master for
   headcount/attrition; Employee + Payroll for cost/statutory registers)
   and renders rows, computed server-side (never in the browser, to keep
   PII/compensation data off the client until the user actually asks to
   view/export it).
3. Admin exports to XLSX/CSV/PDF for filing or handing to their
   accountant.

---

## 5. Technical design (target, not yet built)

### 5.1 Data model

No new tables anticipated for the headcount/attrition slice — it's
read-only aggregation over `Employee`/`Department`/`AttendanceRecord`.
Payroll-cost and statutory registers will read from Payroll's own tables
once that module defines them (out of this module's control until then).

### 5.2 Components (planned)

- **`apps/api/src/reports`** — a new module, `ReportsService` per
  register (headcount, attrition, payroll-cost, PF/ESI/Gratuity),
  `ReportsController` behind `@Roles(COMPANY_ADMIN, HR_MANAGER)` +
  `EntitlementGuard` (a plan-gated module, same pattern as Leave/
  Attendance's `@RequiresModule`).
- **Export** — same `ExcelJS` dependency `EmployeesService`'s bulk-import
  already uses for XLSX; PDF via a lightweight renderer (not yet chosen —
  evaluate when this module starts, don't pre-commit a library here).

---

## 6. Business rules & invariants (target)

- **RULE-1** Every report is computed tenant-scoped (RLS + service-layer
  scoping), same as every other module — no cross-tenant aggregation.
- **RULE-2** Compensation figures (CTC, payroll cost) are Company
  Admin/HR Manager only — never exposed to Line Manager or Employee, even
  in aggregate form (a department-level average could still leak an
  individual's CTC in a small department).
- **RULE-3** Exports carry the same authorization check as the underlying
  data — an export endpoint is not a way to route around RULE-2.

---

## 7. Permission matrix (target)

| Capability | Employee | Line Manager | HR Manager | Company Admin | Auditor | Platform Admin |
|---|:--:|:--:|:--:|:--:|:--:|:--:|
| View headcount/attrition reports | — | — | ✅ | ✅ | — | — |
| View payroll-cost / statutory registers | — | — | ✅ | ✅ | — | — |
| Export any report | — | — | ✅ | ✅ | — | — |

(Auditor is deliberately excluded here, unlike most other modules'
read-only feeds — this module surfaces compensation aggregates, not an
audit trail; revisit if a customer's Auditor persona needs read access to
these specifically.)

---

## 8. Open questions / owner actions

- **Sequencing decision (made 2026-09-24):** build Reports & Analytics as
  one pass once Payroll exists, rather than splitting a "headcount +
  attrition now, payroll-cost + statutory later" partial build. Considered
  and declined: shipping the Payroll-independent slice now would let this
  module show real progress sooner, but risks a rework once Payroll's
  actual data shapes (per-period run, component breakdown) are known —
  the aggregation queries would likely need to change to match them
  anyway. Revisit this call once Payroll's schema is closer to landing —
  if Payroll's `PayrollRun`/`Payslip`-equivalent shapes are stable early,
  building headcount/attrition first may become worth it again.
- **Voluntary vs involuntary attrition** needs a structured field
  (`Employee.separationReason` enum or similar) that doesn't exist today
  — `transitionLifecycle`'s `reason` is free text (module 03 §4.4). Small
  schema addition, not blocked on Payroll; flag to whoever picks this
  module up.
- **PDF export library** not chosen yet — evaluate at build time rather
  than locking in a dependency this spec can't validate against real
  report layouts.
