import { useEffect } from 'react';
import { NavLink, useLocation, Link } from 'react-router-dom';
import { UserButton, OrganizationSwitcher } from '@clerk/clerk-react';
import { useQuery } from '@tanstack/react-query';
import {
  LayoutDashboard, Kanban, PanelLeftClose, PanelLeft, X,
  Sun, Moon, CheckSquare, Layers, Globe, Target, Zap, Eye, Inbox,
  CalendarRange, BarChart3, Webhook, BookOpen, MessageSquare, ExternalLink, KeyRound, Search,
  Flag, Workflow, CreditCard, Bot, Sparkles, Shield,
} from 'lucide-react';
import { useUIStore } from '@/stores/ui';
import { useTranslation } from '@/hooks/useTranslation';
import { useApi } from '@/hooks/useApi';
import { cn } from '@/lib/utils';
import { PixelTanuki } from '@/components/shared/PixelTanuki';
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

  const isCompact = collapsed && !mobileOpen;

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
      if (e.matches) useUIStore.getState().setSidebarCollapsed(true);
    };
    handleChange(mql);
    mql.addEventListener('change', handleChange);
    return () => mql.removeEventListener('change', handleChange);
  }, []);

  /* ─── Nav Groups ─────────────────────────── */
  const coreItems = [
    { to: '/dashboard', icon: LayoutDashboard, label: t('sidebar.dashboard') },
    { to: '/my-tasks', icon: CheckSquare, label: t('sidebar.myTasks'), tourId: 'my-tasks' },
    { to: '/all-issues', icon: Layers, label: t('sidebar.allIssues') },
    { to: '/triage', icon: Inbox, label: t('sidebar.triage'), badge: triageCount > 0 ? triageCount : undefined },
    { to: '/projects', icon: Kanban, label: t('sidebar.projects'), tourId: 'projects-list' },
  ];

  const planItems = [
    { to: currentProjectSlug ? `/projects/${currentProjectSlug}/milestones` : '/milestones', icon: Target, label: t('sidebar.milestones') },
    { to: '/roadmap', icon: CalendarRange, label: t('sidebar.roadmap') },
    ...(currentProjectSlug ? [{ to: `/projects/${currentProjectSlug}/sprints`, icon: Zap, label: t('sidebar.sprints') }] : []),
    { to: '/initiatives', icon: Flag, label: t('sidebar.initiatives') },
  ];

  const toolItems = [
    { to: '/search', icon: Search, label: t('sidebar.search') || 'Search' },
    { to: '/ai', icon: Sparkles, label: t('sidebar.aiChat') },
    { to: '/analytics', icon: BarChart3, label: t('sidebar.analytics') },
    { to: '/webhooks', icon: Webhook, label: t('sidebar.webhooks') },
    { to: '/api-keys', icon: KeyRound, label: t('sidebar.apiKeys') },
    { to: '/billing', icon: CreditCard, label: t('sidebar.billing') },
    { to: '/agent-config', icon: Bot, label: t('sidebar.agentConfig') },
    { to: '/admin', icon: Shield, label: t('sidebar.admin') },
    { to: currentProjectSlug ? `/projects/${currentProjectSlug}/automations` : '/automations', icon: Workflow, label: t('sidebar.automations') },
  ];

  /* ─── Render Helpers ─────────────────────── */
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
          isActive ? 'bg-surface-hover text-primary font-medium' : 'text-secondary hover:bg-surface hover:text-primary',
          isCompact && 'justify-center px-0',
        )
      }
    >
      {({ isActive }) => (
        <>
          <Icon size={18} aria-hidden="true" />
          {!isCompact && <span className="flex-1 truncate">{label}</span>}
          {!isCompact && badge !== undefined && (
            <span className="rounded-full bg-accent/20 text-accent px-1.5 py-0.5 text-[10px] font-bold tabular-nums">{badge}</span>
          )}
          {isActive && <span className="sr-only">(current page)</span>}
        </>
      )}
    </NavLink>
  );

  const Divider = ({ label }: { label?: string }) => (
    <div className="pt-3 pb-1">
      {!isCompact && label && (
        <span className="px-3 text-[10px] font-semibold uppercase tracking-wider text-muted">{label}</span>
      )}
      {isCompact && <div className="mx-3 border-t border-border" />}
    </div>
  );

  const ExtLink = ({ href, icon: Icon, label, isExternal }: { href: string; icon: any; label: string; isExternal?: boolean }) => {
    const cls = cn(
      'flex items-center gap-3 rounded-lg px-3 py-1.5 text-sm transition-colors min-h-[32px] text-muted hover:bg-surface hover:text-secondary',
      isCompact && 'justify-center px-0',
    );
    if (isExternal) {
      return (
        <a href={href} target="_blank" rel="noopener noreferrer" className={cls}>
          <Icon size={16} aria-hidden="true" />
          {!isCompact && (
            <>
              <span className="flex-1 truncate">{label}</span>
              <ExternalLink size={10} className="text-muted/50" />
            </>
          )}
        </a>
      );
    }
    return (
      <NavLink to={href} onClick={closeMobile} className={({ isActive }) => cn(cls, isActive && 'text-secondary bg-surface-hover')}>
        <Icon size={16} aria-hidden="true" />
        {!isCompact && <span className="flex-1 truncate">{label}</span>}
      </NavLink>
    );
  };

  return (
    <>
      {mobileOpen && (
        <div className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm md:hidden" onClick={closeMobile} aria-hidden="true" />
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
        {/* ─── Header: Logo + Collapse ─── */}
        <div className="flex h-12 items-center border-b border-border px-2 justify-between">
          <Link to="/dashboard" className="flex items-center gap-2 hover:opacity-80 transition-opacity min-w-0">
            <div className="flex-shrink-0">
              <PixelTanuki size={isCompact ? 28 : 24} />
            </div>
            {!isCompact && (
              <span className="font-display text-base font-bold text-primary uppercase tracking-wide truncate">Baaton</span>
            )}
          </Link>
          <div className="flex items-center gap-0.5 shrink-0">
            {mobileOpen && (
              <button onClick={closeMobile} className="rounded-md p-1.5 text-secondary hover:bg-surface hover:text-primary transition-colors md:hidden">
                <X size={16} />
              </button>
            )}
            <button
              onClick={toggle}
              className="rounded-md p-1.5 text-muted hover:bg-surface-hover hover:text-secondary transition-colors hidden md:block"
              aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            >
              {collapsed ? <PanelLeft size={16} /> : <PanelLeftClose size={16} />}
            </button>
          </div>
        </div>

        {/* ─── Org Switcher ─── */}
        <div className="border-b border-border px-2 py-1.5">
          {isCompact ? (
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent/10 text-accent font-bold text-xs mx-auto" title="Organization">
              O
            </div>
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
        </div>

        {/* ─── Main Nav ─── */}
        <nav aria-label="Main navigation" className="flex-1 space-y-0.5 p-1.5 overflow-y-auto">
          {coreItems.map((item) => <NavItem key={item.to} {...item} />)}

          <Divider label={t('sidebar.planning')} />
          {planItems.map((item) => <NavItem key={item.to} {...item} />)}

          <Divider label={t('sidebar.tools')} />
          {toolItems.map((item) => <NavItem key={item.to} {...item} />)}

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
                      isActive ? 'bg-surface-hover text-primary' : 'text-secondary hover:bg-surface hover:text-primary',
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

        {/* ─── Bottom Links (AgentMail pattern) ─── */}
        <div className="p-1.5 space-y-0.5">
          <ExtLink href="/docs" icon={BookOpen} label={t('sidebar.docs')} />
          <ExtLink href="mailto:haros@agentmail.to?subject=Baaton Feedback" icon={MessageSquare} label={t('sidebar.feedback')} isExternal />
        </div>

        {/* ─── Footer ─── */}
        <div className="border-t border-border p-2">
          <div className={cn('flex items-center', isCompact ? 'flex-col gap-2' : 'gap-1 px-1')}>
            <UserButton appearance={{ elements: { avatarBox: 'h-7 w-7' } }} />
            {!isCompact && (
              <div className="flex items-center gap-1 ml-auto">
                <button onClick={toggleTheme} className="rounded-lg p-1.5 text-muted hover:bg-surface-hover hover:text-secondary transition-colors"
                  title={theme === 'dark' ? t('sidebar.lightMode') : t('sidebar.darkMode')}>
                  {theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />}
                </button>
                <button onClick={toggleLanguage} className="rounded-lg p-1.5 text-muted hover:bg-surface-hover hover:text-secondary transition-colors"
                  title={t('sidebar.language')}>
                  <Globe size={14} />
                </button>
              </div>
            )}
            {isCompact && (
              <>
                <button onClick={toggleTheme} className="rounded-lg p-1.5 text-muted hover:bg-surface-hover hover:text-secondary transition-colors">
                  {theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />}
                </button>
                <button onClick={toggleLanguage} className="rounded-lg p-1.5 text-muted hover:bg-surface-hover hover:text-secondary transition-colors">
                  <Globe size={14} />
                </button>
              </>
            )}
          </div>
        </div>
      </aside>
    </>
  );
}
