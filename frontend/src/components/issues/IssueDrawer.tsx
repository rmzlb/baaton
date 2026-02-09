import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
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
import { ActivityFeed } from '@/components/activity/ActivityFeed';
import type { Issue, IssueStatus, IssuePriority, IssueType, TLDR, Comment, ProjectStatus, ProjectTag, Attachment } from '@/lib/types';

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
  const [uploadingCount, setUploadingCount] = useState(0);
  const [isDragging, setIsDragging] = useState(false);

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
      // Optimistically update the Zustand store too
      updateIssue(issueId, { [field]: value } as Partial<Issue>);
      return { previousIssue };
    },
    onError: (_err, _vars, context) => {
      // Roll back on error
      if (context?.previousIssue) {
        queryClient.setQueryData(['issue', issueId], context.previousIssue);
        updateIssue(issueId, context.previousIssue);
      }
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

  // ── Image compression ──
  const compressImage = useCallback((file: File | Blob, fileName: string): Promise<{ base64: string; size: number; name: string; mime: string }> => {
    return new Promise((resolve) => {
      const img = new window.Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        URL.revokeObjectURL(url);
        const MAX = 1600;
        let { width, height } = img;
        if (width > MAX || height > MAX) {
          const ratio = Math.min(MAX / width, MAX / height);
          width = Math.round(width * ratio);
          height = Math.round(height * ratio);
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(img, 0, 0, width, height);
        const isPng = file.type === 'image/png';
        const mime = isPng ? 'image/png' : 'image/jpeg';
        const quality = isPng ? 0.9 : 0.8;
        const base64 = canvas.toDataURL(mime, quality);
        const sizeBytes = Math.round((base64.length - `data:${mime};base64,`.length) * 0.75);
        resolve({ base64, size: sizeBytes, name: fileName, mime });
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        const reader = new FileReader();
        reader.onload = () => resolve({
          base64: reader.result as string,
          size: file.size,
          name: fileName,
          mime: file.type || 'application/octet-stream',
        });
        reader.readAsDataURL(file);
      };
      img.src = url;
    });
  }, []);

  const handleFileUpload = useCallback(async (files: FileList | File[] | null) => {
    if (!files || files.length === 0 || !issue) return;
    const fileArray = Array.from(files);
    setUploadingCount(fileArray.length);
    const newAttachments = [...(issue.attachments || [])];

    for (const file of fileArray) {
      if (file.size > 20 * 1024 * 1024) continue;
      const isImage = file.type.startsWith('image/');
      if (isImage) {
        const compressed = await compressImage(file, file.name || `paste-${Date.now()}.jpg`);
        newAttachments.push({
          url: compressed.base64,
          name: compressed.name,
          size: compressed.size,
          mime_type: compressed.mime,
        });
      } else {
        if (file.size > 5 * 1024 * 1024) continue;
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
    }

    await apiClient.issues.update(issueId, { attachments: newAttachments } as any);
    queryClient.invalidateQueries({ queryKey: ['issue', issueId] });
    setUploadingCount(0);
  }, [issue, issueId, compressImage, apiClient, queryClient]);

  // ── Paste handler ──
  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
      if (!panelRef.current) return;
      const items = e.clipboardData?.items;
      if (!items) return;
      const imageFiles: File[] = [];
      for (const item of Array.from(items)) {
        if (item.type.startsWith('image/')) {
          const file = item.getAsFile();
          if (file) imageFiles.push(file);
        }
      }
      if (imageFiles.length > 0) {
        e.preventDefault();
        handleFileUpload(imageFiles);
      }
    };
    document.addEventListener('paste', handlePaste);
    return () => document.removeEventListener('paste', handlePaste);
  }, [handleFileUpload]);

  // ── Drag & Drop ──
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);
  const handleDragLeave = useCallback(() => setIsDragging(false), []);
  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    handleFileUpload(e.dataTransfer.files);
  }, [handleFileUpload]);

  const handleDeleteAttachment = useCallback((attachmentUrl: string) => {
    if (!issue) return;
    const next = (issue.attachments || []).filter((a) => a.url !== attachmentUrl);
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
        <div className="fixed inset-0 z-40 bg-black/30 dark:bg-black/40 hidden md:block" onClick={onClose} />
        <div
          ref={panelRef}
          className="fixed inset-0 md:inset-y-0 md:left-auto md:right-0 z-50 w-full md:max-w-2xl bg-bg md:border-l border-border flex flex-col animate-slide-in-right"
        >
          <LoadingSkeleton />
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
      <div className="fixed inset-0 z-40 bg-black/30 dark:bg-black/40 hidden md:block" aria-hidden="true" />

      {/* Panel — full-screen on mobile, side panel on tablet+ */}
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="issue-drawer-title"
        className="fixed inset-0 md:inset-y-0 md:left-auto md:right-0 z-50 w-full md:max-w-2xl bg-bg md:border-l border-border flex flex-col animate-slide-in-right overflow-hidden"
      >
        {/* ── Header ── */}
        <div className="flex items-center justify-between border-b border-border px-4 py-2.5 shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <TypeIcon size={14} className={typeColor} />
            <span className="text-[11px] font-mono text-secondary">{issue.display_id}</span>
            {issue.created_by_id && (
              <>
                <span className="text-muted text-[10px]">·</span>
                <div className="flex items-center gap-1.5 min-w-0">
                  <div className="h-5 w-5 rounded-full bg-accent/20 border border-accent/30 flex items-center justify-center text-[8px] font-mono font-bold text-accent shrink-0">
                    {(issue.created_by_name || issue.created_by_id || '?').slice(0, 2).toUpperCase()}
                  </div>
                  <span className="text-[11px] text-secondary truncate">
                    {issue.created_by_name || issue.created_by_id?.slice(0, 12)}
                  </span>
                </div>
                <span className="text-[10px] text-muted shrink-0">· {timeAgo(issue.created_at)}</span>
              </>
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
            <div className="flex-1 min-w-0 p-4 space-y-4 border-b md:border-b-0 md:border-r border-border">
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
                    className="w-full bg-transparent text-base font-semibold text-primary outline-none border-b border-accent pb-1"
                  />
                ) : (
                  <h2
                    id="issue-drawer-title"
                    onClick={() => {
                      setTitleDraft(issue.title);
                      setEditingTitle(true);
                    }}
                    className="text-base font-semibold text-primary cursor-pointer hover:text-accent transition-colors leading-snug"
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
            <div className="w-full md:w-56 shrink-0 p-4 space-y-4">
              <MetadataSidebar
                issue={issue}
                availableStatuses={availableStatuses}
                currentStatus={currentStatus}
                currentPriority={currentPriority}
                orgMembers={orgMembers}
                projectTags={projectTags}
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
                uploadingCount={uploadingCount}
                isDragging={isDragging}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                onFileUpload={handleFileUpload}
                onDeleteImage={handleDeleteAttachment}
                onDeleteNonImage={handleDeleteNonImageAttachment}
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
      {lightboxIndex !== null && imageAttachments.length > 0 && (
        <ImageLightbox
          images={imageAttachments.map((a) => ({ url: a.url, name: a.name }))}
          currentIndex={lightboxIndex}
          onClose={() => setLightboxIndex(null)}
          onNavigate={setLightboxIndex}
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
          className="rounded-lg bg-surface border border-border p-3 cursor-text hover:border-accent/30 transition-colors min-h-[60px]"
        >
          {hasHtml ? (
            <div
              className="prose prose-sm dark:prose-invert prose-headings:text-primary prose-p:text-secondary prose-li:text-secondary prose-a:text-accent max-w-none text-xs"
              dangerouslySetInnerHTML={{ __html: description }}
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
  uploadingCount: number;
  isDragging: boolean;
  onDragOver: (e: React.DragEvent) => void;
  onDragLeave: () => void;
  onDrop: (e: React.DragEvent) => void;
  onFileUpload: (files: FileList | File[] | null) => void;
  onDeleteImage: (url: string) => void;
  onDeleteNonImage: (idx: number) => void;
  onLightbox: (idx: number) => void;
  t: (key: string, vars?: Record<string, string | number>) => string;
}

function AttachmentSection({
  imageAttachments,
  nonImageAttachments,
  uploadingCount,
  isDragging,
  onDragOver,
  onDragLeave,
  onDrop,
  onFileUpload,
  onDeleteImage,
  onDeleteNonImage,
  onLightbox,
  t,
}: AttachmentSectionProps) {
  return (
    <div
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <label className="flex items-center gap-1.5 text-[10px] text-muted mb-1.5 uppercase tracking-wider font-medium">
        <Paperclip size={10} />
        {t('issueDrawer.attachments')}
        <span className="text-[9px] text-muted/50 ml-1 normal-case tracking-normal">⌘V {t('issueDrawer.pasteHint')}</span>
      </label>

      {uploadingCount > 0 && (
        <div className="flex items-center gap-1.5 rounded-md bg-accent/10 border border-accent/20 px-2 py-1.5 mb-1.5 text-[11px] text-accent">
          <div className="h-2.5 w-2.5 rounded-full border-2 border-accent border-t-transparent animate-spin" />
          {t('issueDrawer.uploading', { count: uploadingCount })}
        </div>
      )}

      {/* Image thumbnails */}
      {imageAttachments.length > 0 && (
        <div className="grid grid-cols-3 gap-1.5 mb-1.5">
          {imageAttachments.map((att, idx) => (
            <div key={idx} className="group relative aspect-square rounded-md border border-border overflow-hidden hover:border-accent transition-colors">
              <button
                onClick={() => onLightbox(idx)}
                className="h-full w-full"
              >
                <img
                  src={att.url}
                  alt={att.name}
                  className="h-full w-full object-cover"
                  loading="lazy"
                />
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

      {/* Upload area */}
      <label className={cn(
        'flex flex-col items-center justify-center gap-0.5 rounded-md border border-dashed p-2.5 text-[11px] cursor-pointer transition-all mt-1',
        isDragging
          ? 'border-accent bg-accent/5 text-accent scale-[1.02]'
          : 'border-border text-muted hover:border-accent hover:text-accent',
      )}>
        <Upload size={14} />
        <span className="text-center">{isDragging ? t('issueDrawer.dropHere') : t('issueDrawer.dropFiles')}</span>
        <span className="text-[9px] text-muted/50">{t('issueDrawer.uploadHint')}</span>
        <input
          type="file"
          multiple
          accept="image/*,.pdf,.doc,.docx,.txt"
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
      />

      <div
        className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-4 rounded-xl bg-black/70 backdrop-blur-sm px-4 py-2"
        onClick={(e) => e.stopPropagation()}
      >
        <span className="text-xs text-white/80 truncate max-w-[200px]">{images[currentIndex].name}</span>
        <span className="text-xs text-white/60">{currentIndex + 1} / {images.length}</span>
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
