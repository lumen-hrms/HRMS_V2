/**
 * Payroll module types. Mirrors the API responses from `apps/api/src/payroll`
 * (Phases 1-8, all live — see docs/modules/07_PAYROLL_ENGINE.md §9). Money
 * fields are strings over the wire (Prisma `Decimal` serializes that way);
 * screens format them with `formatMoney` from `pages/payroll/components/money`.
 */

export type SalaryComponentType =
  | 'BASIC'
  | 'DA'
  | 'HRA'
  | 'SPECIAL_ALLOWANCE'
  | 'CONVEYANCE'
  | 'LTA'
  | 'MEDICAL'
  | 'CUSTOM'
  | 'PF_EMPLOYER'
  | 'ESI_EMPLOYER'
  | 'GRATUITY_PROVISION';

export type SalaryCalculationMode = 'FIXED' | 'PERCENT_OF_BASIC' | 'PERCENT_OF_CTC' | 'FORMULA';

export interface SalaryComponent {
  id: string;
  code: string;
  type: SalaryComponentType;
  name: string;
  calculationMode: SalaryCalculationMode;
  value: string | null;
  formula: string | null;
  sortOrder: number;
  monthlyAmount: string;
}

export interface SalaryComponentInput {
  type: SalaryComponentType;
  code?: string;
  name: string;
  calculationMode: SalaryCalculationMode;
  value?: number;
  formula?: string;
  sortOrder?: number;
}

export interface SalaryStructure {
  id: string;
  employeeId: string;
  ctcAnnual: string;
  effectiveFrom: string;
  status: 'ACTIVE' | 'SUPERSEDED';
  monthlyCtc: string;
  basicPercentOfCtc: string | null;
  components: SalaryComponent[];
}

export interface ReviseStructureResult {
  revisionId: string;
  newStructureId: string;
  arrearsGenerated: number;
  arrearsPeriods: string[];
}

export interface PayrollSettings {
  minBasicPercent: string;
  epfCeiling: string;
  allowEpfAboveCeiling: boolean;
  epfEmployeeRate: string;
  epsRate: string;
  epfEmployerRate: string;
  epfAdminRate: string;
  edliRate: string;
  esiWageCeiling: string;
  esiEmployeeRate: string;
  esiEmployerRate: string;
  overtimeEnabled: boolean;
  overtimeMultiplier: string;
  leaveEncashmentDivisor: string;
  leaveEncashmentComponents: string[];
  gratuityEligibilityYears: number;
  gratuityDaysPerYear: string;
  gratuityMonthDivisor: string;
}

export interface PtSlab {
  state: string;
  grossFrom: string;
  grossTo: string | null;
  monthlyAmount: string;
  februaryAmount: string | null;
}

export type TaxRegime = 'OLD' | 'NEW';

export interface TaxSlab {
  regime: TaxRegime;
  incomeFrom: string;
  incomeTo: string | null;
  ratePercent: string;
}

export interface TaxRegimeConfig {
  standardDeduction: string;
  cessPercent: string;
  rebateThreshold: string;
  rebateMaxAmount: string;
}

export interface TaxConfig {
  OLD: { slabs: TaxSlab[]; config: TaxRegimeConfig };
  NEW: { slabs: TaxSlab[]; config: TaxRegimeConfig };
}

export interface TdsRegimeChoice {
  employeeId: string;
  financialYear: string;
  regime: TaxRegime;
  setByUserId: string | null;
}

export type PayrollRunStatus = 'DRAFT' | 'REVIEW' | 'APPROVED' | 'PROCESSED' | 'DISBURSED';

export interface RunException {
  employeeId?: string;
  type:
    | 'NO_WORK_STATE'
    | 'NO_SALARY_STRUCTURE'
    | 'CALCULATION_ERROR'
    | 'PENDING_REGULARIZATIONS'
    | 'NO_DOB_FOR_PAYSLIP';
  detail: string;
}

export interface RunApproval {
  id?: string;
  approverId: string;
  approvedAt: string;
}

export interface AdHocAdjustment {
  type: string;
  amount: number;
  note?: string;
}

export interface PayrollLineItem {
  id: string;
  employeeId: string;
  calculationSnapshot: Record<string, unknown>;
  workingDays: number;
  payableDays: number;
  lopDays: number;
  grossEarnings: string;
  epfEmployee: string;
  epfEmployer: string;
  esiEmployee: string;
  esiEmployer: string;
  professionalTax: string;
  tdsDeducted: string;
  adHocAdjustments: AdHocAdjustment[];
  netPay: string;
  payslipFileKey: string | null;
}

export interface PayrollRun {
  id: string;
  period: string;
  status: PayrollRunStatus;
  isReprocess: boolean;
  reprocessReason: string | null;
  preparedBy: string;
  exceptions: RunException[];
  processedAt: string | null;
  disbursedAt: string | null;
  approvals: RunApproval[];
  lineItems?: PayrollLineItem[];
  // Auditor's reduced shape omits lineItems/amounts in favour of these.
  lineItemCount?: number;
  exceptionCount?: number;
}

export interface BankFileResult {
  filename: string;
  mimeType: string;
  content: string;
  skippedEmployeeCount: number;
}

export interface PayslipUrl {
  url: string;
  expiresInSeconds: number;
}

export type FullAndFinalStatus = 'DRAFT' | 'APPROVED' | 'PAID';

export interface FullAndFinalSettlement {
  employeeId: string;
  separationDate: string;
  status: FullAndFinalStatus;
  approvedAt: string | null;
  paidAt: string | null;
  // Present for HR/Admin and the employee's own read; omitted from the
  // Auditor's reduced view (decision 9).
  unpaidSalaryDays?: number;
  unpaidSalaryAmount?: string;
  leaveEncashmentDays?: string;
  leaveEncashmentAmount?: string;
  gratuityYearsOfService?: number;
  gratuityAmount?: string;
  advanceRecoveryAmount?: string;
  netSettlement?: string;
  preparedBy?: string;
  approvedBy?: string | null;
}

export interface EmployeeSummary {
  id: string;
  employeeCode: string;
  firstName: string;
  lastName: string;
  designation: string | null;
  lifecycleState: string;
  department: { name: string } | null;
}
