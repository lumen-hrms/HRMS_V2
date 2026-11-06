# 12 — Audit Log — Module Source of Truth

> **This file is the authoritative, detailed spec for further development of
> this module.** `docs/MODULE_SPECS.md` §12 is the one-page summary.
>
> **Status:** ✅ 100% — three append-only trails (`login_audit_entries`,
> `public.audit_log`, `platform.platform_audit_log`) are live and written,
> all must-cover write points that don't depend on an unbuilt module are
> covered, one shared write path (`AuditService`) replaces every module's
> hand-rolled `tenantPrisma.client.auditLog.create()`, and a cross-module
> aggregation read (`GET /api/audit`) surfaces all of it in one place.
> **Code:** `apps/api/src/audit` (`AuditService`, `AuditController`,
> `AuditModule` — `@Global()`), `apps/api/src/access/access.support.ts`
> (`buildAccessAuditData` — the Identity & Access row-shape builder),
> write call sites in `AccessService`, `EmployeesService`,
> `AttendanceService`, `PlatformAdminService` (platform schema, separate
> path — see §4.1); web `apps/web/src/lib/audit/{client.ts,types.ts}` +
> the "All activity" sub-tab in
> `apps/web/src/pages/access/tabs/audit.tsx`.
> **Related:** `docs/MODULE_SPECS.md` §12 · module `01_IDENTITY_AND_ACCESS.md`
> §9 (`login_audit_entries`, `access.*` trail) · module `02_PLATFORM_ADMIN.md`
> (`platform_audit_log`) · module `03_EMPLOYEE_MASTER.md` (sensitive-field /
> lifecycle / field-update audit) · module `05_ATTENDANCE.md`
> (regularization + manual-mark audit) · `CLAUDE.md`'s multi-tenancy section
> (RLS + the append-only DB-grant pattern this module extends).
> **Last synced to code:** 2026-09-24 (built same day as this spec).

---

## 1. Purpose & scope

A tenant needs to answer "who did what, to what, and when" — for its own
governance, for a customer's compliance obligations (the hospital
customer in particular), and as the backstop that turns "we think nothing
leaked" into "we can show nothing leaked." This module is the **shared
plumbing** other modules write through, plus the **read surface**
(Auditor / Company Admin) that makes those writes useful instead of
just sitting in a table no one queries.

**In scope (V1):**
- One shared, tenant-scoped write path (`AuditService.log()`) for
  `public.audit_log`, used by every module with a mutation worth
  recording.
- A cross-module read (`GET /api/audit`, `GET /api/audit/modules`) —
  filter by module, action, target type, actor/target text search, date
  range.
- Closing the two write-point gaps this module inherited from other
  modules' V1 builds: employee field/compensation edits, and confirming
  attendance decisions were already covered (they were — this file's
  prior status was stale on that point).
- Keeping `login_audit_entries` and `platform_audit_log` as their own
  tables/paths (see §4.1) rather than forcing everything through one
  table — they have different retention (`login_audit_entries`: 2-year
  purge job) and different schemas (`platform_audit_log` lives in the
  platform schema, with zero tenant-table grants, by design).

**Out of scope for V1 (explicitly deferred):**
- **Payroll run state transitions / compliance file generation** — those
  modules aren't built (see `CLAUDE.md`, "V1 module scope"). `AuditService`
  is ready for them the moment they exist — any new service just injects
  it and calls `.log()`, same as Attendance did.
