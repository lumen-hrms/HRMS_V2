import * as React from 'react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Centered empty / zero-data state. Use for "no requests yet", "nothing waiting
 * on you", "no results for this filter" — anywhere a list can legitimately be
 * empty. Pass an `action` (a Button/Link) for the primary next step.
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-2 px-6 py-12 text-center',
        className,
      )}
    >
      {Icon && (
        <div className="mb-1 flex h-11 w-11 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <Icon className="h-5 w-5" />
        </div>
      )}
      <p className="text-sm font-medium text-foreground">{title}</p>
      {description && <p className="max-w-sm text-sm text-muted-foreground">{description}</p>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}
