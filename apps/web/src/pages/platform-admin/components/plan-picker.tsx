import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import { PLAN_CATALOG, SELLABLE_PLANS, inr, moduleLabel } from '../lib/plan-catalog';
import type { SellablePlan } from '../lib/types';

/** Card picker for the sellable plans + a detail panel for the chosen one. */
export function PlanPicker({
  value,
  onChange,
}: {
  value: SellablePlan;
  onChange: (p: SellablePlan) => void;
}) {
  const picked = PLAN_CATALOG[value];
  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        {SELLABLE_PLANS.map((p) => {
          const entry = PLAN_CATALOG[p];
          const active = p === value;
          return (
            <button
              key={p}
              type="button"
              onClick={() => onChange(p)}
              className={cn(
                'flex flex-col gap-0.5 rounded-lg border p-3 text-left transition-colors',
                active
                  ? 'border-primary bg-accent ring-1 ring-primary'
                  : 'border-border hover:bg-accent',
              )}
            >
              <span className="flex items-center justify-between text-sm font-semibold">
                {entry.label}
                {active && <Check className="h-4 w-4 text-primary" />}
              </span>
              <span className="text-xs text-muted-foreground">
                {entry.seatsIncluded} seats · {inr(entry.priceMonthly)}/mo
              </span>
            </button>
          );
        })}
      </div>

      <div className="rounded-lg border border-border bg-muted/40 p-3 text-xs">
        <p className="mb-1.5 font-semibold text-foreground">
          {picked.label} includes ({inr(picked.priceMonthly)}/mo · {picked.seatsIncluded} seats)
        </p>
        <ul className="mb-2 flex flex-col gap-0.5 text-muted-foreground">
          {picked.modules.map((m) => (
            <li key={m} className="flex items-center gap-1.5">
              <Check className="h-3 w-3 text-success" /> {moduleLabel(m)}
            </li>
          ))}
        </ul>
        <p className="text-muted-foreground">
          Premium:{' '}
          {picked.features.filter((f) => f.on).map((f) => f.label).join(', ') || 'none'}
        </p>
        <p className="mt-1.5 text-[11px] text-muted-foreground">
          Price is indicative — there is no billing integration; nothing is charged.
        </p>
      </div>
    </div>
  );
}
