import { useEffect } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { UserButton, OrganizationSwitcher } from '@clerk/clerk-react';
import { useQuery } from '@tanstack/react-query';
import {
  LayoutDashboard, Kanban, Settings, ChevronLeft, ChevronRight, Users, X,
  Sun, Moon, CheckSquare, Layers, Globe, Target, Eye, Inbox,
} from 'lucide-react';
import { useUIStore } from '@/stores/ui';
import { useTranslation } from '@/hooks/useTranslation';
import { useApi } from '@/hooks/useApi';
import { cn } from '@/lib/utils';
import { LanguageSwitcher } from '@/components/shared/LanguageSwitcher';
import type { Issue } from '@/lib/types';

export function Sidebar() {
  const { t, i18n } = useTranslation();
  const collapsed = useUIStore((s) => s.sidebarCollapsed);
  const toggle = useUIStore((s) => s.toggleSidebar);
  const mobileOpen = useUIStore((s) => s.sidebarMobileOpen);
  const closeMobile = useUIStore((s) => s.closeMobileSidebar);
  const theme = useUIStore((s) => s.theme);
  const toggleTheme = useUIStore((s) => s.toggleTheme);

  // Detect if we're on a project page to show project-specific nav items
  const location = useLocation();
  const projectSlugMatch = location.pathname.match(/^\/projects\/([^/]+)/);
  const currentProjectSlug = projectSlugMatch ? projectSlugMatch[1] : null;

  const apiClient = useApi();

  // Fetch saved views
  const { data: savedViews = [] } = useQuery({
    queryKey: ['saved-views'],
    queryFn: () => apiClient.views.list(),
    staleTime: 60_000,
  });

  // Fetch triage count (unassigned backlog + public source)
  const { data: allIssues = [] } = useQuery({
    queryKey: ['all-issues'],
    queryFn: () => apiClient.issues.listAll({ limit: 2000 }),
    staleTime: 60_000,
  });

  const triageCount = allIssues.filter(
    (i: Issue) => i.source === 'form' || (i.assignee_ids.length === 0 && i.status === 'backlog')
  ).length;

  const navItems = [
    { to: '/dashboard', icon: LayoutDashboard, label: t('sidebar.dashboard'), tourId: undefined },
    { to: '/my-tasks', icon: CheckSquare, label: t('sidebar.myTasks'), tourId: 'my-tasks' as const },
    { to: '/all-issues', icon: Layers, label: t('sidebar.allIssues'), tourId: undefined },
    { to: '/triage', icon: Inbox, label: t('sidebar.triage'), tourId: undefined, badge: triageCount > 0 ? triageCount : undefined },
    { to: '/projects', icon: Kanban, label: t('sidebar.projects'), tourId: 'projects-list' as const },
    {
      to: currentProjectSlug ? `/projects/${currentProjectSlug}/milestones` : '/milestones',
      icon: Target,
      label: t('sidebar.milestones'),
      tourId: undefined,
    },
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
          aria-hidden="true"
        />
      )}

      <aside
        data-tour="sidebar"
        role="complementary"
        aria-label={t('sidebar.navigation') || 'Sidebar'}
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
              aria-label={t('sidebar.closeMenu') || 'Close menu'}
              className="rounded-md p-1.5 text-secondary hover:bg-surface hover:text-primary transition-colors md:hidden shrink-0 ml-1"
            >
              <X size={16} aria-hidden="true" />
            </button>
          )}
        </div>

        {/* Nav */}
        <nav aria-label={t('sidebar.mainNavigation') || 'Main navigation'} className="flex-1 space-y-1 p-2 overflow-y-auto">
          {navItems.map(({ to, icon: Icon, label, tourId, badge }: any) => (
            <NavLink
              key={to}
              to={to}
              onClick={closeMobile}
              aria-label={collapsed && !mobileOpen ? label : undefined}
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
              {({ isActive }) => (
                <>
                  <Icon size={20} aria-hidden="true" />
                  {(!collapsed || mobileOpen) && <span className="flex-1">{label}</span>}
                  {(!collapsed || mobileOpen) && badge !== undefined && (
                    <span className="rounded-full bg-accent/20 text-accent px-1.5 py-0.5 text-[10px] font-bold tabular-nums">
                      {badge}
                    </span>
                  )}
                  {isActive && <span className="sr-only">(current page)</span>}
                </>
              )}
            </NavLink>
          ))}

          {/* Saved Views */}
          {savedViews.length > 0 && (!collapsed || mobileOpen) && (
            <div className="pt-3 mt-2 border-t border-border">
              <span className="px-3 text-[10px] font-semibold uppercase tracking-wider text-muted">
                {t('sidebar.views')}
              </span>
              {savedViews.map((view) => (
                <NavLink
                  key={view.id}
                  to={`/all-issues?view=${view.id}`}
                  onClick={closeMobile}
                  className={({ isActive }) =>
                    cn(
                      'flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors min-h-[36px]',
                      isActive
                        ? 'bg-surface-hover text-primary'
                        : 'text-secondary hover:bg-surface hover:text-primary',
                    )
                  }
                >
                  <Eye size={16} aria-hidden="true" />
                  <span className="truncate">{view.name}</span>
                </NavLink>
              ))}
            </div>
          )}
        </nav>

        {/* Footer */}
        <div className="border-t border-border p-3 space-y-2">
          {/* Language toggle */}
          {(!collapsed || mobileOpen) ? (
            <LanguageSwitcher variant="full" className="px-3 py-1.5" />
          ) : (
            <button
              onClick={toggleLanguage}
              className="flex items-center justify-center rounded-lg px-0 py-2 text-sm text-secondary hover:bg-surface-hover hover:text-primary w-full min-h-[40px]"
              title={t('sidebar.language')}
              aria-label={t('sidebar.language') || 'Switch language'}
            >
              <Globe size={18} aria-hidden="true" />
            </button>
          )}

          {/* Theme toggle */}
          <button
            onClick={toggleTheme}
            className={cn(
              'flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors w-full min-h-[40px]',
              'text-secondary hover:bg-surface-hover hover:text-primary',
              collapsed && !mobileOpen && 'justify-center px-0',
            )}
            title={theme === 'dark' ? t('sidebar.lightMode') : t('sidebar.darkMode')}
            aria-label={theme === 'dark' ? t('sidebar.lightMode') : t('sidebar.darkMode')}
          >
            {theme === 'dark' ? <Sun size={18} aria-hidden="true" /> : <Moon size={18} aria-hidden="true" />}
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
              aria-label={collapsed ? (t('sidebar.expand') || 'Expand sidebar') : (t('sidebar.collapse') || 'Collapse sidebar')}
              className="rounded-md p-1.5 text-secondary hover:bg-surface-hover hover:text-primary transition-colors hidden md:block"
            >
              {collapsed ? <ChevronRight size={16} aria-hidden="true" /> : <ChevronLeft size={16} aria-hidden="true" />}
            </button>
          </div>
        </div>
      </aside>
    </>
  );
}
