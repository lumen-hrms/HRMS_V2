# 10 — Notifications — Module Source of Truth

> **This file is the authoritative, detailed spec for further development of
> this module.** `docs/MODULE_SPECS.md` §10 is the one-page summary.
>
> **Status:** 🟡 95% — the full pipeline (dispatch → `notification_log` →
> BullMQ → SES v2 → SENT/FAILED, sweep, Email log + retry) is built and
> wired into every §3.2 trigger, plus SES bounce/complaint handling
> (§3.4 / §4.4: SNS webhook → suppression list → sends refused, Email log
> row flipped to FAILED). The last 5% is a first real delivery
> through SES, which needs the owner's SES setup (§8); until then every
> send lands `FAILED` with "SES_FROM_ADDRESS is unset".
> **Code:** `apps/api/src/notifications` (`NotificationDispatcher`,
> `NotificationSendProcessor`, `SesEmailSender`, `templates.ts`,
> `NotificationsController`/`NotificationsService`, `EmailSuppressionService`,
> `SnsMessageVerifier`), migrations `20260923120000_notifications` +
> `20261205090000_email_suppressions`; web `apps/web/src/pages/notifications.tsx`
> (Email log). Trigger call sites: `LeaveService`,
> `LeaveEscalationProcessor`, `AttendanceService`,
> `AttendanceFinalizationProcessor`, `DocumentScanProcessor`.
> **Related:** `docs/MODULE_SPECS.md` §10 · module `04_LEAVE_MANAGEMENT.md`
> (apply / approve / reject / cancel / escalation) · module
> `05_ATTENDANCE.md` (regularization submit / decide / auto-resolve) ·
> module `09_DOCUMENTS.md` (infected upload) · module `07` Payroll
> ("payslip ready" — future producer).
> **Last synced to code:** 2026-11-02 (bounce/complaint handling added).

---

## 1. Purpose & scope

Tell the right person by **email** when a workflow needs them or has
decided something about them — sent **asynchronously off a queue**, never
inline in the request path, and every send **recorded** so an admin can see
what went out and what failed.

**Provider: AWS SES v2 API** (decided 2026-09-23), region + sender from
config, credentials from the AWS SDK default chain (env keys locally/on
the preview box, the task role on ECS in production).

**In scope (V1):** the triggers in §3.2, a `notification_log` table, retry
with backoff + a self-healing sweep, an admin **Email log** screen with
manual retry, and SES **bounce/complaint handling** with a suppression list
(§3.4).

**Out of scope for V1:**
- **Per-user preferences / unsubscribe** — "always send" for the short,
  workflow-only list below (every email is one the recipient must act on
  or is about their own request). Revisit when a non-workflow email
  (digests, announcements) is added.
- **Push / in-app notifications** — no mobile app (deferred in CLAUDE.md);
  in-app bell is a later addition on top of the same log.
- **Leave balance expiry** — no expiry/year-end event exists in Leave yet
  (`carryForwardCap` is stored, never applied); nothing to trigger on.
- **Payslip available** — Payroll (module 07) not built; it will call the
  same dispatcher.
- **Onboarding tasks** — onboarding module deferred.
- **Data-breach notice (NFR-PRIV-005)** — an incident-response process
  (DPO sign-off, legal wording), not a workflow email; handled outside the
  app for V1.

---

## 2. User personas

| Persona | Receives | Screen |
|---|---|---|
| Employee | Decisions on own leave / regularization; blocked upload | — |
| Line Manager | New leave (L1) / regularization from a direct report; cancellations | — |
| HR Manager / Company Admin | Requests pending L2 or with no manager; escalations; cancellations of approved leave | Email log (view + retry) |
| Auditor | — | Email log (view only) |
| Platform Admin | Nothing (no tenant data) | — |

---

## 3. Functional expectations (definition of done)

### 3.1 Pipeline
1. A domain event calls `NotificationDispatcher.notify()` with a template,
   recipients (user ids / employee ids / roles) and a context object.
