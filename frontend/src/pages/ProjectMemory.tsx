/**
 * ProjectMemory — Unified "Agent Brain" page
 *
 * Combines:
 *   - Memory cards (stack, conventions, architecture, constraints, focus, learnings)
 *     → reuses ProjectContext in embedded mode
 *   - Connection panel (.env block, project_id, curl examples) — collapsible
 *   - Behaviors panel (heartbeat, auto-triage, recap, digest, guardrails) — collapsible
 *     → reuses AgentConfig in embedded mode
 *
 * Routes: /projects/:slug/memory and /memory (redirects to first project)
 */

import { useState, useEffect, useMemo } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Brain, Plug, Zap, ChevronDown, Copy, CheckCircle2, KeyRound, ExternalLink, FolderOpen, Search, X,
} from 'lucide-react';
import { useApi } from '@/hooks/useApi';
import { cn } from '@/lib/utils';
import type { Project, ProjectContext as ProjectContextType } from '@/lib/types';
import ProjectContextEditor from './ProjectContext';
import { AgentConfig as AgentConfigEditor } from './AgentConfig';

// ─── Helpers ──────────────────────────────────

const API_BASE = (import.meta.env.VITE_API_URL || 'https://api.baaton.dev') + '/api/v1';

function timeAgo(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffMs = now - then;
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  return `${diffDay}d ago`;
}

const CONTEXT_FIELD_KEYS: (keyof ProjectContextType)[] = [
  'stack', 'conventions', 'architecture', 'constraints', 'current_focus', 'learnings',
];

// ─── Page ─────────────────────────────────────

