import * as React from 'react';
import { Download, Plus, Trash2, Upload } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/field';
import { Select } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { EMPLOYEE_IMPORT_COLUMNS } from '@/lib/employee-import-columns';
import { HOLIDAY_COLUMNS } from '@/lib/leave/holiday-columns';
import { EVENT_PRESETS } from '@/lib/leave/event-presets';
import {
  INDIAN_STATES,
  MONTHS,
  OPENING_BALANCE_COLUMNS,
  stateLabel,
  type DraftLeaveType,
  type DraftShift,
  type FileSummary,
  type ImportReport,
  type SetupDraft,
  type SetupIssue,
} from '@/lib/setup';

/** What every step gets from the setup shell. */
export interface StepProps {
  draft: SetupDraft;
  update: (fn: (d: SetupDraft) => void) => void;
  /** First error for a field on this step, for inline display. */
  err: (field: string) => string | undefined;
  issues: SetupIssue[];
}

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const TIMEZONES = ['Asia/Kolkata', 'Asia/Dubai', 'Asia/Singapore', 'Europe/London', 'America/New_York'];
const num = (v: string) => (v === '' ? 0 : Number(v));

/** Number input that lets the field be emptied while typing (stores 0 meanwhile). */
function NumberInput({
  value,
  onValue,
  ...props
}: { value: number; onValue: (n: number) => void } & Omit<
  React.ComponentProps<typeof Input>,
  'value' | 'onChange' | 'type'
>) {
  const [text, setText] = React.useState(String(value));
  const shown = text === '' && value === 0 ? '' : Number(text) === value ? text : String(value);
  return (
    <Input
      {...props}
      type="number"
      value={shown}
      onChange={(e) => {
        setText(e.target.value);
        onValue(num(e.target.value));
      }}
    />
  );
}

