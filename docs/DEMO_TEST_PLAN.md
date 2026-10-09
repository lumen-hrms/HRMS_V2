# HRMS — End-to-End Demo & Acceptance Test Plan

> **Purpose:** a single, ordered script that walks every persona through every
> shipped flow, with the expected result for each step and a tick-box to record
> PASS / FAIL. Use it to rehearse the client demo and to sign off the build.
>
> **Version:** 2026-10-05 · matches the modules in `docs/MODULE_SPECS.md`.
> **Scope:** the 12 V1 modules that are built (Identity & Access, Platform Admin,
> Employee Master, Leave, Attendance, Dashboard, Documents, Notifications,
> Reports & Analytics, Audit Log, Tenant Configuration, Landing/Contact).
> **Out of scope (not built, do not demo as working):** Payroll, Statutory
> Compliance exports (EPFO/ESIC/TRACES), biometric/GPS attendance capture,
> custom role builder, SSO, Recruitment, Performance, Expense, Helpdesk, AI
> assistant, LMS, OKR. See §23.
>
> **Verification note:** case steps were written from the module specs in
> `docs/modules/` and the route/tab structure in the web app. On the first
> walkthrough, adjust any button label or field name that differs in the build,
> and record the real behaviour in Notes rather than skipping the case.

---

## How to use this document

1. Work **top to bottom**. Later suites depend on data created earlier (e.g. Leave
   tests need the employees created in Employee Master).
2. For each case, read the **Steps**, do them, compare with **Expected**, then
   tick **PASS** or **FAIL**. If FAIL, write the observed behaviour in the
   *Notes* column and the case ID in your defect list.
3. A case is **PASS** only if *every* expected point holds. Partial = FAIL.
4. Mark a suite's sign-off box in §0 when all its cases pass.
5. Run the **Demo Storyline (§20)** at least twice before the client session.

**Result legend:** ☐ = not run · ☑ PASS · ☒ FAIL · ⊘ BLOCKED (cannot run; say why in Notes)

### Case ID scheme

`AUTH-01` = suite `AUTH`, case 01. Suite codes:
`LAND` landing & contact · `AUTH` sign-in & session · `PA` platform admin ·
`CFG` tenant configuration & first-run wizard · `EMP` employee master ·
`ACC` access management · `LV` leave · `ATT` attendance · `DASH` dashboard ·
`DOC` documents · `NTF` notifications · `RPT` reports · `AUD` audit log ·
`RBAC` cross-role permission matrix · `ISO` tenant isolation · `SEC` security
non-negotiables · `NFR` non-functional.

---

## 0. Sign-off summary

| # | Suite | Cases | Passed | Failed | Blocked | Signed off by / date |
|---|---|---:|---:|---:|---:|---|
| 1 | Landing & contact (LAND) | 6 | | | | |
| 2 | Sign-in & session (AUTH) | 12 | | | | |
| 3 | Platform Admin console (PA) | 22 | | | | |
| 4 | Tenant config & setup wizard (CFG) | 12 | | | | |
| 5 | Employee Master (EMP) | 20 | | | | |
| 6 | Access management (ACC) | 14 | | | | |
| 7 | Leave management (LV) | 30 | | | | |
| 8 | Attendance (ATT) | 26 | | | | |
| 9 | Dashboard (DASH) | 10 | | | | |
| 10 | Documents (DOC) | 14 | | | | |
| 11 | Notifications / Email log (NTF) | 8 | | | | |
| 12 | Reports & analytics (RPT) | 12 | | | | |
| 13 | Audit log (AUD) | 8 | | | | |
| 14 | Cross-role permission matrix (RBAC) | 24 | | | | |
| 15 | Tenant isolation (ISO) | 8 | | | | |
| 16 | Security non-negotiables (SEC) | 10 | | | | |
| 17 | Non-functional (NFR) | 8 | | | | |
| | **Total** | **≈250** (approximate — recount when you run it) | | | | |

---

## 1. Personas

| Persona | Where they sign in | What they do in the demo | Test account (create in §2) |
|---|---|---|---|
| **Platform Admin** (operator, our team) | `/platform-admin` (operator console — separate login) | Onboards tenants, sets plans, pricing, renewals, break-glass tracking, reads leads and platform audit | `platform.admin@<test-domain>` |
| **Company Admin** | Tenant app `/` | Everything inside the tenant: settings, leave types, holidays, shifts, roles, reports, email log, departments | `ca.<tenant>@<test-domain>` |
| **HR Manager** | Tenant app | Employee master, bulk import, leave admin, team views, attendance settings-free admin, reports, access (≤ HR Manager role) | `hr.<tenant>@<test-domain>` |
| **Line Manager** | Tenant app | Team roster, approvals (leave L1/L2, regularization), team calendar & balances, own data | `lm.<tenant>@<test-domain>` (manages 2 employees) |
| **Employee** | Tenant app | Clock in/out, apply leave, own requests, own documents, own profile | `emp.<tenant>@<test-domain>` (reports to the Line Manager) |
| **Auditor** (read-only) | Tenant app | Read-only views of audit, access trail, all requests, ledger, leave types, reports | `aud.<tenant>@<test-domain>` |

> **Naming:** all test emails must use a domain you control so SES/Firebase
> emails are receivable. Never use real employees' addresses.

---

## 2. Prerequisites & test data (complete BEFORE any suite)

### 2.1 Environment

| ID | Check | Expected | Result |
|---|---|---|---|
| ENV-01 | Open the **preview** web URL (Vercel) and the API health endpoint `GET /api/health` | Web loads; health returns OK | ☐ |
| ENV-02 | Confirm you are on the **preview box**, not a laptop | Background workers (email send, malware scan, accrual, attendance finalization, retention) run only on the preview box. On a laptop they are off and the Email log / scan states will not move | ☐ |
| ENV-03 | Confirm SES is configured (`SES_FROM_ADDRESS` + credentials) and the sender is verified | Notification sends move to `SENT`. If unset, every send shows `FAILED — SES_FROM_ADDRESS is unset`. Fix before the demo or tell the client email is not live | ☐ |
| ENV-04 | Confirm ClamAV (`clamd`) is running on the preview box | An EICAR test file is flagged (see DOC-10). Without clamd, uploads stay "pending scan" and cannot be downloaded (fail-closed — correct behaviour, but it looks broken) | ☐ |
| ENV-05 | Confirm Redis is up (BullMQ) | Leave escalation and scheduled jobs can run | ☐ |
| ENV-06 | Confirm the platform operator account exists and can sign in to `/platform-admin` | Operator console loads | ☐ |
| ENV-07 | Clear browser cache / use a private window per persona | Avoids stale session tokens when switching personas | ☐ |

