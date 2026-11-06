import { BANK_FORMATS, GenericCsvBankFileGenerator, findBankFormat } from './bank-file-generator';

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
      'EmployeeCode,EmployeeName,AccountNumber,IFSC,BankName,Amount,PaymentMode\n' +
        'E001,Asha Rao,123456781234,HDFC0001234,HDFC Bank,40000.00,\n',
    );
  });

  it('header-only CSV for zero rows', () => {
    expect(generator.generate([])).toBe(
      'EmployeeCode,EmployeeName,AccountNumber,IFSC,BankName,Amount,PaymentMode\n',
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

  it('prints the payment mode column when a row has one', () => {
    const csv = generator.generate([
      {
        employeeId: 'e',
        employeeName: 'A',
        employeeCode: 'E1',
        accountNumber: '123456789',
        ifsc: 'HDFC0001234',
        bankName: null,
        amount: 1,
        paymentMode: 'OWN_BANK',
      },
    ]);
    expect(csv.trim().split('\n')[1]).toBe('E1,A,123456789,HDFC0001234,,1.00,OWN_BANK');
  });

  it('registers the generic CSV and lists the launch banks as not-yet-available layouts', () => {
    expect(findBankFormat('CSV')?.generator).toBeInstanceOf(GenericCsvBankFileGenerator);
    expect(findBankFormat('CSV')?.generator?.format).toBe('CSV');
    for (const id of ['ICICI', 'AXIS', 'SBI', 'HDFC', 'HSBC']) {
      expect(BANK_FORMATS.find((f) => f.id === id)?.generator).toBeNull();
    }
  });
});
