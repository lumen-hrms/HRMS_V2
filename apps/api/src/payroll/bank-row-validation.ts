import { ACCOUNT_NUMBER_PATTERN, IFSC_PATTERN } from './bank-codes';

/**
 * Checks one employee's payment row the way a bank's bulk upload will: one bad
 * row makes the bank reject the whole file, so bad rows are left out and
 * reported instead.
 */
export interface RowProblem {
  kind: 'MISSING' | 'INVALID';
  message: string;
}

/**
 * Banks reject accents and most punctuation in beneficiary names. Keep letters,
 * spaces and . ' - (diacritics folded to plain letters); drop anything else.
 */
export function cleanBeneficiaryName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z .'-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 100);
}

export function validateBankRow(input: {
  accountNumber: string | null;
  ifsc: string | null;
  name: string;
  amount: number;
}): RowProblem[] {
  const out: RowProblem[] = [];
  const account = input.accountNumber?.trim() ?? '';
  const ifsc = input.ifsc?.trim().toUpperCase() ?? '';
  if (!account) out.push({ kind: 'MISSING', message: 'No bank account number' });
  else if (!ACCOUNT_NUMBER_PATTERN.test(account)) {
    out.push({ kind: 'INVALID', message: 'Account number must be 9–18 digits' });
  }
  if (!ifsc) out.push({ kind: 'MISSING', message: 'No IFSC code' });
  else if (!IFSC_PATTERN.test(ifsc)) {
    out.push({ kind: 'INVALID', message: 'IFSC must be 11 characters, e.g. HDFC0001234' });
  }
  if (!cleanBeneficiaryName(input.name)) {
    out.push({ kind: 'INVALID', message: 'Name has no letters a bank would accept' });
  }
  if (!(input.amount > 0)) out.push({ kind: 'INVALID', message: 'Net pay is zero or negative' });
  return out;
}
