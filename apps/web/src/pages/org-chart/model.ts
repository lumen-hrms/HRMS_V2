/**
 * Org-chart data contract (`GET /employees/org-chart`, EmployeesService.orgChart)
 * plus the pure helpers the chart components share.
 */

import type { Offsets } from '@/lib/org-layout';

export interface OrgNode {
  id: string;
  employeeCode: string;
  firstName: string;
  lastName: string;
  designation: string | null;
  photoUrl: string | null;
  phone: string | null;
  workEmail: string | null;
  workLocation: string | null;
  lifecycleState: string;
  dateOfJoining: string | null;
  department: { id: string; name: string } | null;
  manager: { id: string; firstName: string; lastName: string } | null;
  directReportCount: number;
  totalReportCount: number;
  directReports: OrgNode[];
}

export interface OrgIndex {
  byId: Map<string, OrgNode>;
  parentOf: Map<string, string>;
  depthOf: Map<string, number>;
  all: OrgNode[];
}

export function indexTree(roots: OrgNode[]): OrgIndex {
  const byId = new Map<string, OrgNode>();
  const parentOf = new Map<string, string>();
  const depthOf = new Map<string, number>();
  const all: OrgNode[] = [];
  const walk = (node: OrgNode, depth: number) => {
    byId.set(node.id, node);
    depthOf.set(node.id, depth);
    all.push(node);
    for (const child of node.directReports) {
      parentOf.set(child.id, node.id);
      walk(child, depth + 1);
    }
  };
  roots.forEach((r) => walk(r, 0));
  return { byId, parentOf, depthOf, all };
}

/** Ancestors of `id`, top-down, not including `id` itself. */
export function ancestorsOf(index: OrgIndex, id: string): OrgNode[] {
  const path: OrgNode[] = [];
  let cur = index.parentOf.get(id);
  while (cur) {
    path.unshift(index.byId.get(cur)!);
    cur = index.parentOf.get(cur);
  }
  return path;
}

export function fullName(p: { firstName: string; lastName: string }) {
  return `${p.firstName} ${p.lastName}`.trim();
}

export function initials(p: { firstName: string; lastName: string }) {
  return `${p.firstName[0] ?? ''}${p.lastName[0] ?? ''}`.toUpperCase() || '—';
}

const HUE_COUNT = 8;

/** Stable department → accent hue (`--org-hue-N` in index.css). */
export function hueVar(key: string | null | undefined) {
  if (!key) return 'var(--muted-foreground)';
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return `var(--org-hue-${h % HUE_COUNT})`;
}

/** "2 yrs 3 mos" since joining; null when no/future date. */
export function tenure(dateOfJoining: string | null, now = new Date()): string | null {
  if (!dateOfJoining) return null;
  const start = new Date(dateOfJoining);
  let months =
    (now.getFullYear() - start.getFullYear()) * 12 + (now.getMonth() - start.getMonth());
  if (now.getDate() < start.getDate()) months -= 1;
  if (months < 0) return null;
  if (months === 0) return 'Joined this month';
  const y = Math.floor(months / 12);
  const m = months % 12;
  const parts = [];
  if (y) parts.push(`${y} yr${y > 1 ? 's' : ''}`);
  if (m) parts.push(`${m} mo${m > 1 ? 's' : ''}`);
  return parts.join(' ');
}

export function formatDate(iso: string | null) {
  if (!iso) return null;
  return new Date(iso).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'Asia/Kolkata',
  });
}

export const STATE_LABEL: Record<string, string> = {
  PRE_JOINING: 'Pre-joining',
  PROBATION: 'Probation',
  CONFIRMED: 'Confirmed',
  NOTICE_PERIOD: 'Notice period',
  SUSPENDED: 'Suspended',
};

export const STATE_BADGE_VARIANT: Record<string, 'success' | 'warning' | 'destructive' | 'outline'> = {
  PRE_JOINING: 'outline',
  PROBATION: 'warning',
  CONFIRMED: 'success',
  NOTICE_PERIOD: 'warning',
  SUSPENDED: 'destructive',
};

export function matchesQuery(node: OrgNode, q: string) {
  const needle = q.trim().toLowerCase();
  if (!needle) return false;
  return [fullName(node), node.designation, node.employeeCode, node.workEmail, node.department?.name]
    .filter(Boolean)
    .some((s) => s!.toLowerCase().includes(needle));
}

