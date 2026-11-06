import * as React from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRight } from 'lucide-react';
import { Card } from '@/components/ui/card';

/**
 * A dashboard tile that leads with a number and shows its shape: label,
 * value, a one-line context, and a small chart beneath. The whole tile is a
 * link to the metric's detail page (graph on top, the detail table below).
 */
export function ChartTile({
  to,
  label,
  value,
  sub,
  tone,
  children,
}: {
  to: string;
  label: string;
  value: string;
  sub?: string;
  tone?: 'warning';
  children?: React.ReactNode;
}) {
  return (
    <Link
      to={to}
      aria-label={`${label}: ${value}${sub ? `, ${sub}` : ''}. Open details`}
      className="group block min-w-0 rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <Card className="flex h-full flex-col gap-1 p-4 transition-shadow group-hover:shadow-md">
        <div className="flex items-start justify-between gap-2">
          <p className="text-xs text-muted-foreground">{label}</p>
          <ArrowUpRight
            aria-hidden="true"
            className="h-4 w-4 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
          />
        </div>
        <p className={`text-2xl font-semibold ${tone === 'warning' ? 'text-warning' : ''}`}>{value}</p>
        {sub && (
          <p className="truncate text-xs text-muted-foreground" title={sub}>
            {sub}
          </p>
        )}
        {children && <div className="mt-2">{children}</div>}
      </Card>
    </Link>
  );
}
