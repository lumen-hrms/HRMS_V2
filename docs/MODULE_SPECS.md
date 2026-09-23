# HRMS — Module Specifications (Developer Guide)

> **Audience:** anyone on the team picking up a module to build or extend.
> For each module this gives: the **expectation** (what "done" means),
> the **feature list** it owns, the **happy-path user journey**, and the
> **functionalities / API surface** as they exist today.
>
> Read `CLAUDE.md` first (the *why* behind architecture choices) and
> `docs/BACKEND_ARCHITECTURE.md` (the *what/where*, traced from source). This
> file sits between them: it's the per-module product+dev contract.
>
> **This file is the index / summary.** Each module has a deep spec in
> `docs/modules/NN_MODULE_NAME.md` — personas & how each uses the module,
> full technical + functional expectations, flows, invariants, permission
> matrix, acceptance criteria. The per-module `**Deep spec:**` link points to
> it. Modules without a link yet are still to be written.
>
> **Priority tags:** `[MUST]` = V1-blocking, `[SHOULD]` = v1.1 target,
> `[COULD]` = later. Where V1 deliberately narrows a feature, it's called
> out under **Scope cut**. (`FR-XXX` tags are legacy references to an early
> spec draft that is no longer maintained — ignore them; this file and the
> code are the source of truth.)
>
> **Last synced to code:** 2026-09-23. Landed since the previous sync
> (2026-09-22):
>
> - **Auth emails now go through SES too** (module 10 + Identity & Access /
>   Platform Admin). Tenant-onboarding invites, admin-triggered resets and
>   self-service "Forgot password?" are sent by `AuthEmailService` — a
>   Firebase Admin-generated reset link in a branded email from the
>   workspace's domain — instead of Firebase's generic email. New public
>   `POST /api/auth/password-reset` (non-enumerating, rate-limited) replaces
>   the browser calling Firebase directly. Falls back to Firebase's email
>   when SES isn't configured. Also: a public landing page at `/` for
>   signed-out visitors (signed-in users still get the dashboard there).
> - **Notifications (module 10) → 95%.** New `apps/api/src/notifications`:
>   `NotificationDispatcher.notify()` (singleton, explicit `tenantId`, never
>   throws into the caller) resolves recipients (users / employees / roles →
>   active users with an email, actor excluded), writes one `QUEUED`
>   `notification_log` row per recipient (unique dedupe key — no double
>   emails), and enqueues a BullMQ `notifications` job; the worker renders an
>   HTML-escaped template and sends via **AWS SES v2**, marking `SENT` with
>   the SES message id or retrying (5×, exponential) to `FAILED`; a 10-minute
>   sweep re-enqueues stuck rows. Wired into Leave (apply, L1/L2 approve,
>   reject, cancel, both escalation steps), Attendance (regularization
>   submit, approve/reject, payroll-cut-off auto-resolve) and Documents
>   (malware-blocked upload). New Email log screen (`/notifications`, Company
>   Admin / HR Manager retry, Auditor read-only). Migration
>   `20260923120000_notifications` (`hrms_app` has no `DELETE` on the log).
>   The remaining 5% is a first real delivery through SES, which needs the
>   owner's SES setup (verified sender + credentials) — until then every send
>   is recorded as `FAILED` with "SES_FROM_ADDRESS is unset", never dropped.
>   New deep spec `docs/modules/10_NOTIFICATIONS.md`.
> - **Documents (module 09) reaches 100%.** A shared `apps/api/src/documents`
>   module now owns every user upload: MIME allow-list + magic-byte sniffing
>   + 10 MB cap before storage, owner-typed rows (`EMPLOYEE_PROFILE` /
>   `LEAVE_REQUEST` / `REGULARIZATION`), a ClamAV scan (BullMQ `documents`
>   queue, clamd `zINSTREAM`, no npm dep) that must pass before any
>   presigned URL is issued, a 15-minute sweep that re-enqueues stale/failed
>   scans, `Content-Disposition: attachment` downloads, one visibility rule
>   (subject employee's `scopeFor` scope), soft delete (`hrms_app` lost
>   `DELETE` on `documents`), and `documents.*` events in `audit_log`.
>   Leave's `attachment_*` columns migrated into `documents`
>   (`20260923090000_documents_module`); approvers can now actually download
>   the proof, the apply form uploads it, and regularization requests take
>   evidence (`POST /attendance/regularization/:id/evidence`). New deep spec
>   `docs/modules/09_DOCUMENTS.md`. Retention purge is a deliberate V1 scope
>   cut (soft delete only), not a gap. API: 214 unit tests + 44 e2e (new
>   `test/documents.e2e-spec.ts`) green; real clamd verified to flag EICAR;
>   web `tsc -b`/`vite build`/lint clean. Not browser-verified.
>
> Previous sync — 2026-09-22 (landed since 2026-09-18):
>
> - **Dashboard reaches 100%.** `GET /api/dashboard` now returns a
>   `todayAttendance` snapshot (own status/check-in/check-out/worked-hours,
>   sourced from `AttendanceService.today()`) for every role with a linked
>   employee record — including admins, on their own admin-view response —
>   gated on the tenant's `ATTENDANCE` plan entitlement (checked inline
>   against `platform.subscriptions`, mirroring `EntitlementGuard`, since
>   the route itself has no single `@RequiresModule` — its shape already
>   varies by role). Rendered on the web dashboard as a shared card above
>   the role-specific grid. The upcoming-payslip date and admin
>   payroll/attrition tiles stay blocked on Payroll (module 07, not built)
>   — not counted against 100%, same treatment `MODULE_SPECS.md` already
>   gives Attendance's own Payroll-blocked items. New deep spec
>   `docs/modules/06_DASHBOARD.md` and UI build prompt
>   `docs/ui-build-prompts/06-dashboard.md`. 4 new unit tests
>   (`dashboard.controller.spec.ts`); `tsc`/`vite build`/lint clean on both
>   apps; full API suite (156 tests) green. Not e2e/browser-verified — no
>   test credentials for a live session in this environment.
> - **Dashboard gains quick actions (same day, frontend-only follow-up).**
>   The attendance card now has working Clock In / Take Break / End Break /
>   Clock Out buttons, and each pending-approval row (Line Manager's own
>   view — the admin view only ever had a count, not a list, so this isn't
>   reachable there) gets inline Approve/Reject buttons. Both call
>   Attendance's and Leave's own existing endpoints directly
>   (`/attendance/clock-in`/`/clock-out`/`/break/start`/`/break/end`,
>   `/leave/requests/:id/approve`/`/reject`) — no new backend route, no new
>   authorization or validation logic, matching the existing no-confirm
>   row-level precedent in Leave's own Approvals tab. Every action re-runs
>   `GET /api/dashboard` on completion so the whole screen — not just the
>   row that changed — reflects the new server state; failures surface via
>   `useToast()`. Backend unchanged (156 tests still green); `tsc`/
>   `vite build`/lint clean on the web app.
>
> Landed 2026-09-18 (including two later passes the same day):
>
> - **Attendance & Time Tracking reaches 100%.** Every item on §5's
>   Known-gaps list is closed: web clock-in/out now write `Punch` rows
>   (source `WEB`) as the source-of-truth capture the nightly job reads;
>   `AttendanceFinalizationProcessor` (new BullMQ `attendance` queue, same
>   `upsertJobScheduler` daily-cron pattern as the other processors) runs
>   two jobs — `finalize` (02:00 UTC, per tenant per employee, resolves
>   *yesterday*: holiday → weekly-off → punches → genuine unexplained
>   `ABSENT`, skipping any day that already has a real outcome) and
>   `resolve-cutoff` (03:00 UTC, auto-approves/rejects still-`PENDING`
>   regularization requests on each tenant's own `payrollCutoffDay`, per
>   `unactionedBehavior`). Regularization requests now enforce
>   `regularizationWindowDays`/`regularizationMonthlyCap` at request time
>   and flag the day `PENDING_REGULARIZATION`; a full approve/reject/
>   bulk-approve flow exists for Line Manager (recursive subtree, mirroring
>   Leave's `recursiveReportIds` pattern) and HR/Admin, audited via
>   `audit_log`. New manager/HR views: `GET /attendance/team/roster` (team
>   tab) and `POST /attendance/mark` (manual marking, FR-ATT-001) on the
>   web app's new **Team** and **Approvals** tabs (visible to Line Manager
>   and HR/Admin; Settings stays Admin/HR-only). `today()`/`stats()` now
>   report overtime hours (time beyond `Shift.minHoursFullDay` — converting
>   to statutory per-state overtime pay stays Payroll's job, not built).
>   `getLopDays(employeeId, month)` + `GET /attendance/lop-days` is the
>   defined Payroll export contract. GPS/biometric/selfie-QR capture and
>   `POST /attendance/ingest` remain explicitly deferred (CLAUDE.md), not
>   counted against 100%. 152 API unit tests pass (40 in
>   `attendance.service.spec.ts`, 10 new in
>   `attendance-finalization.processor.spec.ts`); `tsc`/`vite build`/lint
>   clean on both apps. Not e2e/browser-verified — no test credentials for
>   a Line Manager/HR session in this environment.
>
> - **Tenant Configuration reaches 100%.** The last piece — a skippable,
>   resumable first-run setup wizard
>   (`apps/web/src/components/setup-wizard/setup-wizard.tsx`, mounted in
>   `AppLayout`, Company Admin only) — is live. Five steps (work week +
>   timezone, default shift, holidays, leave types, payroll cut-off day),
>   each orchestrating existing endpoints (Attendance's general settings +
>   shifts, Leave's holidays + types) rather than introducing new business
>   logic. Progress is tracked on `TenantSettings.setupWizardStatus`
>   (`PENDING`/`IN_PROGRESS`/`DISMISSED`/`COMPLETED`) +
>   `setupWizardStep`, via a new minimal `apps/api/src/tenant-config` module
>   (`GET`/`PATCH /api/tenant-config/wizard`, migration
>   `20260919090000_tenant_setup_wizard`). A step only PATCHes its endpoint
>   when the wizard actually advances (Next/Back/Skip), not on every
>   keystroke — each step registers a "commit" callback the wizard calls
>   once before transitioning. Not e2e/browser-verified this pass (no test
>   Company Admin credentials in this environment) — verified by `tsc`,
>   `vite build`, lint, and the new `tenant-config.service.spec.ts` only.
>
> Landed earlier the same day:
>
> - **Identity & Access reaches 100%.** `LoginAuditRetentionProcessor` (new
>   BullMQ `access` queue, same `upsertJobScheduler` daily-cron pattern as
>   `LeaveAccrualProcessor`) purges `login_audit_entries` older than the
>   2-year retention window, per tenant. `BAD_CREDENTIALS`/`TENANT_SUSPENDED`
>   staying unlogged is the pre-existing owner-approved scope decision
>   (§1 "Known gaps"), not an open gap.
> - **Platform Admin reaches 99%.** Closed: `GET /tenants/:id` (detail
>   endpoint), `POST /tenants/:id/refresh-headcount` (audited), a scheduled
>   renewal job (`PlatformScheduledJobsProcessor`, daily, drives
>   `renewSubscription()` off `Subscription.renewsAt` instead of manual-only),
>   and `platform_audit_log` tightened to true append-only (`REVOKE UPDATE,
>   DELETE ... FROM hrms_platform`). Break-glass gained its auditable
>   control-plane lifecycle — `platform.break_glass_grants`
>   (request/track/expire/revoke, one-active-grant-per-tenant, hourly
>   auto-expiry job, full console wiring replacing the old TODO(api) stub) —
>   but this is the logged request/approval trail only; it does **not** yet
>   grant an operator any actual elevated read against a tenant's data
>   during the window (that's a separate connection-pool escalation
>   mechanism, deliberately still unbuilt — same category as the dedicated
>   DB-per-tenant tier). Kept at 99%, not 100%, until that's addressed.
> - **Employee Master + Org Structure reaches 100%.** Org chart
>   (`apps/web/src/pages/org-chart.tsx`) gained search (auto-expands
>   ancestors of a match), expand/collapse (per-node + all), zoom, and a
>   click-to-drawer quick view. The PAN/bank reveal reason is now a proper
>   confirm dialog, not `window.prompt`. `photoUrl` is a real upload now, not
>   a hand-typed URL: `Employee.photoKey` (renamed from `photoUrl`, migration
>   `20260918110000_employee_photo_key`) stores a private object-storage key,
>   resolved to a short-lived (1h) presigned URL only on `GET /employees/:id`
>   (not in list views, which never render an avatar); `POST
>   /employees/:id/photo` uploads (JPEG/PNG/WebP, ≤5MB, self or Admin/HR,
>   deletes the previous object). The Line-Manager recursive-subtree
>   scoping decision is now mirrored into Leave (`teamBalances`,
>   `teamCalendar`, `assertCanViewEmployee` all walk the full reporting
>   subtree via a new shared `recursiveReportIds()` helper in
>   `apps/api/src/common/reporting-hierarchy.ts`, reused instead of
>   duplicating `EmployeesService`'s private BFS to avoid a circular module
>   dependency) — L1-approval-specific checks (`approve()`/`reject()`'s
>   "only the direct reporting manager" gate, `pendingApprovals()`) stay
>   direct-only on purpose, since L1 approval is specifically the direct
>   manager's job. Attendance has no manager-facing views at all yet to
>   mirror into — that's module 05's own pre-existing, separately-tracked
>   gap (§5 "Known gaps" #5), not something this pass touched.
> - **Tenant Configuration reaches 80%.** `EntitlementGuard` +
>   `@RequiresModule`/`@RequiresFeature` (`apps/api/src/common/guards/
>   entitlement.guard.ts`) enforce Layer-1 plan entitlements — wired onto
>   `LeaveController` (`@RequiresModule('LEAVE')`) and `AttendanceController`
>   (`@RequiresModule('ATTENDANCE')`); a tenant whose plan excludes a module
>   now gets a 403 instead of a page that quietly half-works.
>   `attendance.service.ts` no longer hardcodes `SHIFT_START_HOUR`/
>   `GRACE_MINUTES`/`TARGET_HOURS` — `resolveShift()` reads
>   `Employee.shiftId` (falls back to the tenant's `isDefault` `Shift`) for
>   both the late/on-time call and the progress-ring target. New Settings UI
>   (`apps/web/src/pages/attendance/settings-tab.tsx`, a tab on the
>   Attendance page for Company Admin/HR Manager only): shift catalogue CRUD,
>   attendance mode/capture-methods/regularization guardrails, and the
>   general (non-Leave) slice of `tenant_settings` (timezone, weekly-off
>   days, payroll cut-off day). The e2e tenant fixture
>   (`apps/api/test/utils/fixtures.ts`) had to be updated to set
>   `enabledModules` — it previously left the subscription's module list
>   empty, which `EntitlementGuard` would now correctly 403 before the
>   tenant-isolation checks those suites exist to run ever executed. Still
>   open: a first-run setup wizard (UX nicety, defaults already apply) —
>   see `docs/TENANT_CONFIGURATION.md`.
>
> Landed in the 2026-09-15 sync (2026-09-11):
>
> - **Platform Admin — audit read API.** `GET /api/platform-admin/audit`
>   (`tenantId`/`action`/`from`/`to`/`q` filters) closes the last open item
>   from module 02 §9's original "Still open" list #1 — rows were already
>   being written on every operator mutation, only the read side was
>   missing. `PlatformAdminService.audit()` reshapes each row's free-form
>   `metadata` into `{ before, after, note }` per action type; covered by
>   `platform-admin.service.spec.ts`. The console's Audit screen now loads
>   real data instead of the "not wired yet" placeholder.
>
> Landed in the 2026-09-11 sync (2026-09-09 @ `2000bd5`):
>
> - **Employee Master — lifecycle state machine.** `EmployeeLifecycleState`
>   (`PRE_JOINING/PROBATION/CONFIRMED/NOTICE_PERIOD/SUSPENDED/SEPARATED`)
>   replaces the old `employmentStatus` enum (migration
>   `20260911100000_employee_lifecycle_state`, backfilling existing rows);
>   `PATCH /api/employees/:id/lifecycle` validates the move against the
>   allowed-transition graph, writes the one date field the edge requires,
>   and — for `SEPARATED` — disables the linked login (module 01's
>   Firebase-disable sequence, run *before* the DB write) before writing an
>   `audit_log` row. Frontend: the employee detail page's **Change status**
>   dialog. Both this migration and the next were **applied to the shared
>   Supabase dev DB** via `./scripts/dev.sh migrate`.
> - **Employee Master reaches 97%.** Migration
>   `20260911120000_employee_full_field_set` adds the rest of the target
>   field set: identity/personal extras, employment extras,
>   compensation-adjacent, statutory + bank. PAN
>   and the bank account number are AES-256-GCM field-encrypted
>   (`FieldEncryptionService`, `apps/api/src/crypto` — the app-layer half of
>   CLAUDE.md's KMS non-negotiable; a real AWS KMS-wrapped key is a later
>   swap) with a dedicated `PATCH .../sensitive-fields` write path and a
>   logged `POST .../reveal`. New: emergency-contact CRUD; document MIME/size
>   enforcement moved server-side plus `category` + delete; department
>   `PATCH`/`DELETE` (RULE-6 reassign guard); the org chart now roots per
>   role (Line Manager's recursive-subtree scoping resolves a long-open
>   question, via an in-memory cycle-safe BFS — not yet mirrored in modules
>   04/05). Also fixed: the Employee self-edit path was documented as a
>   target but the endpoint was actually Admin/HR-only until now; two IDOR
>   gaps on the document list/download-url routes; emergency-contact writes
>   previously checked only row *visibility*, which let a Line Manager edit
>   a report's contacts, not just view them.
> - **Employee Master — visual redesign (UI-only, no API changes).**
>   `apps/web/src/pages/employees/detail.tsx` now renders the target
>   header-banner + 7-internal-tabs layout (`docs/ui-build-prompts/
>   03-employee-master.md` §5.2) instead of stacked cards;
>   `list.tsx` gained the target stat-tile row + search/department/
>   lifecycle filters (§5.1). `org-chart.tsx` was **not** touched — its
>   search/expand/zoom interactivity gap is unchanged.
> - **Platform Admin — reset-email failure is now surfaced, not silently
>   swallowed.** `seedCompanyAdmin()` returns whether the hosted
>   password-reset email actually sent; `createTenant`'s response carries
>   `adminResetEmailSent`, and the New Tenant wizard's success toast used to
>   unconditionally claim "link sent" even when the send failed — it now
>   only claims that when true, and shows an error toast + points at the
>   new `POST /platform-admin/tenants/:id/resend-admin-reset` otherwise. A
>   **Resend admin password-reset email** button was also added to the
>   tenant detail page's Overview tab for later use (not just at creation
>   time). The underlying send call itself (Firebase's `sendOobCode` REST
>   endpoint) is unchanged — this only fixes the console lying about the
>   outcome.
> - **Leave Management reaches 100%** — the last gap (frontend defaulting to
>   the mock) is closed: `apps/web/src/lib/leave/client.ts`'s `USE_MOCK` now
>   defaults to **off** (`=== 'true'` to force it), matching
>   `access/client.ts`'s pattern, so a fresh checkout runs against the real
>   API without any env var changes.
> - **Identity & Access backend** — the `access` module (`/api/access/*`:
>   `users` · `me` · `PATCH .../role` · `PATCH .../status` ·
>   `POST .../password-reset` · `GET .../audit` · `.../:id/activity`) with
>   e2e RBAC + append-only tests; `LoginAuditEntry` table + append-only
>   login-audit on every server-observed `POST /api/auth/session` outcome;
>   `VITE_ACCESS_MOCK` defaults **off**.
> - **Infra** — Firebase Auth **emulator removed** (real Firebase
>   everywhere, tests included); dev DB moved to a **shared Supabase
>   Postgres** via the Supavisor pooler (local Docker Postgres is now
>   e2e-only); multi-tenancy decision rewritten to **hybrid** in `CLAUDE.md`
>   (pooled default + dedicated DB-per-tenant as a plan-gated tier — a
>   design target, not built). A **testing deploy** (API → Fly.io, web →
>   Vercel, DB stays Supabase) is configured — `docs/DEPLOY.md`;
>   `GET /api/health` added.
> - **Platform Admin** — full operator console UI at `/platform-admin/*`
>   (login, tenants list, new-tenant wizard, tenant detail w/ 4 tabs, Plans
>   catalog, audit screen); operator-editable plan catalog `platform.plans`
>   (`GET`/`PATCH /plans`); **per-seat pricing** — plans carry a list price
>   *per seat / month*, each `Subscription` snapshots a **per-tenant
>   negotiated rate**; `PATCH .../pricing` adjusts it, `PATCH .../plan` +
>   `POST .../renew` re-snapshot; `PlatformAuditLog` written for
>   create / status / plan-change / renewal / price-adjust / plan-edit.
>   Migrations `20260909120000_plan_catalog` + `20260909130000_per_seat_pricing`.
> - **Leave Management** — backend fully wired & tested, FE live path built;
>   Line-Manager visibility, holiday calendar, attachments, configurable
>   approval levels + escalation/accrual jobs on a new BullMQ `leave` queue
>   (Redis — added to `docker-compose.yml` + CI), comp-off credit, and
>   leave→attendance reconciliation. All feature gaps closed; the web client
>   still **defaults to the mock** (`VITE_LEAVE_MOCK` unset) — see §4.
> - **Audit Log** — `login_audit_entries`, `public.audit_log` (access-change
>   events), and `platform.platform_audit_log` are all now written and
>   append-only-enforced (see §12).
>
> **Keep the status table + per-module progress bars current on every change** —
> if a commit moves a module, move its bar (status mark, ASCII bar, %), its
> `**Status:**` line, and the `Last synced to code` date in the **same
> commit**. This is a standing, non-optional rule — see `CLAUDE.md` →
> "Keeping module status in sync".

---

## Status legend

| Mark | Meaning |
|---|---|
| ✅ **Done** | Backend + frontend wired, persists to real Postgres, has tests or manual verification |
| 🟡 **Partial** | Core path works; named gaps remain (listed per module) |
| 🔴 **Not started** | No code yet — spec here is the build target |

| Module | Status | Progress |
|---|---|---|
| 1. Identity & Access (Auth + RBAC + Tenancy) | ✅ | `████████████████████` 100% — auth/RBAC/tenancy live; `access` module wired (Users, role/status/reset, login+access audit, My Account) with e2e RBAC + append-only tests; `LoginAuditEntry` table written on every session outcome, with a daily BullMQ job purging entries past the 2-year retention window. `BAD_CREDENTIALS`/`TENANT_SUSPENDED` staying server-unobserved is an owner-approved scope decision (§1), not a gap |
| 2. Platform Admin | ✅ | `███████████████████░` 99% — full operator console UI (tenants list, new-tenant wizard, tenant detail tabs, **Plans catalog**, audit screen); onboarding emails a hosted reset link; **operator-editable `platform.plans`** (per-seat list price / default seats / modules / features / isolation tier) with snapshot-at-assign + re-snapshot-on-renewal; **per-tenant negotiated per-seat rate** (`PATCH .../pricing`; monthly = rate × seats, computed); `PATCH .../plan` + `POST .../renew` live (renewal now also runs on a daily scheduled job off `renewsAt`); `PlatformAuditLog` written for every operator action and readable (`GET .../audit`), now true append-only at the DB grant level; `GET tenants/:id` and `POST .../refresh-headcount` live. Break-glass has a full audited request/track/expire/revoke lifecycle but does not yet grant an operator actual elevated tenant-data access during the window — that escalation mechanism is a deliberate follow-on |
| 3. Employee Master + Org Structure | ✅ | `████████████████████` 100% — lifecycle state machine, the full field set (statutory/bank via KMS-style AES-256-GCM encryption, emergency contacts, comp-adjacent fields), bulk-import UI, document hardening, department edit/delete-with-reassign, an interactive org chart (search/expand/collapse/zoom/quick-view), a real photo-upload widget, a proper reveal-reason dialog, and Leave's recursive Line-Manager scoping mirror are all live. Only the deliberately-deferred BU→Team hierarchy remains |
| 4. Leave Management | ✅ | `████████████████████` 100% — backend fully wired & tested; FE live path built and running against the real API by default (`client.ts`'s `USE_MOCK` now defaults to **off**, matching `access/client.ts` — set `VITE_LEAVE_MOCK=true` to force the fixture store); `allowLopRequests`/`minNoticeDays`/`fyStartMonth`/`genderRestriction`/`requiresApproval` all enforced/settable; mid-year-joiner proration; comp-off credit on holiday/weekly-off clock-in; approved leave reconciles into `AttendanceRecord.ON_LEAVE` |
| 5. Attendance & Time Tracking | ✅ | `████████████████████` 100% — reads the tenant's `Shift`/`tenant_settings` config, gated behind the `ATTENDANCE` plan entitlement; punches write-path, a nightly finalization job (holiday → weekly-off → punches → genuine absence), full regularization approval (window/cap enforcement, approve/reject/bulk-approve, audited, auto-resolved at payroll cut-off), manager/HR team roster + manual marking, overtime hours, and a `getLopDays()` export contract for Payroll are all live. GPS/biometric/selfie-QR capture and `POST /attendance/ingest` stay explicitly deferred (CLAUDE.md) |
| 6. Dashboard | ✅ | `████████████████████` 100% — role-branched `GET /api/dashboard` (admin aggregates vs. personal view) includes an own-attendance "today" snapshot for every role with a linked employee record, gated on the tenant's `ATTENDANCE` entitlement, plus quick actions (clock in/out/break, approve/reject a pending request) that call Attendance's/Leave's own existing endpoints directly and re-fetch the dashboard afterward — no new mutation surface. Admin payroll-cost/attrition tiles and an upcoming-payslip date stay explicitly blocked on Payroll (module 07, not built) — same "not counted against 100%" treatment as Attendance's own Payroll-blocked items. Deep spec: `docs/modules/06_DASHBOARD.md` |
| 7. Payroll Engine | 🔴 | `░░░░░░░░░░░░░░░░░░░░` 0% |
| 8. Statutory Compliance | 🔴 | `░░░░░░░░░░░░░░░░░░░░` 0% |
| 9. Documents | ✅ | `████████████████████` 100% — shared `documents` module owns every user upload (employee profile docs, leave attachments, regularization evidence): type/magic-byte/size validation, ClamAV scan before download (fail-closed, self-healing sweep), 5-min attachment-disposition presigned URLs, subject-employee visibility, audited soft delete (no `DELETE` grant). Retention purge deliberately out of V1 scope. Deep spec: `docs/modules/09_DOCUMENTS.md` |
| 10. Notifications | 🟡 | `███████████████████░` 95% — queued, deduped, audited-retry email pipeline on AWS SES v2 (`notification_log`, BullMQ `notifications` queue, 10-min self-healing sweep, Email log screen) wired into every Leave / Attendance-regularization / Documents workflow event. Remaining: first live SES delivery, blocked on the owner's SES setup (verified sender + IAM credentials). Deep spec: `docs/modules/10_NOTIFICATIONS.md` |
| 11. Reports & Analytics | 🔴 | `██░░░░░░░░░░░░░░░░░░` 10% (only the Dashboard aggregates exist) |
| 12. Audit Log | 🟡 | `███████░░░░░░░░░░░░░` 35% — three append-only trails live: `login_audit_entries` (sign-in outcomes, with a daily retention-purge job), `public.audit_log` (`access.*` change events — role/status/reset/login-created), `platform.platform_audit_log` (tenant create/status/plan/renewal/price-adjust/plan-edit/breakglass — now readable + expanded). All three tables have no `UPDATE`/`DELETE` grant (true append-only). Missing: a generic audit interceptor, employee field/salary + attendance-decision coverage, an aggregation/query UI |
| 13. Tenant Configuration | ✅ | `████████████████████` 100% — schema, onboarding defaults, `EntitlementGuard` (+ `@RequiresModule`/`@RequiresFeature`, wired onto Leave + Attendance), `attendance.service.ts` reading tenant `Shift`/`tenant_settings` instead of hardcoded constants, Settings screens (shift CRUD + attendance/general settings), and a skippable/resumable first-run setup wizard (`apps/web/src/components/setup-wizard`, `apps/api/src/tenant-config`) are all live. See `docs/TENANT_CONFIGURATION.md` |

Deferred to a later phase — **do not build without a scope discussion**
(`CLAUDE.md` → "Explicitly deferred"): Onboarding, Recruitment/ATS,
Performance Management, Expense Management, Helpdesk, HR Analytics/ML,
AI HR Assistant, LMS, OKR, native mobile app, biometric-device integration,
live e-filing APIs, SSO.

---

## Conventions every module follows

- **Guard chain (tenant routes):** `JwtAuthGuard` → `TenantGuard` →
  `RolesGuard`. Add `@Roles(...)` on a handler to restrict; no decorator =
  any authenticated user in the tenant. `@Public()` skips JWT (still
  tenant-scoped).
- **Row scoping below the guard** (things a static role check can't express)
  lives in the **service layer**, e.g. `EmployeesService.scopeFor(user)`:
  `EMPLOYEE` → own record only; `LINE_MANAGER` → own + direct reports;
  admins → unrestricted (within RLS).
- **Every tenant query** goes through `TenantPrismaService.client` — never the
  raw Prisma client — so the RLS session variable `app.current_tenant_id` is
  set on the same connection/transaction. New tables must carry `tenant_id`,
  an `@@index([tenantId])`, and an RLS policy in the roles/RLS migration.
- **Money:** `NUMERIC`, never float. **Timestamps:** `TIMESTAMPTZ`, stored
  UTC, displayed IST. **PII (PAN, bank a/c):** app-layer KMS encryption on
  top of at-rest. **Aadhaar:** last 4 digits only.
- **DTOs / enums shared with the frontend** go in `packages/shared-types`.
- **OpenAPI** (`@nestjs/swagger`) is the API contract — annotate new
  endpoints so the frontend can move independently.
- **Frontend:** React + Vite, React Router, Tailwind v4, hand-written
  shadcn-style primitives in `apps/web/src/components/ui`, "Lumen" design
  language. API calls through `apps/web/src/lib` client.

---

## 1. Identity & Access — Auth + RBAC + Multi-tenancy

**Deep spec:** `docs/modules/01_IDENTITY_AND_ACCESS.md` ·
**UI prompt:** `docs/ui-build-prompts/01-identity-access.md`
**Status:** ✅ 100% — auth/RBAC/tenancy · ✅ `access` module wired
(`/api/access/*`) with e2e RBAC + append-only tests · ✅ `LoginAuditEntry`
written on every session outcome, with a daily BullMQ retention-purge job ·
`VITE_ACCESS_MOCK` defaults off
**Code:** `apps/api/src/auth`, `apps/api/src/access`, `apps/api/src/firebase`,
`apps/api/src/common/{guards,decorators,tenancy}`, `apps/api/src/prisma`,
`apps/web/src/pages/access`, `apps/web/src/lib/access`

### Expectation

A request cannot reach tenant data unless it is (a) a valid Firebase ID
token, (b) for a user that exists and is active in **this** tenant, and
(c) allowed by role. Cross-tenant access must fail at **three**
independent layers (token/tenant cross-check, app query scoping, Postgres
RLS) — a bug in any one layer alone must not leak data. The adversarial
test suite (`test/tenant-isolation.e2e-spec.ts`) is the definition of done
and a **P0 gate**, not a nice-to-have.

### Feature list

| Feature | SRS | V1 status |
|---|---|---|
| Email/password login | FR-AUTH-001 | ✅ via Firebase Auth (hosted); frontend calls `signInWithEmailAndPassword`, backend verifies the ID token |
| Tenant-scoped login — subdomain → tenant | FR-AUTH-006 | ✅ `TenantResolutionMiddleware` (subdomain in prod, `X-Tenant-Subdomain` header in dev) |
| Predefined roles: Platform/Company Admin, HR Manager, Line Manager, Employee, Auditor | FR-RBAC-001 | ✅ `UserRole` enum + `@Roles()` + `RolesGuard` |
| Every endpoint validates tenant + role | FR-RBAC-004 | ✅ guard chain, applied per controller |
| Line Manager sees only direct/indirect reports | FR-RBAC-003 | 🟡 enforced in Employees; **permissive placeholder in Leave** |
| Account lockout after 5 failed attempts | FR-AUTH-005 | ✅ handled by Firebase Auth |
| JWT access + refresh rotation | FR-AUTH-004 | ➖ replaced — the Firebase ID token *is* the session, SDK-refreshed client-side; no server-minted tokens (see `CLAUDE.md`) |
| MFA (TOTP) for admin roles | FR-AUTH-002 | ➖ **cut for V1** — no MFA (documented decision) |
| Google / Azure AD SSO | FR-AUTH-003 | 🔴 deferred |
| Login audit log (IP, device, timestamp, outcome), 2-yr retention | FR-AUTH-008 | ✅ `LoginAuditEntry` (append-only) written on every `POST /api/auth/session` outcome the server can see (`SUCCESS`, `USER_INACTIVE`, `CLAIM_MISMATCH`, `TOKEN_EXPIRED`); read via `GET /api/access/audit?feed=login`. `LoginAuditRetentionProcessor` (daily BullMQ job, `access` queue) purges entries older than 2 years, per tenant |
| Access-change trail (role change, activate/deactivate, reset, login created) | — | ✅ written to append-only `audit_log` (`access.*` actions, `metadata.module = "identity-access"`); read via `GET /api/access/audit?feed=access` |
| User administration (list logins, change role, activate/deactivate, send reset) | FR-RBAC-004 | ✅ `access` module — `@Roles`-gated + service-layer invariants (RULE-2 ceiling, keep ≥1 active Company Admin, no self-deactivation); Firebase claim + `disabled` flag kept in sync |
| Custom role builder / granular per-module permissions | FR-RBAC-002 | 🔴 deferred — roles are fixed for V1 |
| Approval delegation | FR-RBAC-005 | 🔴 deferred |

### Happy path

1. User visits `acme.hrms-platform.com` → frontend resolves tenant `acme`.
2. User enters email + password → frontend calls Firebase
   `signInWithEmailAndPassword` → gets an ID token.
3. Frontend `POST /api/auth/session` with `{ idToken }`.
4. Backend verifies the token (Firebase Admin SDK), reads the
   `tenantId` / `role` custom claims, confirms a matching active
   `public.users` row in the resolved tenant, returns the session user.
5. Frontend stores nothing secret — it holds the Firebase session and
   attaches `Authorization: Bearer <idToken>` (auto-refreshed by the SDK)
   to every API call.
6. On each request: `TenantResolutionMiddleware` sets `req.tenantId` →
   `JwtAuthGuard` verifies token → `TenantGuard` asserts
   `token.tenantId === req.tenantId` → `RolesGuard` checks `@Roles` →
   `TenantPrismaService` sets `app.current_tenant_id` → RLS filters rows.

### Functionalities / API

| Method | Path | Notes |
|---|---|---|
| `POST` | `/api/auth/session` | `@Public` — validate ID token, return session user; writes one append-only `LoginAuditEntry` per outcome |
| `GET` | `/api/auth/me` | current `AuthenticatedUser` from the token |
| `GET` | `/api/access/me` | signed-in user's own row + `tenantName` (My Account) — any tenant role |
| `GET` | `/api/access/users` | `@Roles(COMPANY_ADMIN, HR_MANAGER, AUDITOR)` — logins + linked employee + last successful sign-in |
| `PATCH` | `/api/access/users/:id/role` | `@Roles(COMPANY_ADMIN)` — RULE-2 ceiling; blocks demoting the last active Company Admin; syncs the Firebase `role` claim |
| `PATCH` | `/api/access/users/:id/status` | `@Roles(COMPANY_ADMIN, HR_MANAGER)` — no self-deactivation; keeps ≥1 active Company Admin; sets Firebase `disabled` + revokes refresh tokens on deactivate |
| `POST` | `/api/access/users/:id/password-reset` | `@Roles(COMPANY_ADMIN, HR_MANAGER)` — sends Firebase's hosted reset email via the Identity Toolkit REST API (`FIREBASE_WEB_API_KEY`) |
| `GET` | `/api/access/audit?feed=login\|access` | `@Roles(COMPANY_ADMIN, AUDITOR)` — sign-in outcomes / access-change trail; `outcome`/`action`/`from`/`to`/`q` filters |
| `GET` | `/api/access/users/:id/activity` | `@Roles(COMPANY_ADMIN, HR_MANAGER, AUDITOR)` — merged recent login + access-change feed for the detail drawer |

Custom claims (`tenantId`, `role`) are **set server-side** via the Admin
SDK when a user is created (tenant onboarding, employee-with-login
creation) and on every role change. Never trust a claim the client could set.

### Known gaps / TODO

- **`BAD_CREDENTIALS` sign-in failures are not recorded** — wrong
  password / unknown email is rejected entirely inside the Firebase client
  SDK and never reaches `POST /api/auth/session`, so the server can't log
  it. Decision (owner-approved): server-observed outcomes only for V1.
- **`TENANT_SUSPENDED` is not logged per-request** — it's rejected in
  `TenantResolutionMiddleware` before the session handler. Instead, one
  `tenant.status_changed` row is written to `platform_audit_log` on the
  operator's suspend/resume action (module 02).
- Decide if/when SSO (FR-AUTH-003) re-enters scope for the hospital pilot
  (explicitly deferred — see `CLAUDE.md`).

---

## 2. Platform Admin

**Deep spec:** `docs/modules/02_PLATFORM_ADMIN.md` ·
**UI prompt:** `docs/ui-build-prompts/02-platform-admin.md`
**Status:** ✅ 99% — full operator console UI (`/platform-admin/*` —
login, tenants list, new-tenant wizard, tenant detail w/ 4 tabs, **Plans
catalog**, audit screen) · ✅ operator-editable `platform.plans` (per-seat
list price / default seats / modules / features / isolation tier) with
**snapshot-at-assign + re-snapshot-on-renewal** · ✅ **per-tenant
negotiated per-seat rate** (`PATCH .../pricing`; monthly = rate × seats,
computed) · ✅ `PATCH .../plan` + `POST .../renew` (renewal keeps the
negotiated rate, refreshes modules) + a daily scheduled job driving renewal
off `renewsAt` · `PlatformAuditLog` written for every operator action,
readable (`GET .../audit`), and now true append-only at the DB grant level
· ✅ `GET tenants/:id` + `POST .../refresh-headcount` · 🟡 break-glass has
a full audited request/track/expire/revoke lifecycle but no underlying
elevated-read mechanism yet (see "Known gaps")
**Code:** `apps/api/src/platform-admin` (`+ plans.service.ts`),
`apps/web/src/pages/platform-admin` (`console.tsx` gate → `shell.tsx` +
`tenants` / `tenant-new` / `tenant-detail` / `plans` / `audit` +
`components/`, `lib/{types,plan-catalog,format,platform-auth}`)

### Expectation

The founder's operator console. It is **structurally separate** from the
tenant app: its own `platform` Postgres schema, its own DB role
(`hrms_platform`) with **zero grants on `public`**, its own auth. It can
onboard tenants, enable/disable them, and see denormalized metadata
(name, plan, employee **count**, status) — it must **never** be able to
read tenant PII (employees, leave, payroll). Genuine support access is a
future logged, time-boxed break-glass flow, not a standing grant.

### Feature list

| Feature | V1 status |
|---|---|
| Platform-admin login (separate from tenant login) | ✅ Firebase, `type: platform_admin` claim, `PlatformJwtAuthGuard` |
| Create tenant (name, subdomain, plan, seats, negotiated per-seat rate, first admin name+email) | ✅ `createTenant()` — creates `Tenant` + `Subscription` (seat count + per-seat rate per plan default or deal override), seeds the Company Admin via the `hrms_app` connection with a **random password + a hosted password-reset email** (no operator-typed password); rolls back the tenant row if seeding fails. The reset-email send is non-fatal (the tenant is still created if it fails) and the response now carries `adminResetEmailSent: boolean` so the wizard doesn't lie about the outcome — a resend action exists (`POST .../resend-admin-reset`) for when it's `false` |
| List tenants with subscription info | ✅ |
| Enable / suspend / set trial | ✅ `PATCH .../status` — `SUSPENDED` locks out every user of that tenant immediately at the resolution layer; carries an audit `reason` |
| Denormalized employee headcount per tenant | ✅ `refreshHeadcount()` writes `platform.tenants.employeeCount`; `POST /api/platform-admin/tenants/:id/refresh-headcount` exposes it as an audited operator route (`headcount.refreshed`, written only when the count actually changed) |
| Platform audit log | ✅ written for `tenant.created` / `tenant.status_changed` / `tenant.plan_changed` / `subscription.renewed` / `subscription.price_adjusted` / `plan.updated` / `headcount.refreshed` / `breakglass.requested` / `breakglass.revoked` / `breakglass.expired` (actor email, before/after, reason in `metadata`); readable via `GET .../audit`; `hrms_platform` has no `UPDATE`/`DELETE` grant on the table (true append-only) |
| Operator-editable plan catalog | ✅ `platform.plans` (**list price per seat / month**, default seat count, modules / features / isolation tier) — `GET`/`PATCH /api/platform-admin/plans[/:key]`, **Plans** screen. Editing a plan never mutates a live `Subscription` (each carries a snapshot); new tenants snapshot the current plan, and **renewal re-snapshots** (`POST .../:id/renew`) — adds modules the plan gained, removes ones it dropped, **keeps the tenant's negotiated per-seat rate + seat count**. `entitlements.ts` stays as the seed + code fallback. Pricing is a stored reference figure — no billing integration. |
| Per-seat pricing + per-tenant negotiation | ✅ `Subscription.pricePerSeat` is the **negotiated** rate for that one tenant (defaults to the plan's list price at assign-time, operator tunes it). **Effective monthly = `pricePerSeat × seats`**, computed at display, never stored. `PATCH /api/platform-admin/tenants/:id/pricing` `{pricePerSeat?, seats?, reason}` adjusts commercials without a plan change (`subscription.price_adjusted` audit). A plan change resets the rate to the new plan's list price. |
| Change a tenant's plan | ✅ `PATCH /api/platform-admin/tenants/:id/plan` — re-snapshots the new plan's current definition onto the `Subscription` and **resets the per-seat rate to the new plan's list price**; `tenant.plan_changed` audit. |
| Operator console UI | ✅ full multi-screen console — see Status line |
| Billing / plan enforcement (seat limits, dunning) | 🔴 not started |
| Break-glass support access to tenant data | 🟡 `platform.break_glass_grants` gives the full audited control-plane lifecycle — request (`POST .../breakglass`, one active grant per tenant, TTL 15/30/60/120 min), status (`GET .../breakglass`), revoke (`POST .../breakglass/:grantId/revoke`), and an hourly job auto-expiring overdue grants — console fully wired (request dialog + live status sheet with countdown + revoke). Does **not** yet grant an operator any actual elevated read against the tenant's data during the window — that's a separate connection-pool escalation mechanism, deliberately still unbuilt |

### Happy path

1. Founder logs in at `/platform-admin` (Firebase, platform-admin project
   claim).
2. Opens "Tenants" → clicks **New tenant** → enters company name,
   subdomain, plan, and the first admin's email.
3. Backend creates `platform.tenants` + `platform.subscriptions`, then —
   over the `hrms_app` connection scoped to the new tenant — creates the
   `public.users` Company Admin row and sets their Firebase custom claims.
4. Founder shares the subdomain + tells the admin to do a password reset.
5. Later: founder can suspend a non-paying tenant → all its users get 403
   at `TenantResolutionMiddleware` on their next request.

### Functionalities / API

| Method | Path | Guard | State |
|---|---|---|---|
| `POST` | `/api/platform-admin/auth/session` | public | ✅ |
| `GET` | `/api/platform-admin/tenants` | `PlatformJwtAuthGuard` | ✅ |
| `POST` | `/api/platform-admin/tenants` | `PlatformJwtAuthGuard` | ✅ body `{companyName, subdomain, adminEmail, adminName, plan?, seats?, pricePerSeat?}` — `pricePerSeat` omitted → plan list price; sends the admin a reset link (non-fatal — response includes `adminResetEmailSent`); writes `tenant.created` |
| `POST` | `/api/platform-admin/tenants/:id/resend-admin-reset` | `PlatformJwtAuthGuard` | ✅ re-fires the tenant's Company Admin's hosted reset email; 400s if the tenant has no Company Admin, propagates the identity-provider error otherwise (no swallowing, unlike the create-time send) |
| `PATCH` | `/api/platform-admin/tenants/:id/status` | `PlatformJwtAuthGuard` | ✅ body `{status, reason?}`; writes `tenant.status_changed` |
| `PATCH` | `/api/platform-admin/tenants/:id/plan` | `PlatformJwtAuthGuard` | ✅ body `{plan, reason}`; re-snapshots the plan onto the Subscription, resets per-seat rate to the new plan's list price; writes `tenant.plan_changed` |
| `PATCH` | `/api/platform-admin/tenants/:id/pricing` | `PlatformJwtAuthGuard` | ✅ body `{pricePerSeat?, seats?, reason}` (≥1 of price/seats); adjusts negotiated commercials, no plan change; writes `subscription.price_adjusted` |
| `POST` | `/api/platform-admin/tenants/:id/renew` | `PlatformJwtAuthGuard` | ✅ re-snapshots current plan modules/features, **keeps negotiated rate + seats**, bumps `renewsAt` +1y; writes `subscription.renewed` |
| `GET` | `/api/platform-admin/plans` | `PlatformJwtAuthGuard` | ✅ catalog + per-plan tenant counts |
| `PATCH` | `/api/platform-admin/plans/:key` | `PlatformJwtAuthGuard` | ✅ edit list price per seat / default seats / modules / features / isolation tier; writes `plan.updated` |
| `GET` | `/api/platform-admin/tenants/:id` | `PlatformJwtAuthGuard` | ✅ tenant detail — subscription, `firstAdminEmail`, `headcountHistory` (one data point today — no time-series table yet), `recentAudit` |
| `POST` | `/api/platform-admin/tenants/:id/refresh-headcount` | `PlatformJwtAuthGuard` | ✅ audited (`headcount.refreshed`, only when the count changed) |
| `GET` | `/api/platform-admin/audit` | `PlatformJwtAuthGuard` | ✅ |
| `POST` | `/api/platform-admin/tenants/:id/breakglass` | `PlatformJwtAuthGuard` | ✅ `{reason (≥10 chars), ttlMinutes (15\|30\|60\|120)}` → `{id, expiresAt}`; 409s if the tenant already has an active grant; writes `breakglass.requested` |
| `GET` | `/api/platform-admin/tenants/:id/breakglass` | `PlatformJwtAuthGuard` | ✅ the tenant's current ACTIVE grant, or `null` |
| `POST` | `/api/platform-admin/tenants/:id/breakglass/:grantId/revoke` | `PlatformJwtAuthGuard` | ✅ writes `breakglass.revoked` |

### Known gaps / TODO

- **Break-glass elevated-read mechanism** — `BreakGlassGrant` gives the
  full audited request/track/expire/revoke lifecycle (see the feature list
  above), but an ACTIVE grant doesn't currently change what the platform
  role can query. Actually letting a platform admin read one tenant's data
  for the grant's lifetime needs its own connection-pool escalation design
  (a temporary, scoped credential or RLS bypass, itself logged per-query) —
  deliberately not built in this pass; the `accessCount` field on the grant
  is reserved for that later work. This is the one item keeping module 02
  below 100%.
- Subscription lifecycle: seat counting vs plan, `PAST_DUE` → auto-suspend.
- `Subscription.renewsAt` is only ever set by a renewal (manual or
  scheduled) — a brand-new tenant has no `renewsAt` until its first renewal,
  so the scheduled renewal job has nothing to pick up for it until then.
  Pre-existing behavior, unrelated to this pass's scheduling addition.

---

## 3. Employee Master + Org Structure

**Deep spec:** `docs/modules/03_EMPLOYEE_MASTER.md` ·
**UI prompt:** `docs/ui-build-prompts/03-employee-master.md`
**Status:** ✅ 100% — full field set (statutory/bank via app-layer AES-256-GCM
encryption, emergency contacts, comp-adjacent fields), lifecycle state
machine, bulk-import UI, document hardening (MIME/size server-side, category,
delete), department edit/delete-with-reassign, an org chart rooted per role
with search/expand/collapse/zoom/click-to-drawer quick view, a real photo
upload (private object storage, not a hand-typed URL), a proper reveal-reason
confirm dialog, and Leave's recursive Line-Manager scoping mirror are all
live. Only the deliberately-deferred BU→Team hierarchy remains.
**Code:** `apps/api/src/employees`, `apps/api/src/crypto`
(`FieldEncryptionService`), `apps/web/src/pages/employees`,
`apps/web/src/pages/org-chart.tsx`, `apps/web/src/pages/departments.tsx`

### Expectation

The single source of truth every other module references. An employee
record carries identity, employment, compensation-adjacent, statutory,
bank, and emergency-contact data; supports the employment lifecycle; and
supports documents. Reads are row-scoped by role (an Employee sees only
themselves; a Line Manager sees their reports). Bulk onboarding via Excel
must validate and report per-row rather than fail the batch.

### Feature list

| Feature | SRS | V1 status |
|---|---|---|
| Employee CRUD — personal + employment fields | FR-EMP-001/002 | ✅ full field set: identity/personal, employment, compensation-adjacent |
| Bank account details for disbursement (a/c, IFSC, bank, type) | FR-EMP-003 | ✅ `bankAccountNumber` AES-256-GCM encrypted (`FieldEncryptionService`), masked by default, logged reveal |
| Emergency contact (name, relationship, phone, address) | FR-EMP-004 | ✅ full CRUD, RULE-5 primary-swap |
| Document upload (PDF/JPG/PNG, ≤10MB) — offer letter, IDs, certs | FR-EMP-005 | ✅ MIME allow-list + size cap enforced server-side; category + delete added |
| Employee lifecycle states | FR-EMP-007 | ✅ `EmployeeLifecycleState` (`PRE_JOINING/PROBATION/CONFIRMED/NOTICE_PERIOD/SUSPENDED/SEPARATED`) matches the SRS set; `PATCH /employees/:id/lifecycle` validates transitions, `SEPARATED` disables the linked login |
| Bulk import via Excel template + error report | FR-EMP-009 | ✅ API + frontend (`apps/web/src/pages/employees/import.tsx`) |
| Multi-level hierarchy (Company → BU → Dept → Team) | FR-ORG-001 | 🟡 Department (now with `code`/`headEmployeeId`, edit/delete-with-reassign) + self-referential `reportingManagerId`; BU/Team levels **deliberately deferred** — flat hierarchy decided sufficient for V1 |
| Interactive org chart — reporting lines, expand, search | FR-ORG-002 | ✅ tree rooted per role (recursive subtree for Employee/Line Manager); search (auto-expands ancestors of a match, highlights hits), per-node + expand-all/collapse-all, zoom (60–160%), and a click-to-drawer quick view (report count + direct reports + link to full profile) |
| Multiple reporting lines (solid + dotted) | FR-ORG-003 | 🔴 single `reportingManagerId` only |
| Org chart export PDF/PNG | FR-ORG-004 | 🔴 explicitly deferred |
| No-code custom field builder | FR-EMP-008 | 🔴 deferred |

### Happy path (HR adds an employee)

1. HR Manager → **Employees** → **Add employee**.
2. Fills personal + employment details, picks a department and a
   reporting manager, optionally a linked login (role).
3. Submit → `POST /api/employees` → row created (RLS stamps `tenant_id`);
   if a login was requested, a `public.users` row + Firebase user +
   custom claims are created.
4. HR opens the new employee's detail page → **Documents** → uploads the
   signed offer letter → stored at
   `tenants/<tid>/employees/<eid>/<uuid>-<name>` in S3/MinIO, metadata in
   `public.documents`.
5. Employee later logs in and sees **only** their own record; their Line
   Manager sees them in their team list and the org chart.

### Happy path (bulk import)

1. HR → **Employees → Bulk import** → downloads the `.csv` template
   (`employeeCode`, `firstName`, `lastName` required; `personalEmail`,
   `phone`, `designation` optional).
2. Uploads the file → `POST /api/employees/bulk-import` (multipart `file`).
3. Server parses with `exceljs`, inserts row-by-row, returns
   `[{ row, status: 'ok' | 'error', message }]`; the UI shows a per-row
   result table and offers a failed-rows download.
4. HR fixes the flagged rows and re-uploads only those.

### Functionalities / API

| Method | Path | Roles |
|---|---|---|
| `GET` | `/api/employees` | any (row-scoped; Line Manager = full recursive subtree) |
| `GET` | `/api/employees/:id` | any (row-scoped) |
| `GET` | `/api/employees/org-chart` | Admin / HR / Line Manager / Auditor / Employee — rooted per role |
| `POST` | `/api/employees` | Company Admin, HR Manager |
| `PATCH` | `/api/employees/:id` | any — Admin/HR full field set; Employee self-only + RULE-1 whitelist; Line Manager/Auditor 403 |
| `PATCH` | `/api/employees/:id/sensitive-fields` | Company Admin, HR Manager |
| `POST` | `/api/employees/:id/reveal` | Company Admin, HR Manager, Auditor |
| `GET`/`POST`/`PATCH`/`DELETE` | `/api/employees/:id/emergency-contacts[/:contactId]` | read: row-scoped · write: self or Admin/HR |
| `POST` | `/api/employees/bulk-import` | Company Admin, HR Manager |
| `POST` | `/api/employees/:id/photo` | self or Admin/HR — JPEG/PNG/WebP, ≤5MB; replaces the previous object |
| `GET` | `/api/employees/:id/documents` | row-scoped |
| `POST` | `/api/employees/:id/documents` | Admin/HR (any) or Employee (own only) |
| `GET` | `/api/documents/:id/download-url` | row-scoped — 5-min presigned URL |
| `PATCH` | `/api/documents/:id/category` · `DELETE /api/documents/:id` | Company Admin, HR Manager |
| `GET` / `POST` / `PATCH` / `DELETE` | `/api/departments[/:id]` | list: any · write: Admin / HR |

### Known gaps / TODO

- The Line-Manager recursive-subtree decision (§4.1 of the deep spec) is
  now mirrored in both Leave (module 04) and Attendance (module 05, its
  `teamRoster`/`pendingRegularizations`/approve-reject scoping) — see the
  2026-09-18 sync notes at the top of this file for exactly which checks
  changed and which stayed direct-only on purpose.
- BU/Team hierarchy levels remain deliberately deferred (flat hierarchy is
  V1 scope, not a gap).

**Closed:** lifecycle state machine; the full field set (identity/personal
extras, employment extras, compensation-adjacent, statutory + bank with
AES-256-GCM field encryption and a masked-reveal endpoint); emergency
contacts; document MIME/size hardening + category + delete; bulk-import
frontend; department edit/delete-with-reassign; org chart rooted per role
plus search/expand/collapse/zoom/quick-view; a real photo-upload widget
(`photoKey` object-storage field, replacing the hand-typed `photoUrl`
string); a proper reveal-reason confirm dialog (replacing `window.prompt`);
Leave's recursive Line-Manager scoping mirror; and the Employee self-edit
path (documented as a target before an earlier pass but never actually
wired — the endpoint was Admin/HR-only).

---

## 4. Leave Management

**Deep spec:** `docs/modules/04_LEAVE_MANAGEMENT.md` ·
**UI prompt:** `docs/ui-build-prompts/04-leave-management.md` ·
**API contract:** `docs/LEAVE_UI_SPECS.md`
**Status:** ✅ 100% — backend fully wired, tested, and serving the real API;
the frontend live path is built and runs against it by default; every
originally-tracked feature gap is closed, including the mock-default flip:
`apps/web/src/lib/leave/client.ts`'s `USE_MOCK` now reads
`import.meta.env.VITE_LEAVE_MOCK === 'true'` (inverted default, matching
`access/client.ts`), so a fresh checkout with no env var set renders the
real API, not the fixture store.
`TenantSettings.allowLopRequests`/`fyStartMonth` and
`LeaveType.minNoticeDays`/`genderRestriction`/`requiresApproval` are all
enforced/settable, the accrual job prorates a new joiner's first period,
comp-off credits automatically on holiday/weekly-off clock-ins, and
approved leave reconciles into `AttendanceRecord` (`ON_LEAVE`, reversed on
cancel). Comp-off/reconciliation are **synchronous** (at clock-in and
approve/cancel time) rather than a nightly finalization job — see the
note under "Known gaps" below. See `docs/LEAVE_UI_SPECS.md`.
**Code:** `apps/api/src/leave` (service/controller + `leave-escalation.processor.ts` /
`leave-accrual.processor.ts` on a new BullMQ `leave` queue — see `docker-compose.yml`'s
`redis` service), `apps/web/src/pages/leave`, `apps/web/src/lib/leave` (typed
client + fixture/mock layer — **defaults to live**; `VITE_LEAVE_MOCK=true`
forces the mock)

### Expectation

Configurable leave types with quotas and carry-forward; per-employee
per-year balances; a multi-level approval workflow; balance deduction
only on final approval; and a holiday calendar so day counts are
working-days, not raw calendar days. Approved leave must reconcile with
attendance and flag LOP when the balance is short.

### Feature list

| Feature | SRS | V1 status |
|---|---|---|
| Leave type definitions (CL/SL/EL/…); quota + carry-forward cap + accrual frequency | FR-LVE-001 | ✅ `LeaveType` has `annualQuota`, `carryForwardCap`, `accrualFrequency` (ANNUAL/MONTHLY/QUARTERLY), `code`, `colorToken`, `minNoticeDays` (enforced), `active`, `genderRestriction` (enforced in `apply()`, fails open on unrecognized `Employee.gender` — see below), `paid` (informational only), `requiresApproval` (settable via DTO), `isCompOff` (marks the tenant's comp-off type). No `encashment` field exists — that concept isn't modelled anywhere (it's unrelated Full & Final Settlement prose elsewhere in this doc) |
| Per-employee per-year balances; init for a year | FR-LVE-004 | ✅ `initializeYearlyBalances()` upserts ANNUAL types; MONTHLY/QUARTERLY types auto-accrue via `LeaveAccrualProcessor` (daily BullMQ job, idempotent via `LeaveLedgerEntry`), now prorating a new joiner's first period by `Employee.dateOfJoining`; balance-year bucketing follows `TenantSettings.fyStartMonth` via `resolveLeaveYear()` |
| Company holiday calendar (national + state optional) | FR-LVE-003 | ✅ `Holiday` table + full CRUD (`/api/leave/holidays`); `apply()` counts working days (holidays + `TenantSettings.weeklyOffDays` excluded) |
| Apply for leave (dates, type, reason, attachment) | FR-LVE-005 | ✅ dates/type/reason/attachment all wired (`POST /api/leave/requests/:id/attachment`, stored + scanned via module 09 Documents; downloadable from the request sheet) |
| Multi-level approval (1 or 2, tenant-configurable) + escalation timers | FR-LVE-006 | ✅ `TenantSettings.leaveApprovalLevels` (1 or 2) now actually read by `apply()` — previously hardcoded to 2. `LeaveEscalationProcessor` auto-escalates an undecided L1 to L2 after `leaveEscalationDays`, and flags an undecided L2 for manual HR follow-up (no auto-approve). *(The old SRS's "up to 4 levels" is stale — the schema/FE contract cap V1 at 2; see `CLAUDE.md`.)* |
| Team calendar shown before submitting | FR-LVE-007 | ✅ `GET /leave/calendar` exists; the Apply tab renders it inline (`tabs/apply.tsx`) alongside the dedicated Team Calendar tab |
| Approved leave syncs to attendance; flags LOP | FR-LVE-008 | ✅ `isLop` computed on apply; `LeaveService` writes `AttendanceRecord.status = 'ON_LEAVE'` for the request's working days on final approval (reversed on cancel) via direct Prisma access, not a nightly job — see "Known gaps" |
| Comp-off credit for holiday/weekend work | FR-LVE-009 | ✅ `AttendanceService.clockIn()` detects a `Holiday`/`TenantSettings.weeklyOffDays` match and calls `LeaveService.creditCompOff()`, which credits +1 day to the tenant's `isCompOff` `LeaveType` (idempotent per employee/day, opt-in per tenant) |
| Notifications (apply/approve/reject/cancel/escalation) | FR-LVE-010 | ✅ via module 10 (email); balance-expiry has no trigger yet — no year-end expiry event exists in Leave |
| Cancel — reverses an approved non-LOP deduction | — | ✅ `cancel()`, now also logs a `LeaveLedgerEntry` |
| Decision/escalation history, HR balance adjustments, ledger | — | ✅ new `LeaveApproval` (append-only decision/escalation log) and `LeaveLedgerEntry` (balance-movement audit trail) tables |

### Happy path (employee applies)

1. Employee → **Leave** → sees balances per type (`accrued − used`).
2. Clicks **Apply**, picks type + from/to dates + reason (+ optional attachment).
3. `POST /api/leave/requests` → server computes a **working-day** count
   (holidays + weekly-offs excluded), compares to available balance, sets
   `isLop = true` if short (but still creates the request), and routes to
   `PENDING_L1` (or straight to `PENDING_L2` if the tenant is configured
   for 1 approval level, or if the employee has no `reportingManagerId`).
   A delayed escalation job is scheduled for `leaveEscalationDays` out.
4. Line Manager → **Leave** → **Pending approvals** → `POST
   .../requests/:id/approve` (optional `{ comment }`) → status →
   `PENDING_L2`; a fresh L2 escalation job is scheduled. If the manager
   doesn't act in time, the escalation job auto-advances the request to
   `PENDING_L2` and logs an `ESCALATED` `LeaveApproval` entry instead.
5. HR Manager approves → status → `APPROVED`; the balance is deducted
   **only now**, and **only if** `!isLop` — logged as a `LeaveLedgerEntry`.
6. Employee sees the request as approved; balance reflects the deduction.
   If they later cancel, a non-LOP approved deduction is added back (also
   ledgered).

### Functionalities / API

| Method | Path | Roles |
|---|---|---|
| `GET` | `/api/leave/types` | any (tenant) |
| `POST` | `/api/leave/types` | Company Admin, HR Manager |
| `PATCH` | `/api/leave/types/:id` | Company Admin, HR Manager |
| `POST` | `/api/leave/types/:id/initialize/:year` | Company Admin, HR Manager |
| `GET` · `POST` | `/api/leave/holidays?year=` | any (read) · Company Admin/HR Manager (write) |
| `PATCH` · `DELETE` | `/api/leave/holidays/:id` | Company Admin, HR Manager |
| `GET` · `PATCH` | `/api/leave/settings` | any (read) · Company Admin (write) |
| `GET` | `/api/leave/balances/:employeeId?year=` | any (row-scoped); `year` defaults to the tenant's current leave year (`fyStartMonth`-aware) |
| `GET` | `/api/leave/team/balances?year=` | any (scoped: direct reports for Line Manager, all for HR/Admin) |
| `POST` | `/api/leave/balances/adjust` | Company Admin, HR Manager |
| `GET` | `/api/leave/balances/ledger?employeeId=&leaveTypeCode=` | Company Admin, HR Manager, Auditor |
| `POST` | `/api/leave/requests` | any (tenant) |
| `GET` | `/api/leave/requests?status=&leaveTypeId=&department=&from=&to=` | Company Admin, HR Manager, Auditor |
| `GET` | `/api/leave/requests/:id` | row-scoped (includes `approvals[]` history) |
| `POST` | `/api/leave/requests/:id/attachment` | owner or Company Admin/HR Manager |
| `POST` | `/api/leave/requests/:id/cancel` | any (owner) or Company Admin/HR Manager |
| `POST` | `/api/leave/requests/:id/approve` | Line Manager, HR Manager, Company Admin |
| `POST` | `/api/leave/requests/:id/reject` | Line Manager, HR Manager, Company Admin |
| `GET` | `/api/leave/requests/employee/:employeeId` | any (row-scoped) |
| `GET` | `/api/leave/requests/pending-approvals` | any (returns [] if not an approver) |
| `GET` | `/api/leave/calendar?from=&to=` | any (tenant) |

### Known gaps / TODO

All originally-tracked feature gaps are closed, including the mock-default
flip: `apps/web/src/lib/leave/client.ts`'s `USE_MOCK` now reads
`import.meta.env.VITE_LEAVE_MOCK === 'true'` (inverted default, matching
`access/client.ts`), so a plain `npm run dev` / build runs against the live
API by default — set `VITE_LEAVE_MOCK=true` to force the fixture store.

What follows is a scope note, not a gap:

- Comp-off crediting and leave→attendance reconciliation are
  **synchronous** — comp-off checks the day at clock-in time, attendance
  sync writes `ON_LEAVE` rows at approve/cancel time. Neither depends on
  or duplicates Attendance's own much bigger "nightly finalization job"
  gap (§5 gap #3: holiday → weekly-off → approved leave → punches ⇒ final
  status, still unbuilt) — if that job is ever built, it should treat
  `ON_LEAVE` rows Leave already wrote as authoritative rather than
  recomputing them.
- `genderRestriction` enforcement fails open when `Employee.gender`
  (free-text, no schema enum) doesn't normalize to exactly `MALE`/
  `FEMALE` — a data-quality gap must never block a legitimate employee.
  The Employees module's own update DTO doesn't currently expose `gender`
  as a settable field either (unrelated to Leave; noted here since it's
  the only way to observe this in practice today).

---

## 5. Attendance & Time Tracking

**Deep spec:** `docs/modules/05_ATTENDANCE.md` ·
**UI prompt:** `docs/ui-build-prompts/05-attendance.md`
**Status:** ✅ 100% — employee self-service, shift/tenant-config-aware and
plan-gated; a Company Admin/HR Manager Settings tab manages shifts +
attendance/general config; a nightly finalization job, full regularization
approval, and manager/HR team views are all live. Only the explicitly
deferred capture channels (GPS/biometric/selfie-QR, `POST /attendance/ingest`)
remain unbuilt — see `CLAUDE.md` → "Explicitly deferred".
**Code:** `apps/api/src/attendance`, `apps/web/src/pages/attendance`

### Expectation

Per-employee daily attendance from clock-in/out with breaks; a monthly
calendar + stats view; a regularisation (correction-request) workflow
with manager approval; and month-end data that feeds LOP into payroll.
Manual marking by HR with an audit trail. Shifts and overtime hours.
Biometric/GPS capture is **deferred**.

### Feature list

| Feature | SRS | V1 status |
|---|---|---|
| Clock-in / clock-out | — | ✅ `POST /attendance/clock-in`, `/clock-out` — also writes a `Punch` row (source `WEB`), the source-of-truth capture the nightly job and any future device/import source read |
| Break start / end | — | ✅ `AttendanceBreak` rows |
| "Today" status card | FR-ESS-001 | ✅ `GET /attendance/today` — now includes `overtimeMs` |
| Monthly calendar (per-day status) | — | ✅ `GET /attendance/calendar?month=` |
| Monthly stats (present/absent/late/hours) | — | ✅ `GET /attendance/stats?month=` — now includes `overtimeHours` |
| Regularisation request (reason, subject to approval, window) | FR-ATT-009 | ✅ create/list/cancel, **plus** `regularizationWindowDays` (raise-by deadline) and `regularizationMonthlyCap` enforced at request time; flags the day `PENDING_REGULARIZATION` while under dispute |
| Manual attendance marking by HR + audit trail | FR-ATT-001 | ✅ `POST /attendance/mark` — reasoned, writes `audit_log` |
| Shift definitions (Fixed / Rotational / Flexible) | FR-ATT-006 | ✅ `Shift` catalogue (CRUD via `/attendance/shifts`, Settings tab) — `type` is stored/settable; FLEXI's core-hours window isn't yet a distinct behavior branch |
| Late-arrival / early-departure flags + grace period | FR-ATT-008 | ✅ per-shift, settable |
| Overtime calculation | FR-ATT-007 | ✅ hours beyond `Shift.minHoursFullDay`, on `today()`/`stats()`. **Scope note:** this measures TIME only — converting to statutory per-state overtime PAY is Payroll's job (module 07, not built) |
| Month-end feed into payroll LOP | FR-ATT-010 | ✅ `getLopDays(employeeId, month)` + `GET /attendance/lop-days` — the defined contract; Payroll itself doesn't exist yet to call it |
| GPS geo-fenced check-in | FR-ATT-002 | 🔴 deferred |
| Biometric device (ZKTeco/eSSL) integration | FR-ATT-003 | 🔴 deferred (see `CLAUDE.md`) |
| Selfie / QR check-in | FR-ATT-004/005 | 🔴 deferred |

### Happy path (employee, today)

1. Employee → **Attendance** → **Clock in** (`POST /attendance/clock-in`)
   → an `AttendanceRecord` for today is opened (status computed) and a
   `Punch` row is written.
2. Takes lunch → **Start break** / **End break** → `AttendanceBreak` rows;
   worked-hours exclude break time.
3. End of day → **Clock out** → record closed, total hours finalised;
   overtime shown once effective time exceeds the shift's target.
4. Views the **calendar** for the month and the **stats** summary.

### Happy path (regularisation)

1. Employee forgot to clock in Tuesday → **Request regularisation** →
   picks the date, a `RegularizationReasonType`, and a note →
   `POST /attendance/regularization` → rejected if the date is outside
   `regularizationWindowDays` or the monthly cap is reached; otherwise
   creates a `PENDING` `RegularizationRequest` and flags that day
   `PENDING_REGULARIZATION`.
2. Their manager (recursive subtree) or HR/Admin sees it in **Attendance →
   Approvals** → `POST .../:id/approve` finalizes the day PRESENT/LATE from
   the requested times (or `/reject` reverts it to its base
   holiday/weekly-off/absent status) — both write an `audit_log` row.
   Multiple requests can be bulk-approved.
3. Employee can `POST /attendance/regularization/:id/cancel` while it's
   still pending.
4. If nobody decides it before the tenant's `payrollCutoffDay`, the nightly
   `resolve-cutoff` job auto-resolves it per `unactionedBehavior`
   (`AUTO_APPROVE`/`AUTO_REJECT`), auditing the resolution with actor `null`.

### Happy path (manager/HR views)

1. A Line Manager or HR/Admin opens **Attendance → Team** → picks a date →
   `GET /attendance/team/roster?date=` shows every report's status for that
   day (scoped to the caller's recursive subtree; unscoped for HR/Admin).
2. HR/Admin can **Mark** any row directly (`POST /attendance/mark`) for the
   one-off cases self-service/regularization don't cover.
3. **Attendance → Approvals** is the regularisation queue from the happy
   path above.

### Happy path (nightly finalization — no human involved)

Once a day (02:00 UTC), for every non-suspended tenant, every employee,
*yesterday*: if the day already has a real outcome (a self-service
clock-in, Leave's synchronous `ON_LEAVE` write, or an active regularization
dispute) it's left untouched. Otherwise: holiday → `HOLIDAY`; tenant
weekly-off → `WEEKLY_OFF`; else if `Punch` rows exist (a future
biometric/import source, or any punches that outlived a same-day clock-out
failure) → derive `PRESENT`/`LATE` from first-IN/last-OUT; else → `ABSENT`
(the day `getLopDays()` later counts).

### Functionalities / API

| Method | Path | Roles |
|---|---|---|
| `POST` | `/api/attendance/clock-in` · `/clock-out` · `/break/start` · `/break/end` | self-service |
| `GET` | `/api/attendance/today` · `/calendar?month=` · `/stats?month=` | self-service |
| `POST` | `/api/attendance/regularization` | self-service |
| `GET` | `/api/attendance/regularization` | self-service (own) |
| `GET` | `/api/attendance/regularization/pending` | any (scoped: recursive subtree for Line Manager, all for HR/Admin, `[]` otherwise) |
| `POST` | `/api/attendance/regularization/:id/cancel` | owner only, while `PENDING` |
| `POST` | `/api/attendance/regularization/:id/approve` · `/reject` | Line Manager (subtree), HR Manager, Company Admin |
| `POST` | `/api/attendance/regularization/bulk-approve` | Line Manager, HR Manager, Company Admin — `{ids}` → per-id `{id, ok, error?}` |
| `GET` | `/api/attendance/team/roster?date=` | any (scoped like `pending`) |
| `POST` | `/api/attendance/mark` | Company Admin, HR Manager — reasoned + audited |
| `GET` | `/api/attendance/lop-days?employeeId=&month=` | Company Admin, HR Manager |
| `GET` | `/api/attendance/shifts` | any (read) |
| `POST` · `PATCH` · `DELETE` | `/api/attendance/shifts[/:id]` | Company Admin, HR Manager |
| `GET` | `/api/attendance/settings` | Company Admin, HR Manager, Auditor |
| `PATCH` | `/api/attendance/settings` | Company Admin only |

Every route sits behind `JwtAuthGuard + TenantGuard + EntitlementGuard`
(`@RequiresModule('ATTENDANCE')` at the controller — a tenant on a plan
without Attendance gets a 403, not a broken self-service page), plus
`RolesGuard` where a route carries `@Roles(...)`.

### Known gaps / TODO

All originally-tracked gaps are closed. What's left is explicitly deferred,
not gaps:

- GPS geo-fenced check-in, biometric device integration, selfie/QR
  check-in — CLAUDE.md → "Explicitly deferred".
- `POST /attendance/ingest` for biometric/CSV import — per-client work,
  gated behind `subscription.features.biometricIntegration`
  (`@RequiresFeature('biometricIntegration')` is ready to use whenever
  this is built).
- FLEXI shifts' core-hours window (`Shift.coreStartTime`/`coreEndTime`) is
  stored and settable but not yet read by any status-computation branch —
  a FLEXI shift today behaves like FIXED. Not part of V1's tracked scope;
  revisit if a client actually needs flexi-hours enforcement.
- Statutory per-state overtime **pay** conversion is Payroll's job (module
  07, not built) — Attendance measures overtime hours only, by design.

---

## 6. Dashboard

**Status:** ✅ 100%
**Deep spec:** `docs/modules/06_DASHBOARD.md` · UI build prompt:
`docs/ui-build-prompts/06-dashboard.md`
**Code:** `apps/api/src/dashboard`, `apps/web/src/pages/dashboard.tsx`

### Expectation

One role-aware home screen. The **server** decides what the user sees
(one endpoint, shaped by role) rather than the frontend assembling many
calls — keeps "what does an HR Manager see vs an Employee" in one place.

### Feature list

| Audience | Content | Status |
|---|---|---|
| Company Admin / HR Manager | Headcount, department breakdown, pending-approvals count | ✅ |
| Line Manager | Own leave balances + pending approvals from reports + recent requests | ✅ |
| Employee | Own leave balances, own pending items, 5 most recent leave requests | ✅ |
| Everyone (incl. admins) | Own attendance "today" snapshot (status, check-in/out, worked hours), gated on the tenant's `ATTENDANCE` entitlement | ✅ |
| Everyone | Upcoming payslip date | 🔴 blocked on Payroll (module 07, not built) — not counted against 100%, same treatment as other Payroll-blocked items across modules |
| Admin | Payroll cost, attrition rate, avg tenure | 🔴 blocked on Payroll (module 07, not built) — not counted against 100% |

### Happy path

1. User logs in → lands on `/`.
2. `GET /api/dashboard` → server branches on `user.role`:
   admins get org aggregates; everyone else gets a personal view. Both
   branches also carry `todayAttendance` for the calling user when they
   have a linked employee record and the tenant's plan includes
   `ATTENDANCE`.
3. Cards render; "pending approvals" is non-empty for a Line Manager with
   reports awaiting L1; the attendance card reflects the caller's live
   clock-in state (not clocked in / working / on break / day complete).
4. Quick actions: the attendance card's Clock In / Take Break / End Break /
   Clock Out buttons and each pending-approval row's Approve/Reject buttons
   call Attendance's and Leave's own endpoints directly (no new Dashboard
   route), then re-fetch `GET /api/dashboard` so the whole screen reflects
   the new state.

### Functionalities / API

| Method | Path | Notes |
|---|---|---|
| `GET` | `/api/dashboard` | returns `{ view: 'admin' \| 'employee', ..., todayAttendance }`; `todayAttendance` is `null` when the caller has no linked employee record or the tenant's plan doesn't include `ATTENDANCE` |
| `POST` | `/api/attendance/clock-in` \| `/clock-out` \| `/break/start` \| `/break/end` | Attendance's own endpoints (module 5), called directly by the dashboard's quick actions — not Dashboard-owned |
| `POST` | `/api/leave/requests/:id/approve` \| `/reject` | Leave's own endpoints (module 4), called directly by the dashboard's pending-approval row buttons — not Dashboard-owned |

### Known gaps / TODO

- Upcoming payslip date and admin payroll/attrition tiles wait on Payroll
  (module 07) to exist at all — deliberately deferred, not a Dashboard gap.
- Dashboard's reject button has no reason/comment box (matches the
  existing row-level precedent in Leave's own Approvals tab — comment is
  optional server-side either way); a required-reason UX would be a small
  frontend addition, not a backend change.

---

## 7. Payroll Engine 🔴

**Status:** not started. **Highest-effort, highest-risk module — protect
its time budget over breadth elsewhere** (`CLAUDE.md`).
**Target code location:** `apps/api/src/payroll`

### Expectation

India-compliant monthly payroll: a configurable salary-structure builder,
statutory computation (EPF, ESI, PT, TDS), a **locked** processing cycle,
payslip PDFs, and a bank disbursement file. Two hard invariants:

- **Payroll is never processed twice for the same period** without
  explicit override **and** dual approval (FR-PAY intro).
- **Processed payroll runs are immutable event records — no in-place
  edits** (FR-PAY-018). Corrections are new adjusting entries.

### Feature list (all `[MUST]` unless noted)

**Salary structure**
- Component builder: Basic, HRA, Special Allowance, Conveyance, LTA,
  Medical, custom allowances, PF/ESI employer, gratuity provision
  (FR-PAY-001).
- Each component: fixed / % of Basic / % of CTC / formula (FR-PAY-002).
- Minimum Basic = 50% of CTC, configurable floor per company
  (FR-PAY-003).
- Salary revision history: effective date, revised CTC, reason, approver
  (FR-PAY-004).
- Auto-arrears on backdated revision (FR-PAY-005).

**Statutory computation**
- EPF on Basic+DA, ₹15,000 ceiling (configurable to opt above)
  (FR-PAY-006).
- State-specific Professional Tax slabs as admin-configurable lookup
  tables (FR-PAY-007).
- Annual taxable-income projection for TDS incl. declared investments
  (80C/80D/HRA/LTA) (FR-PAY-008).
- Old **and** New tax regime, employee choice per FY (FR-PAY-009).
- Re-compute TDS when projection changes mid-year (FR-PAY-010).

**Processing**
- Locked cycle: **Draft → Review → Approve → Process → Disbursed**
  (FR-PAY-011).
- Auto-import LOP days from Attendance for the pay period (FR-PAY-012) —
  depends on §5 exposing that.
- Ad-hoc payments: advance, bonus, incentive, gratuity payout
  (FR-PAY-013).
- Payslip PDF, password = employee DOB `DDMMYYYY` (FR-PAY-014).
- NEFT/RTGS bank file in HDFC/ICICI/SBI/Axis formats (FR-PAY-015).
- Full & Final settlement: unpaid salary, leave encashment, gratuity,
  advance recovery (FR-PAY-016).
- `[SHOULD]` Razorpay Payroll API disbursement + webhook (FR-PAY-017).
- Immutable run records (FR-PAY-018).

### Happy path (monthly run)

1. HR/Payroll Manager opens **Payroll → New run** for `2026-09`.
2. System assembles a **Draft**: each active employee's structure ×
   attendance (LOP) × statutory deductions × ad-hoc items.
3. Manager **Reviews** line items, fixes ad-hoc entries, re-runs
   calculation.
4. **Approve** — requires a second approver (dual approval) if this
   period was already processed once.
5. **Process** — run becomes immutable; payslip PDFs generated
   (DOB-locked); bank file generated.
6. **Disburse** — bank file downloaded (or Razorpay call); status →
   Disbursed; per-employee `NET_PAID` recorded.
7. Employees see the payslip in self-service; the amounts feed
   Compliance (§8) for ECR / challan / 24Q.

### Build notes

- `NUMERIC` everywhere; round per statute, not per float.
- Model a run as an append-only event stream (`PayrollRun` +
  `PayrollLineItem`, no updates after `PROCESSED`).
- Statutory rates/slabs/ceilings are **config tables**, never constants —
  the SRS explicitly wants Labour-Code rules as rule-engine config.
- Sequence per the blueprint's 12-week plan; do structure + statutory +
  single-run before FnF, arrears, and Razorpay.

---

## 8. Statutory Compliance 🔴

**Deep spec:** `docs/modules/08_STATUTORY_COMPLIANCE.md`
**Status:** not started, deep spec written 2026-09-23. Table-stakes for
the Indian market; filing errors expose customers to penalties.
**Generate files for portal upload — do not build live e-filing APIs for
V1** (`CLAUDE.md` deferred list). **Hard prerequisite: module 7 Payroll
Engine (also 0%)** — EPF/ESI/Income-Tax features all consume only
processed payroll runs; only the POSH sub-module (ICC management,
complaint workflow, annual report) is buildable independently of Payroll.
See the deep spec's §0.
**Target code location:** `apps/api/src/compliance`

### Expectation

Given a processed payroll period, produce the statutory artefacts as
downloadable files in the exact government formats, plus the
employee-facing investment-declaration workflow that feeds TDS.

### Feature list (all `[MUST]` unless noted)

**EPF**
- Monthly **ECR** text file in EPFO format (FR-CPL-001).
- UAN management + bulk UAN seeding (FR-CPL-002). *(Verification stays on
  the EPFO portal — see `CLAUDE.md` Aadhaar note.)*
- Form 2 (Nomination), Form 5 (joiners), Form 10 (leavers), Form 12A
  (monthly remittance summary) (FR-CPL-003).
- `[SHOULD]` EPFO Unified Portal API submission (FR-CPL-004) — deferred.

**ESI**
- Monthly ESI challan with correct contributions (FR-CPL-005).
- Half-yearly ESI return in ESIC format (FR-CPL-006).
- Track eligibility when gross crosses ₹21,000 (FR-CPL-007).

**Income Tax**
- Form 24Q quarterly TDS return with challan + employee-wise data
  (FR-CPL-008).
- Form 16 Part A + B, bulk PDF at FY end (FR-CPL-009).
- Investment declaration workflow — 80C/80D/HRA/LTA with proofs
  (FR-CPL-010).
- January proof-submission cycle, auto-adjust Q3/Q4 TDS on actual proofs
  (FR-CPL-011).

**POSH**
- ICC member management with term-expiry alerts (FR-CPL-012).
- Confidential complaint workflow — case number, status, 90-day timeline
  (FR-CPL-013).
- POSH Annual Report with complaint statistics (FR-CPL-014).
- `[SHOULD]` POSH training-completion tracking (FR-CPL-015).

### Happy path (monthly EPF/ESI)

1. Payroll for `2026-09` reaches **Disbursed**.
2. Compliance Manager → **Compliance → EPF → September 2026** →
   **Generate ECR**.
3. System reads the immutable payroll run, computes per-employee PF wages
   + contributions, writes the ECR text file in EPFO layout.
4. Manager downloads it, uploads to the EPFO portal, pays the challan,
   records the challan number back in the app (audit trail).
5. Same flow for the ESI challan; eligibility changes since last month
   are surfaced for review first.

### Happy path (investment declaration)

1. Start of FY: employee → **Tax → Declaration** → enters 80C/80D/HRA/LTA
   amounts → submitted.
2. Payroll's TDS projection (FR-PAY-008) uses declared amounts.
3. January: employee uploads **proofs**; Compliance verifies; verified
   amounts replace declared; Q4 TDS auto-adjusts.
4. FY end: **Generate Form 16** (bulk) — Part A from challan data, Part B
   from the annual computation.

### Build notes

- Every output is a **file in a government-specified format** — get real
  sample layouts before coding each one; they are unforgiving.
- Consumes only **processed** payroll data; never recomputes salary.
- Record every generated file + portal acknowledgement as an audit event.

---

## 9. Documents

**Status:** ✅ 100% — a shared module owns every user-uploaded file.
Deep spec: `docs/modules/09_DOCUMENTS.md`.
**Code:** `apps/api/src/documents` (`DocumentsService`,
`DocumentsController`, `DocumentScanProcessor`, `ClamAvScanner`),
`apps/api/src/storage` (`StorageService`), `apps/web/src/lib/documents.ts`
+ `apps/web/src/components/documents.tsx`.

### Expectation

Any file the platform stores goes to S3-compatible object storage under a
**tenant- and entity-prefixed key**, is recorded with metadata in
`public.documents`, is **malware-scanned before it can be downloaded**,
and is only ever handed back to a client as a **time-boxed presigned
URL** — the API never returns a raw object key and never lists a bucket.

### Feature list

| Feature | Status |
|---|---|
| Upload (S3/MinIO), key `tenants/<tid>/employees/<eid>/<profile\|leave/<id>\|regularization/<id>>/<uuid>-<name>` | ✅ |
| Metadata row in `public.documents` (owner type/id, label, category, size, type, uploader) | ✅ |
| MIME allow-list (PDF/JPG/PNG) + magic-byte check + 10MB cap, before any byte is stored | ✅ |
| ClamAV scan (BullMQ `documents` queue); download refused until `CLEAN`; infected object deleted | ✅ |
| Self-healing: 15-min sweep re-enqueues stale `PENDING_SCAN` / `SCAN_FAILED` | ✅ |
| Download via 5-minute presigned URL, `Content-Disposition: attachment`, audited | ✅ |
| Generic attachment host — employee profile, leave request, regularization | ✅ (Compliance's investment proofs will add an owner type) |
| Soft delete + `documents.*` audit events; `hrms_app` has no `DELETE` grant | ✅ |
| Retention purge | Deliberately out of V1 scope (soft delete only) — `docs/modules/09_DOCUMENTS.md` §1 |

### Happy path

1. Employee uploads a PDF (profile tab, leave apply form, or regularization
   dialog) → validated → stored → row `PENDING_SCAN` → scan job enqueued.
2. Worker streams it to clamd → `CLEAN` (or `INFECTED`: object deleted,
   audited).
3. Anyone who can see that employee calls
   `GET /api/documents/:id/download-url` → 5-minute URL (409 while
   scanning, 410 if infected).

### Known gaps / TODO

- None against the Expectation. On the preview `t3.micro`, clamd runs as
  a memory-capped sibling container started by the CD workflow (swap-backed,
  slower scans) — see `docs/DEPLOY.md`.

---

## 10. Notifications 🟡 (95%)

**Status:** 🟡 95% — built and tested end to end up to the SES call; the
first real delivery waits on the owner's AWS SES setup. Deep spec:
`docs/modules/10_NOTIFICATIONS.md`.
**Code:** `apps/api/src/notifications` (`NotificationDispatcher`,
`NotificationSendProcessor`, `SesEmailSender`, `templates.ts`,
`NotificationsController`/`Service`), `apps/web/src/pages/notifications.tsx`.

### Expectation

Asynchronous email (and later push) on workflow events, sent off a
queue — never inline in the request path — with every send logged.

### Feature list

| Trigger | Status |
|---|---|
| Leave applied → manager (L1) or HR (L2 / no manager) | ✅ |
| Leave L1-approved → applicant + HR; final approve / reject → applicant | ✅ |
| Leave auto-escalated (L1→L2, and L2 overdue) → HR | ✅ |
| Leave cancelled → whoever held it (manager / HR) | ✅ |
| Regularization submitted → manager (or HR); decided / auto-resolved → applicant | ✅ |
| Uploaded file blocked as malware → uploader | ✅ |
| `notification_log` + dedupe + retry/backoff + sweep + Email log UI (retry FAILED) | ✅ |
| Real delivery through AWS SES | 🟡 code + unit-tested against the SDK; needs a verified SES sender + credentials |
| Leave balance expiry | ⏸ no expiry event exists in Leave yet |
| Payslip available | ⏸ Payroll (module 07) not built — will call the same dispatcher |
| Onboarding tasks / data-breach notice | ⏸ deferred module / incident process (deep spec §1) |
| Push / in-app, per-user preferences | ⏸ V1 scope cut (deep spec §1) |

### Happy path

1. Employee applies for leave → `LeaveService.apply()` commits the request.
2. `NotificationDispatcher.notify()` writes a `QUEUED` row for the manager
   and enqueues a `send` job (the request returns immediately).
3. The worker renders the template and calls SES → row `SENT` with the SES
   message id. On error it retries with backoff, then `FAILED`; HR can
   retry it from **Email log**.

### Known gaps / TODO

- First live SES send (owner action — deep spec §8).

---

## 11. Reports & Analytics 🔴 (10%)

**Status:** only the Dashboard aggregates exist. **Target code location:**
`apps/api/src/reports`.

### Expectation

Pre-built operational + statutory registers, exportable; org-wide metric
dashboards; later a custom report builder.

### Feature list

| Feature | SRS | Status |
|---|---|---|
| Headcount: active vs separated, joiners/leavers, dept-wise | FR-RPT-001 | 🟡 partial (Dashboard headcount + dept breakdown) |
| Payroll cost: monthly cost, CTC vs actual, dept-wise salary | FR-RPT-002 | 🔴 (needs Payroll) |
| Attrition: monthly rate, avg tenure, voluntary vs involuntary | FR-RPT-003 | 🔴 |
| Statutory registers: Salary, PF, ESI, Gratuity | FR-RPT-004 | 🔴 |
| `[SHOULD]` drag-drop custom report builder + scheduled email | FR-RPT-005 | 🔴 |
| `[SHOULD]` export PDF / XLSX / CSV everywhere | FR-RPT-006 | 🔴 |

### Happy path

1. Admin → **Reports** → picks a register (e.g. PF Register) + month.
2. System queries the relevant module data (Employee + Payroll), renders
   rows.
3. Admin exports to XLSX/CSV/PDF for filing or their accountant.

---

## 12. Audit Log 🟡 (35%)

**Status:** three append-only trails are **live and written**, all now with
no `UPDATE`/`DELETE` grant — the generic cross-module interceptor is still
the missing piece.
- `public.login_audit_entries` — one row per server-observed
  `POST /api/auth/session` outcome (Identity & Access, §1).
- `public.audit_log` — access-change events (`access.*` actions,
  `metadata.module = "identity-access"`): role change, activate/deactivate,
  password-reset, login created. Written by `AccessService` **and**
  `EmployeesService` via the shared `buildAccessAuditData()` helper
  (`apps/api/src/access/access.support.ts`); read via
  `GET /api/access/audit?feed=access`.
- `platform.platform_audit_log` — tenant `created` / `status_changed` /
  `plan_changed` / `subscription.renewed` / `subscription.price_adjusted` /
  `plan.updated` (Platform Admin, §2).

Leave keeps its own `LeaveApproval` (decision/escalation, append-only) and
`LeaveLedgerEntry` (balance-movement) trails rather than writing the generic
`audit_log`.

**Code:** `apps/api/src/access/access.support.ts`
(`buildAccessAuditData`), `apps/api/src/auth/auth.service.ts`,
`apps/api/src/platform-admin/*`. A shared `apps/api/src/audit` module +
interceptor is still the target for uniform coverage.

### Expectation

Append-only from day one — the app's DB role has **no `UPDATE`/`DELETE`**
grant on the audit tables. Every state-changing action records: actor,
action, target, before/after metadata, IP, timestamp.

### Append-only enforcement

`login_audit_entries` and `public.audit_log` have **no `UPDATE`/`DELETE`**
grant for `hrms_app` (`20260908074457_identity_access_audit` also revoked
them from the pre-existing `audit_log`). `platform_audit_log` is now the
same: migration `20260918100000_break_glass_and_audit_grants` revoked
`UPDATE`/`DELETE` from `hrms_platform`, leaving `SELECT`/`INSERT` only.

### Must-cover write points

| Write point | Status |
|---|---|
| Login outcomes (→ `login_audit_entries`, FR-AUTH-008) | ✅ |
| Access change: role / status / reset / login-created (→ `audit_log`) | ✅ |
| Tenant create / status / plan / pricing (→ `platform_audit_log`) | ✅ |
| Leave approve / reject / cancel / escalate | ✅ via `LeaveApproval` (separate from `audit_log`) |
| Employee create / update / status / **salary** change | 🟡 login-creation only; field & compensation edits **not** logged |
| Attendance regularisation decision; manual mark | 🔴 |
| Document upload / delete / download-URL issue / malware detection (`documents.*`) | ✅ |
| Payroll run state transitions; compliance file generation | 🔴 (modules not built) |

### Happy path

An HR Manager changes a user's role → `AccessService` writes the row via
`buildAccessAuditData` (`action: 'access.role_changed'`, actor, target,
before/after role) → an Auditor lists it through
`GET /api/access/audit?feed=access`; the missing `UPDATE`/`DELETE` grant
means no one can alter it.

### Known gaps / TODO

- **Generic audit interceptor** so every mutating service records uniformly
  (a `@nestjs` interceptor + `apps/api/src/audit` service), instead of the
  current hand-wired call sites.
- **Employee field/salary edits** and **attendance decisions** into
  `audit_log`.
- **Aggregation / query UI** beyond the Identity & Access audit feed.

---

## Cross-module dependency map

```
Employee Master ──┬─► Leave (employee, reporting manager)
                  ├─► Attendance (employee)
                  ├─► Payroll (salary structure, bank, DOB)
                  └─► Org chart / Dashboard

Attendance ──(month-end LOP)──► Payroll ──(processed run)──► Compliance
                                          └──► Reports (payroll cost)

Leave ──(approved days / LOP)──► Attendance ──► Payroll
Investment declaration ──► Payroll (TDS projection) ──► Compliance (Form 16/24Q)

Every mutation ──► Audit Log        Every workflow event ──► Notifications
```

Build order implication: **Payroll before Compliance**, and Attendance's
month-end LOP contract should be defined **before** Payroll starts so the
two can be built against a stable interface.

---

## Where to look

| You want… | Go to |
|---|---|
| Why a stack/architecture choice was made | `CLAUDE.md` |
| How a mechanism works, traced from source | `docs/BACKEND_ARCHITECTURE.md` |
| A module's one-page summary + happy path | this file |
| A module's **deep spec** — personas, flows, invariants, permission matrix, acceptance criteria | `docs/modules/NN_MODULE_NAME.md` |
| The prompt to build a module's UI (all personas, all screens) | `docs/ui-build-prompts/NN-module-name.md` |
| Where per-tenant config lives + who sets it | `docs/TENANT_CONFIGURATION.md` |
| The docs naming convention (which file is authoritative) | `docs/README.md` |
| Current known gaps in shipped modules | `docs/BACKEND_ARCHITECTURE.md` §8 + per-module "Known gaps" here + each deep spec's §9 |
