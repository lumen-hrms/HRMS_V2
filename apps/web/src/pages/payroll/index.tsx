import { useSearchParams } from 'react-router-dom';
import { PageHeader } from '@/components/page-header';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { useAuth } from '@/context/auth-context';
import { isPayrollAdmin, isAuditor, type Role } from '@/lib/roles';
import { OverviewTab } from './tabs/overview';
import { RunsTab } from './tabs/runs';
import { PeopleTab } from './tabs/people';
import { SettingsTab } from './tabs/settings';
import { MyPayTab } from './tabs/my-pay';

type TabId = 'overview' | 'runs' | 'people' | 'settings' | 'my-pay';

interface TabDef {
  id: TabId;
  label: string;
  show: (u: { role: Role } | null) => boolean;
}

const TAB_DEFS: TabDef[] = [
  { id: 'my-pay', label: 'My Pay', show: (u) => u?.role === 'EMPLOYEE' },
  { id: 'overview', label: 'Overview', show: (u) => isPayrollAdmin(u) || isAuditor(u) },
  { id: 'runs', label: 'Runs', show: (u) => isPayrollAdmin(u) || isAuditor(u) },
  // Auditors get no per-employee compensation (module 07 §12 decision 9), so no People & Pay.
  { id: 'people', label: 'People & Pay', show: (u) => isPayrollAdmin(u) },
  { id: 'settings', label: 'Settings', show: (u) => isPayrollAdmin(u) || isAuditor(u) },
];

export function PayrollPage() {
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const tabs = TAB_DEFS.filter((t) => t.show(user));
  // The URL carries the tab (and an open run), so a run can be shared with the second approver.
  const requested = params.get('tab') as TabId | null;
  const active: TabId = tabs.find((t) => t.id === requested)?.id ?? tabs[0]?.id ?? 'my-pay';

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Payroll"
        description="Run the month, review the numbers, and keep salaries and statutory settings in order."
      />

      <Tabs value={active} onValueChange={(v) => setParams({ tab: v })}>
        <TabsList>
          {tabs.map((t) => (
            <TabsTrigger key={t.id} value={t.id}>
              {t.label}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="overview">
          <OverviewTab />
        </TabsContent>
        <TabsContent value="runs">
          <RunsTab />
        </TabsContent>
        <TabsContent value="people">
          <PeopleTab />
        </TabsContent>
        <TabsContent value="settings">
          <SettingsTab readOnly={isAuditor(user)} />
        </TabsContent>
        <TabsContent value="my-pay">
          <MyPayTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
