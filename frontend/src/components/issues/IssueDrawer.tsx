import { useEffect, useRef, useState, useCallback } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useUser } from '@clerk/clerk-react';
import {
  X, ChevronDown, Tag, User, Calendar,
  MessageSquare, Activity, Bot, CheckCircle2, AlertTriangle,
  Minus, ArrowUp, ArrowDown, Bug, Sparkles, Zap, HelpCircle,
  FileText, GitPullRequest, TestTube2, Paperclip, Upload, Image,
  Send, Plus,
} from 'lucide-react';
import { useIssuesStore } from '@/stores/issues';
import { useApi } from '@/hooks/useApi';
import { cn, timeAgo } from '@/lib/utils';
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
  const apiClient = useApi();
  const queryClient = useQueryClient();
  const { user } = useUser();
  const updateIssue = useIssuesStore((s) => s.updateIssue);
  const panelRef = useRef<HTMLDivElement>(null);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');
  const [showTagPicker, setShowTagPicker] = useState(false);
  const [newTagName, setNewTagName] = useState('');
  const [commentText, setCommentText] = useState('');
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

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
        <div className="fixed inset-0 z-40 bg-black/40" onClick={onClose} />
        <div
          ref={panelRef}
          className="fixed inset-y-0 right-0 z-50 w-full md:w-[45%] lg:w-[40%] bg-[#0a0a0a] border-l border-[#262626] flex items-center justify-center animate-slide-in-right"
        >
          <span className="text-sm text-[#a1a1aa]">Loading…</span>
        </div>
      </>
    );
  }

  const TypeIcon = TYPE_CONFIG[issue.type]?.icon || FileText;
  const typeColor = TYPE_CONFIG[issue.type]?.color || 'text-[#a1a1aa]';
  const currentStatus = availableStatuses.find(
    (s) => s.key === issue.status,
  );
  const currentPriority = PRIORITY_OPTIONS.find(
    (p) => p.key === issue.priority,
  );

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-40 bg-black/40" />

      {/* Panel */}
      <div
        ref={panelRef}
        className="fixed inset-y-0 right-0 z-50 w-full md:w-[45%] lg:w-[40%] bg-[#0a0a0a] border-l border-[#262626] flex flex-col animate-slide-in-right overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[#262626] px-5 py-3 shrink-0">
          <div className="flex items-center gap-2">
            <TypeIcon size={16} className={typeColor} />
            <span className="text-xs font-mono text-[#a1a1aa]">{issue.display_id}</span>
          </div>
          <button
            onClick={onClose}
            className="rounded-md p-1.5 text-[#a1a1aa] hover:bg-[#1f1f1f] hover:text-[#fafafa] transition-colors"
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
                  className="w-full bg-transparent text-xl font-semibold text-[#fafafa] outline-none border-b border-[#f59e0b] pb-1"
                />
              ) : (
                <h2
                  onClick={() => {
                    setTitleDraft(issue.title);
                    setEditingTitle(true);
                  }}
                  className="text-xl font-semibold text-[#fafafa] cursor-pointer hover:text-[#f59e0b] transition-colors"
                >
                  {issue.title}
                </h2>
              )}
            </div>

            {/* Properties Grid */}
            <div className="grid grid-cols-2 gap-3">
              {/* Status */}
              <PropertyRow label="Status">
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
                      <span className="text-sm text-[#fafafa]">
                        {currentStatus?.label || issue.status}
                      </span>
                    </span>
                  )}
                />
              </PropertyRow>

              {/* Priority */}
              <PropertyRow label="Priority">
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
                          <span className="text-sm text-[#fafafa]">
                            {currentPriority.label}
                          </span>
                        </>
                      ) : (
                        <span className="text-sm text-[#666]">None</span>
                      )}
                    </span>
                  )}
                />
              </PropertyRow>

              {/* Type */}
              <PropertyRow label="Type">
                <span className="flex items-center gap-2">
                  <TypeIcon size={14} className={typeColor} />
                  <span className="text-sm text-[#fafafa]">
                    {TYPE_CONFIG[issue.type]?.label || issue.type}
                  </span>
                </span>
              </PropertyRow>

              {/* Source */}
              <PropertyRow label="Source">
                <span className="text-sm text-[#a1a1aa] capitalize">{issue.source}</span>
              </PropertyRow>
            </div>

            {/* Tags with Picker */}
            <div>
              <label className="flex items-center gap-1.5 text-xs text-[#666] mb-2">
                <Tag size={12} />
                Tags
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
                      title="Click to remove"
                    >
                      {tag} ×
                    </span>
                  );
                })}
                <button
                  onClick={() => setShowTagPicker(!showTagPicker)}
                  className="rounded-full border border-dashed border-[#262626] px-2.5 py-1 text-xs text-[#666] hover:border-[#f59e0b] hover:text-[#f59e0b] transition-colors"
                >
                  <Plus size={10} className="inline mr-1" />
                  Add tag
                </button>
              </div>

              {/* Tag Picker Dropdown */}
              {showTagPicker && (
                <div className="mt-2 rounded-lg border border-[#262626] bg-[#141414] p-2 max-h-48 overflow-y-auto">
                  {projectTags
                    .filter((t) => !issue.tags.includes(t.name))
                    .map((tag) => (
                      <button
                        key={tag.id}
                        onClick={() => {
                          handleToggleTag(tag.name);
                          setShowTagPicker(false);
                        }}
                        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs text-[#a1a1aa] hover:bg-[#1f1f1f] transition-colors"
                      >
                        <span
                          className="h-3 w-3 rounded-full shrink-0"
                          style={{ backgroundColor: tag.color }}
                        />
                        {tag.name}
                      </button>
                    ))}
                  {/* Create new tag */}
                  <div className="flex items-center gap-2 mt-1 pt-1 border-t border-[#262626]">
                    <input
                      type="text"
                      value={newTagName}
                      onChange={(e) => setNewTagName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleCreateAndAddTag();
                      }}
                      placeholder="New tag name…"
                      className="flex-1 bg-transparent text-xs text-[#fafafa] outline-none placeholder-[#555] px-2 py-1"
                    />
                    <button
                      onClick={handleCreateAndAddTag}
                      disabled={!newTagName.trim()}
                      className="rounded-md px-2 py-1 text-[10px] bg-[#f59e0b] text-black font-medium disabled:opacity-40 hover:bg-[#d97706] transition-colors"
                    >
                      Create
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Assignees */}
            {issue.assignee_ids.length > 0 && (
              <div>
                <label className="flex items-center gap-1.5 text-xs text-[#666] mb-2">
                  <User size={12} />
                  Assignees
                </label>
                <div className="flex -space-x-2">
                  {issue.assignee_ids.map((id) => (
                    <div
                      key={id}
                      className="h-8 w-8 rounded-full bg-[#1f1f1f] border-2 border-[#0a0a0a] flex items-center justify-center text-[10px] font-mono text-[#a1a1aa]"
                      title={id}
                    >
                      {id.slice(0, 2).toUpperCase()}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Description */}
            <div>
              <label className="flex items-center gap-1.5 text-xs text-[#666] mb-2">
                <FileText size={12} />
                Description
              </label>
              {issue.description ? (
                <div className="rounded-lg bg-[#141414] border border-[#262626] p-4 text-sm text-[#d4d4d4] leading-relaxed whitespace-pre-wrap">
                  {issue.description}
                </div>
              ) : (
                <p className="text-sm text-[#555] italic">No description</p>
              )}
            </div>

            {/* Attachments */}
            <div>
              <label className="flex items-center gap-1.5 text-xs text-[#666] mb-2">
                <Paperclip size={12} />
                Attachments
              </label>
              {/* Thumbnail grid */}
              {imageAttachments.length > 0 && (
                <div className="grid grid-cols-3 gap-2 mb-2">
                  {imageAttachments.map((att, idx) => (
                    <button
                      key={idx}
                      onClick={() => setLightboxIndex(idx)}
                      className="group relative aspect-square rounded-lg border border-[#262626] overflow-hidden hover:border-[#f59e0b] transition-colors"
                    >
                      <img
                        src={att.url}
                        alt={att.name}
                        className="h-full w-full object-cover"
                      />
                      <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
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
                  <div key={idx} className="flex items-center gap-2 rounded-md bg-[#141414] border border-[#262626] px-3 py-2 mb-1">
                    <FileText size={12} className="text-[#a1a1aa]" />
                    <span className="text-xs text-[#a1a1aa] truncate">{att.name}</span>
                    <span className="text-[10px] text-[#555] ml-auto">
                      {(att.size / 1024).toFixed(0)}KB
                    </span>
                  </div>
                ))}
              {/* Upload area */}
              <label className="flex items-center justify-center gap-2 rounded-lg border border-dashed border-[#262626] p-3 text-xs text-[#666] cursor-pointer hover:border-[#f59e0b] hover:text-[#f59e0b] transition-colors mt-1">
                <Upload size={14} />
                Drop files or click to upload
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
                <label className="flex items-center gap-1.5 text-xs text-[#666] mb-2">
                  <Bot size={12} />
                  Agent TLDRs
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
              <label className="flex items-center gap-1.5 text-xs text-[#666] mb-2">
                <MessageSquare size={12} />
                Comments ({issue.comments?.length || 0})
              </label>
              <div className="space-y-3">
                {(issue.comments || []).map((comment: Comment) => (
                  <CommentCard key={comment.id} comment={comment} />
                ))}
              </div>

              {/* Comment input */}
              <div className="mt-3 rounded-lg border border-[#262626] bg-[#141414] p-3">
                <textarea
                  value={commentText}
                  onChange={(e) => setCommentText(e.target.value)}
                  placeholder="Add a comment…"
                  rows={3}
                  className="w-full bg-transparent text-sm text-[#fafafa] placeholder-[#555] outline-none resize-none"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                      handleSubmitComment();
                    }
                  }}
                />
                <div className="flex items-center justify-between mt-2 pt-2 border-t border-[#262626]">
                  <span className="text-[10px] text-[#555]">⌘+Enter to submit</span>
                  <button
                    onClick={handleSubmitComment}
                    disabled={!commentText.trim() || commentMutation.isPending}
                    className="flex items-center gap-1.5 rounded-md bg-[#f59e0b] px-3 py-1.5 text-xs font-medium text-black hover:bg-[#d97706] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    <Send size={12} />
                    {commentMutation.isPending ? 'Sending…' : 'Comment'}
                  </button>
                </div>
              </div>
            </div>

            {/* Metadata */}
            <div className="border-t border-[#262626] pt-4">
              <label className="flex items-center gap-1.5 text-xs text-[#666] mb-2">
                <Activity size={12} />
                Activity
              </label>
              <div className="space-y-2 text-xs text-[#666]">
                <div className="flex items-center gap-2">
                  <Calendar size={12} />
                  <span>Created {timeAgo(issue.created_at)}</span>
                </div>
                <div className="flex items-center gap-2">
                  <Calendar size={12} />
                  <span>Updated {timeAgo(issue.updated_at)}</span>
                </div>
                {issue.qualified_at && (
                  <div className="flex items-center gap-2">
                    <CheckCircle2 size={12} className="text-green-500" />
                    <span>Qualified {timeAgo(issue.qualified_at)}</span>
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
      <span className="text-[10px] text-[#555] uppercase tracking-wider font-medium">
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
        className="flex items-center gap-1 rounded-md px-2 py-1 hover:bg-[#1f1f1f] transition-colors w-full"
      >
        {renderSelected()}
        <ChevronDown size={12} className="text-[#555] ml-auto shrink-0" />
      </button>
      {open && (
        <div className="absolute top-full left-0 z-10 mt-1 w-44 rounded-lg border border-[#262626] bg-[#141414] py-1 shadow-xl">
          {options.map((opt) => (
            <button
              key={opt.key}
              onClick={() => {
                onChange(opt.key);
                setOpen(false);
              }}
              className={cn(
                'flex w-full items-center gap-2 px-3 py-2 text-sm hover:bg-[#1f1f1f] transition-colors',
                value === opt.key ? 'text-[#fafafa]' : 'text-[#a1a1aa]',
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
    none: 'text-[#555]',
  };

  return (
    <div className="rounded-lg border border-[#262626] bg-[#141414] p-4">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <Bot size={14} className="text-[#f59e0b]" />
          <span className="text-xs font-medium text-[#fafafa]">{tldr.agent_name}</span>
        </div>
        <span className="text-[10px] text-[#666]">{timeAgo(tldr.created_at)}</span>
      </div>
      <p className="text-sm text-[#d4d4d4] leading-relaxed mb-3">{tldr.summary}</p>
      <div className="flex items-center gap-3 text-[10px]">
        {tldr.files_changed.length > 0 && (
          <span className="flex items-center gap-1 text-[#a1a1aa]">
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
            className="flex items-center gap-1 text-[#f59e0b] hover:underline"
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
    <div className="rounded-lg border border-[#262626] bg-[#141414] p-4">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <div className="h-6 w-6 rounded-full bg-[#1f1f1f] flex items-center justify-center text-[9px] font-bold text-[#a1a1aa]">
            {comment.author_name.slice(0, 2).toUpperCase()}
          </div>
          <span className="text-xs font-medium text-[#fafafa]">{comment.author_name}</span>
        </div>
        <span className="text-[10px] text-[#666]">{timeAgo(comment.created_at)}</span>
      </div>
      <p className="text-sm text-[#d4d4d4] leading-relaxed whitespace-pre-wrap">
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
