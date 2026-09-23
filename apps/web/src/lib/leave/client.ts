/**
 * Leave module API client.
 *
 * Every method documents the real endpoint it maps to and whether that
 * endpoint exists today (`live`) or is a near-term gap (`planned`, see
 * docs/MODULE_SPECS.md §4). Screens only ever import from here.
 *
 * Backend is fully wired & tested (module 04) — `USE_MOCK` now defaults to
 * **off**, same as `access/client.ts`. Set `VITE_LEAVE_MOCK=true` to force
 * the in-memory fixture store (e.g. running the UI with no API up).
 */
import { api } from '@/lib/api';
import type { Role } from '@/lib/roles';
import {
  MOCK_CURRENT_YEAR,
  MOCK_HOLIDAYS,
  MOCK_LEAVE_TYPES,
  MOCK_LEDGER,
  MOCK_PEOPLE,
  MOCK_REQUESTS,
  MOCK_SETTINGS,
  ME_ID,
  personName,
} from './fixtures';
import {
  availableDays,
  type AllRequestsFilter,
  type BalanceAdjustmentInput,
  type CreateLeaveRequestInput,
  type Holiday,
  type LeaveBalance,
  type LeaveLedgerEntry,
  type LeaveRequest,
  type LeaveRequestPreview,
  type LeaveSettings,
  type LeaveType,
  type TeamBalanceRow,
  type TeamCalendarEntry,
} from './types';

export const USE_MOCK = import.meta.env.VITE_LEAVE_MOCK === 'true';

export interface LeaveCtx {
  role: Role;
  /** The caller's own employee id (the real API reads this from the token). */
  employeeId: string;
}

// ---------------------------------------------------------------------------
// Mock store — mutable copies so a session's actions stick until reload.
// ---------------------------------------------------------------------------
const store = {
  types: MOCK_LEAVE_TYPES.map((t) => ({ ...t })),
  requests: MOCK_REQUESTS.map((r) => ({ ...r, approvals: r.approvals.map((a) => ({ ...a })) })),
  holidays: MOCK_HOLIDAYS.map((h) => ({ ...h })),
  ledger: MOCK_LEDGER.map((l) => ({ ...l })),
  settings: { ...MOCK_SETTINGS },
  adjustments: [] as { employeeId: string; leaveTypeId: string; year: number; delta: number }[],
};