### 2.2 Demo tenant & data

Create these in order. The seed values below are what the later tests assume.

| Item | Value to use | Created by (case) |
|---|---|---|
| Tenant | `Acme Demo Pvt Ltd` (subdomain `acme-demo`), plan **GROWTH**, dedicated isolation **off** | PA-05 |
| Company Admin login | `ca.acme@<test-domain>` | PA-05 (invite email) / ACC-01 |
| Departments | Engineering, Finance, Sales, HR | EMP-16 |
| Shift | General 09:00–18:00, grace 10 min | CFG-05 |
| Leave types | Casual Leave (CL), Sick Leave (SL), Earned Leave (EL), Comp-Off | LV-01 |
| Holidays | 2 in the current year (one public holiday on a weekday, one on a Saturday) | LV-08 |
| Employees | HR Manager, Line Manager `Priya Rao`, Employee `Rahul Mehta` (reports to Priya), Auditor, plus 6 more across departments | EMP-01…EMP-05 |
| Reporting line | Rahul → Priya (Line Manager) | EMP-04 |

> Keep the names generic if you show this to a client; use the real demo names only in an internal rehearsal.

---

## 3. Suite LAND — Public landing page & contact form

Unauthenticated. Use a private window.

| ID | Steps | Expected | Result |
|---|---|---|---|
| LAND-01 | Open the root URL signed out | Public landing page renders; no dashboard; no sidebar | ☐ |
| LAND-02 | Scroll to the `#contact` section; check layout on a phone-width viewport (≈390 px) | Form is usable; no horizontal scrolling | ☐ |
| LAND-03 | Submit the contact form with all required fields blank | Client-side validation messages; nothing sent | ☐ |
| LAND-04 | Submit a valid enquiry (name, company, work email, employee count, message) | Success confirmation shown; a row is created (verify in PA-17 Leads) | ☐ |
| LAND-05 | Submit 6+ times rapidly from the same client | Rate limiter returns a friendly error after the limit; no crash | ☐ |
| LAND-06 | Submit an enquiry while SES is unconfigured | Lead still appears in Leads (the lead is saved even if the notify email fails) | ☐ |

---

## 4. Suite AUTH — Sign-in, session & password reset

| ID | Steps | Expected | Result |
|---|---|---|---|
| AUTH-01 | Sign in as **Company Admin** with correct credentials | Lands on the dashboard; user name and role shown in the header/sidebar | ☐ |
| AUTH-02 | Sign in with a correct email and **wrong password** | Friendly "invalid email or password" message; no session created | ☐ |
| AUTH-03 | Sign in with an **unknown email** | Same generic message as AUTH-02 (no account enumeration) | ☐ |
| AUTH-04 | Open a protected URL (e.g. `/employees`) while signed out | Redirected to `/login`; after sign-in, returned to the intended page or the dashboard | ☐ |
| AUTH-05 | Refresh the browser after signing in | Session persists; no re-login required | ☐ |
| AUTH-06 | Sign out via the user menu | Redirected to login; pressing Back does not show protected data | ☐ |
| AUTH-07 | Use "Forgot password?" with a **registered** email | Generic success message shown; a branded reset email arrives (SES) with a working link | ☐ |
| AUTH-08 | Use "Forgot password?" with an **unregistered** email | Same generic success message as AUTH-07 (non-enumerating); no email sent | ☐ |
| AUTH-09 | Open the reset link, set a new password, sign in with it | Sign-in works with the new password; old password fails | ☐ |
| AUTH-10 | Sign in as an **inactive** user (deactivated in ACC-08) | Sign-in blocked with an access-denied message | ☐ |
| AUTH-11 | Sign in to a **suspended tenant** (suspended in PA-10) | Blocked; message says the workspace is suspended | ☐ |
| AUTH-12 | Sign in as a tenant user at the **platform admin** login (`/platform-admin`) | Refused — tenant users cannot open the operator console | ☐ |

---

## 5. Suite PA — Platform Admin console (operator)

Sign in as **Platform Admin** at `/platform-admin`.

| ID | Steps | Expected | Result |
|---|---|---|---|
| PA-01 | Sign in as the operator | Operator console loads with navigation: Tenants, Plans, Leads, Settings, Audit | ☐ |
| PA-02 | Open **Tenants** | List shows existing tenants with name, plan, status, employee count | ☐ |
| PA-03 | Filter / search the tenant list (if available) by name or status | List narrows correctly | ☐ |
| PA-04 | Open **Plans** | Plans listed (STARTER / GROWTH / ENTERPRISE) with their included modules and features | ☐ |
| PA-05 | Click **New tenant** (`/platform-admin/tenants/new`). Enter Acme Demo Pvt Ltd, subdomain `acme-demo`, plan GROWTH, Company Admin email, submit | Tenant created; admin invite email sent (or logged as `FAILED` if SES is unset); tenant appears in the list | ☐ |
| PA-06 | Try to create a tenant with a **duplicate subdomain** | Rejected with a clear validation error; no second tenant created | ☐ |
| PA-07 | Try to create a tenant with an **invalid subdomain** (spaces, uppercase, symbols) | Rejected with a validation error | ☐ |
| PA-08 | Open the new tenant's detail page | Shows metadata, plan, subscription, renewal date, headcount, break-glass section | ☐ |
| PA-09 | Change the tenant's **plan** (e.g. GROWTH → ENTERPRISE) | Saved; detail page updates; entitlements change accordingly | ☐ |
| PA-10 | **Suspend** the tenant, then sign in as its user (AUTH-11), then **resume** it | Suspended: tenant users blocked. Resumed: access returns. Both actions appear in the platform audit log (AUD-08) | ☐ |
| PA-11 | Edit the tenant's **pricing** | Saved and reflected on the detail page | ☐ |
| PA-12 | **Refresh headcount** for the tenant | Employee count updates to the live number; action is logged | ☐ |
| PA-13 | **Renew** the subscription | Renewal date moves forward; action recorded | ☐ |
| PA-14 | Resend the **admin reset** email for the tenant | Action succeeds; reset email sent (or logged FAILED if SES unset) | ☐ |
| PA-15 | Request a **break-glass** grant for the tenant with a reason and expiry | Grant appears in the tenant's break-glass list as active with its expiry | ☐ |
| PA-16 | **Revoke** the break-glass grant | Status changes to revoked; it is no longer active | ☐ |
| PA-17 | Open **Leads** | The contact-form enquiries from LAND-04 appear, newest first | ☐ |
| PA-18 | Open **Settings**; add a notify email address; save | Saved; a new LAND-04 submission notifies that address (when SES is live) | ☐ |
| PA-19 | Remove the notify email; save | Saved; list updates | ☐ |
| PA-20 | Open **Audit** | Platform audit entries for PA-05, PA-09, PA-10, PA-12, PA-15, PA-16, PA-18 appear | ☐ |
| PA-21 | Attempt to open a **tenant's employee data** from the operator console | Not possible; the operator has no tenant business-data view (by design) | ☐ |
| PA-22 | Sign out and confirm the console is no longer reachable without signing in | Redirected to the operator login | ☐ |

