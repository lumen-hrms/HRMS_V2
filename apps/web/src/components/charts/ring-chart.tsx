import * as React from 'react';
import { TooltipBox } from './chart-tooltip';
import { TONE_COLOR, type Tone } from './chart-utils';

export interface RingSegment {
  id: string;
  label: string;
  value: number;
  tone: Tone;
  /** Shown beside the label in the tooltip, e.g. "3h 10m". */
  display: string;
}

/**
 * Part-to-whole as a ring: arcs share the circle in proportion to their
 * value, a small surface gap between neighbours, flat ends. Hover or focus a
 * segment for its value; `children` is the centre of the ring (the headline
 * number). The legend lives with the caller, since it knows the units.
 */
export function RingChart({
  segments,
  ariaLabel,
  size = 184,
  thickness = 18,
  children,
}: {
  segments: RingSegment[];
  ariaLabel: string;
  size?: number;
  thickness?: number;
  children?: React.ReactNode;
}) {
  const [active, setActive] = React.useState<{ id: string; x: number; y: number } | null>(null);
  const box = React.useRef<HTMLDivElement>(null);

  const center = size / 2;
  const radius = (size - thickness) / 2;
  const circumference = 2 * Math.PI * radius;
  const shown = segments.filter((s) => s.value > 0);
  const total = shown.reduce((sum, s) => sum + s.value, 0);
  const gap = shown.length > 1 ? 2 : 0;

  const lengths = shown.map((s) => (s.value / total) * circumference);
  const arcs = shown.map((s, i) => ({
    segment: s,
    dash: Math.max(lengths[i] - gap, 0.5),
    offset: lengths.slice(0, i).reduce((sum, l) => sum + l, 0),
  }));

  const at = (e: { clientX: number; clientY: number }) => {
    const rect = box.current?.getBoundingClientRect();
    return rect ? { x: e.clientX - rect.left, y: e.clientY - rect.top } : { x: center, y: 0 };
  };
  const activeSegment = active ? shown.find((s) => s.id === active.id) : undefined;

  return (
    <div ref={box} className="viz-root relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} role="img" aria-label={ariaLabel} className="block">
        {total === 0 && (
          <circle cx={center} cy={center} r={radius} fill="none" stroke="var(--viz-muted)" strokeWidth={thickness} />
        )}
        {arcs.map(({ segment, dash, offset: start }) => (
          <circle
            key={segment.id}
            cx={center}
            cy={center}
            r={radius}
            fill="none"
            stroke={TONE_COLOR[segment.tone]}
            strokeWidth={thickness}
            strokeDasharray={`${dash} ${circumference - dash}`}
            strokeDashoffset={-start}
            transform={`rotate(-90 ${center} ${center})`}
            tabIndex={0}
            role="img"
            aria-label={`${segment.label}: ${segment.display}`}
            className="outline-none focus-visible:[stroke-width:22px]"
            style={{ filter: active?.id === segment.id ? 'brightness(1.15)' : undefined, transition: 'filter 120ms' }}
            onPointerMove={(e) => setActive({ id: segment.id, ...at(e) })}
            onPointerLeave={() => setActive(null)}
            onFocus={() => setActive({ id: segment.id, x: center, y: thickness })}
            onBlur={() => setActive(null)}
          />
        ))}
      </svg>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
        {children}
      </div>
      {active && activeSegment && (
        <TooltipBox
          x={active.x}
          y={active.y}
          containerWidth={size}
          content={{
            title: activeSegment.label,
            rows: [{ color: TONE_COLOR[activeSegment.tone], label: '', value: activeSegment.display }],
          }}
        />
      )}
    </div>
  );
}
