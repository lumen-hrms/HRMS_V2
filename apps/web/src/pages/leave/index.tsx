import * as React from 'react';
import { api, isApiError } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { StatusBadge } from '@/pages/dashboard';
import { useAuth } from '@/context/auth-context';
import { cn } from '@/lib/utils';

interface LeaveType {
  id: string;
  name: string;
  annualQuota: string;
}
interface LeaveRequestRow {
  id: string;
  status: string;
  days: string;
  isLop: boolean;
  startDate: string;
  endDate: string;
  reason: string | null;
  leaveType?: { name: string };
  employee?: { firstName: string; lastName: string };
}

const TABS = ['Apply', 'My requests', 'Approvals', 'Leave types'] as const;
type Tab = (typeof TABS)[number];

export function LeavePage() {
  const { user } = useAuth();
  const [tab, setTab] = React.useState<Tab>('Apply');
  const isAdmin = user && ['COMPANY_ADMIN', 'HR_MANAGER'].includes(user.role);

  const visibleTabs = TABS.filter((t) => t !== 'Leave types' || isAdmin);

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-xl font-semibold">Leave</h1>
        <p className="text-sm text-muted-foreground">Apply, track, and approve leave requests.</p>
      </div>

      <div className="flex gap-1 border-b border-border">
        {visibleTabs.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              'border-b-2 px-3 py-2 text-sm font-medium',
              tab === t
                ? 'border-primary text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === 'Apply' && <ApplyTab />}
      {tab === 'My requests' && <MyRequestsTab />}
      {tab === 'Approvals' && <ApprovalsTab />}
      {tab === 'Leave types' && isAdmin && <LeaveTypesTab />}
    </div>
  );
}

function ApplyTab() {
  const { user } = useAuth();
  const [types, setTypes] = React.useState<LeaveType[]>([]);
  const [form, setForm] = React.useState({ leaveTypeId: '', startDate: '', endDate: '', reason: '' });
  const [error, setError] = React.useState<string | null>(null);
  const [success, setSuccess] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    api.get<LeaveType[]>('/leave/types').then(setTypes);
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setBusy(true);
    try {
      const res = await api.post<LeaveRequestRow>('/leave/requests', form);
      setSuccess(
        res.isLop
          ? `Request submitted (flagged as Loss of Pay — ${res.days} day(s) exceed your balance).`
          : `Request submitted for ${res.days} day(s).`,
      );
      setForm({ leaveTypeId: '', startDate: '', endDate: '', reason: '' });
    } catch (err) {
      setError(isApiError(err) ? err.message : 'Failed to submit');
    } finally {
      setBusy(false);
    }
  }

  if (!user?.employeeId) {
    return <p className="text-sm text-muted-foreground">This account has no linked employee record.</p>;
  }

  return (
    <Card className="max-w-md">
      <CardHeader>
        <CardTitle>Apply for leave</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label>Leave type</Label>
            <select
              required
              className="h-9 rounded-md border border-input bg-card px-2 text-sm"
              value={form.leaveTypeId}
              onChange={(e) => setForm((f) => ({ ...f, leaveTypeId: e.target.value }))}
            >
              <option value="">Select…</option>
              {types.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label>Start date</Label>
              <Input
                type="date"
                required
                value={form.startDate}
                onChange={(e) => setForm((f) => ({ ...f, startDate: e.target.value }))}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>End date</Label>
              <Input
                type="date"
                required
                value={form.endDate}
                onChange={(e) => setForm((f) => ({ ...f, endDate: e.target.value }))}
              />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Reason (optional)</Label>
            <Input value={form.reason} onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))} />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          {success && <p className="text-sm text-success">{success}</p>}
          <Button type="submit" disabled={busy} className="self-start">
            {busy ? 'Submitting…' : 'Submit request'}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function MyRequestsTab() {
  const { user } = useAuth();
  const [requests, setRequests] = React.useState<LeaveRequestRow[]>([]);

  React.useEffect(() => {
    if (user?.employeeId) {
      api.get<LeaveRequestRow[]>(`/leave/requests/employee/${user.employeeId}`).then(setRequests);
    }
  }, [user]);

  async function cancel(id: string) {
    await api.post(`/leave/requests/${id}/cancel`);
    setRequests((rs) => rs.map((r) => (r.id === id ? { ...r, status: 'CANCELLED' } : r)));
  }

  return (
    <Card className="divide-y divide-border">
      {requests.map((r) => (
        <div key={r.id} className="flex items-center justify-between px-4 py-3 text-sm">
          <div>
            <div className="font-medium">
              {new Date(r.startDate).toLocaleDateString()} – {new Date(r.endDate).toLocaleDateString()} · {r.days}d
              {r.isLop && (
                <Badge variant="warning" className="ml-2">
                  LOP
                </Badge>
              )}
            </div>
            {r.reason && <div className="text-muted-foreground">{r.reason}</div>}
          </div>
          <div className="flex items-center gap-3">
            <StatusBadge status={r.status} />
            {['PENDING_L1', 'PENDING_L2'].includes(r.status) && (
              <Button size="sm" variant="ghost" onClick={() => cancel(r.id)}>
                Cancel
              </Button>
            )}
          </div>
        </div>
      ))}
      {requests.length === 0 && (
        <p className="p-6 text-center text-sm text-muted-foreground">No leave requests yet.</p>
      )}
    </Card>
  );
}

