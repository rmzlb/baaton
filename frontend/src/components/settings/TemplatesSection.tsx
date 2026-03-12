import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useApi } from '@/hooks/useApi';
import { useTranslation } from '@/hooks/useTranslation';
import { cn } from '@/lib/utils';
import {
  FileText, Plus, Trash2, Loader2, ChevronDown,
} from 'lucide-react';
import type { IssueTemplate, IssueType, IssuePriority } from '@/lib/types';

const TYPES: IssueType[] = ['bug', 'feature', 'improvement', 'question'];
const PRIORITIES: Array<IssuePriority | ''> = ['', 'urgent', 'high', 'medium', 'low'];

interface TemplateFormState {
  name: string;
  description_template: string;
  type: IssueType | '';
  priority: IssuePriority | '';
  tags: string;
}

const EMPTY_FORM: TemplateFormState = {
  name: '',
  description_template: '',
  type: '',
  priority: '',
  tags: '',
};

function TemplateForm({
  initial,
  onSave,
  onCancel,
  saving,
}: {
  initial?: TemplateFormState;
  onSave: (form: TemplateFormState) => void;
  onCancel: () => void;
  saving: boolean;
}) {
  const { t } = useTranslation();
  const [form, setForm] = useState<TemplateFormState>(initial ?? EMPTY_FORM);
  const [error, setError] = useState('');

  const set = (key: keyof TemplateFormState, value: string) =>
    setForm((f) => ({ ...f, [key]: value }));

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) { setError(t('templates.nameRequired')); return; }
    onSave(form);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div>
        <label className="block text-xs font-medium text-secondary mb-1">{t('templates.name')}</label>
        <input
          autoFocus
          value={form.name}
          onChange={(e) => { set('name', e.target.value); setError(''); }}
          placeholder={t('templates.namePlaceholder')}
          className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-primary placeholder-muted focus:outline-none focus:ring-1 focus:ring-accent"
        />
        {error && <p className="mt-1 text-xs text-red-400">{error}</p>}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-secondary mb-1">{t('templates.defaultType')}</label>
          <select
            value={form.type}
            onChange={(e) => set('type', e.target.value as IssueType | '')}
            className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-primary focus:outline-none focus:ring-1 focus:ring-accent"
          >
            <option value="">{t('common.none')}</option>
            {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-secondary mb-1">{t('templates.defaultPriority')}</label>
          <select
            value={form.priority}
            onChange={(e) => set('priority', e.target.value as IssuePriority | '')}
            className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-primary focus:outline-none focus:ring-1 focus:ring-accent"
          >
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>{p ? p : t('common.none')}</option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <label className="block text-xs font-medium text-secondary mb-1">{t('templates.defaultTags')}</label>
        <input
          value={form.tags}
          onChange={(e) => set('tags', e.target.value)}
          placeholder={t('templates.tagsPlaceholder')}
          className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-primary placeholder-muted focus:outline-none focus:ring-1 focus:ring-accent"
        />
      </div>

      <div>
        <label className="block text-xs font-medium text-secondary mb-1">{t('templates.descriptionTemplate')}</label>
        <textarea
          value={form.description_template}
          onChange={(e) => set('description_template', e.target.value)}
          placeholder={t('templates.descriptionPlaceholder')}
          rows={5}
          className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-primary placeholder-muted focus:outline-none focus:ring-1 focus:ring-accent resize-none font-mono"
        />
      </div>

      <div className="flex items-center justify-end gap-2 pt-1">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg px-4 py-2 text-sm text-secondary hover:text-primary transition-colors"
        >
          {t('templates.cancel')}
        </button>
        <button
          type="submit"
          disabled={saving}
          className="flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent/90 transition-colors disabled:opacity-50"
        >
          {saving && <Loader2 size={14} className="animate-spin" />}
          {t('templates.save')}
        </button>
      </div>
    </form>
  );
}

