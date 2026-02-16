import { useState, useEffect, useCallback, useRef } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useOrganization } from '@clerk/clerk-react';
import {
  X, Bug, Sparkles, Zap, HelpCircle,
  OctagonAlert, ArrowUp, Minus, ArrowDown,
  ChevronLeft, ChevronRight, User, Calendar, CheckCircle2,
  Paperclip, Upload, Image, FileText, RotateCw, AlertCircle,
} from 'lucide-react';
import { useTranslation } from '@/hooks/useTranslation';
import { useApi } from '@/hooks/useApi';
import { useFileUpload, validateFiles } from '@/hooks/useFileUpload';
import { NotionEditor } from '@/components/shared/NotionEditor';
import { cn } from '@/lib/utils';
import type { IssueType, IssuePriority, Project, ProjectTag, Attachment } from '@/lib/types';

/* ── Templates per type ─────────────────────── */

// Templates are loaded from i18n — see locales/en.ts and locales/fr.ts
const TEMPLATE_KEYS: Record<IssueType, string> = {
  bug: 'template.bug',
  feature: 'template.feature',
  improvement: 'template.improvement',
  question: 'template.question',
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
  { key: 'urgent', labelKey: 'createIssue.priorityUrgent', color: 'border-red-400/40 text-red-400 hover:bg-red-500/10', icon: OctagonAlert },
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

/* ── Attachment limits ─────────────────────── */

const MAX_ATTACHMENTS = 10;
const MAX_IMAGE_SIZE = 20 * 1024 * 1024; // 20MB
const MAX_FILE_SIZE = 5 * 1024 * 1024;   // 5MB

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
  const [assigneeIds, setAssigneeIds] = useState<string[]>([]);
  const [dueDate, setDueDate] = useState('');
  const [estimate, setEstimate] = useState<number | null>(null);
  const [showAssigneePicker, setShowAssigneePicker] = useState(false);
  const [error, setError] = useState('');
  const { memberships } = useOrganization({ memberships: { infinite: true } });
  const orgMembers = memberships?.data ?? [];

  // ── Attachments ──
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const dragCounter = useRef(0);

  const { pendingFiles, isUploading, processFiles, retryFile, removePending } = useFileUpload({
    maxAttachments: MAX_ATTACHMENTS,
    maxImageSizeBytes: MAX_IMAGE_SIZE,
    maxFileSizeBytes: MAX_FILE_SIZE,
    maxDimension: 1920,
    webpQuality: 0.82,
  });

  const handleFileUpload = useCallback(async (files: FileList | File[] | null) => {
    if (!files || files.length === 0) return;
    setUploadError('');

    const fileArray = Array.from(files);
    const { errors } = validateFiles(fileArray, attachments.length, MAX_ATTACHMENTS, MAX_IMAGE_SIZE, MAX_FILE_SIZE);

    if (errors.length > 0) {
      const firstErr = errors[0];
      if (firstErr.reason === 'limit') {
        setUploadError(t('upload.limitReachedDesc', { max: MAX_ATTACHMENTS }));
      } else {
        setUploadError(firstErr.message);
      }
    }

    try {
      const newAttachments = await processFiles(files, attachments);
      if (newAttachments.length > 0) {
        setAttachments((prev) => [...prev, ...newAttachments]);
      }
    } catch {
      setUploadError(t('upload.errorDesc'));
    }
  }, [attachments, processFiles, t]);

  const handleRetryFile = useCallback(async (fileId: string) => {
    const result = await retryFile(fileId, attachments);
    if (result) {
      setAttachments((prev) => [...prev, result]);
    }
  }, [attachments, retryFile]);

  const handleDeleteAttachment = useCallback((idx: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== idx));
  }, []);

  // ── Paste handler ──
  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
      const el = document.activeElement;
      if (el?.tagName === 'TEXTAREA' || el?.tagName === 'INPUT') return;
      // Don't intercept paste inside the NotionEditor (contentEditable)
      if (el && (el as HTMLElement).closest?.('[contenteditable]')) return;

      const items = e.clipboardData?.items;
      if (!items) return;
      const pasteFiles: File[] = [];
      for (const item of Array.from(items)) {
        if (item.kind === 'file') {
          const file = item.getAsFile();
          if (file) pasteFiles.push(file);
        }
      }
      if (pasteFiles.length > 0) {
        e.preventDefault();
        handleFileUpload(pasteFiles);
      }
    };
    document.addEventListener('paste', handlePaste);
    return () => document.removeEventListener('paste', handlePaste);
  }, [handleFileUpload]);

  // ── Drag & Drop ──
  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current += 1;
    if (e.dataTransfer.types.includes('Files')) {
      setIsDragging(true);
    }
  }, []);
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);
  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current -= 1;
    if (dragCounter.current <= 0) {
      dragCounter.current = 0;
      setIsDragging(false);
    }
  }, []);
  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current = 0;
    setIsDragging(false);
    handleFileUpload(e.dataTransfer.files);
  }, [handleFileUpload]);

  // When type is selected, pre-fill template in description
  useEffect(() => {
    if (type && useTemplate && !description) {
      setDescription(t(TEMPLATE_KEYS[type]));
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
  const handleTypeSelect = (selectedType: IssueType) => {
    setType(selectedType);
    // Pre-fill template
    if (useTemplate) {
      setDescription(t(TEMPLATE_KEYS[selectedType]));
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
      if (type) setDescription(t(TEMPLATE_KEYS[type]));
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
        assignee_ids: assigneeIds.length > 0 ? assigneeIds : undefined,
        due_date: dueDate || undefined,
        estimate: estimate || undefined,
        attachments: attachments.length > 0 ? attachments : undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['issues', project.id] });
      queryClient.invalidateQueries({ queryKey: ['all-issues'] });
      queryClient.invalidateQueries({ queryKey: ['project-board'] });
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
    if (isUploading) return;
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

  // Derived: split attachments for display
  const imageAttachments = attachments.filter((a) => a.mime_type.startsWith('image/'));
  const nonImageAttachments = attachments.filter((a) => !a.mime_type.startsWith('image/'));
  const pendingImageFiles = pendingFiles.filter((f) => f.mime.startsWith('image/') || f.previewUrl !== null);
  const pendingNonImageFiles = pendingFiles.filter((f) => !f.mime.startsWith('image/') && f.previewUrl === null);
  const totalAttachmentCount = attachments.length + pendingFiles.filter(f => f.status !== 'error').length;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 dark:bg-black/60 backdrop-blur-sm sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="create-issue-title"
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Full-modal drag overlay */}
      {isDragging && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 backdrop-blur-[2px] pointer-events-none">
          <div className="flex flex-col items-center gap-3 rounded-2xl border-2 border-dashed border-accent bg-bg/90 p-10">
            <Upload size={32} className="text-accent" />
            <span className="text-sm font-medium text-accent">{t('upload.dropZone')}</span>
          </div>
        </div>
      )}

      <div className="w-full sm:max-w-lg rounded-t-xl sm:rounded-xl border border-border bg-surface shadow-2xl flex flex-col max-h-[95vh] sm:max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-4 sm:px-6 py-4 border-b border-border shrink-0">
          <div>
            <h2 id="create-issue-title" className="text-lg font-semibold text-primary">
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
            aria-label={t('createIssue.close') || 'Close'}
            className="rounded-md p-1 text-secondary hover:bg-surface-hover hover:text-primary transition-colors"
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>

        {/* Error */}
        {error && (
          <div className="mx-4 sm:mx-6 mt-4 rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-red-400">
            {error}
          </div>
        )}

        {/* Step content */}
        <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-4">
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
              assigneeIds={assigneeIds}
              setAssigneeIds={setAssigneeIds}
              dueDate={dueDate}
              setDueDate={setDueDate}
              estimate={estimate}
              setEstimate={setEstimate}
              orgMembers={orgMembers}
              showAssigneePicker={showAssigneePicker}
              setShowAssigneePicker={setShowAssigneePicker}
              t={t}
            />
          )}
          {step === 'description' && (
            <StepDescription
              description={description}
              setDescription={setDescription}
              useTemplate={useTemplate}
              onToggleTemplate={handleToggleTemplate}
              attachments={attachments}
              imageAttachments={imageAttachments}
              nonImageAttachments={nonImageAttachments}
              pendingImageFiles={pendingImageFiles}
              pendingNonImageFiles={pendingNonImageFiles}
              totalAttachmentCount={totalAttachmentCount}
              uploadError={uploadError}
              onFileUpload={handleFileUpload}
              onRetryFile={handleRetryFile}
              onDeleteAttachment={handleDeleteAttachment}
              onRemovePending={removePending}
              t={t}
            />
          )}
        </div>

        {/* Footer: Navigation */}
        <div className="flex items-center justify-between px-4 sm:px-6 py-4 border-t border-border shrink-0">
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
                disabled={!title.trim() || createMutation.isPending || isUploading}
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
  assigneeIds,
  setAssigneeIds,
  dueDate,
  setDueDate,
  estimate,
  setEstimate,
  orgMembers,
  showAssigneePicker,
  setShowAssigneePicker,
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
  assigneeIds: string[];
  setAssigneeIds: (v: string[]) => void;
  dueDate: string;
  setDueDate: (v: string) => void;
  estimate: number | null;
  setEstimate: (v: number | null) => void;
  orgMembers: { publicUserData?: { userId?: string; firstName?: string | null; lastName?: string | null; identifier?: string | null } }[];
  showAssigneePicker: boolean;
  setShowAssigneePicker: (v: boolean) => void;
  t: (key: string) => string;
}) {
  return (
    <div className="space-y-5">
      {/* Title */}
      <div>
        <label htmlFor="create-issue-title-input" className="block text-xs text-secondary mb-1.5">{t('createIssue.titleLabel')}</label>
        <input
          id="create-issue-title-input"
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={t('createIssue.titlePlaceholder')}
          aria-required="true"
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

      {/* Estimate */}
      <div>
        <label className="block text-xs text-secondary mb-1.5">{t('createIssue.estimateLabel')}</label>
        <div className="flex flex-wrap gap-1.5">
          {[{ v: null as number | null, l: '—' }, { v: 1, l: 'XS' }, { v: 2, l: 'S' }, { v: 3, l: 'M' }, { v: 5, l: 'L' }, { v: 8, l: 'XL' }].map(e => (
            <button
              key={e.l}
              type="button"
              onClick={() => setEstimate(e.v)}
              className={cn(
                'rounded-lg border px-3 py-1.5 text-xs font-medium font-mono transition-all',
                estimate === e.v ? 'ring-2 ring-accent/40 bg-surface-hover border-accent/40 text-primary' : 'border-border text-secondary hover:bg-surface-hover',
              )}
            >
              {e.l}
            </button>
          ))}
        </div>
      </div>

      {/* Assignees + Due Date — compact row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {/* Assignees */}
        <div>
          <label className="flex items-center gap-1.5 text-xs text-secondary mb-1.5">
            <User size={12} />
            {t('createIssue.assigneeLabel')}
          </label>
          <button
            type="button"
            onClick={() => setShowAssigneePicker(!showAssigneePicker)}
            className="w-full text-left rounded-lg border border-border bg-bg px-3 py-2 text-xs text-muted hover:border-border transition-colors"
          >
            {assigneeIds.length > 0
              ? `${assigneeIds.length} ${t('createIssue.assigned')}`
              : t('createIssue.assigneePlaceholder')
            }
          </button>
          {showAssigneePicker && (
            <div className="mt-1 rounded-lg border border-border bg-surface p-1.5 max-h-36 overflow-y-auto">
              {orgMembers.map((m) => {
                const userId = m.publicUserData?.userId;
                if (!userId) return null;
                const isSelected = assigneeIds.includes(userId);
                const fullName = `${m.publicUserData?.firstName || ''} ${m.publicUserData?.lastName || ''}`.trim();
                const identifier = m.publicUserData?.identifier || '';
                const emailFallback = identifier
                  ? (identifier.length > 24 ? `${identifier.slice(0, 23)}…` : identifier)
                  : '';
                const name = fullName || emailFallback || userId.slice(0, 12);
                return (
                  <button
                    key={userId}
                    type="button"
                    onClick={() => {
                      setAssigneeIds(
                        isSelected
                          ? assigneeIds.filter((a) => a !== userId)
                          : [...assigneeIds, userId],
                      );
                    }}
                    className={cn(
                      'flex items-center gap-2 w-full rounded-md px-2 py-1.5 text-xs transition-colors',
                      isSelected ? 'bg-accent/10 text-accent' : 'text-secondary hover:bg-surface-hover',
                    )}
                  >
                    <div className="h-5 w-5 rounded-full bg-surface-hover flex items-center justify-center text-[9px] font-mono font-bold">
                      {name.slice(0, 2).toUpperCase()}
                    </div>
                    <span className="flex-1 text-left truncate">{name}</span>
                    {isSelected && <CheckCircle2 size={14} className="text-accent" />}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Due Date */}
        <div>
          <label htmlFor="create-issue-due-date" className="flex items-center gap-1.5 text-xs text-secondary mb-1.5">
            <Calendar size={12} aria-hidden="true" />
            {t('createIssue.dueDateLabel')}
          </label>
          <input
            id="create-issue-due-date"
            type="date"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
            className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-xs text-primary placeholder-muted focus:border-accent focus:outline-none transition-colors"
          />
        </div>
      </div>
    </div>
  );
}

/* ── Step 3: Description + Attachments ─────── */

function StepDescription({
  description,
  setDescription,
  useTemplate,
  onToggleTemplate,
  attachments,
  imageAttachments,
  nonImageAttachments,
  pendingImageFiles,
  pendingNonImageFiles,
  totalAttachmentCount,
  uploadError,
  onFileUpload,
  onRetryFile,
  onDeleteAttachment,
  onRemovePending,
  t,
}: {
  description: string;
  setDescription: (v: string) => void;
  useTemplate: boolean;
  onToggleTemplate: () => void;
  attachments: Attachment[];
  imageAttachments: Attachment[];
  nonImageAttachments: Attachment[];
  pendingImageFiles: { id: string; name: string; previewUrl: string | null; dataUrl: string | null; mime: string; size: number; status: string; progress: number }[];
  pendingNonImageFiles: { id: string; name: string; status: string }[];
  totalAttachmentCount: number;
  uploadError: string;
  onFileUpload: (files: FileList | File[] | null) => void;
  onRetryFile: (fileId: string) => void;
  onDeleteAttachment: (idx: number) => void;
  onRemovePending: (fileId: string) => void;
  t: (key: string) => string;
}) {
  return (
    <div className="space-y-4">
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
        <div className="min-h-[200px] rounded-lg border border-border overflow-hidden">
          <NotionEditor
            initialContent={description}
            onChange={setDescription}
            placeholder={t('createIssue.descriptionPlaceholder')}
          />
        </div>
      </div>

      {/* ── Attachments ── */}
      <div className="space-y-2">
        <label className="flex items-center gap-1.5 text-[10px] text-muted uppercase tracking-wider font-medium">
          <Paperclip size={10} />
          {t('publicSubmit.attachments')}
          {attachments.length > 0 && (
            <span className="text-[9px] text-muted/70 ml-0.5">
              ({attachments.length}/{MAX_ATTACHMENTS})
            </span>
          )}
          <span className="text-[9px] text-muted/50 ml-1 normal-case tracking-normal">{t('publicSubmit.attachmentsHint')}</span>
        </label>

        {/* Upload error */}
        {uploadError && (
          <p className="text-[11px] text-red-400">{uploadError}</p>
        )}

        {/* Image thumbnails grid */}
        {(imageAttachments.length > 0 || pendingImageFiles.length > 0) && (
          <div className="grid grid-cols-4 gap-1.5">
            {imageAttachments.map((att, idx) => (
              <div key={`img-${idx}`} className="group relative aspect-square rounded-md border border-border overflow-hidden hover:border-accent transition-colors">
                <img
                  src={att.url}
                  alt={att.name}
                  className="h-full w-full object-cover"
                  loading="lazy"
                />
                <button
                  type="button"
                  onClick={() => onDeleteAttachment(attachments.indexOf(att))}
                  className="absolute top-0.5 right-0.5 rounded-full bg-black/60 p-0.5 text-white opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-500/80"
                >
                  <X size={10} />
                </button>
                <span className="absolute bottom-0.5 left-0.5 rounded bg-black/60 px-1 py-0.5 text-[8px] text-white font-mono opacity-0 group-hover:opacity-100 transition-opacity">
                  {att.size > 1024 * 1024 ? `${(att.size / (1024 * 1024)).toFixed(1)}MB` : `${Math.round(att.size / 1024)}KB`}
                </span>
              </div>
            ))}

            {/* Pending image uploads */}
            {pendingImageFiles.map((pf) => (
              <div key={pf.id} className="relative aspect-square rounded-md border border-border overflow-hidden">
                {(pf.previewUrl || pf.dataUrl) && (
                  <img
                    src={pf.dataUrl || pf.previewUrl || ''}
                    alt={pf.name}
                    className="h-full w-full object-cover"
                  />
                )}
                {!pf.previewUrl && !pf.dataUrl && (
                  <div className="h-full w-full flex items-center justify-center bg-surface">
                    <Image size={16} className="text-muted" />
                  </div>
                )}
                {pf.status !== 'done' && (
                  <div className="absolute inset-0 bg-black/40 flex flex-col items-center justify-center gap-1">
                    {pf.status === 'error' ? (
                      <>
                        <AlertCircle size={14} className="text-red-400" />
                        <button
                          type="button"
                          onClick={() => onRetryFile(pf.id)}
                          className="flex items-center gap-0.5 rounded bg-white/20 px-1.5 py-0.5 text-[9px] text-white hover:bg-white/30 transition-colors"
                        >
                          <RotateCw size={8} />
                          {t('upload.retry')}
                        </button>
                        <button
                          type="button"
                          onClick={() => onRemovePending(pf.id)}
                          className="rounded bg-red-500/60 px-1.5 py-0.5 text-[9px] text-white hover:bg-red-500/80 transition-colors"
                        >
                          <X size={8} />
                        </button>
                      </>
                    ) : (
                      <>
                        <div className="h-5 w-5 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                        <span className="text-[9px] text-white/80 font-medium">
                          {pf.status === 'compressing' ? t('upload.compressing') : t('upload.saving')}
                        </span>
                      </>
                    )}
                  </div>
                )}
                {pf.status !== 'done' && pf.status !== 'error' && (
                  <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-black/20">
                    <div
                      className="h-full bg-accent transition-all duration-300"
                      style={{ width: `${Math.round(pf.progress * 100)}%` }}
                    />
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Non-image attachments */}
        {nonImageAttachments.map((att, idx) => (
          <div key={`file-${idx}`} className="group flex items-center gap-1.5 rounded-md bg-surface border border-border px-2 py-1.5">
            <FileText size={10} className="text-secondary shrink-0" />
            <span className="text-[11px] text-secondary truncate flex-1">{att.name}</span>
            <span className="text-[9px] text-muted shrink-0">
              {att.size > 1024 * 1024 ? `${(att.size / (1024 * 1024)).toFixed(1)}MB` : `${Math.round(att.size / 1024)}KB`}
            </span>
            <button
              type="button"
              onClick={() => onDeleteAttachment(attachments.indexOf(att))}
              className="text-muted hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
            >
              <X size={10} />
            </button>
          </div>
        ))}

        {/* Pending non-image files */}
        {pendingNonImageFiles.map((pf) => (
          <div key={pf.id} className="flex items-center gap-1.5 rounded-md bg-surface border border-border px-2 py-1.5">
            <FileText size={10} className="text-secondary shrink-0" />
            <span className="text-[11px] text-secondary truncate flex-1">{pf.name}</span>
            {pf.status === 'error' ? (
              <button type="button" onClick={() => onRetryFile(pf.id)} className="text-[9px] text-accent hover:underline">
                {t('upload.retry')}
              </button>
            ) : pf.status !== 'done' ? (
              <div className="h-2.5 w-2.5 rounded-full border-2 border-accent border-t-transparent animate-spin shrink-0" />
            ) : null}
          </div>
        ))}

        {/* Upload button */}
        {totalAttachmentCount < MAX_ATTACHMENTS && (
          <label className="flex flex-col items-center justify-center gap-0.5 rounded-md border border-dashed border-border p-2 text-[11px] cursor-pointer transition-all text-muted hover:border-accent hover:text-accent">
            <Upload size={14} />
            <span className="text-center">{t('publicSubmit.uploadFiles')}</span>
            <span className="text-[9px] text-muted/50">{t('publicSubmit.uploadHint')}</span>
            <input
              type="file"
              multiple
              accept="image/*,.pdf,.doc,.docx,.txt,.heic,.heif"
              className="hidden"
              aria-label={t('publicSubmit.uploadFiles') || 'Upload files'}
              onChange={(e) => {
                onFileUpload(e.target.files);
                e.target.value = '';
              }}
            />
          </label>
        )}
      </div>
    </div>
  );
}
