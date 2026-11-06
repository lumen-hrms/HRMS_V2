import { Prisma } from '@prisma/client';
import { evaluateFormula, formulaReferences, FormulaError } from './formula.evaluator';

const D = (v: number | string) => new Prisma.Decimal(v);

describe('formula evaluator', () => {
  it('respects operator precedence and parentheses', () => {
    expect(evaluateFormula('2 + 3 * 4', {}).toString()).toBe('14');
    expect(evaluateFormula('(2 + 3) * 4', {}).toString()).toBe('20');
  });

  it('supports unary minus and decimals without float error', () => {
    expect(evaluateFormula('-BASIC + 0.1 + 0.2', { BASIC: D(1) }).toString()).toBe('-0.7');
    expect(evaluateFormula('0.1 + 0.2', {}).toString()).toBe('0.3');
  });

  it('resolves references and lists them', () => {
    expect(evaluateFormula('CTC - BASIC', { CTC: D(100), BASIC: D(40) }).toString()).toBe('60');
    expect(formulaReferences('BASIC * 0.4 + HRA + BASIC').sort()).toEqual(['BASIC', 'HRA']);
  });

  it('rejects division by zero and unknown references', () => {
    expect(() => evaluateFormula('1 / 0', {})).toThrow('Division by zero');
    expect(() => evaluateFormula('MISSING + 1', {})).toThrow('Unknown reference MISSING');
  });

  it.each([
    ['process.exit(1)'],
    ['BASIC.constructor'],
    ['1 +'],
    ['(1 + 2'],
    ['1 2'],
    ['a + 1'],
    ['1 ; 2'],
    ['`x`'],
    ['5.'],
    [''],
  ])('rejects invalid or unsafe input %j', (formula) => {
    expect(() => evaluateFormula(formula, { BASIC: D(1) })).toThrow(FormulaError);
  });

  it('rejects over-long and over-nested formulas', () => {
    expect(() => parse('1+'.repeat(150) + '1')).toThrow('longer than');
    expect(() => parse('('.repeat(30) + '1' + ')'.repeat(30))).toThrow('nested too deeply');
  });
});

function parse(f: string) {
  return evaluateFormula(f, {});
}
