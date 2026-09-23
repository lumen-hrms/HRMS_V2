# 08 — Statutory Compliance — Module Source of Truth

> **This file is the authoritative, detailed spec for further development of
> this module.** `docs/MODULE_SPECS.md` §8 is the one-page summary; there is
> no UI build prompt yet (`docs/ui-build-prompts/08-statutory-compliance.md`
> is not written — add it when this module is picked up for implementation).
>
> **Status:** 🔴 not started. **No code exists** at the target location
> (`apps/api/src/compliance`). This entire document describes the build
> target, not current behaviour — there is no "today" to describe.
> **Progress:** 0% (see `docs/MODULE_SPECS.md` status table — keep in sync).
> **Code:** none yet. Target: `apps/api/src/compliance`,
> `apps/web/src/pages/compliance`.
> **Related:** `docs/MODULE_SPECS.md` §8 · module `07_PAYROLL_ENGINE.md`
> (hard prerequisite — see §0) · module `03_EMPLOYEE_MASTER.md` (`uan`,
> `pfNumber`, `esicNumber`, PAN, bank fields already on `Employee`) ·
> `docs/TENANT_CONFIGURATION.md` (`COMPLIANCE` is already a recognized
> Layer-1 plan-entitlement module name) · module `12_AUDIT_LOG.md` (every
> generated file + portal acknowledgement must be an audit event).
> **Last synced to code:** 2026-09-23 (spec written; no code to sync to).

---

## 0. Build-order blocker — read this first

Every EPF/ESI/Income-Tax feature below is defined as *"consumes only
processed payroll data; never recomputes salary"* (`MODULE_SPECS.md` §8
build notes). The cross-module dependency map is explicit: **"Build order
implication: Payroll before Compliance."** Today, module 07 (Payroll
Engine) is 0% — there is no `PayrollRun`/`PayrollLineItem` table, no
processed-run event stream, nothing to generate ECR/challan/24Q/Form 16
from. **Do not start EPF, ESI, or Income Tax implementation before Payroll
exists and exposes a stable processed-run contract.**

**POSH is the one sub-module with no Payroll dependency** — ICC
management, the confidential complaint workflow, and the annual report are
self-contained and can be built independently of Payroll's timeline. If
this module is picked up before Payroll lands, POSH is the correct place
to start (see §9 for a suggested build order).

---

## 1. Purpose & scope

Given a **processed** payroll period, produce the statutory artefacts
Indian labour/tax law requires, in the exact government-specified formats,
as downloadable files for manual portal upload (not live e-filing — see
below). Also owns the employee-facing investment-declaration workflow that
feeds Payroll's TDS projection, and the POSH (workplace harassment)
compliance workflow, which is organizationally adjacent but has no payroll
dependency.

**In scope (V1 target):**
- EPF: monthly ECR file, UAN bulk seeding, Forms 2/5/10/12A.
- ESI: monthly challan, half-yearly return, ₹21,000 eligibility tracking.
- Income Tax: Form 24Q, Form 16 (Part A + B), investment declaration +
  proof-verification workflow.
- POSH: ICC member management, confidential complaint workflow, annual
  report.

**Out of scope / deferred** (`CLAUDE.md` explicitly-deferred list):
**live EPFO/ESIC/TRACES e-filing APIs.** This module generates files in
the government's specified format for a human to upload to the respective
portal and record the resulting challan/acknowledgement number back in the
app — it does not submit anything over the wire. `FR-CPL-004` (EPFO
Unified Portal API) is explicitly `[SHOULD]`, not V1.

---

## 2. User personas & their role in this module

There is **no dedicated "Compliance Manager" RBAC role** — the fixed V1
role set (`CLAUDE.md`) is Platform Admin · Company Admin · HR Manager ·
Line Manager · Employee · Auditor. `MODULE_SPECS.md`'s happy paths refer to
a "Compliance Manager" generically; until told otherwise, this spec assumes
that means **HR Manager or Company Admin**, gated the same way Payroll
access would be. **This is an open question — see §12.**

