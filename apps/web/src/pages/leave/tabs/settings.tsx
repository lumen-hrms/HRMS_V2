import * as React from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/field';
import { Select } from '@/components/ui/select';
import { SkeletonRows } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';
import { leaveApi } from '@/lib/leave/client';
import type { LeaveSettings } from '@/lib/leave/types';
import { RecalculateCard } from '@/pages/leave/components/recalculate-card';

/** The approval-levels dropdown's three choices, onto the two stored settings. */
const APPROVAL_FLOWS = {
  HR: { approvalLevels: 1, singleApprover: 'HR' },
  MANAGER: { approvalLevels: 1, singleApprover: 'MANAGER' },
  MANAGER_THEN_HR: { approvalLevels: 2, singleApprover: 'HR' },
} satisfies Record<string, Pick<LeaveSettings, 'approvalLevels' | 'singleApprover'>>;
type ApprovalFlow = keyof typeof APPROVAL_FLOWS;

function approvalFlow(s: LeaveSettings): ApprovalFlow {
  return s.approvalLevels === 2 ? 'MANAGER_THEN_HR' : s.singleApprover;
}

/**
 * Tenant-wide leave policy. Backed by `tenant_settings` — approval depth and
 * escalation timing live server-side; `allowLopRequests` and `fyStartMonth`
 * are read/written as-is even though today's backend only acts on
 * `approvalLevels`. `readOnly` covers both Auditor (view-only per role) and
 * anyone who isn't Company Admin, since `PATCH /leave/settings` is
 * Company-Admin-only.
 */
export function SettingsTab({ readOnly = false }: { readOnly?: boolean }) {
  const { toast } = useToast();
  const [settings, setSettings] = React.useState<LeaveSettings | null>(null);
  const [busy, setBusy] = React.useState(false);

  const load = React.useCallback(() => {
    setSettings(null);
    leaveApi.getSettings().then(setSettings);
  }, []);
  React.useEffect(load, [load]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!settings) return;
    setBusy(true);
    try {
      const updated = await leaveApi.updateSettings(settings);
      setSettings(updated);
      toast({ title: 'Settings saved', tone: 'success' });
    } finally {
      setBusy(false);
    }
  }

  if (!settings) {
    return (
      <Card className="p-4">
        <SkeletonRows rows={3} />
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-5">
    <Card className="max-w-lg p-4">
      <form onSubmit={save} className="flex flex-col gap-4">
        <Field
          label="Approval levels"
          hint="Who decides a request before it's final. Employees with no reporting manager always go to HR."
        >
          <Select
            disabled={readOnly}
            value={approvalFlow(settings)}
            onChange={(e) => setSettings((s) => (s ? { ...s, ...APPROVAL_FLOWS[e.target.value as ApprovalFlow] } : s))}
          >
            <option value="HR">1 — straight to HR</option>
            <option value="MANAGER">1 — reporting manager only</option>
            <option value="MANAGER_THEN_HR">2 — manager, then HR</option>
          </Select>
        </Field>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            disabled={readOnly}
            className="h-4 w-4 rounded border-input disabled:opacity-50"
            checked={settings.allowLopRequests}
            onChange={(e) => setSettings((s) => (s ? { ...s, allowLopRequests: e.target.checked } : s))}
          />
          Allow employees to submit a request that will be Loss of Pay
        </label>

        <Field label="Fiscal year start month" hint="India default: April (4).">
          <Input
            type="number"
            min={1}
            max={12}
            disabled={readOnly}
            value={settings.fyStartMonth}
            onChange={(e) => setSettings((s) => (s ? { ...s, fyStartMonth: Number(e.target.value) } : s))}
          />
        </Field>

        {!readOnly && (
          <div className="flex justify-end">
            <Button type="submit" disabled={busy}>
              {busy ? 'Saving…' : 'Save changes'}
            </Button>
          </div>
        )}
      </form>
    </Card>
    {!readOnly && <RecalculateCard />}
    </div>
  );
}
