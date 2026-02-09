import { useEffect, useRef, useState, useCallback } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useUser, useOrganization } from '@clerk/clerk-react';
import {
  X, ChevronDown, Tag, User, Calendar,
  MessageSquare, Activity, Bot, CheckCircle2, AlertTriangle,
  Minus, ArrowUp, ArrowDown, Bug, Sparkles, Zap, HelpCircle,
  FileText, GitPullRequest, TestTube2, Paperclip, Upload, Image,
  Send, Plus,
} from 'lucide-react';
import { useIssuesStore } from '@/stores/issues';
import { useApi } from '@/hooks/useApi';
import { useTranslation } from '@/hooks/useTranslation';
import { cn, timeAgo } from '@/lib/utils';
import { NotionEditor } from '@/components/shared/NotionEditor';
import { GitHubSection } from '@/components/github/GitHubSection';
import type { IssueStatus, IssuePriority, IssueType, TLDR, Comment, ProjectStatus } from '@/lib/types';

const TAG_COLORS = [
  '#ef4444', '#f97316', '#eab308', '#22c55e', '#06b6d4',
  '#3b82f6', '#8b5cf6', '#ec4899', '#f43f5e', '#14b8a6',
  '#a855f7', '#6366f1', '#0ea5e9', '#84cc16', '#fb923c',
];

const STATUS_OPTIONS: { key: IssueStatus; label: string; color: string }[] = [
  { key: 'backlog', label: 'Backlog', color: '#6b7280' },
  { key: 'todo', label: 'Todo', color: '#3b82f6' },
  { key: 'in_progress', label: 'In Progress', color: '#f59e0b' },
  { key: 'in_review', label: 'In Review', color: '#8b5cf6' },
  { key: 'done', label: 'Done', color: '#22c55e' },
  { key: 'cancelled', label: 'Cancelled', color: '#ef4444' },
];

const PRIORITY_OPTIONS: { key: IssuePriority; label: string; color: string; icon: typeof ArrowUp }[] = [
  { key: 'urgent', label: 'Urgent', color: '#ef4444', icon: AlertTriangle },
  { key: 'high', label: 'High', color: '#f97316', icon: ArrowUp },
  { key: 'medium', label: 'Medium', color: '#eab308', icon: Minus },
  { key: 'low', label: 'Low', color: '#6b7280', icon: ArrowDown },
];

const TYPE_CONFIG: Record<IssueType, { icon: typeof Bug; color: string; label: string }> = {
  bug: { icon: Bug, color: 'text-red-400', label: 'Bug' },
  feature: { icon: Sparkles, color: 'text-emerald-400', label: 'Feature' },
  improvement: { icon: Zap, color: 'text-blue-400', label: 'Improvement' },
  question: { icon: HelpCircle, color: 'text-purple-400', label: 'Question' },
};

interface IssueDrawerProps {
  issueId: string;
  statuses?: ProjectStatus[];
  projectId?: string;
  onClose: () => void;
}

