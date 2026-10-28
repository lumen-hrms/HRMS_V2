import { useNavigate } from 'react-router-dom';
import { BulkImport, type ImportColumn, type ImportReport } from '@/components/bulk-import';

/** Mirrors `SALARY_IMPORT_COLUMNS` in apps/api/src/payroll/salary-import.service.ts. */
const COLUMNS: ImportColumn[] = [
  { name: 'employeeCode', required: true, description: 'An existing employee’s code (import employees first).' },
  { name: 'ctcAnnual', required: true, description: 'Annual CTC in rupees, e.g. 1200000 or 12,00,000.' },
  { name: 'effectiveFrom', description: 'YYYY-MM-DD or DD-MM-YYYY. Defaults to the date of joining.' },
  { name: 'basicPercentOfCtc', description: 'Basic as % of CTC. Default 50; must meet your Payroll › Settings minimum.' },
  { name: 'hraPercentOfBasic', description: 'HRA as % of Basic. Default 40; 0 for no HRA.' },
  { name: 'daMonthly', description: 'Fixed monthly Dearness Allowance (optional).' },
  { name: 'conveyanceMonthly', description: 'Fixed monthly Conveyance (optional).' },
  { name: 'medicalMonthly', description: 'Fixed monthly Medical allowance (optional).' },
  { name: 'ltaMonthly', description: 'Fixed monthly LTA (optional).' },
  { name: 'reason', description: 'For a change to an existing structure: why (10+ characters). Used if it reaches into a processed month and becomes a revision with arrears.' },
];

const count = (r: ImportReport, key: string) => Number(r.summary[key] ?? 0);

export function SalaryImportPage() {
  const navigate = useNavigate();
  return (
    <div className="flex max-w-4xl flex-col gap-5">
      <div>
        <h1 className="text-xl font-semibold">Import salaries</h1>
        <p className="text-sm text-muted-foreground">
          One row per employee on the standard structure: Basic (% of CTC), HRA (% of Basic), optional
          fixed allowances, and Special Allowance as the balance. An employee who already has a
          structure gets it updated — a change reaching into an already-processed month becomes a
          revision with arrears, exactly as in the structure editor. Use the editor for custom
          components.
        </p>
      </div>
      <BulkImport
        endpoint="/payroll/structures/bulk-import"
        columns={COLUMNS}
        rowNoun="salary structures"
        templateFileName="salary-import-template.csv"
        onDone={() => navigate('/payroll')}
        summarize={(r) =>
          r.dryRun
            ? [
                ['success', `${count(r, 'create')} new structures`],
                ['default', `${count(r, 'update')} to update`],
              ]
            : [
                ['success', `${count(r, 'created')} created`],
                ['default', `${count(r, 'updated')} updated`],
              ]
        }
      />
    </div>
  );
}
