import { validateOpeningBalances, type OpeningBalanceContext } from './opening-balances';

const rows = (list: Record<string, string>[]) =>
  list.map((values, i) => ({ row: i + 2, values: new Map(Object.entries(values)) }));

const ctx = (overrides: Partial<OpeningBalanceContext> = {}): OpeningBalanceContext => ({
  employees: new Map([
    ['E1', { gender: 'Male' }],
    ['E2', { gender: null }],
  ]),
  types: new Map([
    [
      'EL',
      {
        name: 'Earned Leave',
        genderRestriction: 'ANY',
        annualQuota: 15,
        carryForwardCap: 30,
        isCompOff: false,
      },
    ],
    [
      'ML',
      {
        name: 'Maternity Leave',
        genderRestriction: 'FEMALE',
        annualQuota: 182,
        carryForwardCap: 0,
        isCompOff: false,
      },
    ],
  ]),
  existingBalances: new Set(),
  ...overrides,
});

const row = (employeeCode: string, leaveTypeCode: string, openingBalance: string) => ({
  employeecode: employeeCode,
  leavetypecode: leaveTypeCode,
  openingbalance: openingBalance,
});

describe('validateOpeningBalances', () => {
  it('accepts valid rows, matching leave type codes case-insensitively', () => {
    const { valid, results } = validateOpeningBalances(
      rows([row('E1', 'el', '7.5'), row('E2', 'EL', '0')]),
      ctx(),
    );
    expect(valid).toEqual([
      { row: 2, employeeCode: 'E1', leaveTypeCode: 'EL', amount: 7.5 },
      { row: 3, employeeCode: 'E2', leaveTypeCode: 'EL', amount: 0 },
    ]);
    expect(results.every((r) => r.success)).toBe(true);
  });

  it('rejects unknown employees and types, negatives, non-numbers and >2 decimals', () => {
    const { valid, results } = validateOpeningBalances(
      rows([
        row('NOPE', 'EL', '1'),
        row('E1', 'XX', '1'),
        row('E1', 'EL', '-3'),
        row('E2', 'EL', 'ten'),
        row('E2', 'ML', '1.255'),
      ]),
      ctx(),
    );
    expect(valid).toEqual([]);
    expect(results.map((r) => r.error)).toEqual([
      expect.stringMatching(/isn't an existing employee/),
      expect.stringMatching(/isn't one of your leave types/),
      expect.stringMatching(/can’t be negative/),
      expect.stringMatching(/not a number/),
      expect.stringMatching(/at most 2 decimals/),
    ]);
  });

  it('rejects a duplicate employee/type pair and a pair that already has a balance', () => {
    const { results } = validateOpeningBalances(
      rows([row('E1', 'EL', '1'), row('E1', 'EL', '2'), row('E2', 'EL', '3')]),
      ctx({ existingBalances: new Set(['E2|EL']) }),
    );
    expect(results.map((r) => r.success)).toEqual([true, false, false]);
    expect(results[1].error).toMatch(/row 2/);
    expect(results[2].error).toMatch(/already has a EL balance/);
  });

  it('warns (never blocks) on a gender mismatch or an unusually high balance', () => {
    const { valid, results } = validateOpeningBalances(
      rows([row('E1', 'ML', '10'), row('E2', 'EL', '60')]),
      ctx(),
    );
    expect(valid).toHaveLength(2);
    expect(results[0].warnings).toEqual([expect.stringMatching(/female employees only/)]);
    expect(results[1].warnings).toEqual([expect.stringMatching(/more than a year/)]);
  });

  it('refuses an opening balance for an event-based type (no balance to open)', () => {
    const types = ctx().types;
    types.set('MRL', {
      name: 'Marriage Leave',
      genderRestriction: 'ANY',
      annualQuota: 0,
      carryForwardCap: 0,
      isCompOff: false,
      onEvent: true,
    });
    const { valid, results } = validateOpeningBalances(
      rows([row('E1', 'MRL', '7')]),
      ctx({ types }),
    );
    expect(valid).toEqual([]);
    expect(results[0].error).toMatch(/event-based/);
  });
});
