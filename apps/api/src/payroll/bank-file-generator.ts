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
}

export interface BankFileGenerator {
  readonly format: string;
  readonly filename: (period: string) => string;
  readonly mimeType: string;
  generate(rows: BankFileRow[]): string;
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
    ].join(',');
    const lines = rows.map((r) =>
      [
        csvEscape(r.employeeCode),
        csvEscape(r.employeeName),
        csvEscape(r.accountNumber),
        csvEscape(r.ifsc),
        csvEscape(r.bankName ?? ''),
        r.amount.toFixed(2),
      ].join(','),
    );
    return [header, ...lines].join('\n') + '\n';
  }
}

export const BANK_FILE_GENERATORS: Record<string, BankFileGenerator> = {
  CSV: new GenericCsvBankFileGenerator(),
};
