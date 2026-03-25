/**
 * ProjectContext — Per-project living document for agents
 *
 * Standalone page with integrated project selector (searchable combobox).
 * Accessible via /projects/:slug/context OR /context (redirects to first project).
 * Auto-saves on blur with debounced PATCH. Optimistic updates via TanStack Query.
 */

import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Layers, BookOpen, Network, Shield, Target, Lightbulb,
  ChevronDown, Clock, Search,
  CheckCircle2, AlertCircle, Loader2, FolderOpen, Braces, X,
} from 'lucide-react';
import { useHotkeys } from 'react-hotkeys-hook';
import { useApi } from '@/hooks/useApi';
import { cn } from '@/lib/utils';
import type { ProjectContext as ProjectContextType, Project } from '@/lib/types';

// ─── Field config ─────────────────────────────

interface ContextField {
  key: keyof ProjectContextType;
  icon: React.ElementType;
  label: string;
  placeholder: string;
  description: string;
}

const CONTEXT_FIELDS: ContextField[] = [
  {
    key: 'stack',
    icon: Layers,
    label: 'Stack',
    placeholder: 'e.g. Rust, Axum, React, Tailwind CSS, PostgreSQL...',
    description: 'Technologies, frameworks, and tools used in this project.',
  },
  {
    key: 'conventions',
    icon: BookOpen,
    label: 'Conventions',
    placeholder: 'Coding patterns, naming conventions, file structure rules...',
    description: 'How code should be written. Naming, patterns, file organization.',
  },
  {
    key: 'architecture',
    icon: Network,
    label: 'Architecture',
    placeholder: 'Architectural decisions and their rationale...',
    description: 'Key architectural decisions and why they were made.',
  },
  {
    key: 'constraints',
    icon: Shield,
    label: 'Constraints',
    placeholder: 'Performance requirements, security rules, infra limitations...',
    description: 'Boundaries agents must respect. Perf, security, infra.',
  },
  {
    key: 'current_focus',
    icon: Target,
    label: 'Current Focus',
    placeholder: 'What the team is working on right now...',
    description: 'Active priorities. Helps agents understand what matters today.',
  },
  {
    key: 'learnings',
    icon: Lightbulb,
    label: 'Learnings',
    placeholder: 'What worked, what failed, gotchas discovered...',
    description: 'Accumulated knowledge. Auto-enriched from agent TLDRs.',
  },
];

// ─── Animation variants ───────────────────────

const pageVariants = {
  initial: { opacity: 0, y: 20 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.3, staggerChildren: 0.05 } },
};

const cardVariants = {
  initial: { opacity: 0, y: 10 },
  animate: { opacity: 1, y: 0 },
};

const collapseVariants = {
  hidden: { height: 0, opacity: 0 },
  visible: { height: 'auto', opacity: 1, transition: { duration: 0.2 } },
  exit: { height: 0, opacity: 0, transition: { duration: 0.15 } },
};

// ─── Component ────────────────────────────────

