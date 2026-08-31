import * as React from 'react';
import { Link } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { api } from '@/lib/api';
import { buttonVariants } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useAuth } from '@/context/auth-context';

interface Employee {
  id: string;
  employeeCode: string;
  firstName: string;
  lastName: string;
  designation: string | null;
  employmentStatus: string;
  department: { name: string } | null;
  reportingManager: { firstName: string; lastName: string } | null;
}

const CAN_CREATE = ['COMPANY_ADMIN', 'HR_MANAGER'];

export function EmployeeListPage() {
  const { user } = useAuth();
  const [employees, setEmployees] = React.useState<Employee[] | null>(null);

  React.useEffect(() => {
    api.get<Employee[]>('/employees').then(setEmployees);
  }, []);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Employees</h1>
          <p className="text-sm text-muted-foreground">Central directory for your organization.</p>
        </div>
        {user && CAN_CREATE.includes(user.role) && (
          <Link to="/employees/new" className={buttonVariants({ variant: 'default' })}>
            <Plus className="h-4 w-4" /> Add employee
          </Link>
        )}
      </div>

      <Card className="overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted text-muted-foreground">
            <tr>
              <th className="px-4 py-2.5 text-left font-medium">Name</th>
              <th className="px-4 py-2.5 text-left font-medium">Code</th>
              <th className="px-4 py-2.5 text-left font-medium">Department</th>
              <th className="px-4 py-2.5 text-left font-medium">Designation</th>
              <th className="px-4 py-2.5 text-left font-medium">Manager</th>
              <th className="px-4 py-2.5 text-left font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {employees?.map((e) => (
              <tr key={e.id} className="border-t border-border hover:bg-accent">
                <td className="px-4 py-2.5">
                  <Link to={`/employees/${e.id}`} className="font-medium hover:underline">
                    {e.firstName} {e.lastName}
                  </Link>
                </td>
                <td className="px-4 py-2.5 text-muted-foreground">{e.employeeCode}</td>
                <td className="px-4 py-2.5">{e.department?.name ?? '—'}</td>
                <td className="px-4 py-2.5">{e.designation ?? '—'}</td>
                <td className="px-4 py-2.5">
                  {e.reportingManager ? `${e.reportingManager.firstName} ${e.reportingManager.lastName}` : '—'}
                </td>
                <td className="px-4 py-2.5">
                  <Badge variant={e.employmentStatus === 'ACTIVE' ? 'success' : 'outline'}>
                    {e.employmentStatus}
                  </Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {employees?.length === 0 && (
          <p className="p-6 text-center text-sm text-muted-foreground">No employees visible to your role yet.</p>
        )}
      </Card>
    </div>
  );
}
