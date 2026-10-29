# Demo Runbook — Complete Company Onboarding, End to End

> **What this is:** a step-by-step script for a live demo that onboards a brand-new
> company from nothing. The order is: a lead arrives → the platform team creates the
> tenant → the Company Admin sets it up → employee data is imported → every persona
> uses the product → payroll runs and payslips go out.
>
> **Companion docs:** `docs/DEMO_TEST_PLAN.md` (≈250-case acceptance checklist —
> note its "Payroll out of scope" line is stale, payroll is now built),
> `docs/DEPLOY.md` (preview environment), `docs/PAYROLL_SIGNOFF.md`.
>
> **Written:** 2026-10-18 against `main` @ `47d226c`. Screen and button names come
> from the code. If a label differs in the build, fix it here after the first
> rehearsal.

---

## 0. The story you're telling

> *"Northwind Care is a 25-person clinic chain. They found us on the website, and
> in the next 45 minutes we take them from a contact-form lead to their first
> payroll run, with every person in the company logging in and doing their job."*

| Item | Demo value (change freely) |
|---|---|
| Company legal name | **Northwind Care Pvt Ltd** |
| Subdomain (workspace) | **`northwind`** |
| Plan | A plan that includes **Leave, Attendance and Payroll**. `EntitlementGuard` blocks any module the plan doesn't include. |
| Payroll period to run | **Last month** (e.g. `2026-09` if you demo in October) |
| Work state | Karnataka (PT slabs apply) |

### Cast: one browser profile per persona

Use a **separate Chrome profile (or incognito window) for each persona**. Firebase
keeps one session per browser profile, so swapping accounts in one window during a
live demo is slow and error-prone.

| # | Persona | Name (demo) | Login email | How the account is created |
|---|---|---|---|---|
| P0 | **Platform Admin** (our operator) | Founder | `founder@hrms-platform.dev` | Already exists (`prisma/seed.ts`) |
| P1 | **Company Admin** | Rohit Verma, Director | a **real inbox you control** (e.g. `<you>+ca@gmail.com`) | Created by P0 in the tenant-onboarding form (Act 1) |
| P2 | **HR Manager** | Priya Nair | `<you>+hr@gmail.com` | P1 creates via **Add employee + login** (Act 3) |
| P3 | **Line Manager** | Dr. Arjun Rao, Head of Nursing | `<you>+lm@gmail.com` | Same |
| P4 | **Employee** (reports to P3) | Sneha Iyer, Staff Nurse | `<you>+emp@gmail.com` | Same |
| P5 | **Employee** #2 (reports to P3) | Kiran Das, Staff Nurse | `<you>+emp2@gmail.com` | Same |
| P6 | **Auditor** (read-only) | CA Meera Shah | `<you>+audit@gmail.com` | Same |

Use Gmail `+` aliases so every reset email lands in one inbox you can open on
stage. Every login is a real Firebase account, so never use a domain you don't control.

---

## 1. Pre-flight (T-1 day) — do NOT skip

### 1.1 Environment

- [ ] **API is up:** `GET https://<vercel-app>/api/health` returns 200.
- [ ] **Web app loads** at the Vercel URL. The tenant app and `/platform-admin` both render.
- [ ] **Background workers are running on the preview box.** They're off on laptops by
      default (`apps/api/src/common/background-workers.ts`). Without them there are
      no emails, document uploads never clear the ClamAV scan (so you can't download
      them), and leave escalations don't fire. If you demo from a laptop, set
      `WORKERS_ENABLED=true` and run clamd (`docker-compose`).
- [ ] **Email (SES) works end to end.** Notifications is still at 95%: the first real
      SES delivery hasn't been signed off. Send yourself one test reset. **If SES isn't
      live, plan the workaround now** (see §1.3).
- [ ] **Firebase → Authentication → Authorized domains** includes the Vercel domain.
      Without it, reset links still work but don't bounce back to `/login`.
- [ ] **Platform Admin can sign in** at `/platform-admin` as `founder@hrms-platform.dev`.
- [ ] **Subdomain `northwind` is free.** If you rehearsed with it, pick `northwind2`,
      etc. Tenants can be disabled, not deleted.
- [ ] Demo on a **weekday**, so clock-in lands on a working day. On a weekend or
      holiday, clock-in becomes a comp-off case instead.

### 1.2 Prepare the import file — **must be `.xlsx`**

> ⚠️ **Gotcha:** the import screen's **"Template (.csv)"** button downloads a CSV, and
> the file picker accepts `.csv`, but the server parses **only `.xlsx`** (ExcelJS
> `xlsx.load`, `employees.service.ts` `bulkImport`). A CSV upload fails. Open the
> template in Excel and **Save As `.xlsx`** before the demo.

