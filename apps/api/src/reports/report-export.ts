import * as ExcelJS from 'exceljs';
import type { ReportTable } from './report-table';

/**
 * Cells starting with these characters are evaluated as formulas by Excel /
 * Sheets. Department names are user-typed, so a CSV export must neutralise
 * them rather than hand a spreadsheet live formulas.
 */
const FORMULA_PREFIX = /^[=+\-@\t\r]/;

function csvCell(value: string | number | null): string {
  if (value === null || value === undefined) return '';
  let text = String(value);
  if (typeof value === 'string' && FORMULA_PREFIX.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(table: ReportTable): string {
  const header = table.columns.map((c) => csvCell(c.label)).join(',');
  const body = table.rows.map((row) =>
    table.columns.map((c) => csvCell(row[c.key] ?? null)).join(','),
  );
  return [header, ...body].join('\r\n') + '\r\n';
}

export async function toXlsx(table: ReportTable, title: string): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'HRMS';
  const sheet = workbook.addWorksheet(title.slice(0, 31));
  sheet.columns = table.columns.map((c) => ({ header: c.label, key: c.key, width: 18 }));
  sheet.getRow(1).font = { bold: true };
  for (const row of table.rows) sheet.addRow(row);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
