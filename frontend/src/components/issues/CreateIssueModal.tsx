import { useState, useEffect, useCallback } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  X, Bug, Sparkles, Zap, HelpCircle,
  AlertTriangle, ArrowUp, Minus, ArrowDown,
  ChevronLeft, ChevronRight,
} from 'lucide-react';
import { useTranslation } from '@/hooks/useTranslation';
import { useApi } from '@/hooks/useApi';
import { NotionEditor } from '@/components/shared/NotionEditor';
import { cn } from '@/lib/utils';
import type { IssueType, IssuePriority, Project, ProjectTag } from '@/lib/types';

/* ── Templates per type ─────────────────────── */

const TEMPLATES: Record<IssueType, string> = {
  bug: `## Steps to Reproduce
1. 
2. 
3. 

## Expected Behavior


## Actual Behavior


## Environment
- Browser: 
- OS: 
`,
  feature: `## User Story
As a [user], I want to [action] so that [benefit].

## Acceptance Criteria
- [ ] 
- [ ] 

## Design Notes

`,
  improvement: `## Current Behavior


## Proposed Improvement


## Impact

`,
  question: `## Question


## Context

`,
};

/* ── Type card config ───────────────────────── */

const TYPE_CARDS: {
  type: IssueType;
  icon: typeof Bug;
  emoji: string;
  labelKey: string;
  descKey: string;
  color: string;
}[] = [
  { type: 'bug', icon: Bug, emoji: '🐛', labelKey: 'createIssue.typeBug', descKey: 'createIssue.typeBugDesc', color: 'border-red-400/30 hover:border-red-400/60 hover:bg-red-500/5' },
  { type: 'feature', icon: Sparkles, emoji: '✨', labelKey: 'createIssue.typeFeature', descKey: 'createIssue.typeFeatureDesc', color: 'border-emerald-400/30 hover:border-emerald-400/60 hover:bg-emerald-500/5' },
  { type: 'improvement', icon: Zap, emoji: '⚡', labelKey: 'createIssue.typeImprovement', descKey: 'createIssue.typeImprovementDesc', color: 'border-blue-400/30 hover:border-blue-400/60 hover:bg-blue-500/5' },
  { type: 'question', icon: HelpCircle, emoji: '❓', labelKey: 'createIssue.typeQuestion', descKey: 'createIssue.typeQuestionDesc', color: 'border-purple-400/30 hover:border-purple-400/60 hover:bg-purple-500/5' },
];

/* ── Priority config ────────────────────────── */

const PRIORITY_BUTTONS: { key: IssuePriority | ''; labelKey: string; color: string; icon?: typeof ArrowUp }[] = [
  { key: '', labelKey: 'createIssue.priorityNone', color: 'border-border text-secondary hover:bg-surface-hover' },
  { key: 'urgent', labelKey: 'createIssue.priorityUrgent', color: 'border-red-400/40 text-red-400 hover:bg-red-500/10', icon: AlertTriangle },
  { key: 'high', labelKey: 'createIssue.priorityHigh', color: 'border-orange-400/40 text-orange-400 hover:bg-orange-500/10', icon: ArrowUp },
  { key: 'medium', labelKey: 'createIssue.priorityMedium', color: 'border-yellow-400/40 text-yellow-400 hover:bg-yellow-500/10', icon: Minus },
  { key: 'low', labelKey: 'createIssue.priorityLow', color: 'border-gray-400/40 text-gray-400 hover:bg-gray-500/10', icon: ArrowDown },
];

/* ── Category chips ─────────────────────────── */

const CATEGORY_CHIPS = [
  { key: 'FRONT', label: 'FRONT', color: '#3b82f6' },
  { key: 'BACK', label: 'BACK', color: '#22c55e' },
  { key: 'API', label: 'API', color: '#8b5cf6' },
  { key: 'DB', label: 'DB', color: '#f97316' },
];

/* ── Steps ──────────────────────────────────── */

const STEPS = ['type', 'details', 'description'] as const;
type Step = (typeof STEPS)[number];

/* ── Main Component ─────────────────────────── */

interface CreateIssueModalProps {
  project: Project;
  projectTags: ProjectTag[];
  onClose: () => void;
}