> **Demo note:** break-glass currently tracks requests, expiry and revocation,
> but does **not** yet give the operator actual elevated read access to tenant
> data. Show the lifecycle; do not claim live tenant-data access during it.

---

## 6. Suite CFG — Tenant configuration & first-run setup wizard

Sign in as **Company Admin** (first login of `acme-demo`).

| ID | Steps | Expected | Result |
|---|---|---|---|
| CFG-01 | Sign in for the first time | First-run setup wizard appears | ☐ |
| CFG-02 | Skip the wizard | Dashboard opens; wizard can be resumed later | ☐ |
| CFG-03 | Re-open the wizard (from Settings or its link) | Resumes from the saved step; previously entered values kept | ☐ |
| CFG-04 | Set company details (name, FY start month, timezone, payroll cut-off day) and save | Saved; values persist after reload | ☐ |
| CFG-05 | Create shift **General** 09:00–18:00, grace 10 min, target hours 9 | Shift saved; listed in Settings › Shifts | ☐ |
| CFG-06 | Edit the shift (change grace to 15 min) | Updated; attendance late-marking uses the new grace (verify in ATT-06 later) | ☐ |
| CFG-07 | Try to delete a shift that employees are assigned to (if the rule applies) | Blocked with a clear message, or deletion allowed with reassignment — must not orphan employees silently | ☐ |
| CFG-08 | Set attendance settings: regularization window (days), monthly regularization cap, unactioned behaviour (auto-approve / auto-reject) | Saved; visible on reload | ☐ |
| CFG-09 | Set general leave settings (`allowLopRequests`, `fyStartMonth`) | Saved; visible on reload | ☐ |
| CFG-10 | Sign in as **HR Manager** and open Settings | Attendance/leave *admin settings* not editable by HR Manager (Company Admin only) — verify the screen is read-only or hidden per matrix | ☐ |
| CFG-11 | Sign in as an **Employee** and try to reach `/attendance` settings URL directly | Blocked / hidden | ☐ |
| CFG-12 | Verify the **plan gating**: on a tenant WITHOUT the Attendance entitlement, open Attendance | Blocked with a plan-upgrade message (entitlement enforced server-side, not just hidden) | ☐ |

---

## 7. Suite EMP — Employee Master & Org Structure

Sign in as **HR Manager** unless stated.

### 7.1 Departments & org structure

| ID | Steps | Expected | Result |
|---|---|---|---|
| EMP-01 | Open **Departments**; create Engineering, Finance, Sales, HR | All four created and listed | ☐ |
| EMP-02 | Rename a department; try to delete a department that still has employees | Rename saved; delete blocked while employees are attached | ☐ |
| EMP-03 | Open **Org Chart** | Interactive chart shows Company Admin at top; expand/collapse works; click a node to open the person | ☐ |

### 7.2 Create & manage employees

| ID | Steps | Expected | Result |
|---|---|---|---|
| EMP-04 | **Employees → Add employee** (`/employees/new`). Create **Priya Rao** (Line Manager, Engineering). Create login with role LINE_MANAGER | Employee saved; login invite sent; appears in list | ☐ |
| EMP-05 | Create **Rahul Mehta** (Employee, Engineering), reporting manager = Priya Rao, role EMPLOYEE | Saved; org chart shows Rahul under Priya | ☐ |
| EMP-06 | Create an employee with a **duplicate work email** | Rejected with a clear duplicate message | ☐ |
| EMP-07 | Submit the create form with **required fields missing** | Field-level validation; nothing saved | ☐ |
| EMP-08 | Create an employee with a **date of joining in the future** (if policy allows) and check the lifecycle status | Status reflects the joining rules; no crash | ☐ |
| EMP-09 | Open **Employees** list; search by name; filter by department and status | Results filter correctly; counts match | ☐ |
| EMP-10 | Open an employee's **detail** page | Tabs/sections for personal, job, compensation, documents, emergency contacts visible | ☐ |
| EMP-11 | **Edit** job details (designation, department, reporting manager, employment type, CTC, pay grade, cost centre) and save | Saved; the change is written to the audit log with before/after (verify in AUD-03) | ☐ |
| EMP-12 | Change the **lifecycle** (e.g. ACTIVE → ON_NOTICE → SEPARATED), giving a separation reason | Status changes; separation reason captured (used by attrition report RPT-06) | ☐ |
| EMP-13 | Attempt an illegal lifecycle jump (e.g. SEPARATED → ACTIVE without rules) | Rejected per the lifecycle state machine, or allowed only where the rules permit | ☐ |
| EMP-14 | **Sensitive fields**: enter PAN and Aadhaar on an employee | Aadhaar stored as **last 4 digits only** (see SEC-03); PAN masked in the view | ☐ |
| EMP-15 | Click **Reveal** on a masked sensitive field | Full value shown only for an authorised role; the reveal is logged (AUD-05) | ☐ |
| EMP-16 | Add **emergency contacts** (add, edit, delete) | Each action works and persists | ☐ |
| EMP-17 | Upload a **profile photo** (valid JPG/PNG) | Photo appears on the profile and in the org chart | ☐ |
| EMP-18 | Upload an invalid photo (e.g. a .txt renamed to .jpg, or oversize) | Rejected with a clear message | ☐ |
| EMP-19 | **Bulk import**: download the template, fill 5 rows (include 1 deliberately bad row), upload | Valid rows created; the bad row reported with its line number and reason; nothing half-imported | ☐ |
| EMP-20 | Sign in as **Line Manager** and open **Employees** | Sees only their own reports (recursive line-manager scope), not the whole company | ☐ |

