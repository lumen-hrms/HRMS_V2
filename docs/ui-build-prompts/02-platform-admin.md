# Platform Admin (Operator Console) — UI Build Prompt

**What this is:** a single, rigidly-structured prompt for building every screen
of the **Platform Admin operator console** — the founder's separate app for
onboarding tenants, controlling their lifecycle, and reading platform-level
metadata and audit. Written as a technical specification, not a conversation,
so a UI build tool (or an AI agent) renders production-grade layouts with all
overlays and states instead of guessing.

**How to use:** paste everything below the `─── PROMPT ───` line into your build
tool. It carries the frontend stack, the design tokens, the data dictionary,
and the screen map. Pair it with:

- `docs/modules/02_PLATFORM_ADMIN.md` — the module source of truth (isolation
  model, flows, technical + functional expectations).
- `docs/MODULE_SPECS.md` §2 — condensed behaviour, happy paths, known gaps.
- `CLAUDE.md` — "Platform Admin is structurally separate"; security
  non-negotiables.
- `apps/web/src/routes/platform` + `apps/web/src/pages/platform-admin` — current
  console code.

**Output target:** `apps/web/src/pages/platform-admin/` (tenants list, new-tenant
wizard, tenant detail, audit, break-glass) and `apps/web/src/pages/platform-auth/`
(the separate operator login — refine the existing split-panel).

> **Scope note:** the console is **one persona** — `PLATFORM_ADMIN`. There are
> no other users. Instead of a role matrix, this prompt breaks the surface
> down by operator **task**. Some endpoints don't exist yet
> (`/api/platform-admin/tenants/:id`, `.../plan`, `/api/platform-admin/audit`,
> `.../breakglass`, `PlatformAuditLog` writes, `BreakGlassGrant`). Build the UI
> for the full surface; mark not-yet-wired calls `TODO(api)`.
>
> **Isolation is a UI constraint here:** this console must **never** show a
> tenant's employee names, leave, payroll, or any PII — only **counts and
> metadata** (name, subdomain, plan, seat count, employee *count*, status,
> dates). If a screen seems to need tenant PII, that is a design smell.

---
─── PROMPT ───

## 1. Role & Output Objective

You are a **Senior SaaS UI Architect**. Produce a **production-grade,
responsive layout** for the **Platform Admin operator console** of a
multi-tenant India-focused HRMS. This is the SaaS operator's own back-office:
create and run customer tenants without any ability to read tenant business
data. Output must be implementation-ready React + TypeScript, matched to the
codebase conventions in Section 2, with **every screen, overlay, and component
state rendered explicitly** (Section 8).

Single-operator, high-trust, low-frequency-but-high-stakes actions (create a
customer, suspend a customer). Dense and precise; calm and deliberate around
destructive actions. Not a marketing site.

## 2. Global System

### 2.1 Frontend stack (non-negotiable — match exactly)

| Concern | Choice |
|---|---|
| Framework | **React 19** function components + hooks. No class components. |
| Build | **Vite 8**, TypeScript **strict**. `verbatimModuleSyntax` + `erasableSyntaxOnly` are on ⇒ **no `enum`, no `namespace`, no parameter properties**. Use `as const` maps and string-literal union types instead. Type-only imports must use `import type`. |
| Routing | **React Router 7** (`BrowserRouter` + `<Routes>`, no data-router APIs). Routes: `/platform/login`, `/platform` (tenants), `/platform/tenants/new`, `/platform/tenants/:id`, `/platform/audit`. The console mounts under a **separate route tree** from the tenant app. |
| Styling | **Tailwind CSS v4** (`@import 'tailwindcss'`, `@theme inline` tokens in `src/index.css`). **No `tailwind.config.js`.** No inline hex — use the tokens in 2.2. |
| Components | **Hand-rolled shadcn-style primitives** in `src/components/ui`, built with `cva` + `clsx` + `tailwind-merge` exposed as `cn()`. **No Radix, no `@radix-ui/*`, no Headless UI.** Reuse existing primitives: `button`, `card`, `badge`, `input`(+`Label`), `dialog`, `table`, `tabs`, `select`, `textarea`, `field`, `skeleton`, `empty-state`, `toast` (context + `useToast()`), `dropdown-menu`, `sheet`. Add new primitives in the same style only if genuinely missing. |
| Icons | **lucide-react** (v1.x). |
| Data | `src/lib/api.ts` (`api.get/post/patch`). The console has its **own** auth: a separate Firebase project, `POST /api/platform-admin/auth/session` with the ID token, `type: platform_admin` claim, **no tenant subdomain header**. Screens call `api.*`, never `fetch` directly. |
| Auth | `usePlatformAuth()` → `{ admin: { uid, email, name }, loading }`. There is exactly one role. No `X-Tenant-Subdomain` header on any request. |
| Path alias | `@/*` → `src/*`. |
| Dates/money | Timestamps ISO UTC, display **IST**, format `14 Apr 2026`. Money (plan price) is `Decimal` — render `₹ 4,999` (Indian grouping); seat counts are plain integers. |

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

