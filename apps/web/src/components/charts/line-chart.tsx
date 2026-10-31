import * as React from 'react';
import { TooltipBox, type TipContent } from './chart-tooltip';
import { TONE_COLOR, clamp, labelStep, niceScale, compact, useElementWidth, type Tone } from './chart-utils';

export interface LinePoint {
  id: string;
  /** Full label for the tooltip, e.g. "Mon 5 Oct". */
  label: string;
  /** Short label under the axis; defaults to `label`. */
  axisLabel?: string;
  /** Null leaves a gap in the line (no data that day). */
  value: number | null;
  /** Colour of this point's marker when `markersCarryTone` is on. */
  tone?: Tone;
  /** Replaces the series name beside the value in the tooltip, e.g. "Late". */
  detail?: string;
}

const MARGIN = { l: 48, r: 20, t: 18, b: 28 };

/**
 * A single-series line: 2px line, a faint area wash, a marker on the latest
 * point, hairline grid. Hover (or the arrow keys) snaps a crosshair to the
 * nearest point and shows its value. With `markersCarryTone` the line turns
 * grey and each marker takes its own tone — identity lives in the dots.
 */
export function LineChart({
  points,
  ariaLabel,
  seriesName,
  height = 220,
  domain,
  yFormat = compact,
  valueFormat = (n) => String(n),
  markersCarryTone = false,
}: {
  points: LinePoint[];
  ariaLabel: string;
  seriesName: string;
  height?: number;
  /** Y axis; defaults to 0 up to a round number above the data. */
  domain?: { min: number; max: number; ticks: number[] };
  yFormat?: (n: number) => string;
  valueFormat?: (n: number) => string;
  markersCarryTone?: boolean;
}) {
  const [ref, width] = useElementWidth<HTMLDivElement>();
  const [active, setActive] = React.useState<number | null>(null);

  const W = Math.max(width, 240);
  const innerW = W - MARGIN.l - MARGIN.r;
  const innerH = height - MARGIN.t - MARGIN.b;
  const values = points.map((p) => p.value).filter((v): v is number => v !== null);
  const dom = domain ?? { min: 0, ...niceScale(Math.max(0, ...values)) };
  const x = (i: number) => MARGIN.l + (points.length <= 1 ? innerW / 2 : (i / (points.length - 1)) * innerW);
  const y = (v: number) => MARGIN.t + innerH - ((v - dom.min) / (dom.max - dom.min || 1)) * innerH;

  const valueIdx = points.flatMap((p, i) => (p.value === null ? [] : [i]));
  const lastIdx = valueIdx[valueIdx.length - 1] ?? null;

  const segments: { x: number; y: number }[][] = [];
  let run: { x: number; y: number }[] = [];
  points.forEach((p, i) => {
    if (p.value === null) {
      if (run.length) segments.push(run);
      run = [];
    } else {
      run.push({ x: x(i), y: y(p.value) });
    }
  });
  if (run.length) segments.push(run);

  const nearest = (i: number) =>
    valueIdx.length === 0
      ? null
      : valueIdx.reduce((best, j) => (Math.abs(j - i) < Math.abs(best - i) ? j : best), valueIdx[0]);

  function onPointerMove(e: React.PointerEvent<SVGSVGElement>) {
    const px = e.clientX - e.currentTarget.getBoundingClientRect().left;
    const i = Math.round(((px - MARGIN.l) / (innerW || 1)) * (points.length - 1));
    setActive(nearest(clamp(i, 0, points.length - 1)));
  }

  function onKeyDown(e: React.KeyboardEvent<SVGSVGElement>) {
    if (active === null || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return;
    e.preventDefault();
    const pos = valueIdx.indexOf(active);
    setActive(valueIdx[clamp(pos + (e.key === 'ArrowRight' ? 1 : -1), 0, valueIdx.length - 1)]);
  }

  const step = labelStep(points.length, innerW, 44);
  const path = (seg: { x: number; y: number }[]) => seg.map((p, i) => `${i ? 'L' : 'M'}${p.x},${p.y}`).join(' ');
  const baseline = y(dom.min);
  const lineColor = markersCarryTone ? 'var(--viz-muted)' : 'var(--viz-1)';

  const activePoint = active === null ? null : points[active];
  const tip: TipContent | null =
    activePoint && activePoint.value !== null
      ? {
          title: activePoint.label,
          rows: [
            {
              color: TONE_COLOR[activePoint.tone ?? 1],
              label: activePoint.detail ?? seriesName,
              value: valueFormat(activePoint.value),
            },
          ],
        }
      : null;

  const marker = (i: number, key: string) => {
    const p = points[i];
    return (
      <circle
        key={key}
        cx={x(i)}
        cy={y(p.value!)}
        r={4}
        fill={TONE_COLOR[markersCarryTone ? (p.tone ?? 1) : 1]}
        stroke="var(--card)"
        strokeWidth={2}
      />
    );
  };

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
        onFocus={() => setActive((a) => a ?? lastIdx)}
        onBlur={() => setActive(null)}
        onKeyDown={onKeyDown}
      >
        {dom.ticks.map((t) => (
          <g key={t}>
            <line x1={MARGIN.l} x2={W - MARGIN.r} y1={y(t)} y2={y(t)} stroke="var(--border)" strokeWidth={1} />
            <text x={MARGIN.l - 8} y={y(t) + 4} textAnchor="end" fontSize={11} className="fill-muted-foreground tabular-nums">
              {yFormat(t)}
            </text>
          </g>
        ))}

        {points.map(
          (p, i) =>
            i % step === 0 && (
              <text key={p.id} x={x(i)} y={height - 8} textAnchor="middle" fontSize={11} className="fill-muted-foreground">
                {p.axisLabel ?? p.label}
              </text>
            ),
        )}

        {!markersCarryTone &&
          segments.map((seg, i) => (
            <path
              key={`a${i}`}
              d={`${path(seg)} L${seg[seg.length - 1].x},${baseline} L${seg[0].x},${baseline} Z`}
              fill="var(--viz-1)"
              opacity={0.1}
            />
          ))}
        {segments.map((seg, i) =>
          seg.length > 1 ? (
            <path key={`l${i}`} d={path(seg)} fill="none" stroke={lineColor} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          ) : null,
        )}

        {activePoint && active !== null && activePoint.value !== null && (
          <line
            x1={x(active)}
            x2={x(active)}
            y1={MARGIN.t}
            y2={baseline}
            stroke="var(--muted-foreground)"
            strokeOpacity={0.5}
            strokeWidth={1}
          />
        )}

        {markersCarryTone ? valueIdx.map((i) => marker(i, `m${i}`)) : lastIdx !== null && marker(lastIdx, 'last')}
        {active !== null && points[active].value !== null && marker(active, 'active')}

        {!markersCarryTone && lastIdx !== null && active === null && (
          <text
            x={x(lastIdx)}
            y={y(points[lastIdx].value!) - 12}
            textAnchor={lastIdx === points.length - 1 ? 'end' : 'middle'}
            fontSize={12}
            fontWeight={600}
            className="fill-card-foreground"
          >
            {valueFormat(points[lastIdx].value!)}
          </text>
        )}
      </svg>
      {tip && active !== null && <TooltipBox x={x(active)} y={y(points[active].value!)} containerWidth={W} content={tip} />}
    </div>
  );
}
