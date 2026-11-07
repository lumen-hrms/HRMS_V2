import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * Thin table primitives — same hand-rolled, cva-free approach as the rest of
 * components/ui. Wrap in a <Card className="overflow-hidden"> for the framed
 * look used across the app (see employees/list.tsx).
 */

/**
 * `stack` - below `md` each row becomes a labelled card instead of a sideways-
 * scrolling grid (rules in index.css, `table[data-stack]`). Opt in per table:
 * give each <TD> a `label` (the first, label-less cell is the card's title) and
 * mark a row's kebab/buttons cell `actions` to pin it to the card's corner.
 * Without `stack` the table just scrolls horizontally, as before.
 */
export function Table({
  className,
  stack,
  ...props
}: React.TableHTMLAttributes<HTMLTableElement> & { stack?: boolean }) {
  return (
    <div className="w-full overflow-x-auto">
      <table data-stack={stack ? '' : undefined} className={cn('w-full text-sm', className)} {...props} />
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

export function TD({
  className,
  label,
  actions,
  ...props
}: React.TdHTMLAttributes<HTMLTableCellElement> & {
  /** Caption shown beside the value when the table is stacked into cards. */
  label?: string;
  /** Pins the cell to the card's top-right corner when stacked. */
  actions?: boolean;
}) {
  return (
    <td
      data-label={label}
      data-actions={actions ? '' : undefined}
      className={cn('px-4 py-2.5 align-middle', className)}
      {...props}
    />
  );
}
