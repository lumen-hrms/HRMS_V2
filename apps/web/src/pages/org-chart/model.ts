/**
 * Org-chart data contract (`GET /employees/org-chart`, EmployeesService.orgChart)
 * plus the pure helpers the chart components share.
 */

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
