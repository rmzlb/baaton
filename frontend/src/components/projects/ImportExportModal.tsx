import { useState, useRef, useCallback } from 'react';
import { useApi } from '@/hooks/useApi';
import { useTranslation } from '@/hooks/useTranslation';
import { cn } from '@/lib/utils';
import { Upload, X, FileJson, Loader2 } from 'lucide-react';

interface Props {
  projectId: string;
  projectName: string;
  onClose: () => void;
  onSuccess: (message: string) => void;
  onError: (message: string) => void;
}

export function ImportModal({ projectId, projectName, onClose, onSuccess, onError }: Props) {
  const { t } = useTranslation();
  const apiClient = useApi();
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [importing, setImporting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = (f: File) => {
    if (f.type === 'application/json' || f.name.endsWith('.json')) {
      setFile(f);
    }
  };

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer.files[0];
    if (f) handleFile(f);
  }, []);

  const handleImport = async () => {
    if (!file) return;
    setImporting(true);
    try {
      const text = await file.text();
      const json = JSON.parse(text);
      await apiClient.post(`/projects/${projectId}/import`, json);
      onSuccess(t('importExport.importSuccess'));
      onClose();
    } catch {
      onError(t('importExport.importError'));
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-md rounded-2xl border border-border bg-surface shadow-2xl">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <h2 className="text-base font-semibold text-primary flex items-center gap-2">
            <Upload size={16} className="text-accent" />
            {t('importExport.importTitle')}
            <span className="text-sm font-normal text-muted">— {projectName}</span>
          </h2>
          <button onClick={onClose} className="rounded-md p-1 text-muted hover:text-secondary transition-colors">
            <X size={16} />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {/* Drop Zone */}
          <div
            onClick={() => inputRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={handleDrop}
            className={cn(
              'flex flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-10 cursor-pointer transition-colors',
              dragging ? 'border-accent bg-accent/5' : 'border-border hover:border-accent/50 hover:bg-surface-hover',
            )}
          >
            {file ? (
              <>
                <FileJson size={32} className="text-accent mb-2" />
                <p className="text-sm text-primary font-medium">{file.name}</p>
                <p className="text-xs text-muted mt-1">{(file.size / 1024).toFixed(1)} KB</p>
              </>
            ) : (
              <>
                <Upload size={32} className="text-muted mb-2" />
                <p className="text-sm text-secondary">{t('importExport.dropFile')}</p>
                <p className="text-xs text-muted mt-1">{t('importExport.fileHint')}</p>
              </>
            )}
          </div>

          <input
            ref={inputRef}
            type="file"
            accept=".json,application/json"
            className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
          />

          <div className="flex items-center justify-end gap-2">
            <button
              onClick={onClose}
              className="rounded-lg px-4 py-2 text-sm text-secondary hover:text-primary transition-colors"
            >
              {t('importExport.cancel')}
            </button>
            <button
              onClick={handleImport}
              disabled={!file || importing}
              className="flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent/90 transition-colors disabled:opacity-50"
            >
              {importing && <Loader2 size={14} className="animate-spin" />}
              {importing ? t('importExport.importing') : t('importExport.confirm')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
