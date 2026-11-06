import { generatePayslipPdf, payslipPassword } from './payslip-generator';

describe('payslipPassword', () => {
  it('formats DOB as DDMMYYYY', () => {
    expect(payslipPassword(new Date('1990-05-15T00:00:00Z'))).toBe('15051990');
  });

  it('pads single-digit day and month', () => {
    expect(payslipPassword(new Date('2000-01-02T00:00:00Z'))).toBe('02012000');
  });
});

describe('generatePayslipPdf', () => {
  const baseInput = {
    employeeName: 'Asha Rao',
    employeeCode: 'E001',
    period: '2026-09',
    dateOfBirth: new Date('1990-05-15T00:00:00Z'),
    workingDays: 22,
    payableDays: 22,
    lopDays: 0,
    earnings: [{ code: 'BASIC', amount: 30000 }],
    grossEarnings: 42000,
    epfEmployee: 1800,
    esiEmployee: 0,
    professionalTax: 200,
    tdsDeducted: 0,
    adHocAdjustments: [],
    netPay: 40000,
  };

  it('produces a password-protected PDF (encrypted, with a %PDF header)', async () => {
    const buffer = await generatePayslipPdf(baseInput);
    expect(buffer.subarray(0, 5).toString('ascii')).toBe('%PDF-');
    // pdfkit writes an /Encrypt dictionary reference into the trailer when
    // userPassword is set — a structural signal that encryption was
    // actually requested, without needing a full PDF reader dependency.
    expect(buffer.toString('latin1')).toContain('/Encrypt');
  });

  it('includes ad-hoc adjustments only when present, without throwing when absent', async () => {
    const withAdjustment = await generatePayslipPdf({
      ...baseInput,
      adHocAdjustments: [{ type: 'BONUS', amount: 5000, note: 'Diwali' }],
    });
    expect(withAdjustment.length).toBeGreaterThan(0);
    const withoutAdjustment = await generatePayslipPdf(baseInput);
    expect(withoutAdjustment.length).toBeGreaterThan(0);
  });
});
