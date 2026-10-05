import * as React from 'react';
import { Download } from 'lucide-react';
import { isApiError } from '@/lib/api';
import {
  downloadReport,
  fetchAttrition,
  fetchHeadcount,
  fetchMovement,
  type AttritionSummary,
  type ExportFormat,
  type HeadcountSummary,
  type MovementSummary,
  type ReportKind,
  type ReportResult,
} from '@/lib/reports/client';
import { PageHeader } from '@/components/page-header';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/field';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/table';
import { useToast } from '@/components/ui/toast';

const TABS: Array<{ value: ReportKind; label: string; description: string }> = [
  { value: 'headcount', label: 'Headcount', description: 'Who is employed on a given date, by department.' },
  { value: 'movement', label: 'Joiners & leavers', description: 'Month-by-month movement and net change.' },
  { value: 'attrition', label: 'Attrition', description: 'Leaver rate, tenure and voluntary vs involuntary exits.' },
];

/** Mirrors the API default: 12 whole calendar months ending this month. */
function defaultPeriod() {
  const today = new Date();
  const to = today.toISOString().slice(0, 10);
  const start = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 11, 1));
  return { from: start.toISOString().slice(0, 10), to, asOf: to };
}

function formatCell(value: string | number | null, key: string) {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'number' && key.toLowerCase().includes('pct')) return `${value.toFixed(2)}%`;
  return String(value);
}

