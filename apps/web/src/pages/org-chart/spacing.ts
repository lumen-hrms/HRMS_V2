/** Axis-aligned box in chart (unscaled content) pixels. */
export interface Box {
  l: number;
  t: number;
  r: number;
  b: number;
}

/** Breathing room kept between any two cards. */
const GAP = 16;
const STEP = 8;
const MAX_RADIUS = 2400;

const hits = (a: Box, b: Box, dx: number, dy: number) =>
  a.l + dx - GAP < b.r && a.r + dx + GAP > b.l && a.t + dy - GAP < b.b && a.b + dy + GAP > b.t;

const collides = (unit: Box[], obstacles: Box[], dx: number, dy: number) =>
  unit.some((u) => obstacles.some((o) => hits(u, o, dx, dy)));

// Straight slides first (left/right/up/down), then every 15° in between.
const DIRS: [number, number][] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  ...Array.from({ length: 24 }, (_, i) => i * 15)
    .filter((deg) => deg % 90 !== 0)
    .map((deg): [number, number] => [Math.cos((deg * Math.PI) / 180), Math.sin((deg * Math.PI) / 180)]),
];

/**
 * The smallest shift that takes `unit` (the cards being moved together) clear
 * of every obstacle, searching outwards in growing rings. `{0,0}` when it
 * already clears them; null only if nothing within MAX_RADIUS is free.
 */
export function freeShift(unit: Box[], obstacles: Box[]): { x: number; y: number } | null {
  if (!collides(unit, obstacles, 0, 0)) return { x: 0, y: 0 };
  for (let r = STEP; r <= MAX_RADIUS; r += STEP) {
    for (const [ux, uy] of DIRS) {
      const dx = Math.round(ux * r);
      const dy = Math.round(uy * r);
      if (!collides(unit, obstacles, dx, dy)) return { x: dx, y: dy };
    }
  }
  return null;
}

/** Rendered scale of the pan/zoom content (its screen width / layout width). */
export const contentScale = (el: HTMLElement) =>
  el.offsetWidth ? el.getBoundingClientRect().width / el.offsetWidth : 1;
