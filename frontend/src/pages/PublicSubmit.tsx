import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import {
  Send, Bug, Sparkles, Zap, HelpCircle, CheckCircle2, AlertTriangle,
  Loader2, Paperclip, Upload, Image, X, FileText, RotateCw, AlertCircle,
} from 'lucide-react';
import { PixelBaton } from '@/components/shared/PixelBaton';
import { useTranslation } from '@/hooks/useTranslation';
import { api, ApiError } from '@/lib/api';
import { useFileUpload, validateFiles } from '@/hooks/useFileUpload';
import type { IssueType, IssuePriority, Attachment } from '@/lib/types';

const types: { value: IssueType; labelKey: string; icon: typeof Bug; color: string }[] = [
  { value: 'bug', labelKey: 'publicSubmit.typeBug', icon: Bug, color: 'text-red-400 border-red-400/30' },
  { value: 'feature', labelKey: 'publicSubmit.typeFeature', icon: Sparkles, color: 'text-emerald-400 border-emerald-400/30' },
  { value: 'improvement', labelKey: 'publicSubmit.typeImprovement', icon: Zap, color: 'text-blue-400 border-blue-400/30' },
  { value: 'question', labelKey: 'publicSubmit.typeQuestion', icon: HelpCircle, color: 'text-purple-400 border-purple-400/30' },
];

const priorities: { value: IssuePriority; label: string }[] = [
  { value: 'urgent', label: 'Urgent' },
  { value: 'high', label: 'High' },
  { value: 'medium', label: 'Medium' },
  { value: 'low', label: 'Low' },
];

const categories = ['FRONT', 'BACK', 'API', 'DB', 'INFRA', 'UX', 'DEVOPS'];

/* ── Public submit attachment limits (stricter than internal) ── */
const MAX_ATTACHMENTS = 5;
const MAX_IMAGE_SIZE = 10 * 1024 * 1024; // 10MB
const MAX_FILE_SIZE = 5 * 1024 * 1024;   // 5MB