| Persona | Why they touch this module | What they can do (target) | What they cannot do |
|---|---|---|---|
| **HR Manager / Company Admin** | Owns statutory filing for the tenant. | Generate ECR/challan/returns from a processed payroll run; manage UAN seeding; run the investment-declaration cycle and verify proofs; generate Form 16/24Q; manage ICC membership; view POSH case *metadata* (not full confidential detail unless also an ICC member — see §6 INV-3). | Cannot recompute salary — every number traces back to an immutable `PayrollRun`. Cannot see full POSH complaint detail unless on the ICC. |
| **ICC member** (a *capability*, not a role — see §12) | Handles POSH complaints under the confidentiality the law requires. | View/action complaints assigned to the ICC; update case status/timeline; contribute to the Annual Report's aggregate statistics. | Cannot see complaints outside the ICC's confidential workflow even if also HR Manager, unless explicitly seated on the ICC. |
| **Employee** | Declares investments; receives Form 16; can raise a POSH complaint. | Submit/update own investment declaration (until the proof-submission window closes); upload proofs; download own Form 16 / payslip-adjacent tax documents; file a POSH complaint (routed confidentially to the ICC, not to their own manager or HR generally). | Cannot see any other employee's declaration, Form 16, or POSH case. Cannot see the ICC's internal case notes on their own complaint beyond the status/timeline the workflow exposes. |
| **Line Manager** | Not a participant in this module. | Nothing compliance-specific — no aggregate or per-report visibility into declarations, filings, or POSH cases. | Everything. |
| **Auditor** (read-only) | Reviews compliance posture / filing history for audit exposure. | *(Target)* read-only view of generated filings, challan/acknowledgement numbers recorded, and POSH **aggregate** statistics (not confidential case content). | Cannot see POSH case detail (confidentiality overrides read-only audit access — same principle as `CLAUDE.md`'s break-glass design: elevated read is deliberate and logged, never a standing grant). |
| **Platform Admin** | Out of scope — separate console, no tenant PII access. | — | — |

---

## 3. Functional expectations (definition of done)

**EPF**
1. Monthly ECR text file matches EPFO's current layout exactly, generated
   only from a `PROCESSED`/`DISBURSED` `PayrollRun` (FR-CPL-001).
2. UAN can be bulk-seeded onto `Employee.uan`; verification is explicitly
   **not** this app's job — it happens on the EPFO portal (`CLAUDE.md`
   Aadhaar/UAN note, mirrored from module 03) (FR-CPL-002).
3. Forms 2 (Nomination), 5 (joiners), 10 (leavers), 12A (monthly
   remittance summary) generate from the same processed-run + employee
   lifecycle data, in EPFO's layout (FR-CPL-003).

**ESI**
4. Monthly ESI challan computes employer/employee contributions correctly
   from processed payroll wages (FR-CPL-005).
5. Half-yearly ESI return matches ESIC's format (FR-CPL-006).
6. Eligibility crossing ₹21,000 gross is tracked and surfaced for review
   *before* the next cycle's challan, not silently dropped (FR-CPL-007).

**Income Tax**
7. Form 24Q (quarterly TDS return) includes challan + employee-wise data,
   sourced from processed payroll TDS deductions (FR-CPL-008).
8. Form 16 Part A (from challan/24Q data) + Part B (from the annual
   computation) generate in bulk at FY end (FR-CPL-009).
9. Investment declaration (80C/80D/HRA/LTA + proofs) is a defined
   employee-facing workflow whose output Payroll's TDS projection consumes
   — this module owns declaration + proof verification, Payroll owns the
   projection math (FR-CPL-010).
10. January proof-submission cycle: verified proof amounts replace
    declared amounts; Q3/Q4 TDS auto-adjusts in Payroll off this module's
    verified data (FR-CPL-011).

**POSH**
11. ICC member management with term-expiry alerts — no build dependency on
    Payroll (FR-CPL-012).
12. Confidential complaint workflow: case number, status, and the
    statutory 90-day resolution timeline are tracked; case content is
    visible only to the ICC (FR-CPL-013).
13. POSH Annual Report aggregates complaint statistics without exposing
    individual case content to anyone outside the ICC (FR-CPL-014).
14. `[SHOULD]` POSH training-completion tracking (FR-CPL-015) — v1.1.

**Cross-cutting**
15. Every generated file and every portal-acknowledgement number a user
    records back is an audit event (module 12) — filings are a compliance
    artefact, "who generated what, when, and what happened after" must be
    reconstructable.
16. This module **never recomputes salary or statutory deductions** — it
    reads Payroll's already-computed, immutable numbers and reformats them.
    If a number looks wrong, the fix is a Payroll adjusting entry, not a
    compliance-side recalculation.

---

## 4. Technical design (target — provisional, pending Payroll's actual schema)

### 4.1 Row scoping

Target `ComplianceService.scopeFor(user)`, mirroring the pattern in
`03_EMPLOYEE_MASTER.md`/`05_ATTENDANCE.md`:

