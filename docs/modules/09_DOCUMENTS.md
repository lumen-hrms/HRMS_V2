# 09 — Documents — Module Source of Truth

> **This file is the authoritative, detailed spec for further development of
> this module.** `docs/MODULE_SPECS.md` §9 is the one-page summary. No UI
> build prompt — Documents has no screen of its own; it surfaces inside
> Employee Master (Documents tab), Leave (request attachment) and
> Attendance (regularization evidence).
>
> **Status:** ✅ 100% — every user upload (employee profile documents,
> leave attachments, regularization evidence) goes through one shared
> module: validated before storage, ClamAV-scanned before it can be
> downloaded, visible exactly as far as its subject employee is, soft-
> deleted with an audit trail. Retention purge is a deliberate V1 scope cut
> (§1), not a gap.
> **Code:** `apps/api/src/documents` (`DocumentsService`,
> `DocumentsController`, `DocumentScanProcessor`, `ClamAvScanner`,
> `documents.constants.ts`), `apps/api/src/storage` (`StorageService`),
> migration `20260923090000_documents_module`; web:
> `apps/web/src/lib/documents.ts`, `apps/web/src/components/documents.tsx`.
> **Related:** `docs/MODULE_SPECS.md` §9 · module `03_EMPLOYEE_MASTER.md`
> (Documents tab, §8 upload matrix) · module `04_LEAVE_MANAGEMENT.md`
> (request attachment) · module `05_ATTENDANCE.md` (regularization) ·
> module `08` Compliance (investment proofs — future consumer) · module
> `07` Payroll (payslip PDFs — future consumer) · `CLAUDE.md` (Storage:
> S3 private + presigned URLs).
> **Last synced to code:** 2026-09-23 (module built to 100%, same day as this spec).

---

## 1. Purpose & scope

One place that owns **every file a user uploads**: validation, storage
key layout, the metadata row, malware scanning, download authorization,
and deletion. Feature modules (Employee Master, Leave, Attendance, later
Compliance) call into it; none of them talk to `StorageService` for user
uploads directly.

**In scope:** upload validation (MIME allow-list, content sniffing, size
cap), owner-typed metadata, ClamAV scan before a file is downloadable,
presigned downloads authorized by the subject employee's visibility,
soft-delete with an audit trail, and the three current owners
(employee profile, leave request, regularization request).

**Out of scope for V1 (decided 2026-09-23):**
- **Automatic retention purge.** Delete is a *soft* delete and nothing is
  ever hard-purged on a timer. Revisit when a customer contract or a DPDP
  Rules erasure obligation requires it — the `deletedAt` column is the
  hook a future purge job reads.
- **System-generated files** (payslip PDFs, statutory returns). Those are
  written by Payroll/Compliance workers and don't need user-upload
  validation or scanning. They'll reuse `StorageService` + a presign
  helper, not this module's upload path.
- Employee **photo** stays in Employee Master (`Employee.photoKey`): it's
  a single overwritten avatar, image-only, not a document.
- Versioning, e-signature, a document-template library, OCR.

---

## 2. User personas & their role in this module

| Persona | What they do with documents |
|---|---|
| Employee | Uploads own profile documents (ID/address proof, certificates); attaches proof to own leave request; attaches evidence to own regularization; downloads own files |
| Line Manager | Downloads documents/attachments of anyone in their recursive reporting subtree (to judge a leave/regularization request) |
| HR Manager / Company Admin | Uploads onto any employee; recategorizes; deletes; downloads anything in the tenant |
| Auditor | Read-only: lists and downloads anything in the tenant; every download is audit-logged |
| Platform Admin | **No access.** Platform role has zero grants on tenant tables; break-glass (module 02) is the only path |

---

## 3. Functional expectations (definition of done)

1. **One upload pipeline.** Employee-profile documents, leave attachments
   and regularization evidence all go through `DocumentsService.upload()`;
   there is no second copy of MIME/size logic anywhere.
2. **Validation before storage.** MIME allow-list (PDF, JPEG, PNG), the
   file's **magic bytes must match** its claimed MIME type, 10 MB cap,
   non-empty file. A rejected file is never written to the bucket.
3. **Scan before download.** A new document is `PENDING_SCAN`. A BullMQ
   job streams it to ClamAV. `CLEAN` → downloadable. `INFECTED` → the
   object is deleted from storage immediately, the row stays as a
   tombstone, and the event is audit-logged. Until `CLEAN`, a download
   request is refused (409), never served.
4. **Fail closed.** If ClamAV is unreachable, the job retries with backoff;
   after the last attempt the row is `SCAN_FAILED` and still not
   downloadable. A periodic sweep re-enqueues stale `PENDING_SCAN` rows so
   a lost job or a scanner outage self-heals once the scanner is back.
