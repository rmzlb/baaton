import { useEffect, useMemo, useState, type ComponentType, type CSSProperties, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  AlertCircle,
  Bot,
  Check,
  CheckCircle2,
  Clock,
  ExternalLink,
  FileCode2,
  FileText,
  GitPullRequest,
  Link as LinkIcon,
  ListChecks,
  TerminalSquare,
} from 'lucide-react';
import { Skeleton } from '@/components/shared/Skeleton';
import { useTranslation } from '@/hooks/useTranslation';
import { api, ApiError } from '@/lib/api';
import { cn } from '@/lib/utils';
import type { PublicRun, TestsStatus } from '@/lib/types';

function formatDate(value?: string | null) {
  if (!value) return '';
  return new Date(value).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatDuration(start?: string | null, end?: string | null) {
  if (!start) return null;
  const startMs = new Date(start).getTime();
  const endMs = end ? new Date(end).getTime() : Date.now();
  const seconds = Math.max(0, Math.round((endMs - startMs) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes < 60) return remainingSeconds ? `${minutes}m ${remainingSeconds}s` : `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
}

const PUBLIC_RUN_ORIGIN: string =
  (import.meta.env.VITE_PUBLIC_RUN_ORIGIN as string | undefined) || 'https://r.baaton.dev';

/**
 * Mirrors the PR-comment markdown the backend posts so a human can paste
 * the same shape into a pull request after clicking "Copy markdown for PR".
 */
function buildMarkdownForPR(run: PublicRun, publicOrigin: string): string {
  const duration = formatDuration(run.session.started_at, run.session.completed_at) ?? '—';
  const tests =
    run.session.tests_status === 'passed'
      ? 'passed ✓'
      : run.session.tests_status === 'failed'
      ? 'failed ✗'
      : run.session.tests_status === 'skipped'
      ? 'skipped'
      : '—';
  const rawSummary = run.session.summary || run.latest_tldr?.summary || '';
  const summary = rawSummary
    ? rawSummary.length > 240
      ? `${rawSummary.slice(0, 240)}…`
      : rawSummary
    : '_(no summary)_';
  const filesChanged = run.session.files_changed.length > 0
    ? run.session.files_changed
    : run.latest_tldr?.files_changed ?? [];

  return [
    `### Agent Run · \`${run.issue.display_id}\``,
    ``,
    `**Agent:** \`${run.session.agent_name}\` · **Status:** \`${run.session.status}\` · **Duration:** ${duration}`,
    ``,
    `**Project:** ${run.project.name}`,
    ``,
    `**Summary:** ${summary}`,
    ``,
    `**Files changed:** ${filesChanged.length} · **Tests:** ${tests}`,
    ``,
    `[View full run →](${publicOrigin}/${run.session.public_token})`,
    ``,
    `<sub>Posted by [Baaton](https://baaton.dev) — receipts for AI agent work.</sub>`,
  ].join('\n');
}

function statusTone(status: string) {
  switch (status) {
    case 'completed':
      return 'bg-emerald-500/10 text-emerald-300';
    case 'active':
    case 'awaiting_input':
      return 'bg-amber-500/10 text-amber-300';
    case 'error':
      return 'bg-red-500/10 text-red-300';
    default:
      return 'bg-blue-500/10 text-blue-300';
  }
}

function testsTone(status: TestsStatus) {
  switch (status) {
    case 'passed':
      return 'text-emerald-300';
    case 'failed':
      return 'text-red-300';
    case 'skipped':
      return 'text-amber-300';
    default:
      return 'text-muted';
  }
}

function Section({
  title,
  icon: Icon,
  children,
}: {
  title: string;
  icon: ComponentType<{ size?: number; className?: string }>;
  children: ReactNode;
}) {
  return (
    <section className="border-t border-[--color-border]">
      <div className="flex items-center gap-1.5 px-3.5 py-2.5">
        <Icon size={11} className="text-[--color-muted]" />
        <h2 className="text-[10px] font-medium uppercase tracking-wider text-[--color-muted]">
          {title}
        </h2>
      </div>
      <div className="px-3.5 pb-3">{children}</div>
    </section>
  );
}

function PublicRunSkeleton() {
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-10">
      <div className="rounded-xl border border-[--color-border] bg-[--color-surface]">
        <div className="p-4 space-y-4">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-8 w-3/4" />
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Skeleton className="h-12 rounded-md" />
            <Skeleton className="h-12 rounded-md" />
            <Skeleton className="h-12 rounded-md" />
            <Skeleton className="h-12 rounded-md" />
          </div>
        </div>
        <div className="border-t border-[--color-border] p-4 space-y-2">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-2/3" />
        </div>
      </div>
    </div>
  );
}

