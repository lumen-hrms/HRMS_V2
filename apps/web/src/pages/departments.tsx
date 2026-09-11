import * as React from 'react';
import { Plus, Pencil, Trash2 } from 'lucide-react';
import { api, isApiError } from '@/lib/api';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { useToast } from '@/components/ui/toast';
import { useAuth } from '@/context/auth-context';

interface Department {
  id: string;
  name: string;
  code: string | null;
  headEmployeeId: string | null;
}

export function DepartmentsPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [departments, setDepartments] = React.useState<Department[]>([]);
  const [name, setName] = React.useState('');
  const [editing, setEditing] = React.useState<Department | null>(null);
  const [deleting, setDeleting] = React.useState<Department | null>(null);
  const canManage = user && ['COMPANY_ADMIN', 'HR_MANAGER'].includes(user.role);

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

      {canManage && (
        <form onSubmit={handleCreate} className="flex gap-2">
          <Input placeholder="New department name" value={name} onChange={(e) => setName(e.target.value)} />
          <Button type="submit">
            <Plus className="h-4 w-4" /> Add
          </Button>
        </form>
      )}

      <Card className="flex flex-col divide-y divide-border">
        {departments.map((d) => (
          <div key={d.id} className="flex items-center justify-between px-4 py-3 text-sm font-medium">
            <div className="flex flex-col">
              <span>{d.name}</span>
              {d.code && <span className="text-xs font-normal text-muted-foreground">{d.code}</span>}
            </div>
            {canManage && (
              <div className="flex items-center gap-1">
                <Button size="sm" variant="ghost" onClick={() => setEditing(d)}>
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setDeleting(d)}>
                  <Trash2 className="h-3.5 w-3.5 text-destructive" />
                </Button>
              </div>
            )}
          </div>
        ))}
        {departments.length === 0 && (
          <p className="p-6 text-center text-sm text-muted-foreground">No departments yet.</p>
        )}
      </Card>

      {editing && (
        <EditDepartmentDialog
          department={editing}
          onOpenChange={(open) => !open && setEditing(null)}
          onSaved={() => {
            setEditing(null);
            load();
            toast({ title: 'Department saved' });
          }}
        />
      )}

      {deleting && (
        <DeleteDepartmentDialog
          department={deleting}
          departments={departments}
          onOpenChange={(open) => !open && setDeleting(null)}
          onDeleted={() => {
            setDeleting(null);
            load();
            toast({ title: 'Department deleted' });
          }}
        />
      )}
    </div>
  );
}

function EditDepartmentDialog({
  department,
  onOpenChange,
  onSaved,
}: {
  department: Department;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const [name, setName] = React.useState(department.name);
  const [code, setCode] = React.useState(department.code ?? '');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await api.patch(`/departments/${department.id}`, { name, code: code || undefined });
      onSaved();
    } catch (err) {
      setError(isApiError(err) ? err.message : 'Could not save');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader title="Edit department" onClose={() => onOpenChange(false)} />
        <div className="flex flex-col gap-4">
          <Field label="Name" required>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Code" hint="Short code shown alongside the name">
            <Input value={code} onChange={(e) => setCode(e.target.value)} />
          </Field>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
              Cancel
            </Button>
            <Button onClick={save} disabled={busy || !name.trim()}>
              {busy ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function DeleteDepartmentDialog({
  department,
  departments,
  onOpenChange,
  onDeleted,
}: {
  department: Department;
  departments: Department[];
  onOpenChange: (open: boolean) => void;
  onDeleted: () => void;
}) {
  const [reassignTo, setReassignTo] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const otherDepartments = departments.filter((d) => d.id !== department.id);

  async function confirmDelete() {
    setBusy(true);
    setError(null);
    try {
      await api.delete(`/departments/${department.id}`, {
        reassignToDepartmentId: reassignTo || undefined,
      });
      onDeleted();
    } catch (err) {
      setError(isApiError(err) ? err.message : 'Could not delete department');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader
          title={`Delete "${department.name}"`}
          description="If this department still has employees, choose where they move first."
          onClose={() => onOpenChange(false)}
        />
        <div className="flex flex-col gap-4">
          <Field label="Reassign employees to" hint="Only needed if the department isn't empty">
            <Select value={reassignTo} onChange={(e) => setReassignTo(e.target.value)}>
              <option value="">— none —</option>
              {otherDepartments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </Select>
          </Field>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={confirmDelete} disabled={busy}>
              {busy ? 'Deleting…' : 'Delete department'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
