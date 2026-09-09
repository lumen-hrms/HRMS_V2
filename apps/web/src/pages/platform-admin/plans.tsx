import * as React from 'react';
import { Check, Minus, Pencil } from 'lucide-react';
import { PageHeader } from '@/components/page-header';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty-state';
import { platformApi } from '@/lib/platform-api';
import {
  ALL_MODULES,
  FEATURE_KEYS,
  featureLabel,
  inr,
  moduleLabel,
  monthlyTotal,
} from './lib/plan-catalog';
import type { Plan } from './lib/types';
import { PlanEditDialog } from './components/plan-edit-dialog';

/**
 * Plan catalog — operator-editable pricing / seats / modules / features /
 * isolation tier for the 3 sellable plans. Editing a plan does NOT change
 * live tenants; each Subscription carries a snapshot and picks up plan
 * changes on renewal.
 */
export function PlansPage() {
  const [plans, setPlans] = React.useState<Plan[] | null>(null);
  const [err, setErr] = React.useState(false);
  const [editing, setEditing] = React.useState<Plan | null>(null);

  const load = React.useCallback(() => {
    setPlans(null);
    setErr(false);
    platformApi
      .listPlans()
      .then((p) => setPlans([...p].sort((a, b) => a.sortOrder - b.sortOrder)))
      .catch(() => {
        setPlans([]);
        setErr(true);
      });
  }, []);
  React.useEffect(load, [load]);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Plans"
        description="Pricing, seats and entitlements for the sellable plans. Edits apply to new tenants and to existing tenants at their next renewal — never retroactively."
      />

      {plans == null ? (
        <div className="grid gap-4 lg:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-72 w-full" />
          ))}
        </div>
      ) : err ? (
        <Card className="overflow-hidden">
          <EmptyState
            title="Couldn’t load plans"
            action={
              <Button size="sm" variant="outline" onClick={load}>
                Retry
              </Button>
            }
          />
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-3">
          {plans.map((p) => (
            <Card key={p.key} className="flex flex-col gap-3 p-5">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-base font-semibold">{p.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {p.tenantCount} tenant{p.tenantCount === 1 ? '' : 's'} ·{' '}
                    {p.isolationTier === 'DEDICATED' ? 'Dedicated DB' : 'Pooled'}
                  </p>
                </div>
                <Button size="sm" variant="outline" onClick={() => setEditing(p)}>
                  <Pencil className="h-3.5 w-3.5" /> Edit
                </Button>
              </div>

              <div className="flex items-baseline gap-1">
                <span className="text-2xl font-semibold">
                  {inr(p.listPricePerSeat, p.currency)}
                </span>
                <span className="text-xs text-muted-foreground">/ seat / month</span>
              </div>
              <p className="text-sm text-muted-foreground">
                {p.seatsIncluded} seats default · ≈{' '}
                {inr(monthlyTotal(p.listPricePerSeat, p.seatsIncluded), p.currency)}/mo
              </p>

              <div className="mt-1">
                <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Modules
                </p>
                <ul className="flex flex-col gap-0.5 text-sm">
                  {ALL_MODULES.map((m) => {
                    const on = p.enabledModules.includes(m);
                    return (
                      <li
                        key={m}
                        className={on ? 'flex items-center gap-1.5' : 'flex items-center gap-1.5 text-muted-foreground'}
                      >
                        {on ? (
                          <Check className="h-3.5 w-3.5 text-success" />
                        ) : (
                          <Minus className="h-3.5 w-3.5" />
                        )}
                        {moduleLabel(m)}
                      </li>
                    );
                  })}
                </ul>
              </div>

              <div>
                <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Features
                </p>
                <ul className="flex flex-col gap-0.5 text-sm">
                  {FEATURE_KEYS.map((k) => {
                    const on = !!p.features[k];
                    return (
                      <li
                        key={k}
                        className={on ? 'flex items-center gap-1.5' : 'flex items-center gap-1.5 text-muted-foreground'}
                      >
                        {on ? (
                          <Check className="h-3.5 w-3.5 text-success" />
                        ) : (
                          <Minus className="h-3.5 w-3.5" />
                        )}
                        {featureLabel(k)}
                      </li>
                    );
                  })}
                </ul>
              </div>
            </Card>
          ))}
        </div>
      )}

      <PlanEditDialog
        plan={editing}
        open={!!editing}
        onOpenChange={(v) => !v && setEditing(null)}
        onDone={load}
      />
    </div>
  );
}
