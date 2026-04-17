import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Sparkles, Check, X, Loader2, FolderKanban } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useApi } from '@/hooks/useApi';

interface ProposalData {
  project_id?: string;
  project_name?: string;
  project_prefix?: string;
  title?: string;
  description?: string;
  type?: 'bug' | 'feature' | 'improvement' | 'question';
  priority?: 'urgent' | 'high' | 'medium' | 'low';
  tags?: string[];
  category?: string[];
}

interface IssueProposalProps {
  data: ProposalData;
  onAction?: (prompt: string) => void;
}

const TYPE_OPTIONS = ['bug', 'feature', 'improvement', 'question'] as const;
const PRIORITY_OPTIONS = ['urgent', 'high', 'medium', 'low'] as const;

const PRIORITY_STYLE: Record<string, string> = {
  urgent: 'bg-red-500/15 text-red-500 border-red-500/30',
  high: 'bg-orange-500/15 text-orange-500 border-orange-500/30',
  medium: 'bg-amber-500/15 text-amber-500 border-amber-500/30',
  low: 'bg-emerald-500/15 text-emerald-500 border-emerald-500/30',
};

const TYPE_STYLE: Record<string, string> = {
  bug: 'bg-red-500/15 text-red-500 border-red-500/30',
  feature: 'bg-violet-500/15 text-violet-500 border-violet-500/30',
  improvement: 'bg-blue-500/15 text-blue-500 border-blue-500/30',
  question: 'bg-zinc-500/15 text-zinc-400 border-zinc-500/30',
};

