import * as React from 'react';

const MIN_SCALE = 0.25;
const MAX_SCALE = 1.6;
const PAD = 32;
/** Pointer travel (px) before a press counts as a drag rather than a click. */
const DRAG_THRESHOLD = 4;

interface View {
  x: number;
  y: number;
  scale: number;
}

const clamp = (n: number, lo: number, hi: number) => Math.min(Math.max(n, lo), hi);

/**
 * Pan/zoom for the org-chart canvas: a CSS transform on `contentRef` inside
 * the clipping `viewportRef`. Drag the background pans (cards drag themselves); the
 * wheel pans, Ctrl/⌘+wheel (and trackpad pinch, which browsers report as
 * ctrl+wheel) zooms around the pointer. Programmatic moves (buttons, fit,
 * centring on a search hit) animate; direct manipulation doesn't.
 */
export function usePanZoom({ onInteract }: { onInteract?: () => void } = {}) {
  const viewportRef = React.useRef<HTMLDivElement>(null);
  const contentRef = React.useRef<HTMLDivElement>(null);
  const [view, setView] = React.useState<View>({ x: 0, y: 0, scale: 1 });
  const [animate, setAnimate] = React.useState(false);
  const [dragging, setDragging] = React.useState(false);
  const viewRef = React.useRef(view);
  const draggedRef = React.useRef(false);
  const onInteractRef = React.useRef(onInteract);

  React.useEffect(() => {
    onInteractRef.current = onInteract;
  }, [onInteract]);

  const apply = React.useCallback((next: View, animated: boolean) => {
    setAnimate(animated);
    viewRef.current = next;
    setView(next);
  }, []);

  const zoomAt = React.useCallback(
    (factor: number, px?: number, py?: number, animated = true) => {
      const vp = viewportRef.current;
      if (!vp) return;
      const v = viewRef.current;
      const cx = px ?? vp.clientWidth / 2;
      const cy = py ?? vp.clientHeight / 2;
      const scale = clamp(v.scale * factor, MIN_SCALE, MAX_SCALE);
      const k = scale / v.scale;
      apply({ scale, x: cx - (cx - v.x) * k, y: cy - (cy - v.y) * k }, animated);
    },
    [apply],
  );

  /** Fit the whole chart; never upscales past 100%, never below `minScale`. */
  const fit = React.useCallback(
    (minScale = MIN_SCALE) => {
      const vp = viewportRef.current;
      const content = contentRef.current;
      if (!vp || !content) return;
      // The content box plus every card — dragged cards can sit outside it.
      const origin = content.getBoundingClientRect();
      const s = content.offsetWidth ? origin.width / content.offsetWidth : 1;
      let minX = 0;
      let minY = 0;
      let maxX = content.offsetWidth;
      let maxY = content.offsetHeight;
      content.querySelectorAll('[data-org-card]').forEach((el) => {
        const r = el.getBoundingClientRect();
        minX = Math.min(minX, (r.left - origin.left) / s);
        minY = Math.min(minY, (r.top - origin.top) / s);
        maxX = Math.max(maxX, (r.right - origin.left) / s);
        maxY = Math.max(maxY, (r.bottom - origin.top) / s);
      });
      const w = maxX - minX;
      const h = maxY - minY;
      const vw = vp.clientWidth;
      const vh = vp.clientHeight;
      const scale = clamp(
        Math.min((vw - PAD * 2) / w, (vh - PAD * 2) / h, 1),
        Math.max(minScale, MIN_SCALE),
        1,
      );
      apply({ scale, x: (vw - w * scale) / 2 - minX * scale, y: PAD - minY * scale }, true);
    },
    [apply],
  );

  /** Pan so the node card `[data-org-node=id]` sits centred, a third of the way down. */
  const centerOn = React.useCallback(
    (id: string) => {
      const vp = viewportRef.current;
      const content = contentRef.current;
      const el = content?.querySelector<HTMLElement>(`[data-org-node="${CSS.escape(id)}"]`);
      if (!vp || !content || !el) return;
      const v = viewRef.current;
      const c = content.getBoundingClientRect();
      const r = el.getBoundingClientRect();
      const cx = (r.left - c.left + r.width / 2) / v.scale;
      const cy = (r.top - c.top + r.height / 2) / v.scale;
      const scale = Math.max(v.scale, 0.85);
      apply(
        { scale, x: vp.clientWidth / 2 - cx * scale, y: vp.clientHeight / 3 - cy * scale },
        true,
      );
    },
    [apply],
  );

  const onPointerDown = React.useCallback(
    (e: React.PointerEvent) => {
      if (e.button !== 0) return;
      draggedRef.current = false;
      // A press on a card drags the card (see use-node-drag), not the canvas.
      if ((e.target as HTMLElement).closest('[data-org-node]')) return;
      const startX = e.clientX;
      const startY = e.clientY;
      const origin = viewRef.current;

      const move = (ev: PointerEvent) => {
        const dx = ev.clientX - startX;
        const dy = ev.clientY - startY;
        if (!draggedRef.current) {
          if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
          draggedRef.current = true;
          setDragging(true);
          onInteractRef.current?.();
        }
        apply({ ...origin, x: origin.x + dx, y: origin.y + dy }, false);
      };
      const up = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        window.removeEventListener('pointercancel', up);
        setDragging(false);
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
      window.addEventListener('pointercancel', up);
    },
    [apply],
  );

  // Wheel needs a non-passive native listener to be able to preventDefault.
  React.useEffect(() => {
    const vp = viewportRef.current;
    if (!vp) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      onInteractRef.current?.();
      if (e.ctrlKey || e.metaKey) {
        const rect = vp.getBoundingClientRect();
        zoomAt(Math.exp(-e.deltaY * 0.0025), e.clientX - rect.left, e.clientY - rect.top, false);
      } else {
        const v = viewRef.current;
        apply({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY }, false);
      }
    };
    vp.addEventListener('wheel', onWheel, { passive: false });
    return () => vp.removeEventListener('wheel', onWheel);
  }, [apply, zoomAt]);

  const wasDragging = React.useCallback(() => draggedRef.current, []);

  const contentStyle: React.CSSProperties = {
    transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`,
    transformOrigin: '0 0',
    transition: animate ? 'transform 260ms cubic-bezier(0.2, 0.8, 0.2, 1)' : undefined,
  };

  return {
    viewportRef,
    contentRef,
    scale: view.scale,
    dragging,
    contentStyle,
    onPointerDown,
    wasDragging,
    zoomIn: () => zoomAt(1.2),
    zoomOut: () => zoomAt(1 / 1.2),
    resetZoom: () => zoomAt(1 / viewRef.current.scale),
    fit,
    centerOn,
  };
}
