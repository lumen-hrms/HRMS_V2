import { BANK_FILE_GENERATORS, GenericCsvBankFileGenerator } from './bank-file-generator';

describe('GenericCsvBankFileGenerator', () => {
  const generator = new GenericCsvBankFileGenerator();

  it('round-trips a known-good fixture exactly', () => {
    const csv = generator.generate([
      {
        employeeId: 'e1',
        employeeName: 'Asha Rao',
        employeeCode: 'E001',
        accountNumber: '123456781234',
        ifsc: 'HDFC0001234',
        bankName: 'HDFC Bank',
        amount: 40000,
      },
    ]);
    expect(csv).toBe(
      'EmployeeCode,EmployeeName,AccountNumber,IFSC,BankName,Amount\n' +
        'E001,Asha Rao,123456781234,HDFC0001234,HDFC Bank,40000.00\n',
    );
  });

  it('header-only CSV for zero rows', () => {
    expect(generator.generate([])).toBe(
      'EmployeeCode,EmployeeName,AccountNumber,IFSC,BankName,Amount\n',
    );
  });

  it('quotes a field containing a comma and escapes embedded quotes', () => {
    const csv = generator.generate([
      {
        employeeId: 'e1',
        employeeName: 'Rao, Asha "A."',
        employeeCode: 'E001',
        accountNumber: '1',
        ifsc: 'HDFC0001234',
        bankName: null,
        amount: 1000,
      },
    ]);
    expect(csv).toContain('"Rao, Asha ""A."""');
  });

  it('is registered under CSV in the format registry', () => {
    expect(BANK_FILE_GENERATORS.CSV).toBeInstanceOf(GenericCsvBankFileGenerator);
    expect(BANK_FILE_GENERATORS.CSV.format).toBe('CSV');
  });
});
