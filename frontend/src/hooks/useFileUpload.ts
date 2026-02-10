import { useState, useCallback, useRef } from 'react';
import type { Attachment } from '@/lib/types';

/* ── Types ─────────────────────────────────────── */

export type UploadFileStatus = 'compressing' | 'saving' | 'done' | 'error';

export interface PendingFile {
  /** Temporary client-side ID */
  id: string;
  /** Original file name */
  name: string;
  /** Preview data-url (available immediately for images) */
  previewUrl: string | null;
  /** Compressed/final data-url */
  dataUrl: string | null;
  /** Mime type */
  mime: string;
  /** Byte size after compression */
  size: number;
  /** Current status */
  status: UploadFileStatus;
  /** Error message if status === 'error' */
  error?: string;
  /** Progress fraction 0-1 (compressing=0.3, saving=0.7, done=1) */
  progress: number;
  /** The original File object (for retry) */
  originalFile: File | null;
}

export interface UseFileUploadOptions {
  /** Max number of total attachments (existing + new). Default 10 */
  maxAttachments?: number;
  /** Max single file size in bytes. Default 20MB for images, 5MB others */
  maxImageSizeBytes?: number;
  maxFileSizeBytes?: number;
  /** Max dimension for image resize. Default 1920 */
  maxDimension?: number;
  /** WebP quality. Default 0.82 */
  webpQuality?: number;
  /** PNG quality. Default 0.9 */
  pngQuality?: number;
}

interface UseFileUploadReturn {
  /** Files currently being processed (optimistic previews) */
  pendingFiles: PendingFile[];
  /** Whether any file is currently uploading */
  isUploading: boolean;
  /** Process and add files. Returns compressed attachments ready to persist. */
  processFiles: (
    files: FileList | File[] | null,
    existingAttachments: Attachment[],
  ) => Promise<Attachment[]>;
  /** Retry a failed file */
  retryFile: (fileId: string, existingAttachments: Attachment[]) => Promise<Attachment | null>;
  /** Remove a pending file from the list */
  removePending: (fileId: string) => void;
  /** Clear all pending files */
  clearPending: () => void;
}

/* ── Accepted file types ───────────────────────── */

const ACCEPTED_IMAGE_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/svg+xml',
  'image/bmp',
  'image/heic',
  'image/heif',
  'image/avif',
]);

const ACCEPTED_FILE_TYPES = new Set([
  ...ACCEPTED_IMAGE_TYPES,
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
]);

/* ── Validation ────────────────────────────────── */

export interface FileValidationError {
  file: File;
  reason: 'type' | 'size' | 'limit';
  message: string;
}

export function validateFiles(
  files: File[],
  existingCount: number,
  maxAttachments: number,
  maxImageBytes: number,
  maxFileBytes: number,
): { valid: File[]; errors: FileValidationError[] } {
  const valid: File[] = [];
  const errors: FileValidationError[] = [];
  const remaining = maxAttachments - existingCount;

  for (let i = 0; i < files.length; i++) {
    const file = files[i];

    if (valid.length >= remaining) {
      errors.push({
        file,
        reason: 'limit',
        message: `Max ${maxAttachments} attachments reached`,
      });
      continue;
    }

    // Type check — be lenient: if MIME is empty (e.g. HEIC on some browsers), allow if it looks like an image ext
    const mime = file.type || '';
    const ext = file.name.split('.').pop()?.toLowerCase() || '';
    const isImage = mime.startsWith('image/') || ['heic', 'heif', 'avif', 'webp', 'jpg', 'jpeg', 'png', 'gif', 'bmp', 'svg'].includes(ext);
    const isAccepted = ACCEPTED_FILE_TYPES.has(mime) || isImage || ['pdf', 'doc', 'docx', 'txt'].includes(ext);

    if (!isAccepted) {
      errors.push({
        file,
        reason: 'type',
        message: `Unsupported file type: ${mime || ext}`,
      });
      continue;
    }

    const maxSize = isImage ? maxImageBytes : maxFileBytes;
    if (file.size > maxSize) {
      const maxMB = Math.round(maxSize / (1024 * 1024));
      errors.push({
        file,
        reason: 'size',
        message: `${file.name} exceeds ${maxMB}MB limit`,
      });
      continue;
    }

    valid.push(file);
  }

  return { valid, errors };
}