/**
 * How a manager's team is drawn — one rule. If anyone in the team has reports
 * of their own, the whole team spans horizontally (the classic tree). A team
 * where nobody has reports is stacked in a compact dashed column instead, so a
 * big all-individual-contributor team doesn't become a strip thousands of pixels
 * wide. Nobody is special-cased: it only depends on who reports to the manager.
 */
const STACK_MIN = 2;

export function teamLayout(node: OrgNode): 'grid' | 'fan' {
  const allLeaves = node.directReports.every((r) => r.directReports.length === 0);
  return node.directReports.length >= STACK_MIN && allLeaves ? 'grid' : 'fan';
}

/** Columns for a stacked team: roughly six rows tall per column, never more than four wide. */
export function gridColumns(node: OrgNode): number {
  const n = node.directReports.length;
  const cols = n <= 6 ? 1 : n <= 12 ? 2 : n <= 24 ? 3 : 4;
  return Math.max(1, Math.min(cols, n));
}

/**
 * Leadership — the Board Members department, C-suite titles (a "Chief … Officer"
 * or CEO/CFO/CTO…), founders, owners, chairs, managing directors, presidents —
 * is pinned to a row at the very top of the chart. Matched on the designation
 * (there is no "is leadership" field); the patterns avoid look-alikes such as
 * "Chief Mechanic", "Product Owner" and "Vice President".
 */
const LEADERSHIP_TITLE =
  /\b(ceo|cfo|cto|coo|cio|cmo|cxo|chro|cpo|cso|founder|co-?founder|chair(man|woman|person)?|managing director)\b|\bchief\b.*\bofficer\b|^\s*(co-?)?owner\b|\b(business|company)\s+owner\b|(?<!vice[ -])\bpresident\b/i;

export function isLeadership(node: OrgNode) {
  return (
    /^board members?$/i.test(node.department?.name.trim() ?? '') ||
    LEADERSHIP_TITLE.test(node.designation ?? '')
  );
}

/** Id of the "Leadership" label that the other top-level people hang from. */
export const LEADERSHIP_ID = '__leadership';

/** Top-level people split into the leadership row and everyone else (each keeps its order). */
export function splitLeadership(roots: OrgNode[]) {
  return {
    leaders: roots.filter(isLeadership),
    others: roots.filter((r) => !isLeadership(r)),
  };
}

/**
 * A fingerprint of everything that decides where cards sit automatically: who
 * reports to whom, how each team is drawn (fan / grid and its columns) and who
 * is leadership. Saved drag offsets are only valid against the same signature.
 */
export function layoutSignature(roots: OrgNode[]): string {
  const parts: string[] = [];
  const walk = (n: OrgNode, parent: string) => {
    const layout = n.directReports.length ? `${teamLayout(n)}${gridColumns(n)}` : '';
    parts.push(`${n.id}>${parent}:${layout}${isLeadership(n) ? 'L' : ''}`);
    n.directReports.forEach((r) => walk(r, n.id));
  };
  roots.forEach((r) => walk(r, ''));
  // djb2 — a short stable string is enough; this is not security.
  let h = 5381;
  for (const ch of parts.join('|')) h = ((h << 5) + h + ch.charCodeAt(0)) >>> 0;
  return `${parts.length}.${h.toString(36)}`;
}

export interface OrgEdge {
  from: string;
  /** A card id, or (kind 'group') the manager whose team-grid box it is. */
  to: string;
  kind: 'card' | 'group';
  /** Not a reporting line (the leadership row over the other top-level people). */
  dashed?: boolean;
}

/** Every connector line currently on screen, in the same shape the tree renders. */
export function visibleEdges(roots: OrgNode[], expanded: Set<string>, offsets: Offsets): OrgEdge[] {
  const out: OrgEdge[] = [];
  const walk = (n: OrgNode) => {
    if (!expanded.has(n.id) || n.directReports.length === 0) return;
    if (teamLayout(n) === 'grid') {
      out.push({ from: n.id, to: n.id, kind: 'group' });
      // A stacked member dragged out of the box gets its own line from the manager.
      for (const r of n.directReports) if (offsets[r.id]) out.push({ from: n.id, to: r.id, kind: 'card' });
      return;
    }
    for (const r of n.directReports) {
      out.push({ from: n.id, to: r.id, kind: 'card' });
      walk(r);
    }
  };
  const { leaders, others } = splitLeadership(roots);
  if (leaders.length > 0 && others.length > 0) {
    for (const r of others) out.push({ from: LEADERSHIP_ID, to: r.id, kind: 'card', dashed: true });
  }
  roots.forEach(walk);
  return out;
}
