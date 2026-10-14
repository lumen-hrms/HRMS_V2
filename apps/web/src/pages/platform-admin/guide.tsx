import { Card } from '@/components/ui/card';

/**
 * Operator reference: what each tenant setting or action does, what the
 * tenant's users experience, whether it can be undone, and the audit entry
 * it writes. Read this before changing anything on a tenant.
 *
 * Static on purpose — it documents the console, so it has to be kept in step
 * with the controls by hand when those change.
 */

interface GuideRow {
  setting: string;
  where: string;
  does: string;
  tenantSees: string;
  reversible: string;
  audit: string;
}

interface GuideSection {
  title: string;
  intro: string;
  rows: GuideRow[];
}

const SECTIONS: GuideSection[] = [
  {
    title: 'Onboarding — new tenant',
    intro: 'Set once, when the tenant is created (Tenants → New tenant).',
    rows: [
      {
        setting: 'Company name and subdomain',
        where: 'New tenant, step 1',
        does: 'Creates the tenant workspace. The subdomain is its unique address and cannot be shared with another tenant.',
        tenantSees: 'Their sign-in address.',
        reversible: 'No — not editable in the console after creation.',
        audit: 'tenant.created',
      },
      {
        setting: 'First admin name and email',
        where: 'New tenant, step 2',
        does: 'Creates the Company Admin login and emails a set-password link (sent through SES).',
        tenantSees: 'An invite email to set a password.',
        reversible: 'Yes — the Company Admin can manage users and roles inside the workspace.',
        audit: 'tenant.created',
      },
      {
        setting: 'Plan',
        where: 'New tenant, plan picker',
        does: 'Sets the modules and features the tenant gets from day one (Starter, Growth, or Enterprise).',
        tenantSees: 'Only the modules in their plan are shown; others are blocked.',
        reversible: 'Yes — Change plan.',
        audit: 'tenant.created',
      },
      {
        setting: 'Seats',
        where: 'New tenant, step 3',
        does: 'The seat allowance used for the usage bar. Blank → the plan default.',
        tenantSees: 'No change until they exceed it; going over shows a warning and may block new logins.',
        reversible: 'Yes — Adjust pricing.',
        audit: 'tenant.created / subscription.price_adjusted',
      },
      {
        setting: 'Negotiated price per seat',
        where: 'New tenant, step 3',
        does: 'The agreed rate for this deal. Blank → the plan list price. Stored on the tenant, so later catalogue edits do not change it.',
        tenantSees: 'Nothing (commercial only).',
        reversible: 'Yes — Adjust pricing.',
        audit: 'tenant.created / subscription.price_adjusted',
      },
      {
        setting: 'Trial length (days)',
        where: 'New tenant, step 3',
        does: 'How long the workspace stays fully usable from creation (1–90, default 7). The end date is stored on the tenant.',
        tenantSees: 'Full access until the trial ends, then read-only.',
        reversible: 'Yes — Set trial end.',
        audit: 'tenant.created',
      },
    ],
  },
  {
    title: 'Trial and conversion',
    intro: 'Shown on the tenant detail page, Subscription card, while the tenant is on trial or read-only.',
    rows: [
      {
        setting: 'Set trial end',
        where: 'Tenant detail → Subscription → Set trial end',
        does: 'Changes the date the trial ends. Saving a future date on a read-only tenant reopens its trial. Not available for converted (Active) or suspended tenants.',
        tenantSees: 'Full access until the new date; if reopened, full access immediately.',
        reversible: 'Yes — set a different date.',
        audit: 'tenant.trial_updated (with reason)',
      },
      {
        setting: 'Convert to paid',
        where: 'Tenant detail → Subscription → Convert to paid',
        does: 'Confirms the paid plan after payment is received outside the app. Ends the trial, makes the tenant Active and starts a one-year term. A different plan is applied like Change plan.',
        tenantSees: 'Full access continues on the chosen plan.',
        reversible: 'Partly — the plan can be changed later, but the tenant returns to Active, not to trial.',
        audit: 'tenant.converted (+ tenant.plan_changed if the plan changed)',
      },
      {
        setting: 'Automatic read-only at trial end',
        where: 'Runs daily at 10:00 IST (no action needed)',
        does: 'Trials past their end date move to Read-only.',
        tenantSees:
          'They can sign in and read all their data. Every create, edit, delete, approve, or upload is refused with a read-only message.',
        reversible: 'Yes — Set trial end (reopens) or Convert to paid.',
        audit: 'tenant.trial_expired',
      },
    ],
  },
  {
    title: 'Plan, pricing and renewal',
    intro: 'Commercial terms on the Subscription card.',
    rows: [
      {
        setting: 'Change plan',
        where: 'Tenant detail → Subscription → Change plan',
        does: 'Moves the tenant to another plan. Modules and features are re-applied, the seat allowance resets to the plan default, and the negotiated rate is dropped in favour of the new plan’s list price.',
        tenantSees: 'Modules added or removed immediately; removed modules are blocked.',
        reversible: 'Yes — change the plan again. The negotiated rate must be set again.',
        audit: 'tenant.plan_changed',
      },
      {
        setting: 'Adjust pricing',
        where: 'Tenant detail → Subscription → Adjust pricing',
        does: 'Changes the negotiated price per seat and/or the seat count without changing the plan.',
        tenantSees: 'Nothing (commercial only); the seat limit changes if seats change.',
        reversible: 'Yes.',
        audit: 'subscription.price_adjusted',
      },
      {
        setting: 'Renew',
        where: 'Tenant detail → Subscription → Renew',
        does: 'Extends the term by a year. Keeps the negotiated rate and refreshes the modules from the current plan. Also runs automatically on the renewal date.',
        tenantSees: 'Nothing.',
        reversible: 'No — the term is extended, not shortened.',
        audit: 'subscription.renewed',
      },
      {
        setting: 'Enabled modules and feature flags',
        where: 'Tenant detail → Subscription (read-only panel)',
        does: 'Shows what the plan includes. Cannot be edited directly; they follow the plan.',
        tenantSees: 'Whatever the plan grants.',
        reversible: 'Change the plan.',
        audit: '—',
      },
    ],
  },
  {
    title: 'Billing (Razorpay)',
    intro: 'Tenant detail → Subscription tab → Billing card. Payment state is driven by Razorpay, not by clicking.',
    rows: [
      {
        setting: 'Create payment link',
        where: 'Billing card',
        does: 'Creates a monthly Razorpay subscription priced at negotiated rate × seats and shows the link the customer pays through. Set the price first (Adjust pricing). One subscription per tenant.',
        tenantSees: 'Nothing until the customer pays.',
        reversible: 'Cancel it in the Razorpay dashboard; the webhook then makes the tenant read-only.',
        audit: 'billing.subscription_created',
      },
      {
        setting: 'First successful payment (automatic)',
        where: 'Razorpay webhook',
        does: 'Records the payment, ends the trial, makes the tenant Active and moves the renewal date to the end of the paid month.',
        tenantSees: 'Full access continues; a read-only workspace reopens.',
        reversible: 'Not applicable.',
        audit: 'billing.payment_received',
      },
      {
        setting: 'Failed payment (automatic)',
        where: 'Razorpay webhook + daily job',
        does: 'Starts a 7-day grace window. If no payment succeeds in time the tenant goes read-only. A later successful payment reopens it.',
        tenantSees: 'Full access during the grace window, then read-only.',
        reversible: 'Yes — a successful payment, or Convert to paid for an offline payment.',
        audit: 'billing.payment_failed / billing.grace_expired',
      },
      {
        setting: 'Halted or cancelled subscription (automatic)',
        where: 'Razorpay webhook',
        does: 'Razorpay gave up retrying, or billing was cancelled: the tenant goes read-only. A suspended tenant is never changed by a payment event.',
        tenantSees: 'Read-only.',
        reversible: 'Yes — a new payment link, or Convert to paid.',
        audit: 'billing.halted / billing.cancelled',
      },
    ],
  },
  {
    title: 'Status and access',
    intro: 'Who can sign in. Use the Danger zone or the tenant menu.',
    rows: [
      {
        setting: 'Suspend',
        where: 'Tenant detail → Danger zone, or tenant menu',
        does: 'Locks out every user of the tenant immediately. Requires a reason.',
        tenantSees: '“This tenant account has been suspended” on every request, including sign-in.',
        reversible: 'Yes — Resume.',
        audit: 'tenant.status_changed (+ platform audit log)',
      },
      {
        setting: 'Resume',
        where: 'Tenant detail → Danger zone, or tenant menu',
        does: 'Restores access for every user on their next request.',
        tenantSees: 'Normal access returns. Their trial or term resumes where it was.',
        reversible: 'Yes — Suspend again.',
        audit: 'tenant.status_changed',
      },
      {
        setting: 'Resend admin password-reset email',
        where: 'Tenant detail → Overview',
        does: 'Sends the Company Admin a fresh password-reset link.',
        tenantSees: 'A new reset email.',
        reversible: 'Not applicable — a new link is sent each time.',
        audit: 'Audited (tenant admin reset)',
      },
    ],
  },
  {
    title: 'Operations and support',
    intro: 'Data the console can see and time-boxed support access.',
    rows: [
      {
        setting: 'Refresh headcount',
        where: 'Tenant detail → header actions',
        does: 'Recounts the tenant’s employees. Only the count is stored in the console — never names or personal data.',
        tenantSees: 'Nothing.',
        reversible: 'Not applicable — re-run any time.',
        audit: 'Audited',
      },
      {
        setting: 'Break-glass request',
        where: 'Tenant detail → tenant menu → Break-glass',
        does: 'Records a time-boxed support access request with a reason and expiry. Today it tracks the request, expiry, and revocation only. It does NOT yet give the operator access to the tenant’s data.',
        tenantSees: 'Nothing yet.',
        reversible: 'Yes — Revoke ends it early; otherwise it expires.',
        audit: 'Break-glass request, revoke, and expiry events',
      },
    ],
  },
  {
    title: 'Danger zone',
    intro: 'Irreversible actions. Confirm with the client first.',
    rows: [
      {
        setting: 'Cancel tenant',
        where: 'Tenant detail → Danger zone',
        does: 'Button is disabled. The retention and data-export flow is not built.',
        tenantSees: 'Nothing (not available).',
        reversible: 'Not available.',
        audit: '—',
      },
    ],
  },
];

