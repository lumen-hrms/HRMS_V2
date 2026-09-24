import { escapeHtml } from '../notifications/templates';

export interface ContactNotifyInput {
  name: string;
  email: string;
  company?: string | null;
  phone?: string | null;
  message: string;
  appBaseUrl: string;
}

export interface RenderedContactEmail {
  subject: string;
  text: string;
  html: string;
}

/**
 * A dedicated, minimal renderer rather than reusing `notifications/
 * templates.ts`'s `renderEmail()` — that one's shell hardcodes a
 * tenant-facing footer ("Sent by <tenant> via Lumen HRMS... your HR
 * workspace") that doesn't fit an internal ops notification with no
 * tenant and no recipient account.
 */
export function renderContactNotifyEmail(input: ContactNotifyInput): RenderedContactEmail {
  const rows: [string, string][] = [
    ['Name', input.name],
    ['Email', input.email],
    ['Company', input.company || '—'],
    ['Phone', input.phone || '—'],
  ];
  const leadsUrl = `${input.appBaseUrl}/platform-admin/leads`;

  const subject = `New contact form submission from ${input.name}`.replace(/[\r\n]+/g, ' ');

  const text = [
    `${input.name} (${input.email}) submitted the contact form on the Lumen HRMS website.`,
    '',
    ...rows.map(([k, v]) => `${k}: ${v}`),
    '',
    'Message:',
    input.message,
    '',
    `View all leads: ${leadsUrl}`,
  ].join('\n');

  const rowsHtml = rows
    .map(
      ([k, v]) =>
        `<tr><td style="padding:4px 12px 4px 0;color:#6b7280;white-space:nowrap">${escapeHtml(k)}</td><td style="padding:4px 0">${escapeHtml(v)}</td></tr>`,
    )
    .join('');
  const html = `<!doctype html><html><body style="margin:0;padding:24px;background:#f5f5f4;font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#111827">
<div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:8px;padding:24px">
<p style="margin:0 0 16px;font-size:15px;line-height:1.5">${escapeHtml(input.name)} (${escapeHtml(input.email)}) submitted the contact form on the Lumen HRMS website.</p>
<table style="font-size:14px;border-collapse:collapse;margin:0 0 16px">${rowsHtml}</table>
<p style="margin:0 0 16px;font-size:14px;line-height:1.5;white-space:pre-wrap">${escapeHtml(input.message)}</p>
<a href="${escapeHtml(leadsUrl)}" style="display:inline-block;background:#1e2a4a;color:#ffffff;text-decoration:none;padding:10px 16px;border-radius:6px;font-size:14px">View in Platform Admin</a>
</div>
</body></html>`;

  return { subject, text, html };
}
