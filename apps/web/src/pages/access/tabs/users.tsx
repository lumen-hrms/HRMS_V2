import * as React from 'react';
import {
  Download,
  MoreHorizontal,
  Search,
  ShieldCheck,
  UserRoundPlus,
  Users as UsersIcon,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/table';
import { SkeletonRows } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty-state';
import { DropdownMenu, DropdownMenuItem, DropdownMenuSeparator } from '@/components/ui/dropdown-menu';
import { ROLE_LABELS, type Role } from '@/lib/roles';
import { accessApi } from '@/lib/access/client';
import type { AccessUser } from '@/lib/access/types';
import { RoleBadge, UserStatusBadge, fmtDateTimeIST, fmtRelative } from '../shared';
import { UserDetailSheet } from '../components/user-detail-sheet';
import { ChangeRoleDialog } from '../components/change-role-dialog';
import { SetStatusDialog } from '../components/set-status-dialog';
import { SendResetDialog } from '../components/send-reset-dialog';
import { useAccessCtx } from '../use-access-ctx';

const PAGE_SIZE = 25;

type DialogState =
  | { kind: 'role' | 'deactivate' | 'reactivate' | 'reset'; user: AccessUser }
  | null;

/**
 * Access › Users — the tenant's logins, their roles, and their auth status.
 * `readOnly` (Auditor) strips every mutating control. Company Admin also gets
 * Change Role; HR Manager gets status + reset only. Logins are provisioned via
 * Employee Master — there is no standalone "invite user" in V1.
 */
export function UsersTab({
  readOnly,
  canManage,
  canChangeRole,
}: {
  readOnly: boolean;
  canManage: boolean;
  canChangeRole: boolean;
}) {
  const ctx = useAccessCtx();
  const [rows, setRows] = React.useState<AccessUser[] | null>(null);
  const [q, setQ] = React.useState('');
  const [roleFilter, setRoleFilter] = React.useState<Role | 'ALL'>('ALL');
  const [statusFilter, setStatusFilter] = React.useState<'ALL' | 'ACTIVE' | 'INACTIVE'>('ALL');
  const [page, setPage] = React.useState(0);

  const [selected, setSelected] = React.useState<AccessUser | null>(null);
  const [sheetOpen, setSheetOpen] = React.useState(false);
  const [dialog, setDialog] = React.useState<DialogState>(null);

  const load = React.useCallback(() => {
    setRows(null);
    accessApi.listUsers().then(setRows);
  }, []);
  React.useEffect(load, [load]);

  // Keep the open drawer / dialog pointed at fresh data after a mutation.
  const syncSelected = React.useCallback(
    (list: AccessUser[]) => {
      setSelected((s) => (s ? (list.find((u) => u.id === s.id) ?? null) : s));
      setDialog((d) => {
        if (!d) return d;
        const fresh = list.find((u) => u.id === d.user.id);
        return fresh ? { ...d, user: fresh } : null;
      });
    },
    [],
  );
  const reload = React.useCallback(() => {
    accessApi.listUsers().then((list) => {
      setRows(list);
      syncSelected(list);
    });
  }, [syncSelected]);

  const all = rows ?? [];
  const activeCompanyAdmins = all.filter((u) => u.role === 'COMPANY_ADMIN' && u.isActive).length;

  const filtered = all.filter((u) => {
    if (roleFilter !== 'ALL' && u.role !== roleFilter) return false;
    if (statusFilter === 'ACTIVE' && !u.isActive) return false;
    if (statusFilter === 'INACTIVE' && u.isActive) return false;
    if (q.trim()) {
      const needle = q.trim().toLowerCase();
      const hay = [
        u.email,
        u.employee?.firstName,
        u.employee?.lastName,
        u.employee?.employeeCode,
        u.employee?.designation,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      if (!hay.includes(needle)) return false;
    }
    return true;
  });

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const pageRows = filtered.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);

  React.useEffect(() => setPage(0), [q, roleFilter, statusFilter]);

  const stats = {
    total: all.length,
    active: all.filter((u) => u.isActive).length,
    deactivated: all.filter((u) => !u.isActive).length,
    admins: all.filter((u) => u.role === 'COMPANY_ADMIN' || u.role === 'HR_MANAGER').length,
  };

  function openRow(u: AccessUser) {
    setSelected(u);
    setSheetOpen(true);
  }

  function exportCsv() {
    const header = ['Email', 'Employee', 'Code', 'Role', 'Status', 'Last sign-in', 'Last IP'];
    const lines = filtered.map((u) =>
      [
        u.email,
        u.employee ? `${u.employee.firstName} ${u.employee.lastName}` : '',
        u.employee?.employeeCode ?? '',
        ROLE_LABELS[u.role],
        u.isActive ? 'Active' : 'Deactivated',
        u.lastLoginAt ? fmtDateTimeIST(u.lastLoginAt) : 'Never',
        u.lastLoginIp ?? '',
      ]
        .map((v) => `"${String(v).replace(/"/g, '""')}"`)
        .join(','),
    );
    const blob = new Blob([[header.join(','), ...lines].join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `access-users-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Stat tiles */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile icon={UsersIcon} label="Total logins" value={rows ? stats.total : null} />
        <StatTile
          icon={ShieldCheck}
          label="Active"
          value={rows ? stats.active : null}
          tone="success"
        />
        <StatTile
          label="Deactivated"
          value={rows ? stats.deactivated : null}
          tone={stats.deactivated > 0 ? 'destructive' : undefined}
        />
        <StatTile label="Admins (Company / HR)" value={rows ? stats.admins : null} />
      </div>

      {/* Toolbar */}
      <Card className="flex flex-wrap items-end gap-3 p-3">
        <label className="flex flex-1 flex-col gap-1 text-xs text-muted-foreground">
          Search
          <span className="relative">
            <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="h-8 pl-7"
              placeholder="Email, employee name or code…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </span>
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Role
          <Select
            className="h-8 w-40"
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value as Role | 'ALL')}
          >
            <option value="ALL">All roles</option>
            {(Object.keys(ROLE_LABELS) as Role[]).map((r) => (
              <option key={r} value={r}>
                {ROLE_LABELS[r]}
              </option>
            ))}
          </Select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Status
          <Select
            className="h-8 w-36"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as 'ALL' | 'ACTIVE' | 'INACTIVE')}
          >
            <option value="ALL">All statuses</option>
            <option value="ACTIVE">Active</option>
            <option value="INACTIVE">Deactivated</option>
          </Select>
        </label>
        <div className="ml-auto flex gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setQ('');
              setRoleFilter('ALL');
              setStatusFilter('ALL');
            }}
          >
            Clear
          </Button>
          <Button variant="outline" size="sm" onClick={exportCsv} disabled={filtered.length === 0}>
            <Download className="h-4 w-4" /> Export CSV
          </Button>
        </div>
      </Card>

      {!readOnly && (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <UserRoundPlus className="h-3.5 w-3.5" />
          Logins are created when an employee is added in{' '}
          <Link to="/employees/new" className="font-medium text-primary hover:underline">
            Employee Master
          </Link>
          . There is no standalone invite in V1.
        </p>
      )}

      {/* Table */}
      <Card className="overflow-hidden">
        {rows == null ? (
          <div className="p-4">
            <SkeletonRows rows={8} />
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState icon={Search} title="No logins match these filters" />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>User</TH>
                <TH>Employee</TH>
                <TH>Role</TH>
                <TH>Status</TH>
                <TH>Last sign-in</TH>
                <TH className="text-right">Actions</TH>
              </TR>
            </THead>
            <TBody>
              {pageRows.map((u) => (
                <TR
                  key={u.id}
                  className="cursor-pointer hover:bg-accent"
                  onClick={() => openRow(u)}
                >
                  <TD className="font-medium">{u.email}</TD>
                  <TD>
                    {u.employee ? (
                      <div>
                        <div>
                          {u.employee.firstName} {u.employee.lastName}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {u.employee.employeeCode}
                        </div>
                      </div>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TD>
                  <TD>
                    <RoleBadge role={u.role} />
                  </TD>
                  <TD>
                    <UserStatusBadge isActive={u.isActive} />
                  </TD>
                  <TD>
                    <span title={u.lastLoginAt ? fmtDateTimeIST(u.lastLoginAt) : 'Never'}>
                      {fmtRelative(u.lastLoginAt)}
                    </span>
                  </TD>
                  <TD className="text-right" onClick={(e) => e.stopPropagation()}>
                    <RowActions
                      user={u}
                      readOnly={readOnly}
                      canManage={canManage}
                      canChangeRole={canChangeRole}
                      isSelf={ctx?.userId === u.id}
                      onView={() => openRow(u)}
                      onDialog={setDialog}
                    />
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Card>

      {rows != null && filtered.length > 0 && (
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>
            Showing {safePage * PAGE_SIZE + 1}–{safePage * PAGE_SIZE + pageRows.length} of{' '}
            {filtered.length}
          </span>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={safePage === 0}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
            >
              Previous
            </Button>
            <span>
              Page {safePage + 1} of {pageCount}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={safePage >= pageCount - 1}
              onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
            >
              Next
            </Button>
          </div>
        </div>
      )}

      <UserDetailSheet
        user={selected}
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        canManage={canManage}
        canChangeRole={canChangeRole}
        onChangeRole={() => selected && setDialog({ kind: 'role', user: selected })}
        onToggleStatus={() =>
          selected &&
          setDialog({ kind: selected.isActive ? 'deactivate' : 'reactivate', user: selected })
        }
        onSendReset={() => selected && setDialog({ kind: 'reset', user: selected })}
      />

      <ChangeRoleDialog
        user={dialog?.kind === 'role' ? dialog.user : null}
        activeCompanyAdmins={activeCompanyAdmins}
        open={dialog?.kind === 'role'}
        onOpenChange={(v) => !v && setDialog(null)}
        onDone={reload}
      />
      <SetStatusDialog
        user={dialog?.kind === 'deactivate' || dialog?.kind === 'reactivate' ? dialog.user : null}
        mode={dialog?.kind === 'reactivate' ? 'reactivate' : 'deactivate'}
        isSelf={ctx?.userId === dialog?.user.id}
        activeCompanyAdmins={activeCompanyAdmins}
        open={dialog?.kind === 'deactivate' || dialog?.kind === 'reactivate'}
        onOpenChange={(v) => !v && setDialog(null)}
        onDone={reload}
      />
      <SendResetDialog
        user={dialog?.kind === 'reset' ? dialog.user : null}
        open={dialog?.kind === 'reset'}
        onOpenChange={(v) => !v && setDialog(null)}
        onDone={reload}
      />
    </div>
  );
}

function RowActions({
  user,
  readOnly,
  canManage,
  canChangeRole,
  isSelf,
  onView,
  onDialog,
}: {
  user: AccessUser;
  readOnly: boolean;
  canManage: boolean;
  canChangeRole: boolean;
  isSelf: boolean;
  onView: () => void;
  onDialog: (d: DialogState) => void;
}) {
  return (
    <DropdownMenu
      trigger={
        <span className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground">
          <MoreHorizontal className="h-4 w-4" />
        </span>
      }
    >
      <DropdownMenuItem onClick={onView}>View details</DropdownMenuItem>
      {!readOnly && (canChangeRole || canManage) && <DropdownMenuSeparator />}
      {!readOnly && canChangeRole && (
        <DropdownMenuItem onClick={() => onDialog({ kind: 'role', user })}>
          Change role
        </DropdownMenuItem>
      )}
      {!readOnly && canManage && (
        <DropdownMenuItem onClick={() => onDialog({ kind: 'reset', user })}>
          Send password-reset link
        </DropdownMenuItem>
      )}
      {!readOnly && canManage && user.isActive && (
        <DropdownMenuItem
          destructive
          disabled={isSelf}
          onClick={() => !isSelf && onDialog({ kind: 'deactivate', user })}
        >
          {isSelf ? 'Deactivate (not your own)' : 'Deactivate login'}
        </DropdownMenuItem>
      )}
      {!readOnly && canManage && !user.isActive && (
        <DropdownMenuItem onClick={() => onDialog({ kind: 'reactivate', user })}>
          Reactivate login
        </DropdownMenuItem>
      )}
    </DropdownMenu>
  );
}

function StatTile({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon?: typeof UsersIcon;
  label: string;
  value: number | null;
  tone?: 'success' | 'destructive';
}) {
  return (
    <Card className="flex flex-col gap-1 p-4">
      <span className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {Icon && <Icon className="h-3.5 w-3.5" />}
        {label}
      </span>
      {value == null ? (
        <div className="mt-1 h-8 w-12 animate-pulse rounded bg-muted" />
      ) : (
        <span
          className={
            tone === 'success'
              ? 'text-2xl font-semibold text-success'
              : tone === 'destructive'
                ? 'text-2xl font-semibold text-destructive'
                : 'text-2xl font-semibold'
          }
        >
          {value}
        </span>
      )}
    </Card>
  );
}
