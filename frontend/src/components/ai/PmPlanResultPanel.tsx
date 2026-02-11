import { AnimatePresence, motion } from 'framer-motion';
import { CheckCircle2, Loader2, Sparkles, Wrench, X } from 'lucide-react';
import { useTranslation } from '@/hooks/useTranslation';
import { cn } from '@/lib/utils';

export interface PmReviewIssue {
  id: string;
  display_id: string;
}

export interface PmReviewBucket {
  key: string;
  name: string;
  issue_ids: string[];
  issues: PmReviewIssue[];
}

export interface PmReviewSprint {
  key: string;
  name: string;
  start_date: string;
  end_date: string;
  issue_ids: string[];
  issues: PmReviewIssue[];
}

export interface PmReviewProject {
  project_id: string;
  project_name: string;
  project_prefix: string;
  milestones: PmReviewBucket[];
  sprints: PmReviewSprint[];
}

export interface PmReviewPlanData {
  period: {
    end_date: string;
  };
  sprint_windows: Array<{
    key: string;
    end_date: string;
  }>;
  projects: PmReviewProject[];
}

export type PmQueueStage = 'idle' | 'validating' | 'persisting' | 'refreshing' | 'success' | 'error';

export interface PmPlanUiState {
  isEditing: boolean;
  draft: string;
  applying: boolean;
  stage: PmQueueStage;
  dismissed: boolean;
  applied: boolean;
  error: string | null;
}

interface PmPlanResultPanelProps {
  plan: PmReviewPlanData;
  state: PmPlanUiState;
  onAccept: () => void;
  onEdit: () => void;
  onApplyChanges: () => void;
  onCancel: () => void;
  onDraftChange: (value: string) => void;
}

const QUEUE_STAGES: Array<{ key: Exclude<PmQueueStage, 'idle' | 'error'>; progress: number; i18nKey: string }> = [
  { key: 'validating', progress: 1, i18nKey: 'ai.pmPlan.queueValidate' },
  { key: 'persisting', progress: 2, i18nKey: 'ai.pmPlan.queuePersist' },
  { key: 'refreshing', progress: 3, i18nKey: 'ai.pmPlan.queueRefresh' },
  { key: 'success', progress: 3, i18nKey: 'ai.pmPlan.queueDone' },
];

function getStageProgress(stage: PmQueueStage): number {
  if (stage === 'idle') return 0;
  if (stage === 'error') return 0;
  return QUEUE_STAGES.find((item) => item.key === stage)?.progress ?? 0;
}

