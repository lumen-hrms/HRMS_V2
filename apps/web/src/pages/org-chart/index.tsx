import * as React from 'react';
import {
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  Maximize2,
  Minus,
  Network,
  Plus,
  RotateCcw,
  Search,
  X,
} from 'lucide-react';
import { api, isApiError } from '@/lib/api';
import { useAuth } from '@/context/auth-context';
import { cn } from '@/lib/utils';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty-state';
import {
  ancestorsOf,
  fullName,
  indexTree,
  layoutSignature,
  matchesQuery,
  visibleEdges,
  type OrgNode,
} from './model';
import { PersonAvatar } from './person-bits';
import { OrgTree, type TreeHandlers } from './tree';
import { OrgLinks } from './links';
import { useNodeDrag } from './use-node-drag';
import { PersonHoverCard } from './hover-card';
import { useHoverCard } from './use-hover-card';
import { PersonSheet } from './person-sheet';
import { usePanZoom } from './use-pan-zoom';

/** Levels open on first load: the root's team is shown, everyone below is one click away. */
const DEFAULT_OPEN_DEPTH = 1;
const HIGHLIGHT_MS = 2600;

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Run after React has committed and the browser has laid the new tree out. */
const afterLayout = (fn: () => void) => requestAnimationFrame(() => requestAnimationFrame(fn));

