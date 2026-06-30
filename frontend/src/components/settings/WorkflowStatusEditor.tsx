import { useMemo, useState } from 'react';
import { DragDropContext, Droppable, Draggable, type DropResult } from '@hello-pangea/dnd';
import { GripVertical, Plus, Trash2, Eye, EyeOff, Lock } from 'lucide-react';
import { useApi } from '@/hooks/useApi';
import { useTranslation } from '@/hooks/useTranslation';
import { cn } from '@/lib/utils';
import type { ProjectStatus } from '@/lib/types';

type CustomCategory = 'unstarted' | 'started';

const CUSTOM_CATEGORIES: { value: CustomCategory; label: string }[] = [
  { value: 'unstarted', label: 'Not started' },
  { value: 'started', label: 'In flight' },
];

const SWATCHES = [
  '#6b7280', '#3b82f6', '#f59e0b', '#8b5cf6', '#22c55e',
  '#ef4444', '#ec4899', '#14b8a6', '#eab308', '#6366f1',
];

let seq = 0;
function freshKey(): string {
  seq += 1;
  return `custom_${Date.now().toString(36)}_${seq}`;
}

function normalize(statuses: ProjectStatus[]): ProjectStatus[] {
  return statuses.map((s) => ({
    ...s,
    category: s.category ?? (s.core ? undefined : 'started'),
    core: Boolean(s.core),
  }));
}

