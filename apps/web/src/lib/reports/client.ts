/**
 * Reports & Analytics client (module 11). The JSON reads go through the shared
 * `api` wrapper; exports need a raw fetch so the file comes back as a blob
 * with the server's Content-Disposition filename, not as parsed JSON.
 */
import { api, getAccessToken, getTenantSubdomain, ApiError } from '@/lib/api';

export type ReportKind = 'headcount' | 'movement' | 'attrition';
export type ExportFormat = 'csv' | 'xlsx';

export interface ReportColumn {
  key: string;
  label: string;
}

export interface ReportResult<S> {
  summary: S;
  table: { columns: ReportColumn[]; rows: Array<Record<string, string | number | null>> };
}

export interface HeadcountSummary {
  asOf: string;
  headcount: number;
  byDepartment: Array<{ name: string; count: number }>;
  byEmploymentType: Array<{ type: string; count: number }>;
  missingJoiningDate: number;
}

export interface MovementSummary {
  from: string;
  to: string;
  openingHeadcount: number;
  closingHeadcount: number;
  joiners: number;
  leavers: number;
  netChange: number;
}

export interface AttritionSummary {
  from: string;
  to: string;
  months: number;
  openingHeadcount: number;
  closingHeadcount: number;
  averageHeadcount: number;
  leavers: number;
  voluntary: number;
  involuntary: number;
  other: number;
  unspecified: number;
  periodRatePct: number;
  annualisedRatePct: number;
  avgLeaverTenureMonths: number | null;
  avgActiveTenureMonths: number | null;
}

export type PeriodParams = {
  from?: string;
  to?: string;
  asOf?: string;
};

function toQuery(params: Record<string, string | undefined>) {
  const search = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) search.set(k, v);
  const s = search.toString();
  return s ? `?${s}` : '';
}

export function fetchHeadcount(params: PeriodParams) {
  return api.get<ReportResult<HeadcountSummary>>(`/reports/headcount${toQuery(params)}`);
}

export function fetchMovement(params: PeriodParams) {
  return api.get<ReportResult<MovementSummary>>(`/reports/movement${toQuery(params)}`);
}

export function fetchAttrition(params: PeriodParams) {
  return api.get<ReportResult<AttritionSummary>>(`/reports/attrition${toQuery(params)}`);
}

/** Downloads a report as CSV or XLSX. Throws ApiError on a non-2xx response. */
export async function downloadReport(kind: ReportKind, format: ExportFormat, params: PeriodParams) {
  const headers = new Headers();
  const subdomain = getTenantSubdomain();
  if (subdomain) headers.set('X-Tenant-Subdomain', subdomain);
  const token = await getAccessToken();
  if (token) headers.set('Authorization', `Bearer ${token}`);

  const res = await fetch(`/api/reports/${kind}/export${toQuery({ ...params, format })}`, { headers });
  if (!res.ok) {
    const text = await res.text();
    let body: unknown = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = null;
    }
    throw new ApiError(res.status, body);
  }

  const disposition = res.headers.get('Content-Disposition') ?? '';
  const filename = /filename="([^"]+)"/.exec(disposition)?.[1] ?? `${kind}.${format}`;
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
