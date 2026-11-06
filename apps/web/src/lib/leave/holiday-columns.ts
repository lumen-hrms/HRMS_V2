import type { ImportColumn } from '@/components/bulk-import';

/** Mirrors `HOLIDAY_IMPORT_COLUMNS` in apps/api/src/leave/holiday-import.ts. */
export const HOLIDAY_COLUMNS: ImportColumn[] = [
  {
    name: 'date',
    required: true,
    description:
      'DD-MM-YYYY or YYYY-MM-DD (an Excel date cell works too). A slash date like 03/04/2027 is rejected as ambiguous — write 03-04-2027.',
  },
  { name: 'name', required: true, description: 'e.g. Republic Day.' },
  {
    name: 'type',
    description:
      'PUBLIC (default when blank) — a day off for everyone — or OPTIONAL: a working day unless an employee takes it as Restricted Holiday leave.',
  },
];
