import * as React from 'react';
import { Inbox, Mail, Phone } from 'lucide-react';
import { PageHeader } from '@/components/page-header';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty-state';
import { Sheet } from '@/components/ui/sheet';
import { platformApi } from '@/lib/platform-api';
import type { ContactLead } from './lib/types';
import { fmtDateTime } from './lib/format';

/** Platform Admin › Leads — the landing page's "Contact us" form submissions
 *  (`platform.contact_submissions`, `GET /api/platform-admin/leads`). Each
 *  submission also fires a best-effort notification email to whoever's
 *  configured on the Settings screen; this list is the durable record even
 *  when that email never arrives. */
export function LeadsPage() {
  const [rows, setRows] = React.useState<ContactLead[] | null>(null);
  const [notWired, setNotWired] = React.useState(false);
  const [q, setQ] = React.useState('');
  const [selected, setSelected] = React.useState<ContactLead | null>(null);

  React.useEffect(() => {
    platformApi
      .listLeads()
      .then(setRows)
      .catch(() => {
        setRows([]);
        setNotWired(true);
      });
  }, []);

  const filtered = React.useMemo(() => {
    if (!rows) return null;
    const query = q.trim().toLowerCase();
    if (!query) return rows;
    return rows.filter((r) =>
      [r.name, r.email, r.company ?? '', r.message].some((v) => v.toLowerCase().includes(query)),
    );
  }, [rows, q]);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Leads"
        description="Submissions from the landing page's contact form."
      />

      <Card className="flex items-center gap-3 p-3">
        <Input
          className="h-8 max-w-sm"
          placeholder="Search name, email, company or message…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </Card>

      <Card className="overflow-hidden">
        {filtered == null ? (
          <div className="p-4">
            <Skeleton className="h-40 w-full" />
          </div>
        ) : notWired ? (
          <EmptyState
            icon={Inbox}
            title="Couldn't load leads"
            description="The request to GET /api/platform-admin/leads failed. Check the API is reachable and try again."
          />
        ) : filtered.length === 0 ? (
          <EmptyState icon={Inbox} title="No leads yet" description="Submissions from the contact form will show up here." />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>When</TH>
                <TH>Name</TH>
                <TH>Email</TH>
                <TH>Company</TH>
                <TH>Message</TH>
              </TR>
            </THead>
            <TBody>
              {filtered.map((r) => (
                <TR key={r.id} className="cursor-pointer" onClick={() => setSelected(r)}>
                  <TD className="whitespace-nowrap text-muted-foreground">{fmtDateTime(r.at)}</TD>
                  <TD className="font-medium">{r.name}</TD>
                  <TD>{r.email}</TD>
                  <TD>{r.company ?? '—'}</TD>
                  <TD className="max-w-sm truncate text-muted-foreground">{r.message}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Card>

      {filtered != null && filtered.length > 0 && (
        <p className="text-xs text-muted-foreground">
          {filtered.length} lead{filtered.length === 1 ? '' : 's'}
        </p>
      )}

      <Sheet
        open={selected != null}
        onOpenChange={(open) => !open && setSelected(null)}
        title={selected?.name ?? ''}
        description={selected ? fmtDateTime(selected.at) : undefined}
      >
        {selected && (
          <div className="flex flex-col gap-4 p-5 text-sm">
            <div className="flex items-center gap-2 text-muted-foreground">
              <Mail className="h-4 w-4" />
              <a href={`mailto:${selected.email}`} className="text-foreground hover:underline">
                {selected.email}
              </a>
            </div>
            {selected.phone && (
              <div className="flex items-center gap-2 text-muted-foreground">
                <Phone className="h-4 w-4" />
                <span className="text-foreground">{selected.phone}</span>
              </div>
            )}
            {selected.company && (
              <div>
                <div className="text-xs uppercase tracking-wide text-muted-foreground">Company</div>
                <div className="mt-1">{selected.company}</div>
              </div>
            )}
            <div>
              <div className="text-xs uppercase tracking-wide text-muted-foreground">Message</div>
              <p className="mt-1 whitespace-pre-wrap leading-relaxed">{selected.message}</p>
            </div>
          </div>
        )}
      </Sheet>
    </div>
  );
}