export function PublicSubmit() {
  const { t } = useTranslation();
  const params = useParams<{ slug?: string; token?: string }>();
  const [searchParams] = useSearchParams();

  // Support both routes: /submit/:slug?token=xxx (legacy) and /s/:token (clean)
  const [resolvedSlug, setResolvedSlug] = useState(params.slug || '');
  const [resolvedToken, setResolvedToken] = useState(searchParams.get('token') || '');
  const [resolvedName, setResolvedName] = useState(params.slug || '');
  const [resolving, setResolving] = useState(false);
  const [resolveError, setResolveError] = useState('');

  useEffect(() => {
    // /s/:token route — resolve project from token
    if (params.token && !params.slug) {
      setResolving(true);
      api.public.get<{ slug: string; name: string; token: string }>(`/public/resolve/${params.token}`)
        .then((data) => {
          setResolvedSlug(data.slug);
          setResolvedToken(data.token);
          setResolvedName(data.name);
        })
        .catch(() => {
          setResolveError(t('publicSubmit.projectNotFound', { slug: params.token }));
        })
        .finally(() => setResolving(false));
    }
  }, [params.token, params.slug, t]);

  const slug = resolvedSlug;
  const token = resolvedToken;
  const projectDisplayName = resolvedName || slug;
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [selectedType, setSelectedType] = useState<IssueType>('bug');
  const [priority, setPriority] = useState<IssuePriority>('medium');
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');

  // ── Attachments ──
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const dragCounter = useRef(0);
  const formRef = useRef<HTMLFormElement>(null);

  const { pendingFiles, isUploading, processFiles, retryFile, removePending, clearPending } = useFileUpload({
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
    const { valid, errors } = validateFiles(fileArray, attachments.length, MAX_ATTACHMENTS, MAX_IMAGE_SIZE, MAX_FILE_SIZE);

    if (errors.length > 0) {
      const firstErr = errors[0];
      if (firstErr.reason === 'limit') {
        setUploadError(t('upload.limitReachedDesc', { max: MAX_ATTACHMENTS }));
      } else if (firstErr.reason === 'size') {
        setUploadError(firstErr.message);
      } else if (firstErr.reason === 'type') {
        setUploadError(firstErr.message);
      }
    }

    if (valid.length === 0) return;

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
      // Don't intercept paste in text fields
      const el = document.activeElement;
      if (el?.tagName === 'TEXTAREA' || el?.tagName === 'INPUT') return;

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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !slug || !token) return;
    if (isUploading) return;

    setSubmitting(true);
    setError('');

    try {
      await api.public.post(`/public/${slug}/submit`, {
        title: title.trim(),
        description: description.trim() || undefined,
        type: selectedType,
        priority,
        category: selectedCategories,
        reporter_name: name.trim() || undefined,
        reporter_email: email.trim() || undefined,
        token,
        attachments: attachments.length > 0 ? attachments : undefined,
      });
      setSubmitted(true);
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 404) {
          setError(t('publicSubmit.projectNotFound', { slug }));
        } else if (err.status === 429) {
          setError(t('publicSubmit.tooManyRequests'));
        } else {
          setError(err.message);
        }
      } else {
        setError(t('publicSubmit.genericError'));
      }
    } finally {
      setSubmitting(false);
    }
  };

  const resetForm = () => {
    setSubmitted(false);
    setTitle('');
    setDescription('');
    setSelectedType('bug');
    setError('');
    setAttachments([]);
    setUploadError('');
    clearPending();
  };

  // Separate image vs non-image attachments
  const imageAttachments = attachments.filter((a) => a.mime_type.startsWith('image/'));
  const nonImageAttachments = attachments.filter((a) => !a.mime_type.startsWith('image/'));
  const pendingImageFiles = pendingFiles.filter((f) => f.mime.startsWith('image/') || f.previewUrl !== null);
  const pendingNonImageFiles = pendingFiles.filter((f) => !f.mime.startsWith('image/') && f.previewUrl === null);

  if (submitted) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-bg p-6">
        <div className="text-center">
          <CheckCircle2 size={64} className="mx-auto text-green-500 mb-4" />
          <h2 className="text-xl font-bold text-primary">{t('publicSubmit.submitted')}</h2>
          <p className="mt-2 text-sm text-secondary">
            {t('publicSubmit.submittedDesc')}
          </p>
          <button
            onClick={resetForm}
            className="mt-6 text-sm text-accent hover:underline"
          >
            {t('publicSubmit.submitAnother')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-bg p-6">
      <div className="w-full max-w-lg">
        {/* Header */}
        <div className="mb-8 text-center">
          <PixelBaton size={48} className="mx-auto mb-3" />
          <h1 className="text-xl font-bold text-primary">{t('publicSubmit.title')}</h1>
          <p className="mt-1 text-sm text-secondary">
            {t('publicSubmit.for')} <span className="font-mono text-accent">{projectDisplayName}</span>
          </p>
        </div>

        {resolving && (
          <div className="flex items-center justify-center gap-2 py-8 text-sm text-secondary">
            <Loader2 size={16} className="animate-spin" />
            {t('common.loading')}
          </div>
        )}

        {resolveError && (
          <div className="flex items-start gap-2 rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3">
            <AlertTriangle size={16} className="text-red-400 mt-0.5 shrink-0" />
            <p className="text-sm text-red-400">{resolveError}</p>
          </div>
        )}

        {!resolving && !resolveError && (
        <form
          ref={formRef}
          onSubmit={handleSubmit}
          className="space-y-5"
          onDragEnter={handleDragEnter}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          {/* Full-form drag overlay */}
          {isDragging && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-[2px] pointer-events-none">
              <div className="flex flex-col items-center gap-3 rounded-2xl border-2 border-dashed border-accent bg-bg/90 p-10">
                <Upload size={32} className="text-accent" />
                <span className="text-sm font-medium text-accent">{t('upload.dropZone')}</span>
              </div>
            </div>
          )}

          {!token && (
            <div className="flex items-start gap-2 rounded-lg border border-amber-500/20 bg-amber-500/10 px-4 py-3">
              <AlertTriangle size={16} className="text-amber-400 mt-0.5 shrink-0" />
              <p className="text-sm text-amber-200">{t('publicSubmit.projectNotFound', { slug: slug || '?' })}</p>
            </div>
          )}
          {/* Error */}
          {error && (
            <div className="flex items-start gap-2 rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3">
              <AlertTriangle size={16} className="text-red-400 mt-0.5 shrink-0" />
              <p className="text-sm text-red-400">{error}</p>
            </div>
          )}

          {/* Type selector */}
          <div className="grid grid-cols-4 gap-2">
            {types.map(({ value, labelKey, icon: Icon, color }) => (
              <button
                key={value}
                type="button"
                onClick={() => setSelectedType(value)}
                className={`flex flex-col items-center gap-1 rounded-lg border p-3 text-xs transition-colors min-h-[44px] ${
                  selectedType === value
                    ? `${color} bg-surface`
                    : 'border-border text-secondary hover:border-border'
                }`}
              >
                <Icon size={20} />
                {t(labelKey)}
              </button>
            ))}
          </div>

          {/* Priority */}
          <div className="grid grid-cols-2 gap-2">
            {priorities.map((p) => (
              <button
                key={p.value}
                type="button"
                onClick={() => setPriority(p.value)}
                className={`rounded-lg border px-3 py-2 text-xs font-medium transition-colors ${
                  priority === p.value ? 'border-accent/50 bg-accent/10 text-accent' : 'border-border text-secondary hover:bg-surface-hover'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>

          {/* Category */}
          <div className="flex flex-wrap gap-2">
            {categories.map((cat) => {
              const active = selectedCategories.includes(cat);
              return (
                <button
                  key={cat}
                  type="button"
                  onClick={() => {
                    const next = active
                      ? selectedCategories.filter((c) => c !== cat)
                      : [...selectedCategories, cat];
                    setSelectedCategories(next);
                  }}
                  className={`rounded-full border px-3 py-1 text-[10px] transition-colors ${
                    active ? 'border-accent/50 bg-accent/10 text-accent' : 'border-border text-muted hover:bg-surface-hover'
                  }`}
                >
                  {cat}
                </button>
              );
            })}
          </div>

          {/* Title */}
          <input
            type="text"
            placeholder={t('publicSubmit.titlePlaceholder')}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
            className="w-full rounded-lg border border-border bg-surface px-4 py-3 text-sm text-primary placeholder-secondary focus:border-accent focus:outline-none transition-colors"
          />

          {/* Description */}
          <textarea
            placeholder={t('publicSubmit.descriptionPlaceholder')}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={5}
            className="w-full rounded-lg border border-border bg-surface px-4 py-3 text-sm text-primary placeholder-secondary focus:border-accent focus:outline-none resize-none transition-colors"
          />

          {/* ── Attachments Section ── */}
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
              <div className="grid grid-cols-3 gap-1.5">
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
                      onClick={() => handleDeleteAttachment(attachments.indexOf(att))}
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
                              onClick={() => handleRetryFile(pf.id)}
                              className="flex items-center gap-0.5 rounded bg-white/20 px-1.5 py-0.5 text-[9px] text-white hover:bg-white/30 transition-colors"
                            >
                              <RotateCw size={8} />
                              {t('upload.retry')}
                            </button>
                            <button
                              type="button"
                              onClick={() => removePending(pf.id)}
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
                  onClick={() => handleDeleteAttachment(attachments.indexOf(att))}
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
                  <button type="button" onClick={() => handleRetryFile(pf.id)} className="text-[9px] text-accent hover:underline">
                    {t('upload.retry')}
                  </button>
                ) : pf.status !== 'done' ? (
                  <div className="h-2.5 w-2.5 rounded-full border-2 border-accent border-t-transparent animate-spin shrink-0" />
                ) : null}
              </div>
            ))}

            {/* Upload button */}
            {attachments.length < MAX_ATTACHMENTS && (
              <label className="flex flex-col items-center justify-center gap-0.5 rounded-md border border-dashed border-border p-2.5 text-[11px] cursor-pointer transition-all text-muted hover:border-accent hover:text-accent mt-1">
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
                    handleFileUpload(e.target.files);
                    e.target.value = '';
                  }}
                />
              </label>
            )}
          </div>

          {/* Name + Email (optional) */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <input
              type="text"
              placeholder={t('publicSubmit.namePlaceholder')}
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="rounded-lg border border-border bg-surface px-4 py-3 text-sm text-primary placeholder-secondary focus:border-accent focus:outline-none transition-colors"
            />
            <input
              type="email"
              placeholder={t('publicSubmit.emailPlaceholder')}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="rounded-lg border border-border bg-surface px-4 py-3 text-sm text-primary placeholder-secondary focus:border-accent focus:outline-none transition-colors"
            />
          </div>

          {/* Submit */}
          <button
            type="submit"
            disabled={!title.trim() || submitting || isUploading || !token}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-accent px-4 py-3 text-sm font-medium text-black hover:bg-accent-hover disabled:opacity-40 disabled:cursor-not-allowed transition-colors min-h-[44px]"
          >
            {isUploading ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                {t('upload.compressing')}
              </>
            ) : (
              <>
                <Send size={16} />
                {submitting ? t('publicSubmit.submitting') : t('publicSubmit.submit')}
              </>
            )}
          </button>
        </form>
        )}

        <p className="mt-6 text-center text-[10px] text-secondary">
          Powered by <span className="text-accent">baaton.dev</span>
        </p>
      </div>
    </div>
  );
}

export default PublicSubmit;
