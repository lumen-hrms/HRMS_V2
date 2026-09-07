import * as React from 'react';
import { Construction } from 'lucide-react';
import { PageHeader } from '@/components/page-header';
import { Card } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { EmptyState } from '@/components/ui/empty-state';
import { useAuth } from '@/context/auth-context';
import { USE_MOCK } from '@/lib/leave/client';
import {
  hasRole,
  isLeaveAdmin,
  isLeaveApprover,
  hasTeamView,
  isAuditor,
  type Role,
} from '@/lib/roles';
import { MockDataNote } from '@/pages/leave/shared';
import { RequestDetailSheet } from '@/pages/leave/components/request-detail-sheet';
import { OverviewTab } from '@/pages/leave/tabs/overview';
import { ApplyTab } from '@/pages/leave/tabs/apply';
import { MyRequestsTab } from '@/pages/leave/tabs/my-requests';
import { HolidaysTab } from '@/pages/leave/tabs/holidays';
import { ApprovalsTab } from '@/pages/leave/tabs/approvals';
import { TeamCalendarTab } from '@/pages/leave/tabs/team-calendar';
import { TeamBalancesTab } from '@/pages/leave/tabs/team-balances';
import type { LeaveRequest } from '@/lib/leave/types';

type TabId =
  | 'overview'
  | 'apply'
  | 'my-requests'
  | 'approvals'
  | 'team-calendar'
  | 'team-balances'
  | 'all-requests'
  | 'leave-types'
  | 'balance-adjustments'
  | 'ledger'
  | 'holidays'
  | 'settings';

interface TabDef {
  id: TabId;
  label: string;
  /** predicate over the current user; undefined ⇒ everyone (non-auditor) */
  show: (u: { role: Role } | null) => boolean;
}

const TAB_DEFS: TabDef[] = [
  { id: 'overview', label: 'Overview', show: (u) => !isAuditor(u) },
  { id: 'apply', label: 'Apply', show: (u) => !isAuditor(u) },
  { id: 'my-requests', label: 'My Requests', show: (u) => !isAuditor(u) },
  { id: 'approvals', label: 'Approvals', show: (u) => isLeaveApprover(u) },
  { id: 'team-calendar', label: 'Team Calendar', show: (u) => hasTeamView(u) },
  { id: 'team-balances', label: 'Team Balances', show: (u) => hasTeamView(u) },
  { id: 'all-requests', label: 'All Requests', show: (u) => isLeaveAdmin(u) || isAuditor(u) },
  { id: 'leave-types', label: 'Leave Types', show: (u) => isLeaveAdmin(u) || isAuditor(u) },
  { id: 'balance-adjustments', label: 'Balance Adjustments', show: (u) => isLeaveAdmin(u) },
  { id: 'ledger', label: 'Balance Ledger', show: (u) => isLeaveAdmin(u) || isAuditor(u) },
  { id: 'holidays', label: 'Holidays', show: () => true },
  {
    id: 'settings',
    label: 'Settings',
    show: (u) => hasRole(u, ['COMPANY_ADMIN']) || isAuditor(u),
  },
];

export function LeavePage() {
  const { user } = useAuth();
  const tabs = TAB_DEFS.filter((t) => t.show(user));
  const [active, setActive] = React.useState<TabId>(tabs[0]?.id ?? 'holidays');
  // Bumped after an apply/cancel so sibling tabs (Overview, My Requests) reload.
  const [refreshKey, setRefreshKey] = React.useState(0);
  const bump = React.useCallback(() => setRefreshKey((k) => k + 1), []);

  const [detail, setDetail] = React.useState<LeaveRequest | null>(null);
  const [detailOpen, setDetailOpen] = React.useState(false);
  const openDetail = React.useCallback((r: LeaveRequest) => {
    setDetail(r);
    setDetailOpen(true);
  }, []);

  const canManageHolidays = isLeaveAdmin(user);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Leave"
        description="Balances, requests, approvals, and the company calendar."
        actions={USE_MOCK ? <MockDataNote /> : undefined}
      />

      <Tabs value={active} onValueChange={(v) => setActive(v as TabId)}>
        <TabsList>
          {tabs.map((t) => (
            <TabsTrigger key={t.id} value={t.id}>
              {t.label}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="overview">
          <OverviewTab onOpenRequest={openDetail} key={refreshKey} />
        </TabsContent>
        <TabsContent value="apply">
          <ApplyTab onApplied={bump} />
        </TabsContent>
        <TabsContent value="my-requests">
          <MyRequestsTab refreshKey={refreshKey} />
        </TabsContent>
        <TabsContent value="holidays">
          <HolidaysTab canManage={canManageHolidays} />
        </TabsContent>

        <TabsContent value="approvals">
          <ApprovalsTab refreshKey={refreshKey} onDecided={bump} />
        </TabsContent>
        <TabsContent value="team-calendar">
          <TeamCalendarTab />
        </TabsContent>
        <TabsContent value="team-balances">
          <TeamBalancesTab />
        </TabsContent>

        {/* Built in later passes of this session — HR/Admin, Auditor. */}
        {(['all-requests', 'leave-types', 'balance-adjustments', 'ledger', 'settings'] as TabId[]).map(
          (id) => (
            <TabsContent key={id} value={id}>
              <Card>
                <EmptyState
                  icon={Construction}
                  title="Screen coming up in this build pass"
                  description="The role-by-role Leave screens are being added in order: Employee → Line Manager → HR / Company Admin → Auditor."
                />
              </Card>
            </TabsContent>
          ),
        )}
      </Tabs>

      <RequestDetailSheet request={detail} open={detailOpen} onOpenChange={setDetailOpen} />
    </div>
  );
}
