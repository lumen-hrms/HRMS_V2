import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { COMPONENT_CODE, type SalaryComponentDto } from './dto/payroll.dto';
import { BASIC_CODE, CTC_VARIABLE, resolveMonthlyAmounts } from './salary-components.util';
import { FormulaError, parseFormula } from './formula.evaluator';

export interface NormalizedComponent {
  type: SalaryComponentDto['type'];
  code: string;
  name: string;
  calculationMode: SalaryComponentDto['calculationMode'];
  value: number | null;
  formula: string | null;
  sortOrder: number;
}

/**
 * Normalises and validates a structure's components. Throws BadRequest for
 * anything that would produce a nonsense payroll: duplicate/reserved codes,
 * mode/field mismatches, bad formulas, circular references, missing Basic,
 * and Basic below the tenant's floor (module 07 INV-3, FR-PAY-003).
 */
export function normalizeAndValidateComponents(
  components: SalaryComponentDto[],
  ctcAnnual: number,
  minBasicPercent: Prisma.Decimal | number | string,
): NormalizedComponent[] {
  const seen = new Set<string>();
  const normalized = components.map((c, index): NormalizedComponent => {
    let code = c.code;
    if (c.type === 'CUSTOM') {
      if (!code) throw new BadRequestException('CUSTOM components need a code');
      if (code === CTC_VARIABLE || code in STANDARD_CODES) {
        throw new BadRequestException(`Code ${code} is reserved`);
      }
    } else {
      if (code && code !== c.type) {
        throw new BadRequestException(`A ${c.type} component's code must be ${c.type}`);
      }
      code = c.type;
    }
    if (!COMPONENT_CODE.test(code!)) throw new BadRequestException(`Invalid code ${code}`);
    if (seen.has(code!)) throw new BadRequestException(`Duplicate component ${code}`);
    seen.add(code!);

    if (c.calculationMode === 'FORMULA') {
      if (!c.formula) throw new BadRequestException(`${code}: a FORMULA component needs a formula`);
      if (c.value !== undefined) {
        throw new BadRequestException(`${code}: a FORMULA component takes no value`);
      }
      try {
        parseFormula(c.formula);
      } catch (e) {
        throw new BadRequestException(`${code}: ${(e as FormulaError).message}`);
      }
    } else {
      if (c.formula)
        throw new BadRequestException(`${code}: only FORMULA components take a formula`);
      if (c.value === undefined) throw new BadRequestException(`${code}: a value is required`);
      if (c.calculationMode !== 'FIXED' && c.value > 100) {
        throw new BadRequestException(`${code}: a percentage cannot exceed 100`);
      }
    }

    return {
      type: c.type,
      code: code!,
      name: c.name,
      calculationMode: c.calculationMode,
      value: c.value ?? null,
      formula: c.formula ?? null,
      sortOrder: c.sortOrder ?? index,
    };
  });

  const basic = normalized.filter((c) => c.code === BASIC_CODE);
  if (basic.length !== 1)
    throw new BadRequestException('A structure needs exactly one BASIC component');
  if (basic[0].calculationMode === 'PERCENT_OF_BASIC') {
    throw new BadRequestException('BASIC cannot be a percentage of itself');
  }

  let amounts: Map<string, Prisma.Decimal>;
  try {
    amounts = resolveMonthlyAmounts(normalized, ctcAnnual);
  } catch (e) {
    throw new BadRequestException((e as Error).message);
  }

  const monthlyCtc = new Prisma.Decimal(ctcAnnual).div(12);
  const floor = monthlyCtc.times(new Prisma.Decimal(minBasicPercent)).div(100);
  if (amounts.get(BASIC_CODE)!.lt(floor)) {
    throw new BadRequestException(
      `Basic must be at least ${new Prisma.Decimal(minBasicPercent).toString()}% of CTC`,
    );
  }
  return normalized;
}

const STANDARD_CODES: Record<string, true> = {
  BASIC: true,
  DA: true,
  HRA: true,
  SPECIAL_ALLOWANCE: true,
  CONVEYANCE: true,
  LTA: true,
  MEDICAL: true,
  PF_EMPLOYER: true,
  ESI_EMPLOYER: true,
  GRATUITY_PROVISION: true,
};
