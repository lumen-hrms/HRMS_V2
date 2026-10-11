import * as React from 'react';
import { createPortal } from 'react-dom';
import { CalendarDays, Mail, MapPin, Network, Phone, UserRound, Users } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  formatDate,
  fullName,
  hueVar,
  STATE_BADGE_VARIANT,
  STATE_LABEL,
  tenure,
  type OrgNode,
} from './model';
import type { HoverTarget } from './use-hover-card';
import { ContactRow, DeptChip, PersonAvatar } from './person-bits';

const CARD_WIDTH = 320;
const GAP = 12;
const EDGE = 12;

export function PersonHoverCard({
  target,
  onMouseEnter,
  onMouseLeave,
  onOpenDetails,
  onShowTeam,
}: {
  target: HoverTarget | null;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
  onOpenDetails: (node: OrgNode) => void;
  onShowTeam: (node: OrgNode) => void;
}) {
  const ref = React.useRef<HTMLDivElement>(null);
  const [pos, setPos] = React.useState<{ left: number; top: number } | null>(null);

  React.useLayoutEffect(() => {
    if (!target || !ref.current) {
      setPos(null);
      return;
    }
    const a = target.anchor.getBoundingClientRect();
    const h = ref.current.offsetHeight;
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    let left = a.right + GAP;
    let top = a.top - 8;
    if (left + CARD_WIDTH > vw - EDGE) left = a.left - GAP - CARD_WIDTH;
    if (left < EDGE) {
      // No room on either side (narrow screen / zoomed in): drop below the node.
      left = Math.min(Math.max(a.left + a.width / 2 - CARD_WIDTH / 2, EDGE), vw - CARD_WIDTH - EDGE);
      top = a.bottom + GAP;
      if (top + h > vh - EDGE) top = a.top - GAP - h;
    }
    top = Math.min(Math.max(top, EDGE), Math.max(vh - h - EDGE, EDGE));
    setPos({ left, top });
  }, [target]);

  if (!target) return null;
  const { node } = target;
  const hue = hueVar(node.department?.id);
  const joined = formatDate(node.dateOfJoining);
  const since = tenure(node.dateOfJoining);
  const showState = node.lifecycleState !== 'CONFIRMED';

  return createPortal(
    <div
      ref={ref}
      role="dialog"
      aria-label={`${fullName(node)} contact card`}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      style={{
        width: CARD_WIDTH,
        left: pos?.left ?? -9999,
        top: pos?.top ?? -9999,
        visibility: pos ? 'visible' : 'hidden',
      }}
      className="org-pop fixed z-40 overflow-hidden rounded-xl border border-border bg-card text-card-foreground shadow-2xl"
    >
      <div
        className="h-14"
        style={{
          background: `linear-gradient(135deg, color-mix(in srgb, ${hue} 28%, var(--card)), color-mix(in srgb, ${hue} 8%, var(--card)))`,
        }}
      />
      <div className="-mt-8 px-4">
        <PersonAvatar person={node} size={60} className="ring-4" />
        <div className="mt-2 flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate text-base font-semibold leading-tight">{fullName(node)}</p>
            <p className="truncate text-sm text-muted-foreground">
              {node.designation ?? 'No designation'}
            </p>
          </div>
          {showState && (
            <Badge variant={STATE_BADGE_VARIANT[node.lifecycleState] ?? 'outline'} className="shrink-0">
              {STATE_LABEL[node.lifecycleState] ?? node.lifecycleState}
            </Badge>
          )}
        </div>
        <div className="mt-1.5 flex items-center gap-2">
          <DeptChip department={node.department} />
          <span className="text-[11px] text-muted-foreground">{node.employeeCode}</span>
        </div>
      </div>

      <div className="mt-3 flex flex-col gap-2 border-t border-border px-4 py-3">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          Contact
        </p>
        {node.workEmail ? (
          <ContactRow
            icon={Mail}
            label="Email"
            value={node.workEmail}
            href={`mailto:${node.workEmail}`}
            copyable={node.workEmail}
          />
        ) : (
          <ContactRow icon={Mail} label="Email" value={<span className="text-muted-foreground">No work email</span>} />
        )}
        {node.phone ? (
          <ContactRow
            icon={Phone}
            label="Phone"
            value={node.phone}
            href={`tel:${node.phone.replace(/\s+/g, '')}`}
            copyable={node.phone}
          />
        ) : (
          <ContactRow icon={Phone} label="Phone" value={<span className="text-muted-foreground">No phone on file</span>} />
        )}
        {node.workLocation && <ContactRow icon={MapPin} label="Location" value={node.workLocation} />}
      </div>

      <div className="flex flex-col gap-2 border-t border-border px-4 py-3">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          Organisation
        </p>
        {node.manager && (
          <ContactRow
            icon={UserRound}
            label="Reports to"
            value={
              <>
                <span className="text-muted-foreground">Reports to </span>
                {node.manager.firstName} {node.manager.lastName}
              </>
            }
          />
        )}
        {node.directReportCount > 0 && (
          <ContactRow
            icon={Users}
            label="Team"
            value={
              <>
                {node.directReportCount} direct
                {node.totalReportCount > node.directReportCount && (
                  <span className="text-muted-foreground"> · {node.totalReportCount} in org</span>
                )}
              </>
            }
          />
        )}
        {joined && (
          <ContactRow
            icon={CalendarDays}
            label="Joined"
            value={
              <>
                Joined {joined}
                {since && <span className="text-muted-foreground"> · {since}</span>}
              </>
            }
          />
        )}
      </div>

      <div className="flex gap-2 border-t border-border bg-muted/40 px-4 py-3">
        {node.workEmail && (
          <a
            href={`mailto:${node.workEmail}`}
            className="inline-flex h-8 flex-1 items-center justify-center gap-1.5 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground hover:opacity-90"
          >
            <Mail className="h-3.5 w-3.5" /> Email
          </a>
        )}
        {node.phone && (
          <a
            href={`tel:${node.phone.replace(/\s+/g, '')}`}
            className="inline-flex h-8 flex-1 items-center justify-center gap-1.5 rounded-md border border-border bg-card px-3 text-xs font-medium hover:bg-accent"
          >
            <Phone className="h-3.5 w-3.5" /> Call
          </a>
        )}
        {node.directReportCount > 0 && (
          <Button size="sm" variant="outline" className="flex-1" onClick={() => onShowTeam(node)}>
            <Network className="h-3.5 w-3.5" /> Team
          </Button>
        )}
        <Button size="sm" variant="ghost" className="flex-1" onClick={() => onOpenDetails(node)}>
          Details
        </Button>
      </div>
    </div>,
    document.body,
  );
}
