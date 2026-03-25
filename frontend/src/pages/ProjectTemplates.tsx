/**
 * ProjectTemplates — Browse and manage project-level templates
 *
 * System templates are read-only. Org templates can be created/deleted.
 * Template picker used when creating new projects.
 */

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import {
  LayoutTemplate, Plus, Trash2, ChevronDown, ChevronRight,
  Lock, Layers, Network, Shield, Code2,
  X, CheckCircle2,
} from 'lucide-react';
import { useApi } from '@/hooks/useApi';
import { useTranslation } from '@/hooks/useTranslation';
import { cn } from '@/lib/utils';
import type { ProjectTemplate } from '@/lib/types';

// ─── Animation variants ───────────────────────

const pageVariants = {
  initial: { opacity: 0, y: 20 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.3, staggerChildren: 0.06 } },
};

const cardVariants = {
  initial: { opacity: 0, y: 10 },
  animate: { opacity: 1, y: 0 },
};

// ─── Template icon picker ─────────────────────

function getTemplateIcon(name: string) {
  const lower = name.toLowerCase();
  if (lower.includes('rust')) return Code2;
  if (lower.includes('next')) return Layers;
  if (lower.includes('react')) return Network;
  if (lower.includes('api')) return Shield;
  return LayoutTemplate;
}

// ─── Component ────────────────────────────────