- **Operator login** (`/platform/login`) uses the **split-panel** layout: left
  brand panel (`bg-primary`, "Lumen HR · Operator Console", a one-line note
  that this is staff-only), right `bg-card` form column `max-w-sm`. Visually
  distinct from the tenant login — add a small "Operator" tag so an operator
  never confuses the two. No tenant-name line (there is no tenant here).
- **Console frame:**
  - **Fixed left nav panel**, 240px (`w-60`), `bg-card` + right border. Links:
    **Tenants**, **Audit log**. Bottom: theme toggle, operator email, log out.
    A persistent small `bg-lumen-navy-soft` chip "OPERATOR CONSOLE" at the top
    of the nav so it's unmistakable this is not a tenant app.
  - **Top bar**: breadcrumbs (`Operator / Tenants` or `/ Tenants / Acme Corp`)
    left; operator control (avatar + "Operator" → `dropdown-menu`) right.
    Sticky.
  - **Content canvas**: single scroll region, `p-8`, `max-w-[1200px]`. Page
    opens with a `PageHeader` (title + one-line description + right-aligned
    actions); tenant detail uses a `Tabs` strip.
- Responsive: below `lg`, nav collapses to an icon rail; tables scroll inside
  their own `overflow-x-auto`; body never scrolls horizontally; the wizard
  becomes single-column.

### 2.4 Component state rules

**Every interactive component must be shown in all of these states**, labelled:
**Default** · **Hover** · **Focus-visible** (2px ring `--ring`) · **Active** ·
**Disabled** (`opacity-50`, `pointer-events-none`) · **Loading — Skeleton**
(tables → `SkeletonRows`; stat tiles → pulsing block of the same footprint;
buttons → inline spinner + "…" + disabled) · **Empty** (`EmptyState`: icon,
title, one-liner, optional primary action) · **Error** (inline field errors:
red text + red control border; form-level error line above the submit row;
failed loads → retryable inline error, never a blank screen) · **Selected /
expanded** (row selected, drawer target).

## 3. Data Model & Validation

Render **these exact field names and types**. No lorem — use realistic Indian
company names (e.g. "Meridian Health Services", "Northwind Technologies"),
subdomains, and IST dates. **Never** render employee names or any tenant PII.

### 3.1 Entities & fields

**TenantRow** (Tenants list) — `id` · `name` · `subdomain` · `status`
(`ACTIVE|SUSPENDED|TRIAL`) · `plan` (`STARTER|GROWTH|ENTERPRISE|PILOT`) ·
`seats` (int) · `employeeCount` (int, denormalized) · `trialEndsAt`
(string|null) · `renewsAt` (string|null) · `createdAt`.

**TenantDetail** *(TODO(api))* — everything in `TenantRow` plus:
`subscription` {`status` (`TRIALING|ACTIVE|PAST_DUE|CANCELLED`),
`enabledModules` (string[]), `features` (record<string,boolean>),
`priceMonthly` (Decimal|null)} · `headcountHistory` [{`at`,`count`}] ·
`recentAudit` (`PlatformAuditEntry[]`, this tenant only) ·
`firstAdminEmail` (the seeded Company Admin's email — this is operator
metadata, not tenant PII).

**CreateTenantInput** — `name` (required) · `subdomain` (required, lowercase,
DNS-safe, unique — async check) · `plan` (required) · `firstAdminEmail`
(required, valid email) · `firstAdminName` (required).

**ChangeTenantStatusInput** — `tenantId` · `status`
(`ACTIVE|SUSPENDED|TRIAL`) · `reason` (required, min 5 chars).
**ChangeTenantPlanInput** *(TODO(api))* — `tenantId` · `plan` · `reason`.

**PlatformAuditEntry** *(TODO(api))* — `id` · `at` · `actorEmail` · `action`
(`tenant.created|tenant.status_changed|tenant.plan_changed|headcount.refreshed|
breakglass.requested|breakglass.used|breakglass.expired`) · `targetTenantName` ·
`before` (string|null) · `after` (string|null) · `note` (string|null) · `ip`.