---

## 8. Suite ACC — Access management (users, roles, status)

Sign in as **Company Admin**, then **HR Manager** and **Auditor** where stated.

| ID | Steps | Expected | Result |
|---|---|---|---|
| ACC-01 | Open **Access › Users** | List of tenant logins with name, email, role, status | ☐ |
| ACC-02 | Company Admin changes **Rahul**'s role to HR Manager, then back to Employee | Role changes saved each time; access follows the new role immediately | ☐ |
| ACC-03 | Company Admin grants **COMPANY_ADMIN** to another user | Allowed (only Company Admin can grant this) | ☐ |
| ACC-04 | HR Manager tries to change a role | Role control disabled or request refused by the server | ☐ |
| ACC-05 | HR Manager tries to create/assign COMPANY_ADMIN via any path | Refused (HR Manager ceiling) | ☐ |
| ACC-06 | Company Admin tries to **demote themselves** when they are the last admin | Blocked ("last admin" rule) | ☐ |
| ACC-07 | A user tries to **deactivate themselves** | Blocked (self-deactivation rule) | ☐ |
| ACC-08 | HR Manager **deactivates** Rahul's login | Status = inactive; Rahul cannot sign in (AUTH-10) | ☐ |
| ACC-09 | Re-activate Rahul | Sign-in works again | ☐ |
| ACC-10 | HR Manager triggers a **password reset** for Rahul | Reset email sent (or FAILED logged if SES unset); action recorded | ☐ |
| ACC-11 | Open a user's **activity** (`users/:id/activity`) | Shows their login and access events | ☐ |
| ACC-12 | Open **Access › Audit › Login** feed | Successful and failed (server-observed) logins listed with IP and user-agent. Note: wrong-password attempts are *not* recorded (known, owner-approved — §12) | ☐ |
| ACC-13 | Open **Access › Audit › Access** feed | Role, status, reset and login-created events appear | ☐ |
| ACC-14 | **Auditor** opens Access: can read users and audit; cannot change roles, status or trigger resets | Read-only; all write controls hidden or refused | ☐ |

---

## 9. Suite LV — Leave management

Sign in as **Company Admin** for setup; then personas per case.

### 9.1 Setup (Company Admin / HR Manager)

| ID | Steps | Expected | Result |
|---|---|---|---|
| LV-01 | Open **Leave › Leave Types**; create Casual (CL), Sick (SL), Earned (EL) | Each saved with annual quota and flags | ☐ |
| LV-02 | Set **minimum notice days** on Sick = 0 and on Earned = 7 | Saved | ☐ |
| LV-03 | Set **gender restriction** on a type (e.g. Maternity — Female) | Saved; a Male employee cannot apply for it (LV-17) | ☐ |
| LV-04 | Mark one type **requires approval = off** | Saved; applications of this type auto-approve per settings | ☐ |
| LV-05 | Mark Comp-Off as the **designated comp-off type** | Saved; the flag is on the type | ☐ |
| LV-06 | **Initialise balances** for the year (`initialize/:year`) | Each active employee gets balances; the action is idempotent (run twice → no duplicate credit) | ☐ |
| LV-07 | Open **Leave › Settings** (Company Admin): approval levels (1 or 2), escalation timers, FY start month, LOP allowed | Saved; visible on reload | ☐ |
| LV-08 | Open **Holidays**; add two holidays (one on a weekday, one on a Saturday); edit one; delete one | Each action works; list is sorted by date | ☐ |

### 9.2 Employee applies & manages own leave (Employee: Rahul)

| ID | Steps | Expected | Result |
|---|---|---|---|
| LV-09 | Open **Overview** | Balances per type for the year, pending requests, upcoming leave | ☐ |
| LV-10 | **Apply**: Casual Leave, 2 working days spanning a weekend, with a reason | Working-day count **excludes** weekends and public holidays (verify the count shown matches the calendar); request created as PENDING | ☐ |
| LV-11 | Apply for a date range that **includes a public holiday** | Holiday not counted as a leave day | ☐ |
| LV-12 | Apply with **insufficient balance** (more days than available) | Blocked with an insufficient-balance message (unless LOP is allowed, then labelled as LOP) | ☐ |
| LV-13 | Apply for a **past date** (if not permitted) | Blocked | ☐ |
| LV-14 | Apply for Sick Leave **less than the minimum notice** (if rule set) | Blocked with notice message | ☐ |
| LV-15 | Apply with an **overlapping** existing request | Blocked with an overlap message | ☐ |
| LV-16 | **Attach** a document (PDF, ≤10 MB) to a Sick Leave request | Upload succeeds; the file appears on the request (DOC-06) | ☐ |
| LV-17 | Rahul tries to apply for the **gender-restricted** type while his gender is set to Male (LV-03) | Blocked by the gender restriction | ☐ |
| LV-18 | Open **My Requests**; filter by status | Lists only Rahul's requests; statuses correct | ☐ |
| LV-19 | **Cancel** a PENDING request | Status = CANCELLED; balance restored; approver notified (NTF-02) | ☐ |
| LV-20 | Attempt to **cancel an APPROVED** leave that is in the past | Blocked (or cancellation requires the rules) — balance and attendance must not be left inconsistent | ☐ |

### 9.3 Approvals (Line Manager: Priya)

| ID | Steps | Expected | Result |
|---|---|---|---|
| LV-21 | Priya opens **Approvals**; sees Rahul's pending request | Visible; shows dates, days, type, reason, attachment | ☐ |
| LV-22 | Priya **approves** Rahul's request (L1, or L2 if two-level chain) | Status moves to APPROVED (or to L2 pending); Rahul notified | ☐ |
| LV-23 | Priya **rejects** another request with a reason | Status REJECTED; balance restored; Rahul sees the reason | ☐ |
| LV-24 | Priya tries to approve a request **outside her reporting line** (by direct URL / id) | Refused (403) | ☐ |
| LV-25 | Approval auto-escalation: leave one L1 request untouched past the escalation timer | Escalates to the next approver (verify in NTF log and request timeline); requires preview worker running | ☐ |
| LV-26 | Priya views **Team Calendar** | Her reports' leave shown on a calendar with holidays marked | ☐ |
| LV-27 | Priya views **Team Balances** | Her reports' balances per type; she cannot see employees outside her team | ☐ |
| LV-28 | Priya applies **balance adjustment** (if she has the permission) or is refused | Behaviour matches the matrix (RBAC-14) | ☐ |

