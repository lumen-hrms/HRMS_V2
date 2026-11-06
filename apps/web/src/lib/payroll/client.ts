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
  BankFilePreview,
  BankFormatOption,
  BankConfigResponse,
  SaveBankConfigInput,
  FullAndFinalSettlement,
  PayrollRun,
  PayrollRunSummary,
  PayrollPerson,
  Readiness,
  RunSummary,
  LineItemPage,
  LineItemQuery,
  LineItemDetail,
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
// The backend auto-upgrades this to a revision (new SalaryStructure +
// SalaryRevision + any arrears) if effectiveFrom affects an already-
// processed period — in that case the response is a ReviseStructureResult
// instead of a SalaryStructure. Callers should check for `revisionId`.
export function updateStructure(
  employeeId: string,
  input: {
    ctcAnnual: number;
    effectiveFrom: string;
    components: SalaryComponentInput[];
    reason?: string;
  },
) {
  return api.patch<SalaryStructure | ReviseStructureResult>(
    `/payroll/structures/${employeeId}`,
    input,
  );
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
export function listRuns() {
  return api.get<PayrollRunSummary[]>('/payroll/runs');
}
export function getReadiness(period: string) {
  return api.get<Readiness>(`/payroll/readiness?period=${period}`);
}
export function getRunSummary(id: string) {
  return api.get<RunSummary>(`/payroll/runs/${id}/summary`);
}
export function listLineItems(id: string, q: LineItemQuery) {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) {
    if (v !== undefined && v !== '' && v !== false) params.set(k, String(v));
  }
  return api.get<LineItemPage>(`/payroll/runs/${id}/line-items?${params}`);
}
export function getLineItemDetail(id: string, employeeId: string) {
  return api.get<LineItemDetail>(`/payroll/runs/${id}/line-items/${employeeId}`);
}
export function listPeople() {
  return api.get<PayrollPerson[]>('/payroll/people');
}
export function bulkSetWorkState(employeeIds: string[], workState: string) {
  return api.post<{ updated: number }>('/payroll/people/work-state', { employeeIds, workState });
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
export function previewBankFile(id: string, format = 'CSV') {
  return api.get<BankFilePreview>(`/payroll/runs/${id}/bank-file/preview?format=${format}`);
}
export function listBankFormats() {
  return api.get<BankFormatOption[]>('/payroll/bank-formats');
}
export function getBankConfig() {
  return api.get<BankConfigResponse>('/payroll/config/bank');
}
export function saveBankConfig(input: SaveBankConfigInput) {
  return api.put<BankConfigResponse>('/payroll/config/bank', input);
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