**BreakGlassRequestInput** *(TODO(api))* — `tenantId` · `reason` (required,
min 10 chars) · `ttlMinutes` (`15|30|60|120`).
**BreakGlassGrant** *(TODO(api))* — `id` · `tenantName` · `reason` ·
`grantedAt` · `expiresAt` · `status` (`ACTIVE|EXPIRED|REVOKED`) · `accessCount`.

**PlanCatalogEntry** — `plan` · `label` · `seatsIncluded` · `priceMonthly`
(Decimal) · `enabledModules` (string[]) · `features` (record<string,boolean>).

### 3.2 Status → label & colour

- Tenant `status`: `ACTIVE` → "Active" (teal) · `TRIAL` → "Trial" (amber, with
  "ends <date>" sub-text) · `SUSPENDED` → "Suspended" (red).
- Subscription `status`: `ACTIVE` teal · `TRIALING` amber · `PAST_DUE` red ·
  `CANCELLED` neutral.
- **Seat pressure:** `employeeCount / seats` — render a thin bar; **amber ≥
  90%**, **red > 100%** with a "over seat limit" chip.
- Break-glass grant: `ACTIVE` amber (with a live countdown to `expiresAt`) ·
  `EXPIRED` / `REVOKED` neutral.
- Trial ending within 7 days → amber chip "Trial ends in Nd" on the row.

### 3.3 Form validation rules (must be visible)

- **Create tenant:** `name` required. `subdomain` — lowercase letters / digits
  / hyphens only, 3–30 chars, no leading/trailing hyphen; **async uniqueness
  check** → inline "That subdomain is taken" / a green check when free; show
  the resulting URL preview `‹subdomain›.hrms-platform.com`. `plan` required
  (selecting one shows its seats / price / included modules in a side card).
  `firstAdminEmail` valid email; `firstAdminName` required. Submit disabled
  until all valid + subdomain confirmed free.
- **Change status:** `reason` ≥ 5 chars. Suspending → a hard confirm that
  spells out the blast radius ("All N users of <name> lose access
  immediately"). Reactivating a suspended tenant → lighter confirm.
- **Change plan:** `reason` required. If the new plan's `seatsIncluded` <
  current `employeeCount` → amber warning ("N employees over the new limit —
  existing data is kept, new logins may be blocked"), not a hard block.
  Downgrading a plan that removes an in-use module → amber warning naming the
  modules.
- **Break-glass:** `reason` ≥ 10 chars; `ttlMinutes` required. A confirm step
  restating "You will get time-boxed, **read-only**, fully-audited access to
  <name> for N minutes."
- All mutating actions → confirm modal carrying the `reason` field.

## 4. Operator tasks (this console has exactly one persona)

There is no role matrix — every screen is for the single `PLATFORM_ADMIN`.
The surface breaks down by task:

| Task | Screen(s) | Key API |
|---|---|---|
| Sign in to the console | `/platform/login` | `POST /api/platform-admin/auth/session` |
| See all customers at a glance | Tenants list | `GET /api/platform-admin/tenants` |
| Onboard a new customer | New-tenant wizard | `POST /api/platform-admin/tenants` |
| Inspect one customer | Tenant detail | `GET /api/platform-admin/tenants/:id` *(TODO)* |
| Suspend / resume a customer | Tenant detail → status modal | `PATCH .../:id/status` |
| Change a customer's plan / seats | Tenant detail → plan modal | `PATCH .../:id/plan` *(TODO)* |
| Refresh a headcount now | Tenant detail action | `POST .../:id/refresh-headcount` |
| Review operator actions | Audit log | `GET /api/platform-admin/audit` *(TODO)* |
| Get time-boxed support access | Tenant detail → break-glass modal | `POST .../:id/breakglass` *(TODO)* |

## 5. Primary page views

For **each** view: top metrics/stat tiles → action toolbar → table/grid
columns → per-row actions → pagination/empty/skeleton → which overlays it can
open.

### 5.1 Operator Login  (`/platform/login`)
- **Split-panel** (2.3), visually tagged "Operator". `email` + `password`
  (show/hide) + **Sign in**. No "forgot password" self-serve if operator
  accounts are provisioned manually — instead a muted line "Contact the
  platform owner to reset operator access" *(confirm; otherwise reuse the
  Firebase reset flow)*.
- **States:** default · focus · invalid-email · loading · form-level error
  ("Incorrect email or password") · "not an operator account" (a tenant user
  who reached the wrong login) → redirect hint to the tenant app.
- Calls: Firebase (operator project) `signInWithEmailAndPassword` →
  `POST /api/platform-admin/auth/session`.

### 5.2 Tenants  (`/platform`)  — the home screen
- **Stat tiles (row of 4):** Total tenants · Active · On trial · Suspended.
  (Optionally a 5th: "Over seat limit".)
- **Toolbar:** search (name / subdomain) · Status `select` · Plan `select` ·
  **New tenant** (`--primary`) · **Export CSV**.
- **Table columns:** Name (+ subdomain sub-line, link → detail) · Status
  (pill; trial shows "ends <date>") · Plan · Seats (`employeeCount / seats`
  with the pressure bar) · Employees (count) · Renews / Trial ends (`renewsAt`
  or `trialEndsAt`) · Created · **Actions** (`dropdown-menu`: View · Suspend /
  Resume · Change plan · Refresh headcount).
- **Row →** navigates to Tenant detail.
- Pagination 25/page, "showing N of M". Empty = "No tenants yet → New tenant".
  Skeleton rows.

### 5.3 New Tenant  (`/platform/tenants/new`)  — wizard
- **Single page, 3 grouped sections** (not multi-route steps):
  1. **Company** — `name`, `subdomain` (async check + URL preview).
  2. **Plan** — `plan` `select` or card-picker; a side card shows the picked
     plan's seats, monthly price, and included modules (from
     `PlanCatalogEntry`).
  3. **First administrator** — `firstAdminName`, `firstAdminEmail` + a note:
     "We'll create their login and email them a password-reset link. They
     become the Company Admin."
