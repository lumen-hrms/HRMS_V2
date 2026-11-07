import * as React from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * On phones (below `sm`) the modal docks to the bottom as a full-width sheet
 * that scrolls inside `dvh`; from `sm` up it is the usual centred card.
 *
 * Hand-rolled modal — this repo has no Radix dependency yet (see button.tsx/
 * card.tsx/badge.tsx, all cva + plain divs), so this follows the same
 * pattern rather than pulling in @radix-ui/react-dialog for one component.
 */
export function Dialog({
  open,
  onOpenChange,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: React.ReactNode;
}) {
  React.useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onOpenChange(false);
    }
    if (open) document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, onOpenChange]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4">
      <div
        className="absolute inset-0 bg-[#030812]/50 backdrop-blur-sm"
        onClick={() => onOpenChange(false)}
        aria-hidden="true"
      />
      {children}
    </div>
  );
}

export function DialogContent({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      className={cn(
        'glass-strong relative z-10 w-full max-w-md rounded-xl p-6 text-card-foreground',
        'max-h-[92dvh] overflow-y-auto overscroll-contain',
        'max-sm:max-w-none! max-sm:rounded-b-none max-sm:p-5 max-sm:pb-[calc(1.25rem+env(safe-area-inset-bottom))]',
        className,
      )}
      {...props}
    />
  );
}

export function DialogHeader({
  title,
  description,
  onClose,
}: {
  title: string;
  description?: string;
  onClose: () => void;
}) {
  return (
    <div className="mb-4 flex items-start gap-3">
      <button
        type="button"
        onClick={onClose}
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
  );
}
