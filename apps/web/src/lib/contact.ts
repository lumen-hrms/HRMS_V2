/**
 * Public "Contact us" form on the landing page — pre-auth, no tenant
 * concept, same shape as `requestPasswordReset` in `lib/api.ts` (a raw
 * fetch, no Firebase token, no X-Tenant-Subdomain header).
 */
import { ApiError } from './api';

export interface ContactFormInput {
  name: string;
  email: string;
  company?: string;
  phone?: string;
  message: string;
}

export async function submitContactForm(input: ContactFormInput): Promise<void> {
  const res = await fetch('/api/contact', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new ApiError(res.status, text ? JSON.parse(text) : null);
  }
}
