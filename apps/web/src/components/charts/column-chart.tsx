import * as React from 'react';
import { TooltipBox, type TipContent } from './chart-tooltip';
import { TONE_COLOR, clamp, labelStep, niceScale, compact, useElementWidth, type Tone } from './chart-utils';

export interface ColumnBar {
  id: string;
  /** Full label for the tooltip, e.g. "Mon 5 Oct". */
  label: string;
  /** Short label under the axis; defaults to `label`. */
  axisLabel?: string;
  /** Null draws no bar (no data that day). */
  value: number | null;
  tone?: Tone;
  /** Extra line in the tooltip, e.g. "Present". */
  detail?: string;
}

const MARGIN = { l: 44, r: 16, t: 22, b: 28 };
const MAX_BAR = 24;
const RADIUS = 4;

/** A bar with a 4px rounded top and a square foot, so it grows from the baseline. */
function barPath(x: number, w: number, top: number, base: number) {
  const r = Math.min(RADIUS, w / 2, base - top);
  return `M${x},${base} V${top + r} Q${x},${top} ${x + r},${top} H${x + w - r} Q${x + w},${top} ${x + w},${top + r} V${base} Z`;
}

/**
 * Thin columns from a zero baseline — never wider than 24px, the air between
 * them is the separator. Hover (or the arrow keys) lifts a column and shows
 * its value; the tallest column is labelled directly. An optional target is a
 * solid hairline with its own label.
 */
export function ColumnChart({
  bars,
  ariaLabel,
  seriesName,
  height = 220,
  yFormat = compact,
  valueFormat = (n) => String(n),
  target,
}: {
  bars: ColumnBar[];
  ariaLabel: string;
  seriesName: string;
  height?: number;
  yFormat?: (n: number) => string;
  valueFormat?: (n: number) => string;
  target?: { value: number; label: string };
}) {
  const [ref, width] = useElementWidth<HTMLDivElement>();
  const [active, setActive] = React.useState<number | null>(null);

  const W = Math.max(width, 240);
  const innerW = W - MARGIN.l - MARGIN.r;
  const innerH = height - MARGIN.t - MARGIN.b;
  const values = bars.map((b) => b.value).filter((v): v is number => v !== null);
  const scale = niceScale(Math.max(0, target?.value ?? 0, ...values));
  const band = innerW / Math.max(bars.length, 1);
  const barW = clamp(band * 0.7, 2, MAX_BAR);
  const base = MARGIN.t + innerH;
  const y = (v: number) => base - (v / scale.max) * innerH;
  const cx = (i: number) => MARGIN.l + band * i + band / 2;

  const withValue = bars.flatMap((b, i) => (b.value === null ? [] : [i]));
  const tallest = values.length ? bars.findIndex((b) => b.value === Math.max(...values)) : -1;

  function onPointerMove(e: React.PointerEvent<SVGSVGElement>) {
    const px = e.clientX - e.currentTarget.getBoundingClientRect().left;
    const i = clamp(Math.floor((px - MARGIN.l) / band), 0, bars.length - 1);
    setActive(bars[i]?.value === null ? null : i);
  }

  function onKeyDown(e: React.KeyboardEvent<SVGSVGElement>) {
    if (active === null || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return;
    e.preventDefault();
    const pos = withValue.indexOf(active);
    setActive(withValue[clamp(pos + (e.key === 'ArrowRight' ? 1 : -1), 0, withValue.length - 1)]);
  }

  const step = labelStep(bars.length, innerW, 28);
  const activeBar = active === null ? null : bars[active];
  const tip: TipContent | null =
    activeBar && activeBar.value !== null
      ? {
          title: activeBar.detail ? `${activeBar.label} · ${activeBar.detail}` : activeBar.label,
          rows: [{ color: TONE_COLOR[activeBar.tone ?? 1], label: seriesName, value: valueFormat(activeBar.value) }],
        }
      : null;

  return (
    <div ref={ref} className="viz-root relative w-full">
      <svg
        width={W}
        height={height}
        role="img"
        aria-label={ariaLabel}
        tabIndex={0}
        className="block rounded outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onPointerMove={onPointerMove}
        onPointerLeave={() => setActive(null)}
        onFocus={() => setActive((a) => a ?? withValue[withValue.length - 1] ?? null)}
        onBlur={() => setActive(null)}
        onKeyDown={onKeyDown}
      >
        {scale.ticks.map((t) => (
          <g key={t}>
            <line x1={MARGIN.l} x2={W - MARGIN.r} y1={y(t)} y2={y(t)} stroke="var(--border)" strokeWidth={1} />
            <text x={MARGIN.l - 8} y={y(t) + 4} textAnchor="end" fontSize={11} className="fill-muted-foreground tabular-nums">
              {yFormat(t)}
            </text>
          </g>
        ))}

        {bars.map(
          (b, i) =>
            i % step === 0 && (
              <text key={b.id} x={cx(i)} y={height - 8} textAnchor="middle" fontSize={11} className="fill-muted-foreground">
                {b.axisLabel ?? b.label}
              </text>
            ),
        )}

        {bars.map(
          (b, i) =>
            b.value !== null &&
            b.value > 0 && (
              <path
                key={b.id}
                d={barPath(cx(i) - barW / 2, barW, y(b.value), base)}
                fill={TONE_COLOR[b.tone ?? 1]}
                style={{ filter: active === i ? 'brightness(1.15)' : undefined, transition: 'filter 120ms' }}
              />
            ),
        )}

        {target && (
          <g>
            <line
              x1={MARGIN.l}
              x2={W - MARGIN.r}
              y1={y(target.value)}
              y2={y(target.value)}
              stroke="var(--muted-foreground)"
              strokeOpacity={0.7}
              strokeWidth={1}
            />
            <text x={W - MARGIN.r} y={y(target.value) - 5} textAnchor="end" fontSize={11} className="fill-muted-foreground">
              {target.label}
            </text>
          </g>
        )}

        {tallest >= 0 && active === null && bars[tallest].value! > 0 && (
          <text
            x={clamp(cx(tallest), MARGIN.l + 16, W - MARGIN.r - 16)}
            y={y(bars[tallest].value!) - 6}
            textAnchor="middle"
            fontSize={12}
            fontWeight={600}
            className="fill-card-foreground"
          >
            {valueFormat(bars[tallest].value!)}
          </text>
        )}
      </svg>
      {tip && active !== null && activeBar && (
        <TooltipBox x={cx(active)} y={y(activeBar.value!)} containerWidth={W} content={tip} />
      )}
    </div>
  );
}
