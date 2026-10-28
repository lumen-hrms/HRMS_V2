import { BadRequestException } from '@nestjs/common';
import type { Response } from 'express';
import * as ExcelJS from 'exceljs';

/**
 * Shared plumbing for the spreadsheet bulk imports (Employee Master's
 * employee import, Payroll's salary import): reads a CSV or XLSX upload
 * into header-keyed string rows, and the report shape both imports return
 * so the web app can render either with the same preview/confirm screen.
 */

export const MAX_IMPORT_ROWS = 5000;
export const MAX_IMPORT_FILE_BYTES = 5 * 1024 * 1024; // 5 MB
/** Rows written in parallel on commit — under the tenant pool's connection limit. */
export const IMPORT_CONCURRENCY = 4;
export const NDJSON = 'application/x-ndjson';

/** Commit progress, reported as rows finish (see `streamImport`). */
export interface ImportProgress {
  phase: 'saving' | 'linking' | 'inviting';
  done: number;
  total: number;
}
export type OnImportProgress = (progress: ImportProgress) => void;

export interface SheetRow {
  /** 1-based spreadsheet row number (the header is row 1), for error messages. */
  row: number;
  /** Values keyed by the *normalized* header (see `normalizeHeader`). */
  values: Map<string, string>;
}

export interface ParsedSheet {
  /** Normalized headers, in file order. */
  headers: string[];
  rows: SheetRow[];
}

export interface ImportRowResult {
  row: number;
  employeeCode: string | null;
  action: 'create' | 'update' | null;
  /** Dry run: the row is valid and would be imported. Commit: it was. */
  success: boolean;
  error?: string;
  warnings?: string[];
  /** One-line human summary shown next to the row (e.g. a salary breakdown). */
  detail?: string;
}

export interface ImportReport {
  dryRun: boolean;
  totalRows: number;
  succeeded: number;
  failed: number;
  /** Headers present in the file that the importer doesn't recognise. */
  ignoredColumns: string[];
  summary: Record<string, number | string[]>;
  results: ImportRowResult[];
}

/** "Employee Code", "employee_code", "employeeCode*" → "employeecode". */
export function normalizeHeader(header: string): string {
  return header.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Parses an uploaded `.xlsx` (detected by its ZIP magic bytes) or CSV file.
 * Every value comes back as a trimmed string — never an auto-converted
 * number — so leading zeros (Aadhaar last 4, phone numbers, account
 * numbers) survive. XLSX date cells become `YYYY-MM-DD`.
 */
export async function readSpreadsheet(buffer: Buffer | undefined): Promise<ParsedSheet> {
  if (!buffer || buffer.length === 0) throw new BadRequestException('Upload a .csv or .xlsx file');
  if (buffer.length > MAX_IMPORT_FILE_BYTES) {
    throw new BadRequestException('The file is larger than 5 MB');
  }

  const isXlsx = buffer[0] === 0x50 && buffer[1] === 0x4b; // "PK" — a ZIP container
  const grid = isXlsx ? await readXlsxGrid(buffer) : readCsvGrid(buffer.toString('utf8'));

  const headerCells = grid[0] ?? [];
  const headers = headerCells.map((h) => normalizeHeader(h));
  if (headers.every((h) => h === '')) throw new BadRequestException('The file has no header row');

  const rows: SheetRow[] = [];
  for (let i = 1; i < grid.length; i++) {
    const cells = grid[i];
    if (cells.every((c) => c.trim() === '')) continue; // blank line
    const values = new Map<string, string>();
    headers.forEach((h, col) => {
      const v = (cells[col] ?? '').trim();
      if (h && v !== '') values.set(h, v);
    });
    rows.push({ row: i + 1, values });
  }
  if (rows.length === 0) throw new BadRequestException('The file has no data rows');
  if (rows.length > MAX_IMPORT_ROWS) {
    throw new BadRequestException(
      `The file has ${rows.length} rows — split it into files of at most ${MAX_IMPORT_ROWS}`,
    );
  }
  return { headers: headers.filter((h) => h !== ''), rows };
}

async function readXlsxGrid(buffer: Buffer): Promise<string[][]> {
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buffer as any);
  } catch {
    throw new BadRequestException('Could not read the .xlsx file');
  }
  const sheet = workbook.worksheets[0];
  if (!sheet) throw new BadRequestException('Workbook has no sheets');

  const width = sheet.columnCount;
  const grid: string[][] = [];
  for (let r = 1; r <= sheet.rowCount; r++) {
    const row = sheet.getRow(r);
    const cells: string[] = [];
    for (let c = 1; c <= width; c++) {
      const cell = row.getCell(c);
      cells.push(
        cell.value instanceof Date ? cell.value.toISOString().slice(0, 10) : (cell.text ?? ''),
      );
    }
    grid.push(cells);
  }
  return grid;
}

/** RFC 4180 CSV: quoted fields, escaped `""`, CRLF or LF, optional UTF-8 BOM. */
export function readCsvGrid(text: string): string[][] {
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const grid: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(field);
      grid.push(row);
      row = [];
      field = '';
    } else {
      field += ch;
    }
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    grid.push(row);
  }
  return grid;
}

/**
 * Accepts `YYYY-MM-DD` (ISO) or the Indian `DD-MM-YYYY` / `DD/MM/YYYY`.
 * Returns `YYYY-MM-DD`, or null if it isn't a real calendar date.
 */
export function parseImportDate(value: string): string | null {
  let y: number, m: number, d: number;
  let match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(value);
  if (match) {
    [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  } else {
    match = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(value);
    if (!match) return null;
    [d, m, y] = [Number(match[1]), Number(match[2]), Number(match[3])];
  }
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) {
    return null;
  }
  return date.toISOString().slice(0, 10);
}

/** "Full time" / "full-time" / "FULL_TIME" → "FULL_TIME". */
export function toEnumKey(value: string): string {
  return value
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
}

export function buildReport(
  dryRun: boolean,
  results: ImportRowResult[],
  ignoredColumns: string[],
  summary: ImportReport['summary'],
): ImportReport {
  const succeeded = results.filter((r) => r.success).length;
  return {
    dryRun,
    totalRows: results.length,
    succeeded,
    failed: results.length - succeeded,
    ignoredColumns,
    summary,
    results,
  };
}

/**
 * Sends an import commit as newline-delimited JSON so the browser can show
 * live progress on a long import instead of a frozen spinner:
 * `{"type":"progress","phase","done","total"}` lines, then exactly one
 * `{"type":"report","report":{…}}` or `{"type":"error","message"}` line.
 *
 * Headers go out with the first progress line, not before — so a failure
 * while still parsing/validating (bad file, missing column) is thrown and
 * becomes an ordinary HTTP 4xx through Nest's exception filter.
 */
export async function streamImport(
  res: Response,
  run: (onProgress: OnImportProgress) => Promise<ImportReport>,
): Promise<void> {
  let started = false;
  const write = (line: object) => {
    if (!started) {
      started = true;
      res.status(200);
      res.setHeader('Content-Type', NDJSON);
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('X-Accel-Buffering', 'no'); // don't let a proxy buffer the stream
      res.flushHeaders();
    }
    res.write(JSON.stringify(line) + '\n');
  };
  try {
    const report = await run((p) => write({ type: 'progress', ...p }));
    write({ type: 'report', report });
  } catch (e: any) {
    if (!started) throw e;
    write({ type: 'error', message: e?.response?.message ?? e?.message ?? 'Import failed' });
  }
  res.end();
}