5. **Presigned, short-lived, attachment-disposition downloads.** 5-minute
   URL, `Content-Disposition: attachment` so a browser never renders an
   uploaded file inline on the storage origin.
6. **One visibility rule.** A document is visible to a caller iff its
   **subject employee** is visible to that caller under Employee Master's
   `scopeFor` (self / recursive subtree / whole tenant). This holds for
   every owner type, so a leave attachment is exactly as visible as the
   leave request's applicant.
7. **Soft delete, audited.** Delete sets `deletedAt`/`deletedById`, hides
   the row from every list and blocks downloads; the storage object is
   kept. A row is written to `audit_log`.
8. **Leave attachment is a document.** Its data moves from the four
   `leave_requests.attachment_*` columns into `documents`; approvers can
   download it from the request detail sheet.
9. **Regularization evidence.** An employee can attach one file to their
   own `PENDING` regularization request; the approver can download it.
10. **Tenant isolation** holds at all three layers (key prefix, app-level
    scope, RLS), with an e2e test proving tenant A cannot list, download,
    recategorize or delete tenant B's document by id.

---

## 4. Technical design

### 4.1 Data model (`public.documents`, changed)

```
Document
  id, tenantId                     (unchanged; RLS on tenant_id)
  employeeId        uuid  NOT NULL  subject employee — drives visibility (§3.6)
  ownerType         DocumentOwnerType NOT NULL default EMPLOYEE_PROFILE
  ownerId           uuid  NULL      leave_requests.id / regularization_requests.id;
                                    NULL for EMPLOYEE_PROFILE
  label, category, storageKey, mimeType, sizeBytes   (unchanged)
  scanStatus        DocumentScanStatus NOT NULL default PENDING_SCAN
  scannedAt         timestamp NULL  (TIMESTAMP(3), same as every other column here)
  scanSignature     text NULL       ClamAV signature name when INFECTED
  uploadedById      uuid NULL       users.id (new; uploadedByName kept for display)
  uploadedByName, uploadedAt       (unchanged)
  deletedAt         timestamp NULL
  deletedById       uuid NULL

  @@index([tenantId, ownerType, ownerId])
  @@index([tenantId, employeeId])

enum DocumentOwnerType  { EMPLOYEE_PROFILE, LEAVE_REQUEST, REGULARIZATION }
enum DocumentScanStatus { PENDING_SCAN, CLEAN, INFECTED, SCAN_FAILED }
```

`ownerId` is a plain uuid, not a polymorphic FK — Postgres can't express
one, and the owner check happens in the service. Cascade still comes from
`employeeId → employees ON DELETE CASCADE`.

**Migration** (one migration, run by the schema owner):
1. Add enums + columns; existing rows get `ownerType = EMPLOYEE_PROFILE`,
   `scanStatus = PENDING_SCAN` (never scanned — the sweep, §4.4, picks
   them up on first run).
2. `INSERT INTO documents … SELECT FROM leave_requests WHERE
   attachment_key IS NOT NULL` with `ownerType = LEAVE_REQUEST`,
   `ownerId = leave_requests.id`.
3. Drop `leave_requests.attachment_key/_name/_mime_type/_size_bytes`.
4. RLS policy on `documents` unchanged (tenant_id-keyed); `hrms_app` keeps
   `UPDATE` (needed for scan status + soft delete) and **loses `DELETE`** —
   hard delete is no longer an app operation.

### 4.2 Storage key layout

```
tenants/<tenantId>/employees/<employeeId>/<ownerSegment>/<uuid>-<safeName>
  ownerSegment = "profile" | "leave/<ownerId>" | "regularization/<ownerId>"
```

Still tenant- then employee-prefixed. Existing keys are **not** rewritten
(the object stays where it is; `storageKey` is authoritative).

### 4.3 `DocumentsService` API (internal)

```ts
upload({ employeeId, ownerType, ownerId?, file, label?, category? }, actor)
list({ employeeId, ownerType?, ownerId? }, actor)          // excludes deleted
listForOwner(ownerType, ownerIds[])                          // for Leave/Attendance DTO mapping
getDownloadUrl(documentId, actor)                            // scope + CLEAN check + audit
setCategory(documentId, category)
softDelete(documentId, actor)
```

**Upload authorization is per owner type** (a role×self check, not
row-visibility — same reasoning as module 03 §8):

| ownerType | Who may upload |
|---|---|
| `EMPLOYEE_PROFILE` | Company Admin / HR Manager onto anyone; Employee onto self |
| `LEAVE_REQUEST` | The applicant, or Company Admin / HR Manager — request not `CANCELLED`/`REJECTED` |
| `REGULARIZATION` | The applicant only — request must be `PENDING` |

Leave and regularization keep **one** live attachment each: uploading a
new one soft-deletes the previous one.

