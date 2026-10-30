import * as React from 'react';
import { loadOrgLayout, saveOrgLayout, type Offsets, type SavedLayout } from '@/lib/org-layout';
import { contentScale, freeShift, type Box } from './spacing';

/** Pointer travel (px) before a press counts as a drag rather than a click. */
const DRAG_THRESHOLD = 4;
/** Slide animation length; keep in step with `.org-settling` in index.css. */
const SETTLE_MS = 320;

/**
 * Lets people drag org-chart cards around. A card with no team moves alone; a
 * manager takes their whole team with them (their `<li>` is what moves).
 * Positions are offsets from the automatic layout, kept for the login session.
 *
 * Cards never overlap: on drop — and after the chart re-lays-out (expand,
 * collapse, focus) — any moved card sitting on another is slid, animated, to
 * the nearest free spot. `subscribe` lets the link lines redraw every frame.
 */
const NO_OFFSETS: Offsets = {};

export function useNodeDrag({
  storageKey,
  signature,
  contentRef,
  onDragStart,
}: {
  storageKey: string | null;
  /** Fingerprint of the chart structure; saved positions are dropped if it has changed. */
  signature: string | null;
  contentRef: React.RefObject<HTMLDivElement | null>;
  onDragStart?: () => void;
}) {
  const [saved, setSaved] = React.useState<SavedLayout>(() => loadOrgLayout(storageKey));
  // Positions made against a different structure would throw cards all over the place.
  const offsets = !signature || saved.sig === signature ? saved.offsets : NO_OFFSETS;
  const offsetsRef = React.useRef(offsets);
  const listeners = React.useRef(new Set<() => void>());
  const draggedRef = React.useRef(false);
  const activeRef = React.useRef(false);
  const onDragStartRef = React.useRef(onDragStart);

  React.useEffect(() => {
    onDragStartRef.current = onDragStart;
  }, [onDragStart]);

  React.useEffect(() => {
    offsetsRef.current = offsets;
  }, [offsets]);

  React.useEffect(() => {
    saveOrgLayout(storageKey, saved);
  }, [storageKey, saved]);

  const commit = React.useCallback(
    (next: Offsets) => {
      offsetsRef.current = next;
      setSaved({ sig: signature, offsets: next });
    },
    [signature],
  );

  const notify = React.useCallback(() => listeners.current.forEach((fn) => fn()), []);
  const subscribe = React.useCallback((fn: () => void) => {
    listeners.current.add(fn);
    return () => {
      listeners.current.delete(fn);
    };
  }, []);

  /** Redraw the links every frame while a slide animation runs, then run `done`. */
  const frames = React.useCallback(
    (done?: () => void) => {
      const t0 = performance.now();
      const loop = () => {
        notify();
        if (performance.now() - t0 < SETTLE_MS + 60) requestAnimationFrame(loop);
        else done?.();
      };
      requestAnimationFrame(loop);
    },
    [notify],
  );

  /** Slide each of `ids` (moved cards/teams) clear of every other card. */
  const resolve = React.useCallback(
    (ids: string[]) => {
      const content = contentRef.current;
      if (!content) return;
      const origin = content.getBoundingClientRect();
      const s = contentScale(content);
      const cards = new Map<string, Box>();
      content.querySelectorAll<HTMLElement>('[data-org-card]').forEach((el) => {
        const r = el.getBoundingClientRect();
        cards.set(el.dataset.orgCard!, {
          l: (r.left - origin.left) / s,
          t: (r.top - origin.top) / s,
          r: (r.right - origin.left) / s,
          b: (r.bottom - origin.top) / s,
        });
      });

      const next = { ...offsetsRef.current };
      const slid: HTMLElement[] = [];
      const depth = (el: Element) => {
        let n = 0;
        for (let p = el.parentElement; p; p = p.parentElement) if (p.hasAttribute('data-org-move')) n++;
        return n;
      };
      const movers = ids
        .map((id) => content.querySelector<HTMLElement>(`[data-org-move="${CSS.escape(id)}"]`))
        .filter((el): el is HTMLElement => !!el)
        .sort((a, b) => depth(a) - depth(b));

      for (const move of movers) {
        const unitIds = new Set<string>();
        if (move.hasAttribute('data-org-card')) unitIds.add(move.dataset.orgCard!);
        move.querySelectorAll<HTMLElement>('[data-org-card]').forEach((el) => unitIds.add(el.dataset.orgCard!));
        const unit = [...unitIds].flatMap((i) => cards.get(i) ?? []);
        const others = [...cards].filter(([i]) => !unitIds.has(i)).map(([, b]) => b);
        const d = freeShift(unit, others);
        if (!d || (d.x === 0 && d.y === 0)) continue;
        for (const i of unitIds) {
          const b = cards.get(i);
          if (b) cards.set(i, { l: b.l + d.x, t: b.t + d.y, r: b.r + d.x, b: b.b + d.y });
        }
        const id = move.dataset.orgMove!;
        const cur = next[id] ?? { x: 0, y: 0 };
        next[id] = { x: cur.x + d.x, y: cur.y + d.y };
        slid.push(move);
      }
      if (slid.length === 0) return;
      slid.forEach((el) => el.classList.add('org-settling'));
      commit(next);
      frames(() => slid.forEach((el) => el.classList.remove('org-settling')));
    },
    [contentRef, commit, frames],
  );

  /** Check every moved card against the others (after the chart re-laid out). */
  const settle = React.useCallback(() => {
    const ids = Object.keys(offsetsRef.current);
    if (ids.length) resolve(ids);
  }, [resolve]);

  const begin = React.useCallback(
    (e: React.PointerEvent<HTMLElement>, id: string) => {
      if (e.button !== 0) return;
      const content = contentRef.current;
      const move = e.currentTarget.closest<HTMLElement>('[data-org-move]');
      if (!content || !move) return;
      draggedRef.current = false;
      const base = offsetsRef.current[id] ?? { x: 0, y: 0 };
      const sx = e.clientX;
      const sy = e.clientY;
      let dx = 0;
      let dy = 0;

      const onMove = (ev: PointerEvent) => {
        if (!draggedRef.current) {
          if (Math.hypot(ev.clientX - sx, ev.clientY - sy) < DRAG_THRESHOLD) return;
          draggedRef.current = true;
          activeRef.current = true;
          move.classList.add('org-dragging');
          onDragStartRef.current?.();
        }
        const s = contentScale(content);
        dx = (ev.clientX - sx) / s;
        dy = (ev.clientY - sy) / s;
        move.style.transform = `translate(${base.x + dx}px, ${base.y + dy}px)`;
        notify();
      };
      const onUp = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onUp);
        activeRef.current = false;
        if (draggedRef.current) {
          move.classList.remove('org-dragging');
          commit({ ...offsetsRef.current, [id]: { x: base.x + dx, y: base.y + dy } });
          resolve([id]);
        }
        // Let the click that follows a drag be swallowed, then re-arm.
        window.setTimeout(() => {
          draggedRef.current = false;
        }, 0);
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onUp);
    },
    [contentRef, commit, notify, resolve],
  );

  /** Put every card back in its automatic slot, animated. */
  const reset = React.useCallback(() => {
    const content = contentRef.current;
    const moved = content ? [...content.querySelectorAll<HTMLElement>('[data-org-moved]')] : [];
    moved.forEach((el) => el.classList.add('org-settling'));
    commit({});
    frames(() => moved.forEach((el) => el.classList.remove('org-settling')));
  }, [contentRef, commit, frames]);

  return {
    offsets,
    begin,
    reset,
    settle,
    subscribe,
    wasDragging: () => draggedRef.current,
    isDragging: () => activeRef.current,
  };
}