Sheet 1, row 1 = headers, exactly (case-sensitive):

| employeeCode | firstName | lastName | personalEmail | phone | designation |
|---|---|---|---|---|---|
| NWC-101 | Anil | Kumar | anil.k@example.com | 9800000101 | Staff Nurse |
| NWC-102 | Divya | Menon | divya.m@example.com | 9800000102 | Staff Nurse |
| NWC-103 | Farhan | Ali | | 9800000103 | Lab Technician |
| … | … | … | … | … | … (≈15–20 rows total) |
| NWC-118 | Leela | | | | Receptionist ← **deliberately bad: no lastName** |
| NWC-101 | Duplicate | Row | | | ← **deliberately bad: duplicate code** |

The two bad rows let you show partial-failure handling: one bad row never fails the
whole batch. Keep a second file, `northwind-fixes.xlsx`, with the corrected rows.

> **What import covers, and what it doesn't:** bulk import only sets
> `employeeCode, firstName, lastName, personalEmail, phone, designation`. It does
> **not** set department, reporting manager, joining date, DOB, work state, CTC, or a
> **login account**. So imported people show up in the directory and org chart
> without a manager or department. Personas who need to log in are created
> through **Add employee** (Act 3, step 3.4). Say this upfront if asked ("the
> V1 import covers the core profile; the rest is enriched in-app"). Don't hide it.

### 1.3 Fallbacks — have these ready

| If this breaks… | Do this |
|---|---|
| CA reset email doesn't arrive (SES) | Click **Resend admin reset** on the tenant detail page. If it still fails, set a password on that user in the **Firebase console → Authentication → Users**. Rehearse this once. |
| Anything goes badly wrong mid-demo | Switch to the pre-seeded **Zenith Labs** tenant (`demo` subdomain, about 40 people across 5 levels). Run `cd apps/api && npm run prisma:seed-demo` the day before (owner only, shared DB). Every account's password is `Passw0rd!123`. CA = `ZEN-001`, HR = `ZEN-019`, LM = `ZEN-002`, Employee = `ZEN-004`. The script prints their emails. |
| Document download stuck at "scanning" | Workers or clamd are down. Skip downloads and show the upload + audit trail only. |

### 1.4 Full dress rehearsal

Run Acts 1–7 **twice** on a throwaway subdomain (`northwind-rehearsal`). The payroll
section has the most state to set up, so time it.

---

## 2. Run sheet (≈45–60 min)

| Act | What happens | Persona | Time |
|---|---|---|---|
| 1 | Lead → tenant created | P0 Platform Admin | 5 min |
| 2 | First login + company setup | P1 Company Admin | 10 min |
| 3 | Departments, **employee import**, persona accounts, org chart | P1 | 8 min |
| 4 | Payroll setup (statutory + salary structures) | P2 HR Manager | 6 min |
| 5 | A day in the life (attendance, leave, documents) | P4 → P3 → P2 | 10 min |
| 6 | First payroll run → payslips | P2 + P1 → P4 | 8 min |
| 7 | Reports, audit, auditor, platform wrap-up | P1, P6, P0 | 6 min |
| — | Optional: exit / Full & Final | P2 | 4 min |

---

## Act 1 — From lead to live tenant (Platform Admin)

**Message: "Onboarding a customer takes a couple of minutes, and the platform team
never sees employee data."**

1. **(Optional opener)** Open the public landing page and submit the **Contact us**
   form as "Rohit Verma, Northwind Care".
2. In **P0's window**, sign in at **`/platform-admin`** as `founder@hrms-platform.dev`.
3. Open **Leads** and show the submission you just sent. The ledger is append-only,
   and an entry is kept even if the notification email didn't send.
4. **Tenants → New tenant** (`tenant-new` screen):
   1. **Company legal name:** `Northwind Care Pvt Ltd`
   2. **Subdomain:** `northwind`. The field checks availability live.
   3. **Plan, seats & price:** pick the plan that includes Payroll. Seats `25`.
      Optionally set a negotiated price/seat; the form shows the monthly total.
   4. **Trial length (days):** e.g. 30.
   5. **Company Admin:** legal full name `Rohit Verma`, work email = **P1's real inbox**.
   6. Submit.
5. Show the result. The tenant gets default HR config, and a password-set email goes
   to P1. If the response says the email wasn't sent, click **Resend admin reset**.
6. Open **tenant detail**. Show the plan, trial end, status, and denormalized
   headcount (0 for now; you'll refresh it in Act 7).
7. Open **Audit**. The tenant creation appears in `platform_audit_log`, which is append-only.

> **Talking point:** the operator console runs on its own schema and Postgres role,
> with **zero grants** on tenant business tables. The platform team sees name, plan
> and headcount, never PII.

---

## Act 2 — Company Admin first login & company setup (P1)

1. In **P1's window**, open the inbox → the **"set your password"** email → set a password.
2. Go to the app's `/login`:
   - **Company Subdomain:** `northwind`
   - Email + new password → **Sign in**
3. **Company setup** opens full screen. Nobody in the workspace can use the app until
   it's submitted — show this by signing in as anyone else ("Your workspace is being
   set up"). Point out **Save draft**: you can stop and resume on any device. Each step
   must be error-free to continue:
   1. **Company:** legal name, address, state, contact, and the **go-live date**
      (leave for anyone without an imported balance is prorated from it).
   2. **Departments:** `Nursing`, `Administration`, `Diagnostics`, `HR`.
   3. **Your profile:** your own employee record, linked to your login.
   4. **Work week & shifts:** Mon–Sat for a clinic; 09:00–18:00 with a 15-minute grace.
   5. **Attendance rules:** regularization window/cap; payroll cut-off the 25th.
   6. **Holidays:** upload `northwind-holidays.csv` (`date, name, type`), mark Holi as
      OPTIONAL. Show that an ambiguous date like `03/04/2027` is rejected.
   7. **Leave policy:** keep the suggested CL/SL/EL/RH; leave year starts April;
      2-level approval. RH (Restricted Holiday) is how employees take optional holidays.
   8. **Import employees:** upload `northwind-employees.xlsx`; show a bad row blocking
      Next until it's fixed (the check is strict here, unlike the later bulk import).
   9. **Opening balances:** upload `northwind-opening-balances.csv` — the balances from
      their previous HRMS. Everyone else gets prorated policy defaults.
   10. **Review & submit:** every warning listed; submit applies it all in one go.
4. Land on the **Dashboard** — note the **Set up payroll** card (payroll is not part of
   setup; set it up when ready).

---

## Act 3 — Employee data import (P1)

**Message: "After setup, keep adding staff in bulk; bad rows don't block good ones."** (Skip
the employee file in Act 2 step 8 if you want to show this flow instead.)

### 3.1 Departments
Already created in company setup (Act 2). Open **Departments** to show them; add one
more (e.g. `Pharmacy`) to show they stay editable.

### 3.2 Bulk import
1. **Employees → Import** ("Bulk import employees").
2. Show **1. Download the template**. Explain that you've already filled it in and
   saved it as `.xlsx`.
3. **2. Upload your file** → `northwind-employees.xlsx`.
4. The result shows *N succeeded, 2 failed* with a reason for each row (missing
   `lastName`, duplicate `employeeCode`).
5. Click **download failed rows**, then upload `northwind-fixes.xlsx` and show it succeed.
6. Open **Employees** and show the new directory.

### 3.3 Enrich a couple of imported records (shows the edit + audit trail)
Open one imported employee (e.g. NWC-101) → edit → set **Department = Nursing**,
**Reporting manager** (after 3.4, set it to Dr. Arjun Rao), **Date of joining**. Every
field change is written to the audit log with before/after values. You'll show it in Act 7.

### 3.4 Create the persona accounts (people who will log in)
**Employees → Add employee.** For each of P2–P6, fill in:

| Field | Why it matters in the demo |
|---|---|
| Employee code, name, designation, department | Directory / org chart |
| **Reporting manager** | P4 and P5 → **P3** (Line Manager scoping); P3 → P1 |
| **Date of joining** | Proration. Use a date **before** the payroll period for full pay, or mid-period to show proration |
| **Date of birth** | **Required for payslips.** The payslip PDF password is the DOB in `DDMMYYYY` |
| **Work state** | Karnataka → Professional Tax slab |
| CTC (annual) | Shown on the profile; the salary structure in Act 4 drives pay |
| PAN / bank account (sensitive fields) | Stored encrypted and shown masked. **Reveal** asks for a permission and is logged. Good security moment. |
| **Login email + temporary password + role** | Creates the Firebase login with the tenant/role claims. Roles: HR_MANAGER, LINE_MANAGER, EMPLOYEE, EMPLOYEE, AUDITOR |

> Create **P3 before P4/P5** so you can pick them as the manager. A login can only be
> attached when the employee is **created**. It can't be added to an imported record
> later, which is why personas go through this form rather than the import.

Then sign each persona into **their own browser profile** with the temporary password.

### 3.5 Show the result
- **Org Chart:** interactive tree, hover cards, photo upload on a profile.
- **Identity & Access → Users:** all 6 accounts with their roles. Demonstrate a role
  change or **status** (disable) on a dummy account, plus **password reset**.
- **Dashboard** now has headcount numbers.

---

## Act 4 — Payroll setup (P2 HR Manager)

Do this before Act 6. **Payroll** in the left nav:

1. **Settings tab:**
   - Statutory settings: EPF (wage ceiling ₹25,000 default), ESI, and whether PT
     applies.
   - **PT slabs** for Karnataka: confirm or seed them.
   - Tax config: FY tax slabs, NEW vs OLD regime (NEW is the default).
2. **Structures tab:** create a **salary structure** for P2, P3, P4, P5 (and P1 if
   they should be paid). Use an effective date **on or before the first day of the
   payroll period** (e.g. `2026-04-01`). Employees without a structure covering the
   period aren't in the run.
   - Tip: give P4 a gross under ₹21,000/month so **ESI** shows on her payslip, and
     give P3 a higher salary so **TDS** shows.
3. **(Optional)** Change P5's TDS regime to OLD. The HR override is audited.

> **Why the last full month is safe to run:** loss-of-pay comes only from explicit
> `ABSENT` attendance records and approved LOP leave (`getLopDaysBatch`). A brand-new
> tenant with no attendance history gets **full pay, no LOP**, unless you add some on
> purpose.

---

## Act 5 — A day in the life (attendance, leave, documents)

### 5.1 Employee — Sneha (P4)
1. **Dashboard:** her own view (balances, attendance, recent activity).
2. **Attendance:** **clock in**, start/end a break, **clock out**. Show the calendar
   legend (Present / Late / Leave) and the stats (Days present, Punctuality, Overtime).
3. **Regularization:** request a correction for an earlier day ("forgot to clock out")
   and attach evidence.
4. **Leave → Apply** ("Request time off"): 2 days of CL next week with a **medical
   attachment**. The working-day count skips weekends and holidays. Try a type that
   requires notice to show a validation error.
5. **Profile → Documents:** upload an ID proof. It shows *scanning*, then becomes
   available once ClamAV passes. Documents fail closed: no download link until the scan is clean.
6. **Payroll → My pay:** empty for now (you'll come back in Act 6).

### 5.2 Line Manager — Dr. Arjun Rao (P3)
1. **Dashboard:** team widgets.
2. **Leave → Approvals:** Sneha's request → **Approve** (level 1).
3. **Attendance → Approvals:** Sneha's regularization → approve (or show **bulk approve**).
4. **Leave → Team calendar / Team balances:** he sees **only his reports**.
5. **Scoping proof:** open **Employees**. He can't edit people outside his reporting
   line. Mention the server enforces this (recursive reporting-manager scope), not just the UI.

### 5.3 HR Manager — Priya (P2)
1. **Leave → Approvals:** final approval if you turned on 2-level in Act 2. Approved
   leave automatically marks those attendance days `ON_LEAVE`.
2. **Leave → Balance adjustments:** credit +1 day with a reason, then show the **Ledger**.
3. **Attendance → Team:** org-wide roster plus **manual marking** (audited).
4. **Email log** (Company Admin / HR): every notification from the steps above,
   with **Retry** on failures.
5. Back in **P4's window**, show the notifications/emails she received.

---

## Act 6 — First payroll run → payslips (P2 + P1 → P4)

**Message: "Maker-checker built in: no single person can push payroll out."**

1. **P2 → Payroll → Run tab** → create a run for period **`2026-09`** (a **DRAFT**).
2. Review the **line items**: gross, EPF, ESI, PT, TDS, LOP, net. Open one employee's
   breakdown. Optionally make a manual adjustment and **Recalculate**.
3. **Submit for review** → status **REVIEW**.
4. **P2 approves.** The status **stays REVIEW** because one approval isn't enough.
5. **P1 (Company Admin) approves** in their window → **APPROVED**. (Invariant INV-1:
   two *distinct* approvers. The same account approving twice still counts once.)
6. **Process** → payslip PDFs are generated (in parallel) → **PROCESSED**.
7. **Bank file** → download the CSV. It's a dummy format behind a `BankFileGenerator`
   interface; real bank formats plug in there.
8. **Disburse** → **DISBURSED**.
9. **P4 → Payroll → My pay** → download the September payslip → it **asks for a
   password** → enter her DOB as `DDMMYYYY` → it opens.
10. **(Optional) Re-process:** trying to create a second `2026-09` run is refused unless
    you mark it as a re-process and give a reason.

---

## Act 7 — Reports, audit, auditor, platform wrap-up

### 7.1 Reports (P1 or P2) — `/reports`
- Headcount, joiners/leavers, attrition.
- **Payroll cost** (employer cost vs. planned CTC) and the **Salary / PF / ESI /
  Gratuity registers** for 2026-09. These read the processed run's stored figures;
  nothing is recomputed.
- **Export XLSX** on one register.

### 7.2 Audit (P1) — **Identity & Access → Audit**
Three sub-tabs: login trail, access changes (the role change from 3.5), and **All
activity**. In All activity, find the employee field edit from 3.3 with its
before/after values, plus the payroll approve/process/disburse events.

### 7.3 Auditor — CA Meera (P6)
- Can open Employees, Payroll (runs, settings), Reports and Audit, all **read-only**.
- No create/edit/approve buttons appear. If anyone asks, the server also returns
  **403** on writes, not just hidden buttons.

### 7.4 Platform Admin wrap-up (P0)
1. Tenant detail → **Refresh headcount** → now shows ~25 (audited).
2. **Break-glass:** raise a time-boxed support-access request for Northwind and show
   the request/expire/revoke lifecycle. **Say clearly:** V1 tracks and audits the
   grant, but **doesn't yet open elevated data access**. That mechanism is the planned
   follow-on.
3. Plan/trial actions: extend the trial, or **Convert to paid**.
4. **Platform audit log** shows everything P0 did today.

**Close:** *"From a contact-form lead to a disbursed payroll and password-protected
payslips. Every persona did their own job, and every step is in the audit log."*

---

## Optional — Exit & Full and Final settlement (P2)

1. Kiran (P5) → **lifecycle**: CONFIRMED → **NOTICE_PERIOD** (notice start date) →
   **SEPARATED** (last working date).
2. **Payroll → F&F** for Kiran: unpaid salary, **leave encashment** (from his leave
   balance), gratuity (only if 5+ years of service, so expect ₹0 for a new joiner and
   say why), advance recovery.
3. Approve → **mark paid**. F&F is never folded into a regular payroll run.

---

## 3. Do NOT demo these as working (they aren't built)

| Topic | What to say |
|---|---|
| Live EPFO / ESIC / TRACES e-filing, statutory compliance exports | Deferred. The registers exist (Act 7.1); filing happens on the government portals. |
| Biometric / GPS / selfie attendance, `POST /attendance/ingest` | Deferred. V1 is self-service web clock-in. |
| SSO (Google/Azure AD), MFA, custom role builder | Deferred. There are six fixed V1 roles. |
| Break-glass actual data access | Request lifecycle only (see 7.4). |
| Recruitment, Performance, Expense, Helpdesk, LMS, OKR, AI assistant, mobile app | Not in V1. |
| Live Razorpay billing | Code is complete, but it needs an HTTPS webhook URL and secrets. Use **Convert to paid** instead. |
| Statutory rates as "certified" | Rates came from a public-source review and haven't had an expert sign-off yet (`docs/PAYROLL_SIGNOFF.md`). Present them as configurable defaults. |
| "Data must stay in India by law" | Don't claim it. Mumbai hosting is a trust/latency choice; DPDP doesn't mandate it. |

---

## 4. After the demo

- [ ] Disable the `northwind` tenant from the Platform Admin console if it shouldn't
      stay on the shared dev DB. Tenants are disabled, not deleted.
- [ ] Record any label/flow mismatches you hit back into this file.
- [ ] Log real defects against the matching case ID in `docs/DEMO_TEST_PLAN.md`.

---

## Appendix A — Known rough edges to work around on stage

1. **Import template is `.csv`, but the server only parses `.xlsx`.** Always upload `.xlsx` (§1.2).
   *Worth fixing before the demo:* either make the server parse CSV, or make the
   template download `.xlsx` and restrict the picker to it.
2. **Import doesn't set department/manager/DOJ/DOB/work state or create logins.**
   Enrich imported records by hand, and create login personas via Add employee.
3. **A login can only be attached when the employee is created.** Plan persona
   creation accordingly.
4. **Payroll needs two different approvers.** Have both the P1 and P2 windows open
   during Act 6.
5. **Payslip password = DOB (`DDMMYYYY`).** An employee without a DOB can't get a
   usable payslip, so set the DOB on every persona.
6. **Email depends on SES and the workers.** Have the Firebase-console fallback ready (§1.3).
