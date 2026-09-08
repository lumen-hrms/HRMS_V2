import * as React from 'react';
import { Pencil, PlusCircle, RefreshCw } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/field';
import { Select } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/table';
import { SkeletonRows } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty-state';
import { Dialog, DialogContent, DialogHeader } from '@/components/ui/dialog';
import { useToast } from '@/components/ui/toast';
import { leaveApi } from '@/lib/leave/client';
import { MOCK_CURRENT_YEAR } from '@/lib/leave/fixtures';
import { ACCRUAL_LABELS, type AccrualFrequency, type LeaveType } from '@/lib/leave/types';

const ACCRUAL_PALETTE = ['#2b5a8c', '#1a7f5a', '#a8681a', '#7c4fb0', '#0f766e', '#b3261e'];

function deriveCode(name: string): string {
  const initials = name
    .trim()
    .split(/\s+/)
    .map((w) => w[0])
    .join('')
    .toUpperCase();
  return initials.slice(0, 3) || 'LT';
}

/**
 * Leave type configuration. Only name / annual quota / carry-forward cap /
 * accrual frequency are backend-persisted today — the form only exposes
 * those; the rest of the frontend LeaveType shape (code, colorToken,
 * genderRestriction, ...) gets sensible auto-derived defaults so
 * `createType`'s full-shape signature is still satisfied, without building
 * UI for fields the API silently drops (see docs/LEAVE_UI_SPECS.md).
 */