export default function ProjectContext() {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const apiClient = useApi();
  const queryClient = useQueryClient();

  const [expandedFields, setExpandedFields] = useState<Set<string>>(new Set(CONTEXT_FIELDS.map(f => f.key)));
  const [localValues, setLocalValues] = useState<Record<string, string>>({});
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const debounceTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  // Fetch all projects for the selector
  const { data: projects = [], isLoading: projectsLoading } = useQuery({
    queryKey: ['projects-context-page'],
    queryFn: () => apiClient.projects.list(),
    staleTime: 60_000,
  });

  // Find current project by slug, or redirect to first project
  const currentProject = useMemo(() => {
    if (slug) return projects.find(p => p.slug === slug);
    return null;
  }, [slug, projects]);

  // Redirect to first project if no slug
  useEffect(() => {
    if (!slug && projects.length > 0 && !projectsLoading) {
      navigate(`/projects/${projects[0].slug}/context`, { replace: true });
    }
  }, [slug, projects, projectsLoading, navigate]);

  // Fetch context for current project
  const { data: context, isLoading: contextLoading } = useQuery({
    queryKey: ['project-context', currentProject?.id],
    queryFn: () => apiClient.get<ProjectContextType>(`/projects/${currentProject!.id}/context`),
    enabled: !!currentProject?.id,
  });

  // Sync server values to local state
  useEffect(() => {
    if (context) {
      const values: Record<string, string> = {};
      for (const field of CONTEXT_FIELDS) {
        values[field.key] = (context[field.key] as string) || '';
      }
      setLocalValues(values);
    } else {
      // Clear when switching projects
      setLocalValues({});
    }
  }, [context]);

  // Save mutation with optimistic updates
  const saveMutation = useMutation({
    mutationFn: (data: Record<string, string>) =>
      apiClient.patch<ProjectContextType>(`/projects/${currentProject!.id}/context`, data),
    onMutate: async (newData) => {
      await queryClient.cancelQueries({ queryKey: ['project-context', currentProject?.id] });
      const previous = queryClient.getQueryData<ProjectContextType>(['project-context', currentProject?.id]);
      queryClient.setQueryData(['project-context', currentProject?.id], (old: ProjectContextType | undefined) =>
        old ? { ...old, ...newData, updated_at: new Date().toISOString() } : old
      );
      setSaveStatus('saving');
      return { previous };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous) {
        queryClient.setQueryData(['project-context', currentProject?.id], ctx.previous);
      }
      setSaveStatus('error');
      setTimeout(() => setSaveStatus('idle'), 3000);
    },
    onSuccess: () => {
      setSaveStatus('saved');
      setTimeout(() => setSaveStatus('idle'), 2000);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['project-context', currentProject?.id] });
    },
  });

  // Debounced auto-save
  const debouncedSave = useCallback(
    (field: string, value: string) => {
      if (debounceTimers.current[field]) {
        clearTimeout(debounceTimers.current[field]);
      }
      debounceTimers.current[field] = setTimeout(() => {
        saveMutation.mutate({ [field]: value });
      }, 800);
    },
    [saveMutation]
  );

  // Save all fields at once
  const saveAll = useCallback(() => {
    const payload: Record<string, string> = {};
    for (const field of CONTEXT_FIELDS) {
      if (localValues[field.key]) {
        payload[field.key] = localValues[field.key];
      }
    }
    if (Object.keys(payload).length > 0) {
      saveMutation.mutate(payload);
    }
  }, [localValues, saveMutation]);

  // Keyboard shortcut
  useHotkeys('mod+s', (e) => {
    e.preventDefault();
    saveAll();
  });

  const handleFieldChange = (key: string, value: string) => {
    setLocalValues(prev => ({ ...prev, [key]: value }));
    debouncedSave(key, value);
  };

  const toggleField = (key: string) => {
    setExpandedFields(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const handleProjectSwitch = (project: Project) => {
    navigate(`/projects/${project.slug}/context`);
  };

  // Filled fields count for the selector badge
  const filledCount = CONTEXT_FIELDS.filter(f => localValues[f.key]?.trim()).length;

  // ─── Loading skeleton ─────────────────────────

  if (projectsLoading) {
    return (
      <div className="p-4 md:p-6 space-y-6 max-w-4xl mx-auto">
        <div className="animate-pulse space-y-4">
          <div className="h-10 bg-border/30 rounded-xl w-full" />
          <div className="h-8 bg-border/20 rounded w-1/3" />
          {[...Array(4)].map((_, i) => (
            <div key={i} className="rounded-xl border border-border/30 bg-surface/50 p-6 space-y-3">
              <div className="h-5 bg-border/30 rounded w-1/4" />
              <div className="h-24 bg-border/20 rounded" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (projects.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full py-20 text-secondary">
        <FolderOpen size={48} className="mb-4 text-border" />
        <p className="text-lg font-medium">No projects yet</p>
        <p className="mt-1 text-sm text-tertiary">Create a project first to set up its context.</p>
        <button
          onClick={() => navigate('/projects')}
          className="mt-4 px-4 py-2 rounded-lg bg-accent text-black text-sm font-medium hover:bg-accent-hover transition-colors"
        >
          Go to Projects
        </button>
      </div>
    );
  }

  const isEmpty = !context || CONTEXT_FIELDS.every(f => !context[f.key]);

  return (
    <motion.div
      className="p-4 md:p-6 space-y-5 max-w-4xl mx-auto"
      variants={pageVariants}
      initial="initial"
      animate="animate"
    >
      {/* ─── Header with project selector ─────────── */}
      <motion.div variants={cardVariants} className="space-y-3">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <h1 className="text-xl md:text-2xl font-bold text-primary">Project Context</h1>
            <p className="mt-0.5 text-sm text-secondary">
              The brain of your project. Agents pull this automatically to understand stack, conventions, and constraints.
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <SaveIndicator status={saveStatus} />
            {context?.updated_at && (
              <span className="hidden lg:flex items-center gap-1.5 text-xs text-tertiary">
                <Clock size={12} />
                {timeAgo(context.updated_at)}
              </span>
            )}
          </div>
        </div>

        {/* Project selector */}
        <ProjectSelector
          projects={projects}
          currentProject={currentProject || null}
          onSelect={handleProjectSwitch}
          filledCount={filledCount}
        />
      </motion.div>

      {/* ─── Context fields ────────────────────────── */}
      {contextLoading ? (
        <div className="space-y-3">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="animate-pulse rounded-xl border border-border/30 bg-surface/50 p-5 space-y-3">
              <div className="h-4 bg-border/30 rounded w-1/4" />
              <div className="h-20 bg-border/20 rounded" />
            </div>
          ))}
        </div>
      ) : (
        <>
          {/* Empty state */}
          {isEmpty && (
            <motion.div
              variants={cardVariants}
              className="flex flex-col items-center justify-center py-14 text-secondary rounded-xl border border-dashed border-border/50 bg-surface/20"
            >
              <FolderOpen size={44} className="mb-3 text-border" />
              <p className="text-base font-medium">No context yet for {currentProject?.name}</p>
              <p className="mt-1 text-sm text-tertiary">
                Start filling in fields below. Agents will use this as their project brain.
              </p>
            </motion.div>
          )}

          <motion.div variants={pageVariants} className="space-y-3">
            {CONTEXT_FIELDS.map((field) => {
              const Icon = field.icon;
              const isExpanded = expandedFields.has(field.key);
              const value = localValues[field.key] || '';
              const hasContent = value.trim().length > 0;

              return (
                <motion.div
                  key={field.key}
                  variants={cardVariants}
                  className={cn(
                    'rounded-xl border bg-surface transition-all duration-200',
                    isExpanded ? 'border-border' : 'border-border/50',
                    hasContent && 'border-l-2 border-l-accent/50',
                  )}
                >
                  {/* Header */}
                  <button
                    onClick={() => toggleField(field.key)}
                    className="w-full flex items-center gap-3 p-4 text-left hover:bg-surface-hover/30 transition-colors rounded-t-xl"
                  >
                    <Icon size={18} className={cn('transition-colors shrink-0', hasContent ? 'text-accent' : 'text-secondary')} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-primary text-sm">{field.label}</span>
                        {hasContent && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-accent/10 text-accent font-medium">
                            {value.split('\n').filter(l => l.trim()).length} lines
                          </span>
                        )}
                      </div>
                      {!isExpanded && hasContent && (
                        <p className="text-xs text-tertiary mt-0.5 truncate">{value.split('\n')[0]}</p>
                      )}
                    </div>
                    <ChevronDown
                      size={16}
                      className={cn('text-secondary transition-transform shrink-0', !isExpanded && '-rotate-90')}
                    />
                  </button>

                  {/* Collapsible content */}
                  <AnimatePresence>
                    {isExpanded && (
                      <motion.div
                        variants={collapseVariants}
                        initial="hidden"
                        animate="visible"
                        exit="exit"
                        className="overflow-hidden"
                      >
                        <div className="px-4 pb-4 space-y-2">
                          <p className="text-xs text-tertiary">{field.description}</p>
                          <textarea
                            value={value}
                            onChange={(e) => handleFieldChange(field.key, e.target.value)}
                            placeholder={field.placeholder}
                            rows={Math.max(4, value.split('\n').length + 1)}
                            className={cn(
                              'w-full rounded-lg border border-border/50 bg-bg p-3 text-sm text-primary',
                              'placeholder:text-tertiary resize-y min-h-[100px]',
                              'focus:outline-none focus:ring-1 focus:ring-accent/50 focus:border-accent/50',
                              'font-mono leading-relaxed',
                              'transition-all duration-200',
                            )}
                          />
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.div>
              );
            })}
          </motion.div>

          {/* Custom context (JSON) */}
          {context?.custom_context && Object.keys(context.custom_context).length > 0 && (
            <motion.div variants={cardVariants} className="rounded-xl border border-border bg-surface p-4">
              <div className="flex items-center gap-2 mb-3">
                <Braces size={18} className="text-secondary" />
                <span className="font-medium text-primary text-sm">Custom Context</span>
              </div>
              <pre className="text-xs text-secondary bg-bg rounded-lg p-3 overflow-auto max-h-48 font-mono">
                {JSON.stringify(context.custom_context, null, 2)}
              </pre>
            </motion.div>
          )}

          {/* Keyboard shortcut hint */}
          <motion.div variants={cardVariants} className="text-center text-xs text-tertiary pb-4">
            <kbd className="px-1.5 py-0.5 rounded bg-surface border border-border text-[10px] font-mono">⌘S</kbd> to save all fields
          </motion.div>
        </>
      )}
    </motion.div>
  );
}

// ─── Project Selector (searchable combobox) ───

function ProjectSelector({
  projects,
  currentProject,
  onSelect,
  filledCount,
}: {
  projects: Project[];
  currentProject: Project | null;
  onSelect: (project: Project) => void;
  filledCount: number;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setSearch('');
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // Focus input when opening
  useEffect(() => {
    if (open && inputRef.current) {
      inputRef.current.focus();
    }
  }, [open]);

  const filtered = useMemo(() => {
    if (!search.trim()) return projects;
    const q = search.toLowerCase();
    return projects.filter(p =>
      p.name.toLowerCase().includes(q) ||
      p.slug.toLowerCase().includes(q) ||
      (p.prefix && p.prefix.toLowerCase().includes(q))
    );
  }, [projects, search]);

  return (
    <div ref={containerRef} className="relative">
      {/* Trigger */}
      <button
        onClick={() => setOpen(!open)}
        className={cn(
          'w-full flex items-center gap-3 rounded-xl border bg-surface px-4 py-2.5 transition-all duration-200',
          open ? 'border-accent/50 ring-1 ring-accent/20' : 'border-border hover:border-border/80',
        )}
      >
        {/* Project icon */}
        <div className={cn(
          'flex items-center justify-center w-8 h-8 rounded-lg text-xs font-bold shrink-0',
          currentProject ? 'bg-accent/15 text-accent' : 'bg-border/30 text-muted',
        )}>
          {currentProject?.prefix?.slice(0, 3) || '?'}
        </div>

        <div className="flex-1 min-w-0 text-left">
          <div className="text-sm font-medium text-primary truncate">
            {currentProject?.name || 'Select a project'}
          </div>
          <div className="text-[11px] text-tertiary">
            {currentProject ? (
              <span>{filledCount}/{CONTEXT_FIELDS.length} fields filled</span>
            ) : (
              <span>Choose a project to edit its context</span>
            )}
          </div>
        </div>

        {/* Filled indicator */}
        {currentProject && (
          <div className="hidden sm:flex items-center gap-1">
            {CONTEXT_FIELDS.map((_, i) => (
              <div
                key={i}
                className={cn(
                  'w-1.5 h-1.5 rounded-full transition-colors',
                  i < filledCount ? 'bg-accent' : 'bg-border/50',
                )}
              />
            ))}
          </div>
        )}

        <ChevronDown
          size={16}
          className={cn('text-muted shrink-0 transition-transform', open && 'rotate-180')}
        />
      </button>

      {/* Dropdown */}
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -4, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.98 }}
            transition={{ duration: 0.15 }}
            className="absolute left-0 right-0 top-full mt-1.5 z-50 rounded-xl border border-border bg-bg shadow-2xl shadow-black/20 overflow-hidden"
          >
            {/* Search input */}
            <div className="flex items-center gap-2 px-3 py-2.5 border-b border-border/50">
              <Search size={14} className="text-muted shrink-0" />
              <input
                ref={inputRef}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search projects..."
                className="flex-1 bg-transparent text-sm text-primary placeholder:text-tertiary outline-none"
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    setOpen(false);
                    setSearch('');
                  }
                  if (e.key === 'Enter' && filtered.length === 1) {
                    onSelect(filtered[0]);
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

            {/* Project list */}
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
                        'flex items-center justify-center w-7 h-7 rounded-lg text-[10px] font-bold shrink-0',
                        isActive ? 'bg-accent/20 text-accent' : 'bg-surface text-muted',
                      )}>
                        {project.prefix?.slice(0, 3)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium truncate">{project.name}</div>
                        {project.description && (
                          <div className="text-[11px] text-tertiary truncate">{project.description}</div>
                        )}
                      </div>
                      {isActive && (
                        <CheckCircle2 size={14} className="text-accent shrink-0" />
                      )}
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

// ─── Save indicator ───────────────────────────

function SaveIndicator({ status }: { status: 'idle' | 'saving' | 'saved' | 'error' }) {
  if (status === 'idle') return null;

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0 }}
      className={cn(
        'flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full font-medium',
        status === 'saving' && 'text-amber-400 bg-amber-400/10',
        status === 'saved' && 'text-green-400 bg-green-400/10',
        status === 'error' && 'text-red-400 bg-red-400/10',
      )}
    >
      {status === 'saving' && <><Loader2 size={12} className="animate-spin" /> Saving...</>}
      {status === 'saved' && <><CheckCircle2 size={12} /> Saved</>}
      {status === 'error' && <><AlertCircle size={12} /> Error</>}
    </motion.div>
  );
}

// ─── Utils ────────────────────────────────────

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
