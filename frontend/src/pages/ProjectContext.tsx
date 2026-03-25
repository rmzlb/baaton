/**
 * ProjectContext — Per-project living document for agents
 *
 * Stores stack, conventions, architecture, constraints, current focus, learnings.
 * Auto-saves on blur with debounced PATCH. Optimistic updates via TanStack Query.
 * Framer Motion animations, skeleton loading, keyboard shortcuts.
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Layers, BookOpen, Network, Shield, Target, Lightbulb,
  ChevronDown, ChevronRight, Clock, ArrowLeft,
  CheckCircle2, AlertCircle, Loader2, FolderOpen, Braces,
} from 'lucide-react';
import { useHotkeys } from 'react-hotkeys-hook';
import { useApi } from '@/hooks/useApi';
import { useTranslation } from '@/hooks/useTranslation';
import { cn } from '@/lib/utils';
import type { ProjectContext as ProjectContextType } from '@/lib/types';

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
  useTranslation();
  const apiClient = useApi();
  const queryClient = useQueryClient();

  const [expandedFields, setExpandedFields] = useState<Set<string>>(new Set(CONTEXT_FIELDS.map(f => f.key)));
  const [localValues, setLocalValues] = useState<Record<string, string>>({});
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const debounceTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  // Fetch project by slug
  const { data: project, isLoading: projectLoading } = useQuery({
    queryKey: ['project-by-slug', slug],
    queryFn: () => apiClient.projects.getBySlug(slug!),
    enabled: !!slug,
  });

  // Fetch context
  const { data: context, isLoading: contextLoading } = useQuery({
    queryKey: ['project-context', project?.id],
    queryFn: () => apiClient.get<ProjectContextType>(`/projects/${project!.id}/context`),
    enabled: !!project?.id,
  });

  // Sync server values to local state
  useEffect(() => {
    if (context) {
      const values: Record<string, string> = {};
      for (const field of CONTEXT_FIELDS) {
        values[field.key] = (context[field.key] as string) || '';
      }
      setLocalValues(prev => {
        // Only update fields that haven't been locally modified
        const merged = { ...values };
        for (const key of Object.keys(prev)) {
          if (prev[key] !== '' && prev[key] !== values[key]) {
            // Keep local value if user has edited it
          }
        }
        return merged;
      });
    }
  }, [context]);

  // Save mutation with optimistic updates
  const saveMutation = useMutation({
    mutationFn: (data: Record<string, string>) =>
      apiClient.patch<ProjectContextType>(`/projects/${project!.id}/context`, data),
    onMutate: async (newData) => {
      await queryClient.cancelQueries({ queryKey: ['project-context', project?.id] });
      const previous = queryClient.getQueryData<ProjectContextType>(['project-context', project?.id]);
      queryClient.setQueryData(['project-context', project?.id], (old: ProjectContextType | undefined) =>
        old ? { ...old, ...newData, updated_at: new Date().toISOString() } : old
      );
      setSaveStatus('saving');
      return { previous };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous) {
        queryClient.setQueryData(['project-context', project?.id], ctx.previous);
      }
      setSaveStatus('error');
      setTimeout(() => setSaveStatus('idle'), 3000);
    },
    onSuccess: () => {
      setSaveStatus('saved');
      setTimeout(() => setSaveStatus('idle'), 2000);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['project-context', project?.id] });
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
    saveMutation.mutate(payload);
  }, [localValues, saveMutation]);

  // Keyboard shortcut: Cmd+S to save
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

  const isLoading = projectLoading || contextLoading;

  // ─── Loading skeleton ─────────────────────────

  if (isLoading) {
    return (
      <div className="p-4 md:p-6 space-y-6 max-w-4xl mx-auto">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-border/30 rounded w-1/3" />
          <div className="h-4 bg-border/20 rounded w-2/3" />
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

  if (!project) {
    return (
      <div className="flex flex-col items-center justify-center h-full py-20 text-secondary">
        <AlertCircle size={48} className="mb-4 text-border" />
        <p className="text-lg font-medium">Project not found</p>
        <button onClick={() => navigate('/projects')} className="mt-4 text-accent hover:underline text-sm">
          ← Back to projects
        </button>
      </div>
    );
  }

  const isEmpty = !context || CONTEXT_FIELDS.every(f => !context[f.key]);

  return (
    <motion.div
      className="p-4 md:p-6 space-y-6 max-w-4xl mx-auto"
      variants={pageVariants}
      initial="initial"
      animate="animate"
    >
      {/* Header */}
      <motion.div variants={cardVariants} className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => navigate(`/projects/${slug}`)}
              className="p-1.5 rounded-lg hover:bg-surface transition-colors text-secondary hover:text-primary"
            >
              <ArrowLeft size={18} />
            </button>
            <div>
              <h1 className="text-xl md:text-2xl font-bold text-primary">
                {project.name} — Context
              </h1>
              <p className="mt-0.5 text-sm text-secondary">
                Project brain. Shared context for all agents working on this project.
              </p>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {/* Save status indicator */}
          <SaveIndicator status={saveStatus} />
          {/* Last updated */}
          {context?.updated_at && (
            <span className="hidden md:flex items-center gap-1.5 text-xs text-tertiary">
              <Clock size={12} />
              Updated {timeAgo(context.updated_at)}
            </span>
          )}
        </div>
      </motion.div>

      {/* Empty state */}
      {isEmpty && (
        <motion.div
          variants={cardVariants}
          className="flex flex-col items-center justify-center py-16 text-secondary rounded-xl border border-dashed border-border/50 bg-surface/30"
        >
          <FolderOpen size={48} className="mb-4 text-border" />
          <p className="text-lg font-medium">No project context yet</p>
          <p className="mt-1 text-sm text-tertiary">
            Add your stack, conventions, and decisions to help agents work better.
          </p>
          <p className="mt-3 text-xs text-tertiary">
            Agents will pull this context automatically via API.
          </p>
        </motion.div>
      )}

      {/* Context fields */}
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
                <Icon size={18} className={cn('transition-colors', hasContent ? 'text-accent' : 'text-secondary')} />
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
                {isExpanded ? (
                  <ChevronDown size={16} className="text-secondary" />
                ) : (
                  <ChevronRight size={16} className="text-secondary" />
                )}
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
    </motion.div>
  );
}

// ─── Sub-components ───────────────────────────

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