Owner-module checks (does the leave request exist, who's the applicant,
what status) run in the **owner module** (`LeaveService.attach`,
`AttendanceService.attachEvidence`), which then calls
`DocumentsService.upload()`. Documents never imports Leave/Attendance —
no circular module dependency.

**Content sniffing:** first bytes must match the claimed type —
`%PDF-` (PDF), `FF D8 FF` (JPEG), `89 50 4E 47 0D 0A 1A 0A` (PNG). No new
dependency.

### 4.4 Scanning

- `ClamAvScanner` speaks clamd's `zINSTREAM` protocol over TCP
  (`CLAMAV_HOST`/`CLAMAV_PORT`) using Node's `net` module — no npm
  dependency. Returns `{ clean: true } | { clean: false, signature }`;
  throws on connection/protocol error.
- Queue `documents`, job `scan` with `jobId = scan:<documentId>` (dedup),
  `attempts: 5`, exponential backoff. The job carries `tenantId` +
  `documentId`; the worker opens a tenant-scoped transaction (same
  pattern as Leave's escalation processor) — it never runs as a
  `BYPASSRLS` role.
- Final failed attempt → `SCAN_FAILED`.
- Repeatable job `sweep` every 15 minutes: re-enqueue `PENDING_SCAN` rows
  older than 10 minutes and `SCAN_FAILED` rows, per tenant.
- docker-compose gets a `clamav/clamav` service on `3310`.

### 4.5 HTTP surface

| Route | Roles | Notes |
|---|---|---|
| `GET /api/employees/:id/documents` | any (scoped) | unchanged path; now `EMPLOYEE_PROFILE` only, excludes deleted, includes `scanStatus` |
| `POST /api/employees/:id/documents` | per §4.3 | unchanged path; delegates |
| `GET /api/documents/:id/download-url` | any (scoped) | 404 out of scope / deleted; 409 `PENDING_SCAN`/`SCAN_FAILED`; 410 `INFECTED` |
| `PATCH /api/documents/:id/category` | Company Admin, HR Manager | `EMPLOYEE_PROFILE` only |
| `DELETE /api/documents/:id` | Company Admin, HR Manager | soft delete |
| `POST /api/leave/requests/:id/attachment` | per §4.3 | unchanged path; response adds `attachment: { documentId, name, scanStatus }` |
| `POST /api/attendance/regularization/:id/evidence` | applicant | new |

Leave/regularization DTOs expose `attachment: { documentId, name,
mimeType, sizeBytes, scanStatus } | null`. `attachmentName` stays on the
leave DTO (same value) so the existing frontend contract doesn't break.

### 4.6 Audit

Written to `public.audit_log` (`metadata.module = "documents"`):
`documents.uploaded`, `documents.deleted`, `documents.infected`,
`documents.downloaded` (the URL-issue event — we can't observe the
actual fetch from storage). Actor, target document, subject employee,
owner type/id.

---

## 5. Core flows

### 5.1 Employee uploads an ID proof
1. `POST /employees/<self>/documents` with a PDF.
2. Role×self check → MIME + magic bytes + size → put object → row
   `PENDING_SCAN` → enqueue `scan` → audit `documents.uploaded` → 201.
3. UI shows "Scanning…" on the row; download disabled.
4. Worker: stream to ClamAV → `CLEAN`, `scannedAt = now()`.
5. Refresh → row downloadable.

### 5.2 Infected upload
Worker gets `FOUND Eicar-Signature` → delete object → row `INFECTED`,
`scanSignature` set → audit `documents.infected`. UI shows "Blocked —
malware detected"; download returns 410.

### 5.3 Line Manager reviews a leave request with proof
Detail sheet shows the attachment → click → `GET
/documents/<id>/download-url` → subject employee is in the manager's
subtree → `CLEAN` → presigned URL → audit `documents.downloaded`.

### 5.4 Scanner outage
ClamAV down → jobs retry, then `SCAN_FAILED` → files stay undownloadable →
ClamAV back → next `sweep` re-enqueues → `CLEAN`. No human step.

---

## 6. Business rules & invariants

- **RULE-1** No bytes reach the bucket before validation passes.
- **RULE-2** No presigned URL is ever issued for a document that isn't
  `CLEAN` and not deleted.
- **RULE-3** An `INFECTED` document has no storage object.
- **RULE-4** Visibility = subject employee visibility (`scopeFor`); no
  per-owner-type exceptions.
- **RULE-5** At most one non-deleted document per
  (`LEAVE_REQUEST`, ownerId) and per (`REGULARIZATION`, ownerId).
- **RULE-6** The app DB role cannot `DELETE` from `documents`.
- **RULE-7** Upload failure after the object is written but before the
  row commits deletes the object (no orphans from a failed request).

---

## 7. States

```
            upload
              │
              ▼
        PENDING_SCAN ──(clean)──► CLEAN
          │     ▲  │
  (found) │     │  └─(retries exhausted)──► SCAN_FAILED ──(sweep)──┐
          ▼     └──────────────────────────────────────────────────┘
       INFECTED  (object deleted, terminal)

 deletedAt set  ⇒ hidden + undownloadable, orthogonal to scan state
```

---

## 8. Permission matrix

| Capability | Employee | Line Manager | HR Manager | Company Admin | Auditor | Platform Admin |
|---|:--:|:--:|:--:|:--:|:--:|:--:|
| Upload profile document | self | — | any | any | — | — |
| Attach to leave request | own request | — | any | any | — | — |
| Attach regularization evidence | own pending | — | — | — | — | — |
| List / download | self | self + subtree | tenant | tenant | tenant | — |
| Recategorize | — | — | ✅ | ✅ | — | — |
| Delete (soft) | — | — | ✅ | ✅ | — | — |

---

## 9. Known gaps / TODO

None against §3. Everything the first draft of this spec listed here
(shared module + owner-typed schema, the Leave attachment migration, the
ClamAV pipeline + sweep, soft delete + revoked `DELETE`, regularization
evidence, content sniffing + attachment disposition, frontend scan-status
badges) landed on 2026-09-23. Follow-ons, none blocking:

1. **Compliance investment proofs** add a fourth `DocumentOwnerType` when
   module 08 is built — an enum value + an owner-side `attach…()` method,
   no change to this module's pipeline.
2. **Leave: re-attach after submit** — the API supports replacing a
   request's attachment, but the UI only offers upload on the apply form
   (a failed upload toasts "attach it again", which today needs the API).
3. **Retention purge** — deliberately deferred (§1).

---

## 10. Dependencies

**Upstream:** `StorageService` (S3/MinIO), Employee Master `scopeFor`
(visibility), BullMQ/Redis, ClamAV (clamd), `audit_log`.
**Downstream:** Employee Master, Leave, Attendance today; Compliance
(investment proofs) next.

---

## 11. Acceptance criteria / test checklist

- [x] Unit: disallowed MIME, spoofed MIME (PNG bytes labelled PDF),
      oversize and empty files are rejected and `storage.upload` is never
      called.
- [x] Unit: each owner type's upload matrix (§8), including the wrong
      role and wrong-applicant 403s.
- [x] Unit: `getDownloadUrl` → 409 for `PENDING_SCAN`/`SCAN_FAILED`,
      410 for `INFECTED`, 404 for deleted and out-of-scope, URL for
      `CLEAN`; audit row written only on success.
- [x] Unit: a second leave/regularization attachment soft-deletes the
      first (RULE-5).
- [x] Unit: row-create failure after upload deletes the object (RULE-7).
- [x] Unit: scan processor — clean → `CLEAN`; found → object deleted +
      `INFECTED` + audit; scanner error rethrows (so BullMQ retries); last
      attempt → `SCAN_FAILED`.
- [x] Unit: `ClamAvScanner` against an in-process fake clamd server
      (`OK`, `FOUND`, error reply, connection refused).
- [x] E2E: tenant A cannot list/download/recategorize/delete tenant B's
      document by id (404).
- [x] E2E: `hrms_app` `DELETE FROM documents` is refused (RULE-6).
- [x] Real clamd (`clamav/clamav:stable`, docker-compose) flags the EICAR
      test file (`Eicar-Test-Signature`) and passes a clean PDF and a 3 MB
      multi-chunk buffer — verified manually against the built scanner, not
      in CI (the CI e2e job has no clamd or object store; the e2e suite
      seeds rows directly).
- [x] Migration verified on a DB holding a pre-existing leave attachment:
      it lands as a `LEAVE_REQUEST` document, the old columns are gone, and
      `hrms_app` keeps `UPDATE` but not `DELETE` on `documents`.
- [ ] Not browser-verified — no live session credentials in this
      environment.
- [x] FE: `npm run build` + `npm run lint` clean.

---

## 12. Open questions / decisions needed

- **ClamAV on the testing deploy — decided 2026-09-23:** the CD workflow
  runs clamd as a sibling container on the 1 GiB preview `t3.micro`,
  memory-capped at 700 MB with swap behind it (`docs/DEPLOY.md`). Revisit
  (bigger instance or separate clamd host) if the box shows memory
  pressure. Production (ECS Fargate) runs clamd as its own service.
- **Retention purge** — deliberately deferred (§1).
- **Should Line Managers see reports' *profile* documents** (ID proof,
  etc.) or only request attachments? Today they can (inherited from
  module 03); RULE-4 keeps that. Revisit if a customer objects.
