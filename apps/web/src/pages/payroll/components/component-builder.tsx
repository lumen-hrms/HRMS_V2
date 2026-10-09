import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Field } from '@/components/ui/field';
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/table';
import { formatMoney } from './money';
import type { SalaryCalculationMode, SalaryComponentInput, SalaryComponentType } from '@/lib/payroll/types';

const STANDARD_TYPES: SalaryComponentType[] = [
  'BASIC',
  'DA',
  'HRA',
  'SPECIAL_ALLOWANCE',
  'CONVEYANCE',
  'LTA',
  'MEDICAL',
];
const EMPLOYER_COST_TYPES: SalaryComponentType[] = ['PF_EMPLOYER', 'ESI_EMPLOYER', 'GRATUITY_PROVISION'];
const ALL_TYPES: SalaryComponentType[] = [...STANDARD_TYPES, 'CUSTOM', ...EMPLOYER_COST_TYPES];

/** Basic 50% of CTC, HRA 40% of Basic, the rest as a balancing formula (§5.4 quick-start). */
export const STANDARD_TEMPLATE: SalaryComponentInput[] = [
  { type: 'BASIC', name: 'Basic', calculationMode: 'PERCENT_OF_CTC', value: 50, sortOrder: 0 },
  { type: 'HRA', name: 'HRA', calculationMode: 'PERCENT_OF_BASIC', value: 40, sortOrder: 1 },
  {
    type: 'SPECIAL_ALLOWANCE',
    name: 'Special Allowance',
    calculationMode: 'FORMULA',
    formula: 'CTC - BASIC - HRA',
    sortOrder: 2,
  },
];

/** Resolves a monthly amount client-side for the live summary — FIXED/percent
 *  only; FORMULA rows show "—" (evaluating the real grammar isn't worth
 *  duplicating client-side just for a preview the server re-validates anyway). */
function previewMonthlyAmount(
  c: SalaryComponentInput,
  ctcAnnual: number,
  basicMonthly: number,
): number | null {
  const monthlyCtc = ctcAnnual / 12;
  if (c.calculationMode === 'FIXED') return c.value ?? 0;
  if (c.calculationMode === 'PERCENT_OF_CTC') return (monthlyCtc * (c.value ?? 0)) / 100;
  if (c.calculationMode === 'PERCENT_OF_BASIC') return (basicMonthly * (c.value ?? 0)) / 100;
  return null;
}

