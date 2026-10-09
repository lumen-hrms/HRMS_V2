# Payroll — human sign-off checklist

Module 07 is **code-complete (100%)**. These items need a person, a live
environment, or the shared database, so they live here (and in the testing
tracker) rather than counting against the module's percentage — same
convention as the other modules' live checks.

## 1. Statutory-rate review (decision 11) — needs a payroll/tax expert

Every figure below is a *seeded default*, tenant-editable in Settings (a
correction is a data change, not a code change). None has been reviewed by
a domain expert. Source: `apps/api/src/payroll/payroll-defaults.ts` and the
`PayrollSettings` column defaults in `apps/api/prisma/schema.prisma`.

| Area | Seeded value | Reviewer to confirm |
|---|---|---|
| EPF | ceiling ₹15,000; employee 12%; EPS 8.33%; employer EPF 3.67%; admin 0.5%; EDLI 0.5% | Admin/EDLI rates and minimum charges; behaviour when wages exceed the ceiling |
| ESI | wage ceiling ₹21,000; employee 0.75%; employer 3.25% | Coverage for a contribution period when wages cross ₹21,000 mid-period; rounding (up to the next rupee) |
| Professional Tax | Karnataka, Maharashtra, Telangana, Andhra Pradesh, West Bengal, Gujarat slabs; February amounts | Current slabs per state; women's exemption (not modelled); half-yearly states (TN, Kerala) not seeded |
| Income tax (TDS) | Updated 2026-10-09 to Finance Act 2025 rules: NEW slabs 0–4L nil, 4–8L 5%, 8–12L 10%, 12–16L 15%, 16–20L 20%, 20–24L 25%, >24L 30%; std. deduction ₹75k; 87A rebate to ₹12L (max ₹60,000) **with marginal relief**; OLD slabs/₹50k/₹5L→₹12.5k unchanged; 4% cess | Confirm FY2026-27 is unchanged (assumed — verify against the current Finance Act / Income-tax Act 2025 rules), surcharge (not modelled), old-regime deductions caps. **Existing tenants keep the rows already seeded for their FY** (seeding skips duplicates) — edit them in Settings › Tax or re-seed per tenant |
| Gratuity | 15 days per year, 26-day month divisor, 5-year eligibility | Formula, cap (₹20 lakh), rounding of service years |
| Leave encashment | divisor 26, BASIC only | Which components count, per tenant policy |
| Overtime | multiplier 2.0 | Per-state statutory rates (not modelled; tenant-set) |
| Rounding | Decimal, 2dp half-up at the line level | Confirm rounding point matches payroll/auditor expectations |

## 2. Live-environment checks

- **Cross-tenant suite:** `apps/api/test/payroll-isolation.e2e-spec.ts`.
  Needs the e2e Postgres (all migrations applied) and a working Firebase
  service account in `apps/api/.env.test`: `npm run test:e2e -- payroll-isolation`.
  Its database-level assertions (RLS fails closed, no cross-tenant
  read/update/delete/insert, platform role has no grants, INV-2 trigger)
  were verified directly with SQL against a freshly migrated Postgres 16 on
  2026-10-09; the HTTP-level assertions were type-checked but could not be run
  there (Firebase key rejected, no outbound network).
- **Scale:** CPU-bound work is covered by `payroll-performance.spec.ts`
  (5,000 calculations ≈ 0.1 s, 500 payslip PDFs ≈ 0.6 s). `process()` now
  uploads payslips and enqueues notifications with bounded concurrency
  (`concurrency.util.ts`). Still to measure on the real stack: a 500- and
  5,000-employee `POST /payroll/runs` + `process` against the shared DB and
  S3, watching request time and the single transaction that writes the
  payslip keys. If `process` exceeds the proxy timeout at 5,000, move it to a
  BullMQ job (decisions 19/22).
- **Browser pass** of `apps/web/src/pages/payroll` against a live backend.
