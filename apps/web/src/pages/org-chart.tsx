import * as React from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight, Minus, Plus, Search, X } from 'lucide-react';
import { api } from '@/lib/api';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Sheet } from '@/components/ui/sheet';

interface Node {
  id: string;
  firstName: string;
  lastName: string;
  designation: string | null;
  directReports: Node[];
}

function fullName(n: Node) {
  return `${n.firstName} ${n.lastName}`;
}

/** Every node id that either matches `query` or has a descendant that does. */
function collectMatchIds(nodes: Node[], query: string, into: Set<string>): boolean {
  let anyMatch = false;
  for (const n of nodes) {
    const selfMatch =
      fullName(n).toLowerCase().includes(query) ||
      (n.designation ?? '').toLowerCase().includes(query);
    const childMatch = collectMatchIds(n.directReports, query, into);
    if (selfMatch || childMatch) {
      into.add(n.id);
      anyMatch = true;
    }
  }
  return anyMatch;
}

export function OrgChartPage() {
  const [roots, setRoots] = React.useState<Node[]>([]);
  const [loaded, setLoaded] = React.useState(false);
  const [query, setQuery] = React.useState('');
  const [collapsed, setCollapsed] = React.useState<Set<string>>(new Set());
  const [zoom, setZoom] = React.useState(1);
  const [selected, setSelected] = React.useState<Node | null>(null);

  React.useEffect(() => {
    api
      .get<Node[]>('/employees/org-chart')
      .then(setRoots)
      .finally(() => setLoaded(true));
  }, []);

  const q = query.trim().toLowerCase();
  const matchIds = React.useMemo(() => {
    if (!q) return null;
    const into = new Set<string>();
    collectMatchIds(roots, q, into);
    return into;
  }, [roots, q]);

  function toggle(id: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Org chart</h1>
          <p className="text-sm text-muted-foreground">Reporting hierarchy across the company.</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search name or title…"
              className="w-56 pl-8"
            />
            {query && (
              <button
                onClick={() => setQuery('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                aria-label="Clear search"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          <Button size="sm" variant="outline" onClick={() => setCollapsed(new Set())}>
            Expand all
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              const all = new Set<string>();
              const walk = (nodes: Node[]) =>
                nodes.forEach((n) => {
                  if (n.directReports.length) all.add(n.id);
                  walk(n.directReports);
                });
              walk(roots);
              setCollapsed(all);
            }}
          >
            Collapse all
          </Button>
          <div className="flex items-center gap-1 rounded-md border border-border px-1.5 py-1">
            <button
              onClick={() => setZoom((z) => Math.max(0.6, +(z - 0.1).toFixed(1)))}
              className="p-0.5 text-muted-foreground hover:text-foreground"
              aria-label="Zoom out"
            >
              <Minus className="h-3.5 w-3.5" />
            </button>
            <span className="w-9 text-center text-xs tabular-nums text-muted-foreground">
              {Math.round(zoom * 100)}%
            </span>
            <button
              onClick={() => setZoom((z) => Math.min(1.6, +(z + 0.1).toFixed(1)))}
              className="p-0.5 text-muted-foreground hover:text-foreground"
              aria-label="Zoom in"
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </div>

      <Card className="overflow-auto p-5">
        {loaded && roots.length === 0 ? (
          <p className="text-sm text-muted-foreground">No reporting hierarchy to show yet.</p>
        ) : (
          <ul
            className="flex flex-col gap-1"
            style={{ transform: `scale(${zoom})`, transformOrigin: 'top left' }}
          >
            {roots.map((n) => (
              <TreeNode
                key={n.id}
                node={n}
                depth={0}
                collapsed={collapsed}
                onToggle={toggle}
                matchIds={matchIds}
                onSelect={setSelected}
              />
            ))}
          </ul>
        )}
      </Card>

      <Sheet
        open={selected != null}
        onOpenChange={(v) => !v && setSelected(null)}
        title={selected ? fullName(selected) : ''}
        description={selected?.designation ?? undefined}
      >
        {selected && (
          <div className="flex flex-col gap-4 text-sm">
            <div>
              <p className="text-xs text-muted-foreground">Direct reports</p>
              <p className="mt-0.5 font-medium">{selected.directReports.length}</p>
            </div>
            {selected.directReports.length > 0 && (
              <div>
                <p className="text-xs text-muted-foreground">Reports to this person</p>
                <ul className="mt-1 flex flex-col gap-1">
                  {selected.directReports.map((r) => (
                    <li key={r.id} className="text-muted-foreground">
                      • {fullName(r)}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <Link to={`/employees/${selected.id}`}>
              <Button size="sm" className="w-full">
                View full profile
              </Button>
            </Link>
          </div>
        )}
      </Sheet>
    </div>
  );
}

function TreeNode({
  node,
  depth,
  collapsed,
  onToggle,
  matchIds,
  onSelect,
}: {
  node: Node;
  depth: number;
  collapsed: Set<string>;
  onToggle: (id: string) => void;
  matchIds: Set<string> | null;
  onSelect: (n: Node) => void;
}) {
  if (matchIds && !matchIds.has(node.id)) return null;

  const hasChildren = node.directReports.length > 0;
  // A search auto-expands any ancestor of a match; otherwise respect the
  // manual collapsed set.
  const isOpen = matchIds ? true : !collapsed.has(node.id);
  const isSelfMatch = matchIds ? matchIds.has(node.id) : false;

  return (
    <li>
      <div
        className="group flex items-center gap-1.5 rounded-md py-1.5 text-sm hover:bg-accent"
        style={{ paddingLeft: depth * 24 }}
      >
        {hasChildren ? (
          <button
            onClick={() => onToggle(node.id)}
            className="p-0.5 text-muted-foreground hover:text-foreground"
            aria-label={isOpen ? 'Collapse' : 'Expand'}
          >
            <ChevronRight className={`h-3.5 w-3.5 transition-transform ${isOpen ? 'rotate-90' : ''}`} />
          </button>
        ) : (
          <span className="h-1.5 w-1.5 rounded-full bg-primary" style={{ marginInline: 3 }} />
        )}
        <button
          onClick={() => onSelect(node)}
          className={`flex items-center gap-2 text-left ${isSelfMatch && matchIds ? 'font-semibold text-primary' : ''}`}
        >
          <span className="font-medium">{fullName(node)}</span>
          {node.designation && <span className="text-muted-foreground">· {node.designation}</span>}
        </button>
      </div>
      {hasChildren && isOpen && (
        <ul>
          {node.directReports.map((child) => (
            <TreeNode
              key={child.id}
              node={child}
              depth={depth + 1}
              collapsed={collapsed}
              onToggle={onToggle}
              matchIds={matchIds}
              onSelect={onSelect}
            />
          ))}
        </ul>
      )}
    </li>
  );
}