```
EMPLOYEE      → own investment declaration, own Form 16/tax docs, own POSH
                complaints (submit + view own status only)
ICC_MEMBER*   → POSH complaints the ICC is seated on (see §12 — this is a
                capability check, not a `@Roles` role)
HR_MANAGER /
COMPANY_ADMIN → all EPF/ESI/24Q/Form 16 generation + all declarations
                (verification), POSH case *metadata* only unless also
                ICC_MEMBER
AUDITOR       → read-only on filings + POSH aggregates only, never case
                content
```

### 4.2 Data model (draft — do not build until Payroll's schema is real)

**`InvestmentDeclaration`** — `employeeId` · `financialYear` · `regime`
(mirrors Payroll's per-FY old/new regime choice, FR-PAY-009) ·
`section80C` / `section80D` / `hra` / `lta` (declared amounts) · `status`
(`DECLARED → PROOFS_SUBMITTED → VERIFIED`) · `verifiedAmounts` (JSON or
mirrored columns, populated after proof review) · `verifiedBy` /
`verifiedAt`.

**`DeclarationProof`** — `declarationId` · `category` · `documentId` (FK
into module 09 Documents, not a parallel storage path) · `amount`.

**`ComplianceFiling`** — a generic record of "a file was generated":
`type` (`ECR · ESI_CHALLAN · ESI_RETURN · FORM_24Q · FORM_16 · FORM_2 ·
FORM_5 · FORM_10 · FORM_12A`) · `period` (month or quarter or FY,
depending on `type`) · `payrollRunId` (FK — **every filing traces to
exactly one immutable `PayrollRun`**, except Form 16 which spans a FY's
worth of runs) · `fileKey` (S3, private) · `generatedBy` / `generatedAt` ·
`portalAcknowledgementNumber?` (recorded manually after upload) ·
`recordedBy?` / `recordedAt?`.

**`ICCMember`** — `employeeId` · `role` (`PRESIDING_OFFICER · MEMBER ·
EXTERNAL_MEMBER`) · `termStartsAt` / `termEndsAt`. Drives the term-expiry
alert (feature 11).

**`PoshComplaint`** — `caseNumber` (sequential per tenant, not the
complainant's identity in the number) · `complainantEmployeeId` (visible
only within the confidential workflow — see §6 INV-3) · `status`
(`FILED → UNDER_INQUIRY → RESOLVED → CLOSED`, mapped against the
statutory 90-day clock) · `filedAt` · `dueAt` (computed) · case notes
stored separately/more restrictively than the case metadata, so a
metadata-level read (HR Manager, non-ICC) never exposes them.

**Not modeled here:** anything belonging to Payroll (`PayrollRun`,
`PayrollLineItem`, salary structure, PT slabs). This module reads them,
never owns them. **Do not draft that schema here** — it belongs in module
07's own deep spec (not yet written); duplicating it here risks drifting
from whatever Payroll actually builds.

### 4.3 API surface (target)

| Method | Path | Notes |
|---|---|---|
| `POST` | `/api/compliance/epf/ecr?period=YYYY-MM` | `@Roles(HR_MANAGER, COMPANY_ADMIN)` — generates ECR from that period's processed `PayrollRun`; 4xx if the run isn't `PROCESSED`/`DISBURSED` yet |
| `POST` | `/api/compliance/epf/forms/:type` | Form 2/5/10/12A, `type` ∈ that set |
| `POST` | `/api/compliance/esi/challan?period=YYYY-MM` | Monthly ESI challan |
| `GET` | `/api/compliance/esi/eligibility-changes?period=YYYY-MM` | Employees crossing the ₹21,000 threshold since last cycle, for review before the challan runs |
| `POST` | `/api/compliance/esi/return?half=H1\|H2&year=YYYY` | Half-yearly ESI return |
| `POST` | `/api/compliance/tax/24q?quarter=Q1..Q4&year=YYYY` | Form 24Q |
| `POST` | `/api/compliance/tax/form16/bulk?year=YYYY` | Bulk Form 16 at FY end |
| `GET`/`POST` | `/api/compliance/declarations` | Employee's own declaration for the current FY (`GET` own; `POST` create/update while `DECLARED`) |
| `POST` | `/api/compliance/declarations/:id/proofs` | Upload proof documents |
| `POST` | `/api/compliance/declarations/:id/verify` | `@Roles(HR_MANAGER, COMPANY_ADMIN)` — verified amounts replace declared; triggers Payroll's Q3/Q4 TDS re-projection (module 07 to consume, not this module to compute) |
| `PATCH` | `/api/compliance/filings/:id/acknowledgement` | Record the portal-issued challan/acknowledgement number after manual upload |
| `GET`/`POST`/`PATCH` | `/api/compliance/posh/icc-members` | ICC roster CRUD, `@Roles(HR_MANAGER, COMPANY_ADMIN)` |
| `POST` | `/api/compliance/posh/complaints` | Employee files a complaint — any authenticated tenant user |
| `GET`/`PATCH` | `/api/compliance/posh/complaints/:id` | ICC-member-only for full detail; complainant sees own status only; HR Manager/Auditor see metadata (status, dates) never case content |
| `GET` | `/api/compliance/posh/annual-report?year=YYYY` | Aggregate statistics only |

All routes: `JwtAuthGuard → TenantGuard → RolesGuard` per the standing
convention (`MODULE_SPECS.md` "Conventions every module follows"), plus
the POSH-specific confidentiality scoping in §4.1/§6 that a static
`@Roles` check cannot express — needs service-layer enforcement, same
category as Line Manager's "own reports only" scoping.

### 4.4 Configuration dependencies

`COMPLIANCE` is already a recognized Layer-1 plan-entitlement module name
in `TENANT_CONFIGURATION.md` — gate this module's controllers behind
`@RequiresModule('COMPLIANCE')` (`EntitlementGuard`, same pattern already
wired onto Leave/Attendance) from day one, not as a follow-up. No Layer-2
(`tenant_settings`-style) config is identified yet for this module — PT
slabs, EPF ceiling config, etc. belong to Payroll (`MODULE_SPECS.md` §7
build notes: "Statutory rates/slabs/ceilings are config tables"), not
Compliance. This module consumes Payroll's already-applied numbers; it
does not carry its own rate tables.

---

## 5. Core flows (target)

### 5.1 Monthly EPF/ESI (happy path, mirrors `MODULE_SPECS.md` §8)

1. Payroll run for a period reaches `DISBURSED`.
2. HR/Company Admin → **Compliance → EPF → [period]** → **Generate ECR**.
3. Service reads the immutable `PayrollRun`, computes per-employee PF
   wages + contributions (already computed by Payroll — this step is
   reformatting, not recomputation), writes the ECR file in EPFO layout.
4. User downloads it, uploads to the EPFO portal, pays the challan,
   records the challan number back (`PATCH .../filings/:id/acknowledgement`)
   — an audit event.
5. Same flow for the ESI challan; eligibility changes since last month are
   surfaced first (step 4 of the feature list) for review before
   generating.

### 5.2 Investment declaration cycle

1. Start of FY: Employee → **Tax → Declaration** → enters 80C/80D/HRA/LTA
   → `POST /compliance/declarations` → status `DECLARED`.
2. Payroll's TDS projection (module 07, FR-PAY-008) reads the declared
   amounts (a read across the module boundary, not a copy — exact
   mechanism TBD when Payroll's schema exists).
3. January: employee uploads proofs (`POST .../proofs`) → status
   `PROOFS_SUBMITTED`.
4. HR/Company Admin verifies (`POST .../verify`) → status `VERIFIED`,
   verified amounts recorded → Payroll re-projects Q3/Q4 TDS off the
   verified numbers.
5. FY end: **Generate Form 16 (bulk)** — Part A from 24Q/challan data,
   Part B from the annual computation.

### 5.3 POSH complaint (confidential)

1. Employee → **Report a concern** → `POST /compliance/posh/complaints` →
   case number issued, routed to the ICC roster only (not to the
   employee's manager, not to general HR).
2. ICC members see it in their queue; update status through
   `FILED → UNDER_INQUIRY → RESOLVED → CLOSED`, tracked against the
   statutory 90-day timeline (`dueAt`).
3. Complainant can check their own case's status/timeline, not the ICC's
   internal notes.
4. Annual Report aggregates case counts/outcomes/timeliness across all
   complaints without exposing any individual case's content.

---

## 6. Business rules & invariants (target)

- **INV-1** — every `ComplianceFiling` (except Form 16, which spans a FY)
  traces to exactly one `payrollRunId`, and that run must be
  `PROCESSED`/`DISBURSED` — never `DRAFT`/`REVIEW`/`APPROVED`. Generating
  from an unprocessed run is a hard error, not a warning.
- **INV-2** — this module never writes to Payroll's tables and never
  performs its own salary/deduction arithmetic. If a filing number is
  wrong, the fix is a Payroll adjusting entry (mirrors Payroll's own
  FR-PAY-018 immutability rule) — Compliance regenerates, it doesn't patch.
- **INV-3** — POSH case **content** (notes, complainant identity beyond
  the case-metadata view, investigation detail) is visible only to seated
  `ICCMember`s for that case's tenant, never to HR Manager/Company
  Admin/Auditor by role alone, and never to the complainant's own Line
  Manager. This is stricter than the normal RBAC model and must be
  enforced in the service layer, not assumed from `@Roles`.
- **RULE-1** — an `InvestmentDeclaration` can only move
  `DECLARED → PROOFS_SUBMITTED` while the tenant's proof-submission window
  is open (target: a `TENANT_CONFIGURATION.md`-style setting, not yet
  defined — see §12), and `→ VERIFIED` only by HR/Admin action, never
  self-verified.
- **RULE-2** — a `PoshComplaint`'s `dueAt` (90-day statutory clock) starts
  at `filedAt` and is surfaced on the ICC's queue as an overdue flag, not
  silently tracked.
- **RULE-3** — every `ComplianceFiling` generation and every
  `portalAcknowledgementNumber` write is an audit event (module 12) —
  no silent filing.
- **RULE-4** — ESI eligibility-threshold crossings (₹21,000 gross) must be
  surfaced for review before the challan that would first reflect them is
  generated, not applied silently.

---

## 7. States (target)

**`InvestmentDeclaration.status`:** `DECLARED → PROOFS_SUBMITTED →
VERIFIED` (linear, no back-transitions once verified for that FY).
**`PoshComplaint.status`:** `FILED → UNDER_INQUIRY → RESOLVED → CLOSED`.
**`ComplianceFiling`:** generated (immutable once created — a re-run
creates a new `ComplianceFiling` row, it does not overwrite; exact
re-generation policy is an open question, §12).

---

## 8. Permission matrix (target)

| Capability | Employee | Line Manager | HR Manager / Company Admin | ICC member | Auditor |
|---|:--:|:--:|:--:|:--:|:--:|
| Generate ECR / ESI challan+return / 24Q | — | — | ✓ | — | — |
| Bulk-generate Form 16 | — | — | ✓ | — | — |
| Record portal acknowledgement number | — | — | ✓ | — | — |
| Submit / update own investment declaration | own | — | — | — | — |
| Verify a declaration's proofs | — | — | ✓ | — | — |
| Download own Form 16 / tax docs | own | — | — | — | — |
| Manage ICC roster | — | — | ✓ | — | — |
| File a POSH complaint | own | own | own | own | — |
| View/action a POSH complaint (full content) | own status only | — | metadata only | ✓ (seated cases) | — |
| View POSH annual report (aggregate) | — | — | ✓ | ✓ | ✓ (read-only) |
| Read filing history (read-only) | — | — | ✓ | — | ✓ |

---

## 9. Known gaps / TODO (priority order)

Since nothing is built, this is the build plan, not a gap list against
shipped code:

1. **Write Payroll's processed-run contract first** (module 07) — the
   minimal shape Compliance needs (`PayrollRun.status`, per-employee PF
   wages/ESI wages/TDS deducted) should be agreed **before** either module
   starts, per the cross-module dependency map's build-order note.
2. **POSH sub-module** — ICC roster, complaint workflow, annual report.
   The only piece buildable independently of #1; suggested starting point
   if this module is picked up before Payroll lands.
3. **Investment declaration + proof workflow** — can start once
   Documents (module 09) has a stable upload API to attach proofs to,
   independent of Payroll's schema; the *verification* step's downstream
   effect (Payroll re-projecting TDS) is blocked on #1.
4. **EPF generators** (ECR, Forms 2/5/10/12A) — blocked on #1. Get real
   EPFO sample layouts before coding — "get real sample layouts before
   coding each one; they are unforgiving" (`MODULE_SPECS.md` §8 build
   notes) is not optional guidance.
5. **ESI generators** (challan, half-yearly return, eligibility tracking)
   — blocked on #1; same layout-accuracy caveat.
6. **Form 24Q / Form 16 bulk generation** — blocked on #1, additionally
   depends on the investment declaration's verified data (#3) for
   Part B's annual computation.
7. **`@RequiresModule('COMPLIANCE')` entitlement wiring** — do this from
   the first controller, not retrofitted later (see §4.4).
8. **Audit wiring** (module 12) — decide whether filings/acknowledgements
   ride the (also not-yet-built) generic audit interceptor or a dedicated
   append-only table, same open question `05_ATTENDANCE.md` §9 gap 10 has
   for its own module.
9. **No UI build prompt exists yet** — write
   `docs/ui-build-prompts/08-statutory-compliance.md` (copy the canonical
   §2.2 design-tokens block byte-identical from an existing prompt, per
   `docs/README.md`) when frontend work on this module starts.

---

## 10. Dependencies

**Upstream (hard blockers):**
- Module 07 Payroll Engine — **not started**. Every EPF/ESI/Income-Tax
  feature is blocked until Payroll exposes a processed, immutable run with
  per-employee statutory computation. See §0.
- Module 03 Employee Master — already provides `uan`, `pfNumber`,
  `esicNumber`, encrypted PAN, encrypted bank details, `dateOfBirth`,
  `gender`. No new upstream work needed here for those fields.
- Module 09 Documents — investment-declaration proof uploads should reuse
  its document storage, not a parallel path (mirrors how Employee Master's
  documents work today).
- `docs/TENANT_CONFIGURATION.md` — `COMPLIANCE` Layer-1 entitlement name
  already reserved; no Layer-2 settings identified yet (see §4.4).

**Downstream (consumers of Compliance):**
- Module 11 Reports & Analytics — compliance filing history / POSH
  aggregate reporting (not built).
- Module 12 Audit Log — every filing + acknowledgement is an audit event
  (not built — generic interceptor doesn't exist yet).
- Module 10 Notifications — ICC term-expiry alerts, proof-submission
  window reminders, POSH 90-day-timeline nudges (not built).

---

## 11. Acceptance criteria / test checklist (target)

- [ ] Generating an ECR/challan/return from a `DRAFT`/`REVIEW`/`APPROVED`
      (not yet `PROCESSED`) payroll run is rejected.
- [ ] The ECR file's contents, for a known-good test payroll run, match a
      real EPFO sample layout byte-for-byte in structure (not just "looks
      plausible").
- [ ] An employee cannot read another employee's investment declaration,
      Form 16, or POSH complaint (RLS + service-layer scoping).
- [ ] An HR Manager who is not a seated `ICCMember` cannot read a POSH
      complaint's case content via any route — only metadata.
- [ ] A `PoshComplaint`'s `dueAt` correctly reflects the 90-day statutory
      clock from `filedAt`, and overdue cases are flagged on the ICC queue.
- [ ] Verifying a declaration's proofs never lets the verified amount
      exceed the declared amount without an explicit override path
      (confirm this rule against real Income Tax proof-verification
      practice before building — flagged, not assumed, in §12).
- [ ] Every filing generation and acknowledgement-number write produces
      exactly one audit event.
- [ ] Cross-tenant: Tenant A cannot read/generate against Tenant B's
      payroll runs, declarations, or POSH cases (RLS).

---

## 12. Open questions / decisions needed

- **Is "Compliance Manager" a role or a capability?** The RBAC role set is
  fixed for V1 (`CLAUDE.md`) with no such role. This spec assumes
  HR Manager/Company Admin for now — confirm before building any
  `@Roles` decorator here.
- **How is "ICC member" modeled?** Proposed here as a capability
  (`ICCMember` table keyed to an `Employee`, independent of their RBAC
  role) rather than a new fixed role, since POSH law requires specific
  named individuals (including possibly an external member with no login
  at all) — needs a decision before §4.2's schema is finalized.
- **Proof-submission window** — is this a new `TENANT_CONFIGURATION.md`
  Layer-2 setting (a date range per FY), or hardcoded to "January"? Needs
  a decision before RULE-1 can be enforced.
- **Re-generation policy** — if HR regenerates an ECR for a period
  already filed (e.g. a data correction before the portal upload), does
  the old `ComplianceFiling` row get superseded, versioned, or does
  re-generation require an explicit reason (audit parallel to Payroll's
  "never twice without override + dual approval")?
- **External ICC member without a login** — POSH law requires at least one
  external member; does that person need any in-app access at all, or is
  their involvement entirely outside this system (paper/email), with the
  app only recording their name/term?
- **Verified proof amount vs. declared amount** — can verified exceed
  declared (e.g. employee under-declared but proof shows more)? Get a real
  answer from Income Tax practice, not an assumption, before building
  RULE for this.
- **Exact EPFO/ESIC/TRACES file layouts** — none have been sourced yet.
  Get real current sample layouts before starting §9 items 4–6; they
  change periodically and are unforgiving of guesswork.
