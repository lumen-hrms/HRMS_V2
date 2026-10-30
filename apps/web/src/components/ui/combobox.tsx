import * as React from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, Search } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface ComboboxOption {
  value: string;
  label: string;
  /** Muted second line, e.g. a job title. */
  description?: string;
}

const PANEL_MAX_H = 288;
const GAP = 4;

const initialsOf = (label: string) =>
  label
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase();

/**
 * Searchable single-select: a trigger styled like <Select>, and a popover with
 * a search box over a scrollable list (arrow keys / Enter / Escape). The list
 * is portalled and fixed-positioned so a scrolling dialog can't clip it, and it
 * flips upward near the bottom of the screen. Options are shown in the order
 * given — sort them before passing them in.
 */
export function Combobox({
  value,
  onChange,
  options,
  placeholder = 'Select…',
  searchPlaceholder = 'Search…',
  clearLabel,
  disabled,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  options: ComboboxOption[];
  placeholder?: string;
  searchPlaceholder?: string;
  /** When set, a first row with this label (e.g. "None") clears the value to ''. */
  clearLabel?: string;
  disabled?: boolean;
  className?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState('');
  const [active, setActive] = React.useState(0);
  const [pos, setPos] = React.useState<{ left: number; width: number; top?: number; bottom?: number }>({
    left: 0,
    width: 0,
  });
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const panelRef = React.useRef<HTMLDivElement>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const listId = React.useId();

  const selected = options.find((o) => o.value === value);

  const rows = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    const found = q
      ? options.filter((o) => `${o.label} ${o.description ?? ''}`.toLowerCase().includes(q))
      : options;
    return clearLabel && !q ? [{ value: '', label: clearLabel } as ComboboxOption, ...found] : found;
  }, [options, query, clearLabel]);

  const place = React.useCallback(() => {
    const r = triggerRef.current?.getBoundingClientRect();
    if (!r) return;
    const below = window.innerHeight - r.bottom;
    const flip = below < PANEL_MAX_H && r.top > below;
    setPos(
      flip
        ? { left: r.left, width: r.width, bottom: window.innerHeight - r.top + GAP }
        : { left: r.left, width: r.width, top: r.bottom + GAP },
    );
  }, []);

  function show() {
    if (disabled) return;
    place();
    setQuery('');
    setActive(Math.max(0, rows.findIndex((o) => o.value === value)));
    setOpen(true);
  }

  function close(refocus = false) {
    setOpen(false);
    if (refocus) triggerRef.current?.focus();
  }

  function pick(o: ComboboxOption) {
    onChange(o.value);
    close(true);
  }

  // While open: follow the trigger on scroll/resize, close on an outside press.
  React.useEffect(() => {
    if (!open) return;
    const onPress = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!triggerRef.current?.contains(t) && !panelRef.current?.contains(t)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPress);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      document.removeEventListener('pointerdown', onPress);
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open, place]);

  React.useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  React.useEffect(() => {
    if (!open) return;
    panelRef.current?.querySelector<HTMLElement>(`[data-row="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [open, active]);

  function onSearchKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!rows.length) return;
      setActive((a) => (e.key === 'ArrowDown' ? (a + 1) % rows.length : (a - 1 + rows.length) % rows.length));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (rows[active]) pick(rows[active]);
    } else if (e.key === 'Escape') {
      // Close just the list — not the dialog this sits in.
      e.stopPropagation();
      close(true);
    } else if (e.key === 'Tab') {
      setOpen(false);
    }
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        onClick={() => (open ? close() : show())}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' && !open) {
            e.preventDefault();
            show();
          }
        }}
        className={cn(
          'flex h-9 w-full items-center gap-2 rounded-md border border-input bg-card px-3 py-1 text-left text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50',
          open && 'ring-2 ring-ring',
          className,
        )}
      >
        {selected ? (
          <span className="flex min-w-0 flex-1 items-baseline gap-2">
            <span className="truncate">{selected.label}</span>
            {selected.description && (
              <span className="truncate text-xs text-muted-foreground">{selected.description}</span>
            )}
          </span>
        ) : (
          <span className="flex-1 truncate text-muted-foreground">{clearLabel && !value ? clearLabel : placeholder}</span>
        )}
        <ChevronDown className={cn('h-4 w-4 shrink-0 text-muted-foreground transition-transform', open && 'rotate-180')} />
      </button>

      {open &&
        createPortal(
          <div
            ref={panelRef}
            style={{ position: 'fixed', ...pos, maxHeight: PANEL_MAX_H }}
            className="z-[60] flex flex-col overflow-hidden rounded-lg border border-border bg-card text-card-foreground shadow-lg"
          >
            <div className="relative border-b border-border">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setActive(0);
                }}
                onKeyDown={onSearchKeyDown}
                placeholder={searchPlaceholder}
                aria-label={searchPlaceholder}
                role="combobox"
                aria-expanded="true"
                aria-controls={listId}
                aria-activedescendant={rows[active] ? `${listId}-${active}` : undefined}
                className="h-10 w-full bg-transparent pl-9 pr-3 text-sm placeholder:text-muted-foreground focus-visible:outline-none"
              />
            </div>
            <div id={listId} role="listbox" className="overflow-y-auto p-1">
              {rows.length === 0 ? (
                <p className="px-3 py-3 text-sm text-muted-foreground">No match for “{query.trim()}”.</p>
              ) : (
                rows.map((o, i) => (
                  <button
                    key={o.value || '__none'}
                    id={`${listId}-${i}`}
                    data-row={i}
                    type="button"
                    role="option"
                    aria-selected={o.value === value}
                    onMouseDown={(e) => e.preventDefault()}
                    onMouseEnter={() => setActive(i)}
                    onClick={() => pick(o)}
                    className={cn(
                      'flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left',
                      i === active && 'bg-accent',
                    )}
                  >
                    {o.value ? (
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-semibold text-muted-foreground">
                        {initialsOf(o.label)}
                      </span>
                    ) : (
                      <span className="h-7 w-7 shrink-0" />
                    )}
                    <span className="min-w-0 flex-1">
                      <span className={cn('block truncate text-sm', !o.value && 'text-muted-foreground')}>{o.label}</span>
                      {o.description && (
                        <span className="block truncate text-xs text-muted-foreground">{o.description}</span>
                      )}
                    </span>
                    {o.value === value && <Check className="h-4 w-4 shrink-0 text-primary" />}
                  </button>
                ))
              )}
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
