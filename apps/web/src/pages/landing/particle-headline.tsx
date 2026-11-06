import * as React from 'react';

interface Dot {
  x: number;
  y: number;
  /** Where it rests inside the headline. */
  tx: number;
  ty: number;
  /** Where it pours to as the hero scrolls away. */
  dx: number;
  dy: number;
  seed: number;
  ease: number;
}

const MAX_DOTS = 9000;
const REPEL_RADIUS = 110;
const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

/** Rasterises the headline off-screen and turns its pixels into two groups of dots. */
function buildDots(width: number, height: number, family: string) {
  const narrow = width < 640;
  const lines = narrow ? ['People', 'operations,', 'illuminated.'] : ['People operations,', 'illuminated.'];
  const size = narrow ? width * 0.155 : Math.min(width * 0.092, height * 0.16, 132);
  const lineHeight = size * 1.08;
  const firstY = height * 0.38 - (lineHeight * (lines.length - 1)) / 2;
  const goldFrom = firstY + lineHeight * (lines.length - 1) - lineHeight / 2;

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return { ivory: [], gold: [], dotSize: 2 };
  ctx.font = `600 ${size}px ${family}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.letterSpacing = `${-0.03 * size}px`;
  lines.forEach((line, i) => ctx.fillText(line, width / 2, firstY + i * lineHeight));

  const { data } = ctx.getImageData(0, 0, width, height);
  const gap = Math.max(1.9, size / 44);
  const ivory: Dot[] = [];
  const gold: Dot[] = [];
  for (let y = 0; y < height; y += gap) {
    for (let x = 0; x < width; x += gap) {
      if (data[(Math.floor(y) * width + Math.floor(x)) * 4 + 3] < 128) continue;
      if (ivory.length + gold.length >= MAX_DOTS) break;
      const seed = Math.random();
      (y >= goldFrom ? gold : ivory).push({
        x: Math.random() * width,
        y: Math.random() * height,
        tx: x + (Math.random() - 0.5) * gap * 0.7,
        ty: y + (Math.random() - 0.5) * gap * 0.7,
        dx: width / 2 + (Math.random() - 0.5) * width * 0.6,
        dy: height * (0.75 + Math.random() * 0.3),
        seed,
        ease: 0.035 + seed * 0.06,
      });
    }
  }
  return { ivory, gold, dotSize: gap * 0.74 };
}

/**
 * The hero headline as a swarm of dots: each one finds its place in the
 * letters, shies from the cursor, and pours into the product as `scene`
 * scrolls away. Purely decorative — the real <h1> stays in the DOM for
 * assistive tech, and takes over under prefers-reduced-motion (landing.css).
 */
export function ParticleHeadline({ scene }: { scene: React.RefObject<HTMLElement | null> }) {
  const ref = React.useRef<HTMLCanvasElement>(null);

  React.useEffect(() => {
    const canvas = ref.current;
    const host = scene.current;
    if (!canvas || !host) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const family = getComputedStyle(canvas).fontFamily;
    let width = 0;
    let height = 0;
    let dots: ReturnType<typeof buildDots> = { ivory: [], gold: [], dotSize: 2 };
    let raf = 0;
    let running = true;
    const mouse = { x: -9999, y: -9999 };

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      if (rect.width === width && rect.height === height) return;
      width = Math.round(rect.width);
      height = Math.round(rect.height);
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      dots = buildDots(width, height, family);
    };

    const step = (list: Dot[], pour: number, time: number, shimmer: boolean) => {
      for (const d of list) {
        const si = clamp01(pour * 1.7 - d.seed * 0.7);
        const e = si * si;
        d.x += (d.tx + (d.dx - d.tx) * e - d.x) * d.ease;
        d.y += (d.ty + (d.dy - d.ty) * e - d.y) * d.ease;

        const mx = d.x - mouse.x;
        const my = d.y - mouse.y;
        const dist2 = mx * mx + my * my;
        if (dist2 < REPEL_RADIUS * REPEL_RADIUS && dist2 > 0) {
          const dist = Math.sqrt(dist2);
          const force = (1 - dist / REPEL_RADIUS) * 5;
          d.x += (mx / dist) * force;
          d.y += (my / dist) * force;
        }

        const fade = 1 - e;
        if (fade < 0.02) continue;
        ctx.globalAlpha = shimmer ? fade * (0.86 + 0.14 * Math.sin(d.tx * 0.012 - time * 0.0022)) : fade;
        ctx.fillRect(d.x, d.y, dots.dotSize, dots.dotSize);
      }
    };

    const frame = (time: number) => {
      raf = 0;
      if (!running) return;
      // The scene's smoothed progress, so the dots glide with everything else.
      const p = parseFloat(host.style.getPropertyValue('--p')) || 0;
      const pour = clamp01((p - 0.06) / 0.34);
      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = '#eef1f7';
      step(dots.ivory, pour, time, false);
      ctx.fillStyle = '#e0b23e';
      step(dots.gold, pour, time, true);
      ctx.globalAlpha = 1;
      raf = requestAnimationFrame(frame);
    };

    const onPointer = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      mouse.x = e.clientX - rect.left;
      mouse.y = e.clientY - rect.top;
    };
    const onLeave = () => {
      mouse.x = -9999;
      mouse.y = -9999;
    };

    resize();
    const resizer = new ResizeObserver(resize);
    resizer.observe(canvas);
    const visibility = new IntersectionObserver(([entry]) => {
      running = entry.isIntersecting;
      if (running && !raf) raf = requestAnimationFrame(frame);
    });
    visibility.observe(host);
    window.addEventListener('pointermove', onPointer, { passive: true });
    document.addEventListener('pointerleave', onLeave);
    raf = requestAnimationFrame(frame);

    return () => {
      running = false;
      cancelAnimationFrame(raf);
      resizer.disconnect();
      visibility.disconnect();
      window.removeEventListener('pointermove', onPointer);
      document.removeEventListener('pointerleave', onLeave);
    };
  }, [scene]);

  return <canvas ref={ref} aria-hidden="true" className="particle-canvas" />;
}
