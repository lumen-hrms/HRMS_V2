import * as React from 'react';
import type { OrgNode } from './model';

const OPEN_DELAY = 350;
const CLOSE_DELAY = 160;

export interface HoverTarget {
  node: OrgNode;
  anchor: HTMLElement;
}

/**
 * Hover-intent state for the person card: a short open delay so sweeping the
 * mouse across the chart doesn't flash cards, and a close delay so the
 * pointer can travel from the node onto the card itself.
 */
export function useHoverCard() {
  const [target, setTarget] = React.useState<HoverTarget | null>(null);
  const openTimer = React.useRef<number | undefined>(undefined);
  const closeTimer = React.useRef<number | undefined>(undefined);

  const clear = () => {
    window.clearTimeout(openTimer.current);
    window.clearTimeout(closeTimer.current);
  };

  const show = React.useCallback((node: OrgNode, anchor: HTMLElement, immediate = false) => {
    clear();
    if (immediate) setTarget({ node, anchor });
    else openTimer.current = window.setTimeout(() => setTarget({ node, anchor }), OPEN_DELAY);
  }, []);

  const hide = React.useCallback(() => {
    window.clearTimeout(openTimer.current);
    window.clearTimeout(closeTimer.current);
    closeTimer.current = window.setTimeout(() => setTarget(null), CLOSE_DELAY);
  }, []);

  const hideNow = React.useCallback(() => {
    clear();
    setTarget(null);
  }, []);

  const keepOpen = React.useCallback(() => window.clearTimeout(closeTimer.current), []);

  React.useEffect(() => clear, []);

  return { target, show, hide, hideNow, keepOpen };
}
