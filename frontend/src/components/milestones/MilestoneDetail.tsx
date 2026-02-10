import { useState, useMemo, useCallback } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Edit3, Save, Calendar, Bug, Sparkles, Zap, HelpCircle,
  CheckCircle2, Circle, Clock, AlertTriangle,
} from 'lucide-react';
import { useApi } from '@/hooks/useApi';
import { useTranslation } from '@/hooks/useTranslation';
import { cn } from '@/lib/utils';
import { BurndownChart } from '@/components/milestones/BurndownChart';
import type { Milestone, MilestoneStatus, Issue, IssueStatus, IssueType } from '@/lib/types';

/* ── Constants ──────────────────────────────────── */

const STATUS_GROUPS: { key: IssueStatus | 'open'; label: string; statuses: IssueStatus[]; icon: typeof Circle; color: string }[] = [
  { key: 'open', label: 'Todo', statuses: ['backlog', 'todo'], icon: Circle, color: 'text-gray-400' },
  { key: 'in_progress', label: 'In Progress', statuses: ['in_progress'], icon: Clock, color: 'text-amber-500' },
  { key: 'in_review', label: 'In Review', statuses: ['in_review'], icon: AlertTriangle, color: 'text-purple-500' },
  { key: 'done', label: 'Done', statuses: ['done'], icon: CheckCircle2, color: 'text-emerald-500' },
];

const TYPE_ICONS: Record<IssueType, { icon: typeof Bug; color: string }> = {
  bug: { icon: Bug, color: 'text-red-400' },
  feature: { icon: Sparkles, color: 'text-emerald-400' },
  improvement: { icon: Zap, color: 'text-blue-400' },
  question: { icon: HelpCircle, color: 'text-purple-400' },
};

const MILESTONE_STATUSES: MilestoneStatus[] = ['active', 'completed', 'cancelled'];

interface MilestoneDetailProps {
  milestone: Milestone;
  issues: Issue[];
  projectId?: string;
  onClose: () => void;
}

