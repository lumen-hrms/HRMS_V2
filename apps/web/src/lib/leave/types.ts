/**
 * Leave module — frontend contract.
 *
 * This is the shape every Leave screen is built against. It is deliberately the
 * FULL intended surface (V1 + the near-term gaps in docs/MODULE_SPECS.md §4),
 * not just what the API returns today. Where an endpoint isn't built yet it's
 * marked `planned` in client.ts and served from fixtures.ts so the screen is
 * still runnable and the backend has a concrete target.
 *
 * When packages/shared-types starts carrying real DTOs, these move there and
 * this file re-exports them.
 */

import type { DocumentRef } from '@/lib/documents';

export type LeaveRequestStatus =
  | 'PENDING_L1'
  | 'PENDING_L2'
  | 'APPROVED'
  | 'REJECTED'
  | 'CANCELLED';

export type LeaveApprovalLevel = 1 | 2;

export type AccrualFrequency = 'ANNUAL' | 'MONTHLY' | 'QUARTERLY';
export type GenderRestriction = 'ANY' | 'FEMALE' | 'MALE';

export interface LeaveType {
  id: string;
  name: string;
  /** Short code shown in dense tables, e.g. CL / SL / EL. */
  code: string;
  annualQuota: number;
  carryForwardCap: number;
  accrualFrequency: AccrualFrequency;
  genderRestriction: GenderRestriction;
  /** Min calendar-days notice before start date; 0 = none. */
  minNoticeDays: number;
  paid: boolean;
  requiresApproval: boolean;
  /** Soft-delete / hide from the apply form without losing history. */
  active: boolean;
  colorToken: string; // a --lumen-* / palette token for calendar chips
  /** Marks this as the tenant's designated comp-off type — earned via
   *  LeaveService.creditCompOff() when someone works a holiday/weekly-off
   *  day, not applied for directly. At most one expected per tenant. */
  isCompOff: boolean;
}

export interface LeaveBalance {
  leaveTypeId: string;
  leaveType: Pick<LeaveType, 'id' | 'name' | 'code' | 'colorToken'>;
  year: number;
  /** Quota accrued so far this year (may be < annualQuota mid-year). */
  accrued: number;
  /** Brought forward from last year, already capped. */
  carriedForward: number;
  used: number;
  /** Approved-but-future days held against the balance. */
  pending: number;
}

/** accrued + carriedForward − used − pending. Computed client-side too. */
export function availableDays(b: LeaveBalance): number {
  return b.accrued + b.carriedForward - b.used - b.pending;
}

export interface LeaveApprovalStep {
  level: LeaveApprovalLevel;
  approverName: string;
  approverRole: string;
  decidedAt: string | null;
  decision: 'APPROVED' | 'REJECTED' | null;
  comment: string | null;
}

export interface LeaveRequest {
  id: string;
  employeeId: string;
  employee: { id: string; firstName: string; lastName: string; department: string | null };
  leaveType: Pick<LeaveType, 'id' | 'name' | 'code' | 'colorToken'>;
  status: LeaveRequestStatus;
  startDate: string; // ISO date
  endDate: string;
  /** Inclusive calendar-day count (V1 scope cut — not working days yet). */
  days: number;
  halfDay: boolean;
  reason: string | null;
  isLop: boolean;
  attachmentName: string | null;
  /** Supporting document (module 09) — downloadable only once `scanStatus` is CLEAN. */
  attachment?: DocumentRef | null;
  createdAt: string;
  approvals: LeaveApprovalStep[];
}

export interface CreateLeaveRequestInput {
  leaveTypeId: string;
  startDate: string;
  endDate: string;
  halfDay?: boolean;
  reason?: string;
}

/** Preview the balance hit + LOP verdict before the employee submits. */
export interface LeaveRequestPreview {
  days: number;
  availableBefore: number;
  availableAfter: number;
  isLop: boolean;
  lopDays: number;
  firstApprover: string | null;
}

export interface Holiday {
  id: string;
  date: string; // ISO date
  name: string;
  optional: boolean;
}

export interface TeamCalendarEntry {
  requestId: string;
  employeeId: string;
  employeeName: string;
  leaveTypeCode: string;
  colorToken: string;
  startDate: string;
  endDate: string;
  status: LeaveRequestStatus;
}

export interface TeamBalanceRow {
  employeeId: string;
  employeeName: string;
  department: string | null;
  balances: LeaveBalance[];
}

export interface LeaveLedgerEntry {
  id: string;
  employeeId: string;
  employeeName: string;
  leaveTypeCode: string;
  at: string;
  /** + credit (accrual, carry-forward, cancellation reversal), − debit (usage). */
  delta: number;
  balanceAfter: number;
  source: 'ACCRUAL' | 'CARRY_FORWARD' | 'REQUEST_APPROVED' | 'REQUEST_CANCELLED' | 'HR_ADJUSTMENT';
  note: string | null;
  actorName: string;
}

export interface BalanceAdjustmentInput {
  employeeId: string;
  leaveTypeId: string;
  year: number;
  /** Signed day count to apply. */
  delta: number;
  note: string;
}

export interface LeaveSettings {
  /** tenant_settings.leave_approval_levels — 1 or 2 for V1. */
  approvalLevels: LeaveApprovalLevel;
  /** Allow submitting a request that will be LOP. */
  allowLopRequests: boolean;
  /** Financial-year start month (1–12); India default April = 4. */
  fyStartMonth: number;
}

export interface AllRequestsFilter {
  status?: LeaveRequestStatus | 'ALL';
  leaveTypeId?: string;
  department?: string;
  from?: string;
  to?: string;
  q?: string;
}

export const STATUS_LABELS: Record<LeaveRequestStatus, string> = {
  PENDING_L1: 'Pending — Manager',
  PENDING_L2: 'Pending — HR',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  CANCELLED: 'Cancelled',
};

export const ACCRUAL_LABELS: Record<AccrualFrequency, string> = {
  ANNUAL: 'Annually',
  MONTHLY: 'Monthly',
  QUARTERLY: 'Quarterly',
};
