import * as React from 'react';
import { PageHeader } from '@/components/page-header';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { useAuth } from '@/context/auth-context';
import { isPayrollAdmin, isAuditor, type Role } from '@/lib/roles';
import { MyPayTab } from './tabs/my-pay';
import { StructuresTab } from './tabs/structures';
import { RunTab } from './tabs/run';
import { SettingsTab } from './tabs/settings';

type TabId = 'my-pay' | 'structures' | 'run' | 'settings';

interface TabDef {
  id: TabId;
  label: string;
  show: (u: { role: Role } | null) => boolean;
}

const TAB_DEFS: TabDef[] = [
  { id: 'my-pay', label: 'My Pay', show: (u) => u?.role === 'EMPLOYEE' },
  { id: 'structures', label: 'Structures', show: (u) => isPayrollAdmin(u) || isAuditor(u) },
  { id: 'run', label: 'Payroll Run', show: (u) => isPayrollAdmin(u) || isAuditor(u) },
  { id: 'settings', label: 'Settings', show: (u) => isPayrollAdmin(u) || isAuditor(u) },
];

export function PayrollPage() {
  const { user } = useAuth();
  const tabs = TAB_DEFS.filter((t) => t.show(user));
  const [active, setActive] = React.useState<TabId>(tabs[0]?.id ?? 'my-pay');

  React.useEffect(() => {
    if (!tabs.some((t) => t.id === active) && tabs[0]) setActive(tabs[0].id);
  }, [tabs, active]);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Payroll"
        description="Salary structures, statutory config, the monthly run, and your own pay."
      />

      <Tabs value={active} onValueChange={(v) => setActive(v as TabId)}>
        <TabsList>
          {tabs.map((t) => (
            <TabsTrigger key={t.id} value={t.id}>
              {t.label}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="my-pay">
          <MyPayTab />
        </TabsContent>
        <TabsContent value="structures">
          <StructuresTab />
        </TabsContent>
        <TabsContent value="run">
          <RunTab />
        </TabsContent>
        <TabsContent value="settings">
          <SettingsTab readOnly={isAuditor(user)} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
