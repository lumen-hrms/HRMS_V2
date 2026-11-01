import { WorkspaceBanner } from '@/components/workspace-banner';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard,
  Users,
  CalendarDays,
  Network,
  Building,
  Building2,
  Clock,
  Wallet,
  ShieldCheck,
  Mail,
  UserCog,
  LogOut,
  Moon,
  Sun,
  Monitor,
  ChartColumn,
} from 'lucide-react';
import { useAuth } from '@/context/auth-context';
import { useTheme } from '@/context/theme-context';
import { cn } from '@/lib/utils';
import { ROLE_LABELS, type Role } from '@/lib/roles';
// Sidebar is on `bg-card` (theme-driven), so the mark swaps per theme in
// index.css (`.brand-mark-light` / `.brand-mark-dark`) — same three-state
// pattern as the token blocks. Both are transparent PNGs.
import lumenMarkDark from '@/assets/brand/lumen-mark-dark.png';
import lumenMarkWhite from '@/assets/brand/lumen-mark-white.png';

/**
 * `roles` omitted ⇒ visible to every authenticated tenant user. Otherwise the
 * item only renders for those roles. The server still guards each route; this
 * just keeps the nav honest so nobody clicks into a 403.
 */
const NAV: { to: string; label: string; icon: typeof LayoutDashboard; end?: boolean; roles?: Role[] }[] = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/employees', label: 'Employees', icon: Users },
  {
    to: '/org-chart',
    label: 'Org Chart',
    icon: Network,
    roles: ['COMPANY_ADMIN', 'HR_MANAGER', 'LINE_MANAGER', 'AUDITOR'],
  },
  {
    to: '/departments',
    label: 'Departments',
    icon: Building2,
    roles: ['COMPANY_ADMIN', 'HR_MANAGER', 'LINE_MANAGER', 'AUDITOR'],
  },
  { to: '/leave', label: 'Leave', icon: CalendarDays },
  { to: '/attendance', label: 'Attendance', icon: Clock },
  {
    to: '/reports',
    label: 'Reports',
    icon: ChartColumn,
    roles: ['COMPANY_ADMIN', 'HR_MANAGER'],
  },
  {
    to: '/payroll',
    label: 'Payroll',
    icon: Wallet,
    roles: ['COMPANY_ADMIN', 'HR_MANAGER', 'EMPLOYEE', 'AUDITOR'],
  },
  {
    to: '/access',
    label: 'Identity & Access',
    icon: ShieldCheck,
    roles: ['COMPANY_ADMIN', 'HR_MANAGER', 'AUDITOR'],
  },
  {
    to: '/company',
    label: 'Company',
    icon: Building,
    roles: ['COMPANY_ADMIN', 'HR_MANAGER', 'AUDITOR'],
  },
  {
    to: '/notifications',
    label: 'Email log',
    icon: Mail,
    roles: ['COMPANY_ADMIN', 'HR_MANAGER', 'AUDITOR'],
  },
];

