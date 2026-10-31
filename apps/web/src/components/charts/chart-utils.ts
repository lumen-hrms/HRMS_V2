import * as React from 'react';

/** Series colours by slot (see the `.viz-root` tokens in index.css). */
export type Tone = 1 | 2 | 3 | 4 | 'muted';

export const TONE_COLOR: Record<Tone, string> = {
  1: 'var(--viz-1)',
  2: 'var(--viz-2)',
  3: 'var(--viz-3)',
  4: 'var(--viz-4)',
  muted: 'var(--viz-muted)',
};

/** A round axis end for `max`, and the tick values from 0 up to it. */
export function niceScale(max: number, tickCount = 4): { max: number; ticks: number[] } {
  if (!(max > 0)) return { max: 1, ticks: [0, 1] };
  const rough = max / tickCount;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((s) => s >= rough)!;
  const top = Math.ceil(max / step - 1e-9) * step;
  const ticks: number[] = [];
  for (let v = 0; v <= top + step / 1e6; v += step) ticks.push(Math.round(v * 1e6) / 1e6);
  return { max: top, ticks };
}

/** 1,200 → 1.2K — axis ticks only; tooltips and tables keep exact values. */
export function compact(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${+(n / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${+(n / 1_000).toFixed(1)}K`;
  return `${+n.toFixed(2)}`;
}

/** Show every Nth x label so they never collide, whatever the width. */
export function labelStep(count: number, width: number, minPx = 36): number {
  if (count <= 1 || width <= 0) return 1;
  return Math.max(1, Math.ceil((count * minPx) / width));
}

/** The element's rendered width, kept current as it resizes. */
export function useElementWidth<T extends HTMLElement>() {
  const ref = React.useRef<T>(null);
  const [width, setWidth] = React.useState(0);
  React.useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.round(entry.contentRect.width)));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

export const clamp = (n: number, lo: number, hi: number) => Math.min(Math.max(n, lo), hi);

/** "8h 30m" — hours and minutes from a minute count. */
export function formatMinutes(minutes: number): string {
  const rounded = Math.round(minutes);
  const h = Math.floor(rounded / 60);
  const m = rounded % 60;
  return h === 0 ? `${m}m` : m === 0 ? `${h}h` : `${h}h ${m}m`;
}

/** "9:05 AM" — a clock time from minutes since midnight. */
export function formatClock(minutes: number): string {
  const h24 = Math.floor(minutes / 60) % 24;
  const m = Math.round(minutes % 60);
  const suffix = h24 >= 12 ? 'PM' : 'AM';
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${suffix}`;
}
