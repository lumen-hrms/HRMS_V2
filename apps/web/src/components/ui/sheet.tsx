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
        className="absolute inset-0 bg-[#030812]/50 backdrop-blur-sm"
        onClick={() => onOpenChange(false)}
        aria-hidden="true"
      />
      <div
        role="dialog"
        aria-modal="true"
        className={cn(
          'glass-strong absolute right-0 top-0 flex h-dvh w-full max-w-md flex-col rounded-l-xl max-sm:rounded-none',
          className,
        )}
      >
        <div className="flex items-start gap-3 border-b border-border p-5">
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="-ml-1 -mt-1 shrink-0 rounded-full p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
          <div className="min-w-0">
            <h2 className="text-base font-semibold leading-none">{title}</h2>
            {description && <p className="mt-1.5 text-sm text-muted-foreground">{description}</p>}
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-5">{children}</div>
        {footer && <div className="border-t border-border p-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">{footer}</div>}
      </div>
    </div>
  );
}