export default function ProjectTemplates() {
  useTranslation();
  const apiClient = useApi();
  const queryClient = useQueryClient();

  const [showCreate, setShowCreate] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Fetch templates
  const { data: templates = [], isLoading } = useQuery({
    queryKey: ['project-templates'],
    queryFn: () => apiClient.get<ProjectTemplate[]>('/project-templates'),
  });

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiClient.del(`/project-templates/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['project-templates'] }),
  });

  // Create mutation
  const createMutation = useMutation({
    mutationFn: (body: { name: string; description?: string; default_context?: Record<string, string>; default_tags?: string[] }) =>
      apiClient.post('/project-templates', body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['project-templates'] });
      setShowCreate(false);
    },
  });

  const systemTemplates = templates.filter(t => t.is_system);
  const orgTemplates = templates.filter(t => !t.is_system);

  // ─── Loading skeleton ─────────────────────────

  if (isLoading) {
    return (
      <div className="p-4 md:p-6 space-y-6 max-w-4xl mx-auto">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-border/30 rounded w-1/3" />
          <div className="h-4 bg-border/20 rounded w-2/3" />
          {[...Array(3)].map((_, i) => (
            <div key={i} className="rounded-xl border border-border/30 bg-surface/50 p-6 space-y-3">
              <div className="h-5 bg-border/30 rounded w-1/4" />
              <div className="h-3 bg-border/20 rounded w-3/4" />
            </div>
          ))}
        </div>
      </div>
    );
  }

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
          <h1 className="text-xl md:text-2xl font-bold text-primary">Project Templates</h1>
          <p className="mt-1 text-sm text-secondary">
            Pre-configured context for new projects. Agents start with the right conventions.
          </p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-black hover:bg-accent-hover transition-colors"
        >
          <Plus size={16} />
          New Template
        </button>
      </motion.div>

      {/* System Templates */}
      {systemTemplates.length > 0 && (
        <motion.div variants={cardVariants} className="space-y-3">
          <h2 className="text-xs font-semibold text-secondary uppercase tracking-wider flex items-center gap-2">
            <Lock size={12} />
            Built-in Templates
          </h2>
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            {systemTemplates.map(tmpl => (
              <TemplateCard
                key={tmpl.id}
                template={tmpl}
                isExpanded={expandedId === tmpl.id}
                onToggle={() => setExpandedId(expandedId === tmpl.id ? null : tmpl.id)}
              />
            ))}
          </div>
        </motion.div>
      )}

      {/* Org Templates */}
      <motion.div variants={cardVariants} className="space-y-3">
        <h2 className="text-xs font-semibold text-secondary uppercase tracking-wider">
          Your Templates
        </h2>
        {orgTemplates.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-secondary rounded-xl border border-dashed border-border/50 bg-surface/30">
            <LayoutTemplate size={40} className="mb-3 text-border" />
            <p className="font-medium">No custom templates yet</p>
            <p className="mt-1 text-xs text-tertiary">Create a template to standardize project setup.</p>
          </div>
        ) : (
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            {orgTemplates.map(tmpl => (
              <TemplateCard
                key={tmpl.id}
                template={tmpl}
                isExpanded={expandedId === tmpl.id}
                onToggle={() => setExpandedId(expandedId === tmpl.id ? null : tmpl.id)}
                onDelete={() => deleteMutation.mutate(tmpl.id)}
                canDelete
              />
            ))}
          </div>
        )}
      </motion.div>

      {/* Create Modal */}
      <AnimatePresence>
        {showCreate && (
          <CreateTemplateModal
            onClose={() => setShowCreate(false)}
            onSubmit={(data) => createMutation.mutate(data)}
            isLoading={createMutation.isPending}
          />
        )}
      </AnimatePresence>
    </motion.div>
  );
}

// ─── Template Card ────────────────────────────

function TemplateCard({
  template,
  isExpanded,
  onToggle,
  onDelete,
  canDelete,
}: {
  template: ProjectTemplate;
  isExpanded: boolean;
  onToggle: () => void;
  onDelete?: () => void;
  canDelete?: boolean;
}) {
  const Icon = getTemplateIcon(template.name);
  const ctx = template.default_context as Record<string, string>;

  return (
    <motion.div
      layout
      className={cn(
        'rounded-xl border bg-surface transition-all duration-200 overflow-hidden',
        isExpanded ? 'border-accent/30 shadow-lg shadow-accent/5' : 'border-border/50 hover:border-border',
      )}
    >
      <button
        onClick={onToggle}
        className="w-full flex items-start gap-3 p-4 text-left hover:bg-surface-hover/30 transition-colors"
      >
        <div className={cn(
          'p-2 rounded-lg transition-colors',
          template.is_system ? 'bg-accent/10 text-accent' : 'bg-surface-hover text-secondary',
        )}>
          <Icon size={18} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-medium text-primary text-sm">{template.name}</span>
            {template.is_system && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-accent/10 text-accent font-medium">System</span>
            )}
          </div>
          {template.description && (
            <p className="text-xs text-secondary mt-0.5 line-clamp-2">{template.description}</p>
          )}
          {template.default_tags.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-2">
              {template.default_tags.map(tag => (
                <span key={tag} className="text-[10px] px-1.5 py-0.5 rounded bg-border/30 text-tertiary">
                  {tag}
                </span>
              ))}
            </div>
          )}
        </div>
        {isExpanded ? <ChevronDown size={14} className="text-secondary mt-1" /> : <ChevronRight size={14} className="text-secondary mt-1" />}
      </button>

      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1, transition: { duration: 0.2 } }}
            exit={{ height: 0, opacity: 0, transition: { duration: 0.15 } }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-4 space-y-2 border-t border-border/30 pt-3">
              {Object.entries(ctx).map(([key, value]) => (
                <div key={key}>
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-tertiary">{key}</span>
                  <p className="text-xs text-secondary mt-0.5 whitespace-pre-wrap">{value}</p>
                </div>
              ))}
              {canDelete && onDelete && (
                <button
                  onClick={(e) => { e.stopPropagation(); onDelete(); }}
                  className="mt-2 flex items-center gap-1.5 text-xs text-red-400 hover:text-red-300 transition-colors"
                >
                  <Trash2 size={12} />
                  Delete template
                </button>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

// ─── Create Modal ─────────────────────────────

function CreateTemplateModal({
  onClose,
  onSubmit,
  isLoading,
}: {
  onClose: () => void;
  onSubmit: (data: { name: string; description?: string; default_context?: Record<string, string>; default_tags?: string[] }) => void;
  isLoading: boolean;
}) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [stack, setStack] = useState('');
  const [conventions, setConventions] = useState('');
  const [tags, setTags] = useState('');

  const handleSubmit = () => {
    if (!name.trim()) return;
    const ctx: Record<string, string> = {};
    if (stack.trim()) ctx.stack = stack;
    if (conventions.trim()) ctx.conventions = conventions;
    onSubmit({
      name,
      description: description || undefined,
      default_context: Object.keys(ctx).length > 0 ? ctx : undefined,
      default_tags: tags ? tags.split(',').map(t => t.trim()).filter(Boolean) : undefined,
    });
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        className="w-full max-w-lg rounded-2xl border border-border bg-surface p-6 space-y-4 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-primary">New Project Template</h2>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-surface-hover text-secondary">
            <X size={18} />
          </button>
        </div>

        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-secondary mb-1">Name *</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Rust Microservice"
              className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-primary placeholder:text-tertiary focus:outline-none focus:ring-1 focus:ring-accent/50"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-secondary mb-1">Description</label>
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Short description of this template"
              className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-primary placeholder:text-tertiary focus:outline-none focus:ring-1 focus:ring-accent/50"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-secondary mb-1">Default Stack</label>
            <textarea
              value={stack}
              onChange={(e) => setStack(e.target.value)}
              placeholder="Technologies used (e.g. Rust, Axum, PostgreSQL)"
              rows={2}
              className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-primary placeholder:text-tertiary focus:outline-none focus:ring-1 focus:ring-accent/50 resize-none"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-secondary mb-1">Default Conventions</label>
            <textarea
              value={conventions}
              onChange={(e) => setConventions(e.target.value)}
              placeholder="Coding patterns, rules, file structure..."
              rows={2}
              className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-primary placeholder:text-tertiary focus:outline-none focus:ring-1 focus:ring-accent/50 resize-none"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-secondary mb-1">Default Tags</label>
            <input
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              placeholder="Comma-separated (e.g. backend, rust, api)"
              className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-primary placeholder:text-tertiary focus:outline-none focus:ring-1 focus:ring-accent/50"
            />
          </div>
        </div>

        <div className="flex justify-end gap-3 pt-2">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-sm text-secondary hover:text-primary hover:bg-surface-hover transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={!name.trim() || isLoading}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-accent text-black text-sm font-medium hover:bg-accent-hover disabled:opacity-50 transition-colors"
          >
            {isLoading ? <CheckCircle2 size={14} className="animate-spin" /> : <Plus size={14} />}
            Create
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}
