import { useNavigate } from 'react-router-dom';
import { PageHeader } from '@/components/page-header';
import { BulkImport, type ImportReport } from '@/components/bulk-import';
import { HOLIDAY_COLUMNS } from '@/lib/leave/holiday-columns';


const count = (r: ImportReport, key: string) => Number(r.summary[key] ?? 0);

/** Leave › Holidays › Import — CSV/XLSX, matched on date + name so a corrected file updates rows. */
export function HolidayImportPage() {
  const navigate = useNavigate();
  return (
    <div className="flex max-w-4xl flex-col gap-5">
      <PageHeader
        title="Import holidays"
        description="Add or update holidays for the current and next leave year from a spreadsheet. Holidays missing from the file are never deleted."
      />
      <BulkImport
        endpoint="/leave/holidays/import"
        columns={HOLIDAY_COLUMNS}
        templateFileName="holidays-template.csv"
        rowNoun="holidays"
        keyLabel="Date"
        onDone={() => navigate('/leave')}
        summarize={(r) => {
          const badges: [('success' | 'warning' | 'default'), string][] = [
            ['success', `${count(r, 'create')} new`],
            ['default', `${count(r, 'update')} ${r.dryRun ? 'to update' : 'updated'}`],
          ];
          for (const w of (r.summary.warnings as string[] | undefined) ?? []) badges.push(['warning', w]);
          return badges;
        }}
      />
    </div>
  );
}
