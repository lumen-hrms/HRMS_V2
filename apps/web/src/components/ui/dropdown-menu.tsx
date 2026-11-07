import * as React from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/utils';

/**
 * Lightweight dropdown menu for row / kebab actions. Click trigger to toggle;
 * closes on outside click, Escape, scroll/resize, or item selection. The menu
 * is portalled to <body> and positioned with `fixed` from the trigger's rect,
 * so a table's `overflow-x-auto` / a card's `overflow-hidden` can't clip it. It
 * flips above the trigger when there isn't room below, and is clamped inside
 * the viewport so it never runs off a phone screen.
 */
export function DropdownMenu({
  trigger,
  children,
  align = 'end',
  className,
}: {
  trigger: React.ReactNode;
  children: React.ReactNode;
  align?: 'start' | 'end';
  className?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const [pos, setPos] = React.useState<React.CSSProperties | null>(null);
  const ref = React.useRef<HTMLDivElement>(null);
  const menuRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!open) return;
    function onDown(e: Event) {
      const t = e.target as Node;
      if (ref.current?.contains(t) || menuRef.current?.contains(t)) return;
      setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    const close = () => setOpen(false);
    // Scrolling the menu's own list must not dismiss it.
    const onScroll = (e: Event) => {
      if (!menuRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('touchstart', onDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', close);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('touchstart', onDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', close);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [open]);

  // Place the menu once it has been measured (before paint, so it never flashes
  // in the wrong spot).
  React.useLayoutEffect(() => {
    if (!open || !ref.current || !menuRef.current) return;
    const t = ref.current.getBoundingClientRect();
    const m = menuRef.current.getBoundingClientRect();
    const gap = 4;
    const edge = 8;
    const below = window.innerHeight - t.bottom - gap - edge;
    const above = t.top - gap - edge;
    const flip = m.height > below && above > below;
    const room = flip ? above : below;
    let left = align === 'end' ? t.right - m.width : t.left;
    left = Math.max(edge, Math.min(left, window.innerWidth - m.width - edge));
    setPos({
      left,
      top: flip ? Math.max(edge, t.top - gap - Math.min(m.height, room)) : t.bottom + gap,
      maxHeight: room,
    });
  }, [open, align]);

  return (
    <div ref={ref} className="relative inline-block">
      <button
        type="button"
        onClick={() => {
          setPos(null);
          setOpen((v) => !v);
        }}
        className="inline-flex"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        {trigger}
      </button>
      {open &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            onClick={() => setOpen(false)}
            style={{ position: 'fixed', ...(pos ?? { left: 0, top: 0, visibility: 'hidden' }) }}
            className={cn('z-[60] min-w-40 max-w-[calc(100vw-1rem)] overflow-y-auto glass-strong rounded-xl p-1', className)}
          >
            {children}
          </div>,
          document.body,
        )}
    </div>
  );
}

export function DropdownMenuItem({
  className,
  destructive,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { destructive?: boolean }) {
  return (
    <button
      type="button"
      role="menuitem"
      className={cn(
        'flex w-full items-center gap-2 rounded-xl px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent disabled:pointer-events-none disabled:opacity-50',
        destructive && 'text-destructive hover:bg-destructive/10',
        className,
      )}
      {...props}
    />
  );
}

export function DropdownMenuSeparator() {
  return <div className="my-1 h-px bg-border" />;
}