### 9.4 Admin views & ledger (HR Manager / Auditor)

| ID | Steps | Expected | Result |
|---|---|---|---|
| LV-29 | HR Manager opens **All Requests**, filters by department and status | Company-wide list; filters work | ☐ |
| LV-30 | HR Manager makes a **balance adjustment** (+2 CL, reason "carry-forward") and then opens **Balance Ledger** | Adjustment appears in the ledger with reason, actor and timestamp. Auditor can view the ledger but not adjust | ☐ |

> **Additional Leave checks to run (same suite, reuse data):**
> * **Comp-off:** Rahul clocks in on a public holiday → comp-off credited once. Clock in again the same day → no second credit (idempotent). Verify in Ledger.
> * **Leave ↔ Attendance:** on approval of a leave covering a weekday, that day's attendance shows **ON_LEAVE** (verify in ATT-20). Cancelling the leave reverses it.
> * **Accrual:** after the monthly/quarterly accrual run (preview box), balances increase; a mid-year joiner is prorated.

---

## 10. Suite ATT — Attendance & time tracking

Sign in as **Employee: Rahul** for personal flows, **Line Manager: Priya** for team flows, **Company Admin** for settings.

### 10.1 Self-service (Rahul)

| ID | Steps | Expected | Result |
|---|---|---|---|
| ATT-01 | Open **Attendance › My Attendance**; click **Clock in** | Check-in time recorded (IST display); status = present; button changes to Clock out / Break | ☐ |
| ATT-02 | Click **Start break**, wait 1–2 min, click **End break** | Break recorded; worked hours exclude break time | ☐ |
| ATT-03 | Try **Clock in** twice | Second attempt refused ("already clocked in") | ☐ |
| ATT-04 | Try **Clock out** before clocking in | Refused with a clear message | ☐ |
| ATT-05 | Try **Start break** while on break | Refused | ☐ |
| ATT-06 | Clock in **after shift start + grace** (use a time past 09:10 with shift grace 10) | Marked **LATE** (grace applied per CFG-06) | ☐ |
| ATT-07 | Clock out, then open **Today** | Shows check-in, check-out, break time, worked hours, overtime if beyond target | ☐ |
| ATT-08 | Open **Calendar** for the month | Each day coloured by status (present, late, absent, leave, holiday, weekly-off) | ☐ |
| ATT-09 | Open **Stats** | Present/absent/late/leave counts and total worked hours match the calendar | ☐ |
| ATT-10 | Submit a **regularization** request for a missed punch (date within window, with a reason) | Request PENDING; visible in My Attendance | ☐ |
| ATT-11 | Submit a regularization for a date **outside the window** | Refused with a window message | ☐ |
| ATT-12 | Exceed the **monthly regularization cap** | Refused with a cap message | ☐ |
| ATT-13 | Attach **evidence** to a regularization (`regularization/:id/evidence`) | Upload succeeds; visible to approver (DOC-07) | ☐ |
| ATT-14 | Cancel own PENDING regularization | Status CANCELLED | ☐ |

### 10.2 Team & approvals (Priya)

| ID | Steps | Expected | Result |
|---|---|---|---|
| ATT-15 | Priya opens **Team** tab | Roster of her reports with today's status | ☐ |
| ATT-16 | Priya **manually marks** attendance for Rahul for a past day (e.g. "On duty") with a reason | Saved; audited (AUD-06) | ☐ |
| ATT-17 | Priya opens **Approvals** tab; sees Rahul's regularization | Visible with date, reason, evidence | ☐ |
| ATT-18 | Priya **approves** the regularization | Punch/status corrected for that day; Rahul notified | ☐ |
| ATT-19 | Priya **rejects** another regularization with a reason | Status REJECTED; reason shown to Rahul | ☐ |
| ATT-20 | Verify **leave ↔ attendance**: the day covered by Rahul's approved leave (LV-22) | Attendance shows **ON_LEAVE** for that day | ☐ |
| ATT-21 | Priya uses **bulk approve** on several pending regularizations | All selected approved in one action; each audited | ☐ |

### 10.3 Settings & finalization (Company Admin / ops)

| ID | Steps | Expected | Result |
|---|---|---|---|
| ATT-22 | Company Admin opens **Settings**; edits shifts and attendance config | Saved; new rules apply to subsequent punches | ☐ |
| ATT-23 | Company Admin views **LOP days** report for a month | LOP days computed from leave and absence; figures plausible vs. ATT-09 | ☐ |
| ATT-24 | **Nightly finalization** (preview box): a day with no punches and no leave for an employee | Marked genuine **ABSENT** the next morning; a holiday or weekly-off is never marked absent | ☐ |
| ATT-25 | **Payroll cut-off** auto-resolve: a still-PENDING regularization after cut-off | Auto-approved or rejected per the tenant's `unactionedBehavior` | ☐ |
| ATT-26 | Employee with **no shift assigned**, clocks in | Handled gracefully (default or clear error) — no crash | ☐ |

> **Demo caveat:** GPS, biometric and selfie-QR capture are **not built**. Do not
> demo them. Attendance is web clock-in/out and manual marking only.

---

## 11. Suite DASH — Role-aware dashboard

| ID | Steps | Expected | Result |
|---|---|---|---|
| DASH-01 | Company Admin opens Dashboard | Company-level tiles (headcount, leave, attendance summary) | ☐ |
| DASH-02 | HR Manager opens Dashboard | HR-relevant tiles (joiners/leavers, pending items) | ☐ |
| DASH-03 | Line Manager opens Dashboard | Team view: pending approvals list with inline Approve / Reject | ☐ |
| DASH-04 | Line Manager clicks **Approve** inline on a pending leave | Action succeeds; whole dashboard refreshes; toast shown | ☐ |
| DASH-05 | Employee opens Dashboard | Own leave balances, own today's attendance, quick actions (Clock in/out, breaks) | ☐ |
| DASH-06 | Employee uses **Clock in** from the dashboard card | Works; card updates; matches ATT-01 | ☐ |
| DASH-07 | Auditor opens Dashboard | Read-only; no action buttons | ☐ |
| DASH-08 | Dashboard for a **tenant without the Attendance entitlement** | Attendance card hidden/blocked; no error | ☐ |
| DASH-09 | Dashboard on a phone-width viewport | Cards stack; no horizontal scroll | ☐ |
| DASH-10 | Payroll-dependent tiles | Not shown (Payroll not built — do not demo) | ☐ |

