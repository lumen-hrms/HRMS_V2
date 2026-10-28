import { useNavigate } from 'react-router-dom';
import { BulkImport, type ImportColumn, type ImportReport } from '@/components/bulk-import';

/** Mirrors `EMPLOYEE_IMPORT_COLUMNS` in apps/api/src/employees/employee-import.service.ts. */
const COLUMNS: ImportColumn[] = [
  { name: 'employeeCode', required: true, description: 'Unique code. An existing code updates that employee; a new one creates them.' },
  { name: 'firstName', description: 'Required for a new employee.' },
  { name: 'lastName', description: 'Required for a new employee.' },
  { name: 'personalEmail', description: 'Personal email address.' },
  { name: 'phone', description: 'Mobile number.' },
  { name: 'dateOfBirth', description: 'YYYY-MM-DD or DD-MM-YYYY.' },
  { name: 'gender', description: 'e.g. Male, Female, Other — used for gender-restricted leave types.' },
  { name: 'maritalStatus', description: 'Free text.' },
  { name: 'bloodGroup', description: 'e.g. O+.' },
  { name: 'nationality', description: 'e.g. Indian.' },
  { name: 'department', description: 'Department name. A name that doesn’t exist yet is created (the preview lists them).' },
  { name: 'designation', description: 'Job title.' },
  { name: 'employmentType', description: 'Full time, Part time, Contract, Intern or Consultant.' },
  { name: 'dateOfJoining', description: 'YYYY-MM-DD or DD-MM-YYYY. Also the default salary effective date.' },
  { name: 'workLocation', description: 'Office / city.' },
  { name: 'workState', description: 'State or UT of work, e.g. Karnataka — decides Professional Tax.' },
  { name: 'reportingManagerCode', description: 'Manager’s employeeCode — an existing employee or another row in this file.' },
  { name: 'payGrade', description: 'Free text.' },
  { name: 'costCenter', description: 'Free text.' },
  { name: 'pan', description: 'ABCDE1234F. Stored encrypted; only a masked form is shown.' },
  { name: 'aadhaarLast4', description: 'Last 4 digits only — never the full Aadhaar number.' },
  { name: 'uan', description: '12-digit UAN.' },
  { name: 'pfNumber', description: 'PF member ID.' },
  { name: 'esicNumber', description: 'ESIC IP number.' },
  { name: 'taxRegime', description: 'OLD or NEW.' },
  { name: 'bankAccountHolderName', description: 'Name on the account.' },
  { name: 'bankAccountNumber', description: '9–18 digits. Stored encrypted.' },
  { name: 'bankIfsc', description: 'e.g. SBIN0001234.' },
  { name: 'bankName', description: 'e.g. State Bank of India.' },
  { name: 'bankBranch', description: 'Branch name.' },
  { name: 'bankAccountType', description: 'Savings or Current.' },
  { name: 'loginEmail', description: 'Optional. Creates a login and emails an invite to set a password.' },
  { name: 'loginRole', description: 'Employee (default), Line Manager, HR Manager, Auditor — or Company Admin (Company Admins only).' },
];

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