export function CreateIssueModal({ project, projectTags, onClose }: CreateIssueModalProps) {
  const { t } = useTranslation();
  const apiClient = useApi();
  const queryClient = useQueryClient();

  // Form state
  const [step, setStep] = useState<Step>('type');
  const [type, setType] = useState<IssueType | null>(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<IssuePriority | ''>('');
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [showTagDropdown, setShowTagDropdown] = useState(false);
  const [useTemplate, setUseTemplate] = useState(true);
  const [error, setError] = useState('');

  // When type is selected, pre-fill template in description
  useEffect(() => {
    if (type && useTemplate && !description) {
      setDescription(TEMPLATES[type]);
    }
  }, [type, useTemplate]); // eslint-disable-line react-hooks/exhaustive-deps

  const stepIndex = STEPS.indexOf(step);

  const goNext = useCallback(() => {
    const idx = STEPS.indexOf(step);
    if (idx < STEPS.length - 1) {
      setStep(STEPS[idx + 1]);
    }
  }, [step]);

  const goBack = useCallback(() => {
    const idx = STEPS.indexOf(step);
    if (idx > 0) {
      setStep(STEPS[idx - 1]);
    }
  }, [step]);

  // Handle type selection — auto-advance
  const handleTypeSelect = (t: IssueType) => {
    setType(t);
    // Pre-fill template
    if (useTemplate) {
      setDescription(TEMPLATES[t]);
    }
    // Auto-advance to details
    setTimeout(() => setStep('details'), 150);
  };

  // Toggle template
  const handleToggleTemplate = () => {
    if (useTemplate) {
      setDescription('');
      setUseTemplate(false);
    } else {
      if (type) setDescription(TEMPLATES[type]);
      setUseTemplate(true);
    }
  };

  const toggleTag = (tagName: string) => {
    setSelectedTags((prev) =>
      prev.includes(tagName) ? prev.filter((t) => t !== tagName) : [...prev, tagName],
    );
  };

  const toggleCategory = (cat: string) => {
    setSelectedCategories((prev) =>
      prev.includes(cat) ? prev.filter((c) => c !== cat) : [...prev, cat],
    );
  };

  // Create mutation
  const createMutation = useMutation({
    mutationFn: () =>
      apiClient.issues.create({
        project_id: project.id,
        title,
        description: description || undefined,
        type: type || 'feature',
        priority: priority || undefined,
        tags: selectedTags.length > 0 ? selectedTags : undefined,
        category: selectedCategories.length > 0 ? selectedCategories : undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['issues', project.id] });
      queryClient.invalidateQueries({ queryKey: ['all-issues'] });
      onClose();
    },
    onError: (err: Error) => {
      setError(err.message);
    },
  });

  const handleSubmit = () => {
    if (!title.trim()) {
      setError(t('createIssue.titleRequired'));
      return;
    }
    setError('');
    createMutation.mutate();
  };

  // Keyboard: Escape to close
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 dark:bg-black/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-lg rounded-xl border border-border bg-surface shadow-2xl flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
          <div>
            <h2 className="text-lg font-semibold text-primary">
              {t('createIssue.title')}
              <span className="ml-2 text-xs font-mono text-secondary">{project.prefix}</span>
            </h2>
            {/* Step indicator */}
            <div className="flex items-center gap-2 mt-2">
              {STEPS.map((s, i) => (
                <div key={s} className="flex items-center gap-2">
                  <div
                    className={cn(
                      'h-1.5 rounded-full transition-all duration-300',
                      i === stepIndex ? 'w-6 bg-accent' : i < stepIndex ? 'w-3 bg-accent/40' : 'w-3 bg-border',
                    )}
                  />
                </div>
              ))}
              <span className="text-[10px] text-muted ml-1">
                {stepIndex + 1}/{STEPS.length}
              </span>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-md p-1 text-secondary hover:bg-surface-hover hover:text-primary transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Error */}
        {error && (
          <div className="mx-6 mt-4 rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-red-400">
            {error}
          </div>
        )}

        {/* Step content */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {step === 'type' && (
            <StepType
              selected={type}
              onSelect={handleTypeSelect}
              t={t}
            />
          )}
          {step === 'details' && (
            <StepDetails
              title={title}
              setTitle={setTitle}
              priority={priority}
              setPriority={setPriority}
              selectedTags={selectedTags}
              toggleTag={toggleTag}
              projectTags={projectTags}
              showTagDropdown={showTagDropdown}
              setShowTagDropdown={setShowTagDropdown}
              selectedCategories={selectedCategories}
              toggleCategory={toggleCategory}
              t={t}
            />
          )}
          {step === 'description' && (
            <StepDescription
              description={description}
              setDescription={setDescription}
              useTemplate={useTemplate}
              onToggleTemplate={handleToggleTemplate}
              t={t}
            />
          )}
        </div>

        {/* Footer: Navigation */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-border shrink-0">
          <div>
            {stepIndex > 0 ? (
              <button
                type="button"
                onClick={goBack}
                className="flex items-center gap-1 rounded-lg px-3 py-2 text-sm text-secondary hover:text-primary transition-colors"
              >
                <ChevronLeft size={14} />
                {t('createIssue.back')}
              </button>
            ) : (
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg px-3 py-2 text-sm text-secondary hover:text-primary transition-colors"
              >
                {t('createIssue.cancel')}
              </button>
            )}
          </div>
          <div className="flex items-center gap-2">
            {step === 'description' && (
              <button
                type="button"
                onClick={handleSubmit}
                disabled={!title.trim() || createMutation.isPending}
                className="flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-black hover:bg-accent-hover disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                {createMutation.isPending ? t('createIssue.creating') : t('createIssue.create')}
              </button>
            )}
            {step === 'details' && (
              <button
                type="button"
                onClick={goNext}
                disabled={!title.trim()}
                className="flex items-center gap-1 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-black hover:bg-accent-hover disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                {t('createIssue.next')}
                <ChevronRight size={14} />
              </button>
            )}
            {step === 'description' && (
              <button
                type="button"
                onClick={handleSubmit}
                disabled={!title.trim() || createMutation.isPending}
                className="hidden"
              >
                {/* duplicate for clarity, primary button is above */}
              </button>
            )}
            {step === 'details' && (
              <button
                type="button"
                onClick={() => {
                  setStep('description');
                }}
                className="hidden"
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Step 1: Type Selection ─────────────────── */

function StepType({
  selected,
  onSelect,
  t,
}: {
  selected: IssueType | null;
  onSelect: (type: IssueType) => void;
  t: (key: string) => string;
}) {
  return (
    <div>
      <h3 className="text-sm font-medium text-primary mb-4">{t('createIssue.typeTitle')}</h3>
      <div className="space-y-2">
        {TYPE_CARDS.map(({ type, emoji, labelKey, descKey, color }) => (
          <button
            key={type}
            type="button"
            onClick={() => onSelect(type)}
            className={cn(
              'w-full rounded-lg border p-4 text-left transition-all',
              color,
              selected === type ? 'ring-2 ring-accent/50' : '',
            )}
          >
            <div className="flex items-center gap-3">
              <span className="text-2xl">{emoji}</span>
              <div>
                <p className="text-sm font-medium text-primary">{t(labelKey)}</p>
                <p className="text-xs text-secondary mt-0.5">{t(descKey)}</p>
              </div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

/* ── Step 2: Title + Priority + Tags + Category ─ */

function StepDetails({
  title,
  setTitle,
  priority,
  setPriority,
  selectedTags,
  toggleTag,
  projectTags,
  showTagDropdown,
  setShowTagDropdown,
  selectedCategories,
  toggleCategory,
  t,
}: {
  title: string;
  setTitle: (v: string) => void;
  priority: IssuePriority | '';
  setPriority: (v: IssuePriority | '') => void;
  selectedTags: string[];
  toggleTag: (tag: string) => void;
  projectTags: ProjectTag[];
  showTagDropdown: boolean;
  setShowTagDropdown: (v: boolean) => void;
  selectedCategories: string[];
  toggleCategory: (cat: string) => void;
  t: (key: string) => string;
}) {
  return (
    <div className="space-y-5">
      {/* Title */}
      <div>
        <label className="block text-xs text-secondary mb-1.5">{t('createIssue.titleLabel')}</label>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={t('createIssue.titlePlaceholder')}
          className="w-full rounded-lg border border-border bg-bg px-3 py-2.5 text-sm text-primary placeholder-secondary focus:border-accent focus:outline-none transition-colors"
          autoFocus
        />
      </div>

      {/* Priority */}
      <div>
        <label className="block text-xs text-secondary mb-1.5">{t('createIssue.priorityLabel')}</label>
        <div className="flex flex-wrap gap-1.5">
          {PRIORITY_BUTTONS.map(({ key, labelKey, color, icon: Icon }) => (
            <button
              key={key}
              type="button"
              onClick={() => setPriority(key as IssuePriority | '')}
              className={cn(
                'flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-all',
                color,
                priority === key ? 'ring-2 ring-accent/40 bg-surface-hover' : '',
              )}
            >
              {Icon && <Icon size={12} />}
              {t(labelKey)}
            </button>
          ))}
        </div>
      </div>

      {/* Category */}
      <div>
        <label className="block text-xs text-secondary mb-1.5">{t('createIssue.categoryLabel')}</label>
        <div className="flex flex-wrap gap-1.5">
          {CATEGORY_CHIPS.map(({ key, label, color }) => (
            <button
              key={key}
              type="button"
              onClick={() => toggleCategory(key)}
              className={cn(
                'rounded-lg border px-3 py-1.5 text-xs font-bold uppercase tracking-wider transition-all',
                selectedCategories.includes(key)
                  ? 'ring-2 ring-accent/40'
                  : 'border-border text-secondary hover:bg-surface-hover',
              )}
              style={
                selectedCategories.includes(key)
                  ? { backgroundColor: `${color}20`, borderColor: `${color}40`, color }
                  : undefined
              }
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Tags */}
      {projectTags.length > 0 && (
        <div>
          <label className="block text-xs text-secondary mb-1.5">{t('createIssue.tagsLabel')}</label>
          <div className="flex flex-wrap gap-1.5 mb-2">
            {selectedTags.map((tag) => {
              const tagObj = projectTags.find((t) => t.name === tag);
              const color = tagObj?.color || '#6b7280';
              return (
                <span
                  key={tag}
                  className="rounded-full px-2 py-0.5 text-[10px] font-medium border cursor-pointer hover:opacity-80"
                  style={{
                    backgroundColor: `${color}20`,
                    borderColor: `${color}40`,
                    color: color,
                  }}
                  onClick={() => toggleTag(tag)}
                >
                  {tag} ×
                </span>
              );
            })}
          </div>
          <div className="relative">
            <button
              type="button"
              onClick={() => setShowTagDropdown(!showTagDropdown)}
              className="w-full text-left rounded-lg border border-border bg-bg px-3 py-2 text-xs text-muted hover:border-border transition-colors"
            >
              {t('createIssue.selectTags')}
            </button>
            {showTagDropdown && (
              <div className="absolute left-0 top-full z-10 mt-1 w-full rounded-lg border border-border bg-surface py-1 shadow-xl max-h-40 overflow-y-auto">
                {projectTags.map((tag) => (
                  <button
                    key={tag.id}
                    type="button"
                    onClick={() => toggleTag(tag.name)}
                    className={cn(
                      'flex w-full items-center gap-2 px-3 py-1.5 text-xs transition-colors',
                      selectedTags.includes(tag.name) ? 'text-primary bg-surface-hover' : 'text-secondary hover:bg-surface-hover',
                    )}
                  >
                    <span
                      className="h-2.5 w-2.5 rounded-full shrink-0"
                      style={{ backgroundColor: tag.color }}
                    />
                    {tag.name}
                    {selectedTags.includes(tag.name) && (
                      <span className="ml-auto text-accent">✓</span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Step 3: Description ────────────────────── */

function StepDescription({
  description,
  setDescription,
  useTemplate,
  onToggleTemplate,
  t,
}: {
  description: string;
  setDescription: (v: string) => void;
  useTemplate: boolean;
  onToggleTemplate: () => void;
  t: (key: string) => string;
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <label className="block text-xs text-secondary">{t('createIssue.descriptionLabel')}</label>
        <button
          type="button"
          onClick={onToggleTemplate}
          className="text-[10px] text-accent hover:underline"
        >
          {useTemplate ? t('createIssue.hideTemplate') : t('createIssue.useTemplate')}
        </button>
      </div>
      <div className="min-h-[250px] rounded-lg border border-border overflow-hidden">
        <NotionEditor
          initialContent={description}
          onChange={setDescription}
          placeholder={t('createIssue.descriptionPlaceholder')}
        />
      </div>
    </div>
  );
}
