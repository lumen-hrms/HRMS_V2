import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { CalendarDays, ExternalLink, Hash, Mail, MapPin, Network, Phone } from 'lucide-react';
import { Sheet } from '@/components/ui/sheet';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  formatDate,
  fullName,
  STATE_BADGE_VARIANT,
  STATE_LABEL,
  tenure,
  type OrgIndex,
  type OrgNode,
} from './model';
import { ContactRow, DeptChip, PersonAvatar } from './person-bits';

/** Click-to-open quick view (module 03 §6.1 "Employee Quick View"). */
export function PersonSheet({
  node,
  index,
  onClose,
  onSelect,
  onShowTeam,
}: {
  node: OrgNode | null;
  index: OrgIndex;
  onClose: () => void;
  onSelect: (node: OrgNode) => void;
  onShowTeam: (node: OrgNode) => void;
}) {
  if (!node) return null;
  // The manager may sit outside the visible tree (a Line Manager's chart is
  // rooted at themselves) — then it's shown by name but isn't navigable.
  const manager = node.manager ? index.byId.get(node.manager.id) ?? null : null;
  const joined = formatDate(node.dateOfJoining);
  const since = tenure(node.dateOfJoining);

  return (
    <Sheet
      open
      onOpenChange={(o) => !o && onClose()}
      title="Employee quick view"
      footer={
        <div className="flex gap-2">
          {node.directReportCount > 0 && (
            <Button
              variant="outline"
              className="flex-1"
              onClick={() => {
                onShowTeam(node);
                onClose();
              }}
            >
              <Network className="h-4 w-4" /> Show team
            </Button>
          )}
          <Link
            to={`/employees/${node.id}`}
            className="inline-flex h-9 flex-1 items-center justify-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90"
          >
            Open full profile <ExternalLink className="h-4 w-4" />
          </Link>
        </div>
      }
    >
      <div className="flex flex-col gap-6">
        <div className="flex items-center gap-4">
          <PersonAvatar person={node} size={68} />
          <div className="min-w-0">
            <p className="truncate text-lg font-semibold leading-tight">{fullName(node)}</p>
            <p className="truncate text-sm text-muted-foreground">
              {node.designation ?? 'No designation'}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <DeptChip department={node.department} />
              <Badge variant={STATE_BADGE_VARIANT[node.lifecycleState] ?? 'outline'}>
                {STATE_LABEL[node.lifecycleState] ?? node.lifecycleState}
              </Badge>
            </div>
          </div>
        </div>

        {(node.workEmail || node.phone) && (
          <div className="grid grid-cols-2 gap-2">
            {node.workEmail && (
              <a
                href={`mailto:${node.workEmail}`}
                className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-border bg-card text-sm font-medium hover:bg-accent"
              >
                <Mail className="h-4 w-4" /> Email
              </a>
            )}
            {node.phone && (
              <a
                href={`tel:${node.phone.replace(/\s+/g, '')}`}
                className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-border bg-card text-sm font-medium hover:bg-accent"
              >
                <Phone className="h-4 w-4" /> Call
              </a>
            )}
          </div>
        )}

        <Section title="Contact">
          <ContactRow
            icon={Mail}
            label="Email"
            value={node.workEmail ?? <span className="text-muted-foreground">No work email</span>}
            href={node.workEmail ? `mailto:${node.workEmail}` : undefined}
            copyable={node.workEmail ?? undefined}
          />
          <ContactRow
            icon={Phone}
            label="Phone"
            value={node.phone ?? <span className="text-muted-foreground">No phone on file</span>}
            href={node.phone ? `tel:${node.phone.replace(/\s+/g, '')}` : undefined}
            copyable={node.phone ?? undefined}
          />
          {node.workLocation && <ContactRow icon={MapPin} label="Location" value={node.workLocation} />}
          <ContactRow icon={Hash} label="Employee code" value={node.employeeCode} copyable={node.employeeCode} />
          {joined && (
            <ContactRow
              icon={CalendarDays}
              label="Joined"
              value={
                <>
                  {joined}
                  {since && <span className="text-muted-foreground"> · {since}</span>}
                </>
              }
            />
          )}
        </Section>

        {node.manager && (
          <Section title="Reports to">
            {manager ? (
              <PersonRow person={manager} onClick={() => onSelect(manager)} />
            ) : (
              <p className="text-sm">
                {node.manager.firstName} {node.manager.lastName}
              </p>
            )}
          </Section>
        )}

        {node.directReports.length > 0 && (
          <Section
            title={`Direct reports · ${node.directReportCount}`}
            aside={
              node.totalReportCount > node.directReportCount
                ? `${node.totalReportCount} in org`
                : undefined
            }
          >
            <div className="flex flex-col gap-1">
              {node.directReports.map((r) => (
                <PersonRow key={r.id} person={r} onClick={() => onSelect(r)} />
              ))}
            </div>
          </Section>
        )}
      </div>
    </Sheet>
  );
}

function Section({
  title,
  aside,
  children,
}: {
  title: string;
  aside?: string;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2.5">
      <div className="flex items-baseline justify-between">
        <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          {title}
        </h3>
        {aside && <span className="text-xs text-muted-foreground">{aside}</span>}
      </div>
      {children}
    </section>
  );
}

function PersonRow({ person, onClick }: { person: OrgNode; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-3 rounded-lg p-1.5 text-left hover:bg-accent"
    >
      <PersonAvatar person={person} size={32} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{fullName(person)}</p>
        <p className="truncate text-xs text-muted-foreground">{person.designation ?? '—'}</p>
      </div>
      {person.directReportCount > 0 && (
        <span className="shrink-0 rounded-full bg-secondary px-2 py-0.5 text-[11px] font-medium text-secondary-foreground">
          {person.directReportCount}
        </span>
      )}
    </button>
  );
}
