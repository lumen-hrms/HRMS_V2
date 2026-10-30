import * as React from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { AlertTriangle, Check, CheckCircle2, LogOut, Save } from 'lucide-react';
import { useAuth } from '@/context/auth-context';
import { isApiError } from '@/lib/api';
import { useSetupStatus } from '@/lib/setup-status';
import { useToast } from '@/components/ui/toast';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import {
  MONTHS,
  SETUP_STEPS,
  setupApi,
  stateLabel,
  type FileSummary,
  type ImportReport,
  type SetupDraft,
  type SetupIssue,
  type SetupStepId,
  type SetupValidation,
  type SubmitResult,
} from '@/lib/setup';
import {
  AttendanceStep,
  CompanyStep,
  DepartmentsStep,
  FileStep,
  HolidaysStep,
  LeavePolicyStep,
  ProfileStep,
  WorkWeekStep,
} from '@/pages/setup/steps';
import lumenMarkDark from '@/assets/brand/lumen-mark-dark.png';
import lumenMarkWhite from '@/assets/brand/lumen-mark-white.png';

/**
 * Company setup — the full-screen first run a Company Admin must complete
 * before anyone in the workspace can use the app (the API answers
 * SETUP_INCOMPLETE until then). Progress is saved as a server-side draft
 * ("Save draft", and on every Next) so it can be paused and resumed on any
 * device. Each step must be free of errors to move on; the final Submit
 * applies everything in one transaction.
 */
