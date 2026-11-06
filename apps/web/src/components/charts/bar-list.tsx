import { TONE_COLOR, type Tone } from './chart-utils';

export interface BarListRow {
  id: string;
  label: string;
  value: number;
  /** Small line under the label, e.g. "3 requests". */
  sub?: string;
  tone?: Tone;
}

/**
 * Horizontal bars for comparing a handful of named things: the label on the
 * left, a thin bar (8px, 4px rounded tip, square at the baseline), and the
 * value at the tip — so every value is read directly, no hover needed. One
 * series, one colour: nominal categories are never coloured by size.
 */
export function BarList({
  rows,
  ariaLabel,
  format = (n) => String(n),
  max,
  labelWidth = 'w-32',
}: {
  rows: BarListRow[];
  ariaLabel: string;
  format?: (n: number) => string;
  /** Scale end shared with other lists; defaults to the largest value. */
  max?: number;
  labelWidth?: string;
}) {
  const top = max ?? Math.max(1, ...rows.map((r) => r.value));
  return (
    <ul role="list" aria-label={ariaLabel} className="viz-root flex flex-col gap-3">
      {rows.map((row) => {
        const pct = (Math.max(row.value, 0) / top) * 100;
        return (
          <li key={row.id} className="group flex items-center gap-3">
            <div className={`${labelWidth} min-w-0 shrink-0`}>
              <p className="truncate text-sm" title={row.label}>
                {row.label}
              </p>
              {row.sub && <p className="truncate text-xs text-muted-foreground">{row.sub}</p>}
            </div>
            <div className="flex h-2 flex-1 items-center" aria-hidden="true">
              <div
                className="h-full rounded-r-[4px] transition-[filter] group-hover:brightness-110"
                style={{ width: `${row.value > 0 ? Math.max(pct, 1.5) : 0}%`, background: TONE_COLOR[row.tone ?? 1] }}
              />
            </div>
            <span className="min-w-[3.5rem] shrink-0 text-right text-sm font-semibold tabular-nums">
              {format(row.value)}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
