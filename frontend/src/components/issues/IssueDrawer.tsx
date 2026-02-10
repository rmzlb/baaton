import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useUser, useOrganization } from '@clerk/clerk-react';
import DOMPurify from 'dompurify';
import {
  X, ChevronDown, Tag, User, Calendar,
  MessageSquare, Activity, Bot, CheckCircle2, AlertTriangle,
  Minus, ArrowUp, ArrowDown, Bug, Sparkles, Zap, HelpCircle,
  FileText, GitPullRequest, TestTube2, Paperclip, Upload, Image,
  Send, Plus, RotateCw, AlertCircle,
} from 'lucide-react';
import { useIssuesStore } from '@/stores/issues';
import { useNotificationStore } from '@/stores/notifications';
import { useApi } from '@/hooks/useApi';
import { useTranslation } from '@/hooks/useTranslation';
import { useFileUpload, validateFiles } from '@/hooks/useFileUpload';
import type { PendingFile } from '@/hooks/useFileUpload';
import { cn, timeAgo } from '@/lib/utils';
import { NotionEditor } from '@/components/shared/NotionEditor';
import { GitHubSection } from '@/components/github/GitHubSection';
import { ActivityFeed } from '@/components/activity/ActivityFeed';
import { ImageAnnotator } from '@/components/shared/ImageAnnotator';
import { IssueDrawerSkeleton } from '@/components/shared/Skeleton';
import type { Issue, IssueStatus, IssuePriority, IssueType, TLDR, Comment, ProjectStatus, ProjectTag, Attachment, Milestone } from '@/lib/types';

/* ── Constants ─────────────────────────────────── */

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

/* ── Props ─────────────────────────────────────── */

interface IssueDrawerProps {
  issueId: string;
  statuses?: ProjectStatus[];
  projectId?: string;
  onClose: () => void;
}

/* ── Main Component ────────────────────────────── */