export function SetupPage() {
  const { user, logout } = useAuth();
  const { status, refresh } = useSetupStatus();
  const navigate = useNavigate();
  const { toast } = useToast();

  const [draft, setDraft] = React.useState<SetupDraft | null>(null);
  const [files, setFiles] = React.useState<{ employees: FileSummary | null; balances: FileSummary | null }>({
    employees: null,
    balances: null,
  });
  const [reports, setReports] = React.useState<{ employees: ImportReport | null; balances: ImportReport | null }>({
    employees: null,
    balances: null,
  });
  const [issues, setIssues] = React.useState<SetupIssue[]>([]);
  const [savedAt, setSavedAt] = React.useState<string | null>(null);
  const [dirty, setDirty] = React.useState(false);
  const [step, setStep] = React.useState(0);
  const [furthest, setFurthest] = React.useState(0);
  const [busy, setBusy] = React.useState<null | 'save' | 'employees' | 'balances' | 'holidays' | 'submit'>(null);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [holidayImportIssues, setHolidayImportIssues] = React.useState<{ row?: number; message: string }[]>([]);
  const [result, setResult] = React.useState<SubmitResult | null>(null);

  const validate = React.useCallback(async () => {
    const v = await setupApi.validate();
    setIssues(v.issues);
    setReports({ employees: v.employeeReport, balances: v.balanceReport });
    return v;
  }, []);

  React.useEffect(() => {
    if (user?.role !== 'COMPANY_ADMIN' || status?.complete) return;
    setupApi
      .draft()
      .then(async (d) => {
        setDraft(d.draft);
        setFiles(d.files);
        setSavedAt(d.savedAt);
        await validate();
      })
      .catch((err) => setLoadError(isApiError(err) ? err.message : 'Could not load your setup'));
  }, [user?.role, status?.complete, validate]);

  // Leaving with unsaved edits loses them — warn first.
  React.useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const update = React.useCallback((fn: (d: SetupDraft) => void) => {
    setDraft((current) => {
      if (!current) return current;
      const next = structuredClone(current);
      fn(next);
      return next;
    });
    setDirty(true);
  }, []);

  /** Saves pending edits (if any) and re-validates; null when the save failed. */
  async function save(): Promise<SetupValidation | null> {
    if (!draft) return null;
    setBusy('save');
    try {
      if (dirty) {
        const { savedAt: at } = await setupApi.save(draft);
        setSavedAt(at);
        setDirty(false);
      }
      return await validate();
    } catch (err) {
      toast({ title: isApiError(err) ? err.message : 'Could not save your setup', tone: 'error' });
      return null;
    } finally {
      setBusy(null);
    }
  }

  if (user?.role !== 'COMPANY_ADMIN') return <Navigate to="/" replace />;
  if (status?.complete && !result) return <Navigate to="/" replace />;

  const current = SETUP_STEPS[step].id;
  const issuesFor = (id: SetupStepId) => issues.filter((i) => i.step === id);
  const errorsFor = (id: SetupStepId) => issuesFor(id).filter((i) => i.level === 'error');
  const allErrors = issues.filter((i) => i.level === 'error');

  async function next() {
    const v = await save();
    if (!v) return;
    const blocking = v.issues.filter((i) => i.step === current && i.level === 'error');
    if (blocking.length > 0) {
      toast({ title: `Fix ${blocking.length} problem${blocking.length === 1 ? '' : 's'} on this step to continue`, tone: 'error' });
      return;
    }
    const to = Math.min(step + 1, SETUP_STEPS.length - 1);
    setStep(to);
    setFurthest((f) => Math.max(f, to));
    window.scrollTo({ top: 0 });
  }

  async function goTo(i: number) {
    if (i > furthest) return;
    if (dirty && !(await save())) return;
    setStep(i);
    window.scrollTo({ top: 0 });
  }

  async function uploadFile(kind: 'employees' | 'balances', file: File) {
    if (dirty && !(await save())) return;
    setBusy(kind);
    try {
      const res = await setupApi.uploadFile(kind, file);
      setFiles((f) => ({ ...f, [kind]: res.file }));
      await validate();
    } catch (err) {
      toast({ title: isApiError(err) ? err.message : 'Could not read the file', tone: 'error' });
    } finally {
      setBusy(null);
    }
  }

  async function removeFile(kind: 'employees' | 'balances') {
    setBusy(kind);
    try {
      await setupApi.removeFile(kind);
      setFiles((f) => ({ ...f, [kind]: null }));
      await validate();
    } finally {
      setBusy(null);
    }
  }

  async function importHolidays(file: File) {
    if (dirty && !(await save())) return;
    setBusy('holidays');
    setHolidayImportIssues([]);
    try {
      const res = await setupApi.importHolidays(file);
      if (!res.merged) {
        setHolidayImportIssues(res.issues);
        return;
      }
      setDraft((d) => (d ? { ...d, holidays: res.holidays ?? d.holidays } : d));
      toast({ title: `Holidays imported`, description: `${res.added} added, ${res.updated} updated.` });
      await validate();
    } catch (err) {
      toast({ title: isApiError(err) ? err.message : 'Could not read the file', tone: 'error' });
    } finally {
      setBusy(null);
    }
  }

  async function submit() {
    if (!(await save())) return;
    setBusy('submit');
    try {
      setResult(await setupApi.submit());
      await refresh();
    } catch (err) {
      const submitIssues: SetupIssue[] | undefined = isApiError(err) ? err.body?.issues : undefined;
      if (submitIssues) setIssues(submitIssues);
      toast({ title: isApiError(err) ? err.message : 'Submit failed — nothing was saved', tone: 'error' });
    } finally {
      setBusy(null);
    }
  }

  const fieldErr = (id: SetupStepId) => (field: string) =>
    issuesFor(id).find((i) => i.level === 'error' && i.field === field)?.message;

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <header className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-border bg-card px-5 py-3">
        <div className="flex items-center gap-2">
          <img src={lumenMarkDark} alt="" className="brand-mark-light h-7 w-7 object-contain" />
          <img src={lumenMarkWhite} alt="" className="brand-mark-dark h-7 w-7 object-contain" />
          <div>
            <p className="text-sm font-semibold">Company setup</p>
            <p className="text-xs text-muted-foreground">
              {dirty ? 'Unsaved changes' : savedAt ? `Draft saved ${new Date(savedAt).toLocaleString()}` : 'Not saved yet'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {!result && (
            <Button variant="outline" size="sm" disabled={!draft || busy !== null} onClick={() => void save()}>
              <Save className="h-3.5 w-3.5" /> {busy === 'save' ? 'Saving…' : 'Save draft'}
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={() => void logout()}>
            <LogOut className="h-3.5 w-3.5" /> Sign out
          </Button>
        </div>
      </header>

      {loadError ? (
        <p className="p-8 text-sm text-destructive">{loadError}</p>
      ) : !draft ? (
        <p className="p-8 text-sm text-muted-foreground">Loading your setup…</p>
      ) : result ? (
        <SubmitDone result={result} onContinue={() => navigate('/', { replace: true })} />
      ) : (
        <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-4 py-6 md:flex-row">
          <nav className="md:w-60 md:shrink-0">
            <ol className="flex gap-1 overflow-x-auto md:flex-col">
              {SETUP_STEPS.map((s, i) => {
                const errs = s.id === 'review' ? allErrors.length : errorsFor(s.id).length;
                const done = i < furthest && errs === 0;
                return (
                  <li key={s.id}>
                    <button
                      type="button"
                      disabled={i > furthest}
                      onClick={() => void goTo(i)}
                      className={cn(
                        'flex w-full items-center gap-2 whitespace-nowrap rounded-md px-3 py-2 text-left text-sm',
                        i === step ? 'bg-secondary font-medium' : 'hover:bg-accent',
                        i > furthest && 'cursor-not-allowed opacity-50',
                      )}
                    >
                      <span
                        className={cn(
                          'flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[10px]',
                          done ? 'border-success bg-success text-success-foreground' : 'border-border',
                          errs > 0 && i <= furthest && 'border-destructive text-destructive',
                        )}
                      >
                        {done ? <Check className="h-3 w-3" /> : i + 1}
                      </span>
                      {s.label}
                    </button>
                  </li>
                );
              })}
            </ol>
          </nav>

          <main className="flex min-w-0 flex-1 flex-col gap-4">
            <div>
              <h1 className="text-xl font-semibold">{SETUP_STEPS[step].label}</h1>
              <p className="text-sm text-muted-foreground">
                Step {step + 1} of {SETUP_STEPS.length} · Save as a draft any time and pick up where you left off.
              </p>
            </div>

            {current === 'company' && <CompanyStep draft={draft} update={update} err={fieldErr('company')} issues={issuesFor('company')} />}
            {current === 'departments' && <DepartmentsStep draft={draft} update={update} err={fieldErr('departments')} issues={issuesFor('departments')} />}
            {current === 'profile' && <ProfileStep draft={draft} update={update} err={fieldErr('profile')} issues={issuesFor('profile')} />}
            {current === 'workWeek' && <WorkWeekStep draft={draft} update={update} err={fieldErr('workWeek')} issues={issuesFor('workWeek')} />}
            {current === 'attendance' && <AttendanceStep draft={draft} update={update} err={fieldErr('attendance')} issues={issuesFor('attendance')} />}
            {current === 'holidays' && (
              <HolidaysStep
                draft={draft}
                update={update}
                err={fieldErr('holidays')}
                issues={issuesFor('holidays')}
                onImport={(f) => void importHolidays(f)}
                importing={busy === 'holidays'}
                importIssues={holidayImportIssues}
              />
            )}
            {current === 'leavePolicy' && <LeavePolicyStep draft={draft} update={update} err={fieldErr('leavePolicy')} issues={issuesFor('leavePolicy')} />}
            {current === 'employees' && (
              <FileStep
                kind="employees"
                file={files.employees}
                report={reports.employees}
                busy={busy === 'employees'}
                onUpload={(f) => void uploadFile('employees', f)}
                onRemove={() => void removeFile('employees')}
              />
            )}
            {current === 'balances' && (
              <FileStep
                kind="balances"
                file={files.balances}
                report={reports.balances}
                busy={busy === 'balances'}
                onUpload={(f) => void uploadFile('balances', f)}
                onRemove={() => void removeFile('balances')}
              />
            )}
            {current === 'review' && (
              <Review draft={draft} files={files} issues={issues} onJump={(id) => void goTo(SETUP_STEPS.findIndex((s) => s.id === id))} />
            )}

            <div className="sticky bottom-0 flex items-center justify-between gap-2 border-t border-border bg-background py-3">
              <Button variant="outline" disabled={step === 0 || busy !== null} onClick={() => void goTo(step - 1)}>
                Back
              </Button>
              {current === 'review' ? (
                <Button disabled={allErrors.length > 0 || busy !== null} onClick={() => void submit()}>
                  {busy === 'submit' ? 'Setting up your company…' : 'Submit and finish setup'}
                </Button>
              ) : (
                <Button disabled={busy !== null} onClick={() => void next()}>
                  {busy === 'save' ? 'Saving…' : 'Save and continue'}
                </Button>
              )}
            </div>
          </main>
        </div>
      )}
    </div>
  );
}

function Review({
  draft,
  files,
  issues,
  onJump,
}: {
  draft: SetupDraft;
  files: { employees: FileSummary | null; balances: FileSummary | null };
  issues: SetupIssue[];
  onJump: (id: SetupStepId) => void;
}) {
  const errors = issues.filter((i) => i.level === 'error');
  const warnings = issues.filter((i) => i.level === 'warning');
  const label = (id: SetupStepId) => SETUP_STEPS.find((s) => s.id === id)?.label ?? id;
  const lp = draft.leavePolicy;
  const rows: [SetupStepId, string, string][] = [
    ['company', 'Company', `${draft.company.legalName ?? ''} · ${draft.company.city ?? ''}, ${stateLabel(draft.company.state ?? '')} · goes live ${draft.goLiveDate}`],
    ['departments', 'Departments', draft.departments.map((d) => d.name).join(', ')],
    [
      'profile',
      'Your profile',
      draft.profile.notAnEmployee
        ? 'Not an employee — no profile'
        : `${draft.profile.firstName} ${draft.profile.lastName} (${draft.profile.employeeCode}) · ${draft.profile.departmentName}`,
    ],
    [
      'workWeek',
      'Work week',
      `${draft.shifts.length} shift${draft.shifts.length === 1 ? '' : 's'} · default ${draft.shifts.find((s) => s.isDefault)?.name ?? '—'} · ${draft.workWeek.timezone}`,
    ],
    ['attendance', 'Attendance', `${draft.attendance.mode.replace('_', ' ').toLowerCase()} · cut-off day ${draft.attendance.payrollCutoffDay}`],
    [
      'holidays',
      'Holidays',
      `${draft.holidays.length} (${draft.holidays.filter((h) => h.optional).length} optional)`,
    ],
    [
      'leavePolicy',
      'Leave policy',
      `Year starts ${MONTHS[lp.fyStartMonth - 1]} · ${lp.leaveApprovalLevels === 2 ? 'manager then HR' : lp.leaveSingleApprover === 'MANAGER' ? 'manager-only' : 'HR-only'} approval · ${lp.types.map((t) => `${t.code} ${t.annualQuota}`).join(', ')}`,
    ],
    ['employees', 'Employees', files.employees ? `${files.employees.rowCount} rows from ${files.employees.fileName}` : 'None — add people after setup'],
    ['balances', 'Opening balances', files.balances ? `${files.balances.rowCount} rows from ${files.balances.fileName}` : 'None — everyone gets policy defaults'],
  ];
  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Everything at a glance</CardTitle>
          <CardDescription>
            Submitting applies all of this in one go — if anything fails, nothing is saved and you can try again. Payroll
            isn’t part of setup; you can set it up from the dashboard whenever you’re ready.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col divide-y divide-border">
          {rows.map(([id, name, value]) => (
            <div key={id} className="flex items-start justify-between gap-3 py-2.5 text-sm">
              <div>
                <p className="font-medium">{name}</p>
                <p className="text-muted-foreground">{value}</p>
              </div>
              <Button variant="ghost" size="sm" onClick={() => onJump(id)}>
                Edit
              </Button>
            </div>
          ))}
        </CardContent>
      </Card>
      {errors.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="h-4 w-4" /> {errors.length} problem{errors.length === 1 ? '' : 's'} to fix before submitting
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-1.5">
            {errors.map((i, n) => (
              <button key={n} type="button" onClick={() => onJump(i.step)} className="rounded-md bg-destructive/10 px-3 py-2 text-left text-xs text-destructive hover:underline">
                {label(i.step)}
                {i.row ? ` · row ${i.row}` : ''}: {i.message}
              </button>
            ))}
          </CardContent>
        </Card>
      )}
      {warnings.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-warning">Worth a look ({warnings.length})</CardTitle>
            <CardDescription>These won’t stop you submitting.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-1.5">
            {warnings.map((i, n) => (
              <p key={n} className="rounded-md bg-warning/10 px-3 py-2 text-xs text-warning">
                {label(i.step)}
                {i.row ? ` · row ${i.row}` : ''}: {i.message}
              </p>
            ))}
          </CardContent>
        </Card>
      )}
    </>
  );
}

