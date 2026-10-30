import * as React from 'react';
import type { OrgEdge } from './model';
import { contentScale, type Box } from './spacing';

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Parent bottom-centre → child top-centre: a rounded elbow, or an S-curve when the child sits at/above the parent. */
function linkPath(from: Box, to: Box) {
  const x1 = (from.l + from.r) / 2;
  const y1 = from.b;
  const x2 = (to.l + to.r) / 2;
  const y2 = to.t;
  const dx = x2 - x1;
  const dy = y2 - y1;
  if (Math.abs(dx) < 1 && dy > 0) return `M${x1} ${y1}V${y2}`;
  if (dy < 36) {
    const k = Math.max(48, Math.abs(dy) / 2 + 24);
    return `M${x1} ${y1}C${x1} ${y1 + k} ${x2} ${y2 - k} ${x2} ${y2}`;
  }
  const my = (y1 + y2) / 2;
  const r = Math.min(10, Math.abs(dx) / 2, my - y1, y2 - my);
  const sg = Math.sign(dx);
  return `M${x1} ${y1}V${my - r}Q${x1} ${my} ${x1 + sg * r} ${my}H${x2 - sg * r}Q${x2} ${my} ${x2} ${my + r}V${y2}`;
}

/**
 * The connector lines. Drawn from the cards' real on-screen rectangles, so
 * they stay attached to cards that were dragged away from their slot. Paths
 * are written straight into the SVG (no React state) so dragging stays smooth;
 * `subscribe` lets the drag hook ask for a redraw on every frame.
 */
export function OrgLinks({
  contentRef,
  edges,
  subscribe,
}: {
  contentRef: React.RefObject<HTMLDivElement | null>;
  edges: OrgEdge[];
  subscribe: (fn: () => void) => () => void;
}) {
  const svgRef = React.useRef<SVGSVGElement>(null);

  const draw = React.useCallback(() => {
    const content = contentRef.current;
    const svg = svgRef.current;
    if (!content || !svg) return;
    const origin = content.getBoundingClientRect();
    const s = contentScale(content);
    const boxOf = (el: Element): Box => {
      const r = el.getBoundingClientRect();
      return {
        l: (r.left - origin.left) / s,
        t: (r.top - origin.top) / s,
        r: (r.right - origin.left) / s,
        b: (r.bottom - origin.top) / s,
      };
    };
    const cards = new Map<string, Box>();
    content.querySelectorAll<HTMLElement>('[data-org-card]').forEach((el) => cards.set(el.dataset.orgCard!, boxOf(el)));
    const groups = new Map<string, Box>();
    content.querySelectorAll<HTMLElement>('[data-org-group]').forEach((el) => groups.set(el.dataset.orgGroup!, boxOf(el)));

    const paths = edges.flatMap((e) => {
      const from = cards.get(e.from);
      const to = (e.kind === 'group' ? groups : cards).get(e.to);
      if (!from || !to) return [];
      const path = document.createElementNS(SVG_NS, 'path');
      path.setAttribute('d', linkPath(from, to));
      path.setAttribute('fill', 'none');
      path.setAttribute('stroke-width', '1.5');
      path.style.stroke = 'var(--org-line)';
      if (e.dashed) path.setAttribute('stroke-dasharray', '6 5');
      return [path];
    });
    svg.replaceChildren(...paths);
  }, [contentRef, edges]);

  React.useLayoutEffect(() => {
    draw();
    return subscribe(draw);
  }, [draw, subscribe]);

  React.useEffect(() => {
    const content = contentRef.current;
    if (!content) return;
    const ro = new ResizeObserver(draw);
    ro.observe(content);
    return () => ro.disconnect();
  }, [contentRef, draw]);

  return (
    <svg
      ref={svgRef}
      aria-hidden="true"
      width="1"
      height="1"
      className="pointer-events-none absolute left-0 top-0 overflow-visible"
    />
  );
}
