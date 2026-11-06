/**
 * Disbursement file generation (FR-PAY-015, §12 decision 12). Real
 * HDFC/ICICI/SBI/Axis bulk-upload layouts aren't sourced yet, so only a
 * generic CSV implementation exists — behind this interface so a real
 * format slots in later without touching the caller.
 */
export interface BankFileRow {
  employeeId: string;
  employeeName: string;
  employeeCode: string;
  accountNumber: string;
  ifsc: string;
  bankName: string | null;
  amount: number;
  /** Own-bank vs NEFT/IMPS/RTGS, worked out from the IFSC and the company's bank. */
  paymentMode?: string;
}

/** The paying side of the file: the run's month and the company's debit account (null when not set up). */
export interface BankFileContext {
  period: string;
  company: {
    accountHolderName: string;
    accountNumber: string;
    ifsc: string;
    bankName: string | null;
  } | null;
}

export interface BankFileGenerator {
  readonly format: string;
  readonly filename: (period: string) => string;
  readonly mimeType: string;
  generate(rows: BankFileRow[], context?: BankFileContext): string;
}

function csvEscape(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** Dummy generic-CSV generator — the only implementation until a real bank sample is supplied. */
export class GenericCsvBankFileGenerator implements BankFileGenerator {
  readonly format = 'CSV';
  readonly mimeType = 'text/csv';

  filename(period: string): string {
    return `bank-file-${period}.csv`;
  }

  generate(rows: BankFileRow[]): string {
    const header = [
      'EmployeeCode',
      'EmployeeName',
      'AccountNumber',
      'IFSC',
      'BankName',
      'Amount',
      'PaymentMode',
    ].join(',');
    const lines = rows.map((r) =>
      [
        csvEscape(r.employeeCode),
        csvEscape(r.employeeName),
        csvEscape(r.accountNumber),
        csvEscape(r.ifsc),
        csvEscape(r.bankName ?? ''),
        r.amount.toFixed(2),
        r.paymentMode ?? '',
      ].join(','),
    );
    return [header, ...lines].join('\n') + '\n';
  }
}

/**
 * Every format the picker offers. `generator: null` means that bank's layout
 * isn't built yet (it needs a real template + an accepted sample from the
 * bank) — the format is listed but can't be downloaded. A changed bank layout
 * becomes a new entry with a bumped `version`, so older files keep working.
 */
export interface BankFormat {
  id: string;
  label: string;
  /** The company bank this layout is for (null = works for any bank). */
  bankCode: string | null;
  version: string;
  generator: BankFileGenerator | null;
}

export const BANK_FORMATS: BankFormat[] = [
  {
    id: 'CSV',
    label: 'Generic CSV',
    bankCode: null,
    version: '2',
    generator: new GenericCsvBankFileGenerator(),
  },
  { id: 'ICICI', label: 'ICICI Bank', bankCode: 'ICICI', version: '—', generator: null },
  { id: 'AXIS', label: 'Axis Bank', bankCode: 'AXIS', version: '—', generator: null },
  { id: 'SBI', label: 'State Bank of India', bankCode: 'SBI', version: '—', generator: null },
  { id: 'HDFC', label: 'HDFC Bank', bankCode: 'HDFC', version: '—', generator: null },
  { id: 'HSBC', label: 'HSBC', bankCode: 'HSBC', version: '—', generator: null },
];

export const findBankFormat = (id: string) => BANK_FORMATS.find((f) => f.id === id);
