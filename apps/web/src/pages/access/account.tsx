import { PageHeader } from '@/components/page-header';
import { USE_MOCK } from '@/lib/access/client';
import { MockDataNote } from './shared';
import { MyAccountTab } from './tabs/my-account';

/** `/account` — every authenticated persona's own identity view. */
export function AccountPage() {
  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="My account"
        description="Your identity in this workspace and your sign-in security."
        actions={USE_MOCK ? <MockDataNote /> : undefined}
      />
      <MyAccountTab />
    </div>
  );
}
