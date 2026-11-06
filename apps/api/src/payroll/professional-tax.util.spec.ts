import { Prisma } from '@prisma/client';
import { resolveProfessionalTax, type PtSlabRow } from './professional-tax.util';

const n = (v: Prisma.Decimal) => v.toNumber();

// Hypothetical slabs for two different "states" — shapes only, not real
// rates (decision 11 defers rate verification to Phase 9).
const stateA: PtSlabRow[] = [
  { grossFrom: 0, grossTo: 15000, monthlyAmount: 0 },
  { grossFrom: 15000, grossTo: 25000, monthlyAmount: 200 },
  { grossFrom: 25000, grossTo: null, monthlyAmount: 300 },
];

const stateB: PtSlabRow[] = [
  { grossFrom: 0, grossTo: 10000, monthlyAmount: 0 },
  { grossFrom: 10000, grossTo: null, monthlyAmount: 150, februaryAmount: 300 },
];

describe('resolveProfessionalTax', () => {
  it('finds the matching band for state A', () => {
    expect(n(resolveProfessionalTax(new Prisma.Decimal(5000), 5, stateA))).toBe(0);
    expect(n(resolveProfessionalTax(new Prisma.Decimal(20000), 5, stateA))).toBe(200);
    expect(n(resolveProfessionalTax(new Prisma.Decimal(100000), 5, stateA))).toBe(300);
  });

  it('is left-inclusive, right-exclusive at a slab boundary', () => {
    expect(n(resolveProfessionalTax(new Prisma.Decimal(15000), 5, stateA))).toBe(200);
    expect(n(resolveProfessionalTax(new Prisma.Decimal(14999.99), 5, stateA))).toBe(0);
    expect(n(resolveProfessionalTax(new Prisma.Decimal(25000), 5, stateA))).toBe(300);
  });

  it('the last slab is open-ended', () => {
    expect(n(resolveProfessionalTax(new Prisma.Decimal(10_000_000), 5, stateA))).toBe(300);
  });

  it('charges the February amount in February when one is set', () => {
    expect(n(resolveProfessionalTax(new Prisma.Decimal(20000), 1, stateB))).toBe(150);
    expect(n(resolveProfessionalTax(new Prisma.Decimal(20000), 2, stateB))).toBe(300);
  });

  it('falls back to the monthly amount in February when none is set', () => {
    expect(n(resolveProfessionalTax(new Prisma.Decimal(20000), 2, stateA))).toBe(200);
  });

  it('returns 0 when no slab matches (e.g. no slabs seeded for this state)', () => {
    expect(n(resolveProfessionalTax(new Prisma.Decimal(20000), 5, []))).toBe(0);
  });
});
