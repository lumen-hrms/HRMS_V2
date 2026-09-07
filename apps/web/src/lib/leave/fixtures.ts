/**
 * In-memory mock dataset for the Leave module.
 *
 * Why this exists: ~half the Leave screens (org-wide list, holiday CRUD,
 * balance adjustments, team balances, settings, ledger) have no backend yet
 * (docs/MODULE_SPECS.md §4 "Known gaps"). Building the UI against this fixture
 * store means every screen renders and every interaction round-trips, so the
 * screens are reviewable now and the mock doubles as the API contract.
 *
 * The store is mutable at runtime — mock mutations (apply / approve / adjust)
 * update it so the UI behaves like the real thing within a session. A reload
 * resets to this seed.
 */
import type {
  Holiday,
  LeaveLedgerEntry,
  LeaveRequest,
  LeaveSettings,
  LeaveType,
} from './types';

export const MOCK_CURRENT_YEAR = 2026;

export interface MockPerson {
  id: string;
  firstName: string;
  lastName: string;
  department: string;
  gender: 'FEMALE' | 'MALE';
  /** direct manager id, or null for department heads */
  managerId: string | null;
}

/** The signed-in employee, whatever their real seeded id, maps onto this one. */
export const ME_ID = 'me';

export const MOCK_PEOPLE: MockPerson[] = [
  { id: ME_ID, firstName: 'You', lastName: '', department: 'Engineering', gender: 'FEMALE', managerId: 'emp-mgr-eng' },
  { id: 'emp-mgr-eng', firstName: 'Rohan', lastName: 'Mehta', department: 'Engineering', gender: 'MALE', managerId: null },
  { id: 'emp-eng-2', firstName: 'Aditi', lastName: 'Rao', department: 'Engineering', gender: 'FEMALE', managerId: 'emp-mgr-eng' },
  { id: 'emp-eng-3', firstName: 'Karan', lastName: 'Shah', department: 'Engineering', gender: 'MALE', managerId: 'emp-mgr-eng' },
  { id: 'emp-eng-4', firstName: 'Neha', lastName: 'Gupta', department: 'Engineering', gender: 'FEMALE', managerId: 'emp-mgr-eng' },
  { id: 'emp-mgr-sales', firstName: 'Priya', lastName: 'Nair', department: 'Sales', gender: 'FEMALE', managerId: null },
  { id: 'emp-sales-2', firstName: 'Vikram', lastName: 'Singh', department: 'Sales', gender: 'MALE', managerId: 'emp-mgr-sales' },
  { id: 'emp-sales-3', firstName: 'Sana', lastName: 'Khan', department: 'Sales', gender: 'FEMALE', managerId: 'emp-mgr-sales' },
];

export function personName(id: string): string {
  const p = MOCK_PEOPLE.find((x) => x.id === id);
  if (!p) return 'Unknown';
  return `${p.firstName}${p.lastName ? ' ' + p.lastName : ''}`.trim();
}

export const MOCK_LEAVE_TYPES: LeaveType[] = [
  {
    id: 'lt-cl', name: 'Casual Leave', code: 'CL', annualQuota: 12, carryForwardCap: 0,
    accrualFrequency: 'MONTHLY', genderRestriction: 'ANY', minNoticeDays: 1, paid: true,
    requiresApproval: true, active: true, colorToken: 'var(--lumen-info)',
  },
  {
    id: 'lt-sl', name: 'Sick Leave', code: 'SL', annualQuota: 10, carryForwardCap: 0,
    accrualFrequency: 'ANNUAL', genderRestriction: 'ANY', minNoticeDays: 0, paid: true,
    requiresApproval: true, active: true, colorToken: 'var(--lumen-warning)',
  },
  {
    id: 'lt-el', name: 'Earned Leave', code: 'EL', annualQuota: 18, carryForwardCap: 30,
    accrualFrequency: 'MONTHLY', genderRestriction: 'ANY', minNoticeDays: 7, paid: true,
    requiresApproval: true, active: true, colorToken: 'var(--lumen-success)',
  },
  {
    id: 'lt-ml', name: 'Maternity Leave', code: 'ML', annualQuota: 182, carryForwardCap: 0,
    accrualFrequency: 'ANNUAL', genderRestriction: 'FEMALE', minNoticeDays: 30, paid: true,
    requiresApproval: true, active: true, colorToken: 'var(--lumen-purple)',
  },
];

