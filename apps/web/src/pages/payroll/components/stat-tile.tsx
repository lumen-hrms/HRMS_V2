import * as React from 'react';
import { cn } from '@/lib/utils';

/** A headline figure with an optional caption underneath (e.g. a month-on-month change). */
export function StatTile({
  label,
  value,
  caption,
  className,
}: {
  label: string;
  value: React.ReactNode;
  caption?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('rounded-xl border border-border/60 bg-secondary/40 px-4 py-3', className)}>
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 text-lg font-semibold tabular-nums">{value}</p>
      {caption && <p className="mt-0.5 text-xs text-muted-foreground">{caption}</p>}
    </div>
  );
}

/** ▲ 4.2% / ▼ 1.0% vs a previous figure; muted when there's nothing to compare. */
export function Delta({ pct, suffix = 'vs last month' }: { pct: number | null; suffix?: string }) {
  if (pct === null) return <span>No earlier run to compare</span>;
  const up = pct > 0;
  return (
    <span className={cn(Math.abs(pct) >= 10 ? 'text-warning' : undefined)}>
      {pct === 0 ? '—' : up ? '▲' : '▼'} {Math.abs(pct)}% {suffix}
    </span>
  );
}
