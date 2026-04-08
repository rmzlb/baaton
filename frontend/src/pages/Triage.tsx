import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import * as Popover from '@radix-ui/react-popover';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useApi } from '@/hooks/useApi';
import { useTranslation } from '@/hooks/useTranslation';
import { useOrgMembers } from '@/hooks/useOrgMembers';
import { FilterSelect } from '@/components/shared/FilterSelect';
import { cn } from '@/lib/utils';
import {
  Inbox, Check, ArrowRightLeft, XCircle,
  ChevronRight, User, Sparkles, Loader2, Tag, AlertTriangle,
  Filter,
} from 'lucide-react';
import type { Issue, IssuePriority } from '@/lib/types';
import { MarkdownView } from '@/components/shared/MarkdownView';

const TRIAGE_ORG_FILTER_STORAGE_KEY = 'triage:org-filter:v1';

interface AiTriageResult {
  priority?: IssuePriority;
  tags?: string[];
  assignee_id?: string;
  similar_issues?: { id: string; display_id: string; title: string }[];
}

export function Triage() {
  const { t } = useTranslation();
  const apiClient = useApi();
  const queryClient = useQueryClient();

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isAssignOpen, setIsAssignOpen] = useState(false);
  const previewAssignRef = useRef<HTMLButtonElement>(null);
  const [orgFilter, setOrgFilter] = useState<string>(() => localStorage.getItem(TRIAGE_ORG_FILTER_STORAGE_KEY) || 'all');
  const [aiLoading, setAiLoading] = useState(false);
  const [aiResult, setAiResult] = useState<AiTriageResult | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);

  const { data: allIssues = [], isLoading } = useQuery({
    queryKey: ['all-issues'],
    queryFn: () => apiClient.issues.listAll({ limit: 2000 }),
    staleTime: 30_000,
  });

  const allTriageIssues = useMemo(() =>
    allIssues.filter(
      (i: Issue) => i.status === 'backlog' && (i.source === 'form' || i.assignee_ids.length === 0)
    ).sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()),
    [allIssues],
  );

  // Unique org IDs from triage issues (for the filter dropdown)
  const availableOrgs = useMemo(() => {
    const orgs = new Map<string, string>();
    for (const issue of allTriageIssues) {
      if (issue.org_id) {
        // Use display_id prefix as org label fallback (e.g. "LEG" from "LEG-5")
        const prefix = issue.display_id?.split('-')[0] || issue.org_id.slice(0, 8);
        if (!orgs.has(issue.org_id)) {
          orgs.set(issue.org_id, prefix);
        }
      }
    }
    return Array.from(orgs.entries()).map(([id, label]) => ({ id, label }));
  }, [allTriageIssues]);

  useEffect(() => {
    localStorage.setItem(TRIAGE_ORG_FILTER_STORAGE_KEY, orgFilter);
  }, [orgFilter]);

  useEffect(() => {
    if (orgFilter !== 'all' && availableOrgs.length > 0 && !availableOrgs.some((org) => org.id === orgFilter)) {
      setOrgFilter('all');
    }
  }, [availableOrgs, orgFilter]);

  // Apply org filter
  const triageIssues = useMemo(() =>
    orgFilter === 'all'
      ? allTriageIssues
      : allTriageIssues.filter((i) => i.org_id === orgFilter),
    [allTriageIssues, orgFilter],
  );

  const selectedIssue = triageIssues.find((i) => i.id === selectedId) || triageIssues[0] || null;

  // Always fetch members for the selected issue's org
  const activeOrgId = selectedIssue?.org_id;
  const { members: issueOrgMembers } = useOrgMembers(activeOrgId);

  // Auto-select first
  useEffect(() => {
    if (!selectedId && triageIssues.length > 0) {
      setSelectedId(triageIssues[0].id);
    }
  }, [triageIssues, selectedId]);

  // Optimistic removal: remove triaged issue from cache immediately
  const removeFromCache = useCallback((issueId: string) => {
    queryClient.setQueryData<Issue[]>(['all-issues'], (old) =>
      old ? old.filter((i) => i.id !== issueId) : []
    );
    // Auto-select next issue
    setSelectedId((prev) => {
      if (prev !== issueId) return prev;
      const idx = triageIssues.findIndex((i) => i.id === issueId);
      const next = triageIssues[idx + 1] || triageIssues[idx - 1];
      return next?.id || null;
    });
  }, [queryClient, triageIssues]);

  const updateMutation = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) =>
      apiClient.issues.update(id, body as any),
    onMutate: async ({ id }) => {
      // Cancel any outgoing refetches so they don't overwrite our optimistic update
      await queryClient.cancelQueries({ queryKey: ['all-issues'] });
      // Snapshot the previous value for rollback
      const previous = queryClient.getQueryData<Issue[]>(['all-issues']);
      return { previous, removedId: id };
    },
    onError: (_err, _vars, context) => {
      // Rollback to the previous state on error
      if (context?.previous) {
        queryClient.setQueryData(['all-issues'], context.previous);
      }
    },
    onSettled: () => {
      // Always refetch after mutation settles to ensure server state
      queryClient.invalidateQueries({ queryKey: ['all-issues'] });
    },
  });

  const handleAccept = useCallback((issue: Issue) => {
    removeFromCache(issue.id);
    updateMutation.mutate({ id: issue.id, body: { status: 'todo' } });
  }, [updateMutation, removeFromCache]);

  const handleDecline = useCallback((issue: Issue) => {
    removeFromCache(issue.id);
    updateMutation.mutate({ id: issue.id, body: { status: 'cancelled' } });
  }, [updateMutation, removeFromCache]);

  const handleAssign = useCallback((issueId: string, userId: string) => {
    removeFromCache(issueId);
    updateMutation.mutate({ id: issueId, body: { assignee_ids: [userId], status: 'todo' } });
    setIsAssignOpen(false);
  }, [updateMutation, removeFromCache]);

  const renderAssignMenu = useCallback((issueId: string) => (
    <Popover.Portal>
      <Popover.Content
        sideOffset={8}
        align="end"
        collisionPadding={16}
        className="z-[160] min-w-[220px] rounded-xl border border-border bg-surface py-1.5 shadow-2xl outline-none"
      >
        <p className="px-3 py-1 text-[9px] font-semibold uppercase tracking-wider text-muted">{t('triage.assignTo')}</p>
        {issueOrgMembers.length === 0 ? (
          <div className="px-3 py-2 text-xs text-muted">No members</div>
        ) : (
          issueOrgMembers.map((m, idx) => {
            const name = `${m.first_name} ${m.last_name}`.trim() || m.email || m.user_id.slice(0, 12);
            return (
              <button
                key={m.user_id}
                onClick={(e) => { e.stopPropagation(); handleAssign(issueId, m.user_id); }}
                className="flex w-full items-center gap-2 px-3 py-2 text-xs text-secondary transition-colors hover:bg-surface-hover hover:text-primary"
              >
                <kbd className="min-w-[16px] rounded bg-surface-hover px-1 py-0.5 text-center font-mono text-[9px] text-muted">{idx + 1}</kbd>
                {m.image_url ? (
                  <img src={m.image_url} alt="" className="h-5 w-5 rounded-full object-cover" />
                ) : (
                  <User size={14} />
                )}
                <span>{name}</span>
              </button>
            );
          })
        )}
      </Popover.Content>
    </Popover.Portal>
  ), [handleAssign, issueOrgMembers, t]);

  // Reset AI result when switching issues
  useEffect(() => {
    setAiResult(null);
    setAiError(null);
  }, [selectedId]);

  const handleAiTriage = useCallback(async (issue: Issue) => {
    setAiLoading(true);
    setAiResult(null);
    setAiError(null);
    try {
      const result = await apiClient.post<AiTriageResult>(`/issues/${issue.id}/triage`, {});
      setAiResult(result);
    } catch {
      setAiError(t('triage.aiError'));
    } finally {
      setAiLoading(false);
    }
  }, [apiClient, t]);

  const handleApplyAiSuggestions = useCallback((issue: Issue) => {
    if (!aiResult) return;
    const update: Record<string, unknown> = {};
    if (aiResult.priority) update.priority = aiResult.priority;
    if (aiResult.tags && aiResult.tags.length > 0) update.tags = aiResult.tags;
    if (aiResult.assignee_id) update.assignee_ids = [aiResult.assignee_id];
    updateMutation.mutate({ id: issue.id, body: update });
    setAiResult(null);
  }, [aiResult, updateMutation]);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!selectedIssue || e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      // When assign popover is open: number keys pick a member, Escape handled by Radix
      if (isAssignOpen) {
        const num = parseInt(e.key);
        if (!isNaN(num) && num >= 1 && num <= issueOrgMembers.length) {
          e.preventDefault();
          const member = issueOrgMembers[num - 1];
          if (member?.user_id) handleAssign(selectedIssue.id, member.user_id);
        }
        return; // Don't process other shortcuts while assign open
      }

      // j/k to navigate issue list
      if (e.key === 'j' || e.key === 'k') {
        e.preventDefault();
        const idx = triageIssues.findIndex((i) => i.id === selectedIssue.id);
        const next = e.key === 'j' ? triageIssues[idx + 1] : triageIssues[idx - 1];
        if (next) setSelectedId(next.id);
        return;
      }

      if (e.key === '1') { e.preventDefault(); handleAccept(selectedIssue); }
      if (e.key === '2') { e.preventDefault(); previewAssignRef.current?.click(); }
      if (e.key === '3') { e.preventDefault(); handleDecline(selectedIssue); }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [selectedIssue, handleAccept, handleDecline, handleAssign, isAssignOpen, issueOrgMembers, triageIssues]);

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-accent" />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-3 md:px-6 py-3">
        <div>
          <h1 className="text-base md:text-lg font-semibold text-primary flex items-center gap-2">
            <Inbox size={18} className="text-accent" />
            {t('triage.title')}
          </h1>
          <p className="text-[10px] md:text-xs text-secondary font-mono uppercase tracking-wider">
            {triageIssues.length} {t('triage.issuesNeedAttention')}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {/* Org filter */}
          {availableOrgs.length > 1 && (
            <div className="flex items-center gap-1.5">
              <Filter size={12} className="text-muted" />
              <FilterSelect
                multi={false}
                label={orgFilter === 'all' ? t('triage.filters.allOrgs') : (availableOrgs.find((org) => org.id === orgFilter)?.label || t('triage.filters.allOrgs'))}
                selectedValues={orgFilter === 'all' ? [] : [orgFilter]}
                onChange={(values) => {
                  setOrgFilter(values[0] || 'all');
                  setSelectedId(null);
                }}
                allLabel={t('triage.filters.allOrgs')}
                allCount={allTriageIssues.length}
                emptyLabel={t('triage.filters.noOrgs')}
                options={availableOrgs.map((org) => ({
                  value: org.id,
                  label: org.label,
                  count: allTriageIssues.filter((i) => i.org_id === org.id).length,
                }))}
                widthClassName="min-w-[220px]"
                triggerClassName="text-xs"
              />
            </div>
          )}
          <div className="flex items-center gap-2 text-[10px] text-muted">
            <kbd className="rounded bg-surface-hover px-1.5 py-0.5 font-mono">1</kbd> {t('triage.accept')}
            <kbd className="rounded bg-surface-hover px-1.5 py-0.5 font-mono">2</kbd> {t('triage.assign')}
            <kbd className="rounded bg-surface-hover px-1.5 py-0.5 font-mono">3</kbd> {t('triage.decline')}
          </div>
        </div>
      </div>

      {triageIssues.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center text-center p-8">
          <Inbox size={48} className="text-muted mb-4" />
          <h2 className="text-lg font-medium text-primary mb-2">{t('triage.empty')}</h2>
          <p className="text-sm text-secondary">{t('triage.emptyDesc')}</p>
        </div>
      ) : (
        <div className="flex flex-1 overflow-hidden">
          {/* Left: Issue list */}
          <div className="w-full md:w-[380px] border-r border-border overflow-y-auto">
            {triageIssues.map((issue) => (
              <div
                key={issue.id}
                onClick={() => setSelectedId(issue.id)}
                className={cn(
                  'flex items-center gap-3 px-4 py-3 border-b border-border cursor-pointer transition-colors',
                  selectedIssue?.id === issue.id ? 'bg-surface-hover' : 'hover:bg-surface',
                )}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-[10px] font-mono text-muted">{issue.display_id}</span>
                    {issue.source === 'form' && (
                      <span className="rounded-full bg-blue-500/15 text-blue-400 px-1.5 py-0.5 text-[9px] font-medium">
                        {t('triage.public')}
                      </span>
                    )}
                    {issue.priority && (
                      <span className={cn(
                        'text-[9px] font-medium',
                        issue.priority === 'urgent' ? 'text-red-400' :
                        issue.priority === 'high' ? 'text-orange-400' : 'text-muted',
                      )}>
                        {issue.priority}
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-primary truncate">{issue.title}</p>
                  <p className="text-[10px] text-muted mt-0.5">
                    {issue.reporter_name || t('triage.anonymous')} · {new Date(issue.created_at).toLocaleDateString()}
                  </p>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={(e) => { e.stopPropagation(); handleAccept(issue); }}
                    className="rounded-md p-1.5 text-green-400 hover:bg-green-500/10 transition-colors"
                    title={t('triage.accept')}
                  >
                    <Check size={16} />
                  </button>
                  <Popover.Root>
                    <Popover.Trigger asChild>
                      <button
                        onClick={(e) => { e.stopPropagation(); setSelectedId(issue.id); }}
                        className="rounded-md p-1.5 text-blue-400 transition-colors hover:bg-blue-500/10"
                        title={t('triage.assign')}
                      >
                        <ArrowRightLeft size={16} />
                      </button>
                    </Popover.Trigger>
                    {renderAssignMenu(issue.id)}
                  </Popover.Root>
                  <button
                    onClick={(e) => { e.stopPropagation(); handleDecline(issue); }}
                    className="rounded-md p-1.5 text-red-400 hover:bg-red-500/10 transition-colors"
                    title={t('triage.decline')}
                  >
                    <XCircle size={16} />
                  </button>
                </div>

                <ChevronRight size={14} className="text-muted shrink-0 hidden md:block" />
              </div>
            ))}
          </div>

          {/* Right: Preview */}
          {selectedIssue && (
            <div className="hidden md:flex flex-1 flex-col overflow-y-auto p-6">
              <div className="flex items-center gap-3 mb-4">
                <span className="font-mono text-sm text-muted">{selectedIssue.display_id}</span>
                <span className={cn(
                  'rounded-full px-2 py-0.5 text-[11px] font-medium',
                  selectedIssue.status === 'backlog' ? 'bg-surface-hover text-muted' : 'bg-blue-500/15 text-blue-400',
                )}>
                  {selectedIssue.status}
                </span>
                {selectedIssue.source === 'form' && (
                  <span className="rounded-full bg-blue-500/15 text-blue-400 px-2 py-0.5 text-[11px] font-medium">
                    {t('triage.publicSubmission')}
                  </span>
                )}
              </div>

              <h2 className="text-xl font-semibold text-primary mb-2">{selectedIssue.title}</h2>

              {selectedIssue.reporter_name && (
                <p className="text-xs text-secondary mb-4">
                  {t('triage.submittedBy')} {selectedIssue.reporter_name}
                  {selectedIssue.reporter_email && ` (${selectedIssue.reporter_email})`}
                </p>
              )}

              {selectedIssue.description ? (
                <div className="prose prose-sm dark:prose-invert max-w-none">
                  <MarkdownView content={selectedIssue.description} />
                </div>
              ) : (
                <p className="text-sm text-muted italic">{t('triage.noDescription')}</p>
              )}

              {/* AI Triage Panel */}
              <div className="mt-6">
                <button
                  onClick={() => handleAiTriage(selectedIssue)}
                  disabled={aiLoading}
                  className="flex items-center gap-2 rounded-lg bg-purple-500/10 border border-purple-500/20 px-4 py-2 text-sm text-purple-400 hover:bg-purple-500/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {aiLoading ? (
                    <Loader2 size={16} className="animate-spin" />
                  ) : (
                    <Sparkles size={16} />
                  )}
                  {aiLoading ? t('triage.aiLoading') : t('triage.aiSuggest')}
                </button>

                {aiError && (
                  <div className="mt-3 flex items-center gap-2 rounded-lg bg-red-500/10 border border-red-500/20 px-3 py-2 text-sm text-red-400">
                    <AlertTriangle size={14} />
                    {aiError}
                  </div>
                )}

                {aiResult && (
                  <div className="mt-3 rounded-xl border border-purple-500/20 bg-purple-500/5 p-4 space-y-3">
                    <h4 className="text-sm font-semibold text-purple-300 flex items-center gap-2">
                      <Sparkles size={14} />
                      {t('triage.aiSuggestions')}
                    </h4>

                    {aiResult.priority && (
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-muted w-32">{t('triage.suggestedPriority')}</span>
                        <span className={cn(
                          'rounded-full px-2 py-0.5 text-[11px] font-medium',
                          aiResult.priority === 'urgent' ? 'bg-red-500/15 text-red-400' :
                          aiResult.priority === 'high' ? 'bg-orange-500/15 text-orange-400' :
                          aiResult.priority === 'medium' ? 'bg-yellow-500/15 text-yellow-400' :
                          'bg-surface-hover text-muted',
                        )}>
                          {aiResult.priority}
                        </span>
                      </div>
                    )}

                    {aiResult.tags && aiResult.tags.length > 0 && (
                      <div className="flex items-start gap-2">
                        <span className="text-xs text-muted w-32 pt-0.5">{t('triage.suggestedTags')}</span>
                        <div className="flex flex-wrap gap-1">
                          {aiResult.tags.map((tag) => (
                            <span key={tag} className="flex items-center gap-1 rounded-full bg-surface-hover px-2 py-0.5 text-[11px] text-secondary">
                              <Tag size={9} />
                              {tag}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    {aiResult.assignee_id && (
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-muted w-32">{t('triage.suggestedAssignee')}</span>
                        <span className="text-xs text-secondary font-mono">{aiResult.assignee_id.slice(0, 12)}…</span>
                      </div>
                    )}

                    {aiResult.similar_issues && aiResult.similar_issues.length > 0 && (
                      <div className="flex items-start gap-2">
                        <span className="text-xs text-muted w-32 pt-0.5">{t('triage.similarIssues')}</span>
                        <div className="space-y-1">
                          {aiResult.similar_issues.map((si) => (
                            <div key={si.id} className="text-xs text-secondary">
                              <span className="font-mono text-muted mr-1">{si.display_id}</span>
                              {si.title}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    <button
                      onClick={() => handleApplyAiSuggestions(selectedIssue)}
                      className="flex items-center gap-2 rounded-lg bg-purple-500/20 border border-purple-500/30 px-3 py-1.5 text-xs text-purple-300 hover:bg-purple-500/30 transition-colors font-medium"
                    >
                      <Check size={12} />
                      {t('triage.aiApply')}
                    </button>
                  </div>
                )}
              </div>

              {/* Action bar */}
              <div className="flex items-center gap-3 mt-8 pt-4 border-t border-border">
                <button
                  onClick={() => handleAccept(selectedIssue)}
                  className="flex items-center gap-2 rounded-lg bg-green-500/10 border border-green-500/20 px-4 py-2 text-sm text-green-400 hover:bg-green-500/20 transition-colors"
                >
                  <Check size={16} />
                  {t('triage.accept')}
                  <kbd className="rounded bg-green-500/20 px-1.5 py-0.5 text-[10px] font-mono">1</kbd>
                </button>
                <Popover.Root onOpenChange={setIsAssignOpen}>
                  <Popover.Trigger asChild>
                    <button
                      ref={previewAssignRef}
                      className="flex items-center gap-2 rounded-lg border border-blue-500/20 bg-blue-500/10 px-4 py-2 text-sm text-blue-400 transition-colors hover:bg-blue-500/20"
                    >
                      <ArrowRightLeft size={16} />
                      {t('triage.assign')}
                      <kbd className="rounded bg-blue-500/20 px-1.5 py-0.5 text-[10px] font-mono">2</kbd>
                    </button>
                  </Popover.Trigger>
                  {renderAssignMenu(selectedIssue.id)}
                </Popover.Root>
                <button
                  onClick={() => handleDecline(selectedIssue)}
                  className="flex items-center gap-2 rounded-lg bg-red-500/10 border border-red-500/20 px-4 py-2 text-sm text-red-400 hover:bg-red-500/20 transition-colors"
                >
                  <XCircle size={16} />
                  {t('triage.decline')}
                  <kbd className="rounded bg-red-500/20 px-1.5 py-0.5 text-[10px] font-mono">3</kbd>
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default Triage;
