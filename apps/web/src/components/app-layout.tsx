import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard,
  Users,
  CalendarDays,
  Network,
  Building2,
  Clock,
  LogOut,
  Moon,
  Sun,
  Monitor,
} from 'lucide-react';
import { useAuth } from '@/context/auth-context';
import { useTheme } from '@/context/theme-context';
import { cn } from '@/lib/utils';
import { ROLE_LABELS, type Role } from '@/lib/roles';
import lumenLogo from '@/assets/brand/lumen-logo-lockup.png';

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
];

export function AppLayout() {
  const { user, logout } = useAuth();
  const { theme, setTheme } = useTheme();
  const navigate = useNavigate();

  async function handleLogout() {
    await logout();
    navigate('/login');
  }

  const nav = NAV.filter((item) => !item.roles || (user && item.roles.includes(user.role)));

  return (
    <div className="flex min-h-screen bg-background text-foreground">
      <aside className="flex w-60 shrink-0 flex-col border-r border-border bg-card">
        <div className="flex items-center px-5 py-5">
          <img src={lumenLogo} alt="Lumen HRMS" className="h-7 w-auto" />
        </div>
        <nav className="flex flex-1 flex-col gap-1 px-3">
          {nav.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-secondary text-secondary-foreground'
                    : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
                )
              }
            >
              <Icon className="h-4 w-4" />
              {label}
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
          <div className="mb-2 truncate px-1 text-xs text-muted-foreground">
            {user?.email}
            <div className="font-medium text-foreground">
              {user ? ROLE_LABELS[user.role] : ''}
            </div>
          </div>
          <button
            onClick={handleLogout}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground"
          >
            <LogOut className="h-4 w-4" /> Log out
          </button>
        </div>
      </aside>
      <main className="flex-1 overflow-y-auto p-8">
        <Outlet />
      </main>
    </div>
  );
}
