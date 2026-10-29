import { SUGGESTED_LEAVE_TYPES, type SetupDraft } from './setup.types';

/** A complete, valid company-setup draft for unit tests to start from and break one field at a time. */
export function validDraft(overrides: Partial<SetupDraft> = {}): SetupDraft {
  return {
    version: 1,
    goLiveDate: '2026-10-01',
    company: {
      legalName: 'Acme Health Pvt Ltd',
      addressLine1: '12 MG Road',
      city: 'Pune',
      state: 'MAHARASHTRA',
      pincode: '411001',
      contactEmail: 'hr@acme.example',
      contactPhone: '9876543210',
    },
    profile: {
      notAnEmployee: false,
      forUserId: 'user-ca',
      employeeCode: 'ACME-001',
      firstName: 'Ani',
      lastName: 'G',
      designation: 'Founder',
      departmentName: 'Leadership',
      dateOfJoining: '2024-01-01',
      gender: 'Male',
      workState: 'MAHARASHTRA',
      phone: '9876543210',
    },
    departments: [{ name: 'Leadership' }, { name: 'Engineering' }],
    workWeek: { timezone: 'Asia/Kolkata', weeklyOffDays: [0, 6] },
    shifts: [
      {
        name: 'General',
        type: 'FIXED',
        startTime: '09:00',
        endTime: '18:00',
        graceMinutes: 15,
        minHoursFullDay: 8,
        minHoursHalfDay: 4,
        isDefault: true,
      },
    ],
    attendance: {
      mode: 'SELF_SERVICE',
      captureMethods: ['WEB'],
      regularizationWindowDays: 7,
      regularizationMonthlyCap: 3,
      unactionedBehavior: 'AUTO_APPROVE',
      payrollCutoffDay: 25,
    },
    holidays: [
      { date: '2026-10-02', name: 'Gandhi Jayanti', optional: false },
      { date: '2026-11-09', name: 'Diwali', optional: false },
      { date: '2027-03-04', name: 'Holi', optional: true },
      { date: '2027-01-26', name: 'Republic Day', optional: false },
    ],
    leavePolicy: {
      fyStartMonth: 4,
      leaveApprovalLevels: 2,
      leaveEscalationDays: 3,
      allowLopRequests: true,
      types: SUGGESTED_LEAVE_TYPES.map((t) => ({
        ...t,
        annualQuota: t.isRestrictedHoliday ? 1 : t.annualQuota,
      })),
    },
    employeeFile: null,
    openingBalanceFile: null,
    ...overrides,
  };
}
