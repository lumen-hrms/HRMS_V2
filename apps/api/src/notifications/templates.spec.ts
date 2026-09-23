import type { NotificationTemplate } from '@prisma/client';
import { escapeHtml, render } from './templates';

const OPTS = { appBaseUrl: 'https://hrms.example', tenantName: 'Acme Hospital' };
const LEAVE = {
  requestId: 'lr-1',
  applicantName: 'Asha Rao',
  leaveTypeName: 'Sick Leave',
  startDate: '2026-10-01',
  endDate: '2026-10-03',
  days: 3,
  reason: 'Fever',
};

const CASES: [NotificationTemplate, object, RegExp, string][] = [
  ['LEAVE_PENDING_APPROVAL', { ...LEAVE, level: 1 }, /Asha Rao needs your approval/, '/leave'],
  ['LEAVE_PENDING_APPROVAL', { ...LEAVE, level: 2, escalated: true }, /^\[Escalated\]/, '/leave'],
  ['LEAVE_DECIDED', { ...LEAVE, outcome: 'APPROVED' }, /was approved$/, '/leave'],
  [
    'LEAVE_DECIDED',
    { ...LEAVE, outcome: 'REJECTED', comment: 'Busy week' },
    /was rejected$/,
    '/leave',
  ],
  ['LEAVE_DECIDED', { ...LEAVE, outcome: 'L1_APPROVED' }, /approved by your manager/, '/leave'],
  ['LEAVE_ESCALATED', LEAVE, /^Overdue/, '/leave'],
  ['LEAVE_CANCELLED', { ...LEAVE, wasApproved: true }, /cancelled an approved/, '/leave'],
  [
    'REGULARIZATION_PENDING_APPROVAL',
    {
      requestId: 'r-1',
      applicantName: 'Asha Rao',
      targetDate: '2026-09-20',
      reasonType: 'MISSED_PUNCH_OUT',
    },
    /Attendance correction from Asha Rao/,
    '/attendance',
  ],
  [
    'REGULARIZATION_DECIDED',
    { requestId: 'r-1', targetDate: '2026-09-20', outcome: 'APPROVED', auto: true },
    /20 Sept 2026 was approved|20 Sep 2026 was approved/,
    '/attendance',
  ],
  ['DOCUMENT_BLOCKED', { documentLabel: 'payslip.pdf' }, /blocked: payslip\.pdf/, '/'],
];

describe('render()', () => {
  it.each(CASES)(
    '%s renders subject, text and html with a working link',
    (template, ctx, subject, path) => {
      const email = render(template, ctx, OPTS);
      expect(email.subject).toMatch(subject);
      expect(email.text).toContain(`https://hrms.example${path}`);
      expect(email.html).toContain(`href="https://hrms.example${path}"`);
      expect(email.text).toContain('Sent by Acme Hospital via Lumen HRMS');
    },
  );

  it('includes the leave details and decision comment', () => {
    const email = render(
      'LEAVE_DECIDED',
      { ...LEAVE, outcome: 'REJECTED', comment: 'Busy week' },
      OPTS,
    );
    expect(email.text).toContain('Leave type: Sick Leave');
    expect(email.text).toContain('(3 days)');
    expect(email.text).toContain('Comment: Busy week');
    expect(email.text).toContain('Reason: Fever');
  });

  it('says so when a regularization was auto-resolved at the payroll cut-off', () => {
    const email = render(
      'REGULARIZATION_DECIDED',
      { requestId: 'r-1', targetDate: '2026-09-20', outcome: 'REJECTED', auto: true },
      OPTS,
    );
    expect(email.text).toMatch(/automatically rejected/);
  });

  it('escapes user-supplied text in the HTML body (RULE-6)', () => {
    const email = render(
      'LEAVE_PENDING_APPROVAL',
      { ...LEAVE, level: 1, applicantName: '<img src=x onerror=alert(1)>', reason: '"a" & b' },
      { ...OPTS, tenantName: '<b>Evil</b>' },
    );
    expect(email.html).not.toContain('<img');
    expect(email.html).not.toContain('<b>Evil</b>');
    expect(email.html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(email.html).toContain('&quot;a&quot; &amp; b');
  });

  it('never lets a newline into the subject (header injection)', () => {
    const email = render('DOCUMENT_BLOCKED', { documentLabel: 'x\r\nBcc: evil@x.test' }, OPTS);
    expect(email.subject).not.toMatch(/[\r\n]/);
  });

  it('throws on an unknown template rather than sending something blank', () => {
    expect(() => render('NOPE' as NotificationTemplate, {}, OPTS)).toThrow(
      /Unknown notification template/,
    );
  });

  it('escapeHtml covers the five special characters', () => {
    expect(escapeHtml(`<>&"'`)).toBe('&lt;&gt;&amp;&quot;&#39;');
  });
});
