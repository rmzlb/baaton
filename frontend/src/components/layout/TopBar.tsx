import { useEffect, useCallback, useState, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useOrganizationList, useOrganization } from '@clerk/clerk-react';
import { Command } from 'cmdk';
import {
  Search, ChevronRight, Menu,
  LayoutDashboard, Kanban, Settings, FileText, Hash,
  Building2, CheckCircle, ArrowRight, Plus, ListTodo,
} from 'lucide-react';
import { useUIStore } from '@/stores/ui';
import { useApi } from '@/hooks/useApi';
import { useTranslation } from '@/hooks/useTranslation';
import { cn } from '@/lib/utils';
import type { Issue, Project } from '@/lib/types';

export function TopBar() {
  const { t } = useTranslation();
  const commandBarOpen = useUIStore((s) => s.commandBarOpen);
  const openCommandBar = useUIStore((s) => s.openCommandBar);
  const closeCommandBar = useUIStore((s) => s.closeCommandBar);
  const openMobileSidebar = useUIStore((s) => s.openMobileSidebar);
  const location = useLocation();

  // Cmd+K shortcut
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        if (commandBarOpen) {
          closeCommandBar();
        } else {
          openCommandBar();
        }
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [commandBarOpen, openCommandBar, closeCommandBar]);

  // Breadcrumb from URL
  const breadcrumbs = buildBreadcrumbs(location.pathname, t);

  return (
    <>
      <header className="sticky top-0 z-20 flex h-12 items-center justify-between border-b border-border bg-bg px-3 md:px-5 shrink-0" role="banner">
        {/* Left: mobile menu + breadcrumb */}
        <div className="flex items-center gap-2 min-w-0">
          <button
            onClick={openMobileSidebar}
            aria-label={t('topbar.openMenu') || 'Open menu'}
            className="rounded-md p-1.5 text-secondary hover:bg-surface hover:text-primary transition-colors md:hidden"
          >
            <Menu size={18} aria-hidden="true" />
          </button>
          <nav aria-label={t('topbar.breadcrumb') || 'Breadcrumb'} className="flex items-center gap-1 text-sm min-w-0">
            {breadcrumbs.map((crumb, i) => (
              <span key={i} className="flex items-center gap-1 min-w-0">
                {i > 0 && <ChevronRight size={12} className="text-muted shrink-0" />}
                <span
                  className={cn(
                    'truncate',
                    i === breadcrumbs.length - 1
                      ? 'text-primary font-medium'
                      : 'text-secondary',
                  )}
                >
                  {crumb}
                </span>
              </span>
            ))}
          </nav>
        </div>

        {/* Right: search trigger */}
        <button
          onClick={openCommandBar}
          aria-label={t('topbar.search') || 'Search'}
          className="flex items-center gap-2 rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs text-secondary hover:border-border hover:text-primary transition-colors"
        >
          <Search size={14} aria-hidden="true" />
          <span className="hidden sm:inline">{t('topbar.search')}</span>
          <kbd className="hidden sm:inline-flex items-center gap-0.5 rounded bg-surface-hover px-1.5 py-0.5 text-[10px] font-mono text-muted">
            ⌘K
          </kbd>
        </button>
      </header>

      {/* Command Palette */}
      {commandBarOpen && <CommandPalette onClose={closeCommandBar} />}
    </>
  );
}

function buildBreadcrumbs(pathname: string, t: (key: string) => string): string[] {
  const parts = pathname.split('/').filter(Boolean);
  if (parts.length === 0) return [t('sidebar.dashboard')];

  const crumbs: string[] = [];
  for (const part of parts) {
    switch (part) {
      case 'dashboard':
        crumbs.push(t('sidebar.dashboard'));
        break;
      case 'projects':
        crumbs.push(t('sidebar.projects'));
        break;
      case 'settings':
        crumbs.push(t('sidebar.settings'));
        break;
      case 'org':
        crumbs.push(t('sidebar.team'));
        break;
      case 'my-tasks':
        crumbs.push(t('sidebar.myTasks'));
        break;
      case 'all-issues':
        crumbs.push(t('sidebar.allIssues'));
        break;
      default:
        // Project slug or other
        crumbs.push(part);
        break;
    }
  }
  return crumbs;
}

