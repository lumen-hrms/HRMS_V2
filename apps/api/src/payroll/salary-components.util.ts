import { Prisma } from '@prisma/client';
import { evaluateFormula, formulaReferences } from './formula.evaluator';

type Decimal = Prisma.Decimal;

export interface ComponentInput {
  code: string;
  calculationMode: 'FIXED' | 'PERCENT_OF_BASIC' | 'PERCENT_OF_CTC' | 'FORMULA';
  value?: Prisma.Decimal | number | string | null;
  formula?: string | null;
}

/** Reserved formula variable: the structure's monthly CTC (annual ÷ 12). */
export const CTC_VARIABLE = 'CTC';
export const BASIC_CODE = 'BASIC';

/**
 * Resolves every component to its MONTHLY amount, at full precision (rounding
 * is the calculation engine's job, per statute). Throws on an unknown
 * reference or a circular dependency.
 */
export function resolveMonthlyAmounts(
  components: ComponentInput[],
  ctcAnnual: Prisma.Decimal | number | string,
): Map<string, Decimal> {
  const monthlyCtc = new Prisma.Decimal(ctcAnnual).div(12);
  const byCode = new Map(components.map((c) => [c.code, c]));
  const resolved = new Map<string, Decimal>();
  const visiting = new Set<string>();

  const resolve = (code: string): Decimal => {
    const done = resolved.get(code);
    if (done) return done;
    const comp = byCode.get(code);
    if (!comp) throw new Error(`Unknown component reference ${code}`);
    if (visiting.has(code)) throw new Error(`Circular reference involving ${code}`);
    visiting.add(code);

    const value = new Prisma.Decimal(comp.value ?? 0);
    let amount: Decimal;
    if (comp.calculationMode === 'FIXED') {
      amount = value;
    } else if (comp.calculationMode === 'PERCENT_OF_CTC') {
      amount = monthlyCtc.times(value).div(100);
    } else if (comp.calculationMode === 'PERCENT_OF_BASIC') {
      amount = resolve(BASIC_CODE).times(value).div(100);
    } else {
      const vars: Record<string, Decimal> = { [CTC_VARIABLE]: monthlyCtc };
      for (const ref of formulaReferences(comp.formula ?? '')) {
        if (ref !== CTC_VARIABLE) vars[ref] = resolve(ref);
      }
      amount = evaluateFormula(comp.formula ?? '', vars);
    }

    visiting.delete(code);
    resolved.set(code, amount);
    return amount;
  };

  for (const c of components) resolve(c.code);
  return resolved;
}
