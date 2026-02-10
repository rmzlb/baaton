import { useState, useMemo, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Plus, Target, Calendar, Bug, Sparkles, Zap, ChevronDown, ChevronRight,
  Trash2, X, Bot,
} from 'lucide-react';
import { useApi } from '@/hooks/useApi';
import { useTranslation } from '@/hooks/useTranslation';
import { useAIAssistantStore } from '@/stores/ai-assistant';
import { cn } from '@/lib/utils';
import { GanttTimeline } from '@/components/milestones/GanttTimeline';
import { MilestoneDetail } from '@/components/milestones/MilestoneDetail';
import type { Milestone, MilestoneStatus, Issue } from '@/lib/types';

/* ── Status badge colors ─────────────────────── */
const STATUS_STYLES: Record<MilestoneStatus, { bg: string; text: string; dot: string }> = {
  active: {
    bg: 'bg-blue-50 dark:bg-blue-500/10',
    text: 'text-blue-700 dark:text-blue-400',
    dot: 'bg-blue-500',
  },
  completed: {
    bg: 'bg-emerald-50 dark:bg-emerald-500/10',
    text: 'text-emerald-700 dark:text-emerald-400',
    dot: 'bg-emerald-500',
  },
  cancelled: {
    bg: 'bg-gray-100 dark:bg-gray-500/10',
    text: 'text-gray-600 dark:text-gray-400',
    dot: 'bg-gray-400',
  },
};

/* ── Compute effective status ──────────────────── */
function computeEffectiveStatus(
  milestone: Milestone,
  issues: Issue[],
): MilestoneStatus {
  // If explicitly cancelled, keep it
  if (milestone.status === 'cancelled') return 'cancelled';

  const total = issues.length;
  const done = issues.filter((i) => i.status === 'done').length;

  // Auto-complete: all issues done
  if (total > 0 && done === total) return 'completed';

  // At-risk: target_date passed with remaining issues
  if (
    milestone.target_date &&
    new Date(milestone.target_date) < new Date() &&
    done < total
  ) {
    // We still report 'active' but the card will show the overdue badge
    return 'active';
  }

  return milestone.status;
}

