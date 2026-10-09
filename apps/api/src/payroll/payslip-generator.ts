import PDFDocument from 'pdfkit';

/**
 * Password for the payslip PDF (FR-PAY-014, decision 2): the employee's
 * DOB in `DDMMYYYY`. A pure function so the format is independently
 * testable without rendering a PDF.
 */
export function payslipPassword(dateOfBirth: Date): string {
  const dd = String(dateOfBirth.getUTCDate()).padStart(2, '0');
  const mm = String(dateOfBirth.getUTCMonth() + 1).padStart(2, '0');
  const yyyy = dateOfBirth.getUTCFullYear();
  return `${dd}${mm}${yyyy}`;
}

export interface PayslipEarningLine {
  code: string;
  amount: number;
}

export interface PayslipAdjustmentLine {
  type: string;
  amount: number;
  note?: string | null;
}

export interface PayslipInput {
  employeeName: string;
  employeeCode: string;
  period: string; // YYYY-MM
  dateOfBirth: Date;
  workingDays: number;
  payableDays: number;
  lopDays: number;
  earnings: PayslipEarningLine[];
  grossEarnings: number;
  epfEmployee: number;
  esiEmployee: number;
  professionalTax: number;
  tdsDeducted: number;
  adHocAdjustments: PayslipAdjustmentLine[];
  netPay: number;
}

function money(n: number): string {
  return n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * Renders a password-protected (DOB-locked) payslip PDF into a Buffer.
 * `pdfkit`'s own AES encryption (no `eval`/shell-out) — no company name or
 * logo today (module 07 §12: the `tenants` table isn't readable from a
 * tenant-scoped connection, and nothing in the spec requires it yet).
 */
export function generatePayslipPdf(input: PayslipInput): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      margin: 50,
      userPassword: payslipPassword(input.dateOfBirth),
      permissions: { printing: 'lowResolution', modifying: false, copying: false },
    });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.fontSize(16).text('Payslip', { align: 'center' });
    doc.fontSize(10).text(`Pay period: ${input.period}`, { align: 'center' });
    doc.moveDown();

    doc.fontSize(11).text(`Employee: ${input.employeeName} (${input.employeeCode})`);
    doc.text(
      `Working days: ${input.workingDays}  Payable days: ${input.payableDays}  LOP days: ${input.lopDays}`,
    );
    doc.moveDown();

    doc.fontSize(12).text('Earnings', { underline: true });
    for (const e of input.earnings) {
      doc.fontSize(10).text(`${e.code}: ${money(e.amount)}`);
    }
    doc.fontSize(10).text(`Gross earnings: ${money(input.grossEarnings)}`);
    doc.moveDown();

    doc.fontSize(12).text('Deductions', { underline: true });
    doc.fontSize(10).text(`EPF (employee): ${money(input.epfEmployee)}`);
    doc.text(`ESI (employee): ${money(input.esiEmployee)}`);
    doc.text(`Professional Tax: ${money(input.professionalTax)}`);
    doc.text(`TDS: ${money(input.tdsDeducted)}`);
    doc.moveDown();

    if (input.adHocAdjustments.length > 0) {
      doc.fontSize(12).text('Adjustments', { underline: true });
      for (const a of input.adHocAdjustments) {
        doc.fontSize(10).text(`${a.type}: ${money(a.amount)}${a.note ? ` (${a.note})` : ''}`);
      }
      doc.moveDown();
    }

    doc.fontSize(12).text(`Net pay: ${money(input.netPay)}`, { underline: true });

    doc.end();
  });
}
