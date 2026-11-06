import * as React from 'react';
import { ChevronRight, Loader2 } from 'lucide-react';
import { isApiError } from '@/lib/api';
import { submitContactForm } from '@/lib/contact';
import { COUNTRIES, joinPhone, phoneError, splitPhone } from '@/lib/phone';

type ContactStatus = 'idle' | 'sending' | 'sent' | 'error';

export function Contact() {
  const [name, setName] = React.useState('');
  const [email, setEmail] = React.useState('');
  const [company, setCompany] = React.useState('');
  const [phone, setPhone] = React.useState('');
  const [phoneCountry, setPhoneCountry] = React.useState('IN');
  const [phoneMsg, setPhoneMsg] = React.useState<string | undefined>();
  const [message, setMessage] = React.useState('');
  const [status, setStatus] = React.useState<ContactStatus>('idle');
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    const timer = window.setTimeout(() => setPhoneMsg(phoneError(phone)), 400);
    return () => window.clearTimeout(timer);
  }, [phone]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const bad = phoneError(phone);
    if (bad) {
      setPhoneMsg(bad);
      return;
    }
    setStatus('sending');
    setError(null);
    try {
      await submitContactForm({
        name,
        email,
        company,
        phone,
        message,
      });
      setStatus('sent');
      setName('');
      setEmail('');
      setCompany('');
      setPhone('');
      setPhoneMsg(undefined);
      setMessage('');
    } catch (err) {
      setStatus('error');
      setError(
        isApiError(err) && err.status === 429
          ? "You've sent a few of these already. Please wait a few minutes and try again."
          : 'Something went wrong sending your message. Please try again in a moment.',
      );
    }
  }

  return (
    <section id="contact" className="scroll-mt-24 px-6 pt-10 pb-28 sm:pb-36">
      <div className="mx-auto max-w-2xl">
        <div data-reveal className="text-center">
          <h2 className="display-title">Let's talk.</h2>
          <p className="mx-auto mt-5 max-w-md text-lg leading-relaxed text-[var(--text-2)]">
            Tell us about your team. We'll get back to you shortly.
          </p>
        </div>

        <div data-reveal className="tile mt-12 rounded-3xl p-6 sm:p-10">
          {status === 'sent' ? (
            <div className="flex flex-col items-center gap-3 py-10 text-center">
              <h3 className="text-2xl font-semibold tracking-tight">Message sent.</h3>
              <p className="max-w-sm text-[var(--text-2)]">
                We'll get back to you at the email you gave us.
              </p>
              <button
                type="button"
                onClick={() => setStatus('idle')}
                className="text-link mt-3 inline-flex items-center gap-0.5 text-[15px]"
              >
                Send another <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          ) : (
            <form onSubmit={onSubmit} className="grid grid-cols-1 gap-5 sm:grid-cols-2">
              <label className="flex flex-col gap-1.5 text-sm font-medium">
                <span className="text-[var(--text-2)]">Name</span>
                <input
                  required
                  minLength={2}
                  maxLength={200}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="form-field rounded-xl px-3.5 py-2.5 text-[15px]"
                />
              </label>
              <label className="flex flex-col gap-1.5 text-sm font-medium">
                <span className="text-[var(--text-2)]">Work email</span>
                <input
                  required
                  type="email"
                  maxLength={320}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="form-field rounded-xl px-3.5 py-2.5 text-[15px]"
                />
              </label>
              <label className="flex flex-col gap-1.5 text-sm font-medium">
                <span className="text-[var(--text-2)]">Company</span>
                <input
                  required
                  minLength={2}
                  maxLength={200}
                  value={company}
                  onChange={(e) => setCompany(e.target.value)}
                  className="form-field rounded-xl px-3.5 py-2.5 text-[15px]"
                />
              </label>
              <label className="flex flex-col gap-1.5 text-sm font-medium">
                <span className="text-[var(--text-2)]">Phone</span>
                <div className="flex gap-3">
                  <select
                    aria-label="Country code"
                    value={phoneCountry}
                    onChange={(e) => {
                      setPhoneCountry(e.target.value);
                      setPhone(joinPhone(e.target.value, splitPhone(phone).national));
                    }}
                    className="form-field w-28 shrink-0 rounded-xl px-2.5 py-2.5 text-[15px]"
                  >
                    {COUNTRIES.map((c) => (
                      <option key={c.code} value={c.code}>
                        {c.code} +{c.dial}
                      </option>
                    ))}
                  </select>
                  <input
                    required
                    type="tel"
                    inputMode="tel"
                    value={splitPhone(phone).national}
                    onChange={(e) => setPhone(joinPhone(phone ? splitPhone(phone).country : phoneCountry, e.target.value))}
                    className="form-field min-w-0 flex-1 rounded-xl px-3.5 py-2.5 text-[15px]"
                  />
                </div>
                {phoneMsg && <span className="text-xs font-normal text-[var(--gold)]">{phoneMsg}</span>}
              </label>
              <label className="flex flex-col gap-1.5 text-sm font-medium sm:col-span-2">
                <span className="text-[var(--text-2)]">Message</span>
                <textarea
                  required
                  minLength={10}
                  maxLength={4000}
                  rows={3}
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  className="form-field resize-none rounded-xl px-3.5 py-2.5 text-[15px]"
                />
              </label>

              {status === 'error' && error && (
                <p role="alert" className="text-sm text-[var(--gold)] sm:col-span-2">
                  {error}
                </p>
              )}

              <div className="text-center sm:col-span-2">
                <button
                  type="submit"
                  disabled={status === 'sending'}
                  className="btn-primary inline-flex items-center gap-2 rounded-md px-7 py-2.5 text-[15px] font-medium disabled:opacity-60"
                >
                  {status === 'sending' ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" /> Sending…
                    </>
                  ) : (
                    'Send message'
                  )}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </section>
  );
}