export function Milestones() {
  const { t } = useTranslation();
  const { slug } = useParams<{ slug: string }>();
  const apiClient = useApi();
  const queryClient = useQueryClient();
  const [showCards, setShowCards] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);

  // Fetch project by slug
  const { data: project } = useQuery({
    queryKey: ['project', slug],
    queryFn: () => apiClient.projects.getBySlug(slug!),
    enabled: !!slug,
  });

  // Fetch milestones
  const { data: milestones = [], isLoading } = useQuery({
    queryKey: ['milestones', project?.id],
    queryFn: () => apiClient.milestones.listByProject(project!.id),
    enabled: !!project?.id,
  });

  // Fetch all project issues (for stats)
  const { data: allIssues = [] } = useQuery({
    queryKey: ['issues', project?.id],
    queryFn: () => apiClient.issues.listByProject(project!.id),
    enabled: !!project?.id,
  });

  // Group issues by milestone
  const issuesByMilestone = useMemo(() => {
    const map: Record<string, Issue[]> = {};
    for (const issue of allIssues) {
      if (issue.milestone_id) {
        if (!map[issue.milestone_id]) map[issue.milestone_id] = [];
        map[issue.milestone_id].push(issue);
      }
    }
    return map;
  }, [allIssues]);

  // Status auto-computation: auto-complete milestones when all issues done
  const updateMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: MilestoneStatus }) =>
      apiClient.milestones.update(id, { status }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['milestones', project?.id] });
    },
  });

  useEffect(() => {
    for (const milestone of milestones) {
      const issues = issuesByMilestone[milestone.id] || [];
      const effective = computeEffectiveStatus(milestone, issues);
      // Auto-complete: all done but milestone still active
      if (effective === 'completed' && milestone.status === 'active') {
        updateMutation.mutate({ id: milestone.id, status: 'completed' });
      }
    }
    // Only run when milestones/issues data changes, not on mutation ref changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [milestones, issuesByMilestone]);

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiClient.milestones.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['milestones', project?.id] });
    },
  });

  const handleDelete = (milestone: Milestone) => {
    if (window.confirm(t('milestones.deleteConfirm', { name: milestone.name }))) {
      deleteMutation.mutate(milestone.id);
    }
  };

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent/10">
            <Target size={18} className="text-accent" />
          </div>
          <div>
            <h1 className="text-xl font-semibold text-gray-900 dark:text-primary">
              {t('milestones.title')}
            </h1>
            {project && (
              <p className="text-sm text-gray-500 dark:text-muted">{project.name}</p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Show/hide cards toggle */}
          {milestones.length > 0 && (
            <button
              onClick={() => setShowCards(!showCards)}
              className={cn(
                'rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors',
                showCards
                  ? 'border-gray-300 dark:border-border bg-gray-100 dark:bg-surface-hover text-gray-900 dark:text-primary'
                  : 'border-gray-200 dark:border-border bg-white dark:bg-surface text-gray-500 dark:text-muted hover:text-gray-900 dark:hover:text-primary',
              )}
            >
              {t('milestones.list')}
            </button>
          )}

          {/* AI Plan button */}
          <button
            onClick={() => {
              const store = useAIAssistantStore.getState();
              store.setInput('Plan milestones for this project. Analyze all open tickets, group them into logical milestones, estimate timing, and suggest priorities.');
              store.setOpen(true);
            }}
            className="flex items-center gap-1.5 rounded-lg border border-purple-200 dark:border-purple-500/30 bg-purple-50 dark:bg-purple-500/10 px-3.5 py-2 text-sm font-medium text-purple-700 dark:text-purple-400 hover:bg-purple-100 dark:hover:bg-purple-500/20 transition-colors"
          >
            <Bot size={16} />
            {t('milestones.aiPlan')}
          </button>

          {/* New milestone button */}
          <button
            onClick={() => setShowCreateModal(true)}
            className="flex items-center gap-1.5 rounded-lg bg-accent px-3.5 py-2 text-sm font-medium text-black hover:bg-accent-hover transition-colors"
          >
            <Plus size={16} />
            {t('milestones.new')}
          </button>
        </div>
      </div>

      {/* Loading */}
      {isLoading && (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="animate-pulse rounded-xl border border-gray-200 dark:border-border bg-white dark:bg-surface p-5">
              <div className="flex items-center gap-3">
                <div className="h-5 w-32 rounded bg-gray-200 dark:bg-surface-hover" />
                <div className="h-5 w-16 rounded-full bg-gray-200 dark:bg-surface-hover" />
              </div>
              <div className="mt-3 h-2 w-full rounded-full bg-gray-200 dark:bg-surface-hover" />
            </div>
          ))}
        </div>
      )}

      {/* Empty state */}
      {!isLoading && milestones.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gray-100 dark:bg-surface mb-4">
            <Target size={28} className="text-gray-400 dark:text-muted" />
          </div>
          <h3 className="text-base font-medium text-gray-900 dark:text-primary mb-1">
            {t('milestones.empty')}
          </h3>
          <p className="text-sm text-gray-500 dark:text-muted mb-4 max-w-sm">
            {t('milestones.emptyDesc')}
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowCreateModal(true)}
              className="flex items-center gap-1.5 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-black hover:bg-accent-hover transition-colors"
            >
              <Plus size={16} />
              {t('milestones.new')}
            </button>
          </div>
          {/* AI Plan button */}
          <button
            onClick={() => {
              const store = useAIAssistantStore.getState();
              store.setInput('Plan milestones for this project. Analyze all open tickets, group them into logical milestones, estimate timing, and suggest priorities.');
              store.setOpen(true);
            }}
            className="flex items-center gap-1.5 mt-3 rounded-lg border border-purple-200 dark:border-purple-500/30 bg-purple-50 dark:bg-purple-500/10 px-4 py-2 text-sm font-medium text-purple-700 dark:text-purple-400 hover:bg-purple-100 dark:hover:bg-purple-500/20 transition-colors"
          >
            <Bot size={14} />
            {t('milestones.aiPlan')}
          </button>
        </div>
      )}

      {/* Content: Timeline (primary) always on top, cards below */}
      {!isLoading && milestones.length > 0 && (
        <div className="space-y-6">
          {/* Gantt Timeline — PRIMARY view, always visible */}
          <GanttTimeline milestones={milestones} issuesByMilestone={issuesByMilestone} />

          {/* Milestone Cards — below timeline, toggleable */}
          {showCards && (
            <div className="space-y-3">
              {milestones.map((milestone) => {
                const issues = issuesByMilestone[milestone.id] || [];
                const done = issues.filter((i) => i.status === 'done').length;
                const total = issues.length;
                const pct = total > 0 ? Math.round((done / total) * 100) : 0;
                const bugs = issues.filter((i) => i.type === 'bug').length;
                const features = issues.filter((i) => i.type === 'feature').length;
                const improvements = issues.filter((i) => i.type === 'improvement').length;
                const isExpanded = expandedId === milestone.id;

                const effectiveStatus = computeEffectiveStatus(milestone, issues);
                const statusStyle = STATUS_STYLES[effectiveStatus];
                const isOverdue = milestone.target_date && new Date(milestone.target_date) < new Date() && effectiveStatus === 'active';

                return (
                  <div key={milestone.id} className="group">
                    <div
                      className={cn(
                        'rounded-xl border bg-white dark:bg-surface transition-all cursor-pointer',
                        isExpanded
                          ? 'border-accent/30 shadow-md'
                          : 'border-gray-200 dark:border-border shadow-sm hover:shadow-md hover:border-gray-300 dark:hover:border-border',
                      )}
                    >
                      {/* Card header */}
                      <div
                        className="flex items-center gap-3 p-4 sm:p-5"
                        onClick={() => setExpandedId(isExpanded ? null : milestone.id)}
                      >
                        <div className="text-gray-400 dark:text-muted shrink-0">
                          {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                        </div>

                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <h3 className="text-sm font-semibold text-gray-900 dark:text-primary truncate">
                              {milestone.name}
                            </h3>
                            <span
                              className={cn(
                                'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium',
                                statusStyle.bg,
                                statusStyle.text,
                              )}
                            >
                              <span className={cn('h-1.5 w-1.5 rounded-full', statusStyle.dot)} />
                              {t(`milestones.status.${effectiveStatus}`)}
                            </span>
                            {isOverdue && (
                              <span className="inline-flex items-center gap-1 rounded-full bg-red-50 dark:bg-red-500/10 px-2 py-0.5 text-[10px] font-medium text-red-600 dark:text-red-400">
                                {t('milestones.overdue')}
                              </span>
                            )}
                          </div>
                          {milestone.description && (
                            <p className="text-xs text-gray-500 dark:text-muted mt-0.5 line-clamp-1">
                              {milestone.description}
                            </p>
                          )}
                        </div>

                        {/* Issue type breakdown */}
                        <div className="hidden sm:flex items-center gap-3 text-[11px] shrink-0">
                          {bugs > 0 && (
                            <span className="flex items-center gap-1 text-red-500">
                              <Bug size={12} /> {bugs}
                            </span>
                          )}
                          {features > 0 && (
                            <span className="flex items-center gap-1 text-emerald-500">
                              <Sparkles size={12} /> {features}
                            </span>
                          )}
                          {improvements > 0 && (
                            <span className="flex items-center gap-1 text-blue-500">
                              <Zap size={12} /> {improvements}
                            </span>
                          )}
                        </div>

                        {/* Target date */}
                        {milestone.target_date && (
                          <div className="hidden sm:flex items-center gap-1 text-xs text-gray-500 dark:text-muted shrink-0">
                            <Calendar size={12} />
                            {new Date(milestone.target_date).toLocaleDateString()}
                          </div>
                        )}

                        {/* Progress */}
                        <div className="flex items-center gap-2 shrink-0 min-w-[120px]">
                          <div className="flex-1 h-1.5 rounded-full bg-gray-100 dark:bg-surface-hover overflow-hidden">
                            <div
                              className={cn(
                                'h-full rounded-full transition-all duration-500',
                                isOverdue
                                  ? 'bg-red-500'
                                  : pct === 100
                                    ? 'bg-emerald-500'
                                    : 'bg-blue-500',
                              )}
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                          <span className="text-[11px] font-medium text-gray-600 dark:text-secondary tabular-nums min-w-[32px] text-right">
                            {pct}%
                          </span>
                        </div>

                        <span className="text-[11px] text-gray-400 dark:text-muted shrink-0 tabular-nums">
                          {done}/{total} {t('milestones.issues')}
                        </span>

                        {/* Actions */}
                        <div
                          className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <button
                            onClick={() => handleDelete(milestone)}
                            className="rounded-md p-1.5 text-gray-400 dark:text-muted hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors"
                            title={t('milestones.delete')}
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </div>

                      {/* Expanded detail */}
                      {isExpanded && (
                        <div className="border-t border-gray-100 dark:border-border">
                          <MilestoneDetail
                            milestone={milestone}
                            issues={issues}
                            projectId={project?.id}
                            onClose={() => setExpandedId(null)}
                          />
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Create Modal */}
      {showCreateModal && project && (
        <CreateMilestoneModal
          projectId={project.id}
          onClose={() => setShowCreateModal(false)}
        />
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════
   Create Milestone Modal
   ═══════════════════════════════════════════════════ */

function CreateMilestoneModal({ projectId, onClose }: { projectId: string; onClose: () => void }) {
  const { t } = useTranslation();
  const apiClient = useApi();
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [targetDate, setTargetDate] = useState('');

  const createMutation = useMutation({
    mutationFn: () =>
      apiClient.milestones.create(projectId, {
        name,
        description: description || undefined,
        target_date: targetDate || undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['milestones', projectId] });
      onClose();
    },
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-2xl border border-gray-200 dark:border-border bg-white dark:bg-surface shadow-xl p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-base font-semibold text-gray-900 dark:text-primary">
            {t('milestones.new')}
          </h3>
          <button onClick={onClose} className="text-gray-400 dark:text-muted hover:text-gray-600 dark:hover:text-primary transition-colors">
            <X size={18} />
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-700 dark:text-secondary mb-1">
              {t('milestones.name')} *
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('milestones.namePlaceholder')}
              autoFocus
              className="w-full rounded-lg border border-gray-200 dark:border-border bg-white dark:bg-bg px-3 py-2 text-sm text-gray-900 dark:text-primary placeholder-gray-400 dark:placeholder-muted outline-none focus:border-accent focus:ring-1 focus:ring-accent/30 transition-colors"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-700 dark:text-secondary mb-1">
              {t('milestones.description')}
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t('milestones.descriptionPlaceholder')}
              rows={3}
              className="w-full rounded-lg border border-gray-200 dark:border-border bg-white dark:bg-bg px-3 py-2 text-sm text-gray-900 dark:text-primary placeholder-gray-400 dark:placeholder-muted outline-none focus:border-accent focus:ring-1 focus:ring-accent/30 transition-colors resize-none"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-700 dark:text-secondary mb-1">
              {t('milestones.targetDate')}
            </label>
            <input
              type="date"
              value={targetDate}
              onChange={(e) => setTargetDate(e.target.value)}
              className="w-full rounded-lg border border-gray-200 dark:border-border bg-white dark:bg-bg px-3 py-2 text-sm text-gray-900 dark:text-primary outline-none focus:border-accent focus:ring-1 focus:ring-accent/30 transition-colors"
            />
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 mt-6">
          <button
            onClick={onClose}
            className="rounded-lg px-4 py-2 text-sm font-medium text-gray-600 dark:text-secondary hover:bg-gray-100 dark:hover:bg-surface-hover transition-colors"
          >
            {t('milestones.cancel')}
          </button>
          <button
            onClick={() => createMutation.mutate()}
            disabled={!name.trim() || createMutation.isPending}
            className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-black hover:bg-accent-hover disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {createMutation.isPending ? t('milestones.creating') : t('milestones.new')}
          </button>
        </div>
      </div>
    </div>
  );
}

export default Milestones;
