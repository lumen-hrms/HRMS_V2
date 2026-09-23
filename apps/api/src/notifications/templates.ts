import type { NotificationTemplate } from '@prisma/client';

/**
 * Module 10 email templates (docs/modules/10_NOTIFICATIONS.md §3.2). Pure
 * functions: `context` is the JSON stored on the `notification_log` row,
 * so a row can be re-rendered on retry exactly as first queued. Every
 * interpolated value is HTML-escaped (RULE-6).
 */

export interface LeaveContext {
  requestId: string;
  applicantName: string;
  leaveTypeName: string;
  startDate: string; // YYYY-MM-DD
  endDate: string;
  days: number;
  reason?: string | null;
}

export interface TemplateContexts {
  LEAVE_PENDING_APPROVAL: LeaveContext & { level: 1 | 2; escalated?: boolean };
  LEAVE_DECIDED: LeaveContext & {
    outcome: 'APPROVED' | 'REJECTED' | 'L1_APPROVED';
    comment?: string | null;
  };
  LEAVE_ESCALATED: LeaveContext;
  LEAVE_CANCELLED: LeaveContext & { wasApproved: boolean };
  REGULARIZATION_PENDING_APPROVAL: {
    requestId: string;
    applicantName: string;
    targetDate: string;
    reasonType: string;
    note?: string | null;
  };
  REGULARIZATION_DECIDED: {
    requestId: string;
    targetDate: string;
    outcome: 'APPROVED' | 'REJECTED';
    auto?: boolean;
    comment?: string | null;
  };
  DOCUMENT_BLOCKED: { documentLabel: string };
}

export type TemplateContext = TemplateContexts[keyof TemplateContexts];

export interface RenderOptions {
  appBaseUrl: string;
  tenantName: string;
}

export interface RenderedEmail {
  subject: string;
  text: string;
  html: string;
}

