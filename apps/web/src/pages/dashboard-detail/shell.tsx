import * as React from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, ArrowLeft, ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { currentMonth, monthTitle, shiftMonth } from './dates';

/**
 * Every metric page has the same shape: the graph on top, the detail
 * underneath. `loading` with data already on screen dims the chart and keeps
 * its frame; only the very first load shows a skeleton.
 */
export function MetricPage({
  title,
  subtitle,
  filters,
  chartTitle,
  chartDescription,
  chart,
  legend,
  detailTitle,
  detailDescription,
  detail,
  ready,
  loading,
  error,
}: {
  title: string;
  subtitle?: string;
  filters?: React.ReactNode;
  chartTitle: string;
  chartDescription?: string;
  chart: React.ReactNode;
  legend?: React.ReactNode;
  detailTitle: string;
  detailDescription?: string;
  detail: React.ReactNode;
  /** False until the first data has arrived. */
  ready: boolean;
  loading: boolean;
  error: string | null;
}) {
  return (
    <div className="flex flex-col gap-5">
      <div>
        <Link
          to="/"
          className="mb-2 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> Dashboard
        </Link>
        <h1 className="text-xl font-semibold">{title}</h1>
        {subtitle && <p className="text-sm text-muted-foreground">{subtitle}</p>}
      </div>

      {filters && <div className="flex flex-wrap items-center gap-2">{filters}</div>}

      {error && !ready ? (
        <EmptyState icon={AlertTriangle} title="Couldn't load this" description={error} />
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{chartTitle}</CardTitle>
              {chartDescription && <CardDescription>{chartDescription}</CardDescription>}
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              {!ready ? (
                <Skeleton className="h-56 w-full" />
              ) : (
                <div className={`flex flex-col gap-4 transition-opacity ${loading ? 'opacity-60' : ''}`} aria-busy={loading}>
                  {chart}
                  {legend}
                </div>
              )}
              {error && ready && <p className="text-sm text-destructive">{error}</p>}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">{detailTitle}</CardTitle>
              {detailDescription && <CardDescription>{detailDescription}</CardDescription>}
            </CardHeader>
            <CardContent className={`transition-opacity ${loading && ready ? 'opacity-60' : ''}`}>
              {!ready ? <Skeleton className="h-40 w-full" /> : detail}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

/** One row above the content it scopes: step back and forward a month. */
export function MonthFilter({ month, onChange }: { month: string; onChange: (m: string) => void }) {
  const atLatest = month >= currentMonth();
  return (
    <div className="flex items-center gap-1" role="group" aria-label="Month">
      <Button size="sm" variant="outline" aria-label="Previous month" onClick={() => onChange(shiftMonth(month, -1))}>
        <ChevronLeft className="h-4 w-4" />
      </Button>
      <span className="min-w-[8.5rem] text-center text-sm font-medium">{monthTitle(month)}</span>
      <Button
        size="sm"
        variant="outline"
        aria-label="Next month"
        disabled={atLatest}
        onClick={() => onChange(shiftMonth(month, 1))}
      >
        <ChevronRight className="h-4 w-4" />
      </Button>
    </div>
  );
}

export interface Column<T> {
  key: string;
  header: string;
  align?: 'right';
  render: (row: T) => React.ReactNode;
}

/** The detail table — also the chart's table twin: every plotted value is in it. */
export function DataTable<T>({
  caption,
  columns,
  rows,
  rowKey,
  empty,
}: {
  caption: string;
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  empty: string;
}) {
  if (rows.length === 0) return <p className="py-4 text-center text-sm text-muted-foreground">{empty}</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead className="bg-muted text-muted-foreground">
          <tr>
            {columns.map((c) => (
              <th
                key={c.key}
                scope="col"
                className={`px-4 py-2.5 font-medium ${c.align === 'right' ? 'text-right' : 'text-left'}`}
              >
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={rowKey(row)} className="border-t border-border hover:bg-accent">
              {columns.map((c) => (
                <td key={c.key} className={`px-4 py-2.5 ${c.align === 'right' ? 'text-right tabular-nums' : ''}`}>
                  {c.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
