# Identity & Access — UI Build Prompt

**What this is:** a single, rigidly-structured prompt for building every screen
of the Identity & Access module UI — the tenant **login** experience and the
in-app **Access management** surface (users, roles, login/access audit).
Written as a technical specification, not a conversation, so a UI build tool
(or an AI agent) renders production-grade layouts with all overlays and states
instead of guessing.

**How to use:** paste everything below the `─── PROMPT ───` line into your build
tool. It carries the frontend stack, the design tokens, the data dictionary,
and the per-role screen map. Pair it with:

- `docs/modules/01_IDENTITY_AND_ACCESS.md` — the module source of truth
  (personas, flows, technical + functional expectations, permissions matrix).
- `docs/MODULE_SPECS.md` §1 — condensed behaviour, happy paths, known gaps.
- `CLAUDE.md` — guard chain, multi-tenancy, security non-negotiables.
- `apps/web/src/lib/auth` + `apps/web/src/routes` — current auth client + guards.

**Output target:** `apps/web/src/pages/access/` (new: users, audit, my-account)
and `apps/web/src/pages/auth/` (login, password-reset — refine the existing
split-panel login).

> **Scope note:** some Access-management endpoints don't exist yet
> (`/api/access/users`, `.../role`, `.../status`, `.../password-reset`,
> `/api/access/audit`, the `LoginAuditEntry` table). Build the UI for the full
> surface; mark not-yet-wired calls `TODO(api)` and keep them behind the final
> layout so the backend has a target. The **platform-admin** login and console
> are a separate prompt (`02-platform-admin.md`).

---
─── PROMPT ───

## 1. Role & Output Objective

You are a **Senior SaaS UI Architect**. Produce a **production-grade,
responsive layout** for the **Identity & Access** module of a multi-tenant
India-focused HRMS: the tenant **login / password-reset** flow and the in-app
**Access management** screens (user list, role assignment, activate/deactivate,
login & access audit trail, and a personal "My account" identity view). Output
must be implementation-ready React + TypeScript, matched to the codebase
conventions in Section 2, with **every screen, overlay, and component state
rendered explicitly** (Section 8).

Login is the only unauthenticated surface in the product — it must feel
trustworthy and calm. Everything else is a dense, precise back-office
system-of-record. Not a marketing site, not a consumer app.

## 2. Global System

### 2.1 Frontend stack (non-negotiable — match exactly)

| Concern | Choice |
|---|---|
| Framework | **React 19** function components + hooks. No class components. |
| Build | **Vite 8**, TypeScript **strict**. `verbatimModuleSyntax` + `erasableSyntaxOnly` are on ⇒ **no `enum`, no `namespace`, no parameter properties**. Use `as const` maps and string-literal union types instead. Type-only imports must use `import type`. |
| Routing | **React Router 7** (`BrowserRouter` + `<Routes>`, no data-router APIs). Routes: `/login`, `/reset-password`, `/access/users`, `/access/users/:id` (or drawer), `/access/audit`, `/account`. |
| Styling | **Tailwind CSS v4** (`@import 'tailwindcss'`, `@theme inline` tokens in `src/index.css`). **No `tailwind.config.js`.** No inline hex — use the tokens in 2.2. |
| Components | **Hand-rolled shadcn-style primitives** in `src/components/ui`, built with `cva` + `clsx` + `tailwind-merge` exposed as `cn()`. **No Radix, no `@radix-ui/*`, no Headless UI.** Reuse existing primitives: `button`, `card`, `badge`, `input`(+`Label`), `dialog`, `table`, `tabs`, `select`, `textarea`, `field`, `skeleton`, `empty-state`, `toast` (context + `useToast()`), `dropdown-menu`, `sheet`. Add new primitives in the same style only if genuinely missing. |
| Icons | **lucide-react** (v1.x). |
| Data | `src/lib/api.ts` (`api.get/post/patch`) for real calls. Auth uses `src/lib/auth` — `useAuth()`, Firebase `signInWithEmailAndPassword` / `sendPasswordResetEmail` client-side, then `POST /api/auth/session` with the ID token. Screens call `api.*` / the auth client, never `fetch` directly. |
| Auth/role | `useAuth()` → `{ user: { role, employeeId, email, uid }, loading }`. Roles: `COMPANY_ADMIN`, `HR_MANAGER`, `LINE_MANAGER`, `EMPLOYEE`, `AUDITOR`. Role gating helpers in `src/lib/roles.ts` (`isAdmin`, `canManageUsers`, `atLeast(role)`). |
| Path alias | `@/*` → `src/*`. |
| Dates/money | Timestamps are ISO UTC strings, display in **IST**, format like `14 Apr 2026, 3:04 pm`. No money in this module. |