export function OrgChartPage() {
  const { user } = useAuth();
  const [roots, setRoots] = React.useState<OrgNode[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [expanded, setExpanded] = React.useState<Set<string>>(new Set());
  const [focusId, setFocusId] = React.useState<string | null>(null);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [highlightId, setHighlightId] = React.useState<string | null>(null);
  const [deptId, setDeptId] = React.useState('');
  const highlightTimer = React.useRef<number | undefined>(undefined);

  const hover = useHoverCard();
  const {
    viewportRef,
    contentRef,
    contentStyle,
    scale,
    dragging,
    onPointerDown,
    wasDragging: wasPanning,
    zoomIn,
    zoomOut,
    resetZoom,
    fit,
    centerOn,
  } = usePanZoom({ onInteract: hover.hideNow });

  const nodeDrag = useNodeDrag({
    storageKey: user ? `${user.tenantId}.${user.sub}` : null,
    signature: React.useMemo(() => (roots ? layoutSignature(roots) : null), [roots]),
    contentRef,
    onDragStart: hover.hideNow,
  });

  const index = React.useMemo(() => indexTree(roots ?? []), [roots]);

  const fetchChart = React.useCallback(() => {
    api
      .get<OrgNode[]>('/employees/org-chart')
      .then((data) => {
        const idx = indexTree(data);
        setExpanded(
          new Set(idx.all.filter((n) => idx.depthOf.get(n.id)! < DEFAULT_OPEN_DEPTH).map((n) => n.id)),
        );
        setRoots(data);
        afterLayout(() => fit(0.6));
      })
      .catch((e) => setError(isApiError(e) ? e.message : 'Could not load the org chart.'));
  }, [fit]);

  React.useEffect(() => {
    fetchChart();
  }, [fetchChart]);

  function retry() {
    setError(null);
    setRoots(null);
    fetchChart();
  }

  React.useEffect(() => () => window.clearTimeout(highlightTimer.current), []);

  const focusNode = focusId ? index.byId.get(focusId) ?? null : null;
  const visibleRoots = React.useMemo(() => (focusNode ? [focusNode] : roots ?? []), [focusNode, roots]);
  const edges = React.useMemo(
    () => visibleEdges(visibleRoots, expanded, nodeDrag.offsets),
    [visibleRoots, expanded, nodeDrag.offsets],
  );

  // After the chart re-lays-out (expand / collapse / focus / first load) a card
  // the user parked somewhere may now sit on top of another — slide it clear.
  const { settle } = nodeDrag;
  React.useEffect(() => {
    if (roots) afterLayout(settle);
  }, [roots, expanded, focusId, settle]);

  function resetLayout() {
    nodeDrag.reset();
    window.setTimeout(() => fit(0.6), 380);
  }
  const breadcrumb = focusNode ? [...ancestorsOf(index, focusNode.id), focusNode] : [];

  const departments = React.useMemo(() => {
    const counts = new Map<string, { id: string; name: string; count: number }>();
    for (const n of index.all) {
      if (!n.department) continue;
      const d = counts.get(n.department.id) ?? { ...n.department, count: 0 };
      d.count += 1;
      counts.set(d.id, d);
    }
    return [...counts.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [index]);

  const matchIds = React.useMemo(
    () =>
      deptId ? new Set(index.all.filter((n) => n.department?.id === deptId).map((n) => n.id)) : null,
    [deptId, index],
  );

  const isWithin = (id: string, ancestorId: string) => {
    for (let cur: string | undefined = id; cur; cur = index.parentOf.get(cur)) {
      if (cur === ancestorId) return true;
    }
    return false;
  };

  /** Open the path to `node`, pan to it and pulse it. */
  function reveal(node: OrgNode) {
    if (focusId && !isWithin(node.id, focusId)) setFocusId(null);
    setExpanded((prev) => {
      const next = new Set(prev);
      ancestorsOf(index, node.id).forEach((a) => next.add(a.id));
      return next;
    });
    setHighlightId(node.id);
    window.clearTimeout(highlightTimer.current);
    highlightTimer.current = window.setTimeout(() => setHighlightId(null), HIGHLIGHT_MS);
    afterLayout(() => centerOn(node.id));
  }

  function focusTeam(node: OrgNode) {
    hover.hideNow();
    setFocusId(node.id);
    setExpanded((prev) => new Set(prev).add(node.id));
    afterLayout(() => fit(0.5));
  }

  function clearFocus(to: OrgNode | null = null) {
    if (to) return focusTeam(to);
    setFocusId(null);
    afterLayout(() => fit(0.6));
  }

  function changeDept(id: string) {
    setDeptId(id);
    if (!id) return;
    setExpanded((prev) => {
      const next = new Set(prev);
      for (const n of index.all) {
        if (n.department?.id === id) ancestorsOf(index, n.id).forEach((a) => next.add(a.id));
      }
      return next;
    });
    afterLayout(() => fit(0.4));
  }

  const handlers: TreeHandlers = {
    expanded,
    highlightId,
    matchIds,
    selectedId,
    onToggle: (id) => {
      const opening = !expanded.has(id);
      setExpanded((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
      // Drilling down: bring the manager and their newly-opened team into view.
      if (opening) afterLayout(() => centerOn(id));
    },
    onSelect: (node) => setSelectedId(node.id),
    onFocusTeam: focusTeam,
    onHoverStart: (node, el, immediate) => {
      if (!nodeDrag.isDragging()) hover.show(node, el, immediate);
    },
    onHoverEnd: hover.hide,
    wasDragging: () => wasPanning() || nodeDrag.wasDragging(),
    offsets: nodeDrag.offsets,
    onDragStart: (e, node) => nodeDrag.begin(e, node.id),
  };

  const scoped = user?.role === 'EMPLOYEE' || user?.role === 'LINE_MANAGER';
  const levels = index.all.length ? Math.max(...index.depthOf.values()) + 1 : 0;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Org chart"
        description={
          roots && roots.length > 0
            ? `${scoped ? 'Your reporting line' : 'Reporting hierarchy across the company'} · ${plural(index.all.length, 'person', 'people')} · ${plural(departments.length, 'department')} · ${plural(levels, 'level')}`
            : scoped
              ? 'Your reporting line.'
              : 'Reporting hierarchy across the company.'
        }
        actions={
          roots &&
          roots.length > 0 && (
            <>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setExpanded(new Set(index.all.filter((n) => n.directReports.length).map((n) => n.id)));
                  afterLayout(() => fit(0.3));
                }}
              >
                <ChevronsUpDown className="h-3.5 w-3.5" /> Expand all
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setExpanded(new Set());
                  afterLayout(() => fit(0.6));
                }}
              >
                <ChevronsDownUp className="h-3.5 w-3.5" /> Collapse all
              </Button>
            </>
          )
        }
      />

      {roots && roots.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <PeopleSearch nodes={index.all} onPick={reveal} />
          {departments.length > 1 && (
            <div className="w-56">
              <Select
                value={deptId}
                onChange={(e) => changeDept(e.target.value)}
                aria-label="Highlight department"
              >
                <option value="">All departments</option>
                {departments.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name} ({d.count})
                  </option>
                ))}
              </Select>
            </div>
          )}
          {deptId && (
            <Button size="sm" variant="ghost" onClick={() => changeDept('')}>
              <X className="h-3.5 w-3.5" /> Clear
            </Button>
          )}
        </div>
      )}

      <div
        ref={viewportRef}
        onPointerDown={roots && roots.length ? onPointerDown : undefined}
        className={cn(
          'relative h-[calc(100vh-15rem)] min-h-[520px] select-none overflow-hidden rounded-xl border border-border bg-card',
          roots && roots.length > 0 && (dragging ? 'cursor-grabbing' : 'cursor-grab'),
        )}
        style={{
          backgroundImage: 'radial-gradient(var(--org-line) 1px, transparent 1px)',
          backgroundSize: '22px 22px',
        }}
      >
        {error ? (
          <div className="flex h-full items-center justify-center">
            <EmptyState
              icon={Network}
              title="Couldn't load the org chart"
              description={error}
              action={
                <Button size="sm" variant="outline" onClick={retry}>
                  <RotateCcw className="h-3.5 w-3.5" /> Try again
                </Button>
              }
            />
          </div>
        ) : !roots ? (
          <ChartSkeleton />
        ) : roots.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <EmptyState
              icon={Network}
              title="No one in the org chart yet"
              description="Add employees and set their reporting managers to build the hierarchy."
            />
          </div>
        ) : (
          <>
            <div ref={contentRef} style={contentStyle} className="absolute left-0 top-0 p-4">
              <OrgLinks contentRef={contentRef} edges={edges} subscribe={nodeDrag.subscribe} />
              <OrgTree roots={visibleRoots} h={handlers} />
            </div>

            {breadcrumb.length > 0 && (
              <nav
                aria-label="Focused team"
                onPointerDown={(e) => e.stopPropagation()}
                className="absolute left-3 top-3 flex max-w-[calc(100%-1.5rem)] items-center gap-1 overflow-x-auto rounded-lg border border-border bg-card/95 p-1 text-sm shadow-sm backdrop-blur"
              >
                <button
                  type="button"
                  onClick={() => clearFocus()}
                  className="shrink-0 rounded-md px-2 py-1 font-medium text-primary hover:bg-accent"
                >
                  {scoped ? 'My chart' : 'Whole company'}
                </button>
                {breadcrumb.map((n, i) => (
                  <React.Fragment key={n.id}>
                    <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    {i === breadcrumb.length - 1 ? (
                      <span className="flex shrink-0 items-center gap-1.5 px-2 py-1 font-medium">
                        <PersonAvatar person={n} size={20} className="ring-0" />
                        {fullName(n)}
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => clearFocus(n)}
                        className="shrink-0 rounded-md px-2 py-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                      >
                        {fullName(n)}
                      </button>
                    )}
                  </React.Fragment>
                ))}
              </nav>
            )}

            <div
              onPointerDown={(e) => e.stopPropagation()}
              className="absolute bottom-3 right-3 flex items-center gap-0.5 rounded-lg border border-border bg-card/95 p-1 shadow-sm backdrop-blur"
            >
              <IconButton label="Zoom out" onClick={zoomOut}>
                <Minus className="h-4 w-4" />
              </IconButton>
              <button
                type="button"
                onClick={resetZoom}
                title="Reset to 100%"
                className="w-12 rounded-md py-1 text-center text-xs font-medium tabular-nums text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                {Math.round(scale * 100)}%
              </button>
              <IconButton label="Zoom in" onClick={zoomIn}>
                <Plus className="h-4 w-4" />
              </IconButton>
              <span className="mx-0.5 h-5 w-px bg-border" />
              <IconButton label="Fit to screen" onClick={() => fit()}>
                <Maximize2 className="h-4 w-4" />
              </IconButton>
              {Object.keys(nodeDrag.offsets).length > 0 && (
                <>
                  <span className="mx-0.5 h-5 w-px bg-border" />
                  <button
                    type="button"
                    onClick={resetLayout}
                    title="Put every card back in its original position"
                    className="flex items-center gap-1 rounded-md px-2 py-1.5 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground"
                  >
                    <RotateCcw className="h-3.5 w-3.5" /> Reset layout
                  </button>
                </>
              )}
            </div>

            <p className="pointer-events-none absolute bottom-4 left-4 hidden text-xs text-muted-foreground md:block">
              Drag the background to pan · Drag a card to move it (a manager takes their team) · Ctrl + scroll to zoom · Hover for contact · Double-click a manager to focus their team
            </p>
          </>
        )}
      </div>

      <PersonHoverCard
        target={hover.target}
        onMouseEnter={hover.keepOpen}
        onMouseLeave={hover.hide}
        onOpenDetails={(n) => {
          hover.hideNow();
          setSelectedId(n.id);
        }}
        onShowTeam={focusTeam}
      />

      <PersonSheet
        node={selectedId ? index.byId.get(selectedId) ?? null : null}
        index={index}
        onClose={() => setSelectedId(null)}
        onSelect={(n) => {
          setSelectedId(n.id);
          reveal(n);
        }}
        onShowTeam={focusTeam}
      />
    </div>
  );
}

function IconButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
    >
      {children}
    </button>
  );
}

/** Type-ahead people search: name, title, code, email or department. */
function PeopleSearch({ nodes, onPick }: { nodes: OrgNode[]; onPick: (n: OrgNode) => void }) {
  const [query, setQuery] = React.useState('');
  const [open, setOpen] = React.useState(false);
  const [active, setActive] = React.useState(0);
  const results = React.useMemo(
    () => (query.trim() ? nodes.filter((n) => matchesQuery(n, query)).slice(0, 8) : []),
    [nodes, query],
  );

  function pick(n: OrgNode) {
    onPick(n);
    setQuery(fullName(n));
    setOpen(false);
  }

  return (
    <div className="relative w-full sm:w-80">
      <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <input
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setActive(0);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => window.setTimeout(() => setOpen(false), 120)}
        onKeyDown={(e) => {
          if (!results.length) return;
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setActive((a) => (a + 1) % results.length);
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActive((a) => (a - 1 + results.length) % results.length);
          } else if (e.key === 'Enter') {
            e.preventDefault();
            pick(results[active] ?? results[0]);
          } else if (e.key === 'Escape') {
            setOpen(false);
          }
        }}
        placeholder="Find a person, title or email…"
        aria-label="Search people"
        role="combobox"
        aria-expanded={open && results.length > 0}
        aria-controls="org-search-results"
        className="flex h-9 w-full rounded-md border border-input bg-card py-1 pl-8 pr-8 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />
      {query && (
        <button
          type="button"
          onClick={() => {
            setQuery('');
            setOpen(false);
          }}
          aria-label="Clear search"
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:text-foreground"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
      {open && query.trim() && (
        <div
          id="org-search-results"
          role="listbox"
          className="org-pop absolute left-0 top-full z-30 mt-1 w-full overflow-hidden rounded-lg border border-border bg-card shadow-lg"
        >
          {results.length === 0 ? (
            <p className="px-3 py-2.5 text-sm text-muted-foreground">No one matches “{query.trim()}”.</p>
          ) : (
            results.map((n, i) => (
              <button
                key={n.id}
                type="button"
                role="option"
                aria-selected={i === active}
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setActive(i)}
                onClick={() => pick(n)}
                className={cn(
                  'flex w-full items-center gap-2.5 px-3 py-2 text-left',
                  i === active && 'bg-accent',
                )}
              >
                <PersonAvatar person={n} size={28} className="ring-0" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{fullName(n)}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {[n.designation, n.department?.name].filter(Boolean).join(' · ') || '—'}
                  </p>
                </div>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

function ChartSkeleton() {
  const card = <Skeleton className="h-[72px] w-64 rounded-xl" />;
  return (
    <div className="flex h-full flex-col items-center gap-10 pt-10" aria-label="Loading org chart">
      {card}
      <div className="flex gap-6">
        {card}
        {card}
        {card}
      </div>
      <div className="flex gap-6 opacity-60">
        {card}
        {card}
      </div>
    </div>
  );
}