---

## 12. Suite DOC — Documents (uploads, malware scan, download, delete)

Sign in as **HR Manager** for profile documents, **Employee** for own.

| ID | Steps | Expected | Result |
|---|---|---|---|
| DOC-01 | HR Manager opens Rahul → **Documents** → uploads a PDF (≤10 MB) typed as "Offer letter" | Upload accepted; status shows **PENDING scan**, then **CLEAN** once scanned | ☐ |
| DOC-02 | Try to **download** the document while it is still pending scan | Download link not issued (fail-closed) | ☐ |
| DOC-03 | Upload a file **larger than 10 MB** | Rejected with a size message before storage | ☐ |
| DOC-04 | Upload a **disallowed type** (e.g. .exe, or .zip) | Rejected (MIME allow-list) | ☐ |
| DOC-05 | Upload a **.txt renamed to .pdf** (magic-byte mismatch) | Rejected | ☐ |
| DOC-06 | Rahul uploads a leave attachment on a request (LV-16) | Visible to Priya when approving; Rahul can download his own | ☐ |
| DOC-07 | Priya downloads Rahul's regularization evidence | Works (subject employee's scope) | ☐ |
| DOC-08 | Download a clean document | File downloads with `attachment` disposition; filename preserved | ☐ |
| DOC-09 | Employee tries to open **another employee's** document by ID in the URL | Refused (403/404) | ☐ |
| DOC-10 | Upload the **EICAR test string** as a .txt/.pdf | Flagged as malware; status **INFECTED/BLOCKED**; download refused; HR notified (NTF) | ☐ |
| DOC-11 | Change a document's **category** (`Patch :id/category`) | Saved | ☐ |
| DOC-12 | **Delete** a document (soft delete) | Disappears from the list; row remains in the database (soft delete); action audited | ☐ |
| DOC-13 | Employee tries to delete a document they don't own | Refused | ☐ |
| DOC-14 | Auditor views documents | Read-only; cannot upload or delete | ☐ |

---

## 13. Suite NTF — Notifications & Email log

| ID | Steps | Expected | Result |
|---|---|---|---|
| NTF-01 | Rahul applies for leave | A notification row is created for Priya (QUEUED → SENT) | ☐ |
| NTF-02 | Priya approves | A notification for Rahul appears in the Email log | ☐ |
| NTF-03 | Trigger the **same** notification twice (e.g. double-click approve) | Only one email row per recipient (dedupe) | ☐ |
| NTF-04 | Open **Email log** (`/notifications`) as Company Admin | Rows listed with recipient, template, status, time | ☐ |
| NTF-05 | Filter log by status **FAILED** | Lists failed sends with their error | ☐ |
| NTF-06 | Click **Retry** on a FAILED row (after fixing SES config on preview) | Row becomes SENT | ☐ |
| NTF-07 | Auditor opens Email log | Read-only; no retry button | ☐ |
| NTF-08 | Employee tries to open Email log URL | Refused / hidden | ☐ |

---

## 14. Suite RPT — Reports & analytics

Sign in as **Company Admin** and **HR Manager** (both allowed). Then as **Line Manager** and **Employee** to confirm refusal.

| ID | Steps | Expected | Result |
|---|---|---|---|
| RPT-01 | Open **Reports** → **Headcount** with an as-of date = today | Total headcount; breakdown by department and employment type | ☐ |
| RPT-02 | Change the **as-of date** to last month | Headcount reflects employees active on that date | ☐ |
| RPT-03 | Open **Movement** for the month | Joiners and leavers listed; net change = joiners − leavers | ☐ |
| RPT-04 | Check arithmetic: headcount(start) + joiners − leavers = headcount(end) | Holds true | ☐ |
| RPT-05 | Open **Attrition** for the period | Attrition rate, average tenure, voluntary vs involuntary split | ☐ |
| RPT-06 | Confirm the voluntary/involuntary split matches the separation reasons captured in EMP-12 | Counts match | ☐ |
| RPT-07 | **Export Headcount as CSV** | File downloads; opens in a spreadsheet; numbers match the screen | ☐ |
| RPT-08 | **Export Movement as XLSX** | File downloads; opens; formatting readable | ☐ |
| RPT-09 | Export Attrition as CSV | Downloads; matches screen | ☐ |
| RPT-10 | Line Manager tries `/reports` | Refused (COMPANY_ADMIN + HR_MANAGER only) | ☐ |
| RPT-11 | Employee tries `GET /api/reports/headcount` directly in the browser | 403 | ☐ |
| RPT-12 | Payroll cost / statutory register tiles | Not shown — Payroll not built (do not demo) | ☐ |

---

## 15. Suite AUD — Audit log

Sign in as **Company Admin** (full) and **Auditor** (read-only).

| ID | Steps | Expected | Result |
|---|---|---|---|
| AUD-01 | Open **Access › Audit › All activity** | Cross-module feed of recent events, newest first | ☐ |
| AUD-02 | Filter by **module** (Leave, Attendance, Employees, Documents, Access…) | Only that module's events shown | ☐ |
| AUD-03 | Find the **EMP-11** edit | Entry shows actor, time, field, **before and after** values | ☐ |
| AUD-04 | Find the leave **approve** from LV-22 and the **balance adjustment** from LV-30 | Both present with actor and reason | ☐ |
| AUD-05 | Find the **sensitive reveal** from EMP-15 | Logged with actor and time (reveal is audited) | ☐ |
| AUD-06 | Find the **manual attendance mark** from ATT-16 and approvals from ATT-18 | Present | ☐ |
| AUD-07 | Auditor opens the audit log | Can read; no edit or delete controls exist | ☐ |
| AUD-08 | Confirm the platform operator's **suspend/resume** (PA-10) is in the *platform* audit, not the tenant audit | Correct separation (platform schema is separate by design) | ☐ |

---

## 16. Suite RBAC — Cross-role permission matrix

Each row must be tested as the persona named. "Refused" means: blocked in the UI **and** the direct API call returns 403 (or 404 for hidden records). Test the API with the persona's session (e.g. browser devtools, or Swagger at `/api/docs` if enabled).