export function AppLayout() {
  const { user, logout } = useAuth();
  const { theme, setTheme } = useTheme();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const navRef = useRef<HTMLElement>(null);
  // The glass "lens" that slides behind the active sidebar item.
  const [lens, setLens] = useState<{ top: number; height: number } | null>(null);
  const [lensAnimates, setLensAnimates] = useState(false);
  // Set the instant a link is clicked so the lens (and highlight) move at once,
  // instead of waiting for the next page to finish rendering.
  // Tagged with the pathname it was set on, so it lapses on its own once the
  // route actually changes (no reset effect needed).
  const [pending, setPending] = useState<{ to: string; at: string } | null>(null);
  const pendingTo = pending && pending.at === pathname ? pending.to : null;

  async function handleLogout() {
    await logout();
    navigate('/login');
  }

  const nav = NAV.filter((item) => !item.roles || (user && item.roles.includes(user.role)));
  const navKey = nav.map((n) => n.to).join('|');

  // Park the lens on the active link; re-measure when the route, the item list
  // or the sidebar's size changes. Slide animation is switched on only after the
  // first placement so it doesn't fly in from the top on page load.
  useLayoutEffect(() => {
    const el = navRef.current;
    if (!el) return;
    const place = () => {
      const active = el.querySelector<HTMLElement>('a[aria-current="page"]');
      setLens(active ? { top: active.offsetTop, height: active.offsetHeight } : null);
    };
    place();
    const ro = new ResizeObserver(place);
    ro.observe(el);
    return () => ro.disconnect();
  }, [pathname, navKey]);

  useEffect(() => {
    if (lens && !lensAnimates) {
      const id = requestAnimationFrame(() => setLensAnimates(true));
      return () => cancelAnimationFrame(id);
    }
  }, [lens, lensAnimates]);

  return (
    <div className="flex min-h-screen text-foreground">
      <aside className="glass flex w-60 shrink-0 flex-col rounded-none border-y-0 border-l-0">
        <div className="flex items-center gap-2 px-5 py-5">
          <img src={lumenMarkDark} alt="" className="brand-mark-light h-7 w-7 shrink-0 object-contain" />
          <img src={lumenMarkWhite} alt="" className="brand-mark-dark h-7 w-7 shrink-0 object-contain" />
          <span className="text-lg font-semibold tracking-tight text-foreground">
            Lumen <span className="text-muted-foreground">HRMS</span>
          </span>
        </div>
        <nav ref={navRef} className="relative flex flex-1 flex-col gap-1 px-3">
          <span
            aria-hidden
            className={cn('nav-lens', lensAnimates && 'nav-lens-animated')}
            style={{
              opacity: lens ? 1 : 0,
              height: lens?.height ?? 0,
              transform: `translateY(${lens?.top ?? 0}px)`,
            }}
          />
          {nav.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              onClick={(e) => {
                setPending({ to, at: pathname });
                setLens({ top: e.currentTarget.offsetTop, height: e.currentTarget.offsetHeight });
              }}
              className={({ isActive }) =>
                cn(
                  'nav-item relative z-10 flex items-center rounded-md px-3 py-2 text-sm font-medium transition-colors',
                  (pendingTo ? pendingTo === to : isActive)
                    ? 'nav-item-active'
                    : 'text-muted-foreground hover:text-foreground',
                )
              }
            >
              <span className="nav-item-inner flex items-center gap-2.5">
                <Icon className="h-4 w-4" />
                {label}
              </span>
            </NavLink>
          ))}
        </nav>
        <div className="border-t border-border p-3">
          <div className="mb-2 flex items-center gap-1 rounded-md bg-muted p-1">
            {(
              [
                ['light', Sun],
                ['system', Monitor],
                ['dark', Moon],
              ] as const
            ).map(([value, Icon]) => (
              <button
                key={value}
                onClick={() => setTheme(value)}
                className={cn(
                  'flex flex-1 items-center justify-center rounded py-1 text-muted-foreground',
                  theme === value && 'bg-card text-foreground shadow-sm',
                )}
                aria-label={value}
              >
                <Icon className="h-3.5 w-3.5" />
              </button>
            ))}
          </div>
          <NavLink
            to="/account"
            className={({ isActive }) =>
              cn(
                'mb-2 flex items-center gap-2 rounded-md px-1 py-1 text-xs transition-colors',
                isActive ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
              )
            }
          >
            <UserCog className="h-4 w-4 shrink-0" />
            <span className="min-w-0 truncate">
              {user?.email}
              <span className="block font-medium text-foreground">
                {user ? ROLE_LABELS[user.role] : ''}
              </span>
            </span>
          </NavLink>
          <button
            onClick={handleLogout}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground"
          >
            <LogOut className="h-4 w-4" /> Log out
          </button>
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <WorkspaceBanner />
        <main className="flex-1 overflow-y-auto p-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
