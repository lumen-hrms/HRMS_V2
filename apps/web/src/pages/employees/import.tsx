import { useNavigate } from 'react-router-dom';
import { BulkImport, type ImportReport } from '@/components/bulk-import';
import { EMPLOYEE_IMPORT_COLUMNS as COLUMNS } from '@/lib/employee-import-columns';


const count = (r: ImportReport, key: string) => Number(r.summary[key] ?? 0);

export function EmployeeBulkImportPage() {
  const navigate = useNavigate();
  return (
    <div className="flex max-w-4xl flex-col gap-5">
      <div>
        <h1 className="text-xl font-semibold">Bulk import employees</h1>
        <p className="text-sm text-muted-foreground">
          Add new employees or update existing ones (matched by employee code) — job details,
          statutory IDs, bank details and logins in one file. Blank cells never clear a field. Salaries
          are imported separately under Payroll › Structures.
        </p>
      </div>
      <BulkImport
        endpoint="/employees/bulk-import"
        columns={COLUMNS}
        rowNoun="employees"
        templateFileName="employee-import-template.csv"
        onDone={() => navigate('/employees')}
        summarize={(r) => {
          const committed = !r.dryRun;
          const departments = (r.summary.newDepartments as string[] | undefined) ?? [];
          const badges: [('success' | 'warning' | 'default'), string][] = [
            ['success', `${count(r, committed ? 'created' : 'create')} ${committed ? 'created' : 'new'}`],
            ['default', `${count(r, committed ? 'updated' : 'update')} ${committed ? 'updated' : 'to update'}`],
          ];
          if (count(r, 'logins') > 0) badges.push(['default', `${count(r, 'logins')} logins`]);
          if (count(r, 'invitesFailed') > 0) {
            badges.push(['warning', `${count(r, 'invitesFailed')} invites failed`]);
          }
          if (departments.length > 0) {
            badges.push([
              'warning',
              `${committed ? 'Created' : 'Will create'} department${departments.length === 1 ? '' : 's'}: ${departments.join(', ')}`,
            ]);
          }
          return badges;
        }}
      />
    </div>
  );
}
