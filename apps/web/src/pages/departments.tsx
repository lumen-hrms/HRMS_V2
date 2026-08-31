import * as React from 'react';
import { Plus } from 'lucide-react';
import { api } from '@/lib/api';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useAuth } from '@/context/auth-context';

interface Department {
  id: string;
  name: string;
}

export function DepartmentsPage() {
  const { user } = useAuth();
  const [departments, setDepartments] = React.useState<Department[]>([]);
  const [name, setName] = React.useState('');
  const canCreate = user && ['COMPANY_ADMIN', 'HR_MANAGER'].includes(user.role);

  const load = React.useCallback(() => {
    api.get<Department[]>('/departments').then(setDepartments);
  }, []);
  React.useEffect(load, [load]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    await api.post('/departments', { name: name.trim() });
    setName('');
    load();
  }

  return (
    <div className="flex max-w-lg flex-col gap-5">
      <div>
        <h1 className="text-xl font-semibold">Departments</h1>
        <p className="text-sm text-muted-foreground">Organizational units used across employees and reports.</p>
      </div>

      {canCreate && (
        <form onSubmit={handleCreate} className="flex gap-2">
          <Input placeholder="New department name" value={name} onChange={(e) => setName(e.target.value)} />
          <Button type="submit">
            <Plus className="h-4 w-4" /> Add
          </Button>
        </form>
      )}

      <Card className="flex flex-col divide-y divide-border">
        {departments.map((d) => (
          <div key={d.id} className="px-4 py-3 text-sm font-medium">
            {d.name}
          </div>
        ))}
        {departments.length === 0 && (
          <p className="p-6 text-center text-sm text-muted-foreground">No departments yet.</p>
        )}
      </Card>
    </div>
  );
}
