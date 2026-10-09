import * as React from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import * as payroll from '@/lib/payroll/client';
import type { SalaryComponentInput, TaxRegime } from '@/lib/payroll/types';
import { useAuth } from '@/context/auth-context';
import { isPayrollAdmin } from '@/lib/roles';
import { isApiError } from '@/lib/api';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Field } from '@/components/ui/field';
import { SkeletonRows } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty-state';
import { useToast } from '@/components/ui/toast';
import { PageHeader } from '@/components/page-header';
import { ComponentBuilder, STANDARD_TEMPLATE } from './components/component-builder';
import { StructureStatusBadge } from './components/status-badge';

function currentFinancialYear(): string {
  const now = new Date();
  const y = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
  return `${y}-${String((y + 1) % 100).padStart(2, '0')}`;
}

export function StructureEditorPage() {
  const { employeeId = '' } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { toast } = useToast();
  const canManage = isPayrollAdmin(user);
  const fy = currentFinancialYear();

  const [loading, setLoading] = React.useState(true);
  const [exists, setExists] = React.useState(false);
  const [status, setStatus] = React.useState<'ACTIVE' | 'SUPERSEDED' | null>(null);
  const [minBasicPercent, setMinBasicPercent] = React.useState(50);
  const [ctcAnnual, setCtcAnnual] = React.useState(0);
  const [effectiveDate, setEffectiveDate] = React.useState('');
  const [components, setComponents] = React.useState<SalaryComponentInput[]>(STANDARD_TEMPLATE);
  const [busy, setBusy] = React.useState(false);

  const [regime, setRegime] = React.useState<TaxRegime | null>(null);
  const [regimeBusy, setRegimeBusy] = React.useState(false);

  const [reviseOpen, setReviseOpen] = React.useState(false);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const settings = await payroll.getSettings();
      setMinBasicPercent(Number(settings.minBasicPercent));
    } catch {
      // keep the 50% default
    }
    try {
      const structure = await payroll.getStructure(employeeId);
      setExists(true);
      setStatus(structure.status);
      setCtcAnnual(Number(structure.ctcAnnual));
      setEffectiveDate(structure.effectiveFrom.slice(0, 10));
      setComponents(
        structure.components.map((c) => ({
          type: c.type,
          code: c.code,
          name: c.name,
          calculationMode: c.calculationMode,
          value: c.value != null ? Number(c.value) : undefined,
          formula: c.formula ?? undefined,
          sortOrder: c.sortOrder,
        })),
      );
    } catch {
      setExists(false);
      setCtcAnnual(600000);
      setEffectiveDate(new Date().toISOString().slice(0, 10));
      setComponents(STANDARD_TEMPLATE);
    }
    if (canManage) {
      try {
        setRegime((await payroll.getTdsRegime(employeeId, fy)).regime);
      } catch {
        setRegime('NEW');
      }
    }
    setLoading(false);
  }, [employeeId, canManage, fy]);

  React.useEffect(() => {
    load();
  }, [load]);

  async function save() {
    setBusy(true);
    try {
      const input = { ctcAnnual, effectiveFrom: effectiveDate, components };
      if (exists) {
        await payroll.updateStructure(employeeId, input);
        toast({ title: 'Structure updated', tone: 'success' });
      } else {
        await payroll.createStructure(employeeId, input);
        toast({ title: 'Structure created', tone: 'success' });
      }
      load();
    } catch (err) {
      toast({ title: isApiError(err) ? err.message : 'Save failed', tone: 'error' });
    } finally {
      setBusy(false);
    }
  }

  async function moveRegime(next: TaxRegime) {
    setRegimeBusy(true);
    try {
      await payroll.setTdsRegime(employeeId, fy, next);
      setRegime(next);
      toast({ title: `Moved to the ${next} regime for FY ${fy}`, tone: 'success' });
    } catch (err) {
      toast({ title: isApiError(err) ? err.message : 'Could not change regime', tone: 'error' });
    } finally {
      setRegimeBusy(false);
    }
  }

  if (!canManage) {
    return (
      <EmptyState title="Not authorized" description="Only HR/Admin can edit salary structures." />
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title={exists ? 'Edit salary structure' : 'Create salary structure'}
        description={employeeId}
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => navigate('/payroll')}>
              <ArrowLeft className="h-4 w-4" /> Back
            </Button>
            {exists && (
              <Button variant="outline" size="sm" onClick={() => setReviseOpen((v) => !v)}>
                {reviseOpen ? 'Cancel revision' : 'Revise (backdated change)'}
              </Button>
            )}
          </>
        }
      />

      {loading ? (
        <SkeletonRows rows={6} />
      ) : (
        <>
          <Card className="p-5">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-sm font-semibold">
                {exists ? 'Active structure' : 'New structure'}
              </h3>
              <div className="flex items-center gap-3">
                {status && <StructureStatusBadge status={status} />}
                <TaxRegimeControl employeeId={employeeId} regime={regime} busy={regimeBusy} onMove={moveRegime} />
              </div>
            </div>

            {exists && (
              <p className="mb-4 rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
                Once a payroll run has used this structure, prefer <strong>Revise</strong> above —
                it records a <code>SalaryRevision</code> and generates arrears for any
                already-processed period a backdated change falls into. A plain in-place save
                here does neither.
              </p>
            )}

            <ComponentBuilder
              ctcAnnual={ctcAnnual}
              onCtcAnnualChange={setCtcAnnual}
              effectiveDateLabel="Effective from"
              effectiveDate={effectiveDate}
              onEffectiveDateChange={setEffectiveDate}
              components={components}
              onComponentsChange={setComponents}
              minBasicPercent={minBasicPercent}
            />

            <div className="mt-4 flex justify-end">
              <Button onClick={save} disabled={busy}>
                {busy ? 'Saving…' : exists ? 'Save changes' : 'Create structure'}
              </Button>
            </div>
          </Card>

          {reviseOpen && (
            <ReviseCard
              employeeId={employeeId}
              initialCtcAnnual={ctcAnnual}
              initialComponents={components}
              minBasicPercent={minBasicPercent}
              onDone={() => {
                setReviseOpen(false);
                load();
              }}
            />
          )}
        </>
      )}
    </div>
  );
}