- **Sticky footer:** Cancel · **Create tenant**. On submit → progress states
  ("Creating workspace… · Provisioning admin login…") → on success navigate to
  the new Tenant detail + success toast. On partial failure (admin seed
  failed) → error card explaining the tenant was **not** created (rolled
  back) and the operator can retry.
- Calls: `POST /api/platform-admin/tenants`.

### 5.4 Tenant Detail  (`/platform/tenants/:id`)  — tabs
Header: company name, subdomain (as a link that opens the tenant app in a new
tab), status pill, plan, and a **kebab** (Suspend/Resume · Change plan ·
Refresh headcount · Break-glass). Tabs:

1. **Overview** — metadata cards: Status · Plan (+ price) · Seats
   (`employeeCount / seats` bar) · Employees (count) · Created ·
   Trial ends / Renews · First admin email. A small **headcount sparkline**
   from `headcountHistory`. **No employee names, ever.**
2. **Subscription** — `enabledModules` as a checklist (read-only view of what
   the plan grants), `features` toggles (read-only), price, billing status,
   key dates. **Change plan** button → modal.
3. **Activity** — this tenant's slice of `PlatformAuditEntry` (create, status
   changes, plan changes, headcount refreshes, break-glass events). Read-only
   table: When · Actor · Action · Change (`before → after`) · Note.
4. **Danger zone** — Suspend (or Resume) with the blast-radius confirm;
   **Cancel tenant** *(TODO(api))* shown disabled with a tooltip
   ("Retention & export flow not built").

### 5.5 Audit Log  (`/platform/audit`)
- **Filter bar (card):** date range · action `select` · tenant `select` ·
  search · **Clear** · **Export CSV**.
- **Table columns:** When (`at`) · Operator (`actorEmail`) · Action (labelled
  pill) · Tenant (`targetTenantName`) · Change (`before → after`) · Note · IP.
  Newest first. Footer count.
- Read-only (append-only record). Empty / skeleton. Data source `TODO(api)`.

## 6. Secondary views & overlays

Render these **on the same canvas** as the primary screens (Section 8), each
labelled with its trigger and the API call it fires.

### 6.1 Slide-over drawer (`sheet`, right, max-w-md)
- **Break-glass status** — trigger: an `ACTIVE` grant exists for a tenant.
  Shows the tenant, reason, granted-at, a **live countdown** to `expiresAt`,
  `accessCount`, and a **Revoke now** button (`--destructive`). When no grant
  is active this drawer isn't shown.

