import { Prisma } from '@prisma/client';

export interface PtSlabRow {
  grossFrom: Prisma.Decimal | number | string;
  grossTo: Prisma.Decimal | number | string | null;
  monthlyAmount: Prisma.Decimal | number | string;
  februaryAmount?: Prisma.Decimal | number | string | null;
}

/**
 * The slab whose [grossFrom, grossTo) band contains `gross` (grossTo null =
 * open-ended), charged against the month's actual (prorated) gross — the
 * same figure the employee was actually paid, per decision 4's "working
 * days only" proration. Zero if no slab matches (e.g. gross below the
 * lowest band, or no slabs seeded for the employee's `workState`).
 * `month` is 1-indexed; some states charge a different amount in February
 * (the slab's `februaryAmount`, falling back to `monthlyAmount` if unset).
 */
export function resolveProfessionalTax(
  gross: Prisma.Decimal,
  month: number,
  slabs: PtSlabRow[],
): Prisma.Decimal {
  const slab = slabs.find((s) => {
    const from = new Prisma.Decimal(s.grossFrom);
    const to = s.grossTo == null ? null : new Prisma.Decimal(s.grossTo);
    return gross.gte(from) && (to === null || gross.lt(to));
  });
  if (!slab) return new Prisma.Decimal(0);

  const amount =
    month === 2 && slab.februaryAmount != null ? slab.februaryAmount : slab.monthlyAmount;
  return new Prisma.Decimal(amount);
}