/* ── Image compression ─────────────────────────── */

function compressImageFile(
  file: File | Blob,
  fileName: string,
  maxDim: number,
  webpQuality: number,
  pngQuality: number,
): Promise<{ dataUrl: string; size: number; name: string; mime: string }> {
  return new Promise((resolve) => {
    const img = new window.Image();
    const url = URL.createObjectURL(file);

    img.onload = () => {
      URL.revokeObjectURL(url);

      let { width, height } = img;
      if (width > maxDim || height > maxDim) {
        const ratio = Math.min(maxDim / width, maxDim / height);
        width = Math.round(width * ratio);
        height = Math.round(height * ratio);
      }

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0, width, height);

      // Determine output format
      const inputType = (file as File).type || '';
      const isPng = inputType === 'image/png';
      const isGif = inputType === 'image/gif';
      const isSvg = inputType === 'image/svg+xml';

      // Keep PNG (transparency), GIF (animation — though canvas strips it), SVG as-is for small files
      // Everything else → WebP
      let mime: string;
      let quality: number;

      if (isPng) {
        // Try WebP first, but if the source is PNG with transparency, keep PNG
        // We always convert to WebP for PNGs too — WebP supports transparency
        mime = 'image/webp';
        quality = webpQuality;
      } else if (isGif || isSvg) {
        // For GIFs and SVGs, read as-is (canvas can't preserve animation)
        mime = inputType;
        quality = 1;
      } else {
        // JPEG, HEIC, HEIF, BMP, AVIF, etc → WebP
        mime = 'image/webp';
        quality = webpQuality;
      }

      // Check if browser supports WebP encoding
      const testUrl = canvas.toDataURL('image/webp', 0.5);
      const supportsWebP = testUrl.startsWith('data:image/webp');
      if (!supportsWebP && mime === 'image/webp') {
        // Fallback to JPEG
        mime = isPng ? 'image/png' : 'image/jpeg';
        quality = isPng ? pngQuality : 0.8;
      }

      const dataUrl = canvas.toDataURL(mime, quality);
      const header = `data:${mime};base64,`;
      const sizeBytes = Math.round((dataUrl.length - header.length) * 0.75);

      // Fix extension in name
      const extMap: Record<string, string> = {
        'image/webp': '.webp',
        'image/jpeg': '.jpg',
        'image/png': '.png',
      };
      const newExt = extMap[mime];
      let finalName = fileName;
      if (newExt) {
        const dotIdx = fileName.lastIndexOf('.');
        finalName = dotIdx > 0 ? fileName.substring(0, dotIdx) + newExt : fileName + newExt;
      }

      resolve({ dataUrl, size: sizeBytes, name: finalName, mime });
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      // Fallback: just read as data URL
      const reader = new FileReader();
      reader.onload = () =>
        resolve({
          dataUrl: reader.result as string,
          size: file.size,
          name: fileName,
          mime: (file as File).type || 'application/octet-stream',
        });
      reader.readAsDataURL(file);
    };

    img.src = url;
  });
}

/* ── Generate instant preview URL ──────────────── */

function createPreviewUrl(file: File): string | null {
  if (file.type?.startsWith('image/') || /\.(heic|heif|avif|webp|jpg|jpeg|png|gif|bmp|svg)$/i.test(file.name)) {
    return URL.createObjectURL(file);
  }
  return null;
}

/* ── Hook ──────────────────────────────────────── */

let fileIdCounter = 0;