| ID | Capability | Company Admin | HR Manager | Line Manager | Employee | Auditor |
|---|---|:-:|:-:|:-:|:-:|:-:|
| RBAC-01 | Sign in to tenant app | ✅ | ✅ | ✅ | ✅ | ✅ |
| RBAC-02 | Open platform operator console | ❌ | ❌ | ❌ | ❌ | ❌ |
| RBAC-03 | View tenant user list + roles | ✅ | ✅ | ❌ | ❌ | ✅ read |
| RBAC-04 | Create employee (Employee Master) | ✅ | ✅ | ❌ | ❌ | ❌ |
| RBAC-05 | Edit employee job / CTC fields | ✅ | ✅ | ❌ | ❌ | ❌ |
| RBAC-06 | View sensitive (PAN/Aadhaar) reveal | ✅ | ✅ | ❌ | own only | ❌ |
| RBAC-07 | Change a user's role | ✅ | ❌ | ❌ | ❌ | ❌ |
| RBAC-08 | Grant COMPANY_ADMIN | ✅ | ❌ | ❌ | ❌ | ❌ |
| RBAC-09 | Activate / deactivate a login | ✅ | ✅ | ❌ | ❌ | ❌ |
| RBAC-10 | Trigger password reset for others | ✅ | ✅ | ❌ | ❌ | ❌ |
| RBAC-11 | Read login / access audit | ✅ | ❌ | ❌ | ❌ | ✅ read |
| RBAC-12 | Apply for own leave | ✅ | ✅ | ✅ | ✅ | ❌ |
| RBAC-13 | Approve leave (own reports only) | ✅ | ✅ | ✅ own reports | ❌ | ❌ |
| RBAC-14 | Leave balance adjustment | ✅ | ✅ | ❌ | ❌ | ❌ |
| RBAC-15 | Leave types / settings | ✅ | ✅ types / ✅ settings ❌ | ❌ | ❌ | ✅ read types |
| RBAC-16 | Clock in / out (own) | ✅ | ✅ | ✅ | ✅ | ❌ |
| RBAC-17 | Team roster & manual attendance mark | ✅ | ✅ | ✅ own reports | ❌ | ❌ |
| RBAC-18 | Attendance settings / shifts | ✅ | ❌ | ❌ | ❌ | ❌ |
| RBAC-19 | Reports (headcount / movement / attrition) | ✅ | ✅ | ❌ | ❌ | ❌ |
| RBAC-20 | Email log & retry | ✅ | ✅ | ❌ | ❌ | ✅ read |
| RBAC-21 | Departments create / edit / delete | ✅ | ✅ | ❌ | ❌ | ❌ |
| RBAC-22 | Upload / delete documents for an employee | ✅ | ✅ | ✅ own reports (evidence only) | own (leave / regularization) | ❌ |
| RBAC-23 | Tenant configuration & setup wizard | ✅ | ❌ | ❌ | ❌ | ✅ read settings |
| RBAC-24 | Line Manager sees only own reports' data (not company-wide) | n/a | n/a | ✅ enforced | n/a | n/a |

> **Matrix caveat (open gap, owner-tracked):** Line-Manager row-scoping was
> permissive in Leave's *list* views until the recursive reporting-line check
> landed — test RBAC-24 explicitly by requesting a non-report's record by ID.
> Record the result honestly.

---

## 17. Suite ISO — Tenant isolation (adversarial)

**Treat any FAIL here as a P0 — stop the demo.** Requires two tenants: `acme-demo` (tenant A) and a second test tenant `beta-test` (tenant B) with its own employees.