function Stat({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <Card>
      <CardContent className="flex flex-col gap-1 p-4">
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</span>
        <span className="text-2xl font-semibold tabular-nums">{value}</span>
        {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
      </CardContent>
    </Card>
  );
}

function months(n: number | null | undefined) {
  return n === null || n === undefined ? '—' : `${n.toFixed(1)} mo`;
}

export function ReportsPage() {
  const { toast } = useToast();
  const [tab, setTab] = React.useState<ReportKind>('headcount');
  const [period, setPeriod] = React.useState(defaultPeriod);
  const [result, setResult] = React.useState<ReportResult<unknown> | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [exporting, setExporting] = React.useState(false);

  const load = React.useCallback(
    async (kind: ReportKind, p: typeof period) => {
      setLoading(true);
      setError(null);
      try {
        const data =
          kind === 'headcount'
            ? await fetchHeadcount({ asOf: p.asOf })
            : kind === 'movement'
              ? await fetchMovement({ from: p.from, to: p.to })
              : await fetchAttrition({ from: p.from, to: p.to });
        setResult(data);
      } catch (err) {
        setResult(null);
        setError(isApiError(err) ? err.message : 'Could not load this report — try again.');
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  React.useEffect(() => {
    load(tab, period);
  }, [tab, period, load]);

  async function handleExport(format: ExportFormat) {
    setExporting(true);
    try {
      await downloadReport(tab, format, tab === 'headcount' ? { asOf: period.asOf } : { from: period.from, to: period.to });
    } catch (err) {
      toast({ title: 'Export failed', description: isApiError(err) ? err.message : 'Try again.', tone: 'error' });
    } finally {
      setExporting(false);
    }
  }

  const active = TABS.find((t) => t.value === tab)!;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Reports"
        description="Org-wide headcount and workforce movement. Payroll-cost and statutory registers arrive with Payroll."
        actions={
          <>
            <Button variant="outline" disabled={exporting || !result} onClick={() => handleExport('csv')}>
              <Download className="h-4 w-4" /> CSV
            </Button>
            <Button variant="outline" disabled={exporting || !result} onClick={() => handleExport('xlsx')}>
              <Download className="h-4 w-4" /> Excel
            </Button>
          </>
        }
      />

      <Tabs value={tab} onValueChange={(v) => setTab(v as ReportKind)}>
        <TabsList>
          {TABS.map((t) => (
            <TabsTrigger key={t.value} value={t.value}>
              {t.label}
            </TabsTrigger>
          ))}
        </TabsList>

        {TABS.map((t) => (
          <TabsContent key={t.value} value={t.value} className="flex flex-col gap-5 pt-4">
            <div className="flex flex-wrap items-end gap-3">
              {t.value === 'headcount' ? (
                <Field label="As of" htmlFor="rpt-asof">
                  <Input
                    id="rpt-asof"
                    type="date"
                    value={period.asOf}
                    onChange={(e) => setPeriod((p) => ({ ...p, asOf: e.target.value }))}
                  />
                </Field>
              ) : (
                <>
                  <Field label="From" htmlFor="rpt-from">
                    <Input
                      id="rpt-from"
                      type="date"
                      value={period.from}
                      onChange={(e) => setPeriod((p) => ({ ...p, from: e.target.value }))}
                    />
                  </Field>
                  <Field label="To" htmlFor="rpt-to">
                    <Input
                      id="rpt-to"
                      type="date"
                      value={period.to}
                      onChange={(e) => setPeriod((p) => ({ ...p, to: e.target.value }))}
                    />
                  </Field>
                </>
              )}
              <p className="pb-2 text-sm text-muted-foreground">{active.description}</p>
            </div>

            {error && <p className="text-sm text-destructive">{error}</p>}
            {loading && !result && <p className="text-sm text-muted-foreground">Loading…</p>}

            {result && tab === t.value && (
              <>
                <Summary kind={t.value} summary={result.summary} />
                <Card>
                  <div className="overflow-x-auto">
                    <Table>
                      <THead>
                        <TR>
                          {result.table.columns.map((c) => (
                            <TH key={c.key}>{c.label}</TH>
                          ))}
                        </TR>
                      </THead>
                      <TBody>
                        {result.table.rows.length === 0 && (
                          <TR>
                            <TD colSpan={result.table.columns.length} className="text-center text-muted-foreground">
                              No data for this period.
                            </TD>
                          </TR>
                        )}
                        {result.table.rows.map((row, i) => (
                          <TR key={i}>
                            {result.table.columns.map((c) => (
                              <TD key={c.key} className="tabular-nums">
                                {formatCell(row[c.key] ?? null, c.key)}
                              </TD>
                            ))}
                          </TR>
                        ))}
                      </TBody>
                    </Table>
                  </div>
                </Card>
              </>
            )}
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}

function Summary({ kind, summary }: { kind: ReportKind; summary: unknown }) {
  if (kind === 'headcount') {
    const s = summary as HeadcountSummary;
    return (
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Headcount" value={s.headcount} hint={`As of ${s.asOf}`} />
        <Stat label="Departments" value={s.byDepartment.length} />
        <Stat
          label="Missing joining date"
          value={s.missingJoiningDate}
          hint="Not counted until a date is set"
        />
      </div>
    );
  }
  if (kind === 'movement') {
    const s = summary as MovementSummary;
    return (
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Stat label="Opening" value={s.openingHeadcount} />
        <Stat label="Joiners" value={s.joiners} />
        <Stat label="Leavers" value={s.leavers} />
        <Stat label="Closing" value={s.closingHeadcount} />
        <Stat label="Net change" value={s.netChange > 0 ? `+${s.netChange}` : s.netChange} />
      </div>
    );
  }
  const s = summary as AttritionSummary;
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      <Stat label="Leavers" value={s.leavers} hint={`Voluntary ${s.voluntary} · Involuntary ${s.involuntary}`} />
      <Stat label="Attrition (period)" value={`${s.periodRatePct.toFixed(2)}%`} hint={`${s.months} month(s)`} />
      <Stat label="Attrition (annualised)" value={`${s.annualisedRatePct.toFixed(2)}%`} />
      <Stat label="Avg leaver tenure" value={months(s.avgLeaverTenureMonths)} hint={`Avg active tenure ${months(s.avgActiveTenureMonths)}`} />
      {s.unspecified > 0 && (
        <Stat label="Reason not recorded" value={s.unspecified} hint="Set a separation reason on exit" />
      )}
    </div>
  );
}
