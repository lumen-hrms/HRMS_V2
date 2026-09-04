import * as React from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
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
        'relative z-10 w-full max-w-md rounded-lg border border-border bg-card p-6 text-card-foreground shadow-xl',
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
    <div className="mb-4 flex items-start justify-between gap-4">
      <div>
        <h2 className="text-base font-semibold leading-none">{title}</h2>
        {description && <p className="mt-1.5 text-sm text-muted-foreground">{description}</p>}
      </div>
      <button
        onClick={onClose}
        className="rounded-full p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
        aria-label="Close"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