export const MOCK_HOLIDAYS: Holiday[] = [
  { id: 'h1', date: '2026-01-01', name: "New Year's Day", optional: true },
  { id: 'h2', date: '2026-01-26', name: 'Republic Day', optional: false },
  { id: 'h3', date: '2026-03-06', name: 'Holi', optional: false },
  { id: 'h4', date: '2026-04-14', name: 'Dr. Ambedkar Jayanti', optional: true },
  { id: 'h5', date: '2026-05-01', name: 'May Day', optional: true },
  { id: 'h6', date: '2026-08-15', name: 'Independence Day', optional: false },
  { id: 'h7', date: '2026-10-02', name: 'Gandhi Jayanti', optional: false },
  { id: 'h8', date: '2026-10-20', name: 'Diwali', optional: false },
  { id: 'h9', date: '2026-12-25', name: 'Christmas', optional: false },
];

export const MOCK_SETTINGS: LeaveSettings = {
  approvalLevels: 2,
  allowLopRequests: true,
  fyStartMonth: 4,
};

function typeRef(t: LeaveType) {
  return { id: t.id, name: t.name, code: t.code, colorToken: t.colorToken };
}
function empRef(id: string) {
  const p = MOCK_PEOPLE.find((x) => x.id === id)!;
  return { id, firstName: p.firstName, lastName: p.lastName, department: p.department };
}

const [CL, SL, EL] = MOCK_LEAVE_TYPES;

export const MOCK_REQUESTS: LeaveRequest[] = [
  {
    id: 'req-1', employeeId: ME_ID, employee: empRef(ME_ID), leaveType: typeRef(CL),
    status: 'APPROVED', startDate: '2026-08-11', endDate: '2026-08-12', days: 2, halfDay: false,
    reason: 'Family function', isLop: false, attachmentName: null, createdAt: '2026-08-01T09:12:00Z',
    approvals: [
      { level: 1, approverName: 'Rohan Mehta', approverRole: 'Line Manager', decidedAt: '2026-08-02T05:00:00Z', decision: 'APPROVED', comment: 'Ok' },
      { level: 2, approverName: 'Meera Iyer', approverRole: 'HR Manager', decidedAt: '2026-08-03T06:30:00Z', decision: 'APPROVED', comment: null },
    ],
  },
  {
    id: 'req-2', employeeId: ME_ID, employee: empRef(ME_ID), leaveType: typeRef(SL),
    status: 'PENDING_L1', startDate: '2026-09-15', endDate: '2026-09-15', days: 1, halfDay: false,
    reason: 'Fever', isLop: false, attachmentName: null, createdAt: '2026-09-05T04:00:00Z',
    approvals: [
      { level: 1, approverName: 'Rohan Mehta', approverRole: 'Line Manager', decidedAt: null, decision: null, comment: null },
      { level: 2, approverName: 'Meera Iyer', approverRole: 'HR Manager', decidedAt: null, decision: null, comment: null },
    ],
  },
  {
    id: 'req-3', employeeId: ME_ID, employee: empRef(ME_ID), leaveType: typeRef(EL),
    status: 'REJECTED', startDate: '2026-07-01', endDate: '2026-07-05', days: 5, halfDay: false,
    reason: 'Trip', isLop: false, attachmentName: null, createdAt: '2026-06-10T10:00:00Z',
    approvals: [
      { level: 1, approverName: 'Rohan Mehta', approverRole: 'Line Manager', decidedAt: '2026-06-11T05:00:00Z', decision: 'REJECTED', comment: 'Release week — please replan' },
      { level: 2, approverName: 'Meera Iyer', approverRole: 'HR Manager', decidedAt: null, decision: null, comment: null },
    ],
  },
  {
    id: 'req-4', employeeId: 'emp-eng-2', employee: empRef('emp-eng-2'), leaveType: typeRef(CL),
    status: 'PENDING_L1', startDate: '2026-09-18', endDate: '2026-09-19', days: 2, halfDay: false,
    reason: 'Personal', isLop: false, attachmentName: null, createdAt: '2026-09-06T07:00:00Z',
    approvals: [
      { level: 1, approverName: 'Rohan Mehta', approverRole: 'Line Manager', decidedAt: null, decision: null, comment: null },
      { level: 2, approverName: 'Meera Iyer', approverRole: 'HR Manager', decidedAt: null, decision: null, comment: null },
    ],
  },
  {
    id: 'req-5', employeeId: 'emp-eng-3', employee: empRef('emp-eng-3'), leaveType: typeRef(EL),
    status: 'PENDING_L1', startDate: '2026-09-22', endDate: '2026-09-26', days: 5, halfDay: false,
    reason: 'Wedding in family', isLop: false, attachmentName: 'invite.pdf', createdAt: '2026-09-04T11:00:00Z',
    approvals: [
      { level: 1, approverName: 'Rohan Mehta', approverRole: 'Line Manager', decidedAt: null, decision: null, comment: null },
      { level: 2, approverName: 'Meera Iyer', approverRole: 'HR Manager', decidedAt: null, decision: null, comment: null },
    ],
  },
  {
    id: 'req-6', employeeId: 'emp-eng-4', employee: empRef('emp-eng-4'), leaveType: typeRef(CL),
    status: 'PENDING_L2', startDate: '2026-09-10', endDate: '2026-09-10', days: 1, halfDay: true,
    reason: 'Bank work', isLop: false, attachmentName: null, createdAt: '2026-09-02T08:00:00Z',
    approvals: [
      { level: 1, approverName: 'Rohan Mehta', approverRole: 'Line Manager', decidedAt: '2026-09-03T05:00:00Z', decision: 'APPROVED', comment: null },
      { level: 2, approverName: 'Meera Iyer', approverRole: 'HR Manager', decidedAt: null, decision: null, comment: null },
    ],
  },
  {
    id: 'req-7', employeeId: 'emp-sales-2', employee: empRef('emp-sales-2'), leaveType: typeRef(EL),
    status: 'APPROVED', startDate: '2026-08-25', endDate: '2026-08-29', days: 5, halfDay: false,
    reason: 'Vacation', isLop: false, attachmentName: null, createdAt: '2026-08-01T09:00:00Z',
    approvals: [
      { level: 1, approverName: 'Priya Nair', approverRole: 'Line Manager', decidedAt: '2026-08-02T05:00:00Z', decision: 'APPROVED', comment: null },
      { level: 2, approverName: 'Meera Iyer', approverRole: 'HR Manager', decidedAt: '2026-08-02T09:00:00Z', decision: 'APPROVED', comment: null },
    ],
  },
  {
    id: 'req-8', employeeId: 'emp-sales-3', employee: empRef('emp-sales-3'), leaveType: typeRef(SL),
    status: 'PENDING_L1', startDate: '2026-09-12', endDate: '2026-09-13', days: 2, halfDay: false,
    reason: null, isLop: true, attachmentName: null, createdAt: '2026-09-07T03:00:00Z',
    approvals: [
      { level: 1, approverName: 'Priya Nair', approverRole: 'Line Manager', decidedAt: null, decision: null, comment: null },
      { level: 2, approverName: 'Meera Iyer', approverRole: 'HR Manager', decidedAt: null, decision: null, comment: null },
    ],
  },
];