const STATUSES: { name: string; meaning: string }[] = [
  { name: 'Trial', meaning: 'Fully usable until the trial end date. Set on creation.' },
  { name: 'Read-only', meaning: 'Trial ended without conversion. Users can sign in and read; they cannot change anything.' },
  { name: 'Active', meaning: 'Converted to a paid plan. Renews yearly.' },
  { name: 'Suspended', meaning: 'Locked out completely until resumed.' },
];

export function TenantGuidePage() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold">Tenant guide</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          What each setting does to a tenant, before you change it. Check the “tenant sees” and
          “reversible” columns first.
        </p>
      </div>

      <Card className="p-5">
        <p className="text-sm font-semibold">Tenant statuses</p>
        <ul className="mt-2 flex flex-col gap-1.5 text-sm">
          {STATUSES.map((s) => (
            <li key={s.name}>
              <span className="font-medium">{s.name}</span>
              <span className="text-muted-foreground"> — {s.meaning}</span>
            </li>
          ))}
        </ul>
      </Card>

      {SECTIONS.map((section) => (
        <Card key={section.title} className="overflow-hidden">
          <div className="border-b border-border p-4">
            <p className="text-sm font-semibold">{section.title}</p>
            <p className="text-xs text-muted-foreground">{section.intro}</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="bg-muted/40 text-xs text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 font-medium">Setting / action</th>
                  <th className="px-4 py-2 font-medium">Where</th>
                  <th className="px-4 py-2 font-medium">What it does</th>
                  <th className="px-4 py-2 font-medium">Tenant sees</th>
                  <th className="px-4 py-2 font-medium">Reversible?</th>
                  <th className="px-4 py-2 font-medium">Audit entry</th>
                </tr>
              </thead>
              <tbody>
                {section.rows.map((r) => (
                  <tr key={r.setting} className="border-t border-border align-top">
                    <td className="px-4 py-2 font-medium">{r.setting}</td>
                    <td className="px-4 py-2 text-muted-foreground">{r.where}</td>
                    <td className="px-4 py-2">{r.does}</td>
                    <td className="px-4 py-2">{r.tenantSees}</td>
                    <td className="px-4 py-2">{r.reversible}</td>
                    <td className="px-4 py-2 font-mono text-xs text-muted-foreground">{r.audit}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ))}

      <p className="text-xs text-muted-foreground">
        Not visible to the operator: employee names, pay, documents, or any other tenant business
        data. The console shows counts and settings only.
      </p>
    </div>
  );
}
