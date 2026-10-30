import * as React from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { fullName, hueVar, type OrgNode } from './model';
import { DeptChip, PersonAvatar } from './person-bits';

/**
 * A team whose members are all individual contributors (no reports of their
 * own) is stacked into a compact column under the manager instead of fanned
 * out horizontally (Teams does the same) — keeps the chart roughly one card
 * wide per manager, so a 12-nurse ward doesn't become a 3,000px strip.
 */
const STACK_LEAVES_FROM = 2;

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
}

export function OrgTree({ roots, h }: { roots: OrgNode[]; h: TreeHandlers }) {
  return (
    <div className="org-tree inline-block">
      <ul>
        {roots.map((n) => (
          <Branch key={n.id} node={n} h={h} />
        ))}
      </ul>
    </div>
  );
}

function Branch({ node, h }: { node: OrgNode; h: TreeHandlers }) {
  const open = h.expanded.has(node.id) && node.directReports.length > 0;
  const allLeaves = node.directReports.every((r) => r.directReports.length === 0);
  const stack = open && allLeaves && node.directReports.length >= STACK_LEAVES_FROM;

  return (
    <li>
      <NodeCard node={node} h={h} open={open} />
      {open &&
        (stack ? (
          <ul>
            <li>
              <div
                className={cn(
                  'grid gap-2 rounded-2xl border border-dashed border-border bg-muted/30 p-2.5',
                  // Fixed tracks = the compact card width (w-60), so columns can't squeeze into each other.
                  node.directReports.length > 6 ? 'grid-cols-[repeat(2,15rem)]' : 'grid-cols-[15rem]',
                )}
              >
                {node.directReports.map((r) => (
                  <NodeCard key={r.id} node={r} h={h} open={false} compact />
                ))}
              </div>
            </li>
          </ul>
        ) : (
          <ul>
            {node.directReports.map((r) => (
              <Branch key={r.id} node={r} h={h} />
            ))}
          </ul>
        ))}
    </li>
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
    <div className={cn('relative flex flex-col items-center', !compact && 'pb-3')}>
      <button
        ref={ref}
        type="button"
        data-org-node={node.id}
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