export function IssueDrawer({ issueId, statuses, projectId, onClose }: IssueDrawerProps) {
  const { t } = useTranslation();
  const apiClient = useApi();
  const queryClient = useQueryClient();
  const { user } = useUser();
  const { memberships } = useOrganization({ memberships: { infinite: true } });
  const orgMembers = memberships?.data ?? [];
  const updateIssue = useIssuesStore((s) => s.updateIssue);
  const updateIssueOptimistic = useIssuesStore((s) => s.updateIssueOptimistic);
  const restoreIssues = useIssuesStore((s) => s.restoreIssues);
  const addNotification = useNotificationStore((s) => s.addNotification);
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
  const [isDragging, setIsDragging] = useState(false);
  const [annotatingIndex, setAnnotatingIndex] = useState<number | null>(null);
  const dragCounter = useRef(0);

  // ── File upload hook ──
  const { pendingFiles, isUploading, processFiles, retryFile, removePending } = useFileUpload({
    maxAttachments: 10,
    maxDimension: 1920,
    webpQuality: 0.82,
  });

  // ── Queries ──
  const { data: issue, isLoading } = useQuery({
    queryKey: ['issue', issueId],
    queryFn: () => apiClient.issues.get(issueId),
    staleTime: 10_000,
  });

  const resolvedProjectId = projectId || issue?.project_id;
  const { data: projectTags = [] } = useQuery({
    queryKey: ['project-tags', resolvedProjectId],
    queryFn: () => apiClient.tags.listByProject(resolvedProjectId!),
    enabled: !!resolvedProjectId,
  });

  const { data: projectMilestones = [] } = useQuery({
    queryKey: ['milestones', resolvedProjectId],
    queryFn: () => apiClient.milestones.listByProject(resolvedProjectId!),
    enabled: !!resolvedProjectId,
  });

  // ── Mutations ── (with optimistic updates for instant UI feedback)
  const updateMutation = useMutation({
    mutationFn: ({ field, value }: { field: string; value: unknown }) =>
      apiClient.issues.update(issueId, { [field]: value }),
    onMutate: async ({ field, value }) => {
      // Cancel in-flight queries
      await queryClient.cancelQueries({ queryKey: ['issue', issueId] });
      const previousIssue = queryClient.getQueryData<Issue>(['issue', issueId]);
      // Optimistically update the single-issue cache
      queryClient.setQueryData<Issue>(['issue', issueId], (old) =>
        old ? { ...old, [field]: value } : old,
      );
      // Optimistically update the Zustand store (returns snapshot for rollback)
      const previousZustand = updateIssueOptimistic(issueId, { [field]: value } as Partial<Issue>);
      return { previousIssue, previousZustand };
    },
    onError: (_err, _vars, context) => {
      // Roll back react-query cache
      if (context?.previousIssue) {
        queryClient.setQueryData(['issue', issueId], context.previousIssue);
      }
      // Roll back Zustand store
      if (context?.previousZustand) {
        restoreIssues(context.previousZustand);
      }
      // Show error toast
      addNotification({
        type: 'warning',
        title: t('optimistic.updateError'),
        message: t('optimistic.updateErrorDesc'),
      });
    },
    onSuccess: (updated) => {
      updateIssue(issueId, updated);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['issue', issueId] });
      queryClient.invalidateQueries({ queryKey: ['issues'] });
    },
  });

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

  const createTagMutation = useMutation({
    mutationFn: (body: { name: string; color: string }) =>
      apiClient.tags.create(resolvedProjectId!, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['project-tags', resolvedProjectId] });
    },
  });

  // ── Focus trap: focus first focusable element when drawer opens ──
  useEffect(() => {
    if (panelRef.current) {
      const firstFocusable = panelRef.current.querySelector<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      firstFocusable?.focus();
    }
  }, [issueId]);

  // ── Keyboard / Click-outside ──
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (lightboxIndex !== null) {
          setLightboxIndex(null);
        } else {
          onClose();
        }
      }
      // Focus trap: keep Tab within the drawer
      if (e.key === 'Tab' && panelRef.current) {
        const focusableElements = panelRef.current.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        );
        if (focusableElements.length === 0) return;
        const first = focusableElements[0];
        const last = focusableElements[focusableElements.length - 1];
        if (e.shiftKey) {
          if (document.activeElement === first) {
            e.preventDefault();
            last.focus();
          }
        } else {
          if (document.activeElement === last) {
            e.preventDefault();
            first.focus();
          }
        }
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose, lightboxIndex]);

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

  // ── Handlers ──
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

  const handleToggleTag = useCallback(
    (tagName: string) => {
      if (!issue) return;
      const currentTags = issue.tags || [];
      const newTags = currentTags.includes(tagName)
        ? currentTags.filter((t) => t !== tagName)
        : [...currentTags, tagName];
      handleFieldUpdate('tags', newTags);
    },
    [issue, handleFieldUpdate],
  );

  const handleCreateAndAddTag = useCallback(() => {
    if (!newTagName.trim()) return;
    const color = TAG_COLORS[Math.floor(Math.random() * TAG_COLORS.length)];
    createTagMutation.mutate(
      { name: newTagName.trim(), color },
      {
        onSuccess: () => {
          const currentTags = issue?.tags || [];
          if (!currentTags.includes(newTagName.trim())) {
            handleFieldUpdate('tags', [...currentTags, newTagName.trim()]);
          }
          setNewTagName('');
        },
      },
    );
  }, [newTagName, createTagMutation, issue?.tags, handleFieldUpdate]);

  const handleSubmitComment = useCallback(() => {
    if (!commentText.trim()) return;
    commentMutation.mutate(commentText.trim());
  }, [commentText, commentMutation]);

  // ── File upload handler (uses hook) ──
  const handleFileUpload = useCallback(async (files: FileList | File[] | null) => {
    if (!files || files.length === 0 || !issue) return;

    const existingAttachments = issue.attachments || [];
    const fileArray = Array.from(files);

    // Pre-validate for user feedback
    const { valid, errors } = validateFiles(fileArray, existingAttachments.length, 10, 20 * 1024 * 1024, 5 * 1024 * 1024);

    if (errors.length > 0) {
      for (const err of errors) {
        if (err.reason === 'limit') {
          addNotification({ type: 'warning', title: t('upload.limitReached'), message: t('upload.limitReachedDesc', { max: 10 }) });
          break;
        } else if (err.reason === 'size') {
          addNotification({ type: 'warning', title: t('upload.fileTooLarge'), message: err.message });
        } else if (err.reason === 'type') {
          addNotification({ type: 'warning', title: t('upload.unsupportedType'), message: err.message });
        }
      }
    }

    if (valid.length === 0) return;

    // Toast: uploading
    addNotification({ type: 'info', title: t('upload.started'), message: t('upload.startedDesc', { count: valid.length }) });

    try {
      const newAttachments = await processFiles(files, existingAttachments);
      if (newAttachments.length > 0) {
        const allAttachments = [...existingAttachments, ...newAttachments];
        await apiClient.issues.update(issueId, { attachments: allAttachments } as any);
        queryClient.invalidateQueries({ queryKey: ['issue', issueId] });
        addNotification({ type: 'success', title: t('upload.success'), message: t('upload.successDesc', { count: newAttachments.length }) });
      }
    } catch (err) {
      console.error('[Upload] Failed to save attachments:', err);
      addNotification({ type: 'warning', title: t('upload.error'), message: t('upload.errorDesc') });
    }
  }, [issue, issueId, apiClient, queryClient, processFiles, addNotification, t]);

  const handleRetryFile = useCallback(async (fileId: string) => {
    if (!issue) return;
    const existingAttachments = issue.attachments || [];
    const result = await retryFile(fileId, existingAttachments);
    if (result) {
      try {
        const allAttachments = [...existingAttachments, result];
        await apiClient.issues.update(issueId, { attachments: allAttachments } as any);
        queryClient.invalidateQueries({ queryKey: ['issue', issueId] });
        addNotification({ type: 'success', title: t('upload.success'), message: t('upload.successDesc', { count: 1 }) });
      } catch {
        addNotification({ type: 'warning', title: t('upload.error'), message: t('upload.errorDesc') });
      }
    }
  }, [issue, issueId, apiClient, queryClient, retryFile, addNotification, t]);

  // ── Paste handler (skip when focused inside NotionEditor) ──
  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
      if (!panelRef.current) return;
      // Don't intercept pastes in the Notion editor or other contenteditable areas
      const active = document.activeElement;
      if (active) {
        const isEditable = active.getAttribute('contenteditable') === 'true'
          || active.tagName === 'TEXTAREA'
          || active.tagName === 'INPUT'
          || active.closest('[data-notion-editor]')
          || active.closest('.ProseMirror')
          || active.closest('.tiptap');
        if (isEditable) return;
      }

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

  // ── Drag & Drop (with counter to avoid flickering) ──
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

  const handleAnnotationSave = useCallback(async (annotatedBase64: string) => {
    if (!issue || annotatingIndex === null) return;
    const all = [...(issue.attachments || [])];
    const images = all.filter(
      (a) => a.mime_type?.startsWith('image/') || a.url?.startsWith('data:image/'),
    );
    const target = images[annotatingIndex];
    if (target) {
      const idx = all.indexOf(target);
      all[idx] = { ...target, url: annotatedBase64, mime_type: 'image/jpeg' };
      await apiClient.issues.update(issueId, { attachments: all } as any);
      queryClient.invalidateQueries({ queryKey: ['issue', issueId] });
    }
    setAnnotatingIndex(null);
    setLightboxIndex(null);
  }, [issue, annotatingIndex, issueId, apiClient, queryClient]);

  const handleDeleteAttachment = useCallback((attachmentUrl: string, imageIndex?: number) => {
    if (!issue) return;
    const all = issue.attachments || [];
    let next: typeof all;
    if (typeof imageIndex === 'number') {
      // Delete by index within image attachments to handle duplicates correctly
      const images = all.filter((a) => a.mime_type?.startsWith('image/') || a.url?.startsWith('data:image/'));
      const toRemove = images[imageIndex];
      if (!toRemove) return;
      // Find the actual index in the full array (first match by reference)
      const actualIdx = all.indexOf(toRemove);
      next = actualIdx >= 0 ? [...all.slice(0, actualIdx), ...all.slice(actualIdx + 1)] : all;
    } else {
      // Fallback: remove first match by URL (for backward compat)
      const idx = all.findIndex((a) => a.url === attachmentUrl);
      next = idx >= 0 ? [...all.slice(0, idx), ...all.slice(idx + 1)] : all;
    }
    apiClient.issues.update(issueId, { attachments: next } as any).then(() => {
      queryClient.invalidateQueries({ queryKey: ['issue', issueId] });
    });
  }, [issue, issueId, apiClient, queryClient]);

  const handleDeleteNonImageAttachment = useCallback((idx: number) => {
    if (!issue) return;
    const all = issue.attachments || [];
    const nonImages = all.filter((a) => !a.mime_type?.startsWith('image/') && !a.url?.startsWith('data:image/'));
    const toRemove = nonImages[idx];
    const next = all.filter((a) => a !== toRemove);
    apiClient.issues.update(issueId, { attachments: next } as any).then(() => {
      queryClient.invalidateQueries({ queryKey: ['issue', issueId] });
    });
  }, [issue, issueId, apiClient, queryClient]);

  const availableStatuses = statuses ?? STATUS_OPTIONS;

  // Get image attachments for lightbox
  const imageAttachments = useMemo(
    () => (issue?.attachments || []).filter(
      (a) => a.mime_type?.startsWith('image/') || a.url?.startsWith('data:image/'),
    ),
    [issue?.attachments],
  );

  const nonImageAttachments = useMemo(
    () => (issue?.attachments || []).filter(
      (a) => !a.mime_type?.startsWith('image/') && !a.url?.startsWith('data:image/'),
    ),
    [issue?.attachments],
  );

  // ── Loading State ──
  if (isLoading || !issue) {
    return (
      <>
        <div className="fixed inset-0 z-40 bg-black/30 dark:bg-black/40 hidden md:block" aria-hidden="true" onClick={onClose} />
        <div
          ref={panelRef}
          className="fixed inset-0 md:inset-y-0 md:left-auto md:right-0 z-50 w-full md:w-[75vw] md:max-w-5xl bg-bg md:border-l border-border flex flex-col animate-slide-in-right"
        >
          {/* Header skeleton */}
          <div className="flex items-center justify-between border-b border-border px-4 py-2.5 shrink-0">
            <div className="flex items-center gap-2">
              <div className="h-4 w-4 animate-pulse rounded-sm bg-surface-hover" />
              <div className="h-4 w-20 animate-pulse rounded bg-surface-hover" />
            </div>
            <button
              onClick={onClose}
              aria-label="Close issue drawer"
              className="rounded-md p-1 text-secondary hover:bg-surface-hover hover:text-primary transition-colors shrink-0"
            >
              <X size={16} />
            </button>
          </div>
          <IssueDrawerSkeleton />
        </div>
      </>
    );
  }

  const TypeIcon = TYPE_CONFIG[issue.type]?.icon || FileText;
  const typeColor = TYPE_CONFIG[issue.type]?.color || 'text-secondary';
  const currentStatus = availableStatuses.find((s) => s.key === issue.status);
  const currentPriority = PRIORITY_OPTIONS.find((p) => p.key === issue.priority);

  return (
    <>
      {/* Backdrop — hidden on mobile since drawer is full-screen */}
      <div className="fixed inset-0 z-40 bg-black/30 dark:bg-black/40 hidden md:block" aria-hidden="true" onClick={onClose} />

      {/* Panel — full-screen on mobile, side panel on tablet+ */}
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="issue-drawer-title"
        className="fixed inset-0 md:inset-y-0 md:left-auto md:right-0 z-50 w-full md:w-[75vw] md:max-w-5xl bg-bg md:border-l border-border flex flex-col animate-slide-in-right overflow-hidden"
      >
        {/* ── Header ── */}
        <div className="flex items-center justify-between border-b border-border px-4 py-2.5 shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <TypeIcon size={14} className={typeColor} />
            <span className="text-sm font-mono font-semibold text-accent">{issue.display_id}</span>
            <span className="text-[10px] text-muted shrink-0">· {timeAgo(issue.created_at)}</span>
            {(issue.created_by_name || issue.created_by_id) && (
              <div className="flex items-center gap-1.5 shrink-0">
                <span className="text-[10px] text-muted">by</span>
                <div className="h-5 w-5 rounded-full bg-accent/20 border border-accent/30 flex items-center justify-center text-[8px] font-mono font-bold text-accent">
                  {(issue.created_by_name || issue.created_by_id || '?').slice(0, 2).toUpperCase()}
                </div>
                <span className="text-[11px] text-secondary font-medium truncate max-w-[120px]">
                  {issue.created_by_name || issue.created_by_id?.slice(0, 12)}
                </span>
              </div>
            )}
          </div>
          <button
            onClick={onClose}
            aria-label="Close issue drawer"
            className="rounded-md p-1 text-secondary hover:bg-surface-hover hover:text-primary transition-colors shrink-0"
          >
            <X size={16} aria-hidden="true" />
          </button>
        </div>

        {/* ── Body: Two-column layout ── */}
        <div className="flex-1 overflow-y-auto">
          <div className="flex flex-col md:flex-row min-h-full">
            {/* LEFT COLUMN: Title, Description, Comments */}
            <div className="flex-1 min-w-0 p-5 md:p-6 space-y-5 border-b md:border-b-0 md:border-r border-border overflow-y-auto">
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
                    aria-label={t('issueDrawer.editTitle') || 'Edit issue title'}
                    className="w-full bg-transparent text-lg font-semibold text-primary outline-none border-b border-accent pb-1"
                  />
                ) : (
                  <h2
                    id="issue-drawer-title"
                    onClick={() => {
                      setTitleDraft(issue.title);
                      setEditingTitle(true);
                    }}
                    className="text-lg font-semibold text-primary cursor-pointer hover:text-accent transition-colors leading-snug"
                  >
                    {issue.title}
                  </h2>
                )}
              </div>

              {/* Description */}
              <DescriptionView
                description={issue.description}
                editing={editingDescription}
                draft={descriptionDraft}
                onStartEdit={() => {
                  setDescriptionDraft(issue.description || '');
                  setEditingDescription(true);
                }}
                onDraftChange={setDescriptionDraft}
                onSave={handleDescriptionSave}
                onCancel={() => setEditingDescription(false)}
                t={t}
              />

              {/* Divider */}
              <div className="border-t border-border" />

              {/* Comments */}
              <CommentSection
                comments={issue.comments || []}
                commentText={commentText}
                onCommentTextChange={setCommentText}
                onSubmit={handleSubmitComment}
                isPending={commentMutation.isPending}
                t={t}
              />

              {/* GitHub Integration */}
              <GitHubSection issueId={issueId} />

              {/* Activity Feed */}
              <div className="border-t border-border pt-3">
                <label className="flex items-center gap-1.5 text-[10px] text-muted mb-2 uppercase tracking-wider font-medium">
                  <Activity size={10} />
                  {t('issueDrawer.activity')}
                </label>
                {/* Timestamps */}
                <div className="space-y-1.5 text-[11px] text-muted mb-3">
                  <div className="flex items-center gap-1.5">
                    <Calendar size={10} />
                    <span>{t('issueDrawer.createdTime', { time: timeAgo(issue.created_at) })}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Calendar size={10} />
                    <span>{t('issueDrawer.updatedTime', { time: timeAgo(issue.updated_at) })}</span>
                  </div>
                  {issue.qualified_at && (
                    <div className="flex items-center gap-1.5">
                      <CheckCircle2 size={10} className="text-green-500" />
                      <span>{t('issueDrawer.qualifiedTime', { time: timeAgo(issue.qualified_at) })}</span>
                    </div>
                  )}
                </div>
                {/* Activity log timeline */}
                <ActivityFeed issueId={issueId} limit={15} compact />
              </div>
            </div>

            {/* RIGHT COLUMN: Metadata Sidebar */}
            <div className="w-full md:w-56 lg:w-60 shrink-0 p-3 space-y-3 bg-surface/30">
              <MetadataSidebar
                issue={issue}
                availableStatuses={availableStatuses}
                currentStatus={currentStatus}
                currentPriority={currentPriority}
                orgMembers={orgMembers}
                projectTags={projectTags}
                projectMilestones={projectMilestones}
                showTagPicker={showTagPicker}
                setShowTagPicker={setShowTagPicker}
                newTagName={newTagName}
                setNewTagName={setNewTagName}
                showAssigneePicker={showAssigneePicker}
                setShowAssigneePicker={setShowAssigneePicker}
                editingDueDate={editingDueDate}
                setEditingDueDate={setEditingDueDate}
                onFieldUpdate={handleFieldUpdate}
                onToggleTag={handleToggleTag}
                onCreateAndAddTag={handleCreateAndAddTag}
                t={t}
              />

              {/* Divider */}
              <div className="border-t border-border" />

              {/* Attachments */}
              <AttachmentSection
                imageAttachments={imageAttachments}
                nonImageAttachments={nonImageAttachments}
                pendingFiles={pendingFiles}
                isUploading={isUploading}
                isDragging={isDragging}
                onDragEnter={handleDragEnter}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                onFileUpload={handleFileUpload}
                onDeleteImage={handleDeleteAttachment}
                onDeleteNonImage={handleDeleteNonImageAttachment}
                onRetryFile={handleRetryFile}
                onRemovePending={removePending}
                onLightbox={setLightboxIndex}
                t={t}
              />

              {/* Divider */}
              <div className="border-t border-border" />

              {/* TLDRs */}
              {issue.tldrs && issue.tldrs.length > 0 && (
                <div>
                  <label className="flex items-center gap-1.5 text-[10px] text-muted mb-2 uppercase tracking-wider font-medium">
                    <Bot size={10} />
                    {t('issueDrawer.agentTldrs')}
                  </label>
                  <div className="space-y-2">
                    {issue.tldrs.map((tldr: TLDR) => (
                      <TldrCard key={tldr.id} tldr={tldr} />
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Image Lightbox */}
      {lightboxIndex !== null && imageAttachments.length > 0 && annotatingIndex === null && (
        <ImageLightbox
          images={imageAttachments.map((a) => ({ url: a.url, name: a.name }))}
          currentIndex={lightboxIndex}
          onClose={() => setLightboxIndex(null)}
          onNavigate={setLightboxIndex}
          onAnnotate={(idx) => setAnnotatingIndex(idx)}
        />
      )}

      {/* Image Annotator */}
      {annotatingIndex !== null && imageAttachments[annotatingIndex] && (
        <ImageAnnotator
          imageUrl={imageAttachments[annotatingIndex].url}
          imageName={imageAttachments[annotatingIndex].name}
          onSave={handleAnnotationSave}
          onClose={() => setAnnotatingIndex(null)}
        />
      )}
    </>
  );
}

/* ═══════════════════════════════════════════════════
   Sub-components
   ═══════════════════════════════════════════════════ */

/* ── Loading Skeleton ─────────────────────────── */

function LoadingSkeleton() {
  return (
    <div className="p-4 space-y-4 animate-pulse">
      {/* Header skeleton */}
      <div className="flex items-center gap-2">
        <div className="h-4 w-16 rounded bg-surface-hover" />
        <div className="h-4 w-32 rounded bg-surface-hover" />
      </div>
      {/* Title skeleton */}
      <div className="h-6 w-3/4 rounded bg-surface-hover" />
      {/* Two-column skeleton */}
      <div className="flex gap-4">
        <div className="flex-1 space-y-3">
          <div className="h-4 w-full rounded bg-surface-hover" />
          <div className="h-4 w-5/6 rounded bg-surface-hover" />
          <div className="h-4 w-2/3 rounded bg-surface-hover" />
          <div className="h-24 w-full rounded bg-surface-hover" />
        </div>
        <div className="w-56 space-y-3">
          <div className="h-4 w-full rounded bg-surface-hover" />
          <div className="h-4 w-full rounded bg-surface-hover" />
          <div className="h-4 w-3/4 rounded bg-surface-hover" />
          <div className="h-4 w-full rounded bg-surface-hover" />
          <div className="h-4 w-2/3 rounded bg-surface-hover" />
        </div>
      </div>
    </div>
  );
}

/* ── Description View ─────────────────────────── */

interface DescriptionViewProps {
  description: string | null;
  editing: boolean;
  draft: string;
  onStartEdit: () => void;
  onDraftChange: (v: string) => void;
  onSave: () => void;
  onCancel: () => void;
  t: (key: string, vars?: Record<string, string | number>) => string;
}

function DescriptionView({ description, editing, draft, onStartEdit, onDraftChange, onSave, onCancel, t }: DescriptionViewProps) {
  if (editing) {
    return (
      <div>
        <label className="flex items-center gap-1.5 text-[10px] text-muted mb-1.5 uppercase tracking-wider font-medium">
          <FileText size={10} />
          {t('issueDrawer.description')}
        </label>
        <div className="rounded-lg bg-surface border border-border overflow-hidden">
          <div className="min-h-[160px]">
            <NotionEditor
              initialContent={draft}
              onChange={onDraftChange}
              placeholder={t('issueDrawer.descriptionPlaceholder')}
            />
          </div>
          <div className="flex items-center justify-between border-t border-border px-3 py-1.5">
            <button
              onClick={onCancel}
              className="text-[11px] text-muted hover:text-primary transition-colors"
            >
              {t('common.cancel')}
            </button>
            <button
              onClick={onSave}
              className="rounded-md bg-accent px-2.5 py-1 text-[11px] font-medium text-black hover:bg-accent-hover transition-colors"
            >
              {t('issueDrawer.descriptionSave')}
            </button>
          </div>
        </div>
      </div>
    );
  }

  const hasHtml = description && description.trim().startsWith('<');

  return (
    <div>
      <label className="flex items-center gap-1.5 text-[10px] text-muted mb-1.5 uppercase tracking-wider font-medium">
        <FileText size={10} />
        {t('issueDrawer.description')}
        <span className="text-[9px] text-muted/50 ml-1 normal-case tracking-normal">{t('issueDrawer.descriptionEdit')}</span>
      </label>
      {description ? (
        <div
          onDoubleClick={onStartEdit}
          className="rounded-lg bg-surface border border-border p-4 cursor-text hover:border-accent/30 transition-colors min-h-[80px]"
        >
          {hasHtml ? (
            <div
              className="prose prose-xs dark:prose-invert prose-headings:text-primary prose-p:text-secondary prose-li:text-secondary prose-a:text-accent max-w-none text-[11px] leading-relaxed"
              dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(description) }}
            />
          ) : (
            <NotionEditor
              initialContent={description}
              editable={false}
            />
          )}
        </div>
      ) : (
        <p
          className="text-xs text-muted italic cursor-pointer hover:text-accent transition-colors py-2"
          onDoubleClick={onStartEdit}
        >
          {t('issueDrawer.noDescription')}
        </p>
      )}
    </div>
  );
}