export function useFileUpload(options: UseFileUploadOptions = {}): UseFileUploadReturn {
  const {
    maxAttachments = 10,
    maxImageSizeBytes = 20 * 1024 * 1024,
    maxFileSizeBytes = 5 * 1024 * 1024,
    maxDimension = 1920,
    webpQuality = 0.82,
    pngQuality = 0.9,
  } = options;

  const [pendingFiles, setPendingFiles] = useState<PendingFile[]>([]);
  const pendingRef = useRef<PendingFile[]>([]);

  // Keep ref in sync
  const updatePending = useCallback((updater: (prev: PendingFile[]) => PendingFile[]) => {
    setPendingFiles((prev) => {
      const next = updater(prev);
      pendingRef.current = next;
      return next;
    });
  }, []);

  const updateFile = useCallback(
    (id: string, patch: Partial<PendingFile>) => {
      updatePending((prev) =>
        prev.map((f) => (f.id === id ? { ...f, ...patch } : f)),
      );
    },
    [updatePending],
  );

  const isUploading = pendingFiles.some(
    (f) => f.status === 'compressing' || f.status === 'saving',
  );

  const processOneFile = useCallback(
    async (file: File, pendingId: string): Promise<Attachment | null> => {
      const isImage =
        file.type?.startsWith('image/') ||
        /\.(heic|heif|avif|webp|jpg|jpeg|png|gif|bmp|svg)$/i.test(file.name);

      try {
        if (isImage) {
          // Compressing
          updateFile(pendingId, { status: 'compressing', progress: 0.2 });
          const compressed = await compressImageFile(
            file,
            file.name || `paste-${Date.now()}.webp`,
            maxDimension,
            webpQuality,
            pngQuality,
          );
          updateFile(pendingId, {
            status: 'saving',
            progress: 0.7,
            dataUrl: compressed.dataUrl,
            size: compressed.size,
            name: compressed.name,
            mime: compressed.mime,
          });

          return {
            url: compressed.dataUrl,
            name: compressed.name,
            size: compressed.size,
            mime_type: compressed.mime,
          };
        } else {
          // Non-image: read as data URL
          updateFile(pendingId, { status: 'compressing', progress: 0.3 });
          const dataUrl = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result as string);
            reader.onerror = () => reject(new Error('Failed to read file'));
            reader.readAsDataURL(file);
          });
          updateFile(pendingId, { status: 'saving', progress: 0.7, dataUrl, size: file.size });

          return {
            url: dataUrl,
            name: file.name,
            size: file.size,
            mime_type: file.type || 'application/octet-stream',
          };
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Compression failed';
        updateFile(pendingId, { status: 'error', error: msg, progress: 0 });
        return null;
      }
    },
    [maxDimension, webpQuality, pngQuality, updateFile],
  );

  const processFiles = useCallback(
    async (
      files: FileList | File[] | null,
      existingAttachments: Attachment[],
    ): Promise<Attachment[]> => {
      if (!files || files.length === 0) return [];

      const fileArray = Array.from(files);
      const { valid, errors } = validateFiles(
        fileArray,
        existingAttachments.length,
        maxAttachments,
        maxImageSizeBytes,
        maxFileSizeBytes,
      );

      // Create pending entries with instant previews
      const newPending: PendingFile[] = valid.map((file) => {
        const id = `upload-${++fileIdCounter}-${Date.now()}`;
        const previewUrl = createPreviewUrl(file);
        return {
          id,
          name: file.name || `paste-${Date.now()}.webp`,
          previewUrl,
          dataUrl: null,
          mime: file.type || 'application/octet-stream',
          size: file.size,
          status: 'compressing' as const,
          progress: 0.1,
          originalFile: file,
        };
      });

      updatePending((prev) => [...prev, ...newPending]);

      // Process all files in parallel
      const results = await Promise.all(
        valid.map((file, i) => processOneFile(file, newPending[i].id)),
      );

      // Mark all as done or keep error state
      const attachments: Attachment[] = [];
      for (let i = 0; i < results.length; i++) {
        const result = results[i];
        const pending = newPending[i];
        if (result) {
          updateFile(pending.id, { status: 'done', progress: 1 });
          attachments.push(result);
        }
        // Revoke object URL if we created one
        if (pending.previewUrl) {
          URL.revokeObjectURL(pending.previewUrl);
        }
      }

      // Auto-clear done files after a short delay
      setTimeout(() => {
        updatePending((prev) =>
          prev.filter((f) => f.status !== 'done'),
        );
      }, 1500);

      return { attachments, errors } as any;
    },
    [maxAttachments, maxImageSizeBytes, maxFileSizeBytes, processOneFile, updateFile, updatePending],
  );

  // Wrap processFiles to return both attachments and errors
  const processFilesWrapped = useCallback(
    async (
      files: FileList | File[] | null,
      existingAttachments: Attachment[],
    ): Promise<Attachment[]> => {
      if (!files || files.length === 0) return [];

      const fileArray = Array.from(files);
      const { valid, errors: _errors } = validateFiles(
        fileArray,
        existingAttachments.length,
        maxAttachments,
        maxImageSizeBytes,
        maxFileSizeBytes,
      );

      // Create pending entries with instant previews
      const newPending: PendingFile[] = valid.map((file) => {
        const id = `upload-${++fileIdCounter}-${Date.now()}`;
        const previewUrl = createPreviewUrl(file);
        return {
          id,
          name: file.name || `paste-${Date.now()}.webp`,
          previewUrl,
          dataUrl: null,
          mime: file.type || 'application/octet-stream',
          size: file.size,
          status: 'compressing' as const,
          progress: 0.1,
          originalFile: file,
        };
      });

      updatePending((prev) => [...prev, ...newPending]);

      // Process all files in parallel
      const results = await Promise.all(
        valid.map((file, i) => processOneFile(file, newPending[i].id)),
      );

      // Mark all as done or keep error state
      const attachments: Attachment[] = [];
      for (let i = 0; i < results.length; i++) {
        const result = results[i];
        const pending = newPending[i];
        if (result) {
          updateFile(pending.id, { status: 'done', progress: 1 });
          attachments.push(result);
        }
        // Revoke object URL if we created one
        if (pending.previewUrl) {
          URL.revokeObjectURL(pending.previewUrl);
        }
      }

      // Auto-clear done files after a short delay
      setTimeout(() => {
        updatePending((prev) =>
          prev.filter((f) => f.status !== 'done'),
        );
      }, 1500);

      return attachments;
    },
    [maxAttachments, maxImageSizeBytes, maxFileSizeBytes, processOneFile, updateFile, updatePending],
  );

  const retryFile = useCallback(
    async (fileId: string, existingAttachments: Attachment[]): Promise<Attachment | null> => {
      const pending = pendingRef.current.find((f) => f.id === fileId);
      if (!pending?.originalFile) return null;

      updateFile(fileId, { status: 'compressing', progress: 0.1, error: undefined });
      const result = await processOneFile(pending.originalFile, fileId);
      if (result) {
        updateFile(fileId, { status: 'done', progress: 1 });
        setTimeout(() => {
          updatePending((prev) => prev.filter((f) => f.id !== fileId));
        }, 1500);
      }
      return result;
    },
    [processOneFile, updateFile, updatePending],
  );

  const removePending = useCallback(
    (fileId: string) => {
      const file = pendingRef.current.find((f) => f.id === fileId);
      if (file?.previewUrl) URL.revokeObjectURL(file.previewUrl);
      updatePending((prev) => prev.filter((f) => f.id !== fileId));
    },
    [updatePending],
  );

  const clearPending = useCallback(() => {
    for (const f of pendingRef.current) {
      if (f.previewUrl) URL.revokeObjectURL(f.previewUrl);
    }
    updatePending(() => []);
  }, [updatePending]);

  return {
    pendingFiles,
    isUploading,
    processFiles: processFilesWrapped,
    retryFile,
    removePending,
    clearPending,
  };
}

export { validateFiles as _validateFiles, compressImageFile as _compressImageFile };