<!-- CANONICAL §2.2 — keep this block byte-identical in every
     docs/ui-build-prompts/NN-*.md file (and any future module prompt). -->
### 2.2 Design system / tokens — single source of truth

**Authoritative token definitions live in `apps/web/src/index.css`** (`:root`,
`@media (prefers-color-scheme: dark)`, `:root[data-theme='dark']`). **Introduce
no new colour.** Use only these CSS variables (or their `bg-*/text-*/border-*`
Tailwind utilities). Every screen in every module uses the **same token for the
same purpose** — the semantic map below is binding, so all modules stay in
visual sync.

Look: neutral off-white canvas, deep navy primary, teal = positive/approve,
amber = caution (pending / LOP / probation / notice), restrained red =
destructive only. Neutrals carry most of the UI. Font **Inter**. One `--radius`
(`0.625rem`). **Not** generic slate/indigo.

**Core tokens** (light → dark; dark values from `index.css`, don't hardcode):

| Token | Light | Dark | Utility |
|---|---|---|---|
| `--background` | `#f7f8fa` | `#0d1117` | `bg-background` |
| `--foreground` | `#101828` | `#e6e9ee` | `text-foreground` |
| `--card` | `#ffffff` | `#141a22` | `bg-card` |
| `--border` / `--input` | `#e2e5ea` | `#262e3a` | `border-border` |
| `--primary` | `#16324f` | `#6ea8dd` | `bg-primary` / `text-primary` |
| `--primary-foreground` | `#f7f9fb` | `#0d1117` | `text-primary-foreground` |
| `--secondary` / `--muted` | `#eef1f5` | `#1b222c` | `bg-secondary` / `bg-muted` |
| `--muted-foreground` | `#5b6472` | `#97a2b0` | `text-muted-foreground` |
| `--accent` | `#eaf1f7` | `#1b2733` | `bg-accent` (hover) |
| `--success` | `#1a7f5a` | `#35c28d` | `text-success` |
| `--warning` | `#a8681a` | `#e0a942` | `text-warning` |
| `--destructive` | `#b3261e` | `#e5675f` | `bg-destructive` |
| `--ring` | `#2b5a8c` | `#6ea8dd` | `ring-ring` (2px focus) |

**Brand accent tokens** (`bg-lumen-*` / `text-lumen-*`), each with a matching
`-soft` background: `--lumen-gold` (`#d99220` → `#f5b544`), `--lumen-navy`,
`--lumen-success`, `--lumen-warning`, `--lumen-error`, `--lumen-info`,
`--lumen-purple`. Use `-soft` bg + solid `text-lumen-*` for status chips and
stat-tile icon wells.

**Semantic map (binding across all modules):**

| UI element | Token |
|---|---|
| Page canvas | `bg-background` |
| Cards, tables, modals, drawers | `bg-card` + `border-border` |
| Primary button · active nav · selected-tab underline | `--primary` |
| Secondary button · inactive chip | `--secondary` |
| Row hover · ghost-button hover | `--accent` |
| Muted labels, helper text, timestamps | `text-muted-foreground` |
| Approved / Confirmed / positive | `--success` + `--lumen-success-soft` chip |
| Pending / LOP / Probation / Notice | `--warning` + `--lumen-warning-soft` chip |
| Rejected / Suspended / error / delete | `--destructive` + `--lumen-error-soft` chip |
| Neutral status (Cancelled / info) | `--muted` / `--lumen-info-soft` |
| Focus ring (all inputs & buttons) | `ring-ring`, 2px |
| Per-entity colour dots (leave type, department) on calendars/legends | that entity's `colorToken` (a `--lumen-*` var) |

Every colour must resolve in **both** light and dark — never define one only
inside a media / `[data-theme]` block; give containers an explicit token
background (no transparent-borrow).

### 2.3 Global layout frame

- **Login / reset-password** use a **split-panel** layout: left = brand panel
  (`bg-primary`, product name "Lumen HR", one-line value prop, subtle
  pattern); right = `bg-card` centered form column, `max-w-sm`. No app nav.
  The resolved tenant name (from subdomain) is shown above the form
  ("Signing in to **Acme Corp**"). Theme toggle bottom-right.
- **Access management screens** use the standard app frame:
  - **Fixed left nav panel**, 240px (`w-60`), `bg-card` + right border. Module
    links with lucide icon + label; active = `bg-secondary`. Bottom: theme
    toggle (light/system/dark), user email + role, log out. Nav items are
    **role-filtered** — "Access" appears only for `COMPANY_ADMIN`,
    `HR_MANAGER`, `AUDITOR`.
  - **Top bar**: **breadcrumbs** (`Home / Access / Users` or `/ Audit`) on the
    left; compact user control (avatar + role → `dropdown-menu`) on the right.
    Sticky.
  - **Content canvas**: single scroll region, `p-8`, `max-w-[1200px]`. Page
    opens with a `PageHeader` (title + one-line description + right-aligned
    actions), then a `Tabs` strip where noted, then multi-section content.
- Responsive: below `lg`, left nav collapses to an icon rail / drawer; tables
  scroll inside their own `overflow-x-auto`; the page body never scrolls
  horizontally. The login split-panel stacks (brand panel becomes a short
  header) below `md`.

### 2.4 Component state rules

**Every interactive component must be shown in all of these states**, labelled:

- **Default**, **Hover**, **Focus-visible** (2px ring `--ring`), **Active/
  pressed**, **Disabled** (`opacity-50`, `pointer-events-none`).
- **Loading — Skeleton**: tables show `SkeletonRows`; stat tiles show a pulsing
  block of the same footprint; buttons show an inline spinner + "…" text and go
  disabled.
- **Empty**: `EmptyState` (icon, title, one-line description, optional primary
  action).
- **Error**: inline field errors (red text + red border on the control);
  form-level error as a red line above the submit row; failed loads show a
  retryable inline error, not a blank screen.
- **Selected / expanded** where applicable (table row selected, drawer target).

## 3. Data Model & Validation

Render **these exact field names and types**. No lorem — use realistic Indian
names, work emails, and IST timestamps.

### 3.1 Entities & fields

**SessionUser** (`useAuth().user`) — `uid` · `email` · `role`
(`COMPANY_ADMIN|HR_MANAGER|LINE_MANAGER|EMPLOYEE|AUDITOR`) · `employeeId`
(string|null) · `tenantName` (derived from subdomain) · `tenantStatus`
(`ACTIVE|SUSPENDED|TRIAL`).

**AccessUser** (row in the Users list) — `id` · `email` · `role` ·
`isActive` (bool) · `employee` {`id`,`firstName`,`lastName`,`employeeCode`,
`designation`} | null · `createdAt` · `lastLoginAt` (string|null) ·
`lastLoginIp` (string|null) *(TODO(api))* · `firebaseDisabled` (bool).

**ChangeRoleInput** — `userId` · `newRole` · `reason` (required, min 5 chars —
audit reason).
**SetUserStatusInput** — `userId` · `isActive` · `reason` (required).

**LoginAuditEntry** *(TODO(api))* — `id` · `at` · `email` · `userId`
(string|null) · `outcome`
(`SUCCESS|BAD_CREDENTIALS|USER_INACTIVE|TENANT_SUSPENDED|CLAIM_MISMATCH|
TOKEN_EXPIRED`) · `ip` · `userAgent` · `deviceLabel` (parsed from UA).

**AccessAuditEntry** *(TODO(api))* — `id` · `at` · `actorName` · `actorRole` ·
`action` (`role.changed|user.activated|user.deactivated|password_reset.sent|
login.succeeded|login.failed`) · `targetEmail` · `before` (string|null) ·
`after` (string|null) · `note` (string|null).

**LoginFormInput** — `email` · `password`.
**ResetPasswordInput** — `email`.

### 3.2 Status / outcome → label & colour

- User `isActive`: `true` → "Active" (teal) · `false` → "Deactivated" (red).
- Role → neutral `badge` with the role's label
  ("Company Admin", "HR Manager", "Line Manager", "Employee", "Auditor").
- Login outcome: `SUCCESS` → teal · everything else → red, with a specific
  label ("Wrong tenant", "Inactive user", "Tenant suspended", "Bad
  credentials", "Token expired").
- Tenant `SUSPENDED` → full-width red banner on login: "This workspace is
  suspended. Contact your administrator."

### 3.3 Form validation rules (must be visible)

- **Login:** `email` required + valid format; `password` required. Submit
  disabled until both are non-empty. On failure → **one** generic form-level
  error "Email or password is incorrect" (never reveal which, never reveal
  account existence). A `CLAIM_MISMATCH` / wrong-tenant response → "This
  account doesn't belong to <tenantName>." A `USER_INACTIVE` → "This account
  has been deactivated."
- **Reset password:** `email` required + valid. Always show the same success
  state ("If an account exists for that email, a reset link is on its way") —
  no account-existence leak.
- **Change role:** `newRole` must differ from current; `reason` ≥ 5 chars.
  If the actor is `HR_MANAGER`, `COMPANY_ADMIN` is **not selectable** (omit
  from the options, with a note "Only a Company Admin can grant this role").
  Changing the **last** `COMPANY_ADMIN` down → hard block with "A workspace
  must keep at least one Company Admin."
- **Deactivate user:** `reason` required. Deactivating your **own** account →
  hard block. Deactivating the last active `COMPANY_ADMIN` → hard block.
- All mutating actions (role change, deactivate, reactivate, send reset) →
  confirm modal; role change and deactivate carry the `reason` field in the
  modal.

## 4. Roles & screen map

`PLATFORM_ADMIN` is out of scope (separate operator console — see
`02-platform-admin.md`).

| Screen / capability | EMPLOYEE | LINE_MANAGER | HR_MANAGER | COMPANY_ADMIN | AUDITOR |
|---|:--:|:--:|:--:|:--:|:--:|
| Login / reset password | ✅ | ✅ | ✅ | ✅ | ✅ |
| My Account (own identity, reset own password) | ✅ | ✅ | ✅ | ✅ | ✅ |
| Access › Users — list | — | — | ✅ | ✅ | ✅ read-only |
| Access › Users — user detail / drawer | — | — | ✅ | ✅ | ✅ read-only |
| Change a user's role | — | — | — | ✅ | — |
| Activate / deactivate a login | — | — | ✅ | ✅ | — |
| Send a password-reset link to a user | — | — | ✅ | ✅ | — |
| Access › Audit (login outcomes + access changes) | — | — | — | ✅ | ✅ read-only |

`AUDITOR` and any "read-only" cell: **render the full screen but strip every
mutating control** — no change-role / activate / deactivate / send-reset
buttons, no row actions; any forms shown disabled.

## 5. Primary page views

For **each** view: top metrics/stat tiles → action toolbar → table/grid
columns → per-row actions → pagination/empty/skeleton → which overlays it can
open.

### 5.1 Login  (`/login`)  *(unauthenticated, all personas)*
- **Split-panel** (2.3). Right column: tenant line ("Signing in to **Acme
  Corp**"), `email`, `password` (with show/hide toggle), **Sign in** (full
  width, `--primary`), a "Forgot password?" text link → `/reset-password`.
- **States to render:** default · field focus · invalid-email inline · submit
  loading (spinner + "Signing in…") · form-level error (bad credentials) ·
  wrong-tenant error · deactivated-account error · **tenant-suspended banner**
  (red, above the form, form disabled) · unknown-subdomain full-page state
  ("No workspace found at this address").
- Calls: Firebase `signInWithEmailAndPassword` → `POST /api/auth/session`.

### 5.2 Reset Password  (`/reset-password`)  *(unauthenticated)*
- Same split-panel. Single `email` field + **Send reset link**. On submit →
  neutral success card (no account-existence leak) + "Back to sign in" link.
- States: default · loading · success · rate-limited ("Too many requests — try
  again in a few minutes").
- Calls: Firebase `sendPasswordResetEmail`.

### 5.3 My Account  (`/account`)  *(all authenticated personas)*
- **Read-only identity card:** name (from linked employee if any), email,
  role (badge), workspace (tenant name), "member since" (`createdAt`),
  last sign-in (`lastLoginAt` + device). 
- **Action:** **Change my password** → sends a reset email to self (confirm
  toast). **Sign out everywhere** *(TODO(api))* shown disabled with a tooltip.
- No role or status controls — this screen never mutates access.

### 5.4 Access › Users  (`/access/users`)  *(HR, Company Admin; Auditor read-only)*
- **Stat tiles (row of 3):** Total logins · Active · Deactivated. (Optionally
  a 4th: "Admins" count.)
- **Toolbar:** search (email / employee name / code) · Role `select` filter ·
  Status `select` (All / Active / Deactivated) · **Export CSV** (client-side
  over the current result set). No "invite user" button in V1 — logins are
  created via Employee Master; show a muted hint linking there.
- **Table columns:** Email · Employee (name + code; "—" if no linked
  employee) · Role (badge) · Status (Active / Deactivated pill) · Last sign-in
  (`lastLoginAt`, relative + exact on hover; "Never") · **Actions**
  (`dropdown-menu`: View details · Change role *(Company Admin only)* ·
  Deactivate / Reactivate · Send password-reset link).
- **Row →** opens the **User Detail drawer** (6.1).
- Pagination: 25/page, "showing N of M". Empty per filter
  ("No logins match these filters"). Skeleton rows.

### 5.5 Access › Audit  (`/access/audit`)  *(Company Admin; Auditor read-only)*
- **Sub-tabs:** **Sign-in activity** (`LoginAuditEntry`) · **Access changes**
  (`AccessAuditEntry`).
- **Filter bar (card):** date range · outcome / action `select` · search
  (email) · **Clear** · **Export CSV**.
- **Sign-in activity table:** When (`at`) · Email · Outcome (pill, specific
  label) · IP · Device (parsed UA) . Newest first.
- **Access-changes table:** When · Actor (name + role) · Action (labelled) ·
  Target (email) · Change (`before → after`, e.g. "HR Manager → Line
  Manager") · Note.
- Read-only everywhere (append-only record). Footer count. Empty / skeleton.
- Data source `TODO(api)` — bind to fixtures now, annotate the endpoints.

## 6. Secondary views & overlays

Render these **on the same canvas** as the primary screens (Section 8), each
labelled with its trigger and the API call it fires.

### 6.1 Slide-over drawer (`sheet`, right side, max-w-md)
- **User Detail** — trigger: any Users row. Shows: email, linked employee
  (link to their profile), role (badge), status pill, created, last sign-in
  (+ IP / device), and a short **recent activity** list (this user's last 5
  `LoginAuditEntry` + `AccessAuditEntry` items, merged, newest first).
  Footer varies by caller:
  - `COMPANY_ADMIN` → **Change role** · **Deactivate/Reactivate** · **Send
    reset link**.
  - `HR_MANAGER` → **Deactivate/Reactivate** · **Send reset link** (no change
    role).
  - `AUDITOR` → no footer (read-only).

### 6.2 Modals (`dialog`, centered, max-w-md)
- **Change Role** — current role (read-only) → `newRole` `select` (options
  filtered by actor's ceiling) → `reason` textarea (required) → **Save**.
  Calls `PATCH /api/access/users/:id/role` *(TODO(api))*. Shows the
  claim-refresh advisory: "Takes effect on the user's next sign-in or within
  ~1 hour."
- **Deactivate Login** — warning copy ("They will lose access on their next
  request") + `reason` textarea → **Deactivate** (`--destructive`). Calls
  `PATCH /api/access/users/:id/status` *(TODO(api))*.
- **Reactivate Login** — confirm → same endpoint.
- **Send Password-Reset Link** — confirm ("Sends a reset email to
  <email>") → **Send**. Calls `POST /api/access/users/:id/password-reset`
  *(TODO(api))*.
- **Sign Out (My Account)** — confirm → Firebase sign-out → redirect `/login`.

### 6.3 Inline
- Users filter bar; Audit filter bar + sub-tabs; the claim-refresh advisory
  line inside the Change Role modal; password show/hide toggle on login.

## 7. Toasts & micro-states

- **Toast system** (`useToast`), bottom-right, auto-dismiss 4s, stacked, icon +
  title + optional description + close:
  - success: "Role updated", "Login deactivated", "Login reactivated",
    "Reset link sent", "Password reset email sent to you".
  - info: "Role change takes effect on next sign-in".
  - error: "Couldn't update role", "Action failed — retry",
    "You can't deactivate your own account".
- **Validation** surfaces inline on the form / modal (Section 2.4), not as a
  toast.
- **Empty states** per Section 5. **Skeletons** per Section 2.4 — never a bare
  spinner for a whole page.
- Login errors are **form-level**, never toasts.

## 8. Canvas rendering order (render everything at once)

Do **not** render only one page. On the same canvas, lay out
**simultaneously**, each clearly labelled:

1. **Auth surface** — Login (all state variants side by side: default,
   error, suspended-banner, loading, unknown-subdomain) and Reset Password
   (default, success, rate-limited).
2. **Primary workspaces** — Access › Users populated (as `COMPANY_ADMIN`, as
   `HR_MANAGER` with the reduced action set, and as `AUDITOR` read-only);
   Access › Audit both sub-tabs; My Account.
3. **Slide-over drawer** (6.1) — shown open beside the main view, one per
   footer variant (admin / HR / auditor).
4. **All modals** (6.2) — shown open, tiled above the main view.
5. **All toast variants** (7) — anchored bottom-right, stacked.
6. **State gallery** — for the Users table and the Login form, show Default ·
   Hover · Focus · Disabled · Skeleton · Empty · Error side by side.

Annotate every overlay and action button with the HTTP method + endpoint it
triggers so a backend developer can map each control to an API call:

- `POST /api/auth/session` · `GET /api/auth/me` · `POST /api/auth/logout` ·
  Firebase `signInWithEmailAndPassword` / `sendPasswordResetEmail`
  (client-side).
- `TODO(api)`: `GET /api/access/users` · `PATCH /api/access/users/:id/role` ·
  `PATCH /api/access/users/:id/status` ·
  `POST /api/access/users/:id/password-reset` · `GET /api/access/audit`
  (both sub-feeds) · `LoginAuditEntry` table · "sign out everywhere".

## 9. Deliverable & file layout

```
apps/web/src/pages/auth/
  login.tsx            # split-panel sign-in, all error states
  reset-password.tsx   # split-panel request-reset
  components/
    split-panel.tsx    # shared brand-left / form-right frame
    suspended-notice.tsx
apps/web/src/pages/access/
  users.tsx            # stat tiles, filters, table
  audit.tsx            # sub-tabs: sign-in activity / access changes
  my-account.tsx       # personal identity view
  components/
    user-detail-sheet.tsx   change-role-dialog.tsx
    set-status-dialog.tsx    send-reset-dialog.tsx
    role-badge.tsx           outcome-pill.tsx
```

Constraints recap: React 19 + TS strict (no enums), Tailwind v4 tokens only,
hand-rolled `components/ui` primitives (no Radix), `api.*` + the `src/lib/auth`
client for data, role-gated screens (Access nav hidden for Employee / Line
Manager), no account-existence leaks anywhere, claim-refresh advisory on role
change, every state explicit, all overlays rendered together.
