import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * Thin table primitives — same hand-rolled, cva-free approach as the rest of
 * components/ui. Wrap in a <Card className="overflow-hidden"> for the framed
 * look used across the app (see employees/list.tsx).
 */

export function Table({ className, ...props }: React.TableHTMLAttributes<HTMLTableElement>) {
  return (
    <div className="w-full overflow-x-auto">
      <table className={cn('w-full text-sm', className)} {...props} />
    </div>
  );
}

export function THead({ className, ...props }: React.HTMLAttributes<HTMLTableSectionElement>) {
  return <thead className={cn('bg-muted text-muted-foreground', className)} {...props} />;
}

export function TBody({ className, ...props }: React.HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody className={className} {...props} />;
}

export function TR({ className, ...props }: React.HTMLAttributes<HTMLTableRowElement>) {
  return <tr className={cn('border-t border-border first:border-t-0', className)} {...props} />;
}

export function TH({ className, ...props }: React.ThHTMLAttributes<HTMLTableCellElement>) {
  return <th className={cn('px-4 py-2.5 text-left font-medium', className)} {...props} />;
}

export function TD({ className, ...props }: React.TdHTMLAttributes<HTMLTableCellElement>) {
  return <td className={cn('px-4 py-2.5 align-middle', className)} {...props} />;
}