/* ── Metadata Sidebar ─────────────────────────── */

interface MetadataSidebarProps {
  issue: Issue;
  availableStatuses: ProjectStatus[] | typeof STATUS_OPTIONS;
  currentStatus: ProjectStatus | { key: string; label: string; color: string } | undefined;
  currentPriority: (typeof PRIORITY_OPTIONS)[number] | undefined;
  orgMembers: any[];
  projectTags: ProjectTag[];
  projectMilestones: Milestone[];
  showTagPicker: boolean;
  setShowTagPicker: (v: boolean) => void;
  newTagName: string;
  setNewTagName: (v: string) => void;
  showAssigneePicker: boolean;
  setShowAssigneePicker: (v: boolean) => void;
  editingDueDate: boolean;
  setEditingDueDate: (v: boolean) => void;
  onFieldUpdate: (field: string, value: unknown) => void;
  onToggleTag: (tagName: string) => void;
  onCreateAndAddTag: () => void;
  t: (key: string, vars?: Record<string, string | number>) => string;
}

function MetadataSidebar({
  issue,
  availableStatuses,
  currentStatus,
  currentPriority,
  orgMembers,
  projectTags,
  projectMilestones,
  showTagPicker,
  setShowTagPicker,
  newTagName,
  setNewTagName,
  showAssigneePicker,
  setShowAssigneePicker,
  editingDueDate,
  setEditingDueDate,
  onFieldUpdate,
  onToggleTag,
  onCreateAndAddTag,
  t,
}: MetadataSidebarProps) {
  const [showMilestonePicker, setShowMilestonePicker] = useState(false);
  const TypeIcon = TYPE_CONFIG[issue.type]?.icon || FileText;
  const typeColor = TYPE_CONFIG[issue.type]?.color || 'text-secondary';

  return (
    <>
      {/* Status */}
      <SidebarField label={t('issueDrawer.status')}>
        <DropdownSelect
          value={issue.status}
          options={availableStatuses.map((s) => ({
            key: s.key,
            label: s.label,
            color: s.color,
          }))}
          onChange={(v) => onFieldUpdate('status', v)}
          renderSelected={() => (
            <span className="flex items-center gap-1.5">
              <span
                className="h-2 w-2 rounded-full shrink-0"
                style={{ backgroundColor: currentStatus?.color }}
              />
              <span className="text-xs text-primary truncate">
                {currentStatus?.label || issue.status}
              </span>
            </span>
          )}
        />
      </SidebarField>

      {/* Priority */}
      <SidebarField label={t('issueDrawer.priority')}>
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
          onChange={(v) => onFieldUpdate('priority', v || null)}
          renderSelected={() => (
            <span className="flex items-center gap-1.5">
              {currentPriority ? (
                <>
                  <currentPriority.icon size={12} style={{ color: currentPriority.color }} />
                  <span className="text-xs text-primary">{currentPriority.label}</span>
                </>
              ) : (
                <span className="text-xs text-muted">{t('issueDrawer.none')}</span>
              )}
            </span>
          )}
        />
      </SidebarField>

      {/* Type */}
      <SidebarField label={t('issueDrawer.type')}>
        <span className="flex items-center gap-1.5 px-1.5 py-0.5">
          <TypeIcon size={12} className={typeColor} />
          <span className="text-xs text-primary">
            {TYPE_CONFIG[issue.type]?.label || issue.type}
          </span>
        </span>
      </SidebarField>

      {/* Source */}
      <SidebarField label={t('issueDrawer.source')}>
        <span className="text-xs text-secondary capitalize px-1.5 py-0.5">{issue.source}</span>
      </SidebarField>

      {/* Milestone */}
      <MilestonePicker
        issue={issue}
        milestones={projectMilestones}
        showPicker={showMilestonePicker}
        setShowPicker={setShowMilestonePicker}
        onFieldUpdate={onFieldUpdate}
        t={t}
      />

      {/* Divider */}
      <div className="border-t border-border" />

      {/* Assignees */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-[10px] text-muted uppercase tracking-wider font-medium flex items-center gap-1">
            <User size={10} />
            {t('issueDrawer.assignees')}
          </span>
          <button
            onClick={() => setShowAssigneePicker(!showAssigneePicker)}
            className="text-accent hover:text-accent-hover transition-colors"
          >
            <Plus size={12} />
          </button>
        </div>
        {issue.assignee_ids.length > 0 ? (
          <div className="flex flex-wrap gap-1">
            {issue.assignee_ids.map((id) => {
              const member = orgMembers.find(
                (m: any) => m.publicUserData?.userId === id,
              );
              const name = member
                ? `${member.publicUserData?.firstName || ''} ${member.publicUserData?.lastName || ''}`.trim()
                : id.slice(0, 12);
              return (
                <span
                  key={id}
                  className="inline-flex items-center gap-1 rounded-full bg-surface-hover border border-border px-2 py-0.5 text-[11px] text-secondary group/assignee"
                >
                  <div className="h-4 w-4 rounded-full bg-accent/20 flex items-center justify-center text-[7px] font-mono font-bold text-accent">
                    {name.slice(0, 2).toUpperCase()}
                  </div>
                  <span className="truncate max-w-[80px]">{name}</span>
                  <button
                    onClick={() => {
                      const next = issue.assignee_ids.filter((a) => a !== id);
                      onFieldUpdate('assignee_ids', next);
                    }}
                    className="text-muted hover:text-red-400 opacity-0 group-hover/assignee:opacity-100 transition-opacity"
                  >
                    <X size={10} />
                  </button>
                </span>
              );
            })}
          </div>
        ) : (
          <button
            onClick={() => setShowAssigneePicker(!showAssigneePicker)}
            className="text-[11px] text-muted hover:text-secondary transition-colors"
          >
            {t('issueDrawer.assigneeNone')}
          </button>
        )}
        {showAssigneePicker && (
          <div className="mt-1.5 rounded-lg border border-border bg-surface p-1.5 max-h-40 overflow-y-auto">
            {orgMembers.length > 0 ? orgMembers.map((m: any) => {
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
                    onFieldUpdate('assignee_ids', next);
                  }}
                  className={cn(
                    'flex items-center gap-1.5 w-full rounded-md px-2 py-1 text-[11px] transition-colors',
                    isAssigned
                      ? 'bg-accent/10 text-accent'
                      : 'text-secondary hover:bg-surface-hover',
                  )}
                >
                  <div className="h-4 w-4 rounded-full bg-surface-hover flex items-center justify-center text-[7px] font-mono font-bold">
                    {name.slice(0, 2).toUpperCase()}
                  </div>
                  <span className="flex-1 text-left truncate">{name}</span>
                  {isAssigned && <CheckCircle2 size={12} className="text-accent" />}
                </button>
              );
            }) : (
              <p className="text-[11px] text-muted px-2 py-1.5">{t('issueDrawer.noMembers')}</p>
            )}
          </div>
        )}
      </div>

      {/* Due Date */}
      <div>
        <span className="text-[10px] text-muted uppercase tracking-wider font-medium flex items-center gap-1 mb-1.5">
          <Calendar size={10} />
          {t('issueDrawer.dueDate')}
        </span>
        {editingDueDate || issue.due_date ? (
          <div className="flex items-center gap-1.5">
            <input
              type="date"
              value={issue.due_date ? issue.due_date.slice(0, 10) : ''}
              onChange={(e) => {
                const val = e.target.value;
                onFieldUpdate('due_date', val || null);
                if (!val) setEditingDueDate(false);
              }}
              aria-label={t('issueDrawer.dueDate') || 'Due date'}
              className="rounded-md border border-border bg-surface px-2 py-1 text-[11px] text-primary outline-none focus:border-accent transition-colors w-full"
            />
            {issue.due_date && (
              <button
                onClick={() => {
                  onFieldUpdate('due_date', null);
                  setEditingDueDate(false);
                }}
                className="text-muted hover:text-red-400 transition-colors shrink-0"
              >
                <X size={12} />
              </button>
            )}
          </div>
        ) : (
          <button
            onClick={() => setEditingDueDate(true)}
            className="text-[11px] text-muted hover:text-secondary transition-colors"
          >
            {t('issueDrawer.dueDateNone')}
          </button>
        )}
        {issue.due_date && (() => {
          const due = new Date(issue.due_date);
          const now = new Date();
          const diffDays = Math.ceil((due.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
          if (diffDays < 0) return <span className="text-[10px] text-red-400 mt-0.5 block">{t('issueDrawer.dueDateOverdue')}</span>;
          if (diffDays <= 3) return <span className="text-[10px] text-amber-400 mt-0.5 block">{t('issueDrawer.dueDateSoon', { days: diffDays })}</span>;
          return null;
        })()}
      </div>

      {/* Divider */}
      <div className="border-t border-border" />

      {/* Tags */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-[10px] text-muted uppercase tracking-wider font-medium flex items-center gap-1">
            <Tag size={10} />
            {t('issueDrawer.tags')}
          </span>
        </div>
        <div className="flex flex-wrap gap-1">
          {issue.tags.map((tag) => {
            const tagObj = projectTags.find((pt) => pt.name === tag);
            const color = tagObj?.color || '#6b7280';
            return (
              <span
                key={tag}
                className="rounded-full px-2 py-0.5 text-[10px] font-medium border cursor-pointer hover:opacity-80 transition-opacity"
                style={{
                  backgroundColor: `${color}20`,
                  borderColor: `${color}40`,
                  color: color,
                }}
                onClick={() => onToggleTag(tag)}
                title={t('issueDrawer.removeTag')}
              >
                <span className="inline-block h-1.5 w-1.5 rounded-full mr-1" style={{ backgroundColor: color }} />
                {tag} ×
              </span>
            );
          })}
          <button
            onClick={() => setShowTagPicker(!showTagPicker)}
            className="rounded-full border border-dashed border-border px-2 py-0.5 text-[10px] text-muted hover:border-accent hover:text-accent transition-colors"
          >
            <Plus size={8} className="inline mr-0.5" />
            {t('issueDrawer.addTag')}
          </button>
        </div>

        {showTagPicker && (
          <div className="mt-1.5 rounded-lg border border-border bg-surface p-1.5 max-h-40 overflow-y-auto">
            {projectTags
              .filter((pt) => !issue.tags.includes(pt.name))
              .map((tag) => (
                <button
                  key={tag.id}
                  onClick={() => {
                    onToggleTag(tag.name);
                    setShowTagPicker(false);
                  }}
                  className="flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-[11px] text-secondary hover:bg-surface-hover transition-colors"
                >
                  <span
                    className="h-2.5 w-2.5 rounded-full shrink-0"
                    style={{ backgroundColor: tag.color }}
                  />
                  {tag.name}
                </button>
              ))}
            <div className="flex items-center gap-1.5 mt-1 pt-1 border-t border-border">
              <input
                type="text"
                value={newTagName}
                onChange={(e) => setNewTagName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') onCreateAndAddTag();
                }}
                placeholder={t('issueDrawer.newTagPlaceholder')}
                aria-label={t('issueDrawer.newTagPlaceholder') || 'New tag name'}
                className="flex-1 bg-transparent text-[11px] text-primary outline-none placeholder-muted px-1.5 py-0.5"
              />
              <button
                onClick={onCreateAndAddTag}
                disabled={!newTagName.trim()}
                className="rounded-md px-2 py-0.5 text-[10px] bg-accent text-black font-medium disabled:opacity-40 hover:bg-accent-hover transition-colors"
              >
                {t('issueDrawer.createTag')}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Category */}
      {issue.category && issue.category.length > 0 && (
        <div>
          <span className="text-[10px] text-muted uppercase tracking-wider font-medium mb-1.5 block">
            {t('issueDrawer.category')}
          </span>
          <div className="flex flex-wrap gap-1">
            {issue.category.map((cat) => (
              <span
                key={cat}
                className="rounded-md bg-surface-hover border border-border px-2 py-0.5 text-[10px] text-secondary font-medium"
              >
                {cat}
              </span>
            ))}
          </div>
        </div>
      )}
    </>
  );
}

/* ── Sidebar Field ────────────────────────────── */

function SidebarField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <span className="text-[10px] text-muted uppercase tracking-wider font-medium block mb-1">
        {label}
      </span>
      <div className="min-h-[24px] flex items-center">{children}</div>
    </div>
  );
}

