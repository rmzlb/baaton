import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Sparkles, Check, X, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useApi } from '@/hooks/useApi';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

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

function shortOrg(orgId: string): string {
  // Clerk org ids look like 'org_2aBcD...' — take the last 6 chars as a stable shorthand
  if (orgId.startsWith('org_')) return orgId.slice(4, 10);
  return orgId.slice(0, 8);
}

export default function IssueProposal({ data, onAction }: IssueProposalProps) {
  const safe = data ?? {};
  const apiClient = useApi();

  // Fetch ALL projects across every org the user belongs to
  const { data: projects = [] } = useQuery({
    queryKey: ['projects-all-orgs'],
    queryFn: () => apiClient.projects.list({ all: true }),
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

  // Group projects by org for the dropdown
  const projectsByOrg = useMemo(() => {
    const groups = new Map<string, typeof projects>();
    for (const p of projects) {
      const list = groups.get(p.org_id) ?? [];
      list.push(p);
      groups.set(p.org_id, list);
    }
    return Array.from(groups.entries());
  }, [projects]);

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

  // Compact states shown after approve/cancel
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

  const isMultiOrg = projectsByOrg.length > 1;

  return (
    <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-amber-500/20 bg-amber-500/5">
        <Sparkles size={13} className="text-amber-500 shrink-0" />
        <span className="text-[11px] font-semibold text-amber-500 uppercase tracking-wide">
          Proposition de creation
        </span>
        <Badge variant="secondary" className="ml-auto h-5 font-mono text-[10px]">
          {currentPrefix}
        </Badge>
      </div>

      {/* Body */}
      <div className="p-3 space-y-3 bg-[--color-bg]">
        {/* Project dropdown (shadcn Select) */}
        <div>
          <label className="block text-[10px] font-medium text-[--color-muted] uppercase tracking-wide mb-1">
            Projet
          </label>
          <Select value={projectId} onValueChange={setProjectId} disabled={!!submitted}>
            <SelectTrigger className="w-full h-9 text-[13px]">
              <SelectValue placeholder={projects.length === 0 ? "Chargement…" : "Selectionner un projet"} />
            </SelectTrigger>
            <SelectContent>
              {isMultiOrg ? (
                projectsByOrg.map(([orgId, orgProjects]) => (
                  <SelectGroup key={orgId}>
                    <SelectLabel className="text-[10px] font-medium text-[--color-muted] uppercase tracking-wide">
                      Org {shortOrg(orgId)}
                    </SelectLabel>
                    {orgProjects.map(p => (
                      <SelectItem key={p.id} value={p.id} className="text-[13px]">
                        <span className="font-medium">{p.name}</span>
                        <span className="ml-2 font-mono text-[11px] text-[--color-muted]">{p.prefix}</span>
                      </SelectItem>
                    ))}
                  </SelectGroup>
                ))
              ) : (
                projects.map(p => (
                  <SelectItem key={p.id} value={p.id} className="text-[13px]">
                    <span className="font-medium">{p.name}</span>
                    <span className="ml-2 font-mono text-[11px] text-[--color-muted]">{p.prefix}</span>
                  </SelectItem>
                ))
              )}
            </SelectContent>
          </Select>
        </div>

        {/* Title (shadcn Input) */}
        <div>
          <label className="block text-[10px] font-medium text-[--color-muted] uppercase tracking-wide mb-1">
            Titre
          </label>
          <Input
            value={title}
            onChange={e => setTitle(e.target.value)}
            disabled={!!submitted}
            placeholder="Titre clair, sans prefix"
            className="h-9 text-[13px]"
          />
        </div>

        {/* Description (shadcn Textarea) */}
        <div>
          <label className="block text-[10px] font-medium text-[--color-muted] uppercase tracking-wide mb-1">
            Description
          </label>
          <Textarea
            value={description}
            onChange={e => setDescription(e.target.value)}
            disabled={!!submitted}
            rows={4}
            placeholder="Details, reproduction, contexte..."
            className="text-[12px] resize-none"
          />
        </div>

        {/* Type + Priority pills */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-[10px] font-medium text-[--color-muted] uppercase tracking-wide mb-1">
              Type
            </label>
            <div className="flex flex-wrap gap-1">
              {TYPE_OPTIONS.map(t => (
                <button
                  key={t}
                  type="button"
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
                  type="button"
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
              <Badge key={c} variant="outline" className="h-5 text-[10px]">
                {c}
              </Badge>
            ))}
            {safe.tags?.map(t => (
              <Badge key={t} variant="secondary" className="h-5 text-[10px]">
                #{t}
              </Badge>
            ))}
          </div>
        )}
      </div>

      {/* Action buttons (shadcn Button) */}
      <div className="flex items-center justify-end gap-2 px-3 py-2 border-t border-[--color-border] bg-[--color-surface]/50">
        <Button
          onClick={handleCancel}
          disabled={!!submitted}
          variant="secondary"
          size="sm"
        >
          <X size={12} />
          Annuler
        </Button>
        <Button
          onClick={handleApprove}
          disabled={!!submitted || !title.trim() || !projectId}
          size="sm"
          className="bg-amber-500 text-black hover:bg-amber-400"
        >
          <Check size={12} />
          {submitted ? 'Envoye' : 'Creer'}
        </Button>
      </div>
    </div>
  );
}
