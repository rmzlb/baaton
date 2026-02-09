/**
 * Global "New Issue" button + modal with project selector.
 * Can be used from Dashboard, All Issues, or any page.
 * Step 0: Select project → then delegates to CreateIssueModal.
 */
import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Plus, Kanban, Search, ChevronRight } from 'lucide-react';
import { useApi } from '@/hooks/useApi';
import { useTranslation } from '@/hooks/useTranslation';
import { CreateIssueModal } from './CreateIssueModal';
import { cn } from '@/lib/utils';
import type { Project } from '@/lib/types';

interface GlobalCreateIssueButtonProps {
  /** "big" = full-width CTA on dashboard, "compact" = small icon button */
  variant?: 'big' | 'compact';
  className?: string;
}

export function GlobalCreateIssueButton({ variant = 'big', className }: GlobalCreateIssueButtonProps) {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);

  return (
    <>
      {variant === 'big' ? (
        <button
          onClick={() => setIsOpen(true)}
          className={cn(
            'flex items-center justify-center gap-2.5 w-full',
            'rounded-xl border-2 border-dashed border-accent/40 bg-accent/5',
            'px-6 py-4 text-accent font-semibold text-sm',
            'hover:border-accent hover:bg-accent/10 transition-all duration-200',
            'group',
            className,
          )}
        >
          <Plus size={20} className="group-hover:rotate-90 transition-transform duration-200" />
          {t('global.newIssue')}
        </button>
      ) : (
        <button
          onClick={() => setIsOpen(true)}
          className={cn(
            'flex items-center gap-1.5 px-3 py-1.5 rounded-lg',
            'bg-accent text-black text-xs font-semibold',
            'hover:bg-accent/90 transition-colors',
            className,
          )}
          title={t('global.newIssue')}
        >
          <Plus size={14} />
          <span className="hidden sm:inline">{t('global.newIssue')}</span>
        </button>
      )}

      {isOpen && <GlobalCreateModal onClose={() => setIsOpen(false)} />}
    </>
  );
}

function GlobalCreateModal({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const apiClient = useApi();
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [search, setSearch] = useState('');

  // Fetch all projects
  const { data: projects = [], isLoading } = useQuery({
    queryKey: ['projects'],
    queryFn: () => apiClient.projects.list(),
  });

  // Fetch tags for selected project
  const { data: projectTags = [] } = useQuery({
    queryKey: ['tags', selectedProject?.id],
    queryFn: () => apiClient.tags.listByProject(selectedProject!.id),
    enabled: !!selectedProject,
  });

  // Filter projects by search
  const filtered = useMemo(() => {
    if (!search.trim()) return projects;
    const q = search.toLowerCase();
    return projects.filter(
      p => p.name.toLowerCase().includes(q) || p.prefix.toLowerCase().includes(q),
    );
  }, [projects, search]);

  // If project selected → show the typeform create modal
  if (selectedProject) {
    return (
      <CreateIssueModal
        project={selectedProject}
        projectTags={projectTags}
        onClose={onClose}
      />
    );
  }

  // Step 0: Project selection
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      {/* Modal */}
      <div className="relative w-full max-w-md mx-4 rounded-2xl border border-border bg-surface shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="p-6 pb-4">
          <h2 className="text-lg font-bold text-primary">{t('global.selectProject')}</h2>
          <p className="mt-1 text-sm text-secondary">{t('global.selectProjectDesc')}</p>
        </div>

        {/* Search */}
        <div className="px-6 pb-3">
          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('global.searchProject')}
              className="w-full pl-9 pr-3 py-2.5 rounded-lg border border-border bg-bg text-sm text-primary placeholder-muted outline-none focus:border-accent transition-colors"
              autoFocus
            />
          </div>
        </div>

        {/* Project list */}
        <div className="px-3 pb-3 max-h-[340px] overflow-y-auto">
          {isLoading ? (
            <div className="flex items-center justify-center py-12 text-sm text-secondary">
              {t('global.loading')}
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12">
              <Kanban size={28} className="text-secondary mb-2" />
              <p className="text-sm text-secondary">{t('global.noProjects')}</p>
            </div>
          ) : (
            <div className="space-y-1">
              {filtered.map((project) => (
                <button
                  key={project.id}
                  onClick={() => setSelectedProject(project)}
                  className="flex items-center gap-3 w-full rounded-xl px-3 py-3 hover:bg-surface-hover transition-colors group text-left"
                >
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-bg border border-border text-xs font-bold font-mono text-accent shrink-0">
                    {project.prefix}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-primary truncate">{project.name}</p>
                    {project.description && (
                      <p className="text-xs text-muted truncate mt-0.5">{project.description}</p>
                    )}
                  </div>
                  <ChevronRight
                    size={16}
                    className="text-secondary opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                  />
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-border flex items-center justify-between">
          <span className="text-xs text-muted">
            {filtered.length} {t('global.projectCount')}
          </span>
          <button
            onClick={onClose}
            className="text-xs text-secondary hover:text-primary transition-colors"
          >
            {t('global.cancel')}
          </button>
        </div>
      </div>
    </div>
  );
}
