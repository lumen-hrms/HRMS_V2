import { clamp, useElementWidth } from './chart-utils';

const HEIGHT = 44;

/**
 * A tile-sized trend: the 2px line and a marker on the latest point, no axes
 * (the tile's number and the detail page carry the exact values).
 */
export function Sparkline({ values, ariaLabel }: { values: (number | null)[]; ariaLabel: string }) {
  const [ref, width] = useElementWidth<HTMLDivElement>();
  const W = Math.max(width, 60);
  const pad = 6;
  const present = values.filter((v): v is number => v !== null);
  const lo = Math.min(...present);
  const hi = Math.max(...present);
  const x = (i: number) => pad + (values.length <= 1 ? (W - 2 * pad) / 2 : (i / (values.length - 1)) * (W - 2 * pad));
  // A flat series sits mid-height rather than on an edge.
  const y = (v: number) => (hi === lo ? HEIGHT / 2 : HEIGHT - pad - ((v - lo) / (hi - lo)) * (HEIGHT - 2 * pad));
  const pts = values.flatMap((v, i) => (v === null ? [] : [{ x: x(i), y: y(v) }]));
  const last = pts[pts.length - 1];

  return (
    <div ref={ref} className="viz-root w-full">
      <svg width={W} height={HEIGHT} role="img" aria-label={ariaLabel} className="block">
        {pts.length > 1 && (
          <path
            d={pts.map((p, i) => `${i ? 'L' : 'M'}${p.x},${p.y}`).join(' ')}
            fill="none"
            stroke="var(--viz-1)"
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        )}
        {last && <circle cx={last.x} cy={last.y} r={4} fill="var(--viz-1)" stroke="var(--card)" strokeWidth={2} />}
      </svg>
    </div>
  );
}

/** A tile-sized run of thin columns from a zero baseline — one per day, say. */
export function MiniColumns({ values, ariaLabel }: { values: (number | null)[]; ariaLabel: string }) {
  const [ref, width] = useElementWidth<HTMLDivElement>();
  const W = Math.max(width, 60);
  const max = Math.max(0, ...values.map((v) => v ?? 0));
  const band = W / Math.max(values.length, 1);
  const w = clamp(band * 0.62, 2, 8);

  return (
    <div ref={ref} className="viz-root w-full">
      <svg width={W} height={HEIGHT} role="img" aria-label={ariaLabel} className="block">
        <line x1={0} x2={W} y1={HEIGHT - 0.5} y2={HEIGHT - 0.5} stroke="var(--border)" strokeWidth={1} />
        {values.map((v, i) => {
          if (!v || max === 0) return null;
          const h = Math.max(2, (v / max) * (HEIGHT - 6));
          const r = Math.min(2, w / 2, h);
          const left = band * i + (band - w) / 2;
          const top = HEIGHT - 1 - h;
          return (
            <path
              key={i}
              d={`M${left},${HEIGHT - 1} V${top + r} Q${left},${top} ${left + r},${top} H${left + w - r} Q${left + w},${top} ${left + w},${top + r} V${HEIGHT - 1} Z`}
              fill="var(--viz-1)"
            />
          );
        })}
      </svg>
    </div>
  );
}
