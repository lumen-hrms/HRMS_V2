import * as React from 'react';
import { ArrowUp, ChevronRight, Info } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { focusState, fullName, hueVar, type OrgIndex, type OrgNode } from './model';
import { DeptChip, PersonAvatar } from './person-bits';

/**
 * Touch-first alternatives to the pannable canvas, for narrow screens (and
 * anyone who prefers a list). Both read the same tree as the canvas:
 *
 *  - FocusView   - one person at a time: who they report to, who reports to
 *                  them. Tap a manager to drill down, the trail to climb back.
 *  - OutlineView - an indented, collapsible tree for scanning a whole team.
 */

interface CommonProps {
  index: OrgIndex;
  /** null = no filter active; otherwise the ids that match the department filter. */
  matchIds: Set<string> | null;
  highlightId: string | null;
  onSelect: (node: OrgNode) => void;
}

/** Scrolls the row for a freshly revealed (search-picked) person into view. */
function useScrollToHighlight(highlightId: string | null) {
  React.useEffect(() => {
    if (!highlightId) return;
    document
      .querySelector(`[data-org-row="${CSS.escape(highlightId)}"]`)
      ?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [highlightId]);
}

// ---------------------------------------------------------------- Focus view

export function FocusView({
  index,
  roots,
  focusId,
  rootLabel,
  onFocus,
  matchIds,
  highlightId,
  onSelect,
}: CommonProps & {
  roots: OrgNode[];
  focusId: string | null;
  /** Label for the top of the trail: "Whole company" / "My chart". */
  rootLabel: string;
  onFocus: (id: string | null) => void;
}) {
  const { node, parent, trail, items } = focusState(index, roots, focusId);
  useScrollToHighlight(highlightId);

  const trailRef = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    const el = trailRef.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, [focusId]);

  return (
    <div className="flex flex-col gap-3">
      <div
        ref={trailRef}
        className="-mx-1 flex items-center gap-0.5 overflow-x-auto px-1 pb-1 text-sm [scrollbar-width:none]"
        aria-label="Reporting trail"
      >
        <TrailChip current={!node} onClick={() => onFocus(null)}>
          {rootLabel}
        </TrailChip>
        {trail.map((n, i) => (
          <React.Fragment key={n.id}>
            <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
            <TrailChip current={i === trail.length - 1} onClick={() => onFocus(n.id)}>
              {fullName(n)}
            </TrailChip>
          </React.Fragment>
        ))}
      </div>

      {node && (
        <section className="rounded-xl border border-border bg-card p-4 shadow-sm">
          <div className="flex items-center gap-3">
            <PersonAvatar person={node} size={56} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-base font-semibold leading-tight">{fullName(node)}</p>
              <p className="truncate text-sm text-muted-foreground">{node.designation ?? 'No designation'}</p>
              {node.department && (
                <div className="mt-1.5">
                  <DeptChip department={node.department} />
                </div>
              )}
            </div>
          </div>
          <div className="mt-3 flex items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground">
              {node.directReportCount} direct
              {node.totalReportCount > node.directReportCount && ` · ${node.totalReportCount} in total`}
            </p>
            <Button size="sm" variant="outline" onClick={() => onSelect(node)}>
              <Info className="h-3.5 w-3.5" /> Details
            </Button>
          </div>
          {parent && (
            <button
              type="button"
              onClick={() => onFocus(parent.id)}
              className="mt-3 flex min-h-11 w-full items-center gap-2 rounded-xl border border-dashed border-border px-3 text-left text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <ArrowUp className="h-4 w-4 shrink-0" />
              <span className="min-w-0 truncate">
                Reports to <span className="font-medium text-foreground">{fullName(parent)}</span>
              </span>
            </button>
          )}
        </section>
      )}

      <h2 className="px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {node ? 'Direct reports' : 'Top level'} · {items.length}
      </h2>
      {items.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
          No direct reports.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {items.map((n) => (
            <FocusRow
              key={n.id}
              node={n}
              dimmed={matchIds !== null && !matchIds.has(n.id)}
              highlighted={highlightId === n.id}
              onOpen={() => (n.directReportCount > 0 ? onFocus(n.id) : onSelect(n))}
              onDetails={() => onSelect(n)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function TrailChip({
  current,
  onClick,
  children,
}: {
  current: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={current ? 'page' : undefined}
      className={cn(
        'min-h-9 shrink-0 rounded-xl px-2.5 text-sm transition-colors',
        current ? 'font-semibold text-foreground' : 'font-medium text-primary hover:bg-accent',
      )}
    >
      {children}
    </button>
  );
}

function FocusRow({
  node,
  dimmed,
  highlighted,
  onOpen,
  onDetails,
}: {
  node: OrgNode;
  dimmed: boolean;
  highlighted: boolean;
  onOpen: () => void;
  onDetails: () => void;
}) {
  const manager = node.directReportCount > 0;
  return (
    <li
      data-org-row={node.id}
      className={cn(
        'relative flex items-stretch overflow-hidden rounded-xl border border-border bg-card shadow-sm',
        highlighted && 'org-pulse ring-2 ring-ring',
        dimmed && 'opacity-40',
      )}
    >
      <span aria-hidden="true" className="w-1 shrink-0" style={{ background: hueVar(node.department?.id) }} />
      <button
        type="button"
        onClick={onOpen}
        aria-label={
          manager
            ? `${fullName(node)}, ${node.directReportCount} direct reports. Open team`
            : `${fullName(node)}. Open details`
        }
        className="flex min-h-14 min-w-0 flex-1 items-center gap-3 px-3 py-2 text-left transition-colors hover:bg-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      >
        <PersonAvatar person={node} size={40} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold">{fullName(node)}</span>
          <span className="block truncate text-xs text-muted-foreground">{node.designation ?? 'No designation'}</span>
        </span>
        {manager && (
          <span className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-primary px-2 py-0.5 text-[11px] font-semibold text-primary-foreground">
            {node.directReportCount}
            <ChevronRight className="h-3 w-3" />
          </span>
        )}
      </button>
      {manager && (
        <button
          type="button"
          onClick={onDetails}
          aria-label={`${fullName(node)} details`}
          className="flex w-11 shrink-0 items-center justify-center border-l border-border text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        >
          <Info className="h-4 w-4" />
        </button>
      )}
    </li>
  );
}

// -------------------------------------------------------------- Outline view

export function OutlineView({
  roots,
  expanded,
  onToggle,
  matchIds,
  highlightId,
  onSelect,
}: CommonProps & {
  roots: OrgNode[];
  expanded: Set<string>;
  onToggle: (id: string) => void;
}) {
  useScrollToHighlight(highlightId);
  return (
    <ul className="flex flex-col" role="tree">
      {roots.map((n) => (
        <OutlineItem
          key={n.id}
          node={n}
          expanded={expanded}
          onToggle={onToggle}
          matchIds={matchIds}
          highlightId={highlightId}
          onSelect={onSelect}
        />
      ))}
    </ul>
  );
}

function OutlineItem({
  node,
  expanded,
  onToggle,
  matchIds,
  highlightId,
  onSelect,
}: {
  node: OrgNode;
  expanded: Set<string>;
  onToggle: (id: string) => void;
  matchIds: Set<string> | null;
  highlightId: string | null;
  onSelect: (node: OrgNode) => void;
}) {
  const hasReports = node.directReports.length > 0;
  const open = hasReports && expanded.has(node.id);
  const dimmed = matchIds !== null && !matchIds.has(node.id);
  return (
    <li role="treeitem" aria-expanded={hasReports ? open : undefined} aria-selected={false}>
      <div
        data-org-row={node.id}
        className={cn(
          'flex items-center rounded-xl [contain-intrinsic-size:auto_52px] [content-visibility:auto]',
          highlightId === node.id && 'org-pulse ring-2 ring-ring',
          dimmed && 'opacity-40',
        )}
      >
        {hasReports ? (
          <button
            type="button"
            onClick={() => onToggle(node.id)}
            aria-label={`${open ? 'Collapse' : 'Expand'} ${fullName(node)}'s team`}
            className="flex h-11 w-9 shrink-0 items-center justify-center rounded-xl text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <ChevronRight className={cn('h-4 w-4 transition-transform', open && 'rotate-90')} />
          </button>
        ) : (
          <span className="w-9 shrink-0" aria-hidden="true" />
        )}
        <button
          type="button"
          onClick={() => onSelect(node)}
          className="flex min-h-11 min-w-0 flex-1 items-center gap-2.5 rounded-xl py-1 pl-1 pr-2 text-left transition-colors hover:bg-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <PersonAvatar person={node} size={32} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium">{fullName(node)}</span>
            <span className="block truncate text-xs text-muted-foreground">{node.designation ?? 'No designation'}</span>
          </span>
          {hasReports && (
            <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">
              {node.directReportCount}
            </span>
          )}
        </button>
      </div>
      {open && (
        <ul role="group" className="ml-[1.125rem] border-l border-border pl-1.5">
          {node.directReports.map((r) => (
            <OutlineItem
              key={r.id}
              node={r}
              expanded={expanded}
              onToggle={onToggle}
              matchIds={matchIds}
              highlightId={highlightId}
              onSelect={onSelect}
            />
          ))}
        </ul>
      )}
    </li>
  );
}
