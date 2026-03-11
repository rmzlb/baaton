import { useEffect } from 'react';
import { NavLink, useLocation, Link } from 'react-router-dom';
import { UserButton, OrganizationSwitcher } from '@clerk/clerk-react';
import { useQuery } from '@tanstack/react-query';
import {
  LayoutDashboard, Kanban, Settings, ChevronLeft, ChevronRight, Users, X,
  Sun, Moon, CheckSquare, Layers, Globe, Target, Zap, Eye, Inbox, CalendarRange, BarChart3, Webhook, BookOpen, MessageSquare, ExternalLink,
} from 'lucide-react';
import { useUIStore } from '@/stores/ui';
import { useTranslation } from '@/hooks/useTranslation';
import { useApi } from '@/hooks/useApi';
import { cn } from '@/lib/utils';
import type { Issue } from '@/lib/types';

export function Sidebar() {
  const { t, i18n } = useTranslation();
  const collapsed = useUIStore((s) => s.sidebarCollapsed);
  const toggle = useUIStore((s) => s.toggleSidebar);
  const mobileOpen = useUIStore((s) => s.sidebarMobileOpen);
  const closeMobile = useUIStore((s) => s.closeMobileSidebar);
  const theme = useUIStore((s) => s.theme);
  const toggleTheme = useUIStore((s) => s.toggleTheme);

  const location = useLocation();
  const projectSlugMatch = location.pathname.match(/^\/projects\/([^/]+)/);
  const currentProjectSlug = projectSlugMatch ? projectSlugMatch[1] : null;

  const apiClient = useApi();

  const { data: savedViews = [] } = useQuery({
    queryKey: ['saved-views'],
    queryFn: () => apiClient.views.list(),
    staleTime: 60_000,
  });

  const { data: allIssues = [] } = useQuery({
    queryKey: ['all-issues'],
    queryFn: () => apiClient.issues.listAll({ limit: 2000 }),
    staleTime: 60_000,
  });

  const triageCount = allIssues.filter(
    (i: Issue) => i.source === 'form' || (i.assignee_ids.length === 0 && i.status === 'backlog')
  ).length;

  /* ─── Grouped Nav ────────────────────────── */
  const coreItems = [
    { to: '/dashboard', icon: LayoutDashboard, label: t('sidebar.dashboard'), tourId: undefined },
    { to: '/my-tasks', icon: CheckSquare, label: t('sidebar.myTasks'), tourId: 'my-tasks' as const },
    { to: '/all-issues', icon: Layers, label: t('sidebar.allIssues'), tourId: undefined },
    { to: '/triage', icon: Inbox, label: t('sidebar.triage'), tourId: undefined, badge: triageCount > 0 ? triageCount : undefined },
    { to: '/projects', icon: Kanban, label: t('sidebar.projects'), tourId: 'projects-list' as const },
  ];

  const planItems = [
    {
      to: currentProjectSlug ? `/projects/${currentProjectSlug}/milestones` : '/milestones',
      icon: Target,
      label: t('sidebar.milestones'),
      tourId: undefined,
    },
    { to: '/roadmap', icon: CalendarRange, label: t('sidebar.roadmap'), tourId: undefined },
    ...(currentProjectSlug ? [{
      to: `/projects/${currentProjectSlug}/sprints`,
      icon: Zap,
      label: t('sidebar.sprints'),
      tourId: undefined,
    }] : []),
  ];

  const toolItems = [
    { to: '/analytics', icon: BarChart3, label: t('sidebar.analytics'), tourId: undefined },
    { to: '/webhooks', icon: Webhook, label: t('sidebar.webhooks'), tourId: undefined },
  ];

  const toggleLanguage = () => {
    const next = i18n.language === 'fr' ? 'en' : 'fr';
    i18n.changeLanguage(next);
  };

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && mobileOpen) closeMobile();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [mobileOpen, closeMobile]);

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

  const isCompact = collapsed && !mobileOpen;

  /* ─── Render NavItem ─────────────────────── */
  const NavItem = ({ to, icon: Icon, label, tourId, badge }: any) => (
    <NavLink
      key={to}
      to={to}
      onClick={closeMobile}
      aria-label={isCompact ? label : undefined}
      {...(tourId ? { 'data-tour': tourId } : {})}
      className={({ isActive }) =>
        cn(
          'flex items-center gap-3 rounded-lg px-3 py-1.5 text-sm transition-colors min-h-[36px]',
          isActive
            ? 'bg-surface-hover text-primary font-medium'
            : 'text-secondary hover:bg-surface hover:text-primary',
          isCompact && 'justify-center px-0',
        )
      }
    >
      {({ isActive }) => (
        <>
          <Icon size={18} aria-hidden="true" />
          {!isCompact && <span className="flex-1 truncate">{label}</span>}
          {!isCompact && badge !== undefined && (
            <span className="rounded-full bg-accent/20 text-accent px-1.5 py-0.5 text-[10px] font-bold tabular-nums">
              {badge}
            </span>
          )}
          {isActive && <span className="sr-only">(current page)</span>}
        </>
      )}
    </NavLink>
  );

  /* ─── Group Separator ────────────────────── */
  const Divider = ({ label }: { label?: string }) => (
    <div className="pt-3 pb-1">
      {!isCompact && label && (
        <span className="px-3 text-[10px] font-semibold uppercase tracking-wider text-muted">
          {label}
        </span>
      )}
      {isCompact && <div className="mx-3 border-t border-border" />}
    </div>
  );

  return (
    <>
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
          'fixed inset-y-0 left-0 z-50 flex flex-col border-r border-border bg-bg transition-all duration-200',
          collapsed ? 'w-14' : 'w-56',
          'max-md:-translate-x-full max-md:w-56',
          mobileOpen && 'max-md:translate-x-0',
        )}
      >
        {/* Header: Org Switcher */}
        <div className="flex h-12 items-center border-b border-border px-2 justify-between">
          {isCompact ? (
            <Link to="/dashboard" className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent text-black font-bold text-xs mx-auto hover:bg-accent-hover transition-colors" title="Baaton">
              B
            </Link>
          ) : (
            <OrganizationSwitcher
              appearance={{
                elements: {
                  rootBox: 'w-full',
                  organizationSwitcherTrigger:
                    'w-full justify-start px-1 py-1 rounded-lg hover:bg-surface-hover border-none text-sm',
                },
              }}
              afterCreateOrganizationUrl="/dashboard"
              afterSelectOrganizationUrl="/dashboard"
            />
          )}
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
        <nav aria-label={t('sidebar.mainNavigation') || 'Main navigation'} className="flex-1 space-y-0.5 p-1.5 overflow-y-auto">
          {/* Core */}
          {coreItems.map((item) => <NavItem key={item.to} {...item} />)}

          {/* Planning */}
          <Divider label={t('sidebar.planning') || 'Planning'} />
          {planItems.map((item) => <NavItem key={item.to} {...item} />)}

          {/* Tools */}
          <Divider label={t('sidebar.tools') || 'Tools'} />
          {toolItems.map((item) => <NavItem key={item.to} {...item} />)}

          {/* External Links (like AgentMail: Discord/Documentation/Feedback) */}
          <Divider />
          {[
            { href: '/docs', icon: BookOpen, label: t('sidebar.docs'), external: false },
            { href: 'mailto:thibaut@carbonable.io?subject=Baaton Feedback', icon: MessageSquare, label: t('sidebar.feedback'), external: true },
          ].map(({ href, icon: Icon, label, external }) => (
            external ? (
              <a
                key={href}
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                className={cn(
                  'flex items-center gap-3 rounded-lg px-3 py-1.5 text-sm transition-colors min-h-[36px] text-secondary hover:bg-surface hover:text-primary',
                  isCompact && 'justify-center px-0',
                )}
              >
                <Icon size={18} aria-hidden="true" />
                {!isCompact && (
                  <>
                    <span className="flex-1 truncate">{label}</span>
                    <ExternalLink size={12} className="text-muted" />
                  </>
                )}
              </a>
            ) : (
              <NavLink
                key={href}
                to={href}
                onClick={closeMobile}
                className={({ isActive }) =>
                  cn(
                    'flex items-center gap-3 rounded-lg px-3 py-1.5 text-sm transition-colors min-h-[36px]',
                    isActive ? 'bg-surface-hover text-primary font-medium' : 'text-secondary hover:bg-surface hover:text-primary',
                    isCompact && 'justify-center px-0',
                  )
                }
              >
                <Icon size={18} aria-hidden="true" />
                {!isCompact && <span className="flex-1 truncate">{label}</span>}
              </NavLink>
            )
          ))}

          {/* Saved Views */}
          {savedViews.length > 0 && !isCompact && (
            <>
              <Divider label={t('sidebar.views')} />
              {savedViews.map((view) => (
                <NavLink
                  key={view.id}
                  to={`/all-issues?view=${view.id}`}
                  onClick={closeMobile}
                  className={({ isActive }) =>
                    cn(
                      'flex items-center gap-3 rounded-lg px-3 py-1.5 text-sm transition-colors min-h-[32px]',
                      isActive
                        ? 'bg-surface-hover text-primary'
                        : 'text-secondary hover:bg-surface hover:text-primary',
                    )
                  }
                >
                  <Eye size={14} aria-hidden="true" />
                  <span className="truncate">{view.name}</span>
                </NavLink>
              ))}
            </>
          )}
        </nav>

        {/* Footer */}
        <div className="border-t border-border p-2 space-y-1">
          {/* Settings + Team (bottom group) */}
          <NavItem to="/org" icon={Users} label={t('sidebar.team')} />
          <NavItem to="/settings" icon={Settings} label={t('sidebar.settings')} tourId="settings" />

          {/* Theme + Language row */}
          <div className={cn('flex items-center gap-1', isCompact ? 'flex-col' : 'px-1 pt-1')}>
            <button
              onClick={toggleTheme}
              className="rounded-lg p-2 text-secondary hover:bg-surface-hover hover:text-primary transition-colors"
              title={theme === 'dark' ? t('sidebar.lightMode') : t('sidebar.darkMode')}
              aria-label={theme === 'dark' ? t('sidebar.lightMode') : t('sidebar.darkMode')}
            >
              {theme === 'dark' ? <Sun size={16} aria-hidden="true" /> : <Moon size={16} aria-hidden="true" />}
            </button>
            <button
              onClick={toggleLanguage}
              className="rounded-lg p-2 text-secondary hover:bg-surface-hover hover:text-primary transition-colors"
              title={t('sidebar.language')}
              aria-label={t('sidebar.language') || 'Switch language'}
            >
              <Globe size={16} aria-hidden="true" />
            </button>
            <div className="flex-1" />
            {/* User avatar + collapse */}
            <UserButton
              appearance={{
                elements: { avatarBox: 'h-7 w-7' },
              }}
            />
            <button
              onClick={toggle}
              aria-label={collapsed ? (t('sidebar.expand') || 'Expand sidebar') : (t('sidebar.collapse') || 'Collapse sidebar')}
              className="rounded-md p-1.5 text-secondary hover:bg-surface-hover hover:text-primary transition-colors hidden md:block"
            >
              {collapsed ? <ChevronRight size={14} aria-hidden="true" /> : <ChevronLeft size={14} aria-hidden="true" />}
            </button>
          </div>
        </div>
      </aside>
    </>
  );
}