2. Recipients resolve to **active users with an email** in that tenant; the
   actor who caused the event is excluded (no "you approved your own…").
3. One `notification_log` row per recipient, status `QUEUED`, with a
   **dedupe key** — the same event can't email the same person twice even
   if the caller (or a retried job) runs again.
4. A `send` job per row on the BullMQ `notifications` queue; the worker
   renders the template, sends via SES, marks `SENT` (+ SES message id).
5. Failure → retried with exponential backoff (5 attempts); final attempt →
   `FAILED` with the error. A 10-minute sweep re-enqueues rows stuck in
   `QUEUED` (e.g. Redis was down at notify time).
6. `notify()` **never throws into the caller** — a notification problem
   must not fail a leave approval. It logs and leaves the row for the sweep.
7. SES not configured (no sender address) → sends fail → rows `FAILED`
   with a clear error. Nothing is silently dropped.

### 3.2 Triggers

| Event | Template | To |
|---|---|---|
| Leave applied, `PENDING_L1` | `LEAVE_PENDING_APPROVAL` | applicant's reporting manager |
| Leave applied, `PENDING_L2` (no manager / 1-level) | `LEAVE_PENDING_APPROVAL` | Company Admins + HR Managers |
| L1 approved → `PENDING_L2` | `LEAVE_DECIDED` (stage) | applicant |
|  | `LEAVE_PENDING_APPROVAL` | Company Admins + HR Managers |
| Final approval | `LEAVE_DECIDED` (approved) | applicant |
| Rejected (any level) | `LEAVE_DECIDED` (rejected, + comment) | applicant |
| Auto-escalated L1 → L2 | `LEAVE_PENDING_APPROVAL` (escalated) | Company Admins + HR Managers |
| Escalation threshold at L2 | `LEAVE_ESCALATED` | Company Admins + HR Managers |
| Cancelled while `PENDING_L1` | `LEAVE_CANCELLED` | reporting manager |
| Cancelled while `PENDING_L2` / `APPROVED` | `LEAVE_CANCELLED` | Company Admins + HR Managers |
| Regularization submitted | `REGULARIZATION_PENDING_APPROVAL` | reporting manager, else Company Admins + HR Managers |
| Regularization approved / rejected / auto-resolved | `REGULARIZATION_DECIDED` | applicant |
| Uploaded file blocked as malware | `DOCUMENT_BLOCKED` | uploader |

### 3.2a Auth emails (password reset / workspace invite)

Sent **synchronously** by `AuthEmailService` (not queued, not written to
`notification_log` — the reset link is a live credential). Firebase still
owns the password: the Admin SDK generates the one-time reset link
(`generatePasswordResetLink`, continue URL `APP_BASE_URL/login`) and
Firebase's hosted page handles it; we only send the email, branded
"`<Workspace>` via Lumen HRMS" through SES.

| Event | Kind | Caller |
|---|---|---|
| New tenant onboarded / "Resend invite" | `INVITE` | `PlatformAdminService` |
| Admin resets a user's password | `ADMIN_RESET` | `AccessService` |
| "Forgot password?" / My Account → Change password | `SELF_SERVICE` | `POST /api/auth/password-reset` (public, tenant from subdomain; always `202`, never reveals whether the account exists; 3/email + 10/IP per 15 min, in-memory) |

SES not configured → falls back to Firebase's own reset email (so a
laptop without SES keys still works). Platform Admin operators keep
Firebase's reset email — they aren't tenant users.

### 3.3 Email log
- `GET /api/notifications/log` — newest first, filter by status; Company
  Admin, HR Manager, Auditor.
- `POST /api/notifications/log/:id/retry` — `FAILED` rows only; Company
  Admin, HR Manager; re-queues and is audited.

### 3.4 Bounces & complaints (added 2026-11-02)
- SES configuration set → SNS topic → public `POST
  /api/notifications/ses-events`. Accepted only from the topic in
  `SES_EVENTS_TOPIC_ARN` and with a valid SNS signature (cert fetched only
  from `https://sns.<region>.amazonaws.com/*.pem`); the subscription is
  confirmed automatically.
