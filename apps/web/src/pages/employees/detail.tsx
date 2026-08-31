import * as React from 'react';
import { useParams } from 'react-router-dom';
import { Upload, Download } from 'lucide-react';
import { api, getAccessToken, getTenantSubdomain, isApiError } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

interface EmployeeDetail {
  id: string;
  employeeCode: string;
  firstName: string;
  lastName: string;
  designation: string | null;
  employmentStatus: string;
  personalEmail: string | null;
  phone: string | null;
  department: { name: string } | null;
  reportingManager: { firstName: string; lastName: string } | null;
  directReports: { id: string; firstName: string; lastName: string }[];
}

interface Doc {
  id: string;
  label: string;
  mimeType: string;
  sizeBytes: number;
  uploadedAt: string;
}

export function EmployeeDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [employee, setEmployee] = React.useState<EmployeeDetail | null>(null);
  const [docs, setDocs] = React.useState<Doc[]>([]);
  const [uploading, setUploading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const load = React.useCallback(() => {
    if (!id) return;
    api.get<EmployeeDetail>(`/employees/${id}`).then(setEmployee);
    api.get<Doc[]>(`/employees/${id}/documents`).then(setDocs);
  }, [id]);

  React.useEffect(load, [load]);

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !id) return;
    setUploading(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const headers: Record<string, string> = {};
      const token = getAccessToken();
      const subdomain = getTenantSubdomain();
      if (token) headers.Authorization = `Bearer ${token}`;
      if (subdomain) headers['X-Tenant-Subdomain'] = subdomain;
      const res = await fetch(`/api/employees/${id}/documents?label=${encodeURIComponent(file.name)}`, {
        method: 'POST',
        headers,
        body: formData,
        credentials: 'include',
      });
      if (!res.ok) throw new Error((await res.json()).message ?? 'Upload failed');
      load();
    } catch (err) {
      setError(isApiError(err) ? err.message : (err as Error).message);
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  }

  async function handleDownload(docId: string) {
    const { url } = await api.get<{ url: string }>(`/documents/${docId}/download-url`);
    window.open(url, '_blank');
  }

  if (!employee) return <p className="text-muted-foreground">Loading…</p>;

  return (
    <div className="flex max-w-3xl flex-col gap-5">
      <div>
        <h1 className="text-xl font-semibold">
          {employee.firstName} {employee.lastName}
        </h1>
        <p className="text-sm text-muted-foreground">
          {employee.employeeCode} · {employee.designation ?? 'No designation set'}
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Employment</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 text-sm">
            <Row label="Department" value={employee.department?.name ?? '—'} />
            <Row
              label="Reporting manager"
              value={
                employee.reportingManager
                  ? `${employee.reportingManager.firstName} ${employee.reportingManager.lastName}`
                  : '—'
              }
            />
            <Row label="Status" value={<Badge variant="success">{employee.employmentStatus}</Badge>} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Contact</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 text-sm">
            <Row label="Personal email" value={employee.personalEmail ?? '—'} />
            <Row label="Phone" value={employee.phone ?? '—'} />
          </CardContent>
        </Card>
      </div>

      {employee.directReports.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Direct reports</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {employee.directReports.map((r) => (
              <Badge key={r.id} variant="outline">
                {r.firstName} {r.lastName}
              </Badge>
            ))}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle>Documents</CardTitle>
          <label>
            <input type="file" className="hidden" onChange={handleUpload} disabled={uploading} />
            <span className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-accent">
              <Upload className="h-3.5 w-3.5" /> {uploading ? 'Uploading…' : 'Upload'}
            </span>
          </label>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {error && <p className="text-sm text-destructive">{error}</p>}
          {docs.length === 0 && <p className="text-sm text-muted-foreground">No documents uploaded yet.</p>}
          {docs.map((d) => (
            <div key={d.id} className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-sm">
              <span>{d.label}</span>
              <Button size="sm" variant="ghost" onClick={() => handleDownload(d.id)}>
                <Download className="h-3.5 w-3.5" /> Download
              </Button>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}
