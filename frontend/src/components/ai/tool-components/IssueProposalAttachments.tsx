/**
 * IssueProposalAttachments — image upload zone for the AI's `propose_issue`
 * card. Mirrors the security & compression model used by `CreateIssueModal`
 * but persists S3 markers (stable across presigned-URL expiry) instead of
 * data-URLs.
 *
 * Flow:
 *   1. User drops / pastes / picks file
 *   2. Compress in-browser to WebP (max 1920px, q=0.82) — strips EXIF as a
 *      side-effect of the canvas re-encode (no geo leak)
 *   3. POST base64 to /api/v1/uploads → backend uploads to S3 + returns
 *      { url (presigned), marker (s3://...) }
 *   4. We persist `marker` so the URL never expires
 *   5. Preview uses the presigned `url` for the lifetime of the card
 *
 * Hard caps (defense in depth — backend re-validates):
 *   - 5 images max
 *   - 5MB per image (post-compression)
 *   - WebP / JPEG / PNG / GIF only
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '@clerk/clerk-react';
import { ImagePlus, X, AlertCircle, Loader2, FileText } from 'lucide-react';
import { resolveApiOrigin } from '@/lib/api-origin';
import { cn } from '@/lib/utils';

export interface ProposalAttachment {
  /** Stable S3 marker (`s3://baaton-uploads/...`) — what we send to the backend */
  url: string;
  /** Live presigned URL for in-card preview (will expire, never persisted) */
  preview_url: string;
  name: string;
  size: number;
  mime_type: string;
}

interface Props {
  attachments: ProposalAttachment[];
  onChange: (next: ProposalAttachment[]) => void;
  disabled?: boolean;
}

const MAX_COUNT = 5;
const MAX_SIZE_BYTES = 5 * 1024 * 1024;
const MAX_DIM = 1920;
const WEBP_QUALITY = 0.82;
// Images are re-encoded client-side to WebP; docs are uploaded as-is. The
// backend `/uploads` allowlist is the source of truth — keep these in sync.
const ALLOWED_IMAGE_MIME = new Set(['image/webp', 'image/jpeg', 'image/png', 'image/gif']);
const ALLOWED_DOC_MIME = new Set([
  'application/pdf',
  'text/plain',
  'text/csv',
  'text/markdown',
  'application/json',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/zip',
]);
const DOC_EXT_RE = /\.(pdf|txt|csv|md|markdown|json|docx?|xlsx?|pptx?|zip)$/i;
const ACCEPTED_INPUT =
  'image/webp,image/jpeg,image/png,image/gif,image/heic,image/heif,image/avif,' +
  '.pdf,.txt,.csv,.md,.json,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.zip';

function isImageInput(file: File): boolean {
  return file.type.startsWith('image/') || /\.(webp|jpe?g|png|gif|heic|heif|avif)$/i.test(file.name);
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });
}

function humanSize(bytes: number): string {
  return bytes > 1024 * 1024 ? `${(bytes / 1048576).toFixed(1)}MB` : `${Math.round(bytes / 1024)}KB`;
}

function compressToWebP(file: File): Promise<{ dataUrl: string; size: number; mime: string; name: string }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      let { width, height } = img;
      if (width > MAX_DIM || height > MAX_DIM) {
        const ratio = Math.min(MAX_DIM / width, MAX_DIM / height);
        width = Math.round(width * ratio);
        height = Math.round(height * ratio);
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) return reject(new Error('Canvas unavailable'));
      ctx.drawImage(img, 0, 0, width, height);

      // GIFs lose animation through canvas — keep them as-is via FileReader.
      const isGif = file.type === 'image/gif';
      if (isGif) {
        const reader = new FileReader();
        reader.onload = () => resolve({
          dataUrl: reader.result as string,
          size: file.size,
          mime: 'image/gif',
          name: file.name || `paste-${Date.now()}.gif`,
        });
        reader.onerror = () => reject(new Error('Failed to read GIF'));
        reader.readAsDataURL(file);
        return;
      }

      const dataUrl = canvas.toDataURL('image/webp', WEBP_QUALITY);
      // base64 size estimate
      const header = 'data:image/webp;base64,';
      const size = Math.round((dataUrl.length - header.length) * 0.75);
      const baseName = (file.name || `paste-${Date.now()}`).replace(/\.[^.]+$/, '');
      resolve({ dataUrl, size, mime: 'image/webp', name: `${baseName}.webp` });
    };
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('Image decode failed'));
    };
    img.src = objectUrl;
  });
}

