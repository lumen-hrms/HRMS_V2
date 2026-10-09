import { BadRequestException } from '@nestjs/common';
import { resolveMonthlyAmounts } from './salary-components.util';
import { normalizeAndValidateComponents } from './salary-structure.validation';
import type { SalaryComponentDto } from './dto/payroll.dto';

const basic = (over: Partial<SalaryComponentDto> = {}): SalaryComponentDto => ({
  type: 'BASIC',
  name: 'Basic',
  calculationMode: 'PERCENT_OF_CTC',
  value: 50,
  ...over,
});
const hra: SalaryComponentDto = {
  type: 'HRA',
  name: 'HRA',
  calculationMode: 'PERCENT_OF_BASIC',
  value: 40,
};
const CTC = 1200000; // 100,000 / month

describe('resolveMonthlyAmounts', () => {
  it('resolves fixed, percent-of-CTC, percent-of-basic and formula components', () => {
    const amounts = resolveMonthlyAmounts(
      [
        { code: 'BASIC', calculationMode: 'PERCENT_OF_CTC', value: 50 },
        { code: 'HRA', calculationMode: 'PERCENT_OF_BASIC', value: 40 },
        { code: 'CONVEYANCE', calculationMode: 'FIXED', value: 1600 },
        {
          code: 'SPECIAL_ALLOWANCE',
          calculationMode: 'FORMULA',
          formula: 'CTC - BASIC - HRA - CONVEYANCE',
        },
      ],
      CTC,
    );
    expect(amounts.get('BASIC')!.toString()).toBe('50000');
    expect(amounts.get('HRA')!.toString()).toBe('20000');
    expect(amounts.get('SPECIAL_ALLOWANCE')!.toString()).toBe('28400');
  });

  it('resolves regardless of component order', () => {
    const amounts = resolveMonthlyAmounts(
      [
        { code: 'HRA', calculationMode: 'PERCENT_OF_BASIC', value: 40 },
        { code: 'BASIC', calculationMode: 'PERCENT_OF_CTC', value: 50 },
      ],
      CTC,
    );
    expect(amounts.get('HRA')!.toString()).toBe('20000');
  });

  it('detects circular references', () => {
    expect(() =>
      resolveMonthlyAmounts(
        [
          { code: 'A', calculationMode: 'FORMULA', formula: 'B + 1' },
          { code: 'B', calculationMode: 'FORMULA', formula: 'A + 1' },
        ],
        CTC,
      ),
    ).toThrow('Circular reference');
  });

  it('rejects a formula referencing an unknown component', () => {
    expect(() =>
      resolveMonthlyAmounts([{ code: 'A', calculationMode: 'FORMULA', formula: 'NOPE * 2' }], CTC),
    ).toThrow('Unknown component reference NOPE');
  });
});

describe('normalizeAndValidateComponents', () => {
  const ok = (components: SalaryComponentDto[], min = 50) =>
    normalizeAndValidateComponents(components, CTC, min);

  it('accepts a valid structure and defaults standard codes to the type', () => {
    const out = ok([basic(), hra]);
    expect(out.map((c) => c.code)).toEqual(['BASIC', 'HRA']);
    expect(out.map((c) => c.sortOrder)).toEqual([0, 1]);
  });

  it('INV-3: rejects Basic below the tenant floor, accepts exactly at it', () => {
    expect(() => ok([basic({ value: 49.99 })])).toThrow('at least 50% of CTC');
    expect(() => ok([basic({ value: 50 })])).not.toThrow();
    expect(() => ok([basic({ value: 40 })], 40)).not.toThrow();
  });

  it('INV-3 applies to a FIXED or FORMULA Basic as well', () => {
    expect(() => ok([basic({ calculationMode: 'FIXED', value: 40000 })])).toThrow('at least 50%');
    expect(() =>
      ok([basic({ calculationMode: 'FORMULA', value: undefined, formula: 'CTC * 0.3' })]),
    ).toThrow('at least 50%');
  });

  it('requires exactly one BASIC and forbids Basic as a percentage of itself', () => {
    expect(() => ok([hra])).toThrow('exactly one BASIC');
    expect(() => ok([basic(), basic()])).toThrow('Duplicate component BASIC');
    expect(() => ok([basic({ calculationMode: 'PERCENT_OF_BASIC', value: 100 })])).toThrow(
      'cannot be a percentage of itself',
    );
  });

  it('validates codes: custom needs one, reserved and duplicate rejected', () => {
    const custom = (code?: string): SalaryComponentDto => ({
      type: 'CUSTOM',
      code,
      name: 'Bonus',
      calculationMode: 'FIXED',
      value: 1000,
    });
    expect(() => ok([basic(), custom()])).toThrow('need a code');
    expect(() => ok([basic(), custom('HRA')])).toThrow('reserved');
    expect(() => ok([basic(), custom('CTC')])).toThrow('reserved');
    expect(() => ok([basic(), custom('SHIFT_BONUS'), custom('SHIFT_BONUS')])).toThrow('Duplicate');
    expect(() => ok([basic({ code: 'SOMETHING' })])).toThrow('code must be BASIC');
  });

  it('enforces mode/field consistency', () => {
    expect(() => ok([basic(), { ...hra, formula: 'BASIC * 0.4' }])).toThrow('only FORMULA');
    expect(() => ok([basic(), { ...hra, calculationMode: 'FORMULA', value: undefined }])).toThrow(
      'needs a formula',
    );
    expect(() => ok([basic(), { ...hra, value: undefined }])).toThrow('value is required');
    expect(() => ok([basic(), { ...hra, value: 150 }])).toThrow('cannot exceed 100');
  });

  it('turns formula and reference errors into BadRequest', () => {
    const bad = (formula: string): SalaryComponentDto => ({
      type: 'CUSTOM',
      code: 'X',
      name: 'X',
      calculationMode: 'FORMULA',
      formula,
    });
    expect(() => ok([basic(), bad('BASIC +')])).toThrow(BadRequestException);
    expect(() => ok([basic(), bad('GHOST * 2')])).toThrow('Unknown component reference GHOST');
    expect(() => ok([basic(), bad('X + 1')])).toThrow('Circular');
  });
});