function TemplateRow({ template, onDelete }: { template: IssueTemplate; onDelete: () => void }) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="rounded-xl border border-border bg-surface overflow-hidden">
      <div
        className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-surface-hover transition-colors"
        onClick={() => setExpanded((x) => !x)}
      >
        <FileText size={15} className="text-accent shrink-0" />
        <div className="flex-1 min-w-0">
          <span className="text-sm font-medium text-primary">{template.name}</span>
          <div className="flex items-center gap-2 mt-0.5">
            {template.type && (
              <span className="text-[10px] font-mono text-muted">{template.type}</span>
            )}
            {template.priority && (
              <span className={cn(
                'text-[10px] font-medium',
                template.priority === 'urgent' ? 'text-red-400' :
                template.priority === 'high' ? 'text-orange-400' :
                template.priority === 'medium' ? 'text-yellow-400' : 'text-muted',
              )}>{template.priority}</span>
            )}
            {template.tags.length > 0 && (
              <span className="text-[10px] text-muted">{template.tags.join(', ')}</span>
            )}
          </div>
        </div>
        <ChevronDown size={14} className={cn('text-muted transition-transform shrink-0', expanded && 'rotate-180')} />
        <button
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
          className="shrink-0 rounded-md p-1.5 text-muted hover:text-red-400 hover:bg-red-500/10 transition-colors"
          title={t('templates.delete')}
        >
          <Trash2 size={13} />
        </button>
      </div>

      {expanded && template.description_template && (
        <div className="border-t border-border px-4 py-3 bg-bg/50">
          <pre className="text-xs text-secondary whitespace-pre-wrap font-mono leading-relaxed">
            {template.description_template}
          </pre>
        </div>
      )}
    </div>
  );
}

export function TemplatesSection({ projectId }: { projectId: string }) {
  const { t } = useTranslation();
  const apiClient = useApi();
  const queryClient = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [saving, setSaving] = useState(false);

  const { data: templates = [], isLoading } = useQuery({
    queryKey: ['project-templates', projectId],
    queryFn: () => apiClient.templates.listByProject(projectId),
    staleTime: 60_000,
    enabled: !!projectId,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiClient.templates.delete(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['project-templates', projectId] }),
  });

  const handleSave = async (form: TemplateFormState) => {
    setSaving(true);
    try {
      const tags = form.tags
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      await apiClient.templates.create(projectId, {
        name: form.name.trim(),
        description_template: form.description_template || undefined,
        type: (form.type as any) || undefined,
        priority: (form.priority as any) || undefined,
        tags,
      });
      queryClient.invalidateQueries({ queryKey: ['project-templates', projectId] });
      setShowCreate(false);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = (template: IssueTemplate) => {
    if (confirm(t('templates.deleteConfirm', { name: template.name }))) {
      deleteMutation.mutate(template.id);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-primary flex items-center gap-2">
            <FileText size={15} className="text-accent" />
            {t('templates.title')}
          </h3>
          <p className="text-xs text-secondary mt-0.5">{t('templates.emptyDesc')}</p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs text-secondary hover:text-primary hover:border-accent/50 transition-colors"
        >
          <Plus size={13} />
          {t('templates.create')}
        </button>
      </div>

      {showCreate && (
        <div className="rounded-xl border border-accent/30 bg-surface p-4">
          <TemplateForm
            onSave={handleSave}
            onCancel={() => setShowCreate(false)}
            saving={saving}
          />
        </div>
      )}

      {isLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted py-4">
          <Loader2 size={16} className="animate-spin" />
          {t('common.loading')}
        </div>
      ) : templates.length === 0 && !showCreate ? (
        <div className="rounded-xl border border-dashed border-border py-8 text-center">
          <FileText size={32} className="text-muted mx-auto mb-2" />
          <p className="text-sm text-muted">{t('templates.empty')}</p>
        </div>
      ) : (
        <div className="space-y-2">
          {templates.map((tmpl) => (
            <TemplateRow
              key={tmpl.id}
              template={tmpl}
              onDelete={() => handleDelete(tmpl)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
