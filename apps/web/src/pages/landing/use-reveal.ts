import * as React from 'react';

/**
 * Adds `is-visible` to every `[data-reveal]` element inside `root` the first
 * time it scrolls into view (the CSS in landing.css does the actual
 * animation). One shared IntersectionObserver per page; elements are
 * unobserved after revealing so it never re-hides on scroll-up.
 */
export function useReveal(root: React.RefObject<HTMLElement | null>) {
  React.useEffect(() => {
    const el = root.current;
    if (!el) return;
    const targets = el.querySelectorAll<HTMLElement>('[data-reveal]');
    if (!('IntersectionObserver' in window)) {
      targets.forEach((t) => t.classList.add('is-visible'));
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-visible');
            io.unobserve(entry.target);
          }
        }
      },
      { threshold: 0.15, rootMargin: '0px 0px -40px 0px' },
    );
    targets.forEach((t) => io.observe(t));
    return () => io.disconnect();
  }, [root]);
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

/** How quickly smoothed values catch up with the real scroll position. Higher = heavier. */
const GLIDE_MS = 130;

/** Sunrise progress at which the sun has reached the nav. */
const DAWN_AT = 0.6;

/**
 * The scroll engine: writes each `[data-scene]` element's progress through
 * its pinned range into `--p` (0–1), plus `--page-p` and a scroll-velocity
 * `--v` on `root`. Everything that moves with scroll is plain CSS `calc()` on
 * those variables, so no component re-renders while scrolling.
 *
 * Values glide toward the real position rather than jumping with each wheel
 * notch; the loop runs only until they settle. Scene offsets are measured up
 * front and on resize, so a scroll frame never reads layout.
 */
export function useScenes(root: React.RefObject<HTMLElement | null>) {
  React.useEffect(() => {
    const el = root.current;
    if (!el) return;
    const glide = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const scenes = Array.from(el.querySelectorAll<HTMLElement>('[data-scene]')).map((node) => ({
      node,
      top: 0,
      range: 0,
      p: 0,
      written: '',
    }));
    let pageRange = 1;
    let pageP = 0;
    let velocity = 0;
    let lastY = window.scrollY;
    let lastTime = 0;
    let frame = 0;

    const measure = () => {
      const vh = window.innerHeight;
      for (const scene of scenes) {
        const rect = scene.node.getBoundingClientRect();
        scene.top = rect.top + window.scrollY;
        scene.range = rect.height - vh;
      }
      pageRange = Math.max(1, document.documentElement.scrollHeight - vh);
    };

    const tick = (time: number) => {
      frame = 0;
      const dt = lastTime ? Math.min(time - lastTime, 50) : 16;
      lastTime = time;
      const k = glide ? 1 - Math.exp(-dt / GLIDE_MS) : 1;
      const y = window.scrollY;
      let moving = false;

      for (const scene of scenes) {
        // A scene that isn't pinned (reduced motion) is simply before or after the viewport top.
        const target = scene.range > 0 ? clamp01((y - scene.top) / scene.range) : y >= scene.top ? 1 : 0;
        const gap = target - scene.p;
        if (Math.abs(gap) > 0.0004) moving = true;
        scene.p = Math.abs(gap) > 0.0004 ? scene.p + gap * k : target;
        const value = scene.p.toFixed(4);
        if (value !== scene.written) {
          scene.node.style.setProperty('--p', value);
          scene.written = value;
        }
        if (scene.node.dataset.scene === 'sunrise') {
          el.style.setProperty('--sun', value);
          el.toggleAttribute('data-dawn', scene.p > DAWN_AT);
        }
      }

      const pageGap = clamp01(y / pageRange) - pageP;
      if (Math.abs(pageGap) > 0.0004) moving = true;
      pageP += pageGap * k;
      el.style.setProperty('--page-p', pageP.toFixed(4));

      velocity += (Math.max(-1, Math.min(1, (y - lastY) / 50)) - velocity) * k;
      lastY = y;
      if (Math.abs(velocity) > 0.002) moving = true;
      el.style.setProperty('--v', velocity.toFixed(3));

      if (moving) frame = requestAnimationFrame(tick);
      else lastTime = 0;
    };
    const wake = () => {
      if (!frame) frame = requestAnimationFrame(tick);
    };
    const remeasure = () => {
      measure();
      wake();
    };

    measure();
    wake();
    const sizes = new ResizeObserver(remeasure);
    sizes.observe(el);
    window.addEventListener('scroll', wake, { passive: true });
    window.addEventListener('resize', remeasure);
    return () => {
      sizes.disconnect();
      window.removeEventListener('scroll', wake);
      window.removeEventListener('resize', remeasure);
      cancelAnimationFrame(frame);
    };
  }, [root]);
}

/** Card tilt + spotlight: writes the cursor position into `--mx`/`--my` and a tilt into `--rx`/`--ry`. */
export function trackPointer(e: React.PointerEvent<HTMLElement>) {
  const rect = e.currentTarget.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;
  const { style } = e.currentTarget;
  style.setProperty('--mx', `${x}px`);
  style.setProperty('--my', `${y}px`);
  style.setProperty('--rx', `${(0.5 - y / rect.height) * 7}deg`);
  style.setProperty('--ry', `${(x / rect.width - 0.5) * 7}deg`);
}

export function resetPointer(e: React.PointerEvent<HTMLElement>) {
  e.currentTarget.style.setProperty('--rx', '0deg');
  e.currentTarget.style.setProperty('--ry', '0deg');
}

/** Magnetic button: drifts toward the cursor while hovered. */
export function magnet(e: React.PointerEvent<HTMLElement>) {
  const rect = e.currentTarget.getBoundingClientRect();
  const x = (e.clientX - rect.left - rect.width / 2) * 0.25;
  const y = (e.clientY - rect.top - rect.height / 2) * 0.35;
  e.currentTarget.style.transform = `translate(${x}px, ${y}px)`;
}

export function magnetOff(e: React.PointerEvent<HTMLElement>) {
  e.currentTarget.style.transform = '';
}