export const MOCK_LEDGER: LeaveLedgerEntry[] = [
  { id: 'l1', employeeId: ME_ID, employeeName: 'You', leaveTypeCode: 'CL', at: '2026-01-01T00:00:00Z', delta: 12, balanceAfter: 12, source: 'ACCRUAL', note: 'Annual allotment', actorName: 'System' },
  { id: 'l2', employeeId: ME_ID, employeeName: 'You', leaveTypeCode: 'EL', at: '2026-01-01T00:00:00Z', delta: 6, balanceAfter: 6, source: 'CARRY_FORWARD', note: 'From 2025 (capped at 30)', actorName: 'System' },
  { id: 'l3', employeeId: ME_ID, employeeName: 'You', leaveTypeCode: 'CL', at: '2026-08-03T06:30:00Z', delta: -2, balanceAfter: 10, source: 'REQUEST_APPROVED', note: 'req-1 · 11–12 Aug', actorName: 'Meera Iyer' },
  { id: 'l4', employeeId: 'emp-eng-3', employeeName: 'Karan Shah', leaveTypeCode: 'EL', at: '2026-05-20T09:00:00Z', delta: 3, balanceAfter: 14, source: 'HR_ADJUSTMENT', note: 'Comp-off conversion approved by HR', actorName: 'Meera Iyer' },
  { id: 'l5', employeeId: 'emp-sales-2', employeeName: 'Vikram Singh', leaveTypeCode: 'EL', at: '2026-08-02T09:00:00Z', delta: -5, balanceAfter: 9, source: 'REQUEST_APPROVED', note: 'req-7 · 25–29 Aug', actorName: 'Meera Iyer' },
];
