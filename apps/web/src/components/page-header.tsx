import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * Standard page title block: h1 + one-line description on the left, actions on
 * the right. Replaces the copy-pasted `<div className="flex items-start
 * justify-between"><div><h1>…` at the top of every screen.
 */
export function PageHeader({
  title,
  description,
  actions,
  className,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-wrap items-start justify-between gap-3', className)}>
      <div>
        <h1 className="text-xl font-semibold">{title}</h1>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