### 6.2 Modals (`dialog`, centered, max-w-md)
- **Suspend Tenant** — blast-radius copy ("All N users of <name> lose access
  immediately") + `reason` textarea → **Suspend** (`--destructive`). Calls
  `PATCH /api/platform-admin/tenants/:id/status`.
- **Resume Tenant** — lighter confirm + `reason` → same endpoint.
- **Change Plan** — current plan → `plan` `select`; a diff panel (seats
  before/after, modules added/removed, price change); seat/module warnings from
  3.3; `reason` textarea → **Apply**. Calls `PATCH .../:id/plan` *(TODO(api))*.
- **Refresh Headcount** — confirm → `POST .../:id/refresh-headcount` → updates
  the count in place + toast.
- **Request Break-glass Access** — `reason` (≥ 10 chars) + `ttlMinutes`
  `select` → a second confirm restating the read-only, time-boxed, audited
  nature → **Request access**. Calls `POST .../:id/breakglass` *(TODO(api))*.
- **Operator Sign Out** — confirm → Firebase (operator project) sign-out →
  `/platform/login`.

### 6.3 Inline
- Tenants filter bar; Audit filter bar; the subdomain async-check indicator and
  URL preview in the wizard; the plan side-card in the wizard; the seat-pressure
  bar on rows and detail; the break-glass countdown.

## 7. Toasts & micro-states

- **Toast system** (`useToast`), bottom-right, auto-dismiss 4s, stacked, icon +
  title + optional description + close:
  - success: "Tenant created", "Tenant suspended", "Tenant resumed",
    "Plan changed to Growth", "Headcount refreshed", "Break-glass access
    granted (expires 3:45 pm)", "Break-glass access revoked".
  - info: "Admin login email sent to <email>".
  - error: "Couldn't create tenant — no changes were saved",
    "Subdomain already taken", "Action failed — retry".
- **Validation** surfaces inline on the form / modal (Section 2.4), not as a
  toast. **Empty states** per Section 5. **Skeletons** per Section 2.4 — never
  a bare spinner for a whole page. Login errors are form-level, not toasts.

## 8. Canvas rendering order (render everything at once)

Do **not** render only one page. On the same canvas, lay out
**simultaneously**, each clearly labelled:

1. **Operator login** — all state variants side by side (default, error,
   wrong-account, loading).
2. **Primary workspaces** — Tenants list (populated, incl. a suspended row, a
   trial row, an over-seat row); New-tenant wizard (all 3 sections, plus the
   submitting and rollback-error states); Tenant detail with all 4 tabs;
   Audit log.
3. **Slide-over drawer** (6.1) — break-glass status, shown open beside the main
   view.
4. **All modals** (6.2) — shown open, tiled above the main view.
5. **All toast variants** (7) — anchored bottom-right, stacked.
6. **State gallery** — for the Tenants table and the New-tenant form, show
   Default · Hover · Focus · Disabled · Skeleton · Empty · Error side by side.

Annotate every overlay and action button with the HTTP method + endpoint it
triggers so a backend developer can map each control to an API call:

- `POST /api/platform-admin/auth/session` ·
  `GET /api/platform-admin/tenants` · `POST /api/platform-admin/tenants` ·
  `PATCH /api/platform-admin/tenants/:id/status` ·
  `POST /api/platform-admin/tenants/:id/refresh-headcount`.
- `TODO(api)`: `GET /api/platform-admin/tenants/:id` ·
  `PATCH /api/platform-admin/tenants/:id/plan` ·
  `GET /api/platform-admin/audit` ·
  `POST /api/platform-admin/tenants/:id/breakglass` ·
  `PlatformAuditLog` writes · `BreakGlassGrant` lifecycle · tenant cancel.

## 9. Deliverable & file layout

```
apps/web/src/pages/platform-auth/
  login.tsx                # operator split-panel sign-in
apps/web/src/pages/platform-admin/
  tenants.tsx              # stat tiles, filters, table
  tenant-new.tsx           # 3-section create wizard
  tenant-detail.tsx        # header + 4 tabs (overview / subscription / activity / danger)
  audit.tsx                # operator audit log
  components/
    tenant-status-pill.tsx     seat-pressure-bar.tsx
    suspend-dialog.tsx         change-plan-dialog.tsx
    breakglass-dialog.tsx      breakglass-status-sheet.tsx
    plan-picker.tsx            subdomain-field.tsx
```

Constraints recap: React 19 + TS strict (no enums), Tailwind v4 tokens only,
hand-rolled `components/ui` primitives (no Radix), `api.*` + the platform auth
client for data, **single persona**, **no tenant PII on any screen** (counts
and metadata only), separate route tree + separate Firebase project from the
tenant app, blast-radius confirms on suspend, every state explicit, all
overlays rendered together.
