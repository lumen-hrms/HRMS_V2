# docs/ — layout & naming convention

Two kinds of documents live here. **The naming case tells you which:**

## `UPPER_SNAKE_CASE.md` — source of truth

Architecture and per-module contracts. These describe how the system
**is** built (or, for not-started modules, the agreed build target) and are
kept in sync with the code. Treat them as authoritative; update them in the
same commit that changes the behaviour they describe.

### At `docs/` root — cross-cutting

| File | Scope |
|---|---|
| `BACKEND_ARCHITECTURE.md` | Whole-project backend: repo layout, guard chain, tenancy, module wiring — traced from source. |
| `MODULE_SPECS.md` | The **index**: per-module one-page summary (expectation, feature list, happy paths, API surface) + the live status table. Each module also links to its deep spec in `modules/`. |
| `TENANT_CONFIGURATION.md` | The multi-tenant config model — where per-tenant rules live and who sets them. |
| `LEAVE_UI_SPECS.md` | Leave module per-screen API contract + `live` vs `planned` endpoint inventory (the contract the backend builds to and tests assert against). |

### In `docs/modules/` — one deep spec per module

`NN_MODULE_NAME.md`, numbered to match the `MODULE_SPECS.md` status table.
Each is the **authoritative detailed spec for further development** of that
module: purpose, **user personas & how each uses it**, functional +
technical expectations, data model, API surface, core flows, business rules
/ invariants, permission matrix, known gaps, dependencies, acceptance
criteria, open questions.

| File | Module |
|---|---|
| `modules/01_IDENTITY_AND_ACCESS.md` | Auth · RBAC · Multi-tenancy |
| `modules/02_PLATFORM_ADMIN.md` | Operator console |
| `modules/03_EMPLOYEE_MASTER.md` | Employee Master + Org Structure |
| `modules/04_LEAVE_MANAGEMENT.md` | Leave Management *(pending)* |
| `modules/05_ATTENDANCE.md` | Attendance & Time Tracking *(pending)* |
| `modules/06_DASHBOARD.md` | Role-aware Dashboard *(pending)* |
| `modules/07_PAYROLL_ENGINE.md` | Payroll Engine *(pending)* |
| `modules/08_STATUTORY_COMPLIANCE.md` | Statutory Compliance *(pending)* |
| `modules/09_DOCUMENTS.md` | Documents *(pending)* |
| `modules/10_NOTIFICATIONS.md` | Notifications *(pending)* |
| `modules/11_REPORTS_AND_ANALYTICS.md` | Reports & Analytics *(pending)* |
| `modules/12_AUDIT_LOG.md` | Audit Log *(pending)* |
| `modules/13_TENANT_CONFIGURATION.md` | Tenant Configuration *(pending — pairs with `TENANT_CONFIGURATION.md`)* |

## `ui-build-prompts/*.md` — lowercase, build inputs (not source of truth)

Rigidly-structured prompts fed to a UI build tool / AI agent to generate
module screens. They are an **input to a build step**, not a description
of what exists. They may describe screens and fields that aren't wired
yet (marked `TODO(api)`). When they and the code disagree, the code (and
the `UPPER_SNAKE_CASE.md` files) win.

Named `NN-module-name.md`, numbered to match the module. Each prompt covers
**every screen for every persona** in that module, plus overlays, states,
and a canvas render order. The `### 2.2 Design system / tokens` block is
**canonical** — kept byte-identical across every prompt so all modules
render in visual sync.

| File | Builds | Persona coverage |
|---|---|---|
| `ui-build-prompts/01-identity-access.md` | Tenant login / reset + in-app Access management (users, roles, audit) | Employee · Line Manager · HR Manager · Company Admin · Auditor |
| `ui-build-prompts/02-platform-admin.md` | Operator console: tenants, onboarding wizard, tenant detail, audit, break-glass | Platform Admin (single persona) |
| `ui-build-prompts/03-employee-master.md` | Directory, employee detail, add/bulk-import, departments, org chart | Employee · Line Manager · HR Manager · Company Admin · Auditor |
| `ui-build-prompts/04-leave-management.md` | Overview, apply, approvals, team calendar/balances, leave types, ledger, holidays, settings | Employee · Line Manager · HR Manager · Company Admin · Auditor |

*(Prompts for modules 05–13 are added as those modules are specced.)*

## Adding docs

- **New module deep spec** → `docs/modules/NN_MODULE_NAME.md`
  (`UPPER_SNAKE`), and add its row to the table above + a link from the
  matching section in `MODULE_SPECS.md`.
- **New UI prompt** → `docs/ui-build-prompts/NN-module-name.md` (lowercase
  `kebab-case`), copy the canonical `### 2.2` block byte-identical from an
  existing prompt, cover all personas.
- **New cross-cutting architecture/contract doc** → `docs/` root in
  `UPPER_SNAKE_CASE.md`.
