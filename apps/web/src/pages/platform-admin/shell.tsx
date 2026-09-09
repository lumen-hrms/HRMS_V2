import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { Building2, LogOut, Moon, ScrollText, Sun, Tag } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTheme } from '@/context/theme-context';
import { DropdownMenu, DropdownMenuItem, DropdownMenuSeparator } from '@/components/ui/dropdown-menu';
import { usePlatformAuth } from './lib/platform-auth';

const NAV = [
  { to: '/platform-admin', label: 'Tenants', icon: Building2, end: true },
  { to: '/platform-admin/plans', label: 'Plans', icon: Tag, end: false },
  { to: '/platform-admin/audit', label: 'Audit log', icon: ScrollText, end: false },
];

const CRUMB: Record<string, string> = {
  '/platform-admin': 'Tenants',
  '/platform-admin/tenants/new': 'Tenants / New tenant',
  '/platform-admin/plans': 'Plans',
  '/platform-admin/audit': 'Audit log',
};

/** Console frame: 2-link operator nav + sticky top bar + routed content. */
export function PlatformShell() {
  const { admin, logout } = usePlatformAuth();
  const { theme, setTheme } = useTheme();
  const { pathname } = useLocation();

  const crumb = CRUMB[pathname] ?? (pathname.startsWith('/platform-admin/tenants/') ? 'Tenants / Detail' : 'Tenants');

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Left nav */}
      <aside className="fixed inset-y-0 left-0 z-40 flex w-60 flex-col border-r border-border bg-card">
        <div className="flex flex-col gap-2 p-4">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold">Lumen HR</span>
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
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium transition-colors',
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
            {(['light', 'system', 'dark'] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTheme(t)}
                className={cn(
                  'flex flex-1 items-center justify-center rounded-md py-1.5 text-xs capitalize transition-colors',
                  theme === t ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:bg-accent',
                )}
              >
                {t === 'light' ? <Sun className="h-3.5 w-3.5" /> : t === 'dark' ? <Moon className="h-3.5 w-3.5" /> : t}
              </button>
            ))}
          </div>
          <div className="mt-1 truncate px-1 text-xs text-muted-foreground" title={admin.email}>
            {admin.email}
          </div>
          <button
            onClick={logout}
            className="flex items-center gap-2 rounded-md px-1 py-1.5 text-xs text-muted-foreground hover:text-destructive"
          >
            <LogOut className="h-3.5 w-3.5" /> Log out
          </button>
        </div>
      </aside>

      {/* Content */}
      <div className="pl-60">
        <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-border bg-card/90 px-8 backdrop-blur">
          <div className="flex items-center gap-1.5 text-sm">
            <span className="text-muted-foreground">Operator</span>
            <span className="text-muted-foreground">/</span>
            <span className="font-medium">{crumb}</span>
          </div>
          <DropdownMenu
            trigger={
              <span className="inline-flex items-center gap-2 rounded-md px-2 py-1 text-sm hover:bg-accent">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
                  {admin.email[0]?.toUpperCase()}
                </span>
                Operator
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

        <main className="mx-auto max-w-[1200px] p-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