function CommandPalette({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const apiClient = useApi();
  const [search, setSearch] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  // Clerk orgs
  const { organization } = useOrganization();
  const { userMemberships, setActive } = useOrganizationList({
    userMemberships: { infinite: true },
  });
  const orgs = userMemberships?.data ?? [];

  // Fetch projects for search
  const { data: projects = [] } = useQuery({
    queryKey: ['projects'],
    queryFn: () => apiClient.projects.list(),
    staleTime: 30_000,
  });

  // Fetch issues from all projects for search
  const { data: allIssues = [] } = useQuery({
    queryKey: ['all-issues-cmd', projects.map((p) => p.id)],
    queryFn: async () => {
      if (projects.length === 0) return [];
      const results = await Promise.all(
        projects.map((p) => apiClient.issues.listByProject(p.id)),
      );
      return results.flat();
    },
    enabled: projects.length > 0,
    staleTime: 30_000,
  });

  const runAction = useCallback(
    (path: string) => {
      onClose();
      navigate(path);
    },
    [navigate, onClose],
  );

  const switchOrg = useCallback(
    async (orgId: string) => {
      if (setActive) {
        await setActive({ organization: orgId });
        onClose();
        navigate('/dashboard');
      }
    },
    [setActive, onClose, navigate],
  );

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  // Filter
  const q = search.toLowerCase();

  // Sort all issues by updated_at descending (recent first)
  const sortedIssues = [...allIssues].sort(
    (a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime(),
  );

  const filteredIssues = q
    ? allIssues.filter(
        (i) =>
          i.title.toLowerCase().includes(q) ||
          i.display_id.toLowerCase().includes(q) ||
          i.tags.some((tag) => tag.toLowerCase().includes(q)),
      ).slice(0, 10)
    : sortedIssues.slice(0, 6); // show recent issues even without search

  const filteredProjects = q
    ? projects.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          p.slug.toLowerCase().includes(q) ||
          p.prefix.toLowerCase().includes(q),
      ).slice(0, 5)
    : projects.slice(0, 5);

  const filteredOrgs = q
    ? orgs.filter(
        (m) => m.organization.name.toLowerCase().includes(q) ||
               m.organization.slug?.toLowerCase().includes(q),
      )
    : orgs;

  // Project map for issue results
  const projectMap = projects.reduce((acc, p) => {
    acc[p.id] = p;
    return acc;
  }, {} as Record<string, Project>);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[12vh] sm:pt-[18vh]" role="dialog" aria-modal="true" aria-label={t('topbar.commandPalette') || 'Command palette'}>
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/40 dark:bg-black/60 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Dialog */}
      <div className="relative w-full max-w-xl mx-4 rounded-xl border border-border bg-surface shadow-2xl shadow-black/20 dark:shadow-black/50 overflow-hidden">
        <Command label="Global search" shouldFilter={false}>
          <div className="flex items-center border-b border-border px-4">
            <Search size={18} className="text-accent shrink-0" />
            <Command.Input
              ref={inputRef}
              value={search}
              onValueChange={setSearch}
              placeholder={t('topbar.searchPlaceholder')}
              autoFocus
              className="h-13 w-full bg-transparent px-3 text-sm text-primary placeholder-muted outline-none"
            />
            <kbd className="hidden sm:inline-flex shrink-0 items-center rounded bg-surface-hover px-1.5 py-0.5 text-[10px] font-mono text-muted">
              ESC
            </kbd>
          </div>

          <Command.List className="max-h-[420px] overflow-y-auto p-2">
            <Command.Empty className="px-4 py-10 text-center text-sm text-muted">
              {t('topbar.noResults')}
            </Command.Empty>

            {/* Quick Actions */}
            {!q && (
              <Command.Group heading={<GroupHeading>{t('topbar.quickActions')}</GroupHeading>}>
                <PaletteItem icon={<Plus size={16} className="text-accent" />} onSelect={() => runAction('/dashboard')}>
                  {t('global.newIssue')}
                </PaletteItem>
                <PaletteItem icon={<LayoutDashboard size={16} />} onSelect={() => runAction('/dashboard')}>
                  {t('sidebar.dashboard')}
                </PaletteItem>
                <PaletteItem icon={<ListTodo size={16} />} onSelect={() => runAction('/my-tasks')}>
                  {t('sidebar.myTasks')}
                </PaletteItem>
                <PaletteItem icon={<Kanban size={16} />} onSelect={() => runAction('/all-issues')}>
                  {t('sidebar.allIssues')}
                </PaletteItem>
                <PaletteItem icon={<Settings size={16} />} onSelect={() => runAction('/settings')}>
                  {t('sidebar.settings')}
                </PaletteItem>
              </Command.Group>
            )}

            {/* Organizations */}
            {filteredOrgs.length > 1 && (
              <Command.Group heading={<GroupHeading>{t('topbar.organizations')}</GroupHeading>}>
                {filteredOrgs.map((m) => {
                  const isActive = m.organization.id === organization?.id;
                  return (
                    <PaletteItem
                      key={m.organization.id}
                      icon={
                        isActive
                          ? <CheckCircle size={16} className="text-accent" />
                          : <Building2 size={16} />
                      }
                      onSelect={() => {
                        if (!isActive) switchOrg(m.organization.id);
                        else onClose();
                      }}
                      subtitle={
                        isActive
                          ? <span className="text-[10px] text-accent font-medium">{t('topbar.activeOrg')}</span>
                          : <span className="flex items-center gap-1 text-[10px] text-muted"><ArrowRight size={10} /> {t('topbar.switchOrg')}</span>
                      }
                    >
                      {m.organization.name}
                    </PaletteItem>
                  );
                })}
              </Command.Group>
            )}

            {/* Projects */}
            {filteredProjects.length > 0 && (
              <Command.Group heading={<GroupHeading>{t('topbar.projects')}</GroupHeading>}>
                {filteredProjects.map((p: Project) => (
                  <PaletteItem
                    key={p.id}
                    icon={<span className="text-[10px] font-mono font-bold text-accent">{p.prefix}</span>}
                    onSelect={() => runAction(`/projects/${p.slug}`)}
                  >
                    {p.name}
                  </PaletteItem>
                ))}
              </Command.Group>
            )}

            {/* Issues */}
            {filteredIssues.length > 0 && (
              <Command.Group heading={<GroupHeading>{q ? t('topbar.issues') : t('topbar.recentIssues')}</GroupHeading>}>
                {filteredIssues.map((issue: Issue) => (
                  <PaletteItem
                    key={issue.id}
                    icon={<FileText size={14} className="text-secondary" />}
                    onSelect={() => runAction(`/all-issues?issue=${issue.display_id}`)}
                    subtitle={
                      <span className="flex items-center gap-1.5">
                        <span className="font-mono text-[10px] text-secondary">{issue.display_id}</span>
                        <span className={cn(
                          'rounded-full px-1.5 py-0.5 text-[9px] font-medium',
                          issue.status === 'done' ? 'bg-green-500/15 text-green-400' :
                          issue.status === 'in_progress' ? 'bg-amber-500/15 text-amber-400' :
                          issue.status === 'in_review' ? 'bg-violet-500/15 text-violet-400' :
                          issue.status === 'todo' ? 'bg-blue-500/15 text-blue-400' :
                          issue.status === 'cancelled' ? 'bg-red-500/15 text-red-400' :
                          'bg-surface-hover text-muted'
                        )}>
                          {issue.status.replace('_', ' ')}
                        </span>
                        {projectMap[issue.project_id] && (
                          <span className="text-[10px] text-muted">· {projectMap[issue.project_id].name}</span>
                        )}
                      </span>
                    }
                  >
                    {issue.title}
                  </PaletteItem>
                ))}
              </Command.Group>
            )}
          </Command.List>

          {/* Footer */}
          <div className="flex items-center justify-between border-t border-border px-4 py-2 text-[10px] text-muted">
            <span>{t('topbar.searchHint')}</span>
            <span className="flex items-center gap-2">
              <kbd className="rounded bg-surface-hover px-1 py-0.5 font-mono">↑↓</kbd>
              {t('topbar.navigate')}
              <kbd className="rounded bg-surface-hover px-1 py-0.5 font-mono">↵</kbd>
              {t('topbar.select')}
            </span>
          </div>
        </Command>
      </div>
    </div>
  );
}

function GroupHeading({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-[10px] font-semibold uppercase tracking-wider text-muted px-2">
      {children}
    </span>
  );
}

function PaletteItem({
  children,
  icon,
  subtitle,
  onSelect,
}: {
  children: React.ReactNode;
  icon?: React.ReactNode;
  subtitle?: React.ReactNode;
  onSelect: () => void;
}) {
  return (
    <Command.Item
      onSelect={onSelect}
      className="flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-primary data-[selected=true]:bg-surface-hover transition-colors"
    >
      <span className="flex h-5 w-5 shrink-0 items-center justify-center text-secondary">
        {icon}
      </span>
      <span className="flex-1 truncate min-w-0">
        <span className="block truncate">{children}</span>
        {subtitle && <span className="block mt-0.5">{subtitle}</span>}
      </span>
    </Command.Item>
  );
}
