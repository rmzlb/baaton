import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useOrganization } from '@clerk/clerk-react';
import { Globe, Lock, Link as LinkIcon, Check, Loader2, ExternalLink } from 'lucide-react';
import { useApi } from '@/hooks/useApi';
import { useTranslation } from '@/hooks/useTranslation';
import { ApiError } from '@/lib/api';
import { cn } from '@/lib/utils';
import type { AgentSession, Organization } from '@/lib/types';

const PUBLIC_RUN_ORIGIN: string =
  (import.meta.env.VITE_PUBLIC_RUN_ORIGIN as string | undefined) || 'https://r.baaton.dev';

interface AgentRunCardProps {
  issueId: string;
  /**
   * Optional override for the org gate. If undefined, the component fetches
   * the value itself (S3) so the Publish button reflects the real backend
   * state and not just optimistic UI.
   */
  orgPublicRunsEnabled?: boolean;
  className?: string;
}

function formatPublishedDate(value: string | null): string {
  if (!value) return '';
  return new Date(value).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Public Run Card surface inside the IssueDrawer. Renders nothing when no
 * completed/errored agent session exists for the issue, or when the agent
 * sessions list endpoint is unavailable.
 */
export function AgentRunCard({ issueId, orgPublicRunsEnabled, className }: AgentRunCardProps) {
  const { t } = useTranslation();
  const apiClient = useApi();
  const queryClient = useQueryClient();
  const { organization } = useOrganization();
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data: sessions, isError } = useQuery<AgentSession[]>({
    queryKey: ['agent-sessions', issueId],
    queryFn: () => apiClient.agentSessions.listByIssue(issueId),
    retry: false,
    staleTime: 30_000,
  });

  // S3: fetch the real org gate so the Publish button reflects backend
  // state, not just an unset prop. Tolerates older deployments without the
  // GET /orgs/:id endpoint by treating 404/405 as "unknown" (we don't
  // disable the button in that case — the publish call itself will 403
  // with a clear error if the gate is off).
  const { data: orgRow } = useQuery<Organization | null>({
    queryKey: ['org', organization?.id],
    enabled: !!organization?.id && orgPublicRunsEnabled === undefined,
    retry: false,
    staleTime: 60_000,
    queryFn: async () => {
      try {
        return await apiClient.orgs.get(organization!.id);
      } catch (err) {
        if (err instanceof ApiError && (err.status === 404 || err.status === 405)) {
          return null;
        }
        throw err;
      }
    },
  });

  const effectiveOrgEnabled =
    orgPublicRunsEnabled ?? (orgRow ? Boolean(orgRow.agent_runs_public_enabled) : undefined);

  const latestFinished = (sessions ?? [])
    .filter((s) => s.status === 'completed' || s.status === 'error')
    .sort((a, b) => {
      const aDate = a.completed_at || a.updated_at || a.created_at;
      const bDate = b.completed_at || b.updated_at || b.created_at;
      return new Date(bDate).getTime() - new Date(aDate).getTime();
    })[0];

  const publishMutation = useMutation({
    mutationFn: (sessionId: string) => apiClient.agentSessions.publish(sessionId),
    onSuccess: () => {
      setError(null);
      queryClient.invalidateQueries({ queryKey: ['agent-sessions', issueId] });
      queryClient.invalidateQueries({ queryKey: ['issue', issueId] });
    },
    onError: (err: unknown) => {
      if (err instanceof ApiError && err.code === 'agent_runs_public_disabled') {
        setError(t('agentRun.orgDisabled', {
          defaultValue:
            'Public runs are disabled for this organization. Enable in org settings.',
        }));
      } else {
        setError(t('agentRun.publishError', { defaultValue: 'Could not publish run' }));
      }
    },
  });

  const unpublishMutation = useMutation({
    mutationFn: (sessionId: string) => apiClient.agentSessions.unpublish(sessionId),
    onSuccess: () => {
      setError(null);
      queryClient.invalidateQueries({ queryKey: ['agent-sessions', issueId] });
      queryClient.invalidateQueries({ queryKey: ['issue', issueId] });
    },
  });

  if (isError || !sessions || sessions.length === 0 || !latestFinished) {
    return null;
  }

  const isPublic = latestFinished.is_public && latestFinished.public_token;
  const publicUrl = latestFinished.public_token
    ? `${PUBLIC_RUN_ORIGIN}/${latestFinished.public_token}`
    : null;
  const orgGateOff = effectiveOrgEnabled === false;
  const publishing = publishMutation.isPending;
  const unpublishing = unpublishMutation.isPending;

  const handleCopy = async () => {
    if (!publicUrl) return;
    try {
      await navigator.clipboard.writeText(publicUrl);
    } catch {
      return;
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className={cn('space-y-2', className)}>
      <label className="flex items-center gap-1.5 text-[10px] text-muted uppercase tracking-wider font-medium">
        {isPublic ? <Globe size={10} /> : <Lock size={10} />}
        {t('agentRun.section', { defaultValue: 'Public run card' })}
      </label>

      <div className="rounded-lg border border-border bg-bg p-3 space-y-2">
        {isPublic && publicUrl ? (
          <>
            <div className="flex items-center gap-2 text-[11px]">
              <Globe size={11} className="text-emerald-400 shrink-0" />
              <a
                href={publicUrl}
                target="_blank"
                rel="noreferrer"
                className="font-mono tabular-nums text-secondary hover:text-primary truncate transition-colors"
                title={publicUrl}
              >
                r.baaton.dev/{latestFinished.public_token}
              </a>
              <ExternalLink size={10} className="text-muted shrink-0" />
            </div>

            {latestFinished.published_at && (
              <p className="text-[10px] text-muted tabular-nums">
                {t('agentRun.publishedAt', {
                  date: formatPublishedDate(latestFinished.published_at),
                  defaultValue: 'Published {{date}}',
                })}
              </p>
            )}

            <div className="flex flex-wrap items-center gap-1.5 pt-1">
              <button
                type="button"
                onClick={handleCopy}
                className="inline-flex h-7 items-center gap-1.5 rounded-md border border-border bg-surface px-2.5 text-[11px] text-secondary hover:bg-surface-hover hover:text-primary transition-colors focus:outline-none focus:ring-2 focus:ring-amber-500/30"
              >
                {copied ? (
                  <>
                    <Check size={11} className="text-emerald-400" />
                    {t('agentRun.linkCopied', { defaultValue: 'Link copied' })}
                  </>
                ) : (
                  <>
                    <LinkIcon size={11} />
                    {t('agentRun.copyLink', { defaultValue: 'Copy link' })}
                  </>
                )}
              </button>

              <button
                type="button"
                onClick={() => unpublishMutation.mutate(latestFinished.id)}
                disabled={unpublishing}
                className="inline-flex h-7 items-center gap-1.5 rounded-md border border-border bg-surface px-2.5 text-[11px] text-secondary hover:bg-surface-hover hover:text-red-400 disabled:opacity-50 transition-colors focus:outline-none focus:ring-2 focus:ring-red-500/30"
              >
                {unpublishing ? (
                  <>
                    <Loader2 size={11} className="animate-spin" />
                    {t('agentRun.unpublishing', { defaultValue: 'Unpublishing…' })}
                  </>
                ) : (
                  <>
                    <Lock size={11} />
                    {t('agentRun.unpublish', { defaultValue: 'Unpublish' })}
                  </>
                )}
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="text-[11px] text-secondary leading-relaxed">
              {t('agentRun.publishHint', {
                defaultValue: 'Publish a shareable receipt of this run at r.baaton.dev.',
              })}
            </p>
            <button
              type="button"
              onClick={() => publishMutation.mutate(latestFinished.id)}
              disabled={publishing || orgGateOff}
              title={
                orgGateOff
                  ? t('agentRun.orgDisabled', {
                      defaultValue:
                        'Public runs are disabled for this organization. Enable in org settings.',
                    })
                  : undefined
              }
              className="inline-flex h-7 items-center gap-1.5 rounded-md bg-accent px-2.5 text-[11px] font-medium text-black hover:bg-accent-hover disabled:opacity-50 disabled:cursor-not-allowed transition-colors focus:outline-none focus:ring-2 focus:ring-amber-500/30"
            >
              {publishing ? (
                <>
                  <Loader2 size={11} className="animate-spin" />
                  {t('agentRun.publishing', { defaultValue: 'Publishing…' })}
                </>
              ) : (
                <>
                  <Globe size={11} />
                  {t('agentRun.publish', { defaultValue: 'Publish run' })}
                </>
              )}
            </button>
          </>
        )}

        {error && (
          <p className="text-[10px] text-red-400 leading-relaxed">{error}</p>
        )}
      </div>
    </div>
  );
}

export default AgentRunCard;
