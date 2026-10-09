import { cn } from '@/lib/utils';

/** `₹ 1,23,456.78` — same `en-IN` grouping every other money display in the app uses. */
export function formatMoney(value: string | number | null | undefined): string {
  const n = Number(value ?? 0);
  return `₹ ${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Inline money figure, right-aligned tabular numerals; negative values render in destructive text. */
export function Money({
  value,
  className,
}: {
  value: string | number | null | undefined;
  className?: string;
}) {
  const n = Number(value ?? 0);
  return (
    <span className={cn('tabular-nums', n < 0 && 'text-destructive', className)}>
      {formatMoney(value)}
    </span>
  );
}
