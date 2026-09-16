import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Rocket } from 'lucide-react';
import { PageHeader } from '@/components/page-header';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { platformApi, isPlatformApiError } from '@/lib/platform-api';
import type { CreateTenantInput, Plan, SellablePlan } from './lib/types';
import { SubdomainField } from './components/subdomain-field';
import { PlanPicker } from './components/plan-picker';
import { inr, monthlyTotal } from './lib/plan-catalog';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function TenantNewPage() {
  const nav = useNavigate();
  const { toast } = useToast();

  const [taken, setTaken] = React.useState<string[]>([]);
  const [plans, setPlans] = React.useState<Plan[]>([]);
  const [form, setForm] = React.useState<CreateTenantInput>({
    name: '',
    subdomain: '',
    plan: 'STARTER',
    seats: undefined,
    pricePerSeat: undefined,
    firstAdminName: '',
    firstAdminEmail: '',
  });
  const [subdomainOk, setSubdomainOk] = React.useState(false);
  const [phase, setPhase] = React.useState<'idle' | 'submitting' | 'rolledback'>('idle');
  const [err, setErr] = React.useState<string | null>(null);

  React.useEffect(() => {
    platformApi
      .listTenants()
      .then((ts) => setTaken(ts.map((t) => t.subdomain)))
      .catch(() => setTaken([]));
    platformApi.listPlans().then(setPlans).catch(() => setPlans([]));
  }, []);

  const pickedPlan = plans.find((p) => p.key === form.plan);

  const set = <K extends keyof CreateTenantInput>(k: K, v: CreateTenantInput[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  const nameOk = form.name.trim().length >= 2;
  const adminNameOk = form.firstAdminName.trim().length >= 2;
  const adminEmailOk = EMAIL_RE.test(form.firstAdminEmail.trim());
  const canSubmit =
    nameOk && subdomainOk && adminNameOk && adminEmailOk && phase !== 'submitting';

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setPhase('submitting');
    setErr(null);
    try {
      const created = await platformApi.createTenant({
        ...form,
        name: form.name.trim(),
        firstAdminName: form.firstAdminName.trim(),
        firstAdminEmail: form.firstAdminEmail.trim(),
      });
      if (created.adminResetEmailSent) {
        toast({
          title: 'Tenant created',
          description: `Password-reset link sent to ${form.firstAdminEmail.trim()}`,
        });
      } else {
        toast({
          tone: 'error',
          title: 'Tenant created — reset email failed to send',
          description: `${form.firstAdminEmail.trim()} won't have a reset link. Resend it from the tenant's detail page, or check the identity-provider config.`,
          duration: 8000,
        });
      }
      nav(`/platform-admin/tenants/${created.id}`);
    } catch (e2) {
      // The backend rolls the tenant row back if seeding the admin fails.
      setPhase('rolledback');
      setErr(
        isPlatformApiError(e2)
          ? e2.status === 409
            ? 'That subdomain is already in use.'
            : e2.message
          : 'Couldn’t create the tenant — no changes were saved.',
      );
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="New tenant"
        description="Provision a customer workspace and seed its first Company Admin."
        actions={
          <Button variant="ghost" size="sm" onClick={() => nav('/platform-admin')}>
            <ArrowLeft className="h-4 w-4" /> Back to tenants
          </Button>
        }
      />

      <form onSubmit={submit} className="flex flex-col gap-4">
        <Card className="flex flex-col gap-4 p-5">
          <SectionTitle n={1} title="Company" />
          <div className="grid gap-4 md:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="company">Company legal name</Label>
              <Input
                id="company"
                value={form.name}
                onChange={(e) => set('name', e.target.value)}
                placeholder="Meridian Health Services"
              />
            </div>
            <SubdomainField
              value={form.subdomain}
              onChange={(v) => set('subdomain', v)}
              taken={taken}
              onStateChange={setSubdomainOk}
            />
          </div>
        </Card>

        <Card className="flex flex-col gap-4 p-5">
          <SectionTitle n={2} title="Plan, seats & price" />
          <PlanPicker plans={plans} value={form.plan} onChange={(p: SellablePlan) => set('plan', p)} />
          <div className="grid gap-4 md:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="seats">Seats</Label>
              <Input
                id="seats"
                type="number"
                min={1}
                value={form.seats ?? ''}
                onChange={(e) => set('seats', e.target.value ? Number(e.target.value) : undefined)}
                placeholder={
                  pickedPlan ? `${pickedPlan.seatsIncluded} (plan default)` : 'plan default'
                }
              />
              <p className="text-xs text-muted-foreground">
                Soft limit — going over surfaces a warning, it doesn’t block existing employees.
              </p>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="rate">Negotiated price / seat / month</Label>
              <Input
                id="rate"
                type="number"
                min={0}
                value={form.pricePerSeat ?? ''}
                onChange={(e) =>
                  set('pricePerSeat', e.target.value ? Number(e.target.value) : undefined)
                }
                placeholder={
                  pickedPlan
                    ? `${Number(pickedPlan.listPricePerSeat)} (list price)`
                    : 'list price'
                }
              />
              <p className="text-xs text-muted-foreground">
                Blank → the plan’s list price. Snapshotted onto this tenant; later catalog edits
                don’t change it.
              </p>
            </div>
          </div>
          {pickedPlan && (
            <p className="rounded-lg bg-muted/50 p-2.5 text-xs text-muted-foreground">
              ≈{' '}
              <strong className="text-foreground">
                {inr(
                  monthlyTotal(
                    form.pricePerSeat ?? Number(pickedPlan.listPricePerSeat),
                    form.seats ?? pickedPlan.seatsIncluded,
                  ),
                  pickedPlan.currency,
                )}
                /mo
              </strong>{' '}
              — {inr(form.pricePerSeat ?? Number(pickedPlan.listPricePerSeat), pickedPlan.currency)}
              /seat × {form.seats ?? pickedPlan.seatsIncluded} seats. Reference figure — no billing
              integration.
            </p>
          )}
        </Card>

        <Card className="flex flex-col gap-4 p-5">
          <SectionTitle n={3} title="First administrator" />
          <div className="grid gap-4 md:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="admin-name">Legal full name</Label>
              <Input
                id="admin-name"
                value={form.firstAdminName}
                onChange={(e) => set('firstAdminName', e.target.value)}
                placeholder="Rohit Verma"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="admin-email">Work email</Label>
              <Input
                id="admin-email"
                type="email"
                value={form.firstAdminEmail}
                onChange={(e) => set('firstAdminEmail', e.target.value)}
                placeholder="rohit.verma@meridian.example"
                aria-invalid={form.firstAdminEmail.length > 0 && !adminEmailOk}
              />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            We create their login and email them a password-reset link. They become the tenant’s
            Company Admin — the only role that can manage other logins there.
          </p>
        </Card>

        {phase === 'rolledback' && err && (
          <Card className="border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
            <strong className="font-semibold">Tenant not created.</strong> {err} You can adjust the
            details and try again.
          </Card>
        )}

        <div className="sticky bottom-0 flex items-center justify-end gap-3 border-t border-border bg-background py-3">
          <Button type="button" variant="outline" onClick={() => nav('/platform-admin')}>
            Cancel
          </Button>
          <Button type="submit" disabled={!canSubmit}>
            {phase === 'submitting' ? (
              'Creating workspace… provisioning admin login…'
            ) : (
              <>
                <Rocket className="h-4 w-4" /> Create tenant
              </>
            )}
          </Button>
        </div>
      </form>
    </div>
  );
}

function SectionTitle({ n, title }: { n: number; title: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
        {n}
      </span>
      <span className="text-sm font-semibold">{title}</span>
    </div>
  );
}
