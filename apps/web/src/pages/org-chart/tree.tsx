import * as React from 'react';
import { ChevronDown, Crown } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Offsets } from '@/lib/org-layout';
import {
  fullName,
  gridColumns,
  hueVar,
  LEADERSHIP_ID,
  splitLeadership,
  teamLayout,
  type OrgNode,
} from './model';
import { DeptChip, PersonAvatar } from './person-bits';

export interface TreeHandlers {
  expanded: Set<string>;
  highlightId: string | null;
  /** null = no filter active; otherwise ids that match the active search/dept filter. */
  matchIds: Set<string> | null;
  selectedId: string | null;
  onToggle: (id: string) => void;
  onSelect: (node: OrgNode) => void;
  onFocusTeam: (node: OrgNode) => void;
  onHoverStart: (node: OrgNode, el: HTMLElement, immediate?: boolean) => void;
  onHoverEnd: () => void;
  /** Swallows the click that ends a canvas drag. */
  wasDragging: () => boolean;
  /** Where each dragged card sits relative to its automatic slot. */
  offsets: Offsets;
  /** A press on a card: may turn into dragging it (and its team). */
  onDragStart: (e: React.PointerEvent<HTMLElement>, node: OrgNode) => void;
}

const moveProps = (id: string, offsets: Offsets) => {
  const o = offsets[id];
  return {
    'data-org-move': id,
    'data-org-moved': o ? '' : undefined,
    style: o ? { transform: `translate(${o.x}px, ${o.y}px)` } : undefined,
  };
};

export function OrgTree({ roots, h }: { roots: OrgNode[]; h: TreeHandlers }) {
  const { leaders, others } = splitLeadership(roots);
  // Leadership always sits in its own row on top; everyone else hangs below it.
  if (leaders.length === 0 || others.length === 0) {
    return (
      <div className="org-tree inline-block">
        <TopRow roots={roots} h={h} />
      </div>
    );
  }
  return (
    <div className="org-tree inline-flex flex-col items-center">
      <TopRow roots={leaders} h={h} />
      <div
        data-org-card={LEADERSHIP_ID}
        className="mb-12 mt-5 inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1 text-xs font-medium text-muted-foreground shadow-sm"
      >
        <Crown className="h-3.5 w-3.5" /> Leadership
      </div>
      <TopRow roots={others} h={h} />
    </div>
  );
}

function TopRow({ roots, h }: { roots: OrgNode[]; h: TreeHandlers }) {
  return (
    <ul>
      {roots.map((n) => (
        <Branch key={n.id} node={n} h={h} />
      ))}
    </ul>
  );
}

function Branch({ node, h }: { node: OrgNode; h: TreeHandlers }) {
  const open = h.expanded.has(node.id) && node.directReports.length > 0;
  return (
    <li {...moveProps(node.id, h.offsets)}>
      <NodeCard node={node} h={h} open={open} />
      {open && <Team node={node} h={h} />}
    </li>
  );
}

/** A manager's open team: spread horizontally, or (nobody has reports) stacked in a dashed column. */
function Team({ node, h }: { node: OrgNode; h: TreeHandlers }) {
  if (teamLayout(node) === 'fan') {
    return (
      <ul>
        {node.directReports.map((r) => (
          <Branch key={r.id} node={r} h={h} />
        ))}
      </ul>
    );
  }
  const cols = gridColumns(node);
  // Round-robin, so the members read left-to-right, top-to-bottom like a grid.
  const columns = Array.from({ length: cols }, (_, c) => node.directReports.filter((_, i) => i % cols === c));
  return (
    <ul>
      <li>
        <div
          data-org-group={node.id}
          className="flex items-start gap-3 rounded-2xl border border-dashed border-border bg-muted/30 p-2.5"
        >
          {columns.map((column, i) => (
            <div key={i} className="flex shrink-0 flex-col gap-3">
              {column.map((r) => (
                <div key={r.id} {...moveProps(r.id, h.offsets)}>
                  <NodeCard node={r} h={h} open={false} compact />
                </div>
              ))}
            </div>
          ))}
        </div>
      </li>
    </ul>
  );
}

function NodeCard({
  node,
  h,
  open,
  compact = false,
}: {
  node: OrgNode;
  h: TreeHandlers;
  open: boolean;
  compact?: boolean;
}) {
  const ref = React.useRef<HTMLButtonElement>(null);
  const hue = hueVar(node.department?.id);
  const dimmed = h.matchIds !== null && !h.matchIds.has(node.id);
  const isHighlight = h.highlightId === node.id;
  const isSelected = h.selectedId === node.id;
  const hasReports = node.directReportCount > 0;

  return (
    <div
      data-org-card={node.id}
      className={cn('relative flex flex-col items-center', !compact && 'pb-3')}
    >
      <button
        ref={ref}
        type="button"
        data-org-node={node.id}
        onPointerDown={(e) => h.onDragStart(e, node)}
        onClick={() => {
          if (h.wasDragging()) return;
          h.onHoverEnd();
          h.onSelect(node);
        }}
        onDoubleClick={() => hasReports && h.onFocusTeam(node)}
        onMouseEnter={() => ref.current && h.onHoverStart(node, ref.current)}
        onMouseLeave={h.onHoverEnd}
        onFocus={() => ref.current && h.onHoverStart(node, ref.current, true)}
        onBlur={h.onHoverEnd}
        aria-label={`${fullName(node)}${node.designation ? `, ${node.designation}` : ''}`}
        className={cn(
          'group relative flex items-center gap-3 overflow-hidden rounded-xl border bg-card text-left shadow-sm transition-all duration-150',
          'hover:-translate-y-0.5 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          compact ? 'w-60 px-3 py-2' : 'w-64 px-3.5 pb-3 pt-4',
          isSelected ? 'border-primary' : 'border-border',
          isHighlight && 'org-pulse ring-2 ring-ring',
          dimmed && 'opacity-35 hover:opacity-100',
        )}
      >
        {!compact && (
          <span aria-hidden="true" className="absolute inset-x-0 top-0 h-1" style={{ background: hue }} />
        )}
        {compact && (
          <span aria-hidden="true" className="absolute inset-y-0 left-0 w-1" style={{ background: hue }} />
        )}
        <PersonAvatar person={node} size={compact ? 34 : 44} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold leading-tight">{fullName(node)}</p>
          <p className="truncate text-xs text-muted-foreground">
            {node.designation ?? 'No designation'}
          </p>
          {!compact && node.department && (
            <div className="mt-1.5">
              <DeptChip department={node.department} />
            </div>
          )}
        </div>
      </button>

      {hasReports && !compact && (
        <button
          type="button"
          onClick={() => !h.wasDragging() && h.onToggle(node.id)}
          aria-expanded={open}
          aria-label={`${open ? 'Collapse' : 'Expand'} ${fullName(node)}'s ${node.directReportCount} direct reports`}
          className={cn(
            'absolute bottom-0 left-1/2 z-10 inline-flex h-6 -translate-x-1/2 items-center gap-1 rounded-full border px-2 text-[11px] font-semibold shadow-sm transition-colors',
            open
              ? 'border-border bg-card text-muted-foreground hover:text-foreground'
              : 'border-primary bg-primary text-primary-foreground hover:opacity-90',
          )}
        >
          {node.directReportCount}
          <ChevronDown className={cn('h-3 w-3 transition-transform', open && 'rotate-180')} />
        </button>
      )}
    </div>
  );
}