export default function ProjectMemory() {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const apiClient = useApi();

  const [showConnection, setShowConnection] = useState(false);
  const [showBehaviors, setShowBehaviors] = useState(false);

  // Projects list (for selector)
  const { data: projects = [], isLoading: projectsLoading } = useQuery({
    queryKey: ['projects-memory-page'],
    queryFn: () => apiClient.projects.list(),
    staleTime: 60_000,
  });

  const currentProject = useMemo(() => {
    if (!slug) return null;
    return projects.find(p => p.slug === slug) || null;
  }, [slug, projects]);

  // Redirect to first project if no slug
  useEffect(() => {
    if (!slug && projects.length > 0 && !projectsLoading) {
      navigate(`/projects/${projects[0].slug}/memory`, { replace: true });
    }
  }, [slug, projects, projectsLoading, navigate]);

  // Project context (for completeness %)
  const { data: context } = useQuery({
    queryKey: ['project-context', currentProject?.id],
    queryFn: () => apiClient.get<ProjectContextType>(`/projects/${currentProject!.id}/context`),
    enabled: !!currentProject?.id,
    staleTime: 30_000,
  });

  // Agent config (for last_heartbeat_at)
  const { data: agentConfig } = useQuery({
    queryKey: ['agent-config'],
    queryFn: () => apiClient.agentConfig.get(),
    staleTime: 60_000,
    retry: false,
  });

  // Compute completeness
  const completeness = useMemo(() => {
    if (!context) return 0;
    const filled = CONTEXT_FIELD_KEYS.filter(k => {
      const v = context[k];
      return typeof v === 'string' && v.trim().length > 0;
    }).length;
    return Math.round((filled / CONTEXT_FIELD_KEYS.length) * 100);
  }, [context]);

  // Auto-expand Connection on first visit (low completeness = onboarding)
  useEffect(() => {
    if (context !== undefined && completeness < 30) {
      setShowConnection(true);
    }
  }, [context, completeness]);

  const lastPull = (agentConfig as any)?.last_heartbeat_at as string | null | undefined;
  const connected = !!lastPull;

  // ─── Loading & empty states ───────────────────

  if (projectsLoading) {
    return (
      <div className="p-4 md:p-6 max-w-4xl mx-auto">
        <div className="animate-pulse space-y-4">
          <div className="h-16 bg-border/30 rounded-lg" />
          <div className="h-24 bg-border/20 rounded-xl" />
          <div className="h-24 bg-border/20 rounded-xl" />
        </div>
      </div>
    );
  }

  if (projects.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full py-20 text-secondary">
        <FolderOpen size={48} className="mb-4 text-border" />
        <p className="text-lg font-medium">No projects yet</p>
        <p className="mt-1 text-sm text-tertiary">Create a project first to set up its memory.</p>
        <button
          onClick={() => navigate('/projects')}
          className="mt-4 px-4 py-2 rounded-lg bg-accent text-black text-sm font-medium hover:bg-accent-hover transition-colors"
        >
          Go to Projects
        </button>
      </div>
    );
  }

  // ─── Render ────────────────────────────────────

  return (
    <motion.div
      className="p-4 md:p-6 space-y-4 max-w-4xl mx-auto"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
    >
      {/* ─── Status bar ──────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-surface px-4 py-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent/10 shrink-0">
            <Brain size={18} className="text-accent" />
          </div>
          <div className="min-w-0">
            <h1 className="text-sm font-semibold text-primary truncate">Agent Memory</h1>
            <p className="text-[11px] text-muted truncate">
              {currentProject?.name || 'Select a project'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-4 text-[11px]">
          <span className="flex items-center gap-1.5 text-muted">
            <span className={cn(
              'h-2 w-2 rounded-full',
              connected ? 'bg-emerald-400' : 'bg-zinc-500',
            )} />
            {connected && lastPull ? `Last pull: ${timeAgo(lastPull)}` : 'Not connected'}
          </span>
          <span className="flex items-center gap-1.5">
            <span className="text-muted">Completeness:</span>
            <span className={cn(
              'font-medium tabular-nums',
              completeness >= 70 ? 'text-emerald-400' :
              completeness >= 30 ? 'text-amber-400' : 'text-zinc-400',
            )}>
              {completeness}%
            </span>
          </span>
        </div>
      </div>

      {/* ─── Project selector (lightweight) ───── */}
      <ProjectQuickSwitcher
        projects={projects}
        currentProject={currentProject}
        onSelect={(p) => navigate(`/projects/${p.slug}/memory`)}
      />

      {/* ─── Memory editor (embedded ProjectContext) ─── */}
      {currentProject && (
        <div className="rounded-xl border border-border bg-surface p-4 md:p-5">
          <ProjectContextEditor embedded basePath="/projects" />
        </div>
      )}

      {/* ─── Connection (collapsible) ──────────── */}
      {currentProject && (
        <CollapsibleSection
          icon={Plug}
          title="Connection"
          subtitle="API key, project ID, and example curl commands for your agent"
          open={showConnection}
          onToggle={() => setShowConnection(!showConnection)}
        >
          <ConnectionPanel project={currentProject} />
        </CollapsibleSection>
      )}

      {/* ─── Behaviors (collapsible, embedded AgentConfig) ─── */}
      {currentProject && (
        <CollapsibleSection
          icon={Zap}
          title="Behaviors"
          subtitle="Scheduled tasks, auto-triage, email recaps, and guardrails"
          open={showBehaviors}
          onToggle={() => setShowBehaviors(!showBehaviors)}
        >
          <AgentConfigEditor embedded />
        </CollapsibleSection>
      )}
    </motion.div>
  );
}

// ─── Quick project switcher (compact) ────────