export function PmPlanResultPanel({
  plan,
  state,
  onAccept,
  onEdit,
  onApplyChanges,
  onCancel,
  onDraftChange,
}: PmPlanResultPanelProps) {
  const { t } = useTranslation();

  if (state.dismissed) return null;

  const progress = getStageProgress(state.stage);

  return (
    <>
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="mt-2 space-y-2 rounded-xl border border-border/70 bg-surface/60 p-2.5"
      >
        <div className="rounded-lg border border-border/60 bg-bg/70 p-2">
          <div className="mb-1.5 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted">
            <Wrench size={11} className="text-accent" />
            {t('ai.pmPlan.queueTitle')}
          </div>
          <div className="grid grid-cols-3 gap-1">
            {QUEUE_STAGES.slice(0, 3).map((stage, index) => {
              const done = progress > index;
              const active = progress === index + 1 && state.stage !== 'success';
              return (
                <motion.div
                  key={stage.key}
                  className={cn(
                    'rounded-md border px-2 py-1.5 text-[10px] transition-colors',
                    done && 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300',
                    active && 'border-accent/40 bg-accent/10 text-accent',
                    !done && !active && 'border-border/60 bg-surface/70 text-muted',
                  )}
                  animate={active ? { scale: [1, 1.01, 1] } : { scale: 1 }}
                  transition={{ duration: 0.7, repeat: active ? Infinity : 0 }}
                >
                  <div className="flex items-center gap-1">
                    {done ? (
                      <CheckCircle2 size={11} />
                    ) : active ? (
                      <Loader2 size={11} className="animate-spin" />
                    ) : (
                      <Sparkles size={11} />
                    )}
                    <span>{t(stage.i18nKey)}</span>
                  </div>
                </motion.div>
              );
            })}
          </div>
          {state.stage === 'error' && state.error && (
            <p className="mt-1.5 text-[10px] text-red-300">{state.error}</p>
          )}
        </div>

        <div className="space-y-2">
          <AnimatePresence initial={false}>
            {plan.projects.map((project, projectIndex) => (
              <motion.div
                key={project.project_id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.2, delay: projectIndex * 0.04 }}
                className="rounded-lg border border-border/70 bg-bg/60 p-2"
              >
                <p className="mb-1.5 text-[11px] font-semibold text-primary">
                  {project.project_prefix} · {project.project_name}
                </p>

                <div className="grid gap-2 md:grid-cols-2">
                  <div className="rounded-md border border-border/60 bg-surface/60 p-2">
                    <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted">
                      {t('ai.pmPlan.taskBlock')}
                    </p>
                    <div className="space-y-1">
                      {project.milestones.map((milestone) => (
                        <motion.div
                          key={`${project.project_id}-${milestone.key}`}
                          whileHover={{ x: 2 }}
                          className="rounded-md border border-border/50 bg-bg/70 px-2 py-1"
                        >
                          <div className="flex items-center justify-between gap-2 text-[10px]">
                            <span className="text-secondary">{milestone.name}</span>
                            <span className="rounded-full bg-surface px-1.5 py-0.5 text-muted">
                              {milestone.issue_ids.length}
                            </span>
                          </div>
                        </motion.div>
                      ))}
                    </div>
                  </div>

                  <div className="rounded-md border border-border/60 bg-surface/60 p-2">
                    <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted">
                      {t('ai.pmPlan.toolBlock')}
                    </p>
                    <div className="space-y-1">
                      {project.sprints.map((sprint) => (
                        <motion.div
                          key={`${project.project_id}-${sprint.key}`}
                          whileHover={{ x: 2 }}
                          className="rounded-md border border-border/50 bg-bg/70 px-2 py-1"
                        >
                          <div className="flex items-center justify-between gap-2 text-[10px]">
                            <span className="text-secondary">{sprint.name}</span>
                            <span className="rounded-full bg-surface px-1.5 py-0.5 text-muted">
                              {sprint.issue_ids.length}
                            </span>
                          </div>
                          <p className="mt-0.5 text-[9px] text-muted">
                            {sprint.start_date} → {sprint.end_date}
                          </p>
                        </motion.div>
                      ))}
                    </div>
                  </div>
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>

        <div className="grid grid-cols-2 gap-1.5 md:grid-cols-4">
          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={onAccept}
            disabled={state.applying}
            className="rounded-md bg-emerald-500 px-2.5 py-1.5 text-[10px] font-semibold text-white transition-colors hover:bg-emerald-600 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {state.applying && state.stage !== 'idle' ? t('ai.pmPlan.applying') : t('ai.pmPlan.accept')}
          </motion.button>

          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={onEdit}
            disabled={state.applying}
            className="rounded-md border border-border bg-surface px-2.5 py-1.5 text-[10px] font-semibold text-secondary transition-colors hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-60"
          >
            {t('ai.pmPlan.edit')}
          </motion.button>

          <motion.button
            whileHover={{ scale: state.isEditing ? 1.02 : 1 }}
            whileTap={{ scale: state.isEditing ? 0.98 : 1 }}
            onClick={onApplyChanges}
            disabled={!state.isEditing || state.applying}
            className="rounded-md border border-accent/40 bg-accent/10 px-2.5 py-1.5 text-[10px] font-semibold text-accent transition-colors hover:bg-accent/20 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {t('ai.pmPlan.applyChanges')}
          </motion.button>

          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={onCancel}
            disabled={state.applying}
            className="rounded-md border border-border bg-bg px-2.5 py-1.5 text-[10px] font-semibold text-muted transition-colors hover:bg-surface disabled:cursor-not-allowed disabled:opacity-60"
          >
            {t('ai.pmPlan.cancel')}
          </motion.button>
        </div>

        {state.applied && (
          <div className="flex items-center gap-1 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2 py-1 text-[10px] text-emerald-300">
            <CheckCircle2 size={11} />
            <span>{t('ai.pmPlan.appliedInline')}</span>
          </div>
        )}
      </motion.div>

      <AnimatePresence>
        {state.isEditing && (
          <motion.div
            className="fixed inset-0 z-[120] flex items-center justify-center bg-black/60 p-4"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.97, y: 8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.97, y: 8 }}
              className="w-full max-w-2xl rounded-xl border border-border bg-bg shadow-2xl"
            >
              <div className="flex items-center justify-between border-b border-border px-4 py-3">
                <div>
                  <p className="text-sm font-semibold text-primary">{t('ai.pmPlan.editTitle')}</p>
                  <p className="text-[11px] text-muted">{t('ai.pmPlan.editHint')}</p>
                </div>
                <button
                  onClick={onCancel}
                  className="rounded-md p-1 text-muted transition-colors hover:bg-surface hover:text-primary"
                >
                  <X size={14} />
                </button>
              </div>

              <div className="space-y-2 p-4">
                <textarea
                  value={state.draft}
                  onChange={(event) => onDraftChange(event.target.value)}
                  rows={16}
                  className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-xs text-primary outline-none transition-colors focus:border-accent"
                  placeholder={t('ai.pmPlan.editPlaceholder')}
                />

                <div className="flex items-center justify-end gap-2">
                  <button
                    onClick={onCancel}
                    className="rounded-md border border-border bg-surface px-3 py-1.5 text-xs font-medium text-secondary hover:bg-surface-hover"
                  >
                    {t('ai.pmPlan.cancel')}
                  </button>
                  <button
                    onClick={onApplyChanges}
                    disabled={state.applying}
                    className="rounded-md bg-accent px-3 py-1.5 text-xs font-semibold text-black disabled:opacity-60"
                  >
                    {state.applying ? (
                      <span className="inline-flex items-center gap-1">
                        <Loader2 size={12} className="animate-spin" />
                        {t('ai.pmPlan.applying')}
                      </span>
                    ) : (
                      t('ai.pmPlan.applyChanges')
                    )}
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
