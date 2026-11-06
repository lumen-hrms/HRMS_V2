import * as React from 'react';
import * as payroll from '@/lib/payroll/client';
import type { BankConfigResponse, PreferredPaymentMode } from '@/lib/payroll/types';
import { isApiError } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Field } from '@/components/ui/field';
import { SkeletonRows } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';
import { fmtDateTime } from './format';

const IFSC = /^[A-Z]{4}0[A-Z0-9]{6}$/;
const ACCOUNT = /^\d{9,18}$/;
const HOLDER = /^[A-Za-z][A-Za-z .'&-]{1,99}$/;

const MODES: Array<{ id: PreferredPaymentMode; label: string; hint: string }> = [
  { id: 'NEFT', label: 'NEFT', hint: 'Works for any amount. The usual choice for salaries.' },
  { id: 'IMPS', label: 'IMPS', hint: 'Instant, up to ₹5,00,000 per payment (larger amounts fall back to NEFT).' },
  { id: 'RTGS', label: 'RTGS', hint: 'Only for ₹2,00,000 and above (smaller amounts fall back to NEFT).' },
];

interface Form {
  bankCode: string;
  accountHolderName: string;
  accountNumber: string;
  ifsc: string;
  bankName: string;
  branch: string;
  defaultPaymentMode: PreferredPaymentMode;
}

/** The company's own bank — only used to shape the bank advice file. No money moves through the app. */
export function BankSettings({ readOnly }: { readOnly: boolean }) {
  const { toast } = useToast();
  const [data, setData] = React.useState<BankConfigResponse | null>(null);
  const [form, setForm] = React.useState<Form | null>(null);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [submitted, setSubmitted] = React.useState(false);

  const load = React.useCallback(() => {
    setLoadError(null);
    payroll
      .getBankConfig()
      .then((r) => {
        setData(r);
        setForm({
          bankCode: r.config?.bankCode ?? '',
          accountHolderName: r.config?.accountHolderName ?? '',
          accountNumber: '',
          ifsc: r.config?.ifsc ?? '',
          bankName: r.config?.bankName ?? '',
          branch: r.config?.branch ?? '',
          defaultPaymentMode: r.config?.defaultPaymentMode ?? 'NEFT',
        });
      })
      .catch((err) => setLoadError(isApiError(err) ? err.message : 'Could not load bank details'));
  }, []);
  React.useEffect(load, [load]);

  if (loadError) {
    return (
      <div className="flex items-center justify-between gap-2 rounded-xl bg-destructive/10 px-3 py-2 text-sm text-destructive">
        <span>{loadError}</span>
        <Button size="sm" variant="outline" onClick={load}>
          Retry
        </Button>
      </div>
    );
  }
  if (!data || !form) return <SkeletonRows rows={5} />;

  const have = !!data.config;
  const prefix = data.banks.find((b) => b.code === form.bankCode)?.ifscPrefix ?? null;
  const ifsc = form.ifsc.trim().toUpperCase();

  // Empty fields only complain once the user tries to save; wrong values complain straight away.
  const errors: Partial<Record<keyof Form, string>> = {};
  if (!form.bankCode) errors.bankCode = submitted ? 'Pick your bank' : undefined;
  if (!form.accountHolderName.trim()) errors.accountHolderName = submitted ? 'Account holder name is required' : undefined;
  else if (!HOLDER.test(form.accountHolderName.trim())) {
    errors.accountHolderName = 'Use 2–100 letters (spaces and . ’ & - allowed)';
  }
  if (!form.accountNumber) errors.accountNumber = !have && submitted ? 'Account number is required' : undefined;
  else if (!ACCOUNT.test(form.accountNumber)) errors.accountNumber = 'Account number must be 9–18 digits';
  if (!ifsc) errors.ifsc = submitted ? 'IFSC is required' : undefined;
  else if (!IFSC.test(ifsc)) errors.ifsc = 'IFSC must be 11 characters, e.g. HDFC0001234';
  else if (prefix && ifsc.slice(0, 4) !== prefix) {
    errors.ifsc = `This IFSC doesn’t belong to ${data.banks.find((b) => b.code === form.bankCode)?.label} (it should start with ${prefix})`;
  }
  const hasErrors = Object.values(errors).some(Boolean);
  const missing = !form.bankCode || !form.accountHolderName.trim() || !ifsc || (!have && !form.accountNumber);

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => (f ? { ...f, [k]: v } : f));

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSubmitted(true);
    if (hasErrors || missing || !form) return;
    setBusy(true);
    try {
      const saved = await payroll.saveBankConfig({
        bankCode: form.bankCode,
        accountHolderName: form.accountHolderName.trim(),
        accountNumber: form.accountNumber || undefined,
        ifsc,
        bankName: form.bankName.trim() || undefined,
        branch: form.branch.trim() || undefined,
        defaultPaymentMode: form.defaultPaymentMode,
      });
      setData(saved);
      set('accountNumber', '');
      setSubmitted(false);
      toast({ title: 'Bank details saved', tone: 'success' });
    } catch (err) {
      toast({ title: isApiError(err) ? err.message : 'Could not save bank details', tone: 'error' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save} className="flex flex-col gap-5">
      <p className="rounded-xl border border-border/60 bg-secondary/40 px-4 py-3 text-sm text-muted-foreground">
        This is the account your salaries are paid <strong>from</strong>. It only shapes the bank file you download
        after a run is processed — Lumen never moves money. The account number is stored encrypted.
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Your bank" required error={errors.bankCode} hint="Decides which bank-file layout is pre-selected.">
          <Select value={form.bankCode} disabled={readOnly} onChange={(e) => set('bankCode', e.target.value)}>
            <option value="">Select your bank</option>
            {data.banks.map((b) => (
              <option key={b.code} value={b.code}>
                {b.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Account holder name" required error={errors.accountHolderName} hint="As on the bank account.">
          <Input value={form.accountHolderName} maxLength={100} disabled={readOnly} onChange={(e) => set('accountHolderName', e.target.value)} />
        </Field>
        <Field
          label="Account number"
          required={!have}
          error={errors.accountNumber}
          hint={have ? `Saved: ${data.config!.accountMasked}. Leave blank to keep it.` : '9–18 digits'}
        >
          <Input
            inputMode="numeric"
            autoComplete="off"
            maxLength={18}
            disabled={readOnly}
            value={form.accountNumber}
            placeholder={have ? data.config!.accountMasked : ''}
            onChange={(e) => set('accountNumber', e.target.value.replace(/\s/g, ''))}
          />
        </Field>
        <Field label="IFSC" required error={errors.ifsc} hint={prefix ? `Starts with ${prefix}` : 'e.g. HDFC0001234'}>
          <Input value={form.ifsc} maxLength={11} disabled={readOnly} placeholder="HDFC0001234" onChange={(e) => set('ifsc', e.target.value.toUpperCase())} />
        </Field>
        <Field label="Branch" hint="Optional">
          <Input value={form.branch} maxLength={100} disabled={readOnly} onChange={(e) => set('branch', e.target.value)} />
        </Field>
        <Field label="Default payment mode" hint={MODES.find((m) => m.id === form.defaultPaymentMode)?.hint}>
          <Select value={form.defaultPaymentMode} disabled={readOnly} onChange={(e) => set('defaultPaymentMode', e.target.value as PreferredPaymentMode)}>
            {MODES.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-4">
        <span className="text-xs text-muted-foreground">
          {have ? `Last saved ${fmtDateTime(data.config!.updatedAt)}` : 'Not set up yet'}
        </span>
        {!readOnly && (
          <Button type="submit" disabled={busy}>
            {busy ? 'Saving…' : 'Save bank details'}
          </Button>
        )}
      </div>
    </form>
  );
}
