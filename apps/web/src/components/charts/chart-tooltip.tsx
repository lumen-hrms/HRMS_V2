import { clamp } from './chart-utils';

export interface TipContent {
  title: string;
  rows: { color?: string; label: string; value: string }[];
}

/**
 * One tooltip for a whole chart: the value leads (strong), the name follows
 * (secondary), each row keyed by a short stroke of its series colour. Text is
 * rendered through React, so a label from the API can never become markup.
 */
export function TooltipBox({
  x,
  y,
  containerWidth,
  content,
}: {
  x: number;
  y: number;
  containerWidth: number;
  content: TipContent;
}) {
  const half = 90;
  return (
    <div
      role="tooltip"
      className="pointer-events-none absolute z-10 min-w-[8rem] max-w-[16rem] rounded-md border border-border bg-card px-2.5 py-1.5 text-xs shadow-md"
      style={{ left: clamp(x, half, Math.max(half, containerWidth - half)), top: y, transform: 'translate(-50%, calc(-100% - 10px))' }}
    >
      <p className="mb-1 text-muted-foreground">{content.title}</p>
      {content.rows.map((row) => (
        <div key={row.label} className="flex items-center gap-2">
          {row.color && (
            <span aria-hidden="true" className="h-0.5 w-3 shrink-0 rounded-full" style={{ background: row.color }} />
          )}
          <span className="font-semibold tabular-nums text-card-foreground">{row.value}</span>
          <span className="text-muted-foreground">{row.label}</span>
        </div>
      ))}
    </div>
  );
}

/** The identity key for charts with two or more series: a swatch, the name, and (optionally) its value. */
export function ChartLegend({
  items,
}: {
  items: { color: string; label: string; value?: string }[];
}) {
  return (
    <ul className="viz-root flex flex-wrap gap-x-5 gap-y-1.5 text-xs" aria-label="Legend">
      {items.map((item) => (
        <li key={item.label} className="flex items-center gap-1.5">
          <span aria-hidden="true" className="h-2.5 w-2.5 shrink-0 rounded-[3px]" style={{ background: item.color }} />
          <span className="text-muted-foreground">{item.label}</span>
          {item.value !== undefined && <span className="font-semibold tabular-nums text-card-foreground">{item.value}</span>}
        </li>
      ))}
    </ul>
  );
}