function ApprovalsTab() {
  const [requests, setRequests] = React.useState<LeaveRequestRow[]>([]);

  const load = React.useCallback(() => {
    api.get<LeaveRequestRow[]>('/leave/requests/pending-approvals').then(setRequests);
  }, []);
  React.useEffect(load, [load]);

  async function decide(id: string, action: 'approve' | 'reject') {
    await api.post(`/leave/requests/${id}/${action}`);
    load();
  }

  return (
    <Card className="divide-y divide-border">
      {requests.map((r) => (
        <div key={r.id} className="flex items-center justify-between px-4 py-3 text-sm">
          <div>
            <div className="font-medium">
              {r.employee?.firstName} {r.employee?.lastName} · {r.leaveType?.name} · {r.days}d
              {r.isLop && (
                <Badge variant="warning" className="ml-2">
                  LOP
                </Badge>
              )}
            </div>
            <div className="text-muted-foreground">
              {new Date(r.startDate).toLocaleDateString()} – {new Date(r.endDate).toLocaleDateString()}
            </div>
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="success" onClick={() => decide(r.id, 'approve')}>
              Approve
            </Button>
            <Button size="sm" variant="destructive" onClick={() => decide(r.id, 'reject')}>
              Reject
            </Button>
          </div>
        </div>
      ))}
      {requests.length === 0 && (
        <p className="p-6 text-center text-sm text-muted-foreground">No requests waiting on you.</p>
      )}
    </Card>
  );
}

function LeaveTypesTab() {
  const [types, setTypes] = React.useState<LeaveType[]>([]);
  const [form, setForm] = React.useState({ name: '', annualQuota: '' });

  const load = React.useCallback(() => {
    api.get<LeaveType[]>('/leave/types').then(setTypes);
  }, []);
  React.useEffect(load, [load]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    await api.post('/leave/types', { name: form.name, annualQuota: Number(form.annualQuota) });
    setForm({ name: '', annualQuota: '' });
    load();
  }

  return (
    <div className="flex max-w-lg flex-col gap-4">
      <form onSubmit={handleCreate} className="flex items-end gap-2">
        <div className="flex flex-1 flex-col gap-1.5">
          <Label>Name</Label>
          <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} required />
        </div>
        <div className="flex w-28 flex-col gap-1.5">
          <Label>Annual quota</Label>
          <Input
            type="number"
            value={form.annualQuota}
            onChange={(e) => setForm((f) => ({ ...f, annualQuota: e.target.value }))}
            required
          />
        </div>
        <Button type="submit">Add</Button>
      </form>
      <Card className="divide-y divide-border">
        {types.map((t) => (
          <div key={t.id} className="flex items-center justify-between px-4 py-3 text-sm">
            <span className="font-medium">{t.name}</span>
            <span className="text-muted-foreground">{t.annualQuota} days/year</span>
          </div>
        ))}
      </Card>
    </div>
  );
}
