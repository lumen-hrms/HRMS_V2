import * as React from 'react';
import { Download, Loader2, Upload } from 'lucide-react';
import { api, getAccessToken, getTenantSubdomain, isApiError } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';

/** Mirrors the API's `ImportReport` (apps/api/src/common/bulk-import.ts). */
export interface ImportRowResult {
  row: number;
  employeeCode: string | null;
  action: 'create' | 'update' | null;
  success: boolean;
  error?: string;
  warnings?: string[];
  detail?: string;
}

export interface ImportReport {
  dryRun: boolean;
  totalRows: number;
  succeeded: number;
  failed: number;
  ignoredColumns: string[];
  summary: Record<string, number | string[]>;
  results: ImportRowResult[];
}

/** A commit's live progress line (`streamImport` in apps/api/src/common/bulk-import.ts). */
export interface ImportProgress {
  phase: 'saving' | 'linking' | 'inviting';
  done: number;
  total: number;
}

export interface ImportColumn {
  name: string;
  required?: boolean;
  description: string;
}

interface BulkImportProps {
  /** API path, e.g. `/employees/bulk-import`. */
  endpoint: string;
  columns: ImportColumn[];
  templateFileName: string;
  /** What the commit's first phase is saving, e.g. "employees". */
  rowNoun: string;
  /** Turns a report's `summary` into badges, e.g. `[['success', '12 to create']]`. */
  summarize: (report: ImportReport) => [variant: 'success' | 'warning' | 'default', label: string][];
  onDone: () => void;
  /** Header for the column showing each row's key (`ImportRowResult.employeeCode`), e.g. "Date". */
  keyLabel?: string;
}

function downloadCsv(fileName: string, lines: string[]) {
  const blob = new Blob([lines.join('\n') + '\n'], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}

const quote = (v: string) => `"${v.replace(/"/g, '""')}"`;

const messageOf = (body: any, status: number) => {
  const m = body?.message;
  return Array.isArray(m) ? m.join('; ') : (m ?? `Import failed (HTTP ${status})`);
};

/**
 * Commits the import asking for NDJSON progress lines, calling `onProgress`
 * as rows finish and resolving with the final report. Falls back to a plain
 * JSON body if something in between (a proxy) didn't keep it streaming.
 */
async function commitWithProgress(
  endpoint: string,
  file: File,
  onProgress: (p: ImportProgress) => void,
): Promise<ImportReport> {
  const body = new FormData();
  body.append('file', file);
  const headers: Record<string, string> = { Accept: 'application/x-ndjson' };
  const token = await getAccessToken();
  const subdomain = getTenantSubdomain();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (subdomain) headers['X-Tenant-Subdomain'] = subdomain;

  const res = await fetch(`/api${endpoint}?dryRun=false`, { method: 'POST', headers, body });
  if (!res.ok) throw new Error(messageOf(await res.json().catch(() => null), res.status));
  if (!res.headers.get('content-type')?.includes('ndjson') || !res.body) {
    return (await res.json()) as ImportReport;
  }

  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffered = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (value) buffered += value;
    const lines = buffered.split('\n');
    buffered = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.trim()) continue;
      const msg = JSON.parse(line);
      if (msg.type === 'progress') onProgress(msg as ImportProgress);
      else if (msg.type === 'report') return msg.report as ImportReport;
      else if (msg.type === 'error') throw new Error(msg.message);
    }
    if (done) break;
  }
  throw new Error(
    'The connection closed before the import finished. Some rows may already be saved — check the list before uploading again.',
  );
}

