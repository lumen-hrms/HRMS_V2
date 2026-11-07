import * as React from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { BackButton } from '@/components/back-button';
import {
  BookOpen,
  Building2,
  Inbox,
  LogOut,
  Menu,
  Monitor,
  Moon,
  ScrollText,
  Settings,
  Sun,
  Tag,
  X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTheme } from '@/context/theme-context';
import { DropdownMenu, DropdownMenuItem, DropdownMenuSeparator } from '@/components/ui/dropdown-menu';
import { usePlatformAuth } from './lib/platform-auth';

const NAV = [
  { to: '/platform-admin', label: 'Tenants', icon: Building2, end: true },
  { to: '/platform-admin/plans', label: 'Plans', icon: Tag, end: false },
  { to: '/platform-admin/leads', label: 'Leads', icon: Inbox, end: false },
  { to: '/platform-admin/audit', label: 'Audit log', icon: ScrollText, end: false },
  { to: '/platform-admin/guide', label: 'Tenant guide', icon: BookOpen, end: false },
  { to: '/platform-admin/settings', label: 'Settings', icon: Settings, end: false },
];

const CRUMB: Record<string, string> = {
  '/platform-admin': 'Tenants',
  '/platform-admin/tenants/new': 'Tenants / New tenant',
  '/platform-admin/plans': 'Plans',
  '/platform-admin/leads': 'Leads',
  '/platform-admin/audit': 'Audit log',
  '/platform-admin/settings': 'Settings',
};

/** Console frame: 2-link operator nav + sticky top bar + routed content. */
export function PlatformShell() {
  const { admin, logout } = usePlatformAuth();
  const { theme, setTheme } = useTheme();
  const { pathname } = useLocation();
  // Below `lg` the nav is an off-canvas drawer opened from the top bar.
  const [navOpen, setNavOpen] = React.useState(false);

  const crumb = CRUMB[pathname] ?? (pathname.startsWith('/platform-admin/tenants/') ? 'Tenants / Detail' : 'Tenants');

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Drawer backdrop (below lg only) */}
      {navOpen && (
        <div
          className="fixed inset-0 z-40 bg-[#030812]/50 backdrop-blur-sm lg:hidden"
          onClick={() => setNavOpen(false)}
          aria-hidden="true"
        />
      )}
      {/* Left nav — fixed column from lg up, drawer below */}
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-50 flex w-64 max-w-[85vw] flex-col overflow-y-auto border-r border-border bg-card transition-[transform,visibility] duration-200 lg:z-40 lg:w-60 lg:translate-x-0 lg:visible',
          navOpen ? 'translate-x-0' : '-translate-x-full invisible',
        )}
      >
        <div className="flex flex-col gap-2 p-4">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-semibold">Lumen HR</span>
            <button
              type="button"
              onClick={() => setNavOpen(false)}
              className="-mr-1 rounded-full p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground lg:hidden"
              aria-label="Close menu"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <span className="inline-flex w-fit items-center gap-1.5 rounded-full bg-warning/15 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-warning">
            <span className="h-1.5 w-1.5 rounded-full bg-warning" />
            Operator console
          </span>
        </div>

        <nav className="flex flex-col gap-0.5 px-2">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              onClick={() => setNavOpen(false)}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-secondary text-foreground'
                    : 'text-muted-foreground hover:bg-accent hover:text-foreground',
                )
              }
            >
              <item.icon className="h-4 w-4" />
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="mt-auto flex flex-col gap-1 border-t border-border p-3">
          <div className="flex gap-1">
            {(
              [
                ['light', Sun],
                ['system', Monitor],
                ['dark', Moon],
              ] as const
            ).map(([t, Icon]) => (
              <button
                key={t}
                onClick={() => setTheme(t)}
                aria-label={`${t} theme`}
                className={cn(
                  'flex flex-1 items-center justify-center rounded-xl py-1.5 transition-colors',
                  theme === t ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:bg-accent',
                )}
              >
                <Icon className="h-3.5 w-3.5" />
              </button>
            ))}
          </div>
          <div className="mt-1 truncate px-1 text-xs text-muted-foreground" title={admin.email}>
            {admin.email}
          </div>
          <button
            onClick={logout}
            className="flex items-center gap-2 rounded-xl px-1 py-1.5 text-xs text-muted-foreground hover:text-destructive"
          >
            <LogOut className="h-3.5 w-3.5" /> Log out
          </button>
        </div>
      </aside>

      {/* Content */}
      <div className="lg:pl-60">
        <header className="sticky top-0 z-30 flex h-14 items-center justify-between gap-3 border-b border-border bg-card/90 px-4 backdrop-blur sm:px-6 lg:px-8">
          <div className="flex min-w-0 items-center gap-2 text-sm">
            <button
              type="button"
              onClick={() => setNavOpen(true)}
              className="-ml-1.5 rounded-xl p-2 text-muted-foreground hover:bg-accent hover:text-foreground lg:hidden"
              aria-label="Open menu"
            >
              <Menu className="h-5 w-5" />
            </button>
            <span className="hidden text-muted-foreground sm:inline">Operator</span>
            <span className="hidden text-muted-foreground sm:inline">/</span>
            <span className="truncate font-medium">{crumb}</span>
          </div>
          <DropdownMenu
            trigger={
              <span className="inline-flex items-center gap-2 rounded-xl px-2 py-1 text-sm hover:bg-accent">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
                  {admin.email[0]?.toUpperCase()}
                </span>
                <span className="hidden sm:inline">Operator</span>
              </span>
            }
          >
            <DropdownMenuItem disabled>{admin.email}</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem destructive onClick={logout}>
              Sign out
            </DropdownMenuItem>
          </DropdownMenu>
        </header>

        <main className="mx-auto max-w-[1200px] p-4 sm:p-6 lg:p-8">
          {pathname !== '/platform-admin' && <BackButton fallback="/platform-admin" className="mb-3" />}
          <Outlet />
        </main>
      </div>
    </div>
  );
}
