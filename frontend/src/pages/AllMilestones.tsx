import { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Target, Calendar } from 'lucide-react';
import { useApi } from '@/hooks/useApi';
import { useTranslation } from '@/hooks/useTranslation';
import { cn } from '@/lib/utils';
import type { Milestone, Project, MilestoneStatus } from '@/lib/types';

const STATUS_STYLES: Record<MilestoneStatus, { bg: string; text: string; dot: string }> = {
  active: { bg: 'bg-blue-50 dark:bg-blue-500/10', text: 'text-blue-700 dark:text-blue-400', dot: 'bg-blue-500' },
  completed: { bg: 'bg-emerald-50 dark:bg-emerald-500/10', text: 'text-emerald-700 dark:text-emerald-400', dot: 'bg-emerald-500' },
  cancelled: { bg: 'bg-gray-100 dark:bg-gray-500/10', text: 'text-gray-600 dark:text-gray-400', dot: 'bg-gray-500' },
};

interface MilestoneWithProject extends Milestone {
  project: Project;
}

export function AllMilestones() {
  const { t } = useTranslation();
  const apiClient = useApi();
  const [filterProjectId, setFilterProjectId] = useState<string | null>(null);

  const { data: projects = [] } = useQuery({
    queryKey: ['projects'],
    queryFn: () => apiClient.projects.list(),
  });

  const { data: allMilestones = [], isLoading } = useQuery({
    queryKey: ['all-milestones', projects.map((p) => p.id)],
    queryFn: async () => {
      const results = await Promise.all(
        projects.map(async (p) => {
          const milestones = await apiClient.milestones.listByProject(p.id);
          return milestones.map((m) => ({ ...m, project: p }));
        })
      );
      return results.flat() as MilestoneWithProject[];
    },
    enabled: projects.length > 0,
  });

  const filtered = useMemo(() => {
    if (!filterProjectId) return allMilestones;
    return allMilestones.filter((m) => m.project_id === filterProjectId);
  }, [allMilestones, filterProjectId]);

  const grouped = useMemo(() => {
    const map = new Map<string, { project: Project; milestones: MilestoneWithProject[] }>();
    for (const m of filtered) {
      if (!map.has(m.project_id)) {
        map.set(m.project_id, { project: m.project, milestones: [] });
      }
      map.get(m.project_id)!.milestones.push(m);
    }
    return Array.from(map.values());
  }, [filtered]);

  return (
    <div className="p-4 md:p-6">
      <div className="mb-6">
        <h1 className="text-xl md:text-2xl font-bold text-primary">{t('milestones.allTitle')}</h1>
      </div>

      {/* Project filter chips */}
      {projects.length > 1 && (
        <div className="flex flex-wrap gap-2 mb-6">
          <button
            onClick={() => setFilterProjectId(null)}
            className={cn(
              'rounded-full px-3 py-1 text-xs font-medium transition-colors',
              !filterProjectId
                ? 'bg-accent text-black'
                : 'bg-surface-hover text-secondary hover:text-primary'
            )}
          >
            All
          </button>
          {projects.map((p) => (
            <button
              key={p.id}
              onClick={() => setFilterProjectId(filterProjectId === p.id ? null : p.id)}
              className={cn(
                'rounded-full px-3 py-1 text-xs font-medium transition-colors',
                filterProjectId === p.id
                  ? 'bg-accent text-black'
                  : 'bg-surface-hover text-secondary hover:text-primary'
              )}
            >
              {p.name}
            </button>
          ))}
        </div>
      )}

      {isLoading ? (
        <div className="flex items-center justify-center py-24 text-sm text-secondary">
          {t('common.loading')}
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border py-24">
          <Target size={48} className="text-secondary mb-4" />
          <p className="text-sm text-secondary">{t('milestones.noMilestones')}</p>
        </div>
      ) : (
        <div className="space-y-8">
          {grouped.map(({ project, milestones }) => (
            <div key={project.id}>
              <Link
                to={`/projects/${project.slug}`}
                className="text-sm font-semibold text-secondary hover:text-primary transition-colors mb-3 block"
              >
                <span className="font-mono text-xs text-accent mr-2">{project.prefix}</span>
                {project.name}
              </Link>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {milestones.map((m) => {
                  const style = STATUS_STYLES[m.status];
                  return (
                    <Link
                      key={m.id}
                      to={`/projects/${project.slug}/milestones`}
                      className="rounded-xl border border-border bg-surface p-4 hover:bg-surface-hover transition-colors"
                    >
                      <div className="flex items-start justify-between mb-2">
                        <h3 className="text-sm font-semibold text-primary">{m.name}</h3>
                        <span className={cn('inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-medium', style.bg, style.text)}>
                          <span className={cn('h-1.5 w-1.5 rounded-full', style.dot)} />
                          {t(`milestones.status.${m.status}`)}
                        </span>
                      </div>
                      {m.description && (
                        <p className="text-xs text-secondary line-clamp-2 mb-2">{m.description}</p>
                      )}
                      {m.target_date && (
                        <div className="flex items-center gap-1.5 text-[10px] text-secondary">
                          <Calendar size={10} />
                          {t('milestones.targetDate')}: {new Date(m.target_date).toLocaleDateString()}
                        </div>
                      )}
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default AllMilestones;