function formatElapsed(seconds: number) {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

function ImportProgressPanel({
  progress,
  startedAt,
  rowNoun,
}: {
  progress: ImportProgress | null;
  startedAt: number;
  rowNoun: string;
}) {
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const label = !progress
    ? 'Starting…'
    : progress.phase === 'saving'
      ? `Saving ${rowNoun}`
      : progress.phase === 'linking'
        ? 'Linking reporting managers'
        : 'Sending login invites';
  const pct = progress && progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;

  return (
    <div className="flex flex-col gap-2 rounded-md border border-border bg-muted/40 p-4" role="status" aria-live="polite">
      <div className="flex items-center justify-between gap-3 text-sm">
        <span className="flex items-center gap-2 font-medium">
          <Loader2 className="h-4 w-4 animate-spin" />
          {label}
          {progress && progress.total > 0 && (
            <span className="text-muted-foreground">
              {progress.done} of {progress.total}
            </span>
          )}
        </span>
        <span className="tabular-nums text-xs text-muted-foreground">
          {formatElapsed(Math.max(0, Math.floor((now - startedAt) / 1000)))}
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-secondary">
        <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${pct}%` }} />
      </div>
      <p className="text-xs text-muted-foreground">
        Keep this tab open until it finishes. Rows with logins take a little longer — each one
        creates an account and sends an invite.
      </p>
    </div>
  );
}

/**
 * Upload → preview (a server-side dry run: nothing is written) → confirm →
 * result. The same file is sent twice; the commit re-validates everything,
 * so the preview can never authorize a row the commit wouldn't.
 */
export function BulkImport({
  endpoint,
  columns,
  templateFileName,
  rowNoun,
  summarize,
  onDone,
  keyLabel = 'Code',
}: BulkImportProps) {
  const [file, setFile] = React.useState<File | null>(null);
  const [busy, setBusy] = React.useState<'preview' | 'import' | null>(null);
  const [report, setReport] = React.useState<ImportReport | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [progress, setProgress] = React.useState<ImportProgress | null>(null);
  const [startedAt, setStartedAt] = React.useState(0);

  // Leaving mid-import doesn't stop the server, but the user would lose the
  // result table — warn before navigating away.
  React.useEffect(() => {
    if (busy !== 'import') return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [busy]);

  async function preview(f: File) {
    setBusy('preview');
    setError(null);
    try {
      setReport(await api.upload<ImportReport>(`${endpoint}?dryRun=true`, f));
    } catch (err) {
      setError(isApiError(err) ? err.message : (err as Error).message);
      setReport(null);
    } finally {
      setBusy(null);
    }
  }

  async function commit(f: File) {
    setBusy('import');
    setError(null);
    setProgress(null);
    setStartedAt(Date.now());
    try {
      setReport(await commitWithProgress(endpoint, f, setProgress));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
      setProgress(null);
    }
  }

  function chooseFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    setFile(f);
    void preview(f);
  }

  function downloadErrors() {
    if (!report) return;
    downloadCsv('import-errors.csv', [
      'row,employeeCode,error',
      ...report.results
        .filter((r) => !r.success)
        .map((r) => [String(r.row), quote(r.employeeCode ?? ''), quote(r.error ?? '')].join(',')),
    ]);
  }

  const committed = report && !report.dryRun;

  return (
    <div className="flex flex-col gap-5">
      <Card>
        <CardHeader className="flex-row items-center justify-between gap-3">
          <CardTitle>1. Download the template</CardTitle>
          <Button
            size="sm"
            variant="outline"
            onClick={() => downloadCsv(templateFileName, [columns.map((c) => c.name).join(',')])}
          >
            <Download className="h-3.5 w-3.5" /> Template (.csv)
          </Button>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 text-sm text-muted-foreground">
          <p>
            Fill it in Excel or Google Sheets and upload it as .csv or .xlsx. Column names are matched
            loosely (<code>Employee Code</code> works too). Dates can be <code>YYYY-MM-DD</code> or{' '}
            <code>DD-MM-YYYY</code>.
          </p>
          <details>
            <summary className="cursor-pointer font-medium text-foreground">Column reference</summary>
            <div className="mt-2 overflow-x-auto">
              <Table>
                <THead>
                  <TR>
                    <TH>Column</TH>
                    <TH>What goes in it</TH>
                  </TR>
                </THead>
                <TBody>
                  {columns.map((c) => (
                    <TR key={c.name}>
                      <TD className="whitespace-nowrap font-mono text-xs">
                        {c.name}
                        {c.required && <span className="text-destructive"> *</span>}
                      </TD>
                      <TD className="text-xs">{c.description}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </div>
          </details>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>2. Upload and preview</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <label className="self-start">
            <input
              type="file"
              accept=".xlsx,.csv"
              className="hidden"
              onChange={chooseFile}
              disabled={busy !== null}
            />
            <span className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm font-medium hover:bg-accent">
              <Upload className="h-4 w-4" />
              {busy === 'preview' ? 'Checking…' : file ? 'Choose a different file' : 'Choose file'}
            </span>
          </label>
          {file && <p className="text-xs text-muted-foreground">{file.name}</p>}
          <p className="text-xs text-muted-foreground">
            Nothing is saved until you confirm — the preview only checks the file.
          </p>
          {error && !report && <p className="text-sm text-destructive">{error}</p>}
        </CardContent>
      </Card>

      {report && (
        <Card>
          <CardHeader className="flex-row flex-wrap items-center justify-between gap-2">
            <CardTitle>{committed ? '3. Imported' : '3. Review'}</CardTitle>
            <div className="flex flex-wrap gap-2">
              {report.failed > 0 && (
                <Button size="sm" variant="outline" onClick={downloadErrors}>
                  <Download className="h-3.5 w-3.5" /> Errors (.csv)
                </Button>
              )}
              {committed ? (
                <Button size="sm" onClick={onDone}>
                  Done
                </Button>
              ) : (
                <Button
                  size="sm"
                  disabled={report.succeeded === 0 || busy !== null}
                  onClick={() => file && commit(file)}
                >
                  {busy === 'import'
                    ? 'Importing…'
                    : `Import ${report.succeeded} valid row${report.succeeded === 1 ? '' : 's'}`}
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {busy === 'import' && (
              <ImportProgressPanel progress={progress} startedAt={startedAt} rowNoun={rowNoun} />
            )}
            {error && busy === null && <p className="text-sm text-destructive">{error}</p>}
            <div className="flex flex-wrap items-center gap-2 text-sm">
              {summarize(report).map(([variant, label]) => (
                <Badge key={label} variant={variant}>
                  {label}
                </Badge>
              ))}
              {report.failed > 0 && (
                <Badge variant="destructive">
                  {report.failed} {committed ? 'failed' : 'with errors'}
                </Badge>
              )}
              <span className="text-muted-foreground">of {report.totalRows} rows</span>
            </div>
            {!committed && report.failed > 0 && (
              <p className="text-xs text-muted-foreground">
                Rows with errors are skipped. Fix them and upload the file again, or import the valid
                rows now and upload the fixed rows later.
              </p>
            )}
            {report.ignoredColumns.length > 0 && (
              <p className="text-xs text-warning">
                Ignored unrecognised columns: {report.ignoredColumns.join(', ')}
              </p>
            )}
            <div className="max-h-[28rem] overflow-auto rounded-md border border-border">
              <Table>
                <THead>
                  <TR>
                    <TH>Row</TH>
                    <TH>{keyLabel}</TH>
                    <TH>Action</TH>
                    <TH>Details</TH>
                  </TR>
                </THead>
                <TBody>
                  {report.results.map((r) => (
                    <TR key={r.row}>
                      <TD className="text-muted-foreground">{r.row}</TD>
                      <TD className="font-mono text-xs">{r.employeeCode ?? '—'}</TD>
                      <TD>
                        {r.success ? (
                          <Badge variant={r.action === 'create' ? 'success' : 'default'}>
                            {r.action === 'create' ? 'New' : 'Update'}
                          </Badge>
                        ) : (
                          <Badge variant="destructive">Error</Badge>
                        )}
                      </TD>
                      <TD className="text-xs">
                        {r.error && <p className="text-destructive">{r.error}</p>}
                        {r.detail && <p className="text-muted-foreground">{r.detail}</p>}
                        {r.warnings?.map((w) => (
                          <p key={w} className="text-warning">
                            {w}
                          </p>
                        ))}
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