export function IssueDrawer({ issueId, statuses, projectId, onClose }: IssueDrawerProps) {
  const { t } = useTranslation();
  const apiClient = useApi();
  const queryClient = useQueryClient();
  const { user } = useUser();
  const { memberships } = useOrganization({ memberships: { infinite: true } });
  const orgMembers = memberships?.data ?? [];
  const updateIssue = useIssuesStore((s) => s.updateIssue);
  const panelRef = useRef<HTMLDivElement>(null);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');
  const [showTagPicker, setShowTagPicker] = useState(false);
  const [newTagName, setNewTagName] = useState('');
  const [commentText, setCommentText] = useState('');
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [editingDescription, setEditingDescription] = useState(false);
  const [descriptionDraft, setDescriptionDraft] = useState('');
  const [showAssigneePicker, setShowAssigneePicker] = useState(false);
  const [editingDueDate, setEditingDueDate] = useState(false);

  // Fetch full issue details
  const { data: issue, isLoading } = useQuery({
    queryKey: ['issue', issueId],
    queryFn: () => apiClient.issues.get(issueId),
    staleTime: 10_000,
  });

  // Fetch project tags
  const resolvedProjectId = projectId || issue?.project_id;
  const { data: projectTags = [] } = useQuery({
    queryKey: ['project-tags', resolvedProjectId],
    queryFn: () => apiClient.tags.listByProject(resolvedProjectId!),
    enabled: !!resolvedProjectId,
  });

  // Update mutation
  const updateMutation = useMutation({
    mutationFn: ({ field, value }: { field: string; value: unknown }) =>
      apiClient.issues.update(issueId, { [field]: value }),
    onSuccess: (updated) => {
      updateIssue(issueId, updated);
      queryClient.invalidateQueries({ queryKey: ['issue', issueId] });
      queryClient.invalidateQueries({ queryKey: ['issues'] });
    },
  });

  // Create comment mutation
  const commentMutation = useMutation({
    mutationFn: (body: string) =>
      apiClient.comments.create(issueId, {
        author_id: user?.id || 'anonymous',
        author_name: user?.fullName || user?.firstName || 'Anonymous',
        body,
      }),
    onSuccess: () => {
      setCommentText('');
      queryClient.invalidateQueries({ queryKey: ['issue', issueId] });
    },
  });

  // Create tag mutation
  const createTagMutation = useMutation({
    mutationFn: (body: { name: string; color: string }) =>
      apiClient.tags.create(resolvedProjectId!, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['project-tags', resolvedProjectId] });
    },
  });

  // Close on escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (lightboxIndex !== null) {
          setLightboxIndex(null);
        } else {
          onClose();
        }
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose, lightboxIndex]);

  // Click outside to close
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const timer = setTimeout(() => {
      document.addEventListener('mousedown', handler);
    }, 100);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('mousedown', handler);
    };
  }, [onClose]);

  const handleTitleSave = useCallback(() => {
    if (titleDraft.trim() && titleDraft !== issue?.title) {
      updateMutation.mutate({ field: 'title', value: titleDraft.trim() });
    }
    setEditingTitle(false);
  }, [titleDraft, issue?.title, updateMutation]);

  const handleDescriptionSave = useCallback(() => {
    if (descriptionDraft !== (issue?.description || '')) {
      updateMutation.mutate({ field: 'description', value: descriptionDraft });
    }
    setEditingDescription(false);
  }, [descriptionDraft, issue?.description, updateMutation]);

  const handleFieldUpdate = useCallback(
    (field: string, value: unknown) => {
      updateMutation.mutate({ field, value });
    },
    [updateMutation],
  );

  const handleToggleTag = (tagName: string) => {
    const currentTags = issue?.tags || [];
    const newTags = currentTags.includes(tagName)
      ? currentTags.filter((t) => t !== tagName)
      : [...currentTags, tagName];
    handleFieldUpdate('tags', newTags);
  };

  const handleCreateAndAddTag = () => {
    if (!newTagName.trim()) return;
    const color = TAG_COLORS[Math.floor(Math.random() * TAG_COLORS.length)];
    createTagMutation.mutate(
      { name: newTagName.trim(), color },
      {
        onSuccess: () => {
          // Also add to issue
          const currentTags = issue?.tags || [];
          if (!currentTags.includes(newTagName.trim())) {
            handleFieldUpdate('tags', [...currentTags, newTagName.trim()]);
          }
          setNewTagName('');
        },
      },
    );
  };

  const handleSubmitComment = () => {
    if (!commentText.trim()) return;
    commentMutation.mutate(commentText.trim());
  };

  const handleFileUpload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const newAttachments = [...(issue?.attachments || [])];

    for (const file of Array.from(files)) {
      if (file.size > 5 * 1024 * 1024) continue; // 5MB limit
      const reader = new FileReader();
      const base64 = await new Promise<string>((resolve) => {
        reader.onload = () => resolve(reader.result as string);
        reader.readAsDataURL(file);
      });
      newAttachments.push({
        url: base64,
        name: file.name,
        size: file.size,
        mime_type: file.type,
      });
    }

    // Update via API — for now this goes through the generic update
    // The backend stores this in the attachments JSONB column
    await apiClient.issues.update(issueId, { attachments: newAttachments } as any);
    queryClient.invalidateQueries({ queryKey: ['issue', issueId] });
  };

  const availableStatuses = statuses ?? STATUS_OPTIONS;

  // Get image attachments for lightbox
  const imageAttachments = (issue?.attachments || []).filter(
    (a) => a.mime_type?.startsWith('image/') || a.url?.startsWith('data:image/'),
  );

  if (isLoading || !issue) {
    return (
      <>
        <div className="fixed inset-0 z-40 bg-black/30 dark:bg-black/40" onClick={onClose} />
        <div
          ref={panelRef}
          className="fixed inset-y-0 right-0 z-50 w-full md:w-[45%] lg:w-[40%] bg-bg border-l border-border flex items-center justify-center animate-slide-in-right"
        >
          <span className="text-sm text-secondary">{t('issueDrawer.loading')}</span>
        </div>
      </>
    );
  }

  const TypeIcon = TYPE_CONFIG[issue.type]?.icon || FileText;
  const typeColor = TYPE_CONFIG[issue.type]?.color || 'text-secondary';
  const currentStatus = availableStatuses.find(
    (s) => s.key === issue.status,
  );
  const currentPriority = PRIORITY_OPTIONS.find(
    (p) => p.key === issue.priority,
  );

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-40 bg-black/30 dark:bg-black/40" />

      {/* Panel */}
      <div
        ref={panelRef}
        className="fixed inset-y-0 right-0 z-50 w-full md:w-[45%] lg:w-[40%] bg-bg border-l border-border flex flex-col animate-slide-in-right overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-5 py-3 shrink-0">
          <div className="flex items-center gap-2">
            <TypeIcon size={16} className={typeColor} />
            <span className="text-xs font-mono text-secondary">{issue.display_id}</span>
          </div>
          <button
            onClick={onClose}
            className="rounded-md p-1.5 text-secondary hover:bg-surface-hover hover:text-primary transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          <div className="p-5 space-y-6">
            {/* Title */}
            <div>
              {editingTitle ? (
                <input
                  type="text"
                  value={titleDraft}
                  onChange={(e) => setTitleDraft(e.target.value)}
                  onBlur={handleTitleSave}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleTitleSave();
                    if (e.key === 'Escape') setEditingTitle(false);
                  }}
                  autoFocus
                  className="w-full bg-transparent text-xl font-semibold text-primary outline-none border-b border-accent pb-1"
                />
              ) : (
                <h2
                  onClick={() => {
                    setTitleDraft(issue.title);
                    setEditingTitle(true);
                  }}
                  className="text-xl font-semibold text-primary cursor-pointer hover:text-accent transition-colors"
                >
                  {issue.title}
                </h2>
              )}
            </div>

            {/* Properties Grid */}
            <div className="grid grid-cols-2 gap-3">
              {/* Status */}
              <PropertyRow label={t('issueDrawer.status')}>
                <DropdownSelect
                  value={issue.status}
                  options={availableStatuses.map((s) => ({
                    key: s.key,
                    label: s.label,
                    color: s.color,
                  }))}
                  onChange={(v) => handleFieldUpdate('status', v)}
                  renderSelected={() => (
                    <span className="flex items-center gap-2">
                      <span
                        className="h-2.5 w-2.5 rounded-full shrink-0"
                        style={{ backgroundColor: currentStatus?.color }}
                      />
                      <span className="text-sm text-primary">
                        {currentStatus?.label || issue.status}
                      </span>
                    </span>
                  )}
                />
              </PropertyRow>

              {/* Priority */}
              <PropertyRow label={t('issueDrawer.priority')}>
                <DropdownSelect
                  value={issue.priority || ''}
                  options={[
                    { key: '', label: 'None', color: '#555' },
                    ...PRIORITY_OPTIONS.map((p) => ({
                      key: p.key,
                      label: p.label,
                      color: p.color,
                    })),
                  ]}
                  onChange={(v) => handleFieldUpdate('priority', v || null)}
                  renderSelected={() => (
                    <span className="flex items-center gap-2">
                      {currentPriority ? (
                        <>
                          <currentPriority.icon
                            size={14}
                            style={{ color: currentPriority.color }}
                          />
                          <span className="text-sm text-primary">
                            {currentPriority.label}
                          </span>
                        </>
                      ) : (
                        <span className="text-sm text-muted">{t('issueDrawer.none')}</span>
                      )}
                    </span>
                  )}
                />
              </PropertyRow>

              {/* Type */}
              <PropertyRow label={t('issueDrawer.type')}>
                <span className="flex items-center gap-2">
                  <TypeIcon size={14} className={typeColor} />
                  <span className="text-sm text-primary">
                    {TYPE_CONFIG[issue.type]?.label || issue.type}
                  </span>
                </span>
              </PropertyRow>

              {/* Source */}
              <PropertyRow label={t('issueDrawer.source')}>
                <span className="text-sm text-secondary capitalize">{issue.source}</span>
              </PropertyRow>
            </div>

            {/* Tags with Picker */}
            <div>
              <label className="flex items-center gap-1.5 text-xs text-muted mb-2">
                <Tag size={12} />
                {t('issueDrawer.tags')}
              </label>
              <div className="flex flex-wrap gap-1.5">
                {issue.tags.map((tag) => {
                  const tagObj = projectTags.find((t) => t.name === tag);
                  const color = tagObj?.color || '#6b7280';
                  return (
                    <span
                      key={tag}
                      className="rounded-full px-2.5 py-1 text-xs font-medium border cursor-pointer hover:opacity-80 transition-opacity"
                      style={{
                        backgroundColor: `${color}20`,
                        borderColor: `${color}40`,
                        color: color,
                      }}
                      onClick={() => handleToggleTag(tag)}
                      title={t('issueDrawer.removeTag')}
                    >
                      {tag} ×
                    </span>
                  );
                })}
                <button
                  onClick={() => setShowTagPicker(!showTagPicker)}
                  className="rounded-full border border-dashed border-border px-2.5 py-1 text-xs text-muted hover:border-accent hover:text-accent transition-colors"
                >
                  <Plus size={10} className="inline mr-1" />
                  {t('issueDrawer.addTag')}
                </button>
              </div>

              {/* Tag Picker Dropdown */}
              {showTagPicker && (
                <div className="mt-2 rounded-lg border border-border bg-surface p-2 max-h-48 overflow-y-auto">
                  {projectTags
                    .filter((t) => !issue.tags.includes(t.name))
                    .map((tag) => (
                      <button
                        key={tag.id}
                        onClick={() => {
                          handleToggleTag(tag.name);
                          setShowTagPicker(false);
                        }}
                        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs text-secondary hover:bg-surface-hover transition-colors"
                      >
                        <span
                          className="h-3 w-3 rounded-full shrink-0"
                          style={{ backgroundColor: tag.color }}
                        />
                        {tag.name}
                      </button>
                    ))}
                  {/* Create new tag */}
                  <div className="flex items-center gap-2 mt-1 pt-1 border-t border-border">
                    <input
                      type="text"
                      value={newTagName}
                      onChange={(e) => setNewTagName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleCreateAndAddTag();
                      }}
                      placeholder={t('issueDrawer.newTagPlaceholder')}
                      className="flex-1 bg-transparent text-xs text-primary outline-none placeholder-muted px-2 py-1"
                    />
                    <button
                      onClick={handleCreateAndAddTag}
                      disabled={!newTagName.trim()}
                      className="rounded-md px-2 py-1 text-[10px] bg-accent text-black font-medium disabled:opacity-40 hover:bg-accent-hover transition-colors"
                    >
                      {t('issueDrawer.createTag')}
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Creator */}
            {issue.created_by_id && (
              <div>
                <label className="flex items-center gap-1.5 text-xs text-muted mb-2">
                  <User size={12} />
                  {t('issueDrawer.createdBy')}
                </label>
                <div className="flex items-center gap-2">
                  <div className="h-7 w-7 rounded-full bg-accent/20 border border-accent/30 flex items-center justify-center text-[10px] font-mono font-bold text-accent">
                    {(issue.created_by_name || issue.created_by_id || '?').slice(0, 2).toUpperCase()}
                  </div>
                  <span className="text-xs text-secondary">{issue.created_by_name || issue.created_by_id?.slice(0, 12)}</span>
                </div>
              </div>
            )}

            {/* Assignees */}
            <div>
              <label className="flex items-center justify-between text-xs text-muted mb-2">
                <span className="flex items-center gap-1.5">
                  <User size={12} />
                  {t('issueDrawer.assignees')}
                </span>
                <button
                  onClick={() => setShowAssigneePicker(!showAssigneePicker)}
                  className="text-accent hover:text-accent-hover transition-colors"
                >
                  <Plus size={14} />
                </button>
              </label>
              {issue.assignee_ids.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {issue.assignee_ids.map((id) => {
                    const member = orgMembers.find(
                      (m) => m.publicUserData?.userId === id,
                    );
                    const name = member
                      ? `${member.publicUserData?.firstName || ''} ${member.publicUserData?.lastName || ''}`.trim()
                      : id.slice(0, 12);
                    return (
                      <span
                        key={id}
                        className="inline-flex items-center gap-1.5 rounded-full bg-surface-hover border border-border px-2.5 py-1 text-xs text-secondary group/assignee"
                      >
                        <div className="h-5 w-5 rounded-full bg-accent/20 flex items-center justify-center text-[9px] font-mono font-bold text-accent">
                          {name.slice(0, 2).toUpperCase()}
                        </div>
                        {name}
                        <button
                          onClick={() => {
                            const next = issue.assignee_ids.filter((a) => a !== id);
                            handleFieldUpdate('assignee_ids', next);
                          }}
                          className="ml-0.5 text-muted hover:text-red-400 opacity-0 group-hover/assignee:opacity-100 transition-opacity"
                        >
                          <X size={12} />
                        </button>
                      </span>
                    );
                  })}
                </div>
              ) : (
                <button
                  onClick={() => setShowAssigneePicker(!showAssigneePicker)}
                  className="text-xs text-muted hover:text-secondary transition-colors"
                >
                  {t('issueDrawer.assigneeNone')}
                </button>
              )}
              {showAssigneePicker && (
                <div className="mt-2 rounded-lg border border-border bg-surface p-2 max-h-48 overflow-y-auto">
                  {orgMembers.length > 0 ? orgMembers.map((m) => {
                    const userId = m.publicUserData?.userId;
                    if (!userId) return null;
                    const isAssigned = issue.assignee_ids.includes(userId);
                    const name = `${m.publicUserData?.firstName || ''} ${m.publicUserData?.lastName || ''}`.trim() || userId.slice(0, 12);
                    return (
                      <button
                        key={userId}
                        onClick={() => {
                          const next = isAssigned
                            ? issue.assignee_ids.filter((a) => a !== userId)
                            : [...issue.assignee_ids, userId];
                          handleFieldUpdate('assignee_ids', next);
                        }}
                        className={cn(
                          'flex items-center gap-2 w-full rounded-md px-2 py-1.5 text-xs transition-colors',
                          isAssigned
                            ? 'bg-accent/10 text-accent'
                            : 'text-secondary hover:bg-surface-hover',
                        )}
                      >
                        <div className="h-5 w-5 rounded-full bg-surface-hover flex items-center justify-center text-[9px] font-mono font-bold">
                          {name.slice(0, 2).toUpperCase()}
                        </div>
                        <span className="flex-1 text-left truncate">{name}</span>
                        {isAssigned && <CheckCircle2 size={14} className="text-accent" />}
                      </button>
                    );
                  }) : (
                    <p className="text-xs text-muted px-2 py-2">{t('issueDrawer.noMembers')}</p>
                  )}
                </div>
              )}
            </div>

            {/* Due Date */}
            <div>
              <label className="flex items-center justify-between text-xs text-muted mb-2">
                <span className="flex items-center gap-1.5">
                  <Calendar size={12} />
                  {t('issueDrawer.dueDate')}
                </span>
              </label>
              {editingDueDate || issue.due_date ? (
                <div className="flex items-center gap-2">
                  <input
                    type="date"
                    value={issue.due_date ? issue.due_date.slice(0, 10) : ''}
                    onChange={(e) => {
                      const val = e.target.value;
                      handleFieldUpdate('due_date', val || null);
                      if (!val) setEditingDueDate(false);
                    }}
                    className="rounded-md border border-border bg-surface px-2.5 py-1.5 text-xs text-primary outline-none focus:border-accent transition-colors"
                  />
                  {issue.due_date && (
                    <button
                      onClick={() => {
                        handleFieldUpdate('due_date', null);
                        setEditingDueDate(false);
                      }}
                      className="text-muted hover:text-red-400 transition-colors"
                    >
                      <X size={14} />
                    </button>
                  )}
                </div>
              ) : (
                <button
                  onClick={() => setEditingDueDate(true)}
                  className="text-xs text-muted hover:text-secondary transition-colors"
                >
                  {t('issueDrawer.dueDateNone')}
                </button>
              )}
              {issue.due_date && (() => {
                const due = new Date(issue.due_date);
                const now = new Date();
                const diffDays = Math.ceil((due.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
                if (diffDays < 0) return <span className="text-[10px] text-red-400 mt-1 block">{t('issueDrawer.dueDateOverdue')}</span>;
                if (diffDays <= 3) return <span className="text-[10px] text-amber-400 mt-1 block">{t('issueDrawer.dueDateSoon', { days: diffDays })}</span>;
                return null;
              })()}
            </div>

            {/* Description */}
            <div>
              <label className="flex items-center gap-1.5 text-xs text-muted mb-2">
                <FileText size={12} />
                {t('issueDrawer.description')}
                {!editingDescription && (
                  <span className="text-[9px] text-muted/60 ml-1">{t('issueDrawer.descriptionEdit')}</span>
                )}
              </label>
              {editingDescription ? (
                <div className="rounded-lg bg-surface border border-border overflow-hidden">
                  <div className="min-h-[200px]">
                    <NotionEditor
                      initialContent={descriptionDraft}
                      onChange={setDescriptionDraft}
                      placeholder={t('issueDrawer.descriptionPlaceholder')}
                    />
                  </div>
                  <div className="flex items-center justify-between border-t border-border px-4 py-2">
                    <button
                      onClick={() => setEditingDescription(false)}
                      className="text-xs text-muted hover:text-primary transition-colors"
                    >
                      {t('common.cancel')}
                    </button>
                    <button
                      onClick={handleDescriptionSave}
                      className="rounded-md bg-accent px-3 py-1 text-xs font-medium text-black hover:bg-accent-hover transition-colors"
                    >
                      {t('issueDrawer.descriptionSave')}
                    </button>
                  </div>
                </div>
              ) : issue.description ? (
                <div
                  onDoubleClick={() => {
                    setDescriptionDraft(issue.description || '');
                    setEditingDescription(true);
                  }}
                  className="rounded-lg bg-surface border border-border p-4 cursor-text hover:border-accent/30 transition-colors min-h-[80px]"
                >
                  <NotionEditor
                    initialContent={issue.description}
                    editable={false}
                  />
                </div>
              ) : (
                <p
                  className="text-sm text-muted italic cursor-pointer hover:text-accent transition-colors"
                  onDoubleClick={() => {
                    setDescriptionDraft('');
                    setEditingDescription(true);
                  }}
                >
                  {t('issueDrawer.noDescription')}
                </p>
              )}
            </div>

            {/* Attachments */}
            <div>
              <label className="flex items-center gap-1.5 text-xs text-muted mb-2">
                <Paperclip size={12} />
                {t('issueDrawer.attachments')}
              </label>
              {/* Thumbnail grid */}
              {imageAttachments.length > 0 && (
                <div className="grid grid-cols-3 gap-2 mb-2">
                  {imageAttachments.map((att, idx) => (
                    <button
                      key={idx}
                      onClick={() => setLightboxIndex(idx)}
                      className="group relative aspect-square rounded-lg border border-border overflow-hidden hover:border-accent transition-colors"
                    >
                      <img
                        src={att.url}
                        alt={att.name}
                        className="h-full w-full object-cover"
                      />
                      <div className="absolute inset-0 bg-black/30 dark:bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                        <Image size={16} className="text-white" />
                      </div>
                    </button>
                  ))}
                </div>
              )}
              {/* Non-image attachments */}
              {(issue.attachments || [])
                .filter((a) => !a.mime_type?.startsWith('image/') && !a.url?.startsWith('data:image/'))
                .map((att, idx) => (
                  <div key={idx} className="flex items-center gap-2 rounded-md bg-surface border border-border px-3 py-2 mb-1">
                    <FileText size={12} className="text-secondary" />
                    <span className="text-xs text-secondary truncate">{att.name}</span>
                    <span className="text-[10px] text-muted ml-auto">
                      {(att.size / 1024).toFixed(0)}KB
                    </span>
                  </div>
                ))}
              {/* Upload area */}
              <label className="flex items-center justify-center gap-2 rounded-lg border border-dashed border-border p-3 text-xs text-muted cursor-pointer hover:border-accent hover:text-accent transition-colors mt-1">
                <Upload size={14} />
                {t('issueDrawer.dropFiles')}
                <input
                  type="file"
                  multiple
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => handleFileUpload(e.target.files)}
                />
              </label>
            </div>

            {/* TLDRs (Agent Summaries) */}
            {issue.tldrs && issue.tldrs.length > 0 && (
              <div>
                <label className="flex items-center gap-1.5 text-xs text-muted mb-2">
                  <Bot size={12} />
                  {t('issueDrawer.agentTldrs')}
                </label>
                <div className="space-y-2">
                  {issue.tldrs.map((tldr: TLDR) => (
                    <TldrCard key={tldr.id} tldr={tldr} />
                  ))}
                </div>
              </div>
            )}

            {/* Comments */}
            <div>
              <label className="flex items-center gap-1.5 text-xs text-muted mb-2">
                <MessageSquare size={12} />
                {t('issueDrawer.commentCount', { count: issue.comments?.length || 0 })}
              </label>
              <div className="space-y-3">
                {(issue.comments || []).map((comment: Comment) => (
                  <CommentCard key={comment.id} comment={comment} />
                ))}
              </div>

              {/* Comment input */}
              <div className="mt-3 rounded-lg border border-border bg-surface p-3">
                <textarea
                  value={commentText}
                  onChange={(e) => setCommentText(e.target.value)}
                  placeholder={t('issueDrawer.addComment')}
                  rows={3}
                  className="w-full bg-transparent text-sm text-primary placeholder-muted outline-none resize-none"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                      handleSubmitComment();
                    }
                  }}
                />
                <div className="flex items-center justify-between mt-2 pt-2 border-t border-border">
                  <span className="text-[10px] text-muted">{t('issueDrawer.submitHint')}</span>
                  <button
                    onClick={handleSubmitComment}
                    disabled={!commentText.trim() || commentMutation.isPending}
                    className="flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-black hover:bg-accent-hover disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    <Send size={12} />
                    {commentMutation.isPending ? t('issueDrawer.sending') : t('issueDrawer.comment')}
                  </button>
                </div>
              </div>
            </div>

            {/* GitHub Integration */}
            <GitHubSection issueId={issueId} />

            {/* Metadata */}
            <div className="border-t border-border pt-4">
              <label className="flex items-center gap-1.5 text-xs text-muted mb-2">
                <Activity size={12} />
                {t('issueDrawer.activity')}
              </label>
              <div className="space-y-2 text-xs text-muted">
                <div className="flex items-center gap-2">
                  <Calendar size={12} />
                  <span>{t('issueDrawer.createdTime', { time: timeAgo(issue.created_at) })}</span>
                </div>
                <div className="flex items-center gap-2">
                  <Calendar size={12} />
                  <span>{t('issueDrawer.updatedTime', { time: timeAgo(issue.updated_at) })}</span>
                </div>
                {issue.qualified_at && (
                  <div className="flex items-center gap-2">
                    <CheckCircle2 size={12} className="text-green-500" />
                    <span>{t('issueDrawer.qualifiedTime', { time: timeAgo(issue.qualified_at) })}</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Image Lightbox */}
      {lightboxIndex !== null && imageAttachments.length > 0 && (
        <ImageLightbox
          images={imageAttachments.map((a) => ({ url: a.url, name: a.name }))}
          currentIndex={lightboxIndex}
          onClose={() => setLightboxIndex(null)}
          onNavigate={(idx) => setLightboxIndex(idx)}
        />
      )}
    </>
  );
}