function SubmitDone({ result, onContinue }: { result: SubmitResult; onContinue: () => void }) {
  const c = result.counts;
  return (
    <div className="mx-auto flex w-full max-w-xl flex-col items-center gap-4 px-4 py-12 text-center">
      <CheckCircle2 className="h-12 w-12 text-success" />
      <h1 className="text-xl font-semibold">Your company is set up</h1>
      <p className="text-sm text-muted-foreground">
        {c.employeesCreated ?? 0} employee{c.employeesCreated === 1 ? '' : 's'} added, {c.holidaysCreated ?? 0} holidays,{' '}
        {c.openingBalances ?? 0} opening balances and {c.policyCredits ?? 0} leave credits from your policy. Everyone in
        the workspace can use Lumen now.
      </p>
      {result.loginFailures.length > 0 && (
        <div className="w-full rounded-md bg-warning/10 p-3 text-left text-xs text-warning">
          <p className="font-medium">
            {result.loginFailures.length} login{result.loginFailures.length === 1 ? '' : 's'} couldn’t be created — the
            employees were saved. Retry from the dashboard:
          </p>
          <ul className="mt-1 list-disc pl-4">
            {result.loginFailures.map((f) => (
              <li key={f.email}>
                {f.employeeCode} · {f.email}: {f.error}
              </li>
            ))}
          </ul>
        </div>
      )}
      <Button onClick={onContinue}>Go to the dashboard</Button>
    </div>
  );
}