function downloadCsv(fileName: string, header: string[]) {
  const blob = new Blob([header.join(',') + '\n'], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}

export function StepIssues({ issues, showErrors = true }: { issues: SetupIssue[]; showErrors?: boolean }) {
  const shown = issues.filter((i) => (showErrors ? true : i.level === 'warning') && !i.field);
  if (shown.length === 0) return null;
  return (
    <div className="flex flex-col gap-1.5">
      {shown.map((i, n) => (
        <p
          key={n}
          className={
            i.level === 'error'
              ? 'rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive'
              : 'rounded-md bg-warning/10 px-3 py-2 text-xs text-warning'
          }
        >
          {i.row ? `Row ${i.row}: ` : ''}
          {i.message}
        </p>
      ))}
    </div>
  );
}

/** Field-level warnings (field-level errors render inline via `err`). */
function FieldWarnings({ issues }: { issues: SetupIssue[] }) {
  const shown = issues.filter((i) => i.level === 'warning' && i.field);
  if (shown.length === 0) return null;
  return (
    <div className="flex flex-col gap-1.5">
      {shown.map((i, n) => (
        <p key={n} className="rounded-md bg-warning/10 px-3 py-2 text-xs text-warning">
          {i.message}
        </p>
      ))}
    </div>
  );
}

function Section({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent className="flex flex-col gap-4">{children}</CardContent>
    </Card>
  );
}

// ---- 1. Company ----

export function CompanyStep({ draft, update, err, issues }: StepProps) {
  const c = draft.company;
  const set = (k: keyof SetupDraft['company']) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    update((d) => {
      d.company[k] = e.target.value;
    });
  return (
    <>
      <Section title="Company details" description="Your company’s legal identity. You can edit it later in Company settings.">
        <Field label="Legal name" required error={err('legalName')}>
          <Input value={c.legalName ?? ''} onChange={set('legalName')} placeholder="Acme Health Pvt Ltd" />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Address" required error={err('addressLine1')}>
            <Input value={c.addressLine1 ?? ''} onChange={set('addressLine1')} />
          </Field>
          <Field label="Address line 2">
            <Input value={c.addressLine2 ?? ''} onChange={set('addressLine2')} />
          </Field>
          <Field label="City" required error={err('city')}>
            <Input value={c.city ?? ''} onChange={set('city')} />
          </Field>
          <Field label="State" required error={err('state')}>
            <Select value={c.state ?? ''} onChange={set('state')}>
              <option value="">Select a state</option>
              {INDIAN_STATES.map((s) => (
                <option key={s} value={s}>
                  {stateLabel(s)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="PIN code" required error={err('pincode')}>
            <Input inputMode="numeric" value={c.pincode ?? ''} onChange={set('pincode')} />
          </Field>
          <Field label="Contact email" required error={err('contactEmail')}>
            <Input type="email" value={c.contactEmail ?? ''} onChange={set('contactEmail')} />
          </Field>
          <Field label="Contact phone" required error={err('contactPhone')}>
            <Input inputMode="tel" value={c.contactPhone ?? ''} onChange={set('contactPhone')} />
          </Field>
          <Field label="GSTIN" hint="Optional" error={err('gstin')}>
            <Input value={c.gstin ?? ''} onChange={set('gstin')} />
          </Field>
          <Field label="CIN" hint="Optional" error={err('cin')}>
            <Input value={c.cin ?? ''} onChange={set('cin')} />
          </Field>
        </div>
      </Section>
      <Section
        title="Go-live date"
        description="The day your company starts running HR on Lumen. Leave for anyone without an imported opening balance is prorated from this date, and attendance is never marked for days before it."
      >
        <Field label="Go-live date" required error={err('goLiveDate')} className="max-w-xs">
          <Input
            type="date"
            value={draft.goLiveDate}
            onChange={(e) =>
              update((d) => {
                d.goLiveDate = e.target.value;
              })
            }
          />
        </Field>
        <FieldWarnings issues={issues} />
      </Section>
    </>
  );
}

// ---- 2. Departments ----

export function DepartmentsStep({ draft, update, err, issues }: StepProps) {
  return (
    <Section
      title="Departments"
      description="Add at least one. Every employee — including you — belongs to one, and your employee file must use these names."
    >
      <div className="flex flex-col gap-2">
        {draft.departments.map((dept, i) => (
          <div key={dept.existingId ?? `new-${i}`} className="flex items-start gap-2">
            <Field error={err(`departments[${i}].name`)} className="flex-1">
              <Input
                value={dept.name}
                disabled={!!dept.existingId}
                placeholder="e.g. Engineering"
                onChange={(e) =>
                  update((d) => {
                    d.departments[i].name = e.target.value;
                  })
                }
              />
            </Field>
            <Field className="w-32">
              <Input
                value={dept.code ?? ''}
                disabled={!!dept.existingId}
                placeholder="Code (optional)"
                onChange={(e) =>
                  update((d) => {
                    d.departments[i].code = e.target.value;
                  })
                }
              />
            </Field>
            {dept.existingId ? (
              <Badge variant="outline" className="mt-2">
                Saved
              </Badge>
            ) : (
              <Button
                variant="ghost"
                size="sm"
                className="mt-0.5"
                aria-label="Remove department"
                onClick={() =>
                  update((d) => {
                    d.departments.splice(i, 1);
                  })
                }
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            )}
          </div>
        ))}
      </div>
      <Button
        variant="outline"
        size="sm"
        className="self-start"
        onClick={() =>
          update((d) => {
            d.departments.push({ name: '' });
          })
        }
      >
        <Plus className="h-3.5 w-3.5" /> Add department
      </Button>
      <StepIssues issues={issues} />
    </Section>
  );
}

// ---- 3. Your profile ----

export function ProfileStep({ draft, update, err, issues }: StepProps) {
  const p = draft.profile;
  const set = (k: keyof SetupDraft['profile']) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    update((d) => {
      (d.profile as Record<string, unknown>)[k] = e.target.value;
    });
  return (
    <Section
      title="Your employee profile"
      description="Your own employee record, linked to your login — so you get leave, attendance and payslips like everyone else."
    >
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          className="h-4 w-4 rounded border-input"
          checked={p.notAnEmployee}
          onChange={(e) =>
            update((d) => {
              d.profile.notAnEmployee = e.target.checked;
            })
          }
        />
        I’m not an employee of this company (e.g. an outside consultant)
      </label>
      {!p.notAnEmployee && (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Employee code" required error={err('employeeCode')}>
            <Input value={p.employeeCode} onChange={set('employeeCode')} placeholder="e.g. ACME-001" />
          </Field>
          <Field label="Designation">
            <Input value={p.designation} onChange={set('designation')} />
          </Field>
          <Field label="First name" required error={err('firstName')}>
            <Input value={p.firstName} onChange={set('firstName')} />
          </Field>
          <Field label="Last name" required error={err('lastName')}>
            <Input value={p.lastName} onChange={set('lastName')} />
          </Field>
          <Field label="Department" required error={err('departmentName')}>
            <Select value={p.departmentName} onChange={set('departmentName')}>
              <option value="">Select a department</option>
              {draft.departments
                .filter((dept) => dept.name.trim())
                .map((dept) => (
                  <option key={dept.name} value={dept.name}>
                    {dept.name}
                  </option>
                ))}
            </Select>
          </Field>
          <Field label="Date of joining" required error={err('dateOfJoining')}>
            <Input type="date" value={p.dateOfJoining} onChange={set('dateOfJoining')} />
          </Field>
          <Field label="Gender" hint="Used for gender-restricted leave types">
            <Select value={p.gender} onChange={set('gender')}>
              <option value="">Prefer not to say</option>
              <option value="Male">Male</option>
              <option value="Female">Female</option>
              <option value="Other">Other</option>
            </Select>
          </Field>
          <Field label="Work state" hint="Decides Professional Tax" error={err('workState')}>
            <Select value={p.workState} onChange={set('workState')}>
              <option value="">Not set</option>
              {INDIAN_STATES.map((s) => (
                <option key={s} value={s}>
                  {stateLabel(s)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Phone">
            <Input inputMode="tel" value={p.phone} onChange={set('phone')} />
          </Field>
        </div>
      )}
      <StepIssues issues={issues} />
    </Section>
  );
}

// ---- 4. Work week & shifts ----

export function WorkWeekStep({ draft, update, err, issues }: StepProps) {
  const offs = draft.workWeek.weeklyOffDays;
  const blankShift: DraftShift = {
    name: '',
    type: 'FIXED',
    startTime: '09:00',
    endTime: '18:00',
    graceMinutes: 15,
    minHoursFullDay: 8,
    minHoursHalfDay: 4,
    isDefault: draft.shifts.length === 0,
  };
  return (
    <>
      <Section title="Work week">
        <Field label="Time zone" required error={err('timezone')} className="max-w-xs">
          <Select
            value={draft.workWeek.timezone}
            onChange={(e) =>
              update((d) => {
                d.workWeek.timezone = e.target.value;
              })
            }
          >
            {[...new Set([draft.workWeek.timezone, ...TIMEZONES])].filter(Boolean).map((tz) => (
              <option key={tz} value={tz}>
                {tz}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Weekly offs" error={err('weeklyOffDays')}>
          <div className="flex flex-wrap gap-2">
            {DAY_NAMES.map((name, day) => {
              const on = offs.includes(day);
              return (
                <button
                  key={day}
                  type="button"
                  aria-pressed={on}
                  onClick={() =>
                    update((d) => {
                      d.workWeek.weeklyOffDays = on
                        ? d.workWeek.weeklyOffDays.filter((x) => x !== day)
                        : [...d.workWeek.weeklyOffDays, day].sort();
                    })
                  }
                  className={
                    on
                      ? 'rounded-md border border-primary bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground'
                      : 'rounded-md border border-border px-3 py-1.5 text-sm hover:bg-accent'
                  }
                >
                  {name}
                </button>
              );
            })}
          </div>
        </Field>
      </Section>
      <Section
        title="Shifts"
        description="Employees without a shift of their own follow the default shift. Late marks, half days and overtime are worked out from these hours."
      >
        {draft.shifts.map((s, i) => {
          const f = (k: string) => err(`shifts[${i}].${k}`);
          const set = (k: keyof DraftShift, value: unknown) =>
            update((d) => {
              (d.shifts[i] as unknown as Record<string, unknown>)[k] = value;
            });
          return (
            <div key={s.existingId ?? `new-${i}`} className="flex flex-col gap-3 rounded-lg border border-border p-4">
              <div className="flex items-center justify-between gap-2">
                <label className="flex items-center gap-2 text-sm font-medium">
                  <input
                    type="radio"
                    name="default-shift"
                    checked={s.isDefault}
                    onChange={() =>
                      update((d) => {
                        d.shifts.forEach((x, j) => (x.isDefault = j === i));
                      })
                    }
                  />
                  Default shift
                </label>
                {!s.existingId && draft.shifts.length > 1 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label="Remove shift"
                    onClick={() =>
                      update((d) => {
                        d.shifts.splice(i, 1);
                      })
                    }
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
              </div>
              <div className="grid gap-3 sm:grid-cols-4">
                <Field label="Name" required error={f('name')} className="sm:col-span-2">
                  <Input value={s.name} onChange={(e) => set('name', e.target.value)} />
                </Field>
                <Field label="Type" error={f('type')} className="sm:col-span-2">
                  <Select value={s.type} onChange={(e) => set('type', e.target.value)}>
                    <option value="FIXED">Fixed</option>
                    <option value="FLEXI">Flexi</option>
                    <option value="ROTATIONAL">Rotational</option>
                  </Select>
                </Field>
                <Field label="Starts" required error={f('startTime')}>
                  <Input type="time" value={s.startTime} onChange={(e) => set('startTime', e.target.value)} />
                </Field>
                <Field label="Ends" required error={f('endTime')}>
                  <Input type="time" value={s.endTime} onChange={(e) => set('endTime', e.target.value)} />
                </Field>
                <Field label="Grace (min)" error={f('graceMinutes')}>
                  <NumberInput min={0} value={s.graceMinutes} onValue={(n) => set('graceMinutes', n)} />
                </Field>
                <div />
                <Field label="Full-day hours" error={f('minHoursFullDay')}>
                  <NumberInput step="0.5" value={s.minHoursFullDay} onValue={(n) => set('minHoursFullDay', n)} />
                </Field>
                <Field label="Half-day hours" error={f('minHoursHalfDay')}>
                  <NumberInput step="0.5" value={s.minHoursHalfDay} onValue={(n) => set('minHoursHalfDay', n)} />
                </Field>
                {s.type === 'FLEXI' && (
                  <>
                    <Field label="Core starts" required error={f('coreStartTime')}>
                      <Input
                        type="time"
                        value={s.coreStartTime ?? ''}
                        onChange={(e) => set('coreStartTime', e.target.value)}
                      />
                    </Field>
                    <Field label="Core ends" required>
                      <Input
                        type="time"
                        value={s.coreEndTime ?? ''}
                        onChange={(e) => set('coreEndTime', e.target.value)}
                      />
                    </Field>
                  </>
                )}
              </div>
            </div>
          );
        })}
        <Button
          variant="outline"
          size="sm"
          className="self-start"
          onClick={() =>
            update((d) => {
              d.shifts.push({ ...blankShift });
            })
          }
        >
          <Plus className="h-3.5 w-3.5" /> Add shift
        </Button>
        <StepIssues issues={issues} />
        <FieldWarnings issues={issues} />
      </Section>
    </>
  );
}

// ---- 5. Attendance rules ----

export function AttendanceStep({ draft, update, err }: StepProps) {
  const a = draft.attendance;
  const set = (k: keyof SetupDraft['attendance'], value: unknown) =>
    update((d) => {
      (d.attendance as Record<string, unknown>)[k] = value;
    });
  const methods = ['WEB', 'BIOMETRIC', 'GPS', 'IMPORT', 'MANUAL'];
  return (
    <Section title="Attendance rules">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Attendance mode" required error={err('mode')}>
          <Select value={a.mode} onChange={(e) => set('mode', e.target.value)}>
            <option value="SELF_SERVICE">Self-service — employees clock in and out</option>
            <option value="ROSTER">Roster — assigned shifts and device/imported punches</option>
            <option value="OFF">Off — don’t track attendance</option>
          </Select>
        </Field>
        <Field label="Payroll cut-off day" required error={err('payrollCutoffDay')} hint="Day of the month the attendance period locks (1–28).">
          <Input type="number" min={1} max={28} value={a.payrollCutoffDay} onChange={(e) => set('payrollCutoffDay', num(e.target.value))} />
        </Field>
      </div>
      <Field label="How attendance is captured" error={err('captureMethods')}>
        <div className="flex flex-wrap gap-4">
          {methods.map((m) => (
            <label key={m} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-input"
                checked={a.captureMethods.includes(m)}
                onChange={(e) =>
                  set(
                    'captureMethods',
                    e.target.checked ? [...a.captureMethods, m] : a.captureMethods.filter((x) => x !== m),
                  )
                }
              />
              {m.charAt(0) + m.slice(1).toLowerCase()}
            </label>
          ))}
        </div>
      </Field>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Regularization window (days)" error={err('regularizationWindowDays')} hint="How far back an employee can fix a day.">
          <Input type="number" min={1} value={a.regularizationWindowDays} onChange={(e) => set('regularizationWindowDays', num(e.target.value))} />
        </Field>
        <Field label="Regularizations per month" error={err('regularizationMonthlyCap')}>
          <Input type="number" min={1} value={a.regularizationMonthlyCap} onChange={(e) => set('regularizationMonthlyCap', num(e.target.value))} />
        </Field>
        <Field label="Requests nobody acts on" error={err('unactionedBehavior')} hint="Resolved at the payroll cut-off.">
          <Select value={a.unactionedBehavior} onChange={(e) => set('unactionedBehavior', e.target.value)}>
            <option value="AUTO_APPROVE">Approve automatically</option>
            <option value="AUTO_REJECT">Reject automatically</option>
          </Select>
        </Field>
      </div>
    </Section>
  );
}

// ---- 6. Holidays ----

export function HolidaysStep({
  draft,
  update,
  issues,
  onImport,
  importing,
  importIssues,
}: StepProps & {
  onImport: (file: File) => void;
  importing: boolean;
  importIssues: { row?: number; message: string }[];
}) {
  const [row, setRow] = React.useState({ date: '', name: '', optional: false });
  const optionalCount = draft.holidays.filter((h) => h.optional).length;
  return (
    <>
      <Section
        title="Import from a spreadsheet"
        description="Columns: date, name, type (PUBLIC or OPTIONAL). Rows already on the list are matched by date + name, so uploading a corrected file updates them instead of adding duplicates."
      >
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => downloadCsv('holidays-template.csv', HOLIDAY_COLUMNS.map((c) => c.name))}>
            <Download className="h-3.5 w-3.5" /> Template (.csv)
          </Button>
          <label>
            <input
              type="file"
              accept=".xlsx,.csv"
              className="hidden"
              disabled={importing}
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = '';
                if (f) onImport(f);
              }}
            />
            <span className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-md border border-border px-3 text-xs font-medium hover:bg-accent">
              <Upload className="h-3.5 w-3.5" /> {importing ? 'Reading…' : 'Upload holidays'}
            </span>
          </label>
        </div>
        <p className="text-xs text-muted-foreground">
          Dates as DD-MM-YYYY or YYYY-MM-DD. A slash date like 03/04/2027 is rejected — it reads as both 3 April and 4 March.
        </p>
        {importIssues.length > 0 && (
          <div className="flex flex-col gap-1.5">
            <p className="text-xs font-medium text-destructive">The file wasn’t added — fix these rows and upload it again:</p>
            {importIssues.map((i, n) => (
              <p key={n} className="rounded-md bg-destructive/10 px-3 py-1.5 text-xs text-destructive">
                {i.row ? `Row ${i.row}: ` : ''}
                {i.message}
              </p>
            ))}
          </div>
        )}
      </Section>
      <Section
        title={`Holidays (${draft.holidays.length})`}
        description="Public holidays are a day off for everyone. Optional holidays are working days unless an employee takes one as Restricted Holiday leave."
      >
        <div className="flex flex-wrap items-end gap-2">
          <Field label="Date">
            <Input type="date" value={row.date} onChange={(e) => setRow({ ...row, date: e.target.value })} />
          </Field>
          <Field label="Name" className="min-w-48 flex-1">
            <Input value={row.name} onChange={(e) => setRow({ ...row, name: e.target.value })} />
          </Field>
          <label className="flex h-9 items-center gap-2 text-sm">
            <input type="checkbox" className="h-4 w-4" checked={row.optional} onChange={(e) => setRow({ ...row, optional: e.target.checked })} />
            Optional
          </label>
          <Button
            size="sm"
            className="mb-0.5"
            disabled={!row.date || !row.name.trim()}
            onClick={() => {
              update((d) => {
                d.holidays.push({ date: row.date, name: row.name.trim(), optional: row.optional });
                d.holidays.sort((a, b) => a.date.localeCompare(b.date));
              });
              setRow({ date: '', name: '', optional: false });
            }}
          >
            <Plus className="h-3.5 w-3.5" /> Add
          </Button>
        </div>
        {draft.holidays.length > 0 && (
          <div className="max-h-96 overflow-auto rounded-md border border-border">
            <Table>
              <THead>
                <TR>
                  <TH>Date</TH>
                  <TH>Name</TH>
                  <TH>Type</TH>
                  <TH />
                </TR>
              </THead>
              <TBody>
                {draft.holidays.map((h, i) => {
                  const problem = issues.find((x) => x.field === h.date);
                  return (
                    <TR key={`${h.date}-${h.name}`}>
                      <TD className="whitespace-nowrap font-mono text-xs">{h.date}</TD>
                      <TD>
                        {h.name}
                        {problem && (
                          <p className={problem.level === 'error' ? 'text-xs text-destructive' : 'text-xs text-warning'}>
                            {problem.message}
                          </p>
                        )}
                      </TD>
                      <TD>
                        {h.existingId ? (
                          <Badge variant="outline">{h.optional ? 'Optional · saved' : 'Saved'}</Badge>
                        ) : (
                          <label className="flex items-center gap-1.5 text-xs">
                            <input
                              type="checkbox"
                              checked={h.optional}
                              onChange={(e) =>
                                update((d) => {
                                  d.holidays[i].optional = e.target.checked;
                                })
                              }
                            />
                            Optional
                          </label>
                        )}
                      </TD>
                      <TD className="text-right">
                        {!h.existingId && (
                          <Button
                            variant="ghost"
                            size="sm"
                            aria-label={`Remove ${h.name}`}
                            onClick={() =>
                              update((d) => {
                                d.holidays.splice(i, 1);
                              })
                            }
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        )}
                      </TD>
                    </TR>
                  );
                })}
              </TBody>
            </Table>
          </div>
        )}
        {optionalCount > 0 && (
          <p className="text-xs text-muted-foreground">
            {optionalCount} optional holiday{optionalCount === 1 ? '' : 's'} — set how many each employee may take with a
            Restricted Holiday leave type in the next step.
          </p>
        )}
        <StepIssues issues={issues.filter((i) => !i.field)} />
      </Section>
    </>
  );
}

// ---- 7. Leave policy ----

const blankType = (): DraftLeaveType => ({
  name: '',
  code: '',
  colorToken: '#2b5a8c',
  annualQuota: 12,
  carryForwardCap: 0,
  minNoticeDays: 0,
  accrualFrequency: 'ANNUAL',
  genderRestriction: 'ANY',
  paid: true,
  requiresApproval: true,
  isCompOff: false,
  isRestrictedHoliday: false,
});

export function LeavePolicyStep({ draft, update, err, issues }: StepProps) {
  const lp = draft.leavePolicy;
  const set = (k: keyof SetupDraft['leavePolicy'], value: unknown) =>
    update((d) => {
      (d.leavePolicy as Record<string, unknown>)[k] = value;
    });
  return (
    <>
      <Section title="Leave year and approvals">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Leave year starts in" required error={err('fyStartMonth')} hint="Balances, quotas and carry-forward run on this year.">
            <Select value={lp.fyStartMonth} onChange={(e) => set('fyStartMonth', Number(e.target.value))}>
              {MONTHS.map((m, i) => (
                <option key={m} value={i + 1}>
                  {m}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Approval levels" error={err('leaveApprovalLevels') ?? err('leaveSingleApprover')}>
            <Select
              value={lp.leaveApprovalLevels === 2 ? 'MANAGER_THEN_HR' : (lp.leaveSingleApprover ?? 'HR')}
              onChange={(e) => {
                const v = e.target.value;
                set('leaveApprovalLevels', v === 'MANAGER_THEN_HR' ? 2 : 1);
                set('leaveSingleApprover', v === 'MANAGER' ? 'MANAGER' : 'HR');
              }}
            >
              <option value="HR">1 — HR approves</option>
              <option value="MANAGER">1 — reporting manager only</option>
              <option value="MANAGER_THEN_HR">2 — reporting manager, then HR</option>
            </Select>
          </Field>
          <Field label="Escalate after (days)" error={err('leaveEscalationDays')} hint="An undecided request is flagged after this long.">
            <Input type="number" min={1} value={lp.leaveEscalationDays} onChange={(e) => set('leaveEscalationDays', num(e.target.value))} />
          </Field>
          <label className="flex items-center gap-2 self-end pb-2 text-sm">
            <input type="checkbox" className="h-4 w-4" checked={lp.allowLopRequests} onChange={(e) => set('allowLopRequests', e.target.checked)} />
            Allow requests beyond the balance (as loss of pay)
          </label>
        </div>
        <FieldWarnings issues={issues.filter((i) => i.field === 'fyStartMonth')} />
      </Section>
      <Section
        title="Leave types"
        description="Annual types are granted at the start of the leave year (prorated for joiners and your go-live date). Monthly and quarterly types are credited as each period starts."
      >
        {lp.types.map((t, i) => {
          const f = (k: string) => err(`types[${i}].${k}`);
          const setT = (k: keyof DraftLeaveType, value: unknown) =>
            update((d) => {
              (d.leavePolicy.types[i] as unknown as Record<string, unknown>)[k] = value;
            });
          return (
            <div key={t.existingId ?? `new-${i}`} className="flex flex-col gap-3 rounded-lg border border-border p-4">
              {t.grantMode === 'ON_EVENT' ? (
                <EventTypeFields t={t} f={f} setT={setT} />
              ) : (
              <div className="grid gap-3 sm:grid-cols-6">
                <Field label="Name" required error={f('name')} className="sm:col-span-3">
                  <Input value={t.name} onChange={(e) => setT('name', e.target.value)} />
                </Field>
                <Field label="Code" required error={f('code')} className="sm:col-span-1">
                  <Input value={t.code} onChange={(e) => setT('code', e.target.value.toUpperCase())} />
                </Field>
                <Field label="Accrues" error={f('accrualFrequency')} className="sm:col-span-2">
                  <Select value={t.accrualFrequency} onChange={(e) => setT('accrualFrequency', e.target.value)}>
                    <option value="ANNUAL">Yearly, at the start</option>
                    <option value="MONTHLY">Monthly</option>
                    <option value="QUARTERLY">Quarterly</option>
                  </Select>
                </Field>
                <Field label="Days / year" error={f('annualQuota')} className="sm:col-span-1">
                  <Input type="number" step="0.5" min={0} value={t.annualQuota} onChange={(e) => setT('annualQuota', num(e.target.value))} />
                </Field>
                <Field label="Carry-forward cap" error={f('carryForwardCap')} className="sm:col-span-2">
                  <Input type="number" step="0.5" min={0} value={t.carryForwardCap} onChange={(e) => setT('carryForwardCap', num(e.target.value))} />
                </Field>
                <Field label="Notice (days)" error={f('minNoticeDays')} className="sm:col-span-1">
                  <Input type="number" min={0} value={t.minNoticeDays} onChange={(e) => setT('minNoticeDays', num(e.target.value))} />
                </Field>
                <Field label="Who can take it" error={f('genderRestriction')} className="sm:col-span-2">
                  <Select value={t.genderRestriction} onChange={(e) => setT('genderRestriction', e.target.value)}>
                    <option value="ANY">Everyone</option>
                    <option value="FEMALE">Women only</option>
                    <option value="MALE">Men only</option>
                  </Select>
                </Field>
              </div>
              )}
              <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={t.paid} onChange={(e) => setT('paid', e.target.checked)} /> Paid
                </label>
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={t.requiresApproval} onChange={(e) => setT('requiresApproval', e.target.checked)} /> Needs approval
                </label>
                {t.grantMode !== 'ON_EVENT' && (
                <>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={t.isRestrictedHoliday}
                    disabled={t.isCompOff}
                    onChange={(e) => setT('isRestrictedHoliday', e.target.checked)}
                  />
                  Restricted holiday (only on optional holidays)
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={t.isCompOff}
                    disabled={t.isRestrictedHoliday}
                    onChange={(e) => setT('isCompOff', e.target.checked)}
                  />
                  Comp-off (earned by working a holiday)
                </label>
                </>
                )}
                {t.existingId ? (
                  <Badge variant="outline" className="ml-auto">
                    Saved
                  </Badge>
                ) : (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="ml-auto"
                    onClick={() =>
                      update((d) => {
                        d.leavePolicy.types.splice(i, 1);
                      })
                    }
                  >
                    <Trash2 className="h-4 w-4" /> Remove
                  </Button>
                )}
              </div>
              <FieldWarnings issues={issues.filter((x) => x.field?.startsWith(`types[${i}].`))} />
            </div>
          );
        })}
        <Button
          variant="outline"
          size="sm"
          className="self-start"
          onClick={() =>
            update((d) => {
              d.leavePolicy.types.push(blankType());
            })
          }
        >
          <Plus className="h-3.5 w-3.5" /> Add leave type
        </Button>
        <Field label="Or add a ready-made event-based type" className="max-w-md">
          <Select
            value=""
            onChange={(e) => {
              const preset = EVENT_PRESETS.find((p) => p.code === e.target.value);
              if (!preset) return;
              const { summary: _summary, ...fields } = preset;
              void _summary;
              update((d) => {
                d.leavePolicy.types.push({ ...blankType(), ...fields, grantMode: 'ON_EVENT', annualQuota: 0 });
              });
            }}
          >
            <option value="">Choose…</option>
            {EVENT_PRESETS.filter((p) => !lp.types.some((t) => t.code === p.code)).map((p) => (
              <option key={p.code} value={p.code}>
                {p.name} — {p.summary}
              </option>
            ))}
          </Select>
        </Field>
        <StepIssues issues={issues.filter((i) => !i.field)} />
      </Section>
    </>
  );
}

/** The fields of an event-based leave type (maternity, paternity, marriage…). */
function EventTypeFields({
  t,
  f,
  setT,
}: {
  t: DraftLeaveType;
  f: (k: string) => string | undefined;
  setT: (k: keyof DraftLeaveType, value: unknown) => void;
}) {
  const opt = (v: string) => (v === '' ? null : Number(v));
  return (
    <>
      <div className="flex items-center gap-2">
        <Badge variant="outline">Per event — no yearly balance</Badge>
      </div>
      <div className="grid gap-3 sm:grid-cols-6">
        <Field label="Name" required error={f('name')} className="sm:col-span-3">
          <Input value={t.name} onChange={(e) => setT('name', e.target.value)} />
        </Field>
        <Field label="Code" required error={f('code')} className="sm:col-span-1">
          <Input value={t.code} onChange={(e) => setT('code', e.target.value.toUpperCase())} />
        </Field>
        <Field label="Who can take it" error={f('genderRestriction')} className="sm:col-span-2">
          <Select value={t.genderRestriction} onChange={(e) => setT('genderRestriction', e.target.value)}>
            <option value="ANY">Everyone</option>
            <option value="FEMALE">Women only</option>
            <option value="MALE">Men only</option>
          </Select>
        </Field>
        <Field label="Event the employee enters" error={f('daysPerEvent')} className="sm:col-span-3">
          <Input value={t.eventLabel ?? ''} onChange={(e) => setT('eventLabel', e.target.value)} />
        </Field>
        <Field label="Days per event" className="sm:col-span-1">
          <Input type="number" min={0} value={t.daysPerEvent ?? ''} onChange={(e) => setT('daysPerEvent', opt(e.target.value))} />
        </Field>
        <Field label="Times per employment" hint="Blank = no limit" className="sm:col-span-2">
          <Input type="number" min={1} value={t.maxEventsPerEmployment ?? ''} onChange={(e) => setT('maxEventsPerEmployment', opt(e.target.value))} />
        </Field>
        <Field label="Start up to (days before)" className="sm:col-span-2">
          <Input type="number" min={0} value={t.eventWindowDaysBefore ?? 0} onChange={(e) => setT('eventWindowDaysBefore', num(e.target.value))} />
        </Field>
        <Field label="Start within (days after)" className="sm:col-span-2">
          <Input type="number" min={0} value={t.eventWindowDaysAfter ?? 0} onChange={(e) => setT('eventWindowDaysAfter', num(e.target.value))} />
        </Field>
        <Field label="Service needed (days)" hint="In the 12 months before the event" className="sm:col-span-2">
          <Input type="number" min={0} value={t.minServiceDays ?? 0} onChange={(e) => setT('minServiceDays', num(e.target.value))} />
        </Field>
        <Field label="Reduced days" hint="e.g. 84 from the 3rd child" className="sm:col-span-3">
          <Input type="number" min={0} value={t.reducedDaysPerEvent ?? ''} onChange={(e) => setT('reducedDaysPerEvent', opt(e.target.value))} />
        </Field>
        <Field label="…after this many events" className="sm:col-span-3">
          <Input type="number" min={0} value={t.reducedAfterEvents ?? ''} onChange={(e) => setT('reducedAfterEvents', opt(e.target.value))} />
        </Field>
      </div>
      <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={!!t.countCalendarDays} onChange={(e) => setT('countCalendarDays', e.target.checked)} /> Calendar days
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={!!t.requiresDocument} onChange={(e) => setT('requiresDocument', e.target.checked)} /> Needs a document
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={!!t.statutoryMaternity} onChange={(e) => setT('statutoryMaternity', e.target.checked)} /> Statutory maternity (flags ESI members)
        </label>
      </div>
    </>
  );
}

// ---- 8 & 9. File steps ----

export function ReportTable({ report, keyLabel = 'Code' }: { report: ImportReport; keyLabel?: string }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Badge variant="success">{report.succeeded} valid</Badge>
        {report.failed > 0 && <Badge variant="destructive">{report.failed} with errors</Badge>}
        <span className="text-muted-foreground">of {report.totalRows} rows</span>
      </div>
      {report.ignoredColumns.length > 0 && (
        <p className="text-xs text-warning">Ignored unrecognised columns: {report.ignoredColumns.join(', ')}</p>
      )}
      <div className="max-h-96 overflow-auto rounded-md border border-border">
        <Table>
          <THead>
            <TR>
              <TH>Row</TH>
              <TH>{keyLabel}</TH>
              <TH>Status</TH>
              <TH>Details</TH>
            </TR>
          </THead>
          <TBody>
            {report.results.map((r) => (
              <TR key={r.row}>
                <TD className="text-muted-foreground">{r.row}</TD>
                <TD className="font-mono text-xs">{r.employeeCode ?? '—'}</TD>
                <TD>
                  {r.success ? (
                    <Badge variant={r.action === 'update' ? 'default' : 'success'}>{r.action === 'update' ? 'Update' : 'New'}</Badge>
                  ) : (
                    <Badge variant="destructive">Error</Badge>
                  )}
                </TD>
                <TD className="text-xs">
                  {r.error && <p className="text-destructive">{r.error}</p>}
                  {r.detail && <p className="text-muted-foreground">{r.detail}</p>}
                  {r.warnings?.map((w) => (
                    <p key={w} className="text-warning">
                      {w}
                    </p>
                  ))}
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </div>
    </div>
  );
}

export function FileStep({
  kind,
  file,
  report,
  busy,
  onUpload,
  onRemove,
}: {
  kind: 'employees' | 'balances';
  file: FileSummary | null;
  report: ImportReport | null;
  busy: boolean;
  onUpload: (file: File) => void;
  onRemove: () => void;
}) {
  const employees = kind === 'employees';
  const columns = employees ? EMPLOYEE_IMPORT_COLUMNS : OPENING_BALANCE_COLUMNS;
  return (
    <>
      <Section
        title={employees ? 'Import your employees' : 'Opening leave balances'}
        description={
          employees
            ? 'Optional — you can also add people one by one after setup. Departments must match the Departments step exactly; a login email creates the login and emails an invite once setup is submitted. Leave out your own row: the Your profile step already creates it.'
            : 'Optional — for companies moving from another HRMS. One row per employee and leave type: the days they had available the day before go-live. Anyone not in this file gets your leave policy’s defaults, prorated from the go-live date. For monthly and quarterly types, Lumen keeps accruing from go-live on top of the opening balance.'
        }
      >
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              downloadCsv(employees ? 'employees-template.csv' : 'opening-balances-template.csv', columns.map((c) => c.name))
            }
          >
            <Download className="h-3.5 w-3.5" /> Template (.csv)
          </Button>
          <label>
            <input
              type="file"
              accept=".xlsx,.csv"
              className="hidden"
              disabled={busy}
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = '';
                if (f) onUpload(f);
              }}
            />
            <span className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-md border border-border px-3 text-xs font-medium hover:bg-accent">
              <Upload className="h-3.5 w-3.5" /> {busy ? 'Checking…' : file ? 'Replace file' : 'Upload file'}
            </span>
          </label>
          {file && (
            <>
              <span className="text-xs text-muted-foreground">
                {file.fileName} · {file.rowCount} rows
              </span>
              <Button variant="ghost" size="sm" disabled={busy} onClick={onRemove}>
                <Trash2 className="h-3.5 w-3.5" /> Remove
              </Button>
            </>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          Nothing is created yet — the file is checked now and saved with your draft, and imported only when you submit
          setup. Every row must be valid to submit.
        </p>
        <details>
          <summary className="cursor-pointer text-sm font-medium">Column reference</summary>
          <div className="mt-2 overflow-x-auto">
            <Table>
              <TBody>
                {columns.map((c) => (
                  <TR key={c.name}>
                    <TD className="whitespace-nowrap font-mono text-xs">
                      {c.name}
                      {c.required && <span className="text-destructive"> *</span>}
                    </TD>
                    <TD className="text-xs">{c.description}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </div>
        </details>
      </Section>
      {report && (
        <Section title="Check results">
          <ReportTable report={report} />
        </Section>
      )}
    </>
  );
}