export function LeaveTypesTab({ readOnly = false }: { readOnly?: boolean }) {
  const [rows, setRows] = React.useState<LeaveType[] | null>(null);
  const [addOpen, setAddOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<LeaveType | null>(null);
  const [initializing, setInitializing] = React.useState<LeaveType | null>(null);

  const load = React.useCallback(() => {
    setRows(null);
    leaveApi.listTypes(true).then(setRows);
  }, []);
  React.useEffect(load, [load]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Quotas, carry-forward caps, and accrual schedules for every leave type.
        </p>
        {!readOnly && (
          <Button size="sm" onClick={() => setAddOpen(true)}>
            <PlusCircle className="h-4 w-4" /> Add type
          </Button>
        )}
      </div>

      <Card className="overflow-hidden">
        {!rows ? (
          <div className="p-4">
            <SkeletonRows rows={5} />
          </div>
        ) : rows.length === 0 ? (
          <EmptyState title="No leave types defined yet" />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Name</TH>
                <TH className="text-right">Annual quota</TH>
                <TH className="text-right">Carry-forward cap</TH>
                <TH>Accrual</TH>
                <TH>Approval</TH>
                {!readOnly && <TH className="text-right">Actions</TH>}
              </TR>
            </THead>
            <TBody>
              {rows.map((t) => (
                <TR key={t.id}>
                  <TD className="font-medium text-foreground">{t.name}</TD>
                  <TD className="text-right tabular-nums">{t.annualQuota}d</TD>
                  <TD className="text-right tabular-nums">{t.carryForwardCap}d</TD>
                  <TD>
                    <Badge variant="outline">{ACCRUAL_LABELS[t.accrualFrequency]}</Badge>
                  </TD>
                  <TD>
                    <Badge variant={t.requiresApproval ? 'default' : 'outline'}>
                      {t.requiresApproval ? 'Requires approval' : 'Auto-approved'}
                    </Badge>
                  </TD>
                  {!readOnly && (
                    <TD className="text-right">
                      <div className="flex justify-end gap-1.5">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setInitializing(t)}
                          aria-label={`Initialize balances for ${t.name}`}
                        >
                          <RefreshCw className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setEditing(t)}
                          aria-label={`Edit ${t.name}`}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                      </div>
                    </TD>
                  )}
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Card>

      {!readOnly && (
        <>
          <TypeFormDialog
            mode="create"
            open={addOpen}
            onOpenChange={setAddOpen}
            onSaved={() => {
              setAddOpen(false);
              load();
            }}
          />
          <TypeFormDialog
            mode="edit"
            open={!!editing}
            initial={editing ?? undefined}
            onOpenChange={(v) => !v && setEditing(null)}
            onSaved={() => {
              setEditing(null);
              load();
            }}
          />
          <InitializeYearDialog
            type={initializing}
            onOpenChange={(v) => !v && setInitializing(null)}
            onDone={() => setInitializing(null)}
          />
        </>
      )}
    </div>
  );
}

function TypeFormDialog({
  mode,
  open,
  initial,
  onOpenChange,
  onSaved,
}: {
  mode: 'create' | 'edit';
  open: boolean;
  initial?: LeaveType;
  onOpenChange: (v: boolean) => void;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const [form, setForm] = React.useState({
    name: '',
    annualQuota: 12,
    carryForwardCap: 0,
    accrualFrequency: 'ANNUAL' as AccrualFrequency,
  });
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    setForm(
      initial
        ? {
            name: initial.name,
            annualQuota: initial.annualQuota,
            carryForwardCap: initial.carryForwardCap,
            accrualFrequency: initial.accrualFrequency,
          }
        : { name: '', annualQuota: 12, carryForwardCap: 0, accrualFrequency: 'ANNUAL' },
    );
  }, [open, initial]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      if (mode === 'create') {
        await leaveApi.createType({
          name: form.name,
          annualQuota: form.annualQuota,
          carryForwardCap: form.carryForwardCap,
          accrualFrequency: form.accrualFrequency,
          code: deriveCode(form.name),
          colorToken: ACCRUAL_PALETTE[Math.floor(Math.random() * ACCRUAL_PALETTE.length)],
          genderRestriction: 'ANY',
          minNoticeDays: 0,
          paid: true,
          requiresApproval: true,
          active: true,
        });
        toast({ title: `Added “${form.name}”` });
      } else if (initial) {
        await leaveApi.updateType(initial.id, {
          name: form.name,
          annualQuota: form.annualQuota,
          carryForwardCap: form.carryForwardCap,
          accrualFrequency: form.accrualFrequency,
        });
        toast({ title: `Updated “${form.name}”` });
      }
      onSaved();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader
          title={mode === 'create' ? 'Add leave type' : `Edit ${initial?.name ?? ''}`}
          description="Quota and carry-forward apply from the next initialized year."
          onClose={() => onOpenChange(false)}
        />
        <form onSubmit={submit} className="flex flex-col gap-3">
          <Field label="Name" required>
            <Input
              required
              placeholder="e.g. Earned Leave"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Annual quota (days)" required>
              <Input
                type="number"
                min={0}
                step="0.5"
                required
                value={form.annualQuota}
                onChange={(e) => setForm((f) => ({ ...f, annualQuota: Number(e.target.value) }))}
              />
            </Field>
            <Field label="Carry-forward cap (days)">
              <Input
                type="number"
                min={0}
                step="0.5"
                value={form.carryForwardCap}
                onChange={(e) => setForm((f) => ({ ...f, carryForwardCap: Number(e.target.value) }))}
              />
            </Field>
          </div>
          <Field label="Accrual frequency">
            <Select
              value={form.accrualFrequency}
              onChange={(e) => setForm((f) => ({ ...f, accrualFrequency: e.target.value as AccrualFrequency }))}
            >
              {Object.entries(ACCRUAL_LABELS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </Select>
          </Field>
          <div className="mt-1 flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? 'Saving…' : mode === 'create' ? 'Add type' : 'Save changes'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function InitializeYearDialog({
  type,
  onOpenChange,
  onDone,
}: {
  type: LeaveType | null;
  onOpenChange: (v: boolean) => void;
  onDone: () => void;
}) {
  const { toast } = useToast();
  const [year, setYear] = React.useState(MOCK_CURRENT_YEAR);
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    if (type) setYear(MOCK_CURRENT_YEAR);
  }, [type]);

  if (!type) return null;

  async function run() {
    setBusy(true);
    try {
      const { initialized } = await leaveApi.initializeBalances(type!.id, year);
      toast({ title: `Initialized ${type!.name} for ${year}`, description: `${initialized} employees seeded.` });
      onDone();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={!!type} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader
          title={`Initialize ${type.name}`}
          description="Creates/refreshes every employee's balance row for the chosen year."
          onClose={() => onOpenChange(false)}
        />
        <div className="flex flex-col gap-3">
          <Field label="Year" required>
            <Input
              type="number"
              value={year}
              onChange={(e) => setYear(Number(e.target.value))}
            />
          </Field>
          <div className="mt-1 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button onClick={run} disabled={busy}>
              {busy ? 'Initializing…' : 'Initialize'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
