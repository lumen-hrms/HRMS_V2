/**
 * Audit Log module (12) — cross-module aggregation feed. Complements the
 * narrower `accessApi.loginAudit`/`accessApi.accessAudit` calls (Identity &
 * Access only) with a superset view spanning every module that writes
 * `public.audit_log` (`employee-master`, `attendance`, `identity-access`, …).
 * `GET /api/audit`, `GET /api/audit/modules` · Company Admin, Auditor · live.
 * No mock mode — this is an admin power view over real cross-module data,
 * not a per-screen fixture the way each module's own client is.
 */
import { api } from '@/lib/api';
import type { AuditEntry, AuditFilter } from './types';

function cleanFilter(filter: AuditFilter): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(filter)) {
    if (v) out[k] = v;
  }
  return out;
}

export const auditApi = {
  list(filter: AuditFilter = {}): Promise<AuditEntry[]> {
    const qs = new URLSearchParams(cleanFilter(filter)).toString();
    return api.get<AuditEntry[]>(`/audit${qs ? `?${qs}` : ''}`);
  },

  modules(): Promise<string[]> {
    return api.get<string[]>('/audit/modules');
  },
};