function PublicRunError({ message }: { message: string }) {
  const { t } = useTranslation();
  return (
    <main className="flex min-h-[100dvh] items-center justify-center bg-[--color-bg] px-4 text-[--color-primary]">
      <div className="w-full max-w-md rounded-xl border border-[--color-border] bg-[--color-surface] p-5 text-center">
        <div className="mx-auto mb-3 flex h-9 w-9 items-center justify-center rounded-md bg-red-500/10 text-red-300">
          <AlertCircle size={18} />
        </div>
        <h1 className="text-sm font-semibold">
          {t('publicRun.errorTitle', { defaultValue: 'Run unavailable' })}
        </h1>
        <p className="mt-1 text-xs leading-relaxed text-[--color-secondary]">{message}</p>
        <Link
          to="/"
          className="mt-4 inline-flex h-8 items-center justify-center rounded-md border border-[--color-border] px-3 text-xs text-[--color-secondary] transition-[transform,colors,background-color,border-color] duration-150 ease-[cubic-bezier(0.16,1,0.3,1)] hover:bg-[--color-surface-hover] hover:text-[--color-primary] active:scale-[0.98] focus:outline-none focus:ring-2 focus:ring-amber-500/30"
        >
          {t('publicRun.backHome', { defaultValue: 'Back to Baaton' })}
        </Link>
      </div>
    </main>
  );
}