export default function IssueProposal({ data, onAction }: IssueProposalProps) {
  const safe = data ?? {};
  const apiClient = useApi();
  const { data: projects = [] } = useQuery({
    queryKey: ['projects'],
    queryFn: () => apiClient.projects.list(),
    staleTime: 60_000,
  });

  const [projectId, setProjectId] = useState<string>(safe.project_id || '');
  const [title, setTitle] = useState(safe.title || '');
  const [description, setDescription] = useState(safe.description || '');
  const [type, setType] = useState<typeof TYPE_OPTIONS[number]>(
    (safe.type as typeof TYPE_OPTIONS[number]) || 'feature',
  );
  const [priority, setPriority] = useState<typeof PRIORITY_OPTIONS[number]>(
    (safe.priority as typeof PRIORITY_OPTIONS[number]) || 'medium',
  );
  const [submitted, setSubmitted] = useState<'approved' | 'cancelled' | null>(null);

  const selectedProject = projects.find(p => p.id === projectId);
  const currentPrefix = selectedProject?.prefix ?? safe.project_prefix ?? '?';

  const handleApprove = () => {
    if (!onAction || submitted) return;
    setSubmitted('approved');
    const tags = (safe.tags || []).join(', ') || '(none)';
    const category = (safe.category || []).join(', ') || '(none)';
    onAction(
      `__INTERNAL__: User approved. Call create_issue now with EXACTLY these final values:\n` +
      `- project_id: ${projectId}\n` +
      `- title: ${title}\n` +
      `- description: ${description}\n` +
      `- type: ${type}\n` +
      `- priority: ${priority}\n` +
      `- tags: [${tags}]\n` +
      `- category: [${category}]\n` +
      `- status: backlog`
    );
  };

  const handleCancel = () => {
    if (!onAction || submitted) return;
    setSubmitted('cancelled');
    onAction("__INTERNAL__: User cancelled. Don't create the issue. Just acknowledge briefly.");
  };

  // Compact state shown after approve/cancel
  if (submitted === 'approved') {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/5 px-3 py-2 text-[12px]">
        <Loader2 size={12} className="animate-spin text-emerald-500 shrink-0" />
        <span className="text-emerald-400 font-medium">Creation en cours…</span>
        <span className="text-[--color-muted] truncate">{title}</span>
      </div>
    );
  }
  if (submitted === 'cancelled') {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-[--color-border] bg-[--color-surface-hover]/30 px-3 py-2 text-[12px] text-[--color-muted]">
        <X size={12} className="shrink-0" />
        <span>Proposition annulee</span>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-amber-500/20 bg-amber-500/5">
        <Sparkles size={13} className="text-amber-500 shrink-0" />
        <span className="text-[11px] font-semibold text-amber-500 uppercase tracking-wide">
          Proposition de creation
        </span>
        <span className="ml-auto font-mono text-[10px] text-[--color-muted]">
          {currentPrefix}
        </span>
      </div>

      {/* Body */}
      <div className="p-3 space-y-3 bg-[--color-bg]">
        {/* Project dropdown */}
        <div>
          <label className="block text-[10px] font-medium text-[--color-muted] uppercase tracking-wide mb-1">
            Projet
          </label>
          <div className="relative">
            <FolderKanban size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[--color-muted] pointer-events-none" />
            <select
              value={projectId}
              onChange={e => setProjectId(e.target.value)}
              disabled={!!submitted || projects.length === 0}
              className="w-full appearance-none rounded-md border border-[--color-border] bg-[--color-surface] pl-8 pr-7 py-1.5 text-[13px] text-[--color-primary] outline-none focus:border-amber-500 disabled:opacity-50 cursor-pointer"
            >
              {projects.length === 0 && (
                <option value="">Chargement des projets…</option>
              )}
              {!projectId && projects.length > 0 && (
                <option value="" disabled>Selectionner un projet…</option>
              )}
              {projects.map(p => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.prefix})
                </option>
              ))}
            </select>
            <svg
              className="absolute right-2 top-1/2 -translate-y-1/2 text-[--color-muted] pointer-events-none"
              width="10" height="10" viewBox="0 0 20 20" fill="currentColor"
            >
              <path d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.51a.75.75 0 01-1.08 0L5.21 8.27a.75.75 0 01.02-1.06z" />
            </svg>
          </div>
        </div>

        {/* Title */}
        <div>
          <label className="block text-[10px] font-medium text-[--color-muted] uppercase tracking-wide mb-1">
            Titre
          </label>
          <input
            type="text"
            value={title}
            onChange={e => setTitle(e.target.value)}
            disabled={!!submitted}
            className="w-full rounded-md border border-[--color-border] bg-[--color-surface] px-2.5 py-1.5 text-[13px] text-[--color-primary] placeholder-[--color-muted] outline-none focus:border-amber-500 disabled:opacity-50"
            placeholder="Titre clair, sans prefix"
          />
        </div>

        {/* Description */}
        <div>
          <label className="block text-[10px] font-medium text-[--color-muted] uppercase tracking-wide mb-1">
            Description
          </label>
          <textarea
            value={description}
            onChange={e => setDescription(e.target.value)}
            disabled={!!submitted}
            rows={3}
            className="w-full rounded-md border border-[--color-border] bg-[--color-surface] px-2.5 py-1.5 text-[12px] text-[--color-primary] placeholder-[--color-muted] outline-none focus:border-amber-500 disabled:opacity-50 resize-none"
            placeholder="Details, reproduction, contexte..."
          />
        </div>

        {/* Type + Priority */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-[10px] font-medium text-[--color-muted] uppercase tracking-wide mb-1">
              Type
            </label>
            <div className="flex flex-wrap gap-1">
              {TYPE_OPTIONS.map(t => (
                <button
                  key={t}
                  onClick={() => !submitted && setType(t)}
                  disabled={!!submitted}
                  className={cn(
                    'rounded-full px-2 py-0.5 text-[10px] font-medium border capitalize transition-all disabled:opacity-50',
                    type === t
                      ? TYPE_STYLE[t]
                      : 'border-[--color-border] text-[--color-muted] hover:text-[--color-primary]',
                  )}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-[10px] font-medium text-[--color-muted] uppercase tracking-wide mb-1">
              Priorite
            </label>
            <div className="flex flex-wrap gap-1">
              {PRIORITY_OPTIONS.map(p => (
                <button
                  key={p}
                  onClick={() => !submitted && setPriority(p)}
                  disabled={!!submitted}
                  className={cn(
                    'rounded-full px-2 py-0.5 text-[10px] font-medium border capitalize transition-all disabled:opacity-50',
                    priority === p
                      ? PRIORITY_STYLE[p]
                      : 'border-[--color-border] text-[--color-muted] hover:text-[--color-primary]',
                  )}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Categories + Tags display */}
        {((safe.category && safe.category.length > 0) || (safe.tags && safe.tags.length > 0)) && (
          <div className="flex flex-wrap gap-1.5">
            {safe.category?.map(c => (
              <span key={c} className="rounded border border-[--color-border] bg-[--color-surface] px-1.5 py-0.5 text-[10px] text-[--color-secondary]">
                {c}
              </span>
            ))}
            {safe.tags?.map(t => (
              <span key={t} className="rounded bg-[--color-surface-hover] px-1.5 py-0.5 text-[10px] text-[--color-muted]">
                #{t}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Action buttons */}
      <div className="flex items-center justify-end gap-2 px-3 py-2 border-t border-[--color-border] bg-[--color-surface]/50">
        <button
          onClick={handleCancel}
          disabled={!!submitted}
          className="flex items-center gap-1.5 rounded-md border border-[--color-border] bg-[--color-bg] px-2.5 py-1 text-[11px] font-medium text-[--color-secondary] hover:text-[--color-primary] hover:border-[--color-muted] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <X size={12} />
          Annuler
        </button>
        <button
          onClick={handleApprove}
          disabled={!!submitted || !title.trim() || !projectId}
          className="flex items-center gap-1.5 rounded-md bg-amber-500 px-2.5 py-1 text-[11px] font-semibold text-black hover:bg-amber-400 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Check size={12} />
          {submitted ? 'Envoye' : 'Creer'}
        </button>
      </div>
    </div>
  );
}