function TaxRegimeControl({
  regime,
  busy,
  onMove,
}: {
  employeeId: string;
  regime: TaxRegime | null;
  busy: boolean;
  onMove: (r: TaxRegime) => void;
}) {
  if (!regime) return null;
  const other: TaxRegime = regime === 'NEW' ? 'OLD' : 'NEW';
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="text-muted-foreground">Tax regime</span>
      <span className="font-medium">{regime}</span>
      <Button variant="outline" size="sm" disabled={busy} onClick={() => onMove(other)}>
        Move to {other}
      </Button>
    </div>
  );
}

function ReviseCard({
  employeeId,
  initialCtcAnnual,
  initialComponents,
  minBasicPercent,
  onDone,
}: {
  employeeId: string;
  initialCtcAnnual: number;
  initialComponents: SalaryComponentInput[];
  minBasicPercent: number;
  onDone: () => void;
}) {
  const { toast } = useToast();
  const [ctcAnnual, setCtcAnnual] = React.useState(initialCtcAnnual);
  const [effectiveDate, setEffectiveDate] = React.useState(new Date().toISOString().slice(0, 10));
  const [components, setComponents] = React.useState<SalaryComponentInput[]>(initialComponents);
  const [reason, setReason] = React.useState('');
  const [busy, setBusy] = React.useState(false);

  async function submit() {
    setBusy(true);
    try {
      const result = await payroll.reviseStructure(employeeId, {
        ctcAnnual,
        effectiveDate,
        components,
        reason,
      });
      toast({
        title: 'Revision created',
        description:
          result.arrearsGenerated > 0
            ? `Arrears generated for ${result.arrearsPeriods.join(', ')} — will be folded into the next payroll run.`
            : 'No already-processed period was affected — no arrears.',
        tone: 'success',
      });
      onDone();
    } catch (err) {
      toast({ title: isApiError(err) ? err.message : 'Revision failed', tone: 'error' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="border-primary/30 p-5">
      <h3 className="mb-1 text-sm font-semibold">Revise structure</h3>
      <p className="mb-4 text-xs text-muted-foreground">
        A backdated effective date triggers arrears for every already-processed period it falls
        into — the delta between the old and new structure, folded into the next payroll run.
      </p>
      <ComponentBuilder
        ctcAnnual={ctcAnnual}
        onCtcAnnualChange={setCtcAnnual}
        effectiveDateLabel="Effective date (may be backdated)"
        effectiveDate={effectiveDate}
        onEffectiveDateChange={setEffectiveDate}
        components={components}
        onComponentsChange={setComponents}
        minBasicPercent={minBasicPercent}
      />
      <Field label="Reason" required hint="Minimum 10 characters — e.g. a delayed appraisal." className="mt-4">
        <Textarea value={reason} onChange={(e) => setReason(e.target.value)} />
      </Field>
      <div className="mt-4 flex justify-end">
        <Button onClick={submit} disabled={busy || reason.trim().length < 10}>
          {busy ? 'Submitting…' : 'Submit revision'}
        </Button>
      </div>
    </Card>
  );
}

