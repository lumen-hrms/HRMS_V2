import { resolveLeaveYear } from './leave-year.util';

describe('resolveLeaveYear', () => {
  it('equals the calendar year when fyStartMonth is January', () => {
    expect(resolveLeaveYear(new Date('2026-01-15T00:00:00Z'), 1)).toBe(2026);
    expect(resolveLeaveYear(new Date('2026-12-31T00:00:00Z'), 1)).toBe(2026);
  });

  it('rolls a date before the FY start month back to the prior leave year', () => {
    // fyStartMonth = 4 (April): Jan-Mar belong to the previous FY.
    expect(resolveLeaveYear(new Date('2027-02-01T00:00:00Z'), 4)).toBe(2026);
  });

  it('keeps a date on/after the FY start month in the current leave year', () => {
    expect(resolveLeaveYear(new Date('2026-04-01T00:00:00Z'), 4)).toBe(2026);
    expect(resolveLeaveYear(new Date('2026-09-09T00:00:00Z'), 4)).toBe(2026);
  });
});