/* ── Attachment Section ───────────────────────── */

interface AttachmentSectionProps {
  imageAttachments: Attachment[];
  nonImageAttachments: Attachment[];
  pendingFiles: PendingFile[];
  isUploading: boolean;
  isDragging: boolean;
  onDragEnter: (e: React.DragEvent) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDragLeave: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
  onFileUpload: (files: FileList | File[] | null) => void;
  onDeleteImage: (url: string) => void;
  onDeleteNonImage: (idx: number) => void;
  onRetryFile: (fileId: string) => void;
  onRemovePending: (fileId: string) => void;
  onLightbox: (idx: number) => void;
  t: (key: string, vars?: Record<string, string | number>) => string;
}

function AttachmentSection({
  imageAttachments,
  nonImageAttachments,
  pendingFiles,
  isUploading,
  isDragging,
  onDragEnter,
  onDragOver,
  onDragLeave,
  onDrop,
  onFileUpload,
  onDeleteImage,
  onDeleteNonImage,
  onRetryFile,
  onRemovePending,
  onLightbox,
  t,
}: AttachmentSectionProps) {
  const pendingImageFiles = pendingFiles.filter(
    (f) => f.mime.startsWith('image/') || f.previewUrl !== null,
  );
  const pendingNonImageFiles = pendingFiles.filter(
    (f) => !f.mime.startsWith('image/') && f.previewUrl === null,
  );

  return (
    <div
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      className="relative"
    >
      <label className="flex items-center gap-1.5 text-[10px] text-muted mb-1.5 uppercase tracking-wider font-medium">
        <Paperclip size={10} />
        {t('issueDrawer.attachments')}
        {imageAttachments.length + nonImageAttachments.length > 0 && (
          <span className="text-[9px] text-muted/70 ml-0.5">
            ({imageAttachments.length + nonImageAttachments.length}/10)
          </span>
        )}
        <span className="text-[9px] text-muted/50 ml-1 normal-case tracking-normal">⌘V {t('issueDrawer.pasteHint')}</span>
      </label>

      {/* Drag overlay */}
      {isDragging && (
        <div className="absolute inset-0 z-20 rounded-lg border-2 border-dashed border-accent bg-accent/10 backdrop-blur-[2px] flex flex-col items-center justify-center gap-1.5 pointer-events-none"
          style={{ animation: 'pulse 1.5s ease-in-out infinite' }}
        >
          <Upload size={20} className="text-accent" />
          <span className="text-xs font-medium text-accent">{t('upload.dropZone')}</span>
        </div>
      )}

      {/* Image thumbnails grid (existing + pending) */}
      {(imageAttachments.length > 0 || pendingImageFiles.length > 0) && (
        <div className="grid grid-cols-3 gap-1.5 mb-1.5">
          {/* Existing saved images */}
          {imageAttachments.map((att, idx) => (
            <div key={`saved-${idx}`} className="group relative aspect-square rounded-md border border-border overflow-hidden hover:border-accent transition-colors">
              <button
                onClick={() => onLightbox(idx)}
                className="h-full w-full"
              >
                <img
                  src={att.url}
                  alt={att.name}
                  className="h-full w-full object-cover"
                  loading="lazy"
                  onError={(e) => {
                    const target = e.currentTarget;
                    target.style.display = 'none';
                    const placeholder = target.parentElement?.querySelector('.img-placeholder');
                    if (placeholder) (placeholder as HTMLElement).style.display = 'flex';
                  }}
                />
                <div className="img-placeholder hidden h-full w-full items-center justify-center bg-surface flex-col gap-1">
                  <Image size={16} className="text-muted" />
                  <span className="text-[9px] text-muted text-center px-1 truncate max-w-full">{att.name || 'Image'}</span>
                </div>
                <div className="absolute inset-0 bg-black/30 dark:bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                  <Image size={14} className="text-white" />
                </div>
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onDeleteImage(att.url);
                }}
                className="absolute top-0.5 right-0.5 rounded-full bg-black/60 p-0.5 text-white opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-500/80"
              >
                <X size={10} />
              </button>
              <span className="absolute bottom-0.5 left-0.5 rounded bg-black/60 px-1 py-0.5 text-[8px] text-white font-mono opacity-0 group-hover:opacity-100 transition-opacity">
                {att.size > 1024 * 1024 ? `${(att.size / (1024 * 1024)).toFixed(1)}MB` : `${Math.round(att.size / 1024)}KB`}
              </span>
            </div>
          ))}

          {/* Pending image uploads (optimistic preview) */}
          {pendingImageFiles.map((pf) => (
            <div key={pf.id} className="relative aspect-square rounded-md border border-border overflow-hidden">
              {/* Preview image */}
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

              {/* Status overlay */}
              {pf.status !== 'done' && (
                <div className="absolute inset-0 bg-black/40 flex flex-col items-center justify-center gap-1">
                  {pf.status === 'error' ? (
                    <>
                      <AlertCircle size={14} className="text-red-400" />
                      <button
                        onClick={() => onRetryFile(pf.id)}
                        className="flex items-center gap-0.5 rounded bg-white/20 px-1.5 py-0.5 text-[9px] text-white hover:bg-white/30 transition-colors"
                      >
                        <RotateCw size={8} />
                        {t('upload.retry')}
                      </button>
                      <button
                        onClick={() => onRemovePending(pf.id)}
                        className="rounded bg-red-500/60 px-1.5 py-0.5 text-[9px] text-white hover:bg-red-500/80 transition-colors"
                      >
                        <X size={8} />
                      </button>
                    </>
                  ) : (
                    <>
                      {/* Spinner */}
                      <div className="h-5 w-5 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                      <span className="text-[9px] text-white/80 font-medium">
                        {pf.status === 'compressing' ? t('upload.compressing') : t('upload.saving')}
                      </span>
                    </>
                  )}
                </div>
              )}

              {/* Progress bar */}
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
        <div key={idx} className="group flex items-center gap-1.5 rounded-md bg-surface border border-border px-2 py-1.5 mb-1">
          <FileText size={10} className="text-secondary shrink-0" />
          <span className="text-[11px] text-secondary truncate flex-1">{att.name}</span>
          <span className="text-[9px] text-muted shrink-0">
            {att.size > 1024 * 1024 ? `${(att.size / (1024 * 1024)).toFixed(1)}MB` : `${Math.round(att.size / 1024)}KB`}
          </span>
          <button
            onClick={() => onDeleteNonImage(idx)}
            className="text-muted hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
          >
            <X size={10} />
          </button>
        </div>
      ))}

      {/* Pending non-image files */}
      {pendingNonImageFiles.map((pf) => (
        <div key={pf.id} className="flex items-center gap-1.5 rounded-md bg-surface border border-border px-2 py-1.5 mb-1">
          <FileText size={10} className="text-secondary shrink-0" />
          <span className="text-[11px] text-secondary truncate flex-1">{pf.name}</span>
          {pf.status === 'error' ? (
            <button onClick={() => onRetryFile(pf.id)} className="text-[9px] text-accent hover:underline">
              {t('upload.retry')}
            </button>
          ) : pf.status !== 'done' ? (
            <div className="h-2.5 w-2.5 rounded-full border-2 border-accent border-t-transparent animate-spin shrink-0" />
          ) : null}
        </div>
      ))}

      {/* Upload area */}
      <label className={cn(
        'flex flex-col items-center justify-center gap-0.5 rounded-md border border-dashed p-2.5 text-[11px] cursor-pointer transition-all mt-1',
        'border-border text-muted hover:border-accent hover:text-accent',
      )}>
        <Upload size={14} />
        <span className="text-center">{t('issueDrawer.dropFiles')}</span>
        <span className="text-[9px] text-muted/50">{t('issueDrawer.uploadHint')}</span>
        <input
          type="file"
          multiple
          accept="image/*,.pdf,.doc,.docx,.txt,.heic,.heif"
          className="hidden"
          aria-label={t('issueDrawer.dropFiles') || 'Upload files'}
          onChange={(e) => onFileUpload(e.target.files)}
        />
      </label>
    </div>
  );
}

