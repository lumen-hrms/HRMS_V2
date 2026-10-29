import {
  accrualPeriods,
  carryForwardDays,
  creditsDue,
  effectiveStart,
  leaveYearWindow,
  periodContaining,
  type CreditInput,
} from './leave-entitlement';

const d = (iso: string) => new Date(`${iso}T00:00:00Z`);
const aprilYear = leaveYearWindow(2026, 4); // Apr 2026 – Mar 2027

function input(overrides: Partial<CreditInput> = {}): CreditInput {
  return {
    accrualFrequency: 'ANNUAL',
    annualQuota: 12,
    window: aprilYear,
    effectiveStart: aprilYear.start,
    today: d('2026-10-15'),
    creditedPeriodStarts: new Set(),
    accruedSoFar: 0,
    hasOpeningBalance: false,
    ...overrides,
  };
}

describe('leave-entitlement', () => {
  describe('leaveYearWindow / accrualPeriods', () => {
    it('spans April to the next March for an April leave year', () => {
      expect(aprilYear.start).toEqual(d('2026-04-01'));
      expect(aprilYear.end).toEqual(d('2027-04-01'));
    });

    it('aligns quarters to the leave year (Apr/Jul/Oct/Jan), not the calendar', () => {
      expect(accrualPeriods('QUARTERLY', aprilYear).map((p) => p.start)).toEqual([
        d('2026-04-01'),
        d('2026-07-01'),
        d('2026-10-01'),
        d('2027-01-01'),
      ]);
      expect(accrualPeriods('MONTHLY', aprilYear)).toHaveLength(12);
    });

    it('finds the period a date falls in, and nothing outside the year', () => {
      expect(periodContaining('MONTHLY', aprilYear, d('2026-10-15'))?.start).toEqual(
        d('2026-10-01'),
      );
      expect(periodContaining('ANNUAL', aprilYear, d('2026-10-15'))?.start).toEqual(
        d('2026-04-01'),
      );
      expect(periodContaining('MONTHLY', aprilYear, d('2027-04-01'))).toBeNull();
    });
  });

  describe('effectiveStart', () => {
    it('is the latest of leave-year start, joining date and go-live', () => {
      expect(effectiveStart(aprilYear, null, null)).toEqual(d('2026-04-01'));
      expect(effectiveStart(aprilYear, d('2020-01-01'), d('2026-10-01'))).toEqual(d('2026-10-01'));
      expect(effectiveStart(aprilYear, d('2026-11-10'), d('2026-10-01'))).toEqual(d('2026-11-10'));
      // A go-live in an earlier year doesn't clip anything this year.
      expect(effectiveStart(aprilYear, null, d('2025-06-01'))).toEqual(d('2026-04-01'));
    });
  });

  describe('ANNUAL types', () => {
    it('grants the full quota to someone there all year', () => {
      expect(creditsDue(input())).toEqual([
        { periodStart: d('2026-04-01'), occurredAt: d('2026-04-01'), amount: 12 },
      ]);
    });

    it('prorates from a mid-year go-live, rounded to whole days', () => {
      // 1 Oct 2026 → 182 of 365 days left ≈ 5.98 → 6
      const [credit] = creditsDue(input({ effectiveStart: d('2026-10-01') }));
      expect(credit.amount).toBe(6);
      expect(credit.occurredAt).toEqual(d('2026-10-01'));
    });

    it('gives a 3-day type 1 day from a 29 October go-live (154/365 × 3 = 1.27)', () => {
      const [credit] = creditsDue(
        input({ annualQuota: 3, effectiveStart: d('2026-10-29'), today: d('2026-10-29') }),
      );
      expect(credit.amount).toBe(1);
    });

    it('gives nothing when an opening balance was imported for the type', () => {
      expect(creditsDue(input({ hasOpeningBalance: true }))).toEqual([]);
    });

    it('is idempotent: no second grant once one is in the ledger', () => {
      expect(
        creditsDue(
          input({ creditedPeriodStarts: new Set([aprilYear.start.getTime()]), accruedSoFar: 12 }),
        ),
      ).toEqual([]);
    });

    it('credits nothing yet for a future joiner, then prorates once they join', () => {
      const joining = d('2026-12-01');
      expect(creditsDue(input({ effectiveStart: joining, today: d('2026-11-20') }))).toEqual([]);
      const [credit] = creditsDue(input({ effectiveStart: joining, today: d('2026-12-01') }));
      expect(credit.amount).toBe(4); // 121/365 × 12 ≈ 3.98 → 4
    });

    it('credits nothing for a joining date after the year ends', () => {
      expect(
        creditsDue(input({ effectiveStart: d('2027-05-01'), today: d('2027-05-01') })),
      ).toEqual([]);
    });
  });

  describe('MONTHLY / QUARTERLY types', () => {
    const monthly = (o: Partial<CreditInput> = {}) =>
      creditsDue(input({ accrualFrequency: 'MONTHLY', annualQuota: 12, ...o }));

    it('back-credits every started month since the leave-year start', () => {
      // today 15 Oct → Apr..Oct = 7 months
      const credits = monthly();
      expect(credits).toHaveLength(7);
      expect(credits.every((c) => c.amount === 1)).toBe(true);
    });

    it('rounds a part-month to whole days: 2/month → 2 from the start, 1 mid-month, 0 at the end', () => {
      const twoAMonth = (start: string, today = '2026-10-31') =>
        creditsDue(
          input({
            accrualFrequency: 'MONTHLY',
            annualQuota: 24,
            effectiveStart: d(start),
            today: d(today),
          }),
        ).map((c) => c.amount);
      expect(twoAMonth('2026-10-01')).toEqual([2]);
      expect(twoAMonth('2026-10-16')).toEqual([1]); // 16 of 31 days → 1.03
      expect(twoAMonth('2026-10-29')).toEqual([]); // 3 of 31 days → 0.19 → nothing
      // …and the next month is still owed in full.
      expect(twoAMonth('2026-10-29', '2026-11-01')).toEqual([2]);
    });

    it('never rounds a full month, so an uneven monthly quota still adds up', () => {
      const credits = monthly({ annualQuota: 15, today: d('2027-03-15') });
      expect(credits.every((c) => c.amount === 1.25)).toBe(true);
      expect(credits.reduce((sum, c) => sum + c.amount, 0)).toBe(15);
    });

    it('a go-live on the 1st credits that whole month', () => {
      expect(monthly({ effectiveStart: d('2026-10-01') })).toEqual([
        { periodStart: d('2026-10-01'), occurredAt: d('2026-10-01'), amount: 1 },
      ]);
    });

    it('skips periods already in the ledger (idempotent re-run)', () => {
      const credited = new Set(
        accrualPeriods('MONTHLY', aprilYear)
          .slice(0, 6)
          .map((p) => p.start.getTime()),
      );
      const credits = monthly({ creditedPeriodStarts: credited, accruedSoFar: 6 });
      expect(credits.map((c) => c.periodStart)).toEqual([d('2026-10-01')]);
    });

    it('still accrues from go-live for an employee with an opening balance', () => {
      expect(monthly({ effectiveStart: d('2026-10-01'), hasOpeningBalance: true })).toHaveLength(1);
    });

    it('never lets accruals in a year exceed the annual quota', () => {
      const credits = monthly({ accruedSoFar: 11.5, today: d('2027-03-15') });
      expect(credits.reduce((s, c) => s + c.amount, 0)).toBe(0.5);
    });

    it('credits a quarter at its start', () => {
      const credits = creditsDue(input({ accrualFrequency: 'QUARTERLY', annualQuota: 8 }));
      expect(credits.map((c) => [c.periodStart, c.amount])).toEqual([
        [d('2026-04-01'), 2],
        [d('2026-07-01'), 2],
        [d('2026-10-01'), 2],
      ]);
    });

    it('credits nothing for a zero-quota type', () => {
      expect(monthly({ annualQuota: 0 })).toEqual([]);
    });
  });

  describe('carryForwardDays', () => {
    it('carries unused balance up to the cap, never a negative balance', () => {
      expect(carryForwardDays(20, 15)).toBe(15);
      expect(carryForwardDays(4.5, 15)).toBe(4.5);
      expect(carryForwardDays(-2, 15)).toBe(0);
      expect(carryForwardDays(10, 0)).toBe(0);
    });
  });
});
