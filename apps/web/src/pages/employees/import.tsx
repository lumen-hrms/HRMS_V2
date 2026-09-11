import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import { Download, Upload } from 'lucide-react';
import { getAccessToken, getTenantSubdomain, isApiError } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

const TEMPLATE_COLUMNS = [
  'employeeCode',
  'firstName',
  'lastName',
  'personalEmail',
  'phone',
  'designation',
] as const;

interface RowResult {
  row: number;
  success: boolean;
  error?: string;
}

interface ImportResult {
  totalRows: number;
  succeeded: number;
  failed: number;
  results: RowResult[];
}

export function EmployeeBulkImportPage() {
  const navigate = useNavigate();
  const [fileName, setFileName] = React.useState<string | null>(null);
  const [uploading, setUploading] = React.useState(false);
  const [result, setResult] = React.useState<ImportResult | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  function downloadTemplate() {
    // Plain CSV — Excel opens it fine and it needs no client-side xlsx
    // library. Server accepts .xlsx too; this is the simplest correct
    // template for the required + commonly-used columns.
    const csv = TEMPLATE_COLUMNS.join(',') + '\n';
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'employee-import-template.csv';
    a.click();
    URL.revokeObjectURL(url);
  }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setUploading(true);
    setError(null);
    setResult(null);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const headers: Record<string, string> = {};
      const token = await getAccessToken();
      const subdomain = getTenantSubdomain();
      if (token) headers.Authorization = `Bearer ${token}`;
      if (subdomain) headers['X-Tenant-Subdomain'] = subdomain;
      const res = await fetch('/api/employees/bulk-import', { method: 'POST', headers, body: formData });
      const body = await res.json();
      if (!res.ok) throw new Error(body.message ?? 'Import failed');
      setResult(body as ImportResult);
    } catch (err) {
      setError(isApiError(err) ? err.message : (err as Error).message);
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  }

  function downloadFailedRows() {
    if (!result) return;
    const failed = result.results.filter((r) => !r.success);
    const csv = ['row,error', ...failed.map((r) => `${r.row},"${(r.error ?? '').replace(/"/g, '""')}"`)].join(
      '\n',
    );
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'failed-rows.csv';
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="flex max-w-2xl flex-col gap-5">
      <div>
        <h1 className="text-xl font-semibold">Bulk import employees</h1>
        <p className="text-sm text-muted-foreground">
          Upload an .xlsx file with one row per employee. A bad row never fails the whole batch —
          fix and re-upload only the failed rows.
        </p>
      </div>

      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle>1. Download the template</CardTitle>
          <Button size="sm" variant="outline" onClick={downloadTemplate}>
            <Download className="h-3.5 w-3.5" /> Template (.csv)
          </Button>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Required columns: <code>employeeCode</code>, <code>firstName</code>, <code>lastName</code>.
          Optional: <code>personalEmail</code>, <code>phone</code>, <code>designation</code>.
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>2. Upload your file</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <label>
            <input
              type="file"
              accept=".xlsx,.csv"
              className="hidden"
              onChange={handleFile}
              disabled={uploading}
            />
            <span className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm font-medium hover:bg-accent">
              <Upload className="h-4 w-4" /> {uploading ? 'Uploading…' : 'Choose file (.xlsx)'}
            </span>
          </label>
          {fileName && <p className="text-xs text-muted-foreground">{fileName}</p>}
          {error && <p className="text-sm text-destructive">{error}</p>}
        </CardContent>
      </Card>

      {result && (
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle>3. Result</CardTitle>
            {result.failed > 0 && (
              <Button size="sm" variant="outline" onClick={downloadFailedRows}>
                <Download className="h-3.5 w-3.5" /> Download failed rows
              </Button>
            )}
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <div className="flex items-center gap-2 text-sm">
              <Badge variant="success">{result.succeeded} created</Badge>
              {result.failed > 0 && <Badge variant="destructive">{result.failed} failed</Badge>}
              <span className="text-muted-foreground">of {result.totalRows} rows</span>
            </div>
            <div className="flex flex-col divide-y divide-border rounded-md border border-border">
              {result.results.map((r) => (
                <div key={r.row} className="flex items-center justify-between px-3 py-2 text-sm">
                  <span className="text-muted-foreground">Row {r.row}</span>
                  {r.success ? (
                    <Badge variant="success">ok</Badge>
                  ) : (
                    <span className="text-right text-destructive">{r.error}</span>
                  )}
                </div>
              ))}
            </div>
            <Button className="self-start" onClick={() => navigate('/employees')}>
              Done — back to directory
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