export function ComponentBuilder({
  ctcAnnual,
  onCtcAnnualChange,
  effectiveDateLabel,
  effectiveDate,
  onEffectiveDateChange,
  components,
  onComponentsChange,
  minBasicPercent,
}: {
  ctcAnnual: number;
  onCtcAnnualChange: (v: number) => void;
  effectiveDateLabel: string;
  effectiveDate: string;
  onEffectiveDateChange: (v: string) => void;
  components: SalaryComponentInput[];
  onComponentsChange: (v: SalaryComponentInput[]) => void;
  minBasicPercent: number;
}) {
  const monthlyCtc = ctcAnnual / 12;
  const basic = components.find((c) => c.type === 'BASIC');
  const basicMonthly = basic ? previewMonthlyAmount(basic, ctcAnnual, 0) ?? 0 : 0;
  const basicPercent = monthlyCtc > 0 ? (basicMonthly / monthlyCtc) * 100 : 0;
  const belowFloor = components.some((c) => c.type === 'BASIC') && basicPercent < minBasicPercent;

  function update(index: number, patch: Partial<SalaryComponentInput>) {
    onComponentsChange(components.map((c, i) => (i === index ? { ...c, ...patch } : c)));
  }
  function remove(index: number) {
    onComponentsChange(components.filter((_, i) => i !== index));
  }
  function add() {
    onComponentsChange([
      ...components,
      { type: 'CUSTOM', code: '', name: '', calculationMode: 'FIXED', value: 0, sortOrder: components.length },
    ]);
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3">
        <Field label="Annual CTC" required>
          <Input
            type="number"
            min={0}
            value={ctcAnnual}
            onChange={(e) => onCtcAnnualChange(Number(e.target.value))}
          />
        </Field>
        <Field label={effectiveDateLabel} required>
          <Input
            type="date"
            value={effectiveDate}
            onChange={(e) => onEffectiveDateChange(e.target.value)}
          />
        </Field>
      </div>

      <div className="flex items-center gap-4 rounded-md border border-border bg-muted/40 p-3 text-sm">
        <span className="text-muted-foreground">Monthly CTC</span>
        <span className="font-medium tabular-nums">{formatMoney(monthlyCtc)}</span>
        <span className="text-muted-foreground">Basic % of CTC</span>
        <span className={belowFloor ? 'font-medium text-destructive' : 'font-medium tabular-nums'}>
          {basicPercent.toFixed(2)}%
        </span>
        {belowFloor && (
          <span className="text-destructive">
            Basic is {basicPercent.toFixed(2)}% of CTC — minimum {minBasicPercent}%
          </span>
        )}
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="ml-auto"
          onClick={() => onComponentsChange(STANDARD_TEMPLATE)}
        >
          Use standard template
        </Button>
      </div>

      <Table>
        <THead>
          <TR>
            <TH>Type</TH>
            <TH>Code</TH>
            <TH>Name</TH>
            <TH>Mode</TH>
            <TH>Value / Formula</TH>
            <TH className="text-right">Monthly</TH>
            <TH></TH>
          </TR>
        </THead>
        <TBody>
          {components.map((c, i) => {
            const preview = previewMonthlyAmount(c, ctcAnnual, basicMonthly);
            return (
              <TR key={i}>
                <TD>
                  <Select
                    value={c.type}
                    onChange={(e) => {
                      const type = e.target.value as SalaryComponentType;
                      update(i, { type, code: type === 'CUSTOM' ? c.code : undefined });
                    }}
                  >
                    {ALL_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {t.replace(/_/g, ' ')}
                      </option>
                    ))}
                  </Select>
                </TD>
                <TD>
                  {c.type === 'CUSTOM' ? (
                    <Input
                      value={c.code ?? ''}
                      placeholder="MY_ALLOWANCE"
                      onChange={(e) => update(i, { code: e.target.value.toUpperCase() })}
                      className="w-36"
                    />
                  ) : (
                    <span className="text-muted-foreground">{c.type}</span>
                  )}
                </TD>
                <TD>
                  <Input
                    value={c.name}
                    onChange={(e) => update(i, { name: e.target.value })}
                    className="w-40"
                  />
                </TD>
                <TD>
                  <Select
                    value={c.calculationMode}
                    onChange={(e) =>
                      update(i, { calculationMode: e.target.value as SalaryCalculationMode })
                    }
                  >
                    <option value="FIXED">Fixed (₹/mo)</option>
                    <option value="PERCENT_OF_BASIC">% of Basic</option>
                    <option value="PERCENT_OF_CTC">% of CTC</option>
                    <option value="FORMULA">Formula</option>
                  </Select>
                </TD>
                <TD>
                  {c.calculationMode === 'FORMULA' ? (
                    <Input
                      value={c.formula ?? ''}
                      placeholder="CTC - BASIC - HRA"
                      onChange={(e) => update(i, { formula: e.target.value })}
                      className="w-48 font-mono text-xs"
                    />
                  ) : (
                    <Input
                      type="number"
                      value={c.value ?? 0}
                      onChange={(e) => update(i, { value: Number(e.target.value) })}
                      className="w-28"
                    />
                  )}
                </TD>
                <TD className="text-right tabular-nums text-muted-foreground">
                  {preview == null ? '—' : formatMoney(preview)}
                </TD>
                <TD>
                  <Button type="button" variant="outline" size="sm" onClick={() => remove(i)}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </TD>
              </TR>
            );
          })}
        </TBody>
      </Table>

      <Button type="button" variant="outline" size="sm" className="self-start" onClick={add}>
        <Plus className="h-4 w-4" /> Add component
      </Button>
    </div>
  );
}