- **Permanent bounce** → address added to `platform.email_suppressions`.
  **Complaint** → same. **Transient bounce** → not suppressed.
- Every workflow email carries SES tags `tenant_id` + `notification_id`; a
  bounce (either kind) flips that `notification_log` row `SENT → FAILED`
  with the reason (matched on the SES message id too). A complaint leaves
  the row `SENT` — it was delivered.
- `SesEmailSender` refuses a suppressed address before calling SES
  (`SuppressedRecipientError`) — workflow, auth (invite/reset) and contact
  emails alike. A suppressed workflow row goes `FAILED` immediately, no
  backoff retries; HR's manual retry fails the same way until the address
  changes or the suppression is lifted.
- Platform Admin › Settings lists suppressions; **Lift** deletes ours,
  best-effort deletes SES's account-level entry
  (`DeleteSuppressedDestination`), and writes `email_suppression.lifted` to
  `platform_audit_log` in the same transaction.

---

## 4. Technical design

### 4.1 Data model

```
NotificationLog  (public.notification_log, RLS on tenant_id)
  id, tenantId
  template        NotificationTemplate
  recipientUserId uuid
  recipientEmail  text          snapshot at queue time
  context         jsonb         template variables (names, dates, ids — no PAN/bank/Aadhaar)
  dedupeKey       text          e.g. "leave:<id>:decided:APPROVED"
  status          NotificationStatus  QUEUED | SENT | FAILED
  attempts        int
  lastError       text NULL
  providerMessageId text NULL
  createdAt, sentAt NULL, updatedAt
  @@unique([tenantId, dedupeKey, recipientUserId])
```

`hrms_app`: `SELECT/INSERT/UPDATE` only — no `DELETE` (the log is a
record of what was sent; status updates are its only mutation).

```
EmailSuppression  (platform.email_suppressions — no tenant column)
  email        text PK      lower-cased
  reason       EmailSuppressionReason  BOUNCE | COMPLAINT
  detail       text NULL    bounce sub-type + SMTP diagnostic / feedback type
  eventCount   int          bumped on each repeat event
  createdAt, lastEventAt
```

`hrms_platform`: `SELECT/INSERT/UPDATE/DELETE`. Platform schema, not
per-tenant, because — like SES's own account-level list — a dead mailbox
is dead for every tenant sending from our domain. It holds bare addresses
only (no name, no tenant, no join into tenant tables).

### 4.2 Components
- **`NotificationDispatcher`** — singleton (not request-scoped) so both
  request handlers and BullMQ processors can call it with an explicit
  `tenantId`; queries through `withTenantContext` on `hrms_app`.
- **`templates.ts`** — pure `render(template, context) → {subject, text,
  html}`; HTML-escapes every interpolated value.
- **`SesEmailSender`** — `@aws-sdk/client-sesv2` `SendEmailCommand`,
  From: `"<Tenant name> via Lumen HRMS" <SES_FROM_ADDRESS>`.
- **`NotificationSendProcessor`** — `send` + repeatable `sweep`; reads the
  tenant's display name via the platform connection (name only); tags each
  email `tenant_id`/`notification_id`.
- **`EmailSuppressionService`** — SNS webhook handling, SES event →
  suppression / log-row update, suppression lookup, operator list + lift.
- **`SnsMessageVerifier`** — SNS signature check (SignatureVersion 1 and 2).

### 4.3 Config

| Env | Meaning |
|---|---|
| `SES_REGION` | default `ap-south-1` |
| `SES_FROM_ADDRESS` | a verified SES identity, e.g. `no-reply@<domain>` — required to send |
| `SES_CONFIGURATION_SET` | configuration set whose Bounce/Complaint events publish to SNS (§3.4) |
| `SES_EVENTS_TOPIC_ARN` | the SNS topic ARN the webhook accepts; unset → webhook answers 403 to everything |
| `APP_BASE_URL` | link target in emails (e.g. the Vercel URL) |
| `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` | SDK default chain; not needed where an IAM role exists |

