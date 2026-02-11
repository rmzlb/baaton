import { useState, useEffect, useMemo, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useApi } from '@/hooks/useApi';
import { useTranslation } from '@/hooks/useTranslation';
import { useClerkMembers } from '@/hooks/useClerkMembers';
import { cn } from '@/lib/utils';
import {
  Inbox, Check, ArrowRightLeft, XCircle,
  ChevronRight, User,
} from 'lucide-react';
import type { Issue } from '@/lib/types';
import { MarkdownView } from '@/components/shared/MarkdownView';

export function Triage() {
  const { t } = useTranslation();
  const apiClient = useApi();
  const queryClient = useQueryClient();
  const { orgMembers } = useClerkMembers();

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [assignDropdownId, setAssignDropdownId] = useState<string | null>(null);

  const { data: allIssues = [], isLoading } = useQuery({
    queryKey: ['all-issues'],
    queryFn: () => apiClient.issues.listAll({ limit: 2000 }),
    staleTime: 30_000,
  });

  const triageIssues = useMemo(() =>
    allIssues.filter(
      (i: Issue) => i.source === 'form' || (i.assignee_ids.length === 0 && i.status === 'backlog')
    ).sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()),
    [allIssues],
  );

  const selectedIssue = triageIssues.find((i) => i.id === selectedId) || triageIssues[0] || null;

  // Auto-select first
  useEffect(() => {
    if (!selectedId && triageIssues.length > 0) {
      setSelectedId(triageIssues[0].id);
    }
  }, [triageIssues, selectedId]);

  const updateMutation = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) =>
      apiClient.issues.update(id, body as any),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['all-issues'] });
    },
  });

  const handleAccept = useCallback((issue: Issue) => {
    updateMutation.mutate({ id: issue.id, body: { status: 'todo' } });
  }, [updateMutation]);

  const handleDecline = useCallback((issue: Issue) => {
    updateMutation.mutate({ id: issue.id, body: { status: 'cancelled' } });
  }, [updateMutation]);

  const handleAssign = useCallback((issueId: string, userId: string) => {
    updateMutation.mutate({ id: issueId, body: { assignee_ids: [userId] } });
    setAssignDropdownId(null);
  }, [updateMutation]);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!selectedIssue || e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === '1') { e.preventDefault(); handleAccept(selectedIssue); }
      if (e.key === '2') { e.preventDefault(); setAssignDropdownId(assignDropdownId === selectedIssue.id ? null : selectedIssue.id); }
      if (e.key === '3') { e.preventDefault(); handleDecline(selectedIssue); }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [selectedIssue, handleAccept, handleDecline, assignDropdownId]);

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
        <div className="flex items-center gap-2 text-[10px] text-muted">
          <kbd className="rounded bg-surface-hover px-1.5 py-0.5 font-mono">1</kbd> {t('triage.accept')}
          <kbd className="rounded bg-surface-hover px-1.5 py-0.5 font-mono">2</kbd> {t('triage.assign')}
          <kbd className="rounded bg-surface-hover px-1.5 py-0.5 font-mono">3</kbd> {t('triage.decline')}
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
                  <div className="relative">
                    <button
                      onClick={(e) => { e.stopPropagation(); setAssignDropdownId(assignDropdownId === issue.id ? null : issue.id); }}
                      className="rounded-md p-1.5 text-blue-400 hover:bg-blue-500/10 transition-colors"
                      title={t('triage.assign')}
                    >
                      <ArrowRightLeft size={16} />
                    </button>
                    {assignDropdownId === issue.id && (
                      <div className="absolute right-0 top-full mt-1 z-50 rounded-xl border border-border bg-surface shadow-2xl py-1.5 min-w-[180px]">
                        {orgMembers.map((m: any) => {
                          const userId = m.publicUserData?.userId;
                          const name = `${m.publicUserData?.firstName || ''} ${m.publicUserData?.lastName || ''}`.trim() || userId?.slice(0, 12);
                          return (
                            <button
                              key={userId}
                              onClick={(e) => { e.stopPropagation(); handleAssign(issue.id, userId); }}
                              className="flex w-full items-center gap-2 px-3 py-2 text-xs text-secondary hover:bg-surface-hover hover:text-primary"
                            >
                              <User size={14} />
                              <span>{name}</span>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
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
                <button
                  onClick={() => setAssignDropdownId(assignDropdownId === selectedIssue.id ? null : selectedIssue.id)}
                  className="flex items-center gap-2 rounded-lg bg-blue-500/10 border border-blue-500/20 px-4 py-2 text-sm text-blue-400 hover:bg-blue-500/20 transition-colors"
                >
                  <ArrowRightLeft size={16} />
                  {t('triage.assign')}
                  <kbd className="rounded bg-blue-500/20 px-1.5 py-0.5 text-[10px] font-mono">2</kbd>
                </button>
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