const REASON_LABELS: Record<string, string> = {
  MISSED_PUNCH_IN: 'Missed punch in',
  MISSED_PUNCH_OUT: 'Missed punch out',
  WRONG_PUNCH_TIME: 'Wrong punch time',
  FORGOT_TO_CLOCK_IN: 'Forgot to clock in',
  FORGOT_TO_CLOCK_OUT: 'Forgot to clock out',
  ON_DUTY_FIELD_WORK: 'On-duty / field work',
  OTHER: 'Other',
};

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function fmtDate(iso: string): string {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  return d.toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

function fmtRange(start: string, end: string): string {
  return start.slice(0, 10) === end.slice(0, 10)
    ? fmtDate(start)
    : `${fmtDate(start)} – ${fmtDate(end)}`;
}

function dayLabel(days: number): string {
  return `${days} day${days === 1 ? '' : 's'}`;
}

/** Plain paragraphs + key/value rows + one call-to-action link. */
export interface EmailBody {
  subject: string;
  intro: string;
  rows: [string, string][];
  outro?: string;
  cta: { label: string; path: string };
}

// `context` comes back from a JSON column, so it's typed loosely here; the
// typed `TemplateContexts` contract is enforced where rows are *written*
// (NotificationDispatcher.notify).
function body(template: NotificationTemplate, ctx: any): EmailBody {
  switch (template) {
    case 'LEAVE_PENDING_APPROVAL':
      return {
        subject: `${ctx.escalated ? '[Escalated] ' : ''}Leave request from ${ctx.applicantName} needs your approval`,
        intro: ctx.escalated
          ? `${ctx.applicantName}'s leave request wasn't decided within the escalation window and now needs final approval.`
          : `${ctx.applicantName} has applied for leave and it's waiting on your ${ctx.level === 1 ? 'approval' : 'final (HR) approval'}.`,
        rows: leaveRows(ctx),
        cta: { label: 'Review request', path: '/leave' },
      };
    case 'LEAVE_DECIDED': {
      const heading =
        ctx.outcome === 'APPROVED'
          ? 'approved'
          : ctx.outcome === 'REJECTED'
            ? 'rejected'
            : 'approved by your manager';
      return {
        subject: `Your leave request was ${heading}`,
        intro:
          ctx.outcome === 'L1_APPROVED'
            ? 'Your manager approved your leave request. It now goes to HR for final approval.'
            : `Your leave request was ${heading}.`,
        rows: [
          ...leaveRows(ctx),
          ...(ctx.comment ? ([['Comment', ctx.comment]] as [string, string][]) : []),
        ],
        cta: { label: 'View my requests', path: '/leave' },
      };
    }
    case 'LEAVE_ESCALATED':
      return {
        subject: `Overdue: leave request from ${ctx.applicantName} still awaiting final approval`,
        intro: `${ctx.applicantName}'s leave request has passed the escalation window at final approval and needs follow-up.`,
        rows: leaveRows(ctx),
        cta: { label: 'Review request', path: '/leave' },
      };
    case 'LEAVE_CANCELLED':
      return {
        subject: `${ctx.applicantName} cancelled a${ctx.wasApproved ? 'n approved' : ' pending'} leave request`,
        intro: ctx.wasApproved
          ? `${ctx.applicantName} cancelled leave that had already been approved. The days have been returned to their balance.`
          : `${ctx.applicantName} withdrew a leave request that was waiting on approval — no action needed.`,
        rows: leaveRows(ctx),
        cta: { label: 'Open Leave', path: '/leave' },
      };
    case 'REGULARIZATION_PENDING_APPROVAL':
      return {
        subject: `Attendance correction from ${ctx.applicantName} needs your approval`,
        intro: `${ctx.applicantName} has asked to correct their attendance.`,
        rows: [
          ['Date', fmtDate(ctx.targetDate)],
          ['Reason', REASON_LABELS[ctx.reasonType] ?? ctx.reasonType],
          ...(ctx.note ? ([['Note', ctx.note]] as [string, string][]) : []),
        ],
        cta: { label: 'Review request', path: '/attendance' },
      };
    case 'REGULARIZATION_DECIDED': {
      const verb = ctx.outcome === 'APPROVED' ? 'approved' : 'rejected';
      return {
        subject: `Your attendance correction for ${fmtDate(ctx.targetDate)} was ${verb}`,
        intro: ctx.auto
          ? `Your attendance correction wasn't decided before the payroll cut-off, so it was automatically ${verb} under your company's policy.`
          : `Your attendance correction was ${verb}.`,
        rows: [
          ['Date', fmtDate(ctx.targetDate)],
          ...(ctx.comment ? ([['Comment', ctx.comment]] as [string, string][]) : []),
        ],
        cta: { label: 'View attendance', path: '/attendance' },
      };
    }
    case 'DOCUMENT_BLOCKED':
      return {
        subject: `A file you uploaded was blocked: ${ctx.documentLabel}`,
        intro: `The file "${ctx.documentLabel}" failed the malware scan and was removed. It can't be downloaded.`,
        rows: [],
        outro:
          'If you believe this is a mistake, scan the file on your device and upload a clean copy.',
        cta: { label: 'Open HRMS', path: '/' },
      };
    default:
      throw new Error(`Unknown notification template: ${String(template)}`);
  }
}

function leaveRows(ctx: LeaveContext): [string, string][] {
  return [
    ['Employee', ctx.applicantName],
    ['Leave type', ctx.leaveTypeName],
    ['Dates', `${fmtRange(ctx.startDate, ctx.endDate)} (${dayLabel(ctx.days)})`],
    ...(ctx.reason ? ([['Reason', ctx.reason]] as [string, string][]) : []),
  ];
}

export function render(
  template: NotificationTemplate,
  context: unknown,
  opts: RenderOptions,
): RenderedEmail {
  return renderEmail(body(template, context), opts);
}

/**
 * The shared email shell — also used by the auth emails (password reset /
 * workspace invite, `auth-email.templates.ts`). `cta.path` is appended to
 * `appBaseUrl` unless it's already an absolute URL (a Firebase action link).
 */
export function renderEmail(b: EmailBody, opts: RenderOptions): RenderedEmail {
  const url = /^https?:\/\//.test(b.cta.path) ? b.cta.path : `${opts.appBaseUrl}${b.cta.path}`;
  const footer = `Sent by ${opts.tenantName} via Lumen HRMS. You're receiving this because of a request in your HR workspace.`;

  const text = [
    b.intro,
    '',
    ...b.rows.map(([k, v]) => `${k}: ${v}`),
    ...(b.outro ? ['', b.outro] : []),
    '',
    `${b.cta.label}: ${url}`,
    '',
    '—',
    footer,
  ].join('\n');

  const rows = b.rows
    .map(
      ([k, v]) =>
        `<tr><td style="padding:4px 12px 4px 0;color:#6b7280;white-space:nowrap">${escapeHtml(k)}</td><td style="padding:4px 0">${escapeHtml(v)}</td></tr>`,
    )
    .join('');
  const html = `<!doctype html><html><body style="margin:0;padding:24px;background:#f5f5f4;font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#111827">
<div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:8px;padding:24px">
<p style="margin:0 0 16px;font-size:15px;line-height:1.5">${escapeHtml(b.intro)}</p>
${rows ? `<table style="font-size:14px;border-collapse:collapse;margin:0 0 16px">${rows}</table>` : ''}
${b.outro ? `<p style="margin:0 0 16px;font-size:14px;line-height:1.5">${escapeHtml(b.outro)}</p>` : ''}
<a href="${escapeHtml(url)}" style="display:inline-block;background:#1e2a4a;color:#ffffff;text-decoration:none;padding:10px 16px;border-radius:6px;font-size:14px">${escapeHtml(b.cta.label)}</a>
</div>
<p style="max-width:560px;margin:12px auto 0;font-size:12px;color:#6b7280">${escapeHtml(footer)}</p>
</body></html>`;

  return { subject: b.subject.replace(/[\r\n]+/g, ' '), text, html };
}
