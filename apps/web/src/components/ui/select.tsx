import * as React from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Opt {
  value: string;
  label: React.ReactNode;
  text: string;
  disabled: boolean;
}

const PANEL_MAX_H = 288;
const GAP = 4;

/** Plain text of a node, for typeahead and for the closed trigger. */
function textOf(node: React.ReactNode): string {
  if (node == null || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  if (React.isValidElement<{ children?: React.ReactNode }>(node)) return textOf(node.props.children);
  return '';
}

/** Flattens <option> children (arrays, fragments, mapped lists) into options. */
function collect(children: React.ReactNode, out: Opt[] = []): Opt[] {
  React.Children.forEach(children, (child) => {
    if (!React.isValidElement<{ value?: unknown; disabled?: boolean; children?: React.ReactNode }>(child)) return;
    if (child.type === React.Fragment) {
      collect(child.props.children, out);
    } else if (child.type === 'option') {
      const text = textOf(child.props.children);
      out.push({
        value: child.props.value == null ? text : String(child.props.value),
        label: child.props.children,
        text,
        disabled: !!child.props.disabled,
      });
    }
  });
  return out;
}

type SelectProps = Pick<
  React.SelectHTMLAttributes<HTMLSelectElement>,
  | 'className'
  | 'children'
  | 'value'
  | 'defaultValue'
  | 'disabled'
  | 'id'
  | 'name'
  | 'required'
  | 'title'
  | 'aria-label'
  | 'aria-labelledby'
  | 'aria-describedby'
  | 'aria-invalid'
> & {
  /** Receives a change-event-shaped object, so existing `e.target.value` handlers keep working. */
  onChange?: (e: React.ChangeEvent<HTMLSelectElement>) => void;
};

/**
 * Themed single-select. Same call shape as a native <select> (children are
 * <option>s, `onChange(e)` reads `e.target.value`), but the list is our own
 * popover so it matches the app in both themes instead of the browser's
 * default menu. Keyboard: Arrow/Home/End, Enter/Space, Escape, type-to-jump.
 * The panel is portalled and fixed-positioned so a scrolling dialog can't
 * clip it, and it flips upward near the bottom of the screen.
 */
export const Select = React.forwardRef<HTMLButtonElement, SelectProps>(
  (
    { className, children, value, defaultValue, onChange, disabled, id, name, required, ...aria },
    forwardedRef,
  ) => {
    const options = React.useMemo(() => collect(children), [children]);
    const [inner, setInner] = React.useState(() =>
      defaultValue == null ? '' : String(Array.isArray(defaultValue) ? defaultValue[0] : defaultValue),
    );
    const controlled = value !== undefined;
    const current = controlled ? String(Array.isArray(value) ? value[0] : value) : inner;

    const [open, setOpen] = React.useState(false);
    const [active, setActive] = React.useState(0);
    const [pos, setPos] = React.useState<{ left: number; width: number; top?: number; bottom?: number }>({
      left: 0,
      width: 0,
    });
    const triggerRef = React.useRef<HTMLButtonElement | null>(null);
    const panelRef = React.useRef<HTMLDivElement>(null);
    const typed = React.useRef({ text: '', at: 0 });
    const listId = React.useId();

    const setRefs = React.useCallback(
      (node: HTMLButtonElement | null) => {
        triggerRef.current = node;
        if (typeof forwardedRef === 'function') forwardedRef(node);
        else if (forwardedRef) forwardedRef.current = node;
      },
      [forwardedRef],
    );

    const selectedIndex = options.findIndex((o) => o.value === current);
    const selected = options[selectedIndex];

    const place = React.useCallback(() => {
      const r = triggerRef.current?.getBoundingClientRect();
      if (!r) return;
      const below = window.innerHeight - r.bottom;
      const flip = below < PANEL_MAX_H && r.top > below;
      const width = Math.max(r.width, 160);
      const left = Math.min(r.left, Math.max(8, window.innerWidth - width - 8));
      setPos(
        flip
          ? { left, width, bottom: window.innerHeight - r.top + GAP }
          : { left, width, top: r.bottom + GAP },
      );
    }, []);

    function show() {
      if (disabled || !options.length) return;
      place();
      setActive(Math.max(0, selectedIndex));
      setOpen(true);
    }

    function close(refocus = false) {
      setOpen(false);
      if (refocus) triggerRef.current?.focus();
    }

    function pick(o: Opt) {
      if (o.disabled) return;
      if (!controlled) setInner(o.value);
      if (o.value !== current) {
        const target = { value: o.value, name: name ?? '', id: id ?? '' };
        onChange?.({ target, currentTarget: target } as unknown as React.ChangeEvent<HTMLSelectElement>);
      }
      close(true);
    }

    function move(from: number, step: 1 | -1) {
      for (let i = 1; i <= options.length; i++) {
        const next = (from + step * i + options.length * i) % options.length;
        if (!options[next].disabled) return next;
      }
      return from;
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
      if (!open) return;
      panelRef.current?.focus({ preventScroll: true });
    }, [open]);

    React.useEffect(() => {
      if (!open) return;
      panelRef.current?.querySelector<HTMLElement>(`[data-row="${active}"]`)?.scrollIntoView({ block: 'nearest' });
    }, [open, active]);

    function onTypeahead(key: string) {
      const now = Date.now();
      const t = typed.current;
      t.text = now - t.at > 600 ? key : t.text + key;
      t.at = now;
      const q = t.text.toLowerCase();
      const from = open ? active : Math.max(0, selectedIndex);
      const hit = options.findIndex(
        (o, i) => !o.disabled && o.text.toLowerCase().startsWith(q) && (q.length > 1 || i !== from),
      );
      if (hit >= 0) {
        if (open) setActive(hit);
        else pick(options[hit]);
      }
    }

    function onKeyDown(e: React.KeyboardEvent) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        if (!open) return show();
        setActive((a) => move(a, e.key === 'ArrowDown' ? 1 : -1));
      } else if (e.key === 'Home' || e.key === 'End') {
        if (!open) return;
        e.preventDefault();
        setActive(e.key === 'Home' ? move(-1, 1) : move(0, -1));
      } else if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        if (!open) return show();
        if (options[active]) pick(options[active]);
      } else if (e.key === 'Escape') {
        if (open) {
          // Close just the list — not the dialog this sits in.
          e.stopPropagation();
          close(true);
        }
      } else if (e.key === 'Tab') {
        setOpen(false);
      } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        onTypeahead(e.key);
      }
    }

    return (
      <div className="relative">
        <button
          {...aria}
          ref={setRefs}
          id={id}
          type="button"
          role="combobox"
          disabled={disabled}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={open ? listId : undefined}
          onClick={() => (open ? close() : show())}
          onKeyDown={onKeyDown}
          className={cn(
            'flex h-9 w-full items-center gap-2 rounded-md border border-input bg-card/60 px-3 py-1 text-left text-sm text-foreground shadow-sm transition-colors hover:border-primary/40 focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 disabled:cursor-not-allowed disabled:opacity-50',
            open && 'border-ring ring-2 ring-ring/40',
            className,
          )}
        >
          <span className={cn('min-w-0 flex-1 truncate', !selected?.text && 'text-muted-foreground')}>
            {selected && selected.text !== '' ? selected.label : (selected?.label ?? ' ')}
          </span>
          <ChevronDown
            className={cn('h-4 w-4 shrink-0 text-muted-foreground transition-transform', open && 'rotate-180')}
          />
        </button>

        {required && (
          // Lets the browser's own required-field check and message work.
          <input
            tabIndex={-1}
            aria-hidden
            required
            value={current}
            onChange={() => {}}
            className="pointer-events-none absolute inset-x-0 bottom-0 h-0 opacity-0"
          />
        )}
        {name && <input type="hidden" name={name} value={current} />}

        {open &&
          createPortal(
            <div
              ref={panelRef}
              id={listId}
              role="listbox"
              tabIndex={-1}
              onKeyDown={onKeyDown}
              style={{ position: 'fixed', ...pos, maxHeight: PANEL_MAX_H }}
              className="z-[60] glass-strong overflow-y-auto rounded-lg p-1 text-card-foreground outline-none"
            >
              {options.map((o, i) => {
                const isSelected = i === selectedIndex;
                return (
                  <div
                    key={`${o.value}-${i}`}
                    role="option"
                    data-row={i}
                    aria-selected={isSelected}
                    aria-disabled={o.disabled || undefined}
                    onMouseMove={() => !o.disabled && setActive(i)}
                    onClick={() => pick(o)}
                    className={cn(
                      'flex cursor-pointer items-center gap-2 rounded-md px-2.5 py-1.5 text-sm',
                      i === active && 'bg-accent text-accent-foreground',
                      isSelected && 'font-medium',
                      o.disabled && 'cursor-not-allowed opacity-50',
                    )}
                  >
                    <span className="min-w-0 flex-1 truncate">{o.label}</span>
                    {isSelected && <Check className="h-4 w-4 shrink-0 text-lumen-gold" />}
                  </div>
                );
              })}
            </div>,
            document.body,
          )}
      </div>
    );
  },
);
Select.displayName = 'Select';
