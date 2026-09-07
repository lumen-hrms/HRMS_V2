import * as React from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Right-side slide-over panel. Same hand-rolled approach as dialog.tsx (no
 * Radix). Use for record detail / inspector views where a full modal would be
 * too heavy — e.g. a leave request's detail + approval timeline.
 */
export function Sheet({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  className,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
}) {
  React.useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onOpenChange(false);
    }
    if (open) document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onOpenChange]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50">
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        onClick={() => onOpenChange(false)}
        aria-hidden="true"
      />
      <div
        role="dialog"
        aria-modal="true"
        className={cn(
          'absolute right-0 top-0 flex h-full w-full max-w-md flex-col border-l border-border bg-card shadow-xl',
          className,
        )}
      >
        <div className="flex items-start justify-between gap-4 border-b border-border p-5">
          <div>
            <h2 className="text-base font-semibold leading-none">{title}</h2>
            {description && <p className="mt-1.5 text-sm text-muted-foreground">{description}</p>}
          </div>
          <button
            onClick={() => onOpenChange(false)}
            className="rounded-full p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-5">{children}</div>
        {footer && <div className="border-t border-border p-4">{footer}</div>}
      </div>
    </div>
  );
}