export function WorkflowStatusEditor({
  projectId,
  statuses,
  onSaved,
}: {
  projectId: string;
  statuses: ProjectStatus[];
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const apiClient = useApi();

  const [items, setItems] = useState<ProjectStatus[]>(() => normalize(statuses));
  const [reassign, setReassign] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  const dirty = useMemo(
    () => JSON.stringify(normalize(statuses)) !== JSON.stringify(items),
    [statuses, items],
  );

  const update = (idx: number, patch: Partial<ProjectStatus>) => {
    setItems((prev) => prev.map((s, i) => (i === idx ? { ...s, ...patch } : s)));
    setSaved(false);
  };

  const onDragEnd = (result: DropResult) => {
    if (!result.destination) return;
    const from = result.source.index;
    const to = result.destination.index;
    if (from === to) return;
    setItems((prev) => {
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
    setSaved(false);
  };

  const addStatus = () => {
    setItems((prev) => {
      // insert custom statuses before the first terminal/hidden anchor (done)
      const doneIdx = prev.findIndex((s) => s.key === 'done');
      const at = doneIdx === -1 ? prev.length : doneIdx;
      const next = [...prev];
      next.splice(at, 0, {
        key: freshKey(),
        label: 'New status',
        color: SWATCHES[(prev.length * 3) % SWATCHES.length],
        hidden: false,
        category: 'started',
        core: false,
      });
      return next;
    });
    setSaved(false);
  };

  const removeStatus = (idx: number) => {
    setItems((prev) => {
      const target = prev[idx];
      if (target.core) return prev;
      // issues move to the status just above it (else the one below, else first)
      const fallback = prev[idx - 1] ?? prev[idx + 1] ?? prev[0];
      if (fallback && fallback.key !== target.key) {
        setReassign((r) => ({ ...r, [target.key]: fallback.key }));
      }
      return prev.filter((_, i) => i !== idx);
    });
    setSaved(false);
  };

  const handleSave = async () => {
    setError('');
    if (items.some((s) => !s.label.trim())) {
      setError(t('workflow.errorEmptyLabel', { defaultValue: 'Every status needs a label.' }));
      return;
    }
    setSaving(true);
    try {
      const payload = items.map((s) => ({
        key: s.key,
        label: s.label.trim(),
        color: s.color,
        hidden: s.hidden,
        category: s.category,
      }));
      // only keep reassignments for statuses actually removed
      const removed = Object.keys(reassign).filter(
        (k) => !items.some((s) => s.key === k),
      );
      const cleanReassign: Record<string, string> = {};
      removed.forEach((k) => {
        if (items.some((s) => s.key === reassign[k])) cleanReassign[k] = reassign[k];
      });
      const updated = await apiClient.projects.updateStatuses(projectId, {
        statuses: payload as ProjectStatus[],
        reassign: cleanReassign,
      });
      setItems(normalize(updated.statuses as ProjectStatus[]));
      setReassign({});
      setSaved(true);
      onSaved();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to save statuses');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4" data-testid="workflow-editor">
      <div>
        <h3 className="text-sm font-semibold text-primary">
          {t('workflow.title', { defaultValue: 'Workflow statuses' })}
        </h3>
        <p className="mt-1 text-[11px] text-secondary leading-relaxed">
          {t('workflow.desc', {
            defaultValue:
              'Reorder by dragging, rename, recolor, hide, or add your own steps (e.g. To discuss, To rework). The Backlog / Done / Cancelled anchors are locked. Deleting a custom status moves its issues to the status above it.',
          })}
        </p>
      </div>

      <DragDropContext onDragEnd={onDragEnd}>
        <Droppable droppableId="statuses">
          {(provided) => (
            <div ref={provided.innerRef} {...provided.droppableProps} className="space-y-1.5">
              {items.map((s, idx) => (
                <Draggable key={s.key} draggableId={s.key} index={idx}>
                  {(dp, snapshot) => (
                    <div
                      ref={dp.innerRef}
                      {...dp.draggableProps}
                      data-testid={`status-row-${s.key}`}
                      className={cn(
                        'flex items-center gap-2 rounded-lg border border-border bg-surface-hover px-2 py-1.5',
                        snapshot.isDragging && 'border-accent shadow-lg',
                      )}
                    >
                      <span
                        {...dp.dragHandleProps}
                        className="cursor-grab text-muted hover:text-secondary"
                        data-testid={`status-drag-${s.key}`}
                      >
                        <GripVertical size={15} />
                      </span>

                      <input
                        type="color"
                        value={s.color}
                        onChange={(e) => update(idx, { color: e.target.value })}
                        title={t('workflow.color', { defaultValue: 'Color' })}
                        className="h-6 w-6 shrink-0 cursor-pointer rounded border border-border bg-transparent p-0"
                        data-testid={`status-color-${s.key}`}
                      />

                      <input
                        type="text"
                        value={s.label}
                        onChange={(e) => update(idx, { label: e.target.value })}
                        className="flex-1 min-w-0 rounded-md border border-transparent bg-transparent px-2 py-1 text-sm text-primary focus:border-accent focus:bg-surface focus:outline-none"
                        data-testid={`status-label-${s.key}`}
                      />

                      {s.core ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-border/60 px-2 py-0.5 text-[10px] font-medium text-secondary">
                          <Lock size={10} />
                          {s.category}
                        </span>
                      ) : (
                        <select
                          value={s.category ?? 'started'}
                          onChange={(e) => update(idx, { category: e.target.value as CustomCategory })}
                          className="rounded-md border border-border bg-surface px-1.5 py-1 text-[11px] text-secondary focus:border-accent focus:outline-none"
                          data-testid={`status-category-${s.key}`}
                        >
                          {CUSTOM_CATEGORIES.map((c) => (
                            <option key={c.value} value={c.value}>{c.label}</option>
                          ))}
                        </select>
                      )}

                      <button
                        type="button"
                        onClick={() => update(idx, { hidden: !s.hidden })}
                        title={s.hidden ? t('workflow.show', { defaultValue: 'Show on board' }) : t('workflow.hide', { defaultValue: 'Hide from board' })}
                        className="rounded p-1 text-muted hover:text-primary hover:bg-border transition-colors"
                        data-testid={`status-hidden-${s.key}`}
                      >
                        {s.hidden ? <EyeOff size={14} /> : <Eye size={14} />}
                      </button>

                      <button
                        type="button"
                        onClick={() => removeStatus(idx)}
                        disabled={s.core}
                        title={s.core ? t('workflow.locked', { defaultValue: 'Core status (locked)' }) : t('common.delete', { defaultValue: 'Delete' })}
                        className="rounded p-1 text-muted hover:text-red-400 hover:bg-red-500/10 transition-colors disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-muted"
                        data-testid={`status-delete-${s.key}`}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  )}
                </Draggable>
              ))}
              {provided.placeholder}
            </div>
          )}
        </Droppable>
      </DragDropContext>

      <button
        type="button"
        onClick={addStatus}
        className="flex items-center gap-1.5 rounded-lg border border-dashed border-border px-3 py-2 text-xs font-medium text-secondary hover:border-accent hover:text-primary transition-colors"
        data-testid="status-add"
      >
        <Plus size={14} />
        {t('workflow.add', { defaultValue: 'Add status' })}
      </button>

      {error && <p className="text-xs text-red-400" data-testid="workflow-error">{error}</p>}
      {saved && !dirty && (
        <p className="text-xs text-green-400" data-testid="workflow-saved">
          {t('workflow.saved', { defaultValue: 'Workflow saved.' })}
        </p>
      )}

      <div className="flex justify-end pt-1">
        <button
          onClick={handleSave}
          disabled={saving || !dirty}
          className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-black hover:bg-accent-hover transition-colors disabled:opacity-50"
          data-testid="workflow-save"
        >
          {saving ? '...' : t('common.save', { defaultValue: 'Save' })}
        </button>
      </div>
    </div>
  );
}
