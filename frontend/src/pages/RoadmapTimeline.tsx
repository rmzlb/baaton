import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { CalendarRange } from 'lucide-react';
import { useApi } from '@/hooks/useApi';
import { useTranslation } from '@/hooks/useTranslation';
import { cn } from '@/lib/utils';

interface TimelineItem {
  id: string;
  type: 'milestone' | 'sprint';
  name: string;
  projectId: string;
  projectSlug: string;
  projectPrefix: string;
  start: Date;
  end: Date;
  status: string;
}

function addDays(base: Date, days: number): Date {
  const d = new Date(base);
  d.setDate(d.getDate() + days);
  return d;
}

export default function RoadmapTimeline() {
  const { t } = useTranslation();
  const api = useApi();
  const [projectFilter, setProjectFilter] = useState<string | null>(null);

  const { data: projects = [] } = useQuery({
    queryKey: ['projects'],
    queryFn: () => api.projects.list(),
  });

  const { data: items = [], isLoading } = useQuery({
    queryKey: ['roadmap-items', projects.map((p) => p.id).join(',')],
    enabled: projects.length > 0,
    queryFn: async () => {
      const perProject = await Promise.all(projects.map(async (project) => {
        const [milestones, sprints] = await Promise.all([
          api.milestones.listByProject(project.id),
          api.sprints.listByProject(project.id),
        ]);

        const milestoneItems: TimelineItem[] = milestones.map((m) => {
          const start = new Date(m.created_at);
          const end = m.target_date ? new Date(m.target_date) : addDays(start, 21);
          return {
            id: m.id,
            type: 'milestone',
            name: m.name,
            projectId: project.id,
            projectSlug: project.slug,
            projectPrefix: project.prefix,
            start,
            end: end < start ? start : end,
            status: m.status,
          };
        });

        const sprintItems: TimelineItem[] = sprints
          .filter((s) => s.start_date || s.end_date)
          .map((s) => {
            const start = s.start_date ? new Date(s.start_date) : new Date(s.created_at);
            const end = s.end_date ? new Date(s.end_date) : addDays(start, 14);
            return {
              id: s.id,
              type: 'sprint',
              name: s.name,
              projectId: project.id,
              projectSlug: project.slug,
              projectPrefix: project.prefix,
              start,
              end: end < start ? start : end,
              status: s.status,
            };
          });

        return [...milestoneItems, ...sprintItems];
      }));

      return perProject.flat();
    },
  });

  const filtered = useMemo(() => {
    return projectFilter ? items.filter((i) => i.projectId === projectFilter) : items;
  }, [items, projectFilter]);

  const { minDate, maxDate, groups } = useMemo(() => {
    const now = new Date();
    let min = addDays(now, -7);
    let max = addDays(now, 30);

    for (const item of filtered) {
      if (item.start < min) min = item.start;
      if (item.end > max) max = item.end;
    }

    const grouped = new Map<string, TimelineItem[]>();
    filtered.forEach((item) => {
      const key = `${item.projectId}:${item.projectPrefix}`;
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key)!.push(item);
    });

    return {
      minDate: addDays(min, -3),
      maxDate: addDays(max, 5),
      groups: Array.from(grouped.entries()),
    };
  }, [filtered]);

  const totalMs = Math.max(1, maxDate.getTime() - minDate.getTime());

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-primary">{t('roadmap.title')}</h1>
          <p className="text-xs text-secondary mt-1">{t('roadmap.subtitle')}</p>
        </div>
        <CalendarRange size={20} className="text-accent" />
      </div>

      {projects.length > 1 && (
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setProjectFilter(null)}
            className={cn('rounded-full px-3 py-1 text-xs', !projectFilter ? 'bg-accent text-black' : 'bg-surface text-secondary')}
          >
            {t('roadmap.allProjects')}
          </button>
          {projects.map((p) => (
            <button
              key={p.id}
              onClick={() => setProjectFilter(projectFilter === p.id ? null : p.id)}
              className={cn('rounded-full px-3 py-1 text-xs', projectFilter === p.id ? 'bg-accent text-black' : 'bg-surface text-secondary')}
            >
              {p.name}
            </button>
          ))}
        </div>
      )}

      {isLoading ? (
        <div className="text-sm text-secondary py-16 text-center">{t('common.loading')}</div>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-12 text-center text-sm text-secondary">{t('roadmap.empty')}</div>
      ) : (
        <div className="rounded-xl border border-border bg-surface overflow-x-auto">
          <div className="min-w-[820px]">
            <div className="grid grid-cols-[200px_1fr] border-b border-border bg-surface-hover/40">
              <div className="px-4 py-2 text-[11px] font-medium text-muted uppercase">{t('roadmap.project')}</div>
              <div className="px-4 py-2 text-[11px] font-medium text-muted uppercase">{t('roadmap.timeline')}</div>
            </div>

            <div className="space-y-0">
              {groups.map(([groupKey, groupItems]) => {
                const [projectId, prefix] = groupKey.split(':');
                const project = projects.find((p) => p.id === projectId);
                return (
                  <div key={groupKey} className="grid grid-cols-[200px_1fr] border-b border-border/60 min-h-[78px]">
                    <div className="px-4 py-3">
                      <Link to={`/projects/${project?.slug}`} className="text-sm font-semibold text-primary hover:text-accent">
                        {project?.name}
                      </Link>
                      <div className="text-[10px] text-muted font-mono mt-1">{prefix}</div>
                    </div>
                    <div className="relative px-4 py-3">
                      {groupItems.map((item) => {
                        const left = ((item.start.getTime() - minDate.getTime()) / totalMs) * 100;
                        const width = Math.max(3, ((item.end.getTime() - item.start.getTime()) / totalMs) * 100);
                        return (
                          <div
                            key={item.id}
                            className={cn(
                              'absolute h-6 rounded-md border text-[10px] px-2 flex items-center overflow-hidden whitespace-nowrap',
                              item.type === 'milestone'
                                ? 'bg-blue-500/15 border-blue-400/40 text-blue-200'
                                : 'bg-emerald-500/15 border-emerald-400/40 text-emerald-200',
                            )}
                            style={{ left: `${left}%`, width: `${width}%`, top: item.type === 'milestone' ? '8px' : '38px' }}
                            title={`${item.name} (${item.start.toLocaleDateString()} → ${item.end.toLocaleDateString()})`}
                          >
                            <span className="truncate">{item.name}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