/* ── Sub-components ─────────────────────────────── */

function PropertyRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[10px] text-muted uppercase tracking-wider font-medium">
        {label}
      </span>
      <div className="min-h-[32px] flex items-center">{children}</div>
    </div>
  );
}

function DropdownSelect({
  value,
  options,
  onChange,
  renderSelected,
}: {
  value: string;
  options: { key: string; label: string; color: string }[];
  onChange: (key: string) => void;
  renderSelected: () => React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1 rounded-md px-2 py-1 hover:bg-surface-hover transition-colors w-full"
      >
        {renderSelected()}
        <ChevronDown size={12} className="text-muted ml-auto shrink-0" />
      </button>
      {open && (
        <div className="absolute top-full left-0 z-10 mt-1 w-44 rounded-lg border border-border bg-surface py-1 shadow-xl">
          {options.map((opt) => (
            <button
              key={opt.key}
              onClick={() => {
                onChange(opt.key);
                setOpen(false);
              }}
              className={cn(
                'flex w-full items-center gap-2 px-3 py-2 text-sm hover:bg-surface-hover transition-colors',
                value === opt.key ? 'text-primary' : 'text-secondary',
              )}
            >
              <span
                className="h-2 w-2 rounded-full shrink-0"
                style={{ backgroundColor: opt.color }}
              />
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function TldrCard({ tldr }: { tldr: TLDR }) {
  const testColors: Record<string, string> = {
    passed: 'text-green-400',
    failed: 'text-red-400',
    skipped: 'text-yellow-400',
    none: 'text-muted',
  };

  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <Bot size={14} className="text-accent" />
          <span className="text-xs font-medium text-primary">{tldr.agent_name}</span>
        </div>
        <span className="text-[10px] text-muted">{timeAgo(tldr.created_at)}</span>
      </div>
      <p className="text-sm text-primary/90 leading-relaxed mb-3">{tldr.summary}</p>
      <div className="flex items-center gap-3 text-[10px]">
        {tldr.files_changed.length > 0 && (
          <span className="flex items-center gap-1 text-secondary">
            <FileText size={10} />
            {tldr.files_changed.length} files
          </span>
        )}
        <span className={cn('flex items-center gap-1', testColors[tldr.tests_status])}>
          <TestTube2 size={10} />
          {tldr.tests_status}
        </span>
        {tldr.pr_url && (
          <a
            href={tldr.pr_url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 text-accent hover:underline"
          >
            <GitPullRequest size={10} />
            PR
          </a>
        )}
      </div>
    </div>
  );
}

function CommentCard({ comment }: { comment: Comment }) {
  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <div className="h-6 w-6 rounded-full bg-surface-hover flex items-center justify-center text-[9px] font-bold text-secondary">
            {comment.author_name.slice(0, 2).toUpperCase()}
          </div>
          <span className="text-xs font-medium text-primary">{comment.author_name}</span>
        </div>
        <span className="text-[10px] text-muted">{timeAgo(comment.created_at)}</span>
      </div>
      <p className="text-sm text-primary/90 leading-relaxed whitespace-pre-wrap">
        {comment.body}
      </p>
    </div>
  );
}

/* ── Image Lightbox ────────────────────────────── */

function ImageLightbox({
  images,
  currentIndex,
  onClose,
  onNavigate,
}: {
  images: { url: string; name: string }[];
  currentIndex: number;
  onClose: () => void;
  onNavigate: (index: number) => void;
}) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowLeft' && currentIndex > 0) onNavigate(currentIndex - 1);
      if (e.key === 'ArrowRight' && currentIndex < images.length - 1) onNavigate(currentIndex + 1);
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [currentIndex, images.length, onClose, onNavigate]);

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/90 backdrop-blur-sm"
      onClick={onClose}
    >
      <button
        onClick={onClose}
        className="absolute top-4 right-4 rounded-full bg-black/60 p-2 text-white hover:bg-black/80 transition-colors"
      >
        <X size={20} />
      </button>

      {/* Navigation */}
      {currentIndex > 0 && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onNavigate(currentIndex - 1);
          }}
          className="absolute left-4 top-1/2 -translate-y-1/2 rounded-full bg-black/60 p-3 text-white hover:bg-black/80 transition-colors"
        >
          ←
        </button>
      )}
      {currentIndex < images.length - 1 && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onNavigate(currentIndex + 1);
          }}
          className="absolute right-4 top-1/2 -translate-y-1/2 rounded-full bg-black/60 p-3 text-white hover:bg-black/80 transition-colors"
        >
          →
        </button>
      )}

      {/* Image */}
      <img
        src={images[currentIndex].url}
        alt={images[currentIndex].name}
        className="max-h-[90vh] max-w-[90vw] object-contain rounded-lg"
        onClick={(e) => e.stopPropagation()}
      />

      {/* Counter */}
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full bg-black/60 px-3 py-1 text-xs text-white">
        {currentIndex + 1} / {images.length}
      </div>
    </div>
  );
}
