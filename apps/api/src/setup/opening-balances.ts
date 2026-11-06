import type { ImportRowResult, SheetRow } from '../common/bulk-import';

/**
 * Opening leave balances (company setup step "Opening balances"): the
 * available days each employee had in the previous HRMS on the day before
 * go-live, one row per employee and leave type. Pure — the setup service
 * supplies who exists and which leave types the draft defines.
 *
 * An employee/type with an opening balance gets exactly that for an ANNUAL
 * type (no prorated grant on top); MONTHLY/QUARTERLY types keep accruing
 * from go-live onward. Anyone not in the file gets policy defaults.
 */

export const OPENING_BALANCE_COLUMNS = ['employeeCode', 'leaveTypeCode', 'openingBalance'] as const;

export interface OpeningBalanceContext {
  /** Every employee code the submit will know about (existing, the file, the admin) → gender, if known. */
  employees: Map<string, { gender: string | null }>;
  /** Draft leave types by upper-cased code. */
  types: Map<
    string,
    {
      name: string;
      genderRestriction: string;
      annualQuota: number;
      carryForwardCap: number;
      isCompOff: boolean;
      /** Event-based leave has no balance to open. */
      onEvent?: boolean;
    }
  >;
  /** `employeeCode|TYPECODE` pairs that already hold a balance this leave year (returning tenants). */
  existingBalances: Set<string>;
}

export interface OpeningBalanceRow {
  row: number;
  employeeCode: string;
  leaveTypeCode: string;
  amount: number;
}

export function validateOpeningBalances(
  rows: SheetRow[],
  ctx: OpeningBalanceContext,
): { valid: OpeningBalanceRow[]; results: ImportRowResult[] } {
  const valid: OpeningBalanceRow[] = [];
  const results: ImportRowResult[] = [];
  const firstRowFor = new Map<string, number>();

  for (const r of rows) {
    const code = r.values.get('employeecode')?.trim();
    const typeCode = r.values.get('leavetypecode')?.trim().toUpperCase();
    const raw = r.values.get('openingbalance')?.trim();
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!code) errors.push('employeeCode is required');
    if (!typeCode) errors.push('leaveTypeCode is required');
    let amount = NaN;
    if (!raw) errors.push('openingBalance is required');
    else {
      amount = Number(raw);
      if (!Number.isFinite(amount)) errors.push(`openingBalance "${raw}" is not a number`);
      else if (amount < 0)
        errors.push('openingBalance can’t be negative — enter 0 for an employee who’s overdrawn');
      else if (Math.round(amount * 100) !== amount * 100)
        errors.push('openingBalance can have at most 2 decimals');
      else if (amount > 365) errors.push('openingBalance can’t be more than 365 days');
    }

    const employee = code ? ctx.employees.get(code) : undefined;
    if (code && !employee) {
      errors.push(
        `employeeCode ${code} isn't an existing employee, a row in your employee file, or your own profile`,
      );
    }
    const type = typeCode ? ctx.types.get(typeCode) : undefined;
    if (typeCode && !type) errors.push(`leaveTypeCode ${typeCode} isn't one of your leave types`);
    else if (type?.onEvent) {
      errors.push(
        `${type.name} is event-based (granted per event, no balance) — leave it out of this file`,
      );
    }

    if (code && typeCode) {
      const k = `${code}|${typeCode}`;
      if (firstRowFor.has(k)) {
        errors.push(
          `${code} already has a ${typeCode} opening balance on row ${firstRowFor.get(k)}`,
        );
      } else {
        firstRowFor.set(k, r.row);
      }
      if (ctx.existingBalances.has(k)) {
        errors.push(
          `${code} already has a ${typeCode} balance this leave year — adjust it in Leave › Balance Adjustments`,
        );
      }
    }

    if (type && employee && errors.length === 0) {
      const gender = employee.gender?.trim().toUpperCase();
      if (
        type.genderRestriction !== 'ANY' &&
        (gender === 'MALE' || gender === 'FEMALE') &&
        gender !== type.genderRestriction
      ) {
        warnings.push(`${type.name} is for ${type.genderRestriction.toLowerCase()} employees only`);
      }
      if (!type.isCompOff && amount > type.annualQuota + type.carryForwardCap) {
        warnings.push(
          `${amount} days is more than a year’s ${type.name} quota plus carry-forward (${type.annualQuota + type.carryForwardCap})`,
        );
      }
    }

    const ok = errors.length === 0;
    if (ok) valid.push({ row: r.row, employeeCode: code!, leaveTypeCode: typeCode!, amount });
    results.push({
      row: r.row,
      employeeCode: code ?? null,
      action: ok ? 'create' : null,
      success: ok,
      ...(errors.length > 0 ? { error: errors.join('; ') } : {}),
      ...(warnings.length > 0 ? { warnings } : {}),
      ...(ok ? { detail: `${typeCode}: ${amount} day${amount === 1 ? '' : 's'}` } : {}),
    });
  }
  return { valid, results };
}
