import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import { inr, moduleLabel, monthlyTotal } from '../lib/plan-catalog';
import type { Plan, SellablePlan } from '../lib/types';

/** Card picker for the sellable plans + a detail panel for the chosen one. */
export function PlanPicker({
  plans,
  value,
  onChange,
}: {
  plans: Plan[];
  value: SellablePlan;
  onChange: (p: SellablePlan) => void;
}) {
  const sorted = [...plans].sort((a, b) => a.sortOrder - b.sortOrder);
  const picked = plans.find((p) => p.key === value) ?? sorted[0];

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        {sorted.map((p) => {
          const active = p.key === value;
          return (
            <button
              key={p.key}
              type="button"
              onClick={() => onChange(p.key)}
              className={cn(
                'flex flex-col gap-0.5 rounded-lg border p-3 text-left transition-colors',
                active ? 'border-primary bg-accent ring-1 ring-primary' : 'border-border hover:bg-accent',
              )}
            >
              <span className="flex items-center justify-between text-sm font-semibold">
                {p.name}
                {active && <Check className="h-4 w-4 text-primary" />}
              </span>
              <span className="text-xs text-muted-foreground">
                {inr(p.listPricePerSeat, p.currency)}/seat/mo · {p.seatsIncluded} seats default
              </span>
            </button>
          );
        })}
      </div>

      {picked && (
        <div className="rounded-lg border border-border bg-muted/40 p-3 text-xs">
          <p className="mb-1.5 font-semibold text-foreground">
            {picked.name} — {inr(picked.listPricePerSeat, picked.currency)}/seat/mo ·{' '}
            {picked.isolationTier === 'DEDICATED' ? 'dedicated DB' : 'pooled'} (≈{' '}
            {inr(monthlyTotal(picked.listPricePerSeat, picked.seatsIncluded), picked.currency)}/mo at{' '}
            {picked.seatsIncluded} seats)
          </p>
          <ul className="mb-2 flex flex-col gap-0.5 text-muted-foreground">
            {picked.enabledModules.map((m) => (
              <li key={m} className="flex items-center gap-1.5">
                <Check className="h-3 w-3 text-success" /> {moduleLabel(m)}
              </li>
            ))}
          </ul>
          <p className="text-muted-foreground">
            Premium:{' '}
            {Object.entries(picked.features)
              .filter(([, on]) => on)
              .map(([k]) => k)
              .join(', ') || 'none'}
          </p>
          <p className="mt-1.5 text-[11px] text-muted-foreground">
            List price, editable in <strong>Plans</strong>. Set the negotiated rate for this deal
            below. Pricing is a stored reference — there is no billing integration.
          </p>
        </div>
      )}
    </div>
  );
}
