import * as React from 'react';
import { api, isApiError } from '@/lib/api';
import { useAuth } from '@/context/auth-context';
import { PageHeader } from '@/components/page-header';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/field';
import { Select } from '@/components/ui/select';
import { useToast } from '@/components/ui/toast';
import { INDIAN_STATES, stateLabel } from '@/lib/setup';

interface CompanyProfile {
  legalName: string;
  addressLine1: string;
  addressLine2: string | null;
  city: string;
  state: string;
  pincode: string;
  contactEmail: string;
  contactPhone: string;
  gstin: string | null;
  cin: string | null;
}

const EMPTY: CompanyProfile = {
  legalName: '',
  addressLine1: '',
  addressLine2: '',
  city: '',
  state: '',
  pincode: '',
  contactEmail: '',
  contactPhone: '',
  gstin: '',
  cin: '',
};

/**
 * The company profile captured by company setup (`GET`/`PATCH
 * /api/tenant-config/company-profile`). Company Admin edits; HR Manager and
 * Auditor see it read-only. HR rules live in their own module settings.
 */
export function CompanySettingsPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const canEdit = user?.role === 'COMPANY_ADMIN';
  const [form, setForm] = React.useState<CompanyProfile | null>(null);
  const [goLiveDate, setGoLiveDate] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    api
      .get<{ profile: CompanyProfile | null; goLiveDate: string | null }>('/tenant-config/company-profile')
      .then((r) => {
        setForm(r.profile ?? EMPTY);
        setGoLiveDate(r.goLiveDate);
      })
      .catch(() => setForm(EMPTY));
  }, []);

  if (!form) return <p className="text-sm text-muted-foreground">Loading…</p>;

  const set = (k: keyof CompanyProfile) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((f) => (f ? { ...f, [k]: e.target.value } : f));

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!form) return;
    setBusy(true);
    try {
      await api.patch('/tenant-config/company-profile', {
        ...form,
        addressLine2: form.addressLine2 || undefined,
        gstin: form.gstin || undefined,
        cin: form.cin || undefined,
      });
      toast({ title: 'Company details saved' });
    } catch (err) {
      toast({ title: isApiError(err) ? err.message : 'Could not save', tone: 'error' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex max-w-3xl flex-col gap-5">
      <PageHeader title="Company" description="Your company’s legal identity, as captured during company setup." />
      <Card>
        <CardHeader>
          <CardTitle>Company details</CardTitle>
          {goLiveDate && <CardDescription>Live on Lumen since {goLiveDate}.</CardDescription>}
        </CardHeader>
        <CardContent>
          <form onSubmit={save} className="flex flex-col gap-3">
            <fieldset disabled={!canEdit || busy} className="grid gap-3 sm:grid-cols-2">
              <Field label="Legal name" required className="sm:col-span-2">
                <Input value={form.legalName} onChange={set('legalName')} />
              </Field>
              <Field label="Address" required>
                <Input value={form.addressLine1} onChange={set('addressLine1')} />
              </Field>
              <Field label="Address line 2">
                <Input value={form.addressLine2 ?? ''} onChange={set('addressLine2')} />
              </Field>
              <Field label="City" required>
                <Input value={form.city} onChange={set('city')} />
              </Field>
              <Field label="State" required>
                <Select value={form.state} onChange={set('state')}>
                  <option value="">Select a state</option>
                  {INDIAN_STATES.map((s) => (
                    <option key={s} value={s}>
                      {stateLabel(s)}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="PIN code" required>
                <Input value={form.pincode} onChange={set('pincode')} />
              </Field>
              <Field label="Contact email" required>
                <Input type="email" value={form.contactEmail} onChange={set('contactEmail')} />
              </Field>
              <Field label="Contact phone" required>
                <Input value={form.contactPhone} onChange={set('contactPhone')} />
              </Field>
              <Field label="GSTIN">
                <Input value={form.gstin ?? ''} onChange={set('gstin')} />
              </Field>
              <Field label="CIN">
                <Input value={form.cin ?? ''} onChange={set('cin')} />
              </Field>
            </fieldset>
            {canEdit && (
              <Button type="submit" disabled={busy} className="self-start">
                {busy ? 'Saving…' : 'Save'}
              </Button>
            )}
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
