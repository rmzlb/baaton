import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Sparkles, Check, X } from 'lucide-react';
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
import type { DynamicToolUIPart } from 'ai';

interface ProposalInput {
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
  part: DynamicToolUIPart;
  addToolOutput: (opts: { tool: string; toolCallId: string; output: unknown }) => void;
  inBatch?: boolean;
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
  if (orgId.startsWith('org_')) return orgId.slice(4, 10);
  return orgId.slice(0, 8);
}

export default function IssueProposal({ part, addToolOutput, inBatch }: IssueProposalProps) {
  const input = (part.input ?? {}) as ProposalInput;
  const apiClient = useApi();

  const { data: projects = [] } = useQuery({
    queryKey: ['projects-all-orgs'],
    queryFn: () => apiClient.projects.list({ all: true }),
    staleTime: 60_000,
  });

  const [projectId, setProjectId] = useState<string>(input.project_id || '');

  // Defensive fallback: if the agent passes a prefix (e.g. "HLM") or name instead of a UUID,
  // resolve it client-side once projects load so the Select preselects correctly. The backend
  // also resolves before emitting, but this keeps the form robust if that path is bypassed
  // (older deployment, partial outage, user on slow network). Runs once per project list load.
  useEffect(() => {
    if (!projectId || projects.length === 0) return;
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (UUID_RE.test(projectId)) return;
    const raw = projectId.trim();
    const rawUpper = raw.toUpperCase();
    const byPrefix = projects.find(p => (p.prefix || '').toUpperCase() === rawUpper);
    if (byPrefix) { setProjectId(byPrefix.id); return; }
    const byName = projects.find(p => (p.name || '').toLowerCase() === raw.toLowerCase());
    if (byName) { setProjectId(byName.id); return; }
    const byNameHint = projects.find(p => (p.name || '').toLowerCase().includes(raw.toLowerCase()));
    if (byNameHint) setProjectId(byNameHint.id);
  }, [projects, projectId]);
  const [title, setTitle] = useState(input.title || '');
  const [description, setDescription] = useState(input.description || '');
  const [type, setType] = useState<typeof TYPE_OPTIONS[number]>(
    (input.type as typeof TYPE_OPTIONS[number]) || 'feature',
  );
  const [priority, setPriority] = useState<typeof PRIORITY_OPTIONS[number]>(
    (input.priority as typeof PRIORITY_OPTIONS[number]) || 'medium',
  );

  if (part.state === 'output-available') {
    const output = part.output as { approved: boolean; finalValues?: { title?: string } } | undefined;
    if (output?.approved) {
      // This is the approval step only — the actual DB insert happens in the
      // next agent turn via create_issue. We say "Approuvé" to avoid showing
      // "Créé" twice (once here, once when create_issue's result renders).
      return (
        <div className="flex items-center gap-2 rounded-xl border border-emerald-500/20 bg-emerald-500/5 px-3 py-2">
          <Check size={14} className="text-emerald-500 shrink-0" />
          <span className="text-[12px] font-medium text-emerald-500">Approuvé</span>
          <span className="text-[12px] text-[--color-muted] truncate">{output.finalValues?.title ?? title}</span>
        </div>
      );
    }
    return (
      <div className="flex items-center gap-2 rounded-xl border border-[--color-border] bg-[--color-surface] px-3 py-2">
        <X size={14} className="text-[--color-muted] shrink-0" />
        <span className="text-[12px] text-[--color-muted]">Proposition annulée</span>
      </div>
    );
  }

  if (part.state !== 'input-available') return null;

  const selectedProject = projects.find(p => p.id === projectId);
  const currentPrefix = selectedProject?.prefix ?? input.project_prefix ?? '?';

  const projectsByOrg = (() => {
    const groups = new Map<string, typeof projects>();
    for (const p of projects) {
      const list = groups.get(p.org_id) ?? [];
      list.push(p);
      groups.set(p.org_id, list);
    }
    return Array.from(groups.entries());
  })();

  const handleApprove = () => {
    addToolOutput({
      tool: 'propose_issue',
      toolCallId: part.toolCallId,
      output: {
        approved: true,
        finalValues: {
          project_id: projectId,
          title,
          description,
          type,
          priority,
          tags: input.tags ?? [],
          category: input.category ?? [],
          status: 'backlog',
        },
      },
    });
  };

  const handleCancel = () => {
    addToolOutput({
      tool: 'propose_issue',
      toolCallId: part.toolCallId,
      output: { approved: false },
    });
  };

  const isMultiOrg = projectsByOrg.length > 1;
  const titleMissing = !title.trim();
  const projectMissing = !projectId || !projects.find(p => p.id === projectId);
  const canApprove = !titleMissing && !projectMissing;

  return (
    <div className="rounded-2xl border border-[--color-border] bg-[--color-surface] overflow-hidden relative">
      {/* Left accent bar — Baaton kanban card style */}
      <div className="absolute left-0 top-0 bottom-0 w-[3px] bg-amber-500" />

      <div className="px-4 pt-3 pb-2 flex items-center gap-2">
        <Sparkles size={14} className="text-amber-500 shrink-0" />
        <span className="text-[10px] font-semibold text-[--color-muted] uppercase tracking-wider">
          Nouvelle issue
        </span>
        <Badge variant="secondary" className="ml-auto h-5 font-mono text-[10px]">
          {currentPrefix}
        </Badge>
      </div>

      <div className="px-4 pb-4 space-y-3">
        <div>
          <label className="block text-[10px] font-medium text-[--color-muted] uppercase tracking-wide mb-1">
            Projet {projectMissing && <span className="text-red-500 normal-case">— requis</span>}
          </label>
          <Select value={projectId} onValueChange={setProjectId}>
            <SelectTrigger
              className={cn(
                // h-10 + text-base on mobile prevents iOS auto-zoom and meets ~40px tap target.
                // sm+: density-optimized 36px row.
                'w-full h-10 sm:h-9 text-base sm:text-[13px]',
                projectMissing && 'border-red-500/50 focus:ring-red-500/30',
              )}
            >
              <SelectValue placeholder={projects.length === 0 ? "Chargement…" : "Sélectionner un projet"} />
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

        <div>
          <label className="block text-[10px] font-medium text-[--color-muted] uppercase tracking-wide mb-1">
            Titre {titleMissing && <span className="text-red-500 normal-case">— requis</span>}
          </label>
          <Input
            value={title}
            onChange={e => setTitle(e.target.value)}
            placeholder="Titre clair, sans prefix"
            // text-base on mobile to prevent iOS auto-zoom on focus.
            className={cn(
              'h-10 sm:h-9 text-base sm:text-[13px]',
              titleMissing && 'border-red-500/50 focus-visible:ring-red-500/30',
            )}
          />
        </div>

        <div>
          <label className="block text-[10px] font-medium text-[--color-muted] uppercase tracking-wide mb-1">
            Description
          </label>
          <Textarea
            value={description}
            onChange={e => setDescription(e.target.value)}
            rows={4}
            placeholder="Détails, reproduction, contexte..."
            // text-base on mobile to prevent iOS auto-zoom on focus.
            className="text-base sm:text-[12px] resize-none"
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-[10px] font-medium text-[--color-muted] uppercase tracking-wide mb-1.5">
              Type
            </label>
            <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Type">
              {TYPE_OPTIONS.map(t => (
                <button
                  key={t}
                  type="button"
                  role="radio"
                  aria-checked={type === t}
                  onClick={() => setType(t)}
                  // min-h 32px tap target with comfortable padding on mobile.
                  className={cn(
                    'rounded-full px-3 py-1.5 sm:px-2.5 sm:py-1 text-[12px] sm:text-[11px] font-medium border capitalize transition-all min-h-[32px] inline-flex items-center justify-center focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/40',
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
            <label className="block text-[10px] font-medium text-[--color-muted] uppercase tracking-wide mb-1.5">
              Priorité
            </label>
            <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Priorité">
              {PRIORITY_OPTIONS.map(p => (
                <button
                  key={p}
                  type="button"
                  role="radio"
                  aria-checked={priority === p}
                  onClick={() => setPriority(p)}
                  className={cn(
                    'rounded-full px-3 py-1.5 sm:px-2.5 sm:py-1 text-[12px] sm:text-[11px] font-medium border capitalize transition-all min-h-[32px] inline-flex items-center justify-center focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/40',
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

        {((input.category && input.category.length > 0) || (input.tags && input.tags.length > 0)) && (
          <div className="flex flex-wrap gap-1.5">
            {input.category?.map(c => (
              <Badge key={c} variant="outline" className="h-5 text-[10px]">
                {c}
              </Badge>
            ))}
            {input.tags?.map(t => (
              <Badge key={t} variant="secondary" className="h-5 text-[10px]">
                #{t}
              </Badge>
            ))}
          </div>
        )}
      </div>

      {!inBatch && (
        <div className="flex items-center justify-between gap-2 px-4 py-2.5 border-t border-[--color-border] bg-[--color-surface-hover]/30">
          <span className="text-[11px] text-[--color-muted]">
            {!canApprove ? (
              <span className="text-red-500">Remplis les champs requis avant d'approuver</span>
            ) : (
              <span>Prêt à créer</span>
            )}
          </span>
          <div className="flex items-center gap-2">
            <Button onClick={handleCancel} variant="secondary" size="sm">
              <X size={12} />
              Annuler
            </Button>
            <Button
              onClick={handleApprove}
              disabled={!canApprove}
              size="sm"
              className="bg-amber-500 text-black hover:bg-amber-400"
            >
              <Check size={12} />
              Approuver
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
