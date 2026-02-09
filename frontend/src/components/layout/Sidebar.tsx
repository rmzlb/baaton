import { useEffect } from 'react';
import { NavLink } from 'react-router-dom';
import { UserButton, OrganizationSwitcher } from '@clerk/clerk-react';
import {
  LayoutDashboard, Kanban, Settings, ChevronLeft, ChevronRight, Users, X,
  Sun, Moon, CheckSquare, Layers, Globe,
} from 'lucide-react';
import { useUIStore } from '@/stores/ui';
import { useTranslation } from '@/hooks/useTranslation';
import { cn } from '@/lib/utils';

export function Sidebar() {
  const { t, i18n } = useTranslation();
  const collapsed = useUIStore((s) => s.sidebarCollapsed);
  const toggle = useUIStore((s) => s.toggleSidebar);
  const mobileOpen = useUIStore((s) => s.sidebarMobileOpen);
  const closeMobile = useUIStore((s) => s.closeMobileSidebar);
  const theme = useUIStore((s) => s.theme);
  const toggleTheme = useUIStore((s) => s.toggleTheme);

  const navItems = [
    { to: '/dashboard', icon: LayoutDashboard, label: t('sidebar.dashboard'), tourId: undefined },
    { to: '/my-tasks', icon: CheckSquare, label: t('sidebar.myTasks'), tourId: 'my-tasks' as const },
    { to: '/all-issues', icon: Layers, label: t('sidebar.allIssues'), tourId: undefined },
    { to: '/projects', icon: Kanban, label: t('sidebar.projects'), tourId: 'projects-list' as const },
    { to: '/org', icon: Users, label: t('sidebar.team'), tourId: undefined },
    { to: '/settings', icon: Settings, label: t('sidebar.settings'), tourId: 'settings' as const },
  ];

  const toggleLanguage = () => {
    const next = i18n.language === 'fr' ? 'en' : 'fr';
    i18n.changeLanguage(next);
  };

  // Close mobile sidebar on route change (via escape or backdrop)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && mobileOpen) closeMobile();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [mobileOpen, closeMobile]);

  // Auto-collapse on small screens
  useEffect(() => {
    const mql = window.matchMedia('(max-width: 767px)');
    const handleChange = (e: MediaQueryListEvent | MediaQueryList) => {
      if (e.matches) {
        useUIStore.getState().setSidebarCollapsed(true);
      }
    };
    handleChange(mql);
    mql.addEventListener('change', handleChange);
    return () => mql.removeEventListener('change', handleChange);
  }, []);

  return (
    <>
      {/* Mobile backdrop */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm md:hidden"
          onClick={closeMobile}
        />
      )}

      <aside
        data-tour="sidebar"
        className={cn(
          // Desktop: fixed left
          'fixed inset-y-0 left-0 z-50 flex flex-col border-r border-border bg-bg transition-all duration-200',
          // Desktop width
          collapsed ? 'w-16' : 'w-60',
          // Mobile: hidden by default, overlay when open
          'max-md:-translate-x-full max-md:w-60',
          mobileOpen && 'max-md:translate-x-0',
        )}
      >
        {/* Org Switcher / Header */}
        <div className="flex h-12 items-center border-b border-border px-3 justify-between">
          {collapsed && !mobileOpen ? (
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent text-black font-bold text-sm mx-auto">
              B
            </div>
          ) : (
            <OrganizationSwitcher
              appearance={{
                elements: {
                  rootBox: 'w-full',
                  organizationSwitcherTrigger:
                    'w-full justify-start px-1 py-1 rounded-lg hover:bg-surface-hover border-none',
                },
              }}
              afterCreateOrganizationUrl="/dashboard"
              afterSelectOrganizationUrl="/dashboard"
            />
          )}
          {/* Close button on mobile */}
          {mobileOpen && (
            <button
              onClick={closeMobile}
              className="rounded-md p-1.5 text-secondary hover:bg-surface hover:text-primary transition-colors md:hidden shrink-0 ml-1"
            >
              <X size={16} />
            </button>
          )}
        </div>

        {/* Nav */}
        <nav className="flex-1 space-y-1 p-2">
          {navItems.map(({ to, icon: Icon, label, tourId }) => (
            <NavLink
              key={to}
              to={to}
              onClick={closeMobile}
              {...(tourId ? { 'data-tour': tourId } : {})}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors min-h-[44px]',
                  isActive
                    ? 'bg-surface-hover text-primary'
                    : 'text-secondary hover:bg-surface hover:text-primary',
                  collapsed && !mobileOpen && 'justify-center px-0',
                )
              }
            >
              <Icon size={20} />
              {(!collapsed || mobileOpen) && <span>{label}</span>}
            </NavLink>
          ))}
        </nav>

        {/* Footer */}
        <div className="border-t border-border p-3 space-y-2">
          {/* Language toggle */}
          <button
            onClick={toggleLanguage}
            className={cn(
              'flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors w-full min-h-[40px]',
              'text-secondary hover:bg-surface-hover hover:text-primary',
              collapsed && !mobileOpen && 'justify-center px-0',
            )}
            title={t('sidebar.language')}
          >
            <Globe size={18} />
            {(!collapsed || mobileOpen) && (
              <span className="text-xs font-mono uppercase">{i18n.language === 'fr' ? 'FR' : 'EN'}</span>
            )}
          </button>

          {/* Theme toggle */}
          <button
            onClick={toggleTheme}
            className={cn(
              'flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors w-full min-h-[40px]',
              'text-secondary hover:bg-surface-hover hover:text-primary',
              collapsed && !mobileOpen && 'justify-center px-0',
            )}
            title={theme === 'dark' ? t('sidebar.lightMode') : t('sidebar.darkMode')}
          >
            {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
            {(!collapsed || mobileOpen) && (
              <span>{theme === 'dark' ? t('sidebar.lightMode') : t('sidebar.darkMode')}</span>
            )}
          </button>

          {/* User + collapse */}
          <div className="flex items-center justify-between">
            <UserButton
              appearance={{
                elements: { avatarBox: 'h-8 w-8' },
              }}
            />
            <button
              onClick={toggle}
              className="rounded-md p-1.5 text-secondary hover:bg-surface-hover hover:text-primary transition-colors hidden md:block"
            >
              {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
            </button>
          </div>
        </div>
      </aside>
    </>
  );
}