| ID | Steps | Expected | Result |
|---|---|---|---|
| ISO-01 | Sign in as tenant A's Company Admin. Note the id of a tenant-B employee (from a second browser session). Request that employee via `GET /api/employees/:id` | 404 / not found — never the data | ☐ |
| ISO-02 | As tenant A, `PATCH /api/employees/:tenantB_id` with a changed field | Refused; tenant B row unchanged (verify from tenant B's session) | ☐ |
| ISO-03 | As tenant A, attempt to **approve** a tenant-B leave request by id | Refused; request unchanged | ☐ |
| ISO-04 | Send a request with a **tenantId in the body or query** pointing to tenant B | Ignored; the server uses the token's tenant only | ☐ |
| ISO-05 | Tamper the Authorization token's custom claim (edited token) | Rejected by the server (signature check) | ☐ |
| ISO-06 | Attempt to read tenant B's **documents** via a guessed document id | 404 / refused | ☐ |
| ISO-07 | Attempt to read tenant B's **audit log** from tenant A's session | Only tenant A events returned | ☐ |
| ISO-08 | Tenant A user list (`/api/access/users`) contains only tenant A users | Confirmed | ☐ |

> Automated equivalent: `apps/api/test/tenant-isolation.e2e-spec.ts` and
> `apps/api/test/access.e2e-spec.ts`. Run `npm run test:e2e` (or `./scripts/dev.sh test`)
> and record the result in the NFR-07 row (§19).

---

## 18. Suite SEC — Security non-negotiables

| ID | Check | Expected | Result |
|---|---|---|---|
| SEC-01 | Money fields (CTC, pay) entered as `1234.56` | Stored and displayed with exact precision; no rounding drift on re-save (`NUMERIC`, not float) | ☐ |
| SEC-02 | Timestamps: clock in at a known time | Stored in UTC, displayed in IST (cross-check with the DB row) | ☐ |
| SEC-03 | Aadhaar entered as `1234 5678 9012` | Only last 4 (`9012`) is stored; full number is never shown or saved (DB inspection) | ☐ |
| SEC-04 | PAN stored in the database | Stored as ciphertext; only a masked form is shown in the UI (DB inspection shows no plain PAN) | ☐ |
| SEC-05 | Reveal a PAN and check audit | Reveal logged (AUD-05) | ☐ |
| SEC-06 | Attempt to **update or delete** an audit-log row via SQL with the app role | Permission denied (append-only at the DB grant level) | ☐ |
| SEC-07 | Attempt to **update** a platform audit row via the platform role | Permission denied | ☐ |
| SEC-08 | Upload a malicious file (DOC-10) | Blocked before any presigned URL is issued | ☐ |
| SEC-09 | Login rate / brute-force: 10 wrong passwords quickly | Throttled or handled without leaking whether the account exists | ☐ |
| SEC-10 | Browser devtools: check no tokens or secrets in `localStorage`/page source beyond the Firebase ID token flow | No API keys beyond public Firebase config; no database strings | ☐ |

---

## 19. Suite NFR — Non-functional

| ID | Check | Expected | Result |
|---|---|---|---|
| NFR-01 | Page load of the dashboard on the preview URL | Under ~3 s on a normal connection | ☐ |
| NFR-02 | Phone-width (≈390 px) — sign in, dashboard, apply leave, clock in | All usable; no horizontal scroll; 16 px side gutter | ☐ |
| NFR-03 | Tablet width (≈768 px) — org chart and employee list | Readable; no clipped content | ☐ |
| NFR-04 | Empty states: a brand-new tenant with no leave requests | Friendly empty-state messages; no errors | ☐ |
| NFR-05 | Error handling: stop the API briefly and click an action | Clear error toast; UI recovers when the API returns | ☐ |
| NFR-06 | Timezone: a leave date entered in IST shows the same date in the list | No off-by-one day | ☐ |
| NFR-07 | Run automated suites: `npm run test:api` and `npm run test:e2e` (or `./scripts/dev.sh test`) | All green; record counts (~214 unit + ~44 documents e2e at last sync — check current) | ☐ |
| NFR-08 | `npm run build` and `npm run lint` at repo root | Clean | ☐ |

---

## 20. Demo storyline (client session, ~45–60 min)

Run this in order. Each step cites the detailed case to fall back on.

| Step | Persona | What you show | Cases |
|---|---|---|---|
| 1 | Public | Landing page; submit a demo-request form; show it arriving in Platform Leads | LAND-01, LAND-04, PA-17 |
| 2 | Platform Admin | Create the tenant; show plan and subscription; suspend & resume to prove control | PA-05, PA-09, PA-10 |
| 3 | Company Admin | First-run wizard; company settings; create shift and leave types; holidays | CFG-01, CFG-04, CFG-05, LV-01, LV-08 |
| 4 | HR Manager | Create departments; add Priya and Rahul; show org chart; bulk import 5 rows with one error | EMP-01, EMP-04, EMP-05, EMP-03, EMP-19 |
| 5 | HR Manager | Upload Rahul's offer letter; show scan → CLEAN; show EICAR blocked | DOC-01, DOC-10 |
| 6 | Employee (Rahul) | Clock in, break, clock out; apply casual leave (weekend & holiday excluded) | ATT-01, ATT-02, ATT-07, LV-10, LV-11 |
| 7 | Line Manager (Priya) | Approve leave from dashboard inline; see team calendar; approve a regularization | DASH-04, LV-21, LV-22, LV-26, ATT-18 |
| 8 | Employee (Rahul) | See leave reflected in balance and attendance (ON_LEAVE) | LV-09, ATT-20 |
| 9 | HR Manager | Edit CTC and show the before/after in audit; reveal PAN and show it is logged | EMP-11, EMP-15, AUD-03, AUD-05 |
| 10 | Company Admin | Access: change a role; deactivate and reactivate a user; show the access trail | ACC-02, ACC-08, ACC-09, ACC-13 |
| 11 | Company Admin | Reports: headcount, movement, attrition; export XLSX | RPT-01, RPT-03, RPT-05, RPT-08 |
| 12 | Company Admin | Email log: show sent notifications; explain FAILED retry (if SES live) | NTF-04, NTF-06 |
| 13 | Auditor | Read-only walk: prove no write controls are shown and writes are refused | ACC-14, AUD-07, NTF-07 |
| 14 | Employee | Show the employee cannot see another employee's data or reports | DOC-09, RBAC-24, ISO-01 |
| 15 | Close | Tenant isolation test suite result (automated) | ISO-*, NFR-07 |

---

## 21. Persona coverage check

Tick once every persona has completed at least one full flow end-to-end.

| Persona | Full flow completed | Suites covered | Sign-off |
|---|---|---|---|
| Platform Admin | ☐ | PA, LAND, AUD-08 | |
| Company Admin | ☐ | CFG, EMP, ACC, LV, ATT, RPT, NTF, AUD | |
| HR Manager | ☐ | EMP, DOC, LV-29/30, RPT, NTF | |
| Line Manager | ☐ | LV approvals, ATT team, DASH-03/04, RBAC-13/17 | |
| Employee | ☐ | AUTH, LV-09…20, ATT-01…14, DOC-06/09, DASH-05/06 | |
| Auditor | ☐ | ACC-14, AUD-07, NTF-07, DASH-07, DOC-14 | |

---

## 22. Defect log

Record every FAIL here so it can be triaged before the demo.

| Case ID | Severity (P0 isolation/security · P1 blocks a flow · P2 wrong but workaround · P3 cosmetic) | What happened | Expected | Status | Owner |
|---|---|---|---|---|---|
| | | | | | |
| | | | | | |
| | | | | | |

---

## 23. Known limitations — say these up front, don't let the client discover them

| Area | Limitation | How to frame it |
|---|---|---|
| Payroll | Not built. Payroll-cost reports and statutory registers (PF/ESI/Gratuity) are not available. | Planned next, after the V1 modules; payroll is the highest-risk module and gets its own time budget. |
| Statutory e-filing | EPFO/ESIC/TRACES live APIs are deliberately deferred. | Data is captured in-app; filing is an explicit later scope. |
| Attendance capture | Only web clock-in and manual marking. No GPS, biometric or selfie capture. | Biometric device integration is deferred. |
| Email delivery | Live only once SES sender is verified on the preview/prod environment. | Confirm before the demo (ENV-03). |
| Break-glass | Lifecycle (request, track, expire, revoke) is audited; operator does not yet get elevated tenant-data access. | Escalation mechanism is a deliberate follow-on, not a current feature. |
| Login audit | Wrong-password and unknown-email attempts are not recorded server-side (they fail in the client SDK). | Owner-approved V1 scope; server records successful and server-observed outcomes. |
| Document retention | Soft delete only; no automatic purge. | Owner-approved V1 scope cut. |
| Hosting | Demo runs on the testing deployment (EC2 + Vercel + Supabase), not the production AWS ap-south-1 + RDS target. | Be explicit that production hardening is a separate infra slice. |
| Custom roles | Six fixed roles only; no role builder. | Deferred by design. |
| SSO | Not built (Firebase email/password only). | Deferred. |

---

## 24. Sign-off

| Role | Name | Date | Signature / initials |
|---|---|---|---|
| QA lead | | | |
| Backend lead | | | |
| Frontend lead | | | |
| Product owner | | | |
| Client representative (UAT, optional) | | | |
