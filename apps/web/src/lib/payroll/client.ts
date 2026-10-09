/**
 * Payroll module API client. Thin wrappers over `api.*` — no mock store:
 * the backend is fully live through Phase 8 (see
 * docs/modules/07_PAYROLL_ENGINE.md §9), unlike Leave's `client.ts`, which
 * still carries a fixture store from before its backend existed. Every
 * function here maps 1:1 to a real endpoint; screens only ever import from
 * here, never call `api.*` directly.
 */
import { api } from '@/lib/api';
import type {
  BankFileResult,
  FullAndFinalSettlement,
  PayrollRun,
  PayrollSettings,
  PayslipUrl,
  PtSlab,
  ReviseStructureResult,
  SalaryComponentInput,
  SalaryStructure,
  TaxConfig,
  TaxRegime,
  TdsRegimeChoice,
} from './types';

// ---- Salary structures ----

export function getStructure(employeeId: string) {
  return api.get<SalaryStructure>(`/payroll/structures/${employeeId}`);
}
export function createStructure(
  employeeId: string,
  input: { ctcAnnual: number; effectiveFrom: string; components: SalaryComponentInput[] },
) {
  return api.post<SalaryStructure>(`/payroll/structures/${employeeId}`, input);
}
export function updateStructure(
  employeeId: string,
  input: { ctcAnnual: number; effectiveFrom: string; components: SalaryComponentInput[] },
) {
  return api.patch<SalaryStructure>(`/payroll/structures/${employeeId}`, input);
}
export function reviseStructure(
  employeeId: string,
  input: {
    ctcAnnual: number;
    effectiveDate: string;
    components: SalaryComponentInput[];
    reason: string;
  },
) {
  return api.post<ReviseStructureResult>(`/payroll/structures/${employeeId}/revise`, input);
}

// ---- Config ----

export function getSettings() {
  return api.get<PayrollSettings>('/payroll/config/settings');
}
export function updateSettings(patch: Partial<PayrollSettings>) {
  return api.patch<PayrollSettings>('/payroll/config/settings', patch);
}
export function listPtSlabs(state?: string) {
  return api.get<PtSlab[]>(`/payroll/config/pt-slabs${state ? `?state=${state}` : ''}`);
}
export function replacePtSlabs(
  state: string,
  slabs: Array<{ grossFrom: number; grossTo: number | null; monthlyAmount: number; februaryAmount?: number | null }>,
) {
  return api.put<PtSlab[]>(`/payroll/config/pt-slabs/${state}`, { slabs });
}
export function getTaxConfig(financialYear: string) {
  return api.get<TaxConfig>(`/payroll/config/tax-config?financialYear=${financialYear}`);
}
export function replaceTaxSlabs(
  regime: TaxRegime,
  financialYear: string,
  slabs: Array<{ incomeFrom: number; incomeTo: number | null; ratePercent: number }>,
) {
  return api.put<TaxConfig>(
    `/payroll/config/tax-slabs/${regime}?financialYear=${financialYear}`,
    { slabs },
  );
}
export function updateTaxRegimeConfig(
  regime: TaxRegime,
  financialYear: string,
  patch: Partial<{
    standardDeduction: number;
    cessPercent: number;
    rebateThreshold: number;
    rebateMaxAmount: number;
  }>,
) {
  return api.patch<TaxConfig>(
    `/payroll/config/tax-regime-config/${regime}?financialYear=${financialYear}`,
    patch,
  );
}

// ---- Tax regime choice ----

export function getTdsRegime(employeeId: string, financialYear: string) {
  return api.get<TdsRegimeChoice>(
    `/payroll/tds-regime/${employeeId}?financialYear=${financialYear}`,
  );
}
export function setTdsRegime(employeeId: string, financialYear: string, regime: TaxRegime) {
  return api.put<TdsRegimeChoice>(`/payroll/tds-regime/${employeeId}`, { financialYear, regime });
}

// ---- Run lifecycle ----

export function createRun(input: { period: string; isReprocess?: boolean; reprocessReason?: string }) {
  return api.post<PayrollRun>('/payroll/runs', input);
}
export function getRun(id: string) {
  return api.get<PayrollRun>(`/payroll/runs/${id}`);
}
export function setLineItemAdjustments(
  runId: string,
  employeeId: string,
  adjustments: Array<{ type: string; amount: number; note?: string }>,
) {
  return api.patch(`/payroll/runs/${runId}/line-items/${employeeId}`, { adjustments });
}
export function recalculateRun(id: string) {
  return api.post<PayrollRun>(`/payroll/runs/${id}/recalculate`);
}
export function submitForReview(id: string) {
  return api.post<PayrollRun>(`/payroll/runs/${id}/submit-review`);
}
export function approveRun(id: string) {
  return api.post<PayrollRun>(`/payroll/runs/${id}/approve`);
}
export function processRun(id: string) {
  return api.post<PayrollRun>(`/payroll/runs/${id}/process`);
}
export function disburseRun(id: string) {
  return api.post<PayrollRun>(`/payroll/runs/${id}/disburse`);
}
export function getBankFile(id: string, format = 'CSV') {
  return api.get<BankFileResult>(`/payroll/runs/${id}/bank-file?format=${format}`);
}

// ---- Payslip ----

export function getPayslipUrl(employeeId: string, period: string) {
  return api.get<PayslipUrl>(`/payroll/payslips/${employeeId}?period=${period}`);
}

// ---- Full & Final ----

export function generateFnf(employeeId: string, advanceRecoveryAmount?: number) {
  return api.post<FullAndFinalSettlement>(`/payroll/fnf/${employeeId}`, { advanceRecoveryAmount });
}
export function getFnf(employeeId: string) {
  return api.get<FullAndFinalSettlement>(`/payroll/fnf/${employeeId}`);
}
export function updateFnfAdvance(employeeId: string, advanceRecoveryAmount: number) {
  return api.patch<FullAndFinalSettlement>(`/payroll/fnf/${employeeId}`, { advanceRecoveryAmount });
}
export function approveFnf(employeeId: string) {
  return api.post<FullAndFinalSettlement>(`/payroll/fnf/${employeeId}/approve`);
}
export function markFnfPaid(employeeId: string) {
  return api.post<FullAndFinalSettlement>(`/payroll/fnf/${employeeId}/mark-paid`);
}

/** Recently created/opened run ids this browser knows about — there is no
 *  `GET /payroll/runs` list endpoint yet (module 07 §9, still a `TODO(api)`
 *  gap even after Phase 8), so the Run tab keeps a small local memory of
 *  ids instead of inventing a server list. Purely a client-side convenience;
 *  never treated as a source of truth. */
const RECENT_RUNS_KEY = 'hrms.payroll.recentRuns';

export function rememberRun(id: string, period: string) {
  const list = recentRuns().filter((r) => r.id !== id);
  list.unshift({ id, period });
  localStorage.setItem(RECENT_RUNS_KEY, JSON.stringify(list.slice(0, 12)));
}

export function recentRuns(): Array<{ id: string; period: string }> {
  try {
    return JSON.parse(localStorage.getItem(RECENT_RUNS_KEY) ?? '[]');
  } catch {
    return [];
  }
}
