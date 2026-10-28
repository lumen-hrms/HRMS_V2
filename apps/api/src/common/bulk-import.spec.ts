import * as ExcelJS from 'exceljs';
import {
  MAX_IMPORT_ROWS,
  normalizeHeader,
  parseImportDate,
  readCsvGrid,
  readSpreadsheet,
  streamImport,
  toEnumKey,
} from './bulk-import';

describe('readCsvGrid', () => {
  it('handles quoted fields, escaped quotes, commas inside quotes, CRLF and a BOM', () => {
    const text = '﻿a,b,c\r\n"x, y","he said ""hi""",3\r\n';
    expect(readCsvGrid(text)).toEqual([
      ['a', 'b', 'c'],
      ['x, y', 'he said "hi"', '3'],
    ]);
  });

  it('keeps a last line with no trailing newline', () => {
    expect(readCsvGrid('a,b\n1,2')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });
});

describe('readSpreadsheet', () => {
  const csv = (s: string) => Buffer.from(s, 'utf8');

  it('reads CSV values as strings, so leading zeros survive', async () => {
    const sheet = await readSpreadsheet(csv('Employee Code,aadhaarLast4\nE001,0123\n'));
    expect(sheet.headers).toEqual(['employeecode', 'aadhaarlast4']);
    expect(sheet.rows[0].values.get('aadhaarlast4')).toBe('0123');
    expect(sheet.rows[0].row).toBe(2);
  });

  it('skips blank lines and omits blank cells', async () => {
    const sheet = await readSpreadsheet(csv('employeeCode,phone\nE1,\n,\nE2,99\n'));
    expect(sheet.rows.map((r) => r.row)).toEqual([2, 4]);
    expect(sheet.rows[0].values.has('phone')).toBe(false);
  });

  it('reads .xlsx, turning date cells into YYYY-MM-DD', async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Sheet1');
    ws.addRow(['employeeCode', 'dateOfJoining', 'phone']);
    ws.addRow(['E1', new Date(Date.UTC(2026, 3, 1)), '0981234567']);
    const buffer = Buffer.from(await wb.xlsx.writeBuffer());

    const sheet = await readSpreadsheet(buffer);
    expect(sheet.rows[0].values.get('dateofjoining')).toBe('2026-04-01');
    expect(sheet.rows[0].values.get('phone')).toBe('0981234567');
  });

  it('rejects an empty upload, a header-only file and a file over the row cap', async () => {
    await expect(readSpreadsheet(undefined)).rejects.toThrow('Upload a .csv or .xlsx file');
    await expect(readSpreadsheet(csv('employeeCode\n'))).rejects.toThrow('no data rows');
    const big =
      'employeeCode\n' + Array.from({ length: MAX_IMPORT_ROWS + 1 }, (_, i) => `E${i}`).join('\n');
    await expect(readSpreadsheet(csv(big))).rejects.toThrow('split it into files');
  });
});

describe('parseImportDate', () => {
  it('accepts ISO and Indian day-first formats', () => {
    expect(parseImportDate('2026-04-01')).toBe('2026-04-01');
    expect(parseImportDate('01-04-2026')).toBe('2026-04-01');
    expect(parseImportDate('1/4/2026')).toBe('2026-04-01');
  });

  it('rejects impossible dates and other formats', () => {
    expect(parseImportDate('31-02-2026')).toBeNull();
    expect(parseImportDate('April 1 2026')).toBeNull();
  });
});

describe('header/enum normalisation', () => {
  it('matches headers regardless of case, spaces, underscores and asterisks', () => {
    expect(normalizeHeader('Employee Code*')).toBe(normalizeHeader('employee_code'));
  });

  it('turns free text into enum keys', () => {
    expect(toEnumKey('Full time')).toBe('FULL_TIME');
    expect(toEnumKey(' tamil nadu ')).toBe('TAMIL_NADU');
  });
});

describe('streamImport', () => {
  function fakeRes() {
    const res: any = { lines: [] as string[], headers: {} as Record<string, string>, ended: false };
    res.status = jest.fn(() => res);
    res.setHeader = jest.fn((k: string, v: string) => (res.headers[k] = v));
    res.flushHeaders = jest.fn();
    res.write = jest.fn((chunk: string) => res.lines.push(chunk));
    res.end = jest.fn(() => (res.ended = true));
    return res;
  }
  const parse = (res: any) => res.lines.map((l: string) => JSON.parse(l));
  const report = { dryRun: false, totalRows: 1, succeeded: 1, failed: 0 } as any;

  it('streams progress lines as NDJSON, then the report', async () => {
    const res = fakeRes();
    await streamImport(res, async (onProgress) => {
      onProgress({ phase: 'saving', done: 0, total: 1 });
      onProgress({ phase: 'saving', done: 1, total: 1 });
      return report;
    });
    expect(res.headers['Content-Type']).toBe('application/x-ndjson');
    expect(res.lines.every((l: string) => l.endsWith('\n'))).toBe(true);
    expect(parse(res)).toEqual([
      { type: 'progress', phase: 'saving', done: 0, total: 1 },
      { type: 'progress', phase: 'saving', done: 1, total: 1 },
      { type: 'report', report },
    ]);
    expect(res.ended).toBe(true);
  });

  it('rethrows a failure before any progress, so it becomes a normal HTTP error', async () => {
    const res = fakeRes();
    await expect(
      streamImport(res, async () => {
        throw new Error('Missing required column: ctcAnnual');
      }),
    ).rejects.toThrow('Missing required column');
    expect(res.flushHeaders).not.toHaveBeenCalled();
  });

  it('reports a failure after streaming started as an error line', async () => {
    const res = fakeRes();
    await streamImport(res, async (onProgress) => {
      onProgress({ phase: 'saving', done: 0, total: 3 });
      throw new Error('connection lost');
    });
    expect(parse(res).pop()).toEqual({ type: 'error', message: 'connection lost' });
    expect(res.ended).toBe(true);
  });
});