export function IssueProposalAttachments({ attachments, onChange, disabled }: Props) {
  const { getToken } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dropZoneRef = useRef<HTMLDivElement>(null);
  const [uploading, setUploading] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);

  const remainingSlots = MAX_COUNT - attachments.length;

  const uploadOne = useCallback(async (file: File) => {
    // Pre-flight: accept images and the doc allowlist (drag/drop accepts anything).
    const isImage = isImageInput(file);
    const isDoc =
      ALLOWED_DOC_MIME.has(file.type) || (!isImage && DOC_EXT_RE.test(file.name));
    if (!isImage && !isDoc) {
      throw new Error(`${file.name}: format non supporté`);
    }

    let dataUrl: string;
    let name: string;
    let size: number;
    let mime: string;

    if (isImage) {
      // Compress + re-encode to WebP (strips EXIF, supports HEIC/AVIF).
      const compressed = await compressToWebP(file);
      if (compressed.size > MAX_SIZE_BYTES) {
        throw new Error(`${compressed.name}: dépasse ${Math.round(MAX_SIZE_BYTES / 1024 / 1024)} MB après compression`);
      }
      if (!ALLOWED_IMAGE_MIME.has(compressed.mime)) {
        throw new Error(`${compressed.name}: type ${compressed.mime} refusé`);
      }
      dataUrl = compressed.dataUrl;
      name = compressed.name;
      size = compressed.size;
      mime = compressed.mime;
    } else {
      // Documents are uploaded as-is (no compression).
      if (file.size > MAX_SIZE_BYTES) {
        throw new Error(`${file.name}: dépasse ${Math.round(MAX_SIZE_BYTES / 1024 / 1024)} MB`);
      }
      dataUrl = await readAsDataUrl(file);
      name = file.name || `fichier-${Date.now()}`;
      size = file.size;
      // Normalize a couple of common empty/loose mimes to the backend allowlist.
      mime = file.type
        || (/\.md$/i.test(name) ? 'text/markdown'
          : /\.csv$/i.test(name) ? 'text/csv'
          : /\.json$/i.test(name) ? 'application/json'
          : /\.txt$/i.test(name) ? 'text/plain'
          : 'application/octet-stream');
    }

    const token = await getToken();
    const apiBase = resolveApiOrigin();
    const res = await fetch(`${apiBase}/api/v1/uploads`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({
        data: dataUrl,
        filename: name,
        content_type: mime,
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`upload ${res.status}: ${body.slice(0, 80) || 'failed'}`);
    }
    const json = await res.json();
    const data = json.data ?? json;
    if (!data?.marker || !data?.url) {
      throw new Error('Réponse upload invalide');
    }

    return {
      url: data.marker as string,
      preview_url: data.url as string,
      name,
      size,
      mime_type: mime,
    } satisfies ProposalAttachment;
  }, [getToken]);

  const handleFiles = useCallback(async (files: FileList | File[] | null) => {
    if (!files || disabled) return;
    const arr = Array.from(files).slice(0, remainingSlots);
    if (arr.length === 0) {
      setError(`Limite: ${MAX_COUNT} images max.`);
      return;
    }
    setError(null);
    setUploading(n => n + arr.length);
    const successes: ProposalAttachment[] = [];
    const errors: string[] = [];
    await Promise.all(arr.map(async (file) => {
      try {
        successes.push(await uploadOne(file));
      } catch (e) {
        errors.push(e instanceof Error ? e.message : 'Upload failed');
      }
    }));
    setUploading(n => n - arr.length);
    if (successes.length > 0) onChange([...attachments, ...successes]);
    if (errors.length > 0) setError(errors[0]);
  }, [attachments, onChange, remainingSlots, uploadOne, disabled]);

  // ── Paste handler (clipboard images) ──
  useEffect(() => {
    const node = dropZoneRef.current;
    if (!node || disabled) return;
    const onPaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      const files: File[] = [];
      for (const item of Array.from(items)) {
        if (item.kind === 'file') {
          const f = item.getAsFile();
          if (f) files.push(f);
        }
      }
      if (files.length > 0) {
        e.preventDefault();
        void handleFiles(files);
      }
    };
    node.addEventListener('paste', onPaste);
    return () => node.removeEventListener('paste', onPaste);
  }, [handleFiles, disabled]);

  const removeAt = (idx: number) => onChange(attachments.filter((_, i) => i !== idx));

  return (
    <div>
      <label className="block text-[10px] font-medium text-muted uppercase tracking-wide mb-1.5">
        Pièces jointes <span className="text-muted/60 normal-case">— optionnel ({attachments.length}/{MAX_COUNT})</span>
      </label>

      <div
        ref={dropZoneRef}
        tabIndex={-1}
        onDragOver={(e) => { e.preventDefault(); if (!disabled) setIsDragOver(true); }}
        onDragLeave={() => setIsDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setIsDragOver(false);
          void handleFiles(e.dataTransfer.files);
        }}
        className={cn(
          'rounded-lg border border-dashed transition-colors',
          isDragOver ? 'border-amber-500 bg-amber-500/5' : 'border-border',
          disabled && 'opacity-50',
        )}
      >
        {attachments.length > 0 && (
          <div className="p-1.5 space-y-1.5">
            {/* Image thumbnails */}
            {attachments.some(a => a.mime_type.startsWith('image/')) && (
              <div className="grid grid-cols-3 sm:grid-cols-4 gap-1.5">
                {attachments.map((a, idx) => (
                  a.mime_type.startsWith('image/') ? (
                    <div key={`${a.url}-${idx}`} className="group relative aspect-square rounded-md bg-surface-hover overflow-hidden">
                      <img
                        src={a.preview_url}
                        alt={a.name}
                        className="w-full h-full object-cover"
                        loading="lazy"
                      />
                      <button
                        type="button"
                        onClick={() => removeAt(idx)}
                        className="absolute top-0.5 right-0.5 rounded-full bg-black/60 p-0.5 text-white opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-500/80 focus:outline-none focus:opacity-100"
                        aria-label={`Retirer ${a.name}`}
                      >
                        <X size={10} />
                      </button>
                      <span className="absolute bottom-0.5 left-0.5 rounded bg-black/60 px-1 py-0.5 text-[8px] text-white font-mono opacity-0 group-hover:opacity-100 transition-opacity tabular-nums">
                        {humanSize(a.size)}
                      </span>
                    </div>
                  ) : null
                ))}
              </div>
            )}

            {/* Document chips — mirrors the issue drawer / detail rendering */}
            {attachments.map((a, idx) => (
              !a.mime_type.startsWith('image/') ? (
                <div key={`${a.url}-${idx}`} className="group flex items-center gap-1.5 rounded-md bg-surface border border-border px-2 py-1.5">
                  <FileText size={12} className="text-secondary shrink-0" />
                  <span className="text-[11px] text-secondary truncate flex-1">{a.name}</span>
                  <span className="text-[9px] text-muted shrink-0 tabular-nums">{humanSize(a.size)}</span>
                  <button
                    type="button"
                    onClick={() => removeAt(idx)}
                    className="text-muted hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity shrink-0 focus:outline-none focus:opacity-100"
                    aria-label={`Retirer ${a.name}`}
                  >
                    <X size={10} />
                  </button>
                </div>
              ) : null
            ))}
          </div>
        )}

        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={disabled || remainingSlots === 0 || uploading > 0}
          className={cn(
            'w-full flex items-center justify-center gap-2 px-3 text-[11px]',
            'hover:bg-surface-hover/50 active:scale-[0.99]',
            'transition-[transform,colors,background-color] duration-150 ease-[cubic-bezier(0.16,1,0.3,1)]',
            'focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/30',
            'disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent',
            attachments.length === 0
              ? 'rounded-lg py-2.5 text-secondary font-medium hover:text-primary'
              : 'rounded-b-lg border-t border-border py-2 text-muted hover:text-primary',
          )}
        >
          {uploading > 0 ? (
            <>
              <Loader2 size={12} className="animate-spin" />
              <span>Upload en cours…</span>
            </>
          ) : remainingSlots === 0 ? (
            <span>Limite atteinte ({MAX_COUNT} fichiers)</span>
          ) : (
            <>
              <ImagePlus size={attachments.length === 0 ? 15 : 12} className={attachments.length === 0 ? 'text-amber-500' : undefined} />
              <span>Ajouter un fichier</span>
              <span className="text-muted/60">— image ou doc, glisser, coller (⌘V) ou cliquer</span>
            </>
          )}
        </button>
      </div>

      {error && (
        <div className="mt-1.5 flex items-center gap-1.5 text-[11px] text-red-400">
          <AlertCircle size={11} className="shrink-0" />
          <span className="truncate">{error}</span>
        </div>
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept={ACCEPTED_INPUT}
        multiple
        className="hidden"
        onChange={(e) => {
          void handleFiles(e.target.files);
          e.target.value = '';
        }}
      />
    </div>
  );
}