export default function PublicRun() {
  const { t } = useTranslation();
  const { token } = useParams<{ token: string }>();
  const [run, setRun] = useState<PublicRun | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!token) {
      setError(t('publicRun.missingToken', { defaultValue: 'Missing public run token.' }));
      setLoading(false);
      return;
    }

    setLoading(true);
    api.public.get<PublicRun>(`/public/runs/${token}`)
      .then(setRun)
      .catch((err) => {
        if (err instanceof ApiError && err.status === 404) {
          setError(t('publicRun.notFound', { defaultValue: 'This run is private, unpublished, or does not exist.' }));
        } else {
          setError(t('publicRun.genericError', { defaultValue: 'Could not load this run card.' }));
        }
      })
      .finally(() => setLoading(false));
  }, [token, t]);

  const duration = useMemo(
    () => formatDuration(run?.session.started_at, run?.session.completed_at),
    [run?.session.started_at, run?.session.completed_at],
  );

  const [copiedField, setCopiedField] = useState<'link' | 'md' | null>(null);

  const handleCopy = async (field: 'link' | 'md', text: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Old browsers / insecure contexts: silently no-op rather than throw.
      return;
    }
    setCopiedField(field);
    window.setTimeout(() => setCopiedField((curr) => (curr === field ? null : curr)), 2000);
  };

  if (loading) {
    return (
      <main className="min-h-[100dvh] bg-[--color-bg] text-[--color-primary]">
        <PublicRunSkeleton />
      </main>
    );
  }

  if (error || !run) {
    return <PublicRunError message={error || t('publicRun.genericError', { defaultValue: 'Could not load this run card.' })} />;
  }

  const filesChanged = run.session.files_changed.length > 0
    ? run.session.files_changed
    : run.latest_tldr?.files_changed ?? [];
  const summary = run.session.summary || run.latest_tldr?.summary || '';
  const publicUrl = `${PUBLIC_RUN_ORIGIN}/${run.session.public_token}`;
  const markdownForPR = buildMarkdownForPR(run, PUBLIC_RUN_ORIGIN);

  return (
    <main className="min-h-[100dvh] bg-[--color-bg] px-4 py-8 text-[--color-primary] md:py-12">
      <div className="mx-auto w-full max-w-3xl">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <Link to="/" className="font-mono text-xs font-semibold text-amber-400">
            Baaton
          </Link>
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-[10px] tabular-nums text-[--color-muted]">
              /r/{run.session.public_token}
            </span>
            <button
              type="button"
              onClick={() => handleCopy('link', publicUrl)}
              className="inline-flex h-7 items-center gap-1.5 rounded-md border border-[--color-border] bg-[--color-surface] px-2.5 text-[11px] text-[--color-secondary] transition-[transform,colors,background-color,border-color] duration-150 ease-[cubic-bezier(0.16,1,0.3,1)] hover:bg-[--color-surface-hover] hover:text-[--color-primary] active:scale-[0.98] focus:outline-none focus:ring-2 focus:ring-amber-500/30"
            >
              {copiedField === 'link' ? (
                <>
                  <Check size={11} className="text-emerald-300" />
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
              onClick={() => handleCopy('md', markdownForPR)}
              className="inline-flex h-7 items-center gap-1.5 rounded-md border border-[--color-border] bg-[--color-surface] px-2.5 text-[11px] text-[--color-secondary] transition-[transform,colors,background-color,border-color] duration-150 ease-[cubic-bezier(0.16,1,0.3,1)] hover:bg-[--color-surface-hover] hover:text-[--color-primary] active:scale-[0.98] focus:outline-none focus:ring-2 focus:ring-amber-500/30"
            >
              {copiedField === 'md' ? (
                <>
                  <Check size={11} className="text-emerald-300" />
                  {t('agentRun.markdownCopied', { defaultValue: 'Markdown copied' })}
                </>
              ) : (
                <>
                  <FileText size={11} />
                  {t('agentRun.copyMarkdown', { defaultValue: 'Copy markdown for PR' })}
                </>
              )}
            </button>
          </div>
        </div>

        <article className="rounded-xl border border-[--color-border] bg-[--color-surface]">
          <header className="p-4">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <span className="font-mono text-[11px] font-semibold tabular-nums text-amber-400">
                {run.issue.display_id}
              </span>
              <span className={cn('rounded-full px-2.5 py-1 text-[11px] font-medium', statusTone(run.session.status))}>
                {run.session.status}
              </span>
              {run.issue.priority && (
                <span className="rounded-full bg-blue-500/10 px-2.5 py-1 text-[11px] font-medium text-blue-300">
                  {run.issue.priority}
                </span>
              )}
            </div>
            <h1 className="text-xl font-semibold leading-tight md:text-2xl">
              {run.issue.title}
            </h1>
            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[--color-secondary]">
              <span>{run.project.name}</span>
              <span className="font-mono tabular-nums">{formatDate(run.session.published_at || run.session.updated_at)}</span>
            </div>
          </header>

          <section className="grid grid-cols-2 gap-px border-t border-[--color-border] bg-[--color-border] md:grid-cols-4">
            <div className="bg-[--color-surface] px-3.5 py-3">
              <div className="text-[10px] font-medium uppercase tracking-wider text-[--color-muted]">
                {t('publicRun.agent', { defaultValue: 'Agent' })}
              </div>
              <div className="mt-1 truncate text-sm font-medium">{run.session.agent_name}</div>
            </div>
            <div className="bg-[--color-surface] px-3.5 py-3">
              <div className="text-[10px] font-medium uppercase tracking-wider text-[--color-muted]">
                {t('publicRun.duration', { defaultValue: 'Duration' })}
              </div>
              <div className="mt-1 font-mono text-sm tabular-nums">{duration ?? '-'}</div>
            </div>
            <div className="bg-[--color-surface] px-3.5 py-3">
              <div className="text-[10px] font-medium uppercase tracking-wider text-[--color-muted]">
                {t('publicRun.files', { defaultValue: 'Files' })}
              </div>
              <div className="mt-1 font-mono text-sm tabular-nums">{filesChanged.length}</div>
            </div>
            <div className="bg-[--color-surface] px-3.5 py-3">
              <div className="text-[10px] font-medium uppercase tracking-wider text-[--color-muted]">
                {t('publicRun.tests', { defaultValue: 'Tests' })}
              </div>
              <div className={cn('mt-1 font-mono text-sm tabular-nums', testsTone(run.session.tests_status))}>
                {run.session.tests_status}
              </div>
            </div>
          </section>

          <Section title={t('publicRun.summary', { defaultValue: 'Summary' })} icon={Bot}>
            {summary ? (
              <p className="text-sm leading-relaxed text-[--color-primary]/90">{summary}</p>
            ) : (
              <p className="text-sm text-[--color-muted]">
                {t('publicRun.noSummary', { defaultValue: 'No summary was posted for this run.' })}
              </p>
            )}
          </Section>

          {filesChanged.length > 0 && (
            <Section title={t('publicRun.changedFiles', { defaultValue: 'Changed files' })} icon={FileCode2}>
              <div className="space-y-1">
                {filesChanged.slice(0, 10).map((file, index) => (
                  <div
                    key={`${file}-${index}`}
                    style={{ '--row-index': index } as CSSProperties}
                    className="animate-row-in flex min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-xs hover:bg-[--color-surface-hover]"
                  >
                    <FileCode2 size={12} className="shrink-0 text-[--color-muted]" />
                    <span className="truncate font-mono text-[--color-secondary]">{file}</span>
                  </div>
                ))}
                {filesChanged.length > 10 && (
                  <div className="px-2 pt-1 text-[11px] text-[--color-muted]">
                    {t('publicRun.moreFiles', { count: filesChanged.length - 10, defaultValue: '+{{count}} more files' })}
                  </div>
                )}
              </div>
            </Section>
          )}

          <Section title={t('publicRun.timeline', { defaultValue: 'Timeline' })} icon={ListChecks}>
            {run.steps.length > 0 ? (
              <div className="space-y-1">
                {run.steps.map((step, index) => (
                  <div
                    key={`${step.created_at}-${index}`}
                    style={{ '--row-index': index } as CSSProperties}
                    className="animate-row-in grid grid-cols-[auto_1fr_auto] items-start gap-2 rounded-md px-2 py-1.5 text-xs hover:bg-[--color-surface-hover]"
                  >
                    <TerminalSquare size={12} className="mt-0.5 text-[--color-muted]" />
                    <div className="min-w-0">
                      <div className="mb-0.5 font-mono text-[10px] uppercase tracking-wider text-[--color-muted]">
                        {step.step_type}
                      </div>
                      <div className="break-words text-[--color-secondary]">{step.message}</div>
                    </div>
                    <time className="hidden font-mono text-[10px] tabular-nums text-[--color-muted] sm:block">
                      {formatDate(step.created_at)}
                    </time>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-[--color-muted]">
                {t('publicRun.noSteps', { defaultValue: 'No progress steps were recorded.' })}
              </p>
            )}
          </Section>

          <footer className="border-t border-[--color-border] px-3.5 py-3">
            <div className="flex flex-col gap-2 text-xs text-[--color-secondary] sm:flex-row sm:items-center sm:justify-between">
              <span className="inline-flex items-center gap-1.5">
                <CheckCircle2 size={12} className="text-emerald-300" />
                {t('publicRun.poweredBy', { defaultValue: 'Powered by Baaton - receipts for AI agent work' })}
              </span>
              <div className="flex items-center gap-3">
                {run.session.pr_url && (
                  <a
                    href={run.session.pr_url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-[--color-secondary] transition-colors hover:text-[--color-primary] focus:outline-none focus:ring-2 focus:ring-amber-500/30"
                  >
                    <GitPullRequest size={12} />
                    {t('publicRun.pullRequest', { defaultValue: 'Pull request' })}
                    <ExternalLink size={10} />
                  </a>
                )}
                <span className="inline-flex items-center gap-1 font-mono tabular-nums text-[--color-muted]">
                  <Clock size={11} />
                  {formatDate(run.session.updated_at)}
                </span>
              </div>
            </div>
          </footer>
        </article>
      </div>
    </main>
  );
}