---

## 5. Business rules & invariants

- **RULE-1** No email is sent in the request path.
- **RULE-2** `notify()` never fails the caller's operation.
- **RULE-3** At most one row (and so one email) per (tenant, dedupe key,
  recipient).
- **RULE-4** Only active users with an email in the *same tenant* are
  recipients (RLS + explicit filter); the acting user is excluded.
- **RULE-5** A row is `SENT` only after SES accepted it (message id stored).
- **RULE-6** Template output escapes all user-provided text.
- **RULE-7** The app role cannot delete log rows.
- **RULE-8** Nothing is sent to a suppressed address; only a verified SNS
  message from the configured topic can add one, only an audited operator
  action can remove one.

---

## 6. Permission matrix

| Capability | Employee | Line Manager | HR Manager | Company Admin | Auditor | Platform Admin |
|---|:--:|:--:|:--:|:--:|:--:|:--:|
| Receive workflow emails | ✅ | ✅ | ✅ | ✅ | — | — |
| View Email log | — | — | ✅ | ✅ | ✅ | — |
| Retry a failed email | — | — | ✅ | ✅ | — | — |
| View / lift email suppressions | — | — | — | — | — | ✅ |

---

## 7. Acceptance criteria / test checklist

- [x] Unit: recipient resolution (user/employee/role), inactive + emailless
      users skipped, actor excluded, dedupe via `skipDuplicates`.
- [x] Unit: `notify()` swallows DB/queue errors (RULE-2).
- [x] Unit: every template renders subject/text/html and escapes HTML.
- [x] Unit: processor — SENT with message id; error rethrows; final
      attempt → FAILED; already-SENT row skipped; sweep re-enqueues stale
      QUEUED per tenant.
- [x] Unit: `SesEmailSender` builds the right `SendEmailCommand`; throws
      when `SES_FROM_ADDRESS` is unset.
- [x] Unit: each Leave / Attendance / Documents trigger calls the
      dispatcher with the right template + recipients.
- [x] Unit: retry only for FAILED; audit row written.
- [x] E2E: tenant A cannot read or retry tenant B's log rows; Employee gets
      403 on the log; app role cannot `DELETE` from `notification_log`.
- [x] E2E (real Postgres + Redis + in-process worker): a real leave
      application writes exactly one `QUEUED` row for the manager and the
      worker attempts it (recorded as a failure with no SES configured).
- [x] Unit: SNS signature verification (v1 + v2, tampered body, non-SNS
      cert host, cert cache); webhook rejects unset/foreign topic, bad
      signature, non-SNS SubscribeURL; confirms subscriptions.
- [x] Unit: permanent bounce suppresses + fails the tagged row; transient
      bounce fails the row only; complaint suppresses, row stays SENT;
      untagged / malformed tags touch no row; lift is transactional +
      audited and tolerates SES errors.
- [x] Unit: sender refuses a suppressed address without calling SES and
      sends tags; processor fails a suppressed row at once, no rethrow.
- [x] FE: `npm run build` + `npm run lint` clean.
- [ ] **A real email delivered through SES** — blocked on §8.
- [ ] A real bounce through SES → SNS → webhook (simulator
      `bounce@simulator.amazonses.com`) — needs §8 + the SNS setup in
      `docs/DEPLOY.md`.
- [ ] Not browser-verified.

---

## 8. Open questions / owner actions

- **SES setup (needs AWS console):** verify the sending domain (or a single
  sender address for testing) in SES `ap-south-1`, and request production
  access — in the SES sandbox, mail only reaches *verified* recipients.
- **Bounce/complaint wiring:** configuration set + SNS topic + HTTPS
  subscription — step-by-step in `docs/DEPLOY.md` (Email, step 6).
- **Credentials on the preview box:** an IAM user with `ses:SendEmail`
  (+ `ses:DeleteSuppressedDestination`) only; keys as GitHub secrets forwarded by the deploy workflow (same
  pattern as `S3_*`).