export function MilestoneDetail({ milestone, issues, projectId: _projectId, onClose: _onClose }: MilestoneDetailProps) {
  const { t } = useTranslation();
  const apiClient = useApi();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState(milestone.name);
  const [editDescription, setEditDescription] = useState(milestone.description || '');
  const [editTargetDate, setEditTargetDate] = useState(milestone.target_date?.slice(0, 10) || '');
  const [editStatus, setEditStatus] = useState<MilestoneStatus>(milestone.status);

  // Stats
  const stats = useMemo(() => {
    const done = issues.filter((i) => i.status === 'done').length;
    const inProgress = issues.filter((i) => i.status === 'in_progress').length;
    const inReview = issues.filter((i) => i.status === 'in_review').length;
    const open = issues.filter((i) => ['backlog', 'todo'].includes(i.status)).length;
    const bugs = issues.filter((i) => i.type === 'bug').length;
    const features = issues.filter((i) => i.type === 'feature').length;
    const improvements = issues.filter((i) => i.type === 'improvement').length;
    return { done, inProgress, inReview, open, bugs, features, improvements, total: issues.length };
  }, [issues]);

  const pct = stats.total > 0 ? Math.round((stats.done / stats.total) * 100) : 0;

  // Group issues by status
  const groupedIssues = useMemo(() => {
    const groups: Record<string, Issue[]> = {};
    for (const group of STATUS_GROUPS) {
      groups[group.key] = issues.filter((i) => group.statuses.includes(i.status));
    }
    return groups;
  }, [issues]);

  // Update mutation
  const updateMutation = useMutation({
    mutationFn: () =>
      apiClient.milestones.update(milestone.id, {
        name: editName,
        description: editDescription || undefined,
        target_date: editTargetDate || undefined,
        status: editStatus,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['milestones'] });
      setEditing(false);
    },
  });

  const handleSave = useCallback(() => {
    if (!editName.trim()) return;
    updateMutation.mutate();
  }, [editName, updateMutation]);

  const handleStartEdit = useCallback(() => {
    setEditName(milestone.name);
    setEditDescription(milestone.description || '');
    setEditTargetDate(milestone.target_date?.slice(0, 10) || '');
    setEditStatus(milestone.status);
    setEditing(true);
  }, [milestone]);

  return (
    <div className="p-5">
      {/* Edit / View header */}
      {editing ? (
        <div className="space-y-3 mb-5">
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              autoFocus
              className="flex-1 rounded-lg border border-gray-200 dark:border-border bg-white dark:bg-bg px-3 py-1.5 text-sm font-semibold text-gray-900 dark:text-primary outline-none focus:border-accent transition-colors"
            />
            <select
              value={editStatus}
              onChange={(e) => setEditStatus(e.target.value as MilestoneStatus)}
              className="rounded-lg border border-gray-200 dark:border-border bg-white dark:bg-bg px-2 py-1.5 text-xs text-gray-700 dark:text-secondary outline-none focus:border-accent transition-colors"
            >
              {MILESTONE_STATUSES.map((s) => (
                <option key={s} value={s}>{t(`milestones.status.${s}`)}</option>
              ))}
            </select>
          </div>
          <textarea
            value={editDescription}
            onChange={(e) => setEditDescription(e.target.value)}
            placeholder={t('milestones.descriptionPlaceholder')}
            rows={2}
            className="w-full rounded-lg border border-gray-200 dark:border-border bg-white dark:bg-bg px-3 py-1.5 text-xs text-gray-700 dark:text-secondary outline-none focus:border-accent transition-colors resize-none"
          />
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5">
              <Calendar size={12} className="text-gray-400" />
              <input
                type="date"
                value={editTargetDate}
                onChange={(e) => setEditTargetDate(e.target.value)}
                className="rounded-md border border-gray-200 dark:border-border bg-white dark:bg-bg px-2 py-1 text-xs text-gray-700 dark:text-secondary outline-none focus:border-accent transition-colors"
              />
            </div>
            <div className="flex-1" />
            <button
              onClick={() => setEditing(false)}
              className="rounded-md px-3 py-1 text-xs text-gray-500 dark:text-muted hover:bg-gray-100 dark:hover:bg-surface-hover transition-colors"
            >
              {t('milestones.cancel')}
            </button>
            <button
              onClick={handleSave}
              disabled={!editName.trim() || updateMutation.isPending}
              className="flex items-center gap-1 rounded-md bg-accent px-3 py-1 text-xs font-medium text-black hover:bg-accent-hover disabled:opacity-40 transition-colors"
            >
              <Save size={12} />
              {t('milestones.save')}
            </button>
          </div>
        </div>
      ) : (
        <div className="flex items-start justify-between mb-5">
          <div>
            {milestone.description && (
              <p className="text-xs text-gray-600 dark:text-secondary mt-1 max-w-xl">
                {milestone.description}
              </p>
            )}
            {milestone.target_date && (
              <div className="flex items-center gap-1.5 text-xs text-gray-400 dark:text-muted mt-2">
                <Calendar size={12} />
                {t('milestones.targetDate')}: {new Date(milestone.target_date).toLocaleDateString()}
              </div>
            )}
          </div>
          <button
            onClick={handleStartEdit}
            className="flex items-center gap-1 rounded-md px-2.5 py-1 text-xs text-gray-500 dark:text-muted hover:text-gray-700 dark:hover:text-primary hover:bg-gray-100 dark:hover:bg-surface-hover transition-colors"
          >
            <Edit3 size={12} />
            {t('milestones.edit')}
          </button>
        </div>
      )}

      {/* Stats bar */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
        <StatCard
          label={t('milestones.total')}
          value={stats.total}
          color="text-gray-600 dark:text-secondary"
        />
        <StatCard
          label={t('milestones.done')}
          value={stats.done}
          color="text-emerald-600 dark:text-emerald-400"
          sub={`${pct}%`}
        />
        <StatCard
          label={t('milestones.open')}
          value={stats.open}
          color="text-gray-500 dark:text-muted"
        />
        <div className="rounded-lg border border-gray-100 dark:border-border bg-gray-50/50 dark:bg-surface-hover/30 px-3 py-2">
          <div className="flex items-center gap-2 text-[10px] text-gray-400 dark:text-muted">
            <span className="flex items-center gap-1"><Bug size={10} className="text-red-400" /> {stats.bugs}</span>
            <span className="flex items-center gap-1"><Sparkles size={10} className="text-emerald-400" /> {stats.features}</span>
            <span className="flex items-center gap-1"><Zap size={10} className="text-blue-400" /> {stats.improvements}</span>
          </div>
        </div>
      </div>

      {/* Progress bar */}
      <div className="mb-5">
        <div className="h-2 rounded-full bg-gray-100 dark:bg-surface-hover overflow-hidden">
          <div
            className={cn(
              'h-full rounded-full transition-all duration-500',
              pct === 100 ? 'bg-emerald-500' : 'bg-blue-500',
            )}
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>

      {/* Burndown Chart */}
      {issues.length > 0 && (
        <div className="mb-5">
          <BurndownChart
            issues={issues}
            startDate={milestone.created_at}
            targetDate={milestone.target_date}
          />
        </div>
      )}

      {/* Issue groups */}
      {issues.length === 0 ? (
        <p className="text-sm text-gray-400 dark:text-muted text-center py-6">
          {t('milestones.noIssues')}
        </p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {STATUS_GROUPS.map((group) => {
            const groupIssues = groupedIssues[group.key] || [];
            const GroupIcon = group.icon;
            return (
              <div key={group.key}>
                <div className="flex items-center gap-1.5 mb-2">
                  <GroupIcon size={12} className={group.color} />
                  <span className="text-[10px] font-medium text-gray-500 dark:text-muted uppercase tracking-wider">
                    {group.label}
                  </span>
                  <span className="text-[10px] text-gray-400 dark:text-muted">
                    ({groupIssues.length})
                  </span>
                </div>
                <div className="space-y-1">
                  {groupIssues.map((issue) => {
                    const typeConfig = TYPE_ICONS[issue.type];
                    const TypeIcon = typeConfig?.icon || Circle;
                    return (
                      <div
                        key={issue.id}
                        className="flex items-center gap-2 rounded-md border border-gray-100 dark:border-border/50 bg-white dark:bg-bg px-2.5 py-1.5 text-xs hover:border-gray-200 dark:hover:border-border transition-colors"
                      >
                        <TypeIcon size={11} className={typeConfig?.color || 'text-gray-400'} />
                        <span className="text-[10px] font-mono text-gray-400 dark:text-muted shrink-0">
                          {issue.display_id}
                        </span>
                        <span className="text-gray-800 dark:text-primary truncate flex-1">
                          {issue.title}
                        </span>
                      </div>
                    );
                  })}
                  {groupIssues.length === 0 && (
                    <div className="text-[10px] text-gray-300 dark:text-muted/50 text-center py-3">
                      —
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ── Stat card ──────────────────────────────────── */

function StatCard({ label, value, color, sub }: { label: string; value: number; color: string; sub?: string }) {
  return (
    <div className="rounded-lg border border-gray-100 dark:border-border bg-gray-50/50 dark:bg-surface-hover/30 px-3 py-2">
      <div className="text-[10px] text-gray-400 dark:text-muted uppercase tracking-wider">{label}</div>
      <div className={cn('text-lg font-semibold tabular-nums', color)}>
        {value}
        {sub && <span className="text-xs ml-1 font-normal text-gray-400 dark:text-muted">{sub}</span>}
      </div>
    </div>
  );
}