function delay<T>(value: T, ms = 260): Promise<T> {
  return new Promise((res) => setTimeout(() => res(value), ms));
}
function uid(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 8)}`;
}
function daysBetween(start: string, end: string): number {
  const a = new Date(start + 'T00:00:00');
  const b = new Date(end + 'T00:00:00');
  return Math.max(1, Math.round((b.getTime() - a.getTime()) / 86_400_000) + 1);
}
function typeRef(t: LeaveType) {
  return { id: t.id, name: t.name, code: t.code, colorToken: t.colorToken };
}

/** Resolve the mock person id for a request scope. The signed-in user's real
 *  employeeId always maps onto the fixture's ME_ID so "my" data is stable. */
function scopeId(employeeId: string): string {
  return MOCK_PEOPLE.some((p) => p.id === employeeId) ? employeeId : ME_ID;
}

function computeBalances(employeeId: string, year: number): LeaveBalance[] {
  const me = scopeId(employeeId);
  const person = MOCK_PEOPLE.find((p) => p.id === me);
  return store.types
    .filter((t) => t.active)
    .filter((t) => t.genderRestriction === 'ANY' || !person || t.genderRestriction === person.gender)
    .map((t) => {
      const mine = store.requests.filter((r) => r.employeeId === me && r.leaveType.id === t.id);
      const used = mine
        .filter((r) => r.status === 'APPROVED' && !r.isLop)
        .reduce((s, r) => s + r.days, 0);
      const pending = mine
        .filter((r) => r.status === 'PENDING_L1' || r.status === 'PENDING_L2')
        .reduce((s, r) => s + r.days, 0);
      const carriedForward = store.ledger
        .filter((l) => l.employeeId === me && l.leaveTypeCode === t.code && l.source === 'CARRY_FORWARD')
        .reduce((s, l) => s + l.delta, 0);
      const adj = store.adjustments
        .filter((a) => a.employeeId === me && a.leaveTypeId === t.id && a.year === year)
        .reduce((s, a) => s + a.delta, 0);
      return {
        leaveTypeId: t.id,
        leaveType: typeRef(t),
        year,
        accrued: t.annualQuota + adj,
        carriedForward,
        used,
        pending,
      };
    });
}

function firstApproverName(employeeId: string): string | null {
  const me = scopeId(employeeId);
  const person = MOCK_PEOPLE.find((p) => p.id === me);
  if (person?.managerId && store.settings.approvalLevels === 2) return personName(person.managerId);
  return 'Meera Iyer'; // HR — L2 / sole approver
}

function directReportIds(ctx: LeaveCtx): string[] {
  if (ctx.role === 'COMPANY_ADMIN' || ctx.role === 'HR_MANAGER') return MOCK_PEOPLE.map((p) => p.id);
  // Line manager: the fixture manager 'emp-mgr-eng' stands in for the caller.
  return MOCK_PEOPLE.filter((p) => p.managerId === 'emp-mgr-eng').map((p) => p.id);
}

// ---------------------------------------------------------------------------

export const leaveApi = {
  /** `GET /api/leave/types?includeInactive=` · any tenant user · live */
  listTypes(includeInactive = false): Promise<LeaveType[]> {
    if (USE_MOCK) {
      return delay(store.types.filter((t) => includeInactive || t.active).map((t) => ({ ...t })));
    }
    return api.get<LeaveType[]>(`/leave/types${includeInactive ? '?includeInactive=true' : ''}`);
  },

  /** `POST /api/leave/types` · Company Admin, HR Manager · live. Every
   *  frontend `LeaveType` field round-trips through the API now. */
  createType(input: Omit<LeaveType, 'id'>): Promise<LeaveType> {
    if (USE_MOCK) {
      const t: LeaveType = { ...input, id: uid('lt') };
      store.types.push(t);
      return delay(t);
    }
    const {
      name,
      code,
      colorToken,
      annualQuota,
      carryForwardCap,
      minNoticeDays,
      active,
      accrualFrequency,
      genderRestriction,
      paid,
      requiresApproval,
      isCompOff,
    } = input;
    return api.post<LeaveType>('/leave/types', {
      name,
      code,
      colorToken,
      annualQuota,
      carryForwardCap,
      minNoticeDays,
      active,
      accrualFrequency,
      genderRestriction,
      paid,
      requiresApproval,
      isCompOff,
    });
  },

  /** `PATCH /api/leave/types/:id` · Company Admin, HR Manager · live (same backend-persisted subset as `createType`) */
  updateType(id: string, patch: Partial<LeaveType>): Promise<LeaveType> {
    if (USE_MOCK) {
      const t = store.types.find((x) => x.id === id);
      if (!t) return Promise.reject(new Error('Leave type not found'));
      Object.assign(t, patch);
      return delay({ ...t });
    }
    const {
      name,
      code,
      colorToken,
      annualQuota,
      carryForwardCap,
      minNoticeDays,
      active,
      accrualFrequency,
      genderRestriction,
      paid,
      requiresApproval,
      isCompOff,
    } = patch;
    return api.patch<LeaveType>(`/leave/types/${id}`, {
      name,
      code,
      colorToken,
      annualQuota,
      carryForwardCap,
      minNoticeDays,
      active,
      accrualFrequency,
      genderRestriction,
      paid,
      requiresApproval,
      isCompOff,
    });
  },

  /** `POST /api/leave/types/:id/initialize/:year` · Company Admin, HR Manager · live */
  initializeBalances(typeId: string, year: number): Promise<{ initialized: number }> {
    if (USE_MOCK) return delay({ initialized: MOCK_PEOPLE.length });
    return api.post<{ initialized: number }>(`/leave/types/${typeId}/initialize/${year}`);
  },

  /** `GET /api/leave/balances/:employeeId` · row-scoped · live */
  balances(employeeId: string, year = MOCK_CURRENT_YEAR): Promise<LeaveBalance[]> {
    if (USE_MOCK) return delay(computeBalances(employeeId, year));
    return api.get<LeaveBalance[]>(`/leave/balances/${employeeId}?year=${year}`);
  },

  /** `GET /api/leave/requests/employee/:employeeId` · row-scoped · live */
  requestsForEmployee(employeeId: string): Promise<LeaveRequest[]> {
    if (USE_MOCK) {
      const me = scopeId(employeeId);
      return delay(
        store.requests
          .filter((r) => r.employeeId === me)
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
          .map((r) => ({ ...r })),
      );
    }
    return api.get<LeaveRequest[]>(`/leave/requests/employee/${employeeId}`);
  },

  /** `GET /api/leave/requests/:id` · row-scoped · planned (list rows carry it today) */
  getRequest(id: string): Promise<LeaveRequest> {
    if (USE_MOCK) {
      const r = store.requests.find((x) => x.id === id);
      return r ? delay({ ...r }) : Promise.reject(new Error('Request not found'));
    }
    return api.get<LeaveRequest>(`/leave/requests/${id}`);
  },

  /** Client-side preview of the balance hit — no network in either mode.
   *  Mirrors the server's `apply()` math (inclusive calendar days, LOP if short). */
  async previewRequest(
    input: CreateLeaveRequestInput,
    employeeId: string,
  ): Promise<LeaveRequestPreview> {
    const year = new Date(input.startDate || Date.now()).getFullYear();
    const balances = USE_MOCK
      ? computeBalances(employeeId, year)
      : await api.get<LeaveBalance[]>(`/leave/balances/${employeeId}?year=${year}`);
    const bal = balances.find((b) => b.leaveTypeId === input.leaveTypeId);
    let days = input.startDate && input.endDate ? daysBetween(input.startDate, input.endDate) : 0;
    if (input.halfDay) days = 0.5;
    const before = bal ? availableDays(bal) : 0;
    const lopDays = Math.max(0, days - Math.max(before, 0));
    return {
      days,
      availableBefore: before,
      availableAfter: before - days,
      isLop: lopDays > 0,
      lopDays,
      firstApprover: firstApproverName(employeeId),
    };
  },

  /** `POST /api/leave/requests` · any tenant user · live */
  createRequest(input: CreateLeaveRequestInput, ctx: LeaveCtx): Promise<LeaveRequest> {
    if (USE_MOCK) {
      const type = store.types.find((t) => t.id === input.leaveTypeId)!;
      const preview = computeBalances(ctx.employeeId, new Date(input.startDate).getFullYear()).find(
        (b) => b.leaveTypeId === input.leaveTypeId,
      );
      let days = daysBetween(input.startDate, input.endDate);
      if (input.halfDay) days = 0.5;
      const avail = preview ? availableDays(preview) : 0;
      const isLop = days > Math.max(avail, 0);
      const person = MOCK_PEOPLE.find((p) => p.id === scopeId(ctx.employeeId))!;
      const startsAtL2 = !person.managerId || store.settings.approvalLevels === 1;
      const req: LeaveRequest = {
        id: uid('req'),
        employeeId: ME_ID,
        employee: { id: ME_ID, firstName: person.firstName, lastName: person.lastName, department: person.department },
        leaveType: typeRef(type),
        status: startsAtL2 ? 'PENDING_L2' : 'PENDING_L1',
        startDate: input.startDate,
        endDate: input.endDate,
        days,
        halfDay: !!input.halfDay,
        reason: input.reason ?? null,
        isLop,
        attachmentName: null,
        createdAt: new Date().toISOString(),
        approvals: [
          { level: 1, approverName: person.managerId ? personName(person.managerId) : '—', approverRole: 'Line Manager', decidedAt: null, decision: null, comment: null },
          { level: 2, approverName: 'Meera Iyer', approverRole: 'HR Manager', decidedAt: null, decision: null, comment: null },
        ],
      };
      store.requests.unshift(req);
      return delay(req);
    }
    return api.post<LeaveRequest>('/leave/requests', input);
  },

  /** `POST /api/leave/requests/:id/attachment` · applicant or HR/Admin · live (module 09 — replaces any earlier attachment) */
  attachToRequest(id: string, file: File): Promise<LeaveRequest> {
    if (USE_MOCK) {
      const r = store.requests.find((x) => x.id === id)!;
      r.attachmentName = file.name;
      r.attachment = { id: uid('doc'), label: file.name, scanStatus: 'CLEAN' };
      return delay(r);
    }
    return api.upload<LeaveRequest>(`/leave/requests/${id}/attachment`, file);
  },

  /** `POST /api/leave/requests/:id/cancel` · request owner · live */
  cancelRequest(id: string): Promise<void> {
    if (USE_MOCK) {
      const r = store.requests.find((x) => x.id === id);
      if (r) r.status = 'CANCELLED';
      return delay(undefined);
    }
    return api.post<void>(`/leave/requests/${id}/cancel`);
  },

  /** `GET /api/leave/requests/pending-approvals` · returns [] for non-approvers · live */
  pendingApprovals(ctx: LeaveCtx): Promise<LeaveRequest[]> {
    if (USE_MOCK) {
      const reports = directReportIds(ctx);
      const wantL1 = ctx.role === 'LINE_MANAGER';
      return delay(
        store.requests
          .filter((r) => reports.includes(r.employeeId) || r.employeeId === ME_ID)
          .filter((r) => (wantL1 ? r.status === 'PENDING_L1' : r.status === 'PENDING_L2' || r.status === 'PENDING_L1'))
          .map((r) => ({ ...r })),
      );
    }
    return api.get<LeaveRequest[]>('/leave/requests/pending-approvals');
  },

  /** `POST /api/leave/requests/:id/{approve|reject}` · Line Manager, HR, Company Admin · live
   *  (comment param is `planned` — today's endpoint takes no body). */
  decide(id: string, action: 'approve' | 'reject', ctx: LeaveCtx, comment?: string): Promise<LeaveRequest> {
    if (USE_MOCK) {
      const r = store.requests.find((x) => x.id === id);
      if (!r) return Promise.reject(new Error('Request not found'));
      const level = r.status === 'PENDING_L1' ? 1 : 2;
      const step = r.approvals.find((a) => a.level === level);
      if (step) {
        step.decision = action === 'approve' ? 'APPROVED' : 'REJECTED';
        step.decidedAt = new Date().toISOString();
        step.comment = comment ?? null;
        step.approverName = ctx.role === 'LINE_MANAGER' ? 'Rohan Mehta' : 'Meera Iyer';
      }
      if (action === 'reject') r.status = 'REJECTED';
      else if (level === 1 && store.settings.approvalLevels === 2) r.status = 'PENDING_L2';
      else r.status = 'APPROVED';
      return delay({ ...r });
    }
    return api.post<LeaveRequest>(`/leave/requests/${id}/${action}`, comment ? { comment } : undefined);
  },

  /** `GET /api/leave/calendar?from=&to=` · any tenant user · live (shape adapted) */
  teamCalendar(ctx: LeaveCtx, from: string, to: string): Promise<TeamCalendarEntry[]> {
    if (USE_MOCK) {
      const reports = directReportIds(ctx);
      return delay(
        store.requests
          .filter((r) => reports.includes(r.employeeId) || r.employeeId === ME_ID)
          .filter((r) => r.status === 'APPROVED' || r.status === 'PENDING_L1' || r.status === 'PENDING_L2')
          .filter((r) => r.endDate >= from && r.startDate <= to)
          .map((r) => ({
            requestId: r.id,
            employeeId: r.employeeId,
            employeeName: r.employeeId === ME_ID ? 'You' : `${r.employee.firstName} ${r.employee.lastName}`,
            leaveTypeCode: r.leaveType.code,
            colorToken: r.leaveType.colorToken,
            startDate: r.startDate,
            endDate: r.endDate,
            status: r.status,
          })),
      );
    }
    return api.get<TeamCalendarEntry[]>(`/leave/calendar?from=${from}&to=${to}`);
  },

  /** `GET /api/leave/team/balances?year=` · Line Manager, HR, Company Admin · planned */
  teamBalances(ctx: LeaveCtx, year = MOCK_CURRENT_YEAR): Promise<TeamBalanceRow[]> {
    if (USE_MOCK) {
      const reports = directReportIds(ctx).filter((id) => id !== ME_ID);
      return delay(
        reports.map((id) => {
          const p = MOCK_PEOPLE.find((x) => x.id === id)!;
          return {
            employeeId: id,
            employeeName: `${p.firstName} ${p.lastName}`,
            department: p.department,
            balances: computeBalances(id, year),
          };
        }),
      );
    }
    return api.get<TeamBalanceRow[]>(`/leave/team/balances?year=${year}`);
  },

  /** `GET /api/leave/requests?…` · HR, Company Admin, Auditor · planned */
  allRequests(filter: AllRequestsFilter = {}): Promise<LeaveRequest[]> {
    if (USE_MOCK) {
      let rows = store.requests.map((r) => ({ ...r }));
      if (filter.status && filter.status !== 'ALL') rows = rows.filter((r) => r.status === filter.status);
      if (filter.leaveTypeId) rows = rows.filter((r) => r.leaveType.id === filter.leaveTypeId);
      if (filter.department) rows = rows.filter((r) => r.employee.department === filter.department);
      if (filter.from) rows = rows.filter((r) => r.endDate >= filter.from!);
      if (filter.to) rows = rows.filter((r) => r.startDate <= filter.to!);
      if (filter.q) {
        const q = filter.q.toLowerCase();
        rows = rows.filter(
          (r) =>
            `${r.employee.firstName} ${r.employee.lastName}`.toLowerCase().includes(q) ||
            (r.reason ?? '').toLowerCase().includes(q),
        );
      }
      return delay(rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
    }
    const qs = new URLSearchParams(
      Object.entries(filter).filter(([, v]) => v && v !== 'ALL') as [string, string][],
    ).toString();
    return api.get<LeaveRequest[]>(`/leave/requests${qs ? `?${qs}` : ''}`);
  },

  /** `GET /api/leave/holidays?year=` · any tenant user · planned */
  listHolidays(year = MOCK_CURRENT_YEAR): Promise<Holiday[]> {
    if (USE_MOCK) {
      return delay(
        store.holidays
          .filter((h) => h.date.startsWith(String(year)))
          .sort((a, b) => a.date.localeCompare(b.date)),
      );
    }
    return api.get<Holiday[]>(`/leave/holidays?year=${year}`);
  },

  /** `POST /api/leave/holidays` · Company Admin, HR Manager · planned */
  createHoliday(input: Omit<Holiday, 'id'>): Promise<Holiday> {
    if (USE_MOCK) {
      const h = { ...input, id: uid('h') };
      store.holidays.push(h);
      return delay(h);
    }
    return api.post<Holiday>('/leave/holidays', input);
  },

  /** `PATCH /api/leave/holidays/:id` · Company Admin, HR Manager · planned */
  updateHoliday(id: string, patch: Partial<Holiday>): Promise<Holiday> {
    if (USE_MOCK) {
      const h = store.holidays.find((x) => x.id === id)!;
      Object.assign(h, patch);
      return delay({ ...h });
    }
    return api.patch<Holiday>(`/leave/holidays/${id}`, patch);
  },

  /** `DELETE /api/leave/holidays/:id` · Company Admin, HR Manager · planned */
  deleteHoliday(id: string): Promise<void> {
    if (USE_MOCK) {
      store.holidays = store.holidays.filter((h) => h.id !== id);
      return delay(undefined);
    }
    // api.ts has no delete helper yet — backend to add it with this endpoint.
    return api.post<void>(`/leave/holidays/${id}/delete`);
  },

  /** `POST /api/leave/balances/adjust` · Company Admin, HR Manager · planned */
  adjustBalance(input: BalanceAdjustmentInput, ctx: LeaveCtx): Promise<LeaveLedgerEntry> {
    if (USE_MOCK) {
      store.adjustments.push({
        employeeId: scopeId(input.employeeId),
        leaveTypeId: input.leaveTypeId,
        year: input.year,
        delta: input.delta,
      });
      const type = store.types.find((t) => t.id === input.leaveTypeId)!;
      const bal = computeBalances(input.employeeId, input.year).find((b) => b.leaveTypeId === input.leaveTypeId)!;
      const entry: LeaveLedgerEntry = {
        id: uid('l'),
        employeeId: scopeId(input.employeeId),
        employeeName: personName(scopeId(input.employeeId)),
        leaveTypeCode: type.code,
        at: new Date().toISOString(),
        delta: input.delta,
        balanceAfter: availableDays(bal),
        source: 'HR_ADJUSTMENT',
        note: input.note,
        actorName: ctx.role === 'HR_MANAGER' ? 'Meera Iyer' : 'Admin',
      };
      store.ledger.unshift(entry);
      return delay(entry);
    }
    return api.post<LeaveLedgerEntry>('/leave/balances/adjust', input);
  },

  /** `GET /api/leave/balances/ledger?…` · HR, Company Admin, Auditor · planned */
  ledger(filter: { employeeId?: string; leaveTypeCode?: string } = {}): Promise<LeaveLedgerEntry[]> {
    if (USE_MOCK) {
      let rows = store.ledger.map((l) => ({ ...l }));
      if (filter.employeeId) rows = rows.filter((l) => l.employeeId === scopeId(filter.employeeId!));
      if (filter.leaveTypeCode) rows = rows.filter((l) => l.leaveTypeCode === filter.leaveTypeCode);
      return delay(rows.sort((a, b) => b.at.localeCompare(a.at)));
    }
    const qs = new URLSearchParams(filter as Record<string, string>).toString();
    return api.get<LeaveLedgerEntry[]>(`/leave/balances/ledger${qs ? `?${qs}` : ''}`);
  },

  /** `GET /api/leave/settings` · Company Admin, HR Manager, Auditor · live.
   *  Backend field names differ from the frontend's (`leaveApprovalLevels`
   *  vs `approvalLevels`) — mapped here rather than renaming either side. */
  getSettings(): Promise<LeaveSettings> {
    if (USE_MOCK) return delay({ ...store.settings });
    return api
      .get<{ leaveApprovalLevels: 1 | 2; allowLopRequests: boolean; fyStartMonth: number }>(
        '/leave/settings',
      )
      .then((s) => ({
        approvalLevels: s.leaveApprovalLevels,
        allowLopRequests: s.allowLopRequests,
        fyStartMonth: s.fyStartMonth,
      }));
  },

  /** `PATCH /api/leave/settings` · Company Admin · live (see `getSettings` field mapping). */
  updateSettings(patch: Partial<LeaveSettings>): Promise<LeaveSettings> {
    if (USE_MOCK) {
      Object.assign(store.settings, patch);
      return delay({ ...store.settings });
    }
    return api
      .patch<{ leaveApprovalLevels: 1 | 2; allowLopRequests: boolean; fyStartMonth: number }>(
        '/leave/settings',
        {
          leaveApprovalLevels: patch.approvalLevels,
          allowLopRequests: patch.allowLopRequests,
          fyStartMonth: patch.fyStartMonth,
        },
      )
      .then((s) => ({
        approvalLevels: s.leaveApprovalLevels,
        allowLopRequests: s.allowLopRequests,
        fyStartMonth: s.fyStartMonth,
      }));
  },

  /** Directory slice the admin screens need for pickers. Real screens will use
   *  the Employees module's `GET /api/employees`; mocked here for isolation. */
  people(): Promise<{ id: string; name: string; department: string }[]> {
    if (USE_MOCK) {
      return delay(
        MOCK_PEOPLE.filter((p) => p.id !== ME_ID).map((p) => ({
          id: p.id,
          name: `${p.firstName} ${p.lastName}`,
          department: p.department,
        })),
      );
    }
    return api.get('/employees').then((rows: any) =>
      rows.map((e: any) => ({
        id: e.id,
        name: `${e.firstName} ${e.lastName}`,
        department: e.department?.name ?? '—',
      })),
    );
  },
};