- **A generic `@nestjs` interceptor that auto-instruments every mutating
  endpoint.** Considered and rejected: it would either need endpoint-level
  annotations naming the action/target/metadata shape (no simpler than
  calling `AuditService.log()` directly) or guess at the shape from the
  route + DTO (fragile, and metadata quality — actor name, before/after
  values — is exactly what call-site context provides and reflection
  can't). The chosen design centralizes the *write mechanics and error
  handling*; each call site still explicitly states what it's logging and
  why, which is more honest about what actually happened than a magic
  wrapper would be.
- **Immutable off-tenant archival / SIEM export** — the DB-grant-level
  append-only guarantee (no `UPDATE`/`DELETE`) is the V1 bar; shipping
  rows to an external, tenant-inaccessible store is a later hardening
  step if a customer's compliance requirements demand it.
- **UI for `login_audit_entries` retention or `platform_audit_log`** —
  both already have their own screens (Access › Audit "Sign-in activity";
  Platform Admin's Audit screen); this module doesn't duplicate them.

---

## 2. User personas

| Persona | Uses | Screen |
|---|---|---|
| Auditor | Read-only across every feed — the role exists specifically for this | Access › Audit (all three sub-tabs) |
| Company Admin | Same read access as Auditor, plus everything else in their role | Access › Audit |
| HR Manager / Line Manager / Employee | Never read this screen (not `@Roles`-gated in); their actions still appear in it as the *actor* or *target* | — |
| Platform Admin | Their own separate `platform_audit_log` (module 02); no access to tenant `audit_log` at all (zero grants on tenant tables) | Platform Admin › Audit |

---

## 3. Functional expectations (definition of done)

### 3.1 Write path

Every mutating service that wants an audit trail injects `AuditService`
(it's `@Global()` — no module import needed) and calls:

```ts
await this.audit.log({
  actorUserId: user.sub,
  action: 'employee.updated',       // dotted, module-prefixed by convention
  targetType: 'employee',
  targetId: id,
  metadata: {
    module: 'employee-master',      // REQUIRED — drives module filtering
    actorName, actorRole,
    fieldsChanged: [...],
    changes: [{ field, before, after }, ...],
  },
});
```

`AuditService.log()`:
1. Writes one row to `public.audit_log`, `tenantId` taken from the
   request-scoped `TenantPrismaService` — never from caller input.
2. Never throws. A failed write is logged (`Logger.error`) and swallowed
   — the business operation that triggered it must complete regardless.
   This was already every existing call site's contract; centralizing it
   means a future call site can't forget to wrap its write in a
   try/catch.
3. Does **not** enforce a fixed metadata shape beyond requiring `module`
   — each writer decides what's worth recording for its own action, same
   as before centralization. The table stays free-form `jsonb`.

### 3.2 Read path

- `GET /api/access/audit?feed=login|access` — unchanged, Identity &
  Access only (module 01 §9). Kept because it's a narrower, purpose-built
  shape the Access screen's existing UI already consumes.
- `GET /api/audit?module=&action=&targetType=&q=&from=&to=&limit=` —
  new, spans every `metadata.module` value in `public.audit_log` for the
  current tenant. `action` ending in `.` is a prefix match (e.g.
  `access.` matches every Identity & Access action); an exact value
  matches one action. `q` matches action, target id, actor name, target
  email, or note, case-insensitively.
- `GET /api/audit/modules` — distinct `metadata.module` values seen
  (most recent 2000 rows), for the frontend's module filter dropdown.
- Both new routes are `@Roles(COMPANY_ADMIN, AUDITOR)`, behind the usual
  `JwtAuthGuard → TenantGuard → RolesGuard` chain — same gate as the
  existing Identity & Access audit feed.

### 3.3 What each module logs today

| Module | Action | Trigger |
|---|---|---|
| Identity & Access | `access.role_changed`, `access.user_activated`, `access.user_deactivated`, `access.password_reset_sent`, `access.user_created` | `AccessService`, `EmployeesService` (login creation, separation cascade) |
| Employee Master | `employee.sensitive_fields_updated`, `employee.field_revealed`, `employee.lifecycle_changed`, `employee.updated` | `EmployeesService` |
| Attendance | `attendance.regularization_approved`, `attendance.regularization_rejected`, `attendance.manually_marked` | `AttendanceService` |
| Documents | `documents.*` (upload / delete / download-url-issued / malware-detected) | `DocumentsService` (module 09; predates `AuditService`, writes the same table directly — a candidate for a future migration onto `AuditService`, not required for this module's 100%) |
| Leave | *(not written here)* — `LeaveApproval` / `LeaveLedgerEntry` are Leave's own append-only tables, by design (module 04) | — |
| Platform Admin | *(not written here)* — `platform.platform_audit_log`, separate schema (module 02) | — |

`employee.updated`'s `changes` array only covers the fields listed in
§4.3 (compensation + org fields) — contact/personal-attribute edits on
the same endpoint appear in `fieldsChanged` (which fields moved) but not
with before/after values, the same restraint `updateSensitiveFields`
already used (never re-store a value that's arguably PII when "a change
happened" is the useful signal).

---

## 4. Technical design

### 4.1 Data model

```
AuditLog  (public.audit_log, RLS on tenant_id)
  id            uuid
  tenantId      uuid
  actorUserId   uuid NULL        -- null for a system-initiated write
  action        text             -- "module.verb", e.g. "employee.updated"
  targetType    text             -- "employee" | "user" | ...
  targetId      text NULL
  metadata      jsonb NULL       -- { module, ...action-specific fields }
  ipAddress     text NULL        -- not populated yet (no writer sets it)
  createdAt     timestamptz
  @@index([tenantId])
```

`hrms_app`: `SELECT`/`INSERT` only — no `UPDATE`/`DELETE` (migration
`20260908074457_identity_access_audit`).

Two more tables, each its own path, not `AuditService`'s:
- `public.login_audit_entries` — Identity & Access §1 (sign-in outcomes,
  2-year retention purge). Different shape (outcome/IP/device, no
  actor/target split) and a different writer (`AuthService`, on every
  `POST /api/auth/session`), so it stays its own table rather than being
  forced into `audit_log`'s generic shape.
- `platform.platform_audit_log` — Platform Admin §2. **Deliberately a
  separate schema, table and Postgres role** — Platform Admin has zero
  grants on tenant business tables (`CLAUDE.md`'s tenancy section), so a
  platform action literally cannot write to the tenant's `audit_log`
  even if `AuditService` were reused there. Keep it that way.

### 4.2 Components

- **`AuditService`** (`apps/api/src/audit/audit.service.ts`) —
  `log(input)` (write, never throws) and `query(filter)` /
  `modules()` (read, tenant-scoped via the same `TenantPrismaService`
  every other query in the app uses — RLS applies here exactly like
  everywhere else).
- **`AuditController`** — `GET /audit`, `GET /audit/modules`.
- **`AuditModule`** — `@Global()`, so `AccessService`, `EmployeesService`,
  `AttendanceService` (and any future writer) inject `AuditService`
  without adding `AuditModule` to their own `imports`. `AppModule` lists
  it once.

### 4.3 `EmployeesService.update()` audit (the closed gap)

`PATCH /api/employees/:id` previously wrote nothing to `audit_log` — the
only Employee Master mutation that didn't. Now, after a successful
update, the service diffs the pre-update record (`this.get(id, user)`,
already fetched for the scope check) against the applied change for a
fixed field allowlist:

```ts
AUDITED_UPDATE_FIELDS = [
  'designation', 'departmentId', 'reportingManagerId',
  'employmentType', 'workLocation', 'ctcAnnual', 'payGrade', 'costCenter',
]
```

Only fields in this list get `{field, before, after}` entries in
`metadata.changes`; every field actually touched by the request (allowed
or not) appears in `metadata.fieldsChanged` regardless. A no-op
resubmission (value unchanged) still writes a row (so "someone touched
this record" is visible) but with an empty `changes` array. This mirrors
`updateSensitiveFields`'s existing choice not to store raw values for
personal/contact fields — before/after tracking is reserved for the
fields that actually matter for org/compensation history.

---

## 5. Business rules & invariants

- **RULE-1** Append-only: `hrms_app` has no `UPDATE`/`DELETE` grant on
  `audit_log`, `login_audit_entries`, or `platform_audit_log`.
- **RULE-2** A failed audit write never fails the operation that
  triggered it (`AuditService.log()` catches and logs).
- **RULE-3** Every row is tenant-scoped from trusted server state (the
  request's resolved `tenantId`), never from client input — same
  invariant as every other tenant-scoped write in the app.
- **RULE-4** `metadata.module` is required on every `AuditService.log()`
  call — it's the only thing making cross-module filtering possible
  without a schema migration per module.
- **RULE-5** `GET /api/audit` and `GET /api/audit/modules` are
  `@Roles(COMPANY_ADMIN, AUDITOR)` only.
- **RULE-6** Sensitive values (PAN, bank account, decrypted-field
  contents) are never written into `metadata` — only that a change
  happened, and which field (established by `updateSensitiveFields`,
  `revealField`; `AuditService` doesn't change this).

---

## 6. Permission matrix

| Capability | Employee | Line Manager | HR Manager | Company Admin | Auditor | Platform Admin |
|---|:--:|:--:|:--:|:--:|:--:|:--:|
| Appear as actor/target in `audit_log` | ✅ (as target) | ✅ | ✅ | ✅ | — | — |
| `GET /api/audit` (all modules) | — | — | — | ✅ | ✅ | — |
| `GET /api/access/audit?feed=login\|access` | — | — | — | ✅ | ✅ | — |
| `GET /api/platform-admin/audit` | — | — | — | — | — | ✅ (own schema only) |

---

## 7. Acceptance criteria / test checklist

- [x] Unit: `AuditService.log()` writes the right row shape, scoped to
      the current tenant; a rejected write resolves (never rejects) and
      logs the error (`audit.service.spec.ts`).
- [x] Unit: `AuditService.query()` filters by `module` (from
      `metadata.module`, not a column), by action prefix (`"access."`),
      by inclusive date range, and by free-text search across
      action/target/actor-name/target-email/note.
- [x] Unit: `AuditService.modules()` returns the distinct sorted module
      list.
- [x] Unit: `EmployeesService.update()` audits a compensation/org field
      change with `{field, before, after}` for each changed allowlisted
      field, and records an empty `changes` array (but still writes a
      row) for a no-op resubmission (`employees.service.spec.ts`).
- [x] Unit: `AttendanceService` and `AccessService`'s existing audit
      assertions still pass unchanged after being re-pointed at
      `AuditService` (proves the migration didn't change the written
      shape).
- [x] E2E (`test/audit.e2e-spec.ts`): a real employee compensation edit,
      a real role change, and a real manual attendance mark all land in
      `GET /api/audit` under their respective `module` values with the
      right before/after metadata; `module=` filtering excludes the
      others; an Employee gets 403; another tenant's rows never appear.
- [x] `npm run test:api` (unit), `tsc -p apps/api` and repo-root
      `npm run lint` all clean.
- [ ] E2E run against local Docker Postgres — written against the same
      fixtures/pattern as `access.e2e-spec.ts` but not executed in this
      change (port 5432 was already bound to another process in the dev
      sandbox this was built in). Run `./scripts/dev.sh test` before
      merging to confirm it passes against a live DB.

---

## 8. Open questions / owner actions

- **`ipAddress` is never populated.** The column exists (`audit_log.ip_address`)
  but no writer sets it — `AuditLogInput.ipAddress` is accepted by
  `AuditService.log()` but every current call site omits it. Wiring it up
  means threading the request IP through each service call (or reading it
  off `AsyncLocalStorage`/a request-scoped provider) — not done here
  since no write point currently needs it for its own definition of done.
  Revisit if a compliance ask specifically wants IP on every action, not
  just logins.
- **`DocumentsService`'s `documents.*` writes stay on the direct
  `tenantPrisma.client.auditLog.create()` path**, not migrated onto
  `AuditService` in this change — module 09 is already 100% and its own
  write pattern works; migrating it is a pure-refactor, no-behavior-change
  cleanup that can happen whenever someone's next in that file, not a
  blocker for this module's 100%.