function ProjectQuickSwitcher({
  projects,
  currentProject,
  onSelect,
}: {
  projects: Project[];
  currentProject: Project | null;
  onSelect: (p: Project) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    if (!search.trim()) return projects;
    const q = search.toLowerCase();
    return projects.filter(p =>
      p.name.toLowerCase().includes(q) ||
      p.slug.toLowerCase().includes(q) ||
      (p.prefix && p.prefix.toLowerCase().includes(q)),
    );
  }, [projects, search]);

  if (projects.length === 1 && currentProject) return null;

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className={cn(
          'w-full flex items-center gap-3 rounded-xl border bg-surface px-3 py-2 transition-all',
          open ? 'border-accent/50 ring-1 ring-accent/20' : 'border-border hover:border-border/80',
        )}
      >
        <div className={cn(
          'flex items-center justify-center w-7 h-7 rounded-md text-[10px] font-bold shrink-0',
          currentProject ? 'bg-accent/15 text-accent' : 'bg-border/30 text-muted',
        )}>
          {currentProject?.prefix?.slice(0, 3) || '?'}
        </div>
        <div className="flex-1 min-w-0 text-left">
          <div className="text-sm font-medium text-primary truncate">
            {currentProject?.name || 'Select a project'}
          </div>
        </div>
        <ChevronDown
          size={14}
          className={cn('text-muted shrink-0 transition-transform', open && 'rotate-180')}
        />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -4, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.98 }}
            transition={{ duration: 0.15 }}
            className="absolute left-0 right-0 top-full mt-1.5 z-50 rounded-xl border border-border bg-bg shadow-2xl overflow-hidden"
          >
            <div className="flex items-center gap-2 px-3 py-2.5 border-b border-border/50">
              <Search size={14} className="text-muted shrink-0" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search projects..."
                autoFocus
                className="flex-1 bg-transparent text-sm text-primary placeholder:text-tertiary outline-none"
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    setOpen(false);
                    setSearch('');
                  }
                }}
              />
              {search && (
                <button onClick={() => setSearch('')} className="text-muted hover:text-secondary">
                  <X size={12} />
                </button>
              )}
            </div>
            <div className="max-h-64 overflow-y-auto py-1">
              {filtered.length === 0 ? (
                <div className="px-4 py-6 text-center text-sm text-tertiary">
                  No projects match "{search}"
                </div>
              ) : (
                filtered.map((project) => {
                  const isActive = project.id === currentProject?.id;
                  return (
                    <button
                      key={project.id}
                      onClick={() => {
                        onSelect(project);
                        setOpen(false);
                        setSearch('');
                      }}
                      className={cn(
                        'w-full flex items-center gap-3 px-3 py-2 text-left transition-colors',
                        isActive
                          ? 'bg-accent/10 text-accent'
                          : 'text-secondary hover:bg-surface-hover hover:text-primary',
                      )}
                    >
                      <div className={cn(
                        'flex items-center justify-center w-6 h-6 rounded-md text-[10px] font-bold shrink-0',
                        isActive ? 'bg-accent/20 text-accent' : 'bg-surface text-muted',
                      )}>
                        {project.prefix?.slice(0, 3)}
                      </div>
                      <span className="flex-1 text-sm truncate">{project.name}</span>
                      {isActive && <CheckCircle2 size={13} className="text-accent shrink-0" />}
                    </button>
                  );
                })
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Collapsible section ─────────────────────

function CollapsibleSection({
  icon: Icon,
  title,
  subtitle,
  open,
  onToggle,
  children,
}: {
  icon: React.ElementType;
  title: string;
  subtitle?: string;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-border bg-surface overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between gap-3 px-4 py-3 hover:bg-surface-hover/40 transition-colors text-left"
      >
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-surface-hover shrink-0">
            <Icon size={15} className="text-accent" />
          </div>
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-primary">{title}</h2>
            {subtitle && <p className="text-[11px] text-muted truncate">{subtitle}</p>}
          </div>
        </div>
        <ChevronDown
          size={16}
          className={cn('text-muted shrink-0 transition-transform', open && 'rotate-180')}
        />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="border-t border-border p-4 md:p-5">
              {children}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Connection panel ────────────────────────

function ConnectionPanel({ project }: { project: Project }) {
  const [copied, setCopied] = useState<string | null>(null);

  const envBlock = `BAATON_API_KEY=<your-api-key-here>
BAATON_PROJECT_ID=${project.id}
BAATON_BASE_URL=${API_BASE}`;

  const curlSearch = `curl -s "$BAATON_BASE_URL/issues?search=QUERY" \\
  -H "Authorization: Bearer $BAATON_API_KEY"`;

  const curlContext = `curl -s "$BAATON_BASE_URL/projects/${project.id}/context" \\
  -H "Authorization: Bearer $BAATON_API_KEY"`;

  const curlAppend = `curl -s -X POST "$BAATON_BASE_URL/projects/${project.id}/context/append" \\
  -H "Authorization: Bearer $BAATON_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"field_name":"learnings","content":"..."}'`;

  const handleCopy = async (text: string, key: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      /* noop */
    }
  };

  return (
    <div className="space-y-4">
      {/* Project ID */}
      <div className="space-y-1.5">
        <label className="text-[11px] font-medium text-secondary uppercase tracking-wide">Project ID</label>
        <div className="flex items-center gap-2 rounded-lg border border-border bg-bg px-3 py-2">
          <code className="flex-1 text-xs font-mono text-primary truncate">{project.id}</code>
          <button
            onClick={() => handleCopy(project.id, 'pid')}
            className="text-muted hover:text-secondary transition-colors shrink-0"
          >
            {copied === 'pid' ? <CheckCircle2 size={13} className="text-emerald-400" /> : <Copy size={13} />}
          </button>
        </div>
      </div>

      {/* .env block */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <label className="text-[11px] font-medium text-secondary uppercase tracking-wide">
            Environment variables
          </label>
          <button
            onClick={() => handleCopy(envBlock, 'env')}
            className="flex items-center gap-1 text-[11px] text-accent hover:text-accent/80 transition-colors"
          >
            {copied === 'env' ? (
              <><CheckCircle2 size={11} className="text-emerald-400" /> Copied</>
            ) : (
              <><Copy size={11} /> Copy block</>
            )}
          </button>
        </div>
        <pre className="rounded-lg border border-border bg-bg p-3 text-[11px] font-mono text-primary overflow-x-auto whitespace-pre">
{envBlock}
        </pre>
        <p className="text-[10px] text-muted">
          Replace <code className="text-secondary">{'<your-api-key-here>'}</code> with a key from{' '}
          <Link to="/api-keys" className="text-accent hover:underline">API Keys</Link>.
        </p>
      </div>

      {/* curl examples */}
      <div className="space-y-3">
        <label className="text-[11px] font-medium text-secondary uppercase tracking-wide">
          Quick examples
        </label>

        <CurlExample
          label="Search issues"
          code={curlSearch}
          copyKey="curl-search"
          copied={copied}
          onCopy={handleCopy}
        />

        <CurlExample
          label="Pull project context"
          code={curlContext}
          copyKey="curl-context"
          copied={copied}
          onCopy={handleCopy}
        />

        <CurlExample
          label="Append a learning (agent → memory)"
          code={curlAppend}
          copyKey="curl-append"
          copied={copied}
          onCopy={handleCopy}
        />
      </div>

      {/* Manage keys link */}
      <div className="flex items-center justify-between rounded-lg border border-border bg-bg/40 px-3 py-2">
        <div className="flex items-center gap-2 text-xs text-muted">
          <KeyRound size={13} />
          <span>Manage API keys at the org level</span>
        </div>
        <Link
          to="/api-keys"
          className="flex items-center gap-1 text-[11px] text-accent hover:underline"
        >
          API Keys <ExternalLink size={10} />
        </Link>
      </div>
    </div>
  );
}

function CurlExample({
  label,
  code,
  copyKey,
  copied,
  onCopy,
}: {
  label: string;
  code: string;
  copyKey: string;
  copied: string | null;
  onCopy: (text: string, key: string) => void;
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-medium text-secondary">{label}</span>
        <button
          onClick={() => onCopy(code, copyKey)}
          className="text-muted hover:text-secondary transition-colors"
        >
          {copied === copyKey ? <CheckCircle2 size={11} className="text-emerald-400" /> : <Copy size={11} />}
        </button>
      </div>
      <pre className="rounded-md border border-border bg-bg p-2 text-[10px] font-mono text-primary overflow-x-auto whitespace-pre">
{code}
      </pre>
    </div>
  );
}