/* ── Comment Section ──────────────────────────── */

interface CommentSectionProps {
  comments: Comment[];
  commentText: string;
  onCommentTextChange: (v: string) => void;
  onSubmit: () => void;
  isPending: boolean;
  t: (key: string, vars?: Record<string, string | number>) => string;
}

function CommentSection({ comments, commentText, onCommentTextChange, onSubmit, isPending, t }: CommentSectionProps) {
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        onSubmit();
      }
    },
    [onSubmit],
  );

  return (
    <div>
      <label className="flex items-center gap-1.5 text-[10px] text-muted mb-2 uppercase tracking-wider font-medium">
        <MessageSquare size={10} />
        {t('issueDrawer.commentCount', { count: comments.length })}
      </label>
      <div className="space-y-2">
        {comments.map((comment: Comment) => (
          <CommentCard key={comment.id} comment={comment} />
        ))}
      </div>

      {/* Comment input */}
      <div className="mt-2 rounded-lg border border-border bg-surface p-2.5">
        <textarea
          value={commentText}
          onChange={(e) => onCommentTextChange(e.target.value)}
          placeholder={t('issueDrawer.addComment')}
          aria-label={t('issueDrawer.addComment') || 'Write a comment'}
          rows={2}
          className="w-full bg-transparent text-xs text-primary placeholder-muted outline-none resize-none"
          onKeyDown={handleKeyDown}
        />
        <div className="flex items-center justify-between mt-1.5 pt-1.5 border-t border-border">
          <span className="text-[9px] text-muted">{t('issueDrawer.submitHint')}</span>
          <button
            onClick={onSubmit}
            disabled={!commentText.trim() || isPending}
            className="flex items-center gap-1 rounded-md bg-accent px-2.5 py-1 text-[11px] font-medium text-black hover:bg-accent-hover disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            <Send size={10} />
            {isPending ? t('issueDrawer.sending') : t('issueDrawer.comment')}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Dropdown Select ──────────────────────────── */

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
    <div ref={ref} className="relative w-full">
      <button
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-haspopup="listbox"
        className="flex items-center gap-1 rounded-md px-1.5 py-0.5 hover:bg-surface-hover transition-colors w-full"
      >
        {renderSelected()}
        <ChevronDown size={10} className="text-muted ml-auto shrink-0" aria-hidden="true" />
      </button>
      {open && (
        <div role="listbox" className="absolute top-full left-0 z-10 mt-1 w-40 rounded-lg border border-border bg-surface py-0.5 shadow-xl">
          {options.map((opt) => (
            <button
              key={opt.key}
              role="option"
              aria-selected={value === opt.key}
              onClick={() => {
                onChange(opt.key);
                setOpen(false);
              }}
              className={cn(
                'flex w-full items-center gap-1.5 px-2.5 py-1.5 text-xs hover:bg-surface-hover transition-colors',
                value === opt.key ? 'text-primary' : 'text-secondary',
              )}
            >
              <span
                className="h-2 w-2 rounded-full shrink-0"
                style={{ backgroundColor: opt.color }}
                aria-hidden="true"
              />
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ── TLDR Card ────────────────────────────────── */

function TldrCard({ tldr }: { tldr: TLDR }) {
  const testColors: Record<string, string> = {
    passed: 'text-green-400',
    failed: 'text-red-400',
    skipped: 'text-yellow-400',
    none: 'text-muted',
  };

  return (
    <div className="rounded-md border border-border bg-surface p-2.5">
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-1.5">
          <Bot size={12} className="text-accent" />
          <span className="text-[11px] font-medium text-primary">{tldr.agent_name}</span>
        </div>
        <span className="text-[9px] text-muted">{timeAgo(tldr.created_at)}</span>
      </div>
      <p className="text-xs text-primary/90 leading-relaxed mb-2">{tldr.summary}</p>
      <div className="flex items-center gap-2.5 text-[9px]">
        {tldr.files_changed.length > 0 && (
          <span className="flex items-center gap-0.5 text-secondary">
            <FileText size={9} />
            {tldr.files_changed.length} files
          </span>
        )}
        <span className={cn('flex items-center gap-0.5', testColors[tldr.tests_status])}>
          <TestTube2 size={9} />
          {tldr.tests_status}
        </span>
        {tldr.pr_url && (
          <a
            href={tldr.pr_url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-0.5 text-accent hover:underline"
          >
            <GitPullRequest size={9} />
            PR
          </a>
        )}
      </div>
    </div>
  );
}

/* ── Comment Card ─────────────────────────────── */

function CommentCard({ comment }: { comment: Comment }) {
  return (
    <div className="rounded-md border border-border bg-surface p-2.5">
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-1.5">
          <div className="h-5 w-5 rounded-full bg-surface-hover flex items-center justify-center text-[8px] font-bold text-secondary">
            {comment.author_name.slice(0, 2).toUpperCase()}
          </div>
          <span className="text-[11px] font-medium text-primary">{comment.author_name}</span>
        </div>
        <span className="text-[9px] text-muted">{timeAgo(comment.created_at)}</span>
      </div>
      <p className="text-xs text-primary/90 leading-relaxed whitespace-pre-wrap">
        {comment.body}
      </p>
    </div>
  );
}

/* ── Milestone Picker (with mini progress bars) ── */

function MilestonePicker({
  issue,
  milestones,
  showPicker,
  setShowPicker,
  onFieldUpdate,
  t,
}: {
  issue: Issue;
  milestones: Milestone[];
  showPicker: boolean;
  setShowPicker: (v: boolean) => void;
  onFieldUpdate: (field: string, value: unknown) => void;
  t: (key: string, vars?: Record<string, string | number>) => string;
}) {
  // Get all issues from the Zustand store to compute per-milestone progress
  const allIssues = useIssuesStore((s) => s.issues);
  const issuesList = useMemo(() => Object.values(allIssues), [allIssues]);

  const milestoneStats = useMemo(() => {
    const stats: Record<string, { done: number; total: number }> = {};
    for (const m of milestones) {
      const mIssues = issuesList.filter((i) => i.milestone_id === m.id);
      const done = mIssues.filter((i) => i.status === 'done').length;
      stats[m.id] = { done, total: mIssues.length };
    }
    return stats;
  }, [milestones, issuesList]);

  const currentMilestone = milestones.find((m) => m.id === issue.milestone_id);
  const currentStats = currentMilestone ? milestoneStats[currentMilestone.id] : null;

  return (
    <div>
      <span className="text-[10px] text-muted uppercase tracking-wider font-medium block mb-1">
        {t('milestones.assignMilestone')}
      </span>
      <div className="relative w-full">
        <button
          onClick={() => setShowPicker(!showPicker)}
          className="flex items-center gap-1.5 rounded-md px-1.5 py-0.5 hover:bg-surface-hover transition-colors w-full min-h-[24px]"
        >
          {currentMilestone ? (
            <div className="flex items-center gap-1.5 flex-1 min-w-0">
              <span
                className={cn(
                  'h-1.5 w-1.5 rounded-full shrink-0',
                  currentMilestone.status === 'active' ? 'bg-blue-500' : currentMilestone.status === 'completed' ? 'bg-emerald-500' : 'bg-gray-400',
                )}
              />
              <span className="text-xs text-primary truncate flex-1">{currentMilestone.name}</span>
              {currentStats && currentStats.total > 0 && (
                <span className="text-[9px] text-muted tabular-nums shrink-0">
                  {currentStats.done}/{currentStats.total}
                </span>
              )}
            </div>
          ) : (
            <span className="text-xs text-muted">{t('milestones.noneMilestone')}</span>
          )}
          <ChevronDown size={10} className="text-muted ml-auto shrink-0" />
        </button>
        {showPicker && (
          <div className="absolute top-full left-0 z-10 mt-1 w-52 rounded-lg border border-border bg-surface py-0.5 shadow-xl max-h-48 overflow-y-auto">
            {/* None option */}
            <button
              onClick={() => {
                onFieldUpdate('milestone_id', null);
                setShowPicker(false);
              }}
              className={cn(
                'flex w-full items-center gap-1.5 px-2.5 py-1.5 text-xs hover:bg-surface-hover transition-colors',
                !issue.milestone_id ? 'text-primary' : 'text-secondary',
              )}
            >
              {t('milestones.noneMilestone')}
            </button>
            {milestones.map((m) => {
              const stats = milestoneStats[m.id] || { done: 0, total: 0 };
              const pct = stats.total > 0 ? Math.round((stats.done / stats.total) * 100) : 0;
              const isSelected = issue.milestone_id === m.id;
              return (
                <button
                  key={m.id}
                  onClick={() => {
                    onFieldUpdate('milestone_id', m.id);
                    setShowPicker(false);
                  }}
                  className={cn(
                    'flex w-full items-center gap-1.5 px-2.5 py-2 text-xs hover:bg-surface-hover transition-colors',
                    isSelected ? 'text-primary bg-surface-hover/50' : 'text-secondary',
                  )}
                >
                  <span
                    className={cn(
                      'h-1.5 w-1.5 rounded-full shrink-0',
                      m.status === 'active' ? 'bg-blue-500' : m.status === 'completed' ? 'bg-emerald-500' : 'bg-gray-400',
                    )}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                      <span className="truncate">{m.name}</span>
                      {isSelected && <CheckCircle2 size={11} className="text-accent shrink-0 ml-1" />}
                    </div>
                    {/* Mini progress bar */}
                    {stats.total > 0 && (
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <div className="flex-1 h-1 rounded-full bg-surface-hover overflow-hidden">
                          <div
                            className={cn(
                              'h-full rounded-full transition-all',
                              pct === 100 ? 'bg-emerald-500' : 'bg-blue-500',
                            )}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                        <span className="text-[9px] text-muted tabular-nums shrink-0">
                          {stats.done}/{stats.total}
                        </span>
                      </div>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Image Lightbox ────────────────────────────── */

function ImageLightbox({
  images,
  currentIndex,
  onClose,
  onNavigate,
  onAnnotate,
}: {
  images: { url: string; name: string }[];
  currentIndex: number;
  onClose: () => void;
  onNavigate: (index: number) => void;
  onAnnotate?: (index: number) => void;
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
      role="dialog"
      aria-modal="true"
      aria-label={`Image viewer: ${images[currentIndex]?.name || 'Image'}`}
    >
      <button
        onClick={onClose}
        aria-label="Close image viewer"
        className="absolute top-4 right-4 rounded-full bg-black/60 p-2 text-white hover:bg-black/80 transition-colors"
      >
        <X size={20} aria-hidden="true" />
      </button>

      {currentIndex > 0 && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onNavigate(currentIndex - 1);
          }}
          aria-label="Previous image"
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
          aria-label="Next image"
          className="absolute right-4 top-1/2 -translate-y-1/2 rounded-full bg-black/60 p-3 text-white hover:bg-black/80 transition-colors"
        >
          →
        </button>
      )}

      <img
        src={images[currentIndex].url}
        alt={images[currentIndex].name}
        className="max-h-[85vh] max-w-[90vw] object-contain rounded-lg shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        onError={(e) => {
          e.currentTarget.src = '';
          e.currentTarget.alt = 'Image expired or unavailable';
          e.currentTarget.className = 'max-h-[40vh] max-w-[60vw] flex items-center justify-center bg-surface rounded-lg p-8 text-muted text-sm';
        }}
      />

      <div
        className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-4 rounded-xl bg-black/70 backdrop-blur-sm px-4 py-2"
        onClick={(e) => e.stopPropagation()}
      >
        <span className="text-xs text-white/80 truncate max-w-[200px]">{images[currentIndex].name}</span>
        <span className="text-xs text-white/60">{currentIndex + 1} / {images.length}</span>
        {onAnnotate && (
          <button
            onClick={() => onAnnotate(currentIndex)}
            className="rounded-md bg-accent/90 px-2.5 py-1 text-[10px] font-medium text-black hover:bg-accent transition-colors"
          >
            ✏️ Annotate
          </button>
        )}
        <a
          href={images[currentIndex].url}
          download={images[currentIndex].name}
          className="rounded-md bg-white/10 px-2 py-1 text-[10px] text-white hover:bg-white/20 transition-colors"
        >
          ↓ Download
        </a>
      </div>
    </div>
  );
}
