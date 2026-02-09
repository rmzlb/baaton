import { useRef, useState, useCallback } from 'react';
import {
  Bold, Italic, Code, Link2, Heading1, List, ImageIcon, Eye, Pencil, Paperclip,
} from 'lucide-react';
import { useTranslation } from '@/hooks/useTranslation';
import { MarkdownView } from '@/components/shared/MarkdownView';
import { cn } from '@/lib/utils';

interface MarkdownEditorProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  minRows?: number;
}

export function MarkdownEditor({ value, onChange, placeholder, minRows = 8 }: MarkdownEditorProps) {
  const { t } = useTranslation();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<'write' | 'preview'>('write');

  const insertAtCursor = useCallback(
    (before: string, after = '') => {
      const ta = textareaRef.current;
      if (!ta) return;
      const start = ta.selectionStart;
      const end = ta.selectionEnd;
      const selected = value.slice(start, end);
      const newText = value.slice(0, start) + before + selected + after + value.slice(end);
      onChange(newText);
      // Restore cursor
      requestAnimationFrame(() => {
        ta.focus();
        const cursorPos = start + before.length + selected.length;
        ta.setSelectionRange(cursorPos, cursorPos);
      });
    },
    [value, onChange],
  );

  const handlePaste = useCallback(
    async (e: React.ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;

      for (const item of Array.from(items)) {
        if (item.type.startsWith('image/')) {
          e.preventDefault();
          const file = item.getAsFile();
          if (!file) continue;
          const base64 = await fileToBase64(file);
          insertAtCursor(`![image](${base64})\n`);
          return;
        }
      }
    },
    [insertAtCursor],
  );

  const handleFileUpload = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (!files) return;
      for (const file of Array.from(files)) {
        if (!file.type.startsWith('image/')) continue;
        const base64 = await fileToBase64(file);
        insertAtCursor(`![${file.name}](${base64})\n`);
      }
      // Reset input so same file can be selected again
      e.target.value = '';
    },
    [insertAtCursor],
  );

  const toolbar = [
    { icon: Bold, label: t('createIssue.bold'), action: () => insertAtCursor('**', '**') },
    { icon: Italic, label: t('createIssue.italic'), action: () => insertAtCursor('*', '*') },
    { icon: Code, label: t('createIssue.code'), action: () => insertAtCursor('`', '`') },
    { icon: Link2, label: t('createIssue.link'), action: () => insertAtCursor('[', '](url)') },
    { icon: Heading1, label: t('createIssue.heading'), action: () => insertAtCursor('## ') },
    { icon: List, label: t('createIssue.list'), action: () => insertAtCursor('- ') },
    { icon: ImageIcon, label: t('createIssue.image'), action: () => fileInputRef.current?.click() },
  ];

  return (
    <div className="rounded-lg border border-border bg-bg overflow-hidden">
      {/* Toolbar */}
      <div className="flex items-center justify-between border-b border-border px-2 py-1.5 bg-surface/50">
        <div className="flex items-center gap-0.5">
          {toolbar.map(({ icon: Icon, label, action }) => (
            <button
              key={label}
              type="button"
              onClick={action}
              className="rounded-md p-1.5 text-secondary hover:bg-surface-hover hover:text-primary transition-colors"
              title={label}
            >
              <Icon size={14} />
            </button>
          ))}
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="rounded-md p-1.5 text-secondary hover:bg-surface-hover hover:text-primary transition-colors"
            title={t('createIssue.uploadImage')}
          >
            <Paperclip size={14} />
          </button>
        </div>
        <div className="flex items-center rounded-md border border-border bg-surface p-0.5">
          <button
            type="button"
            onClick={() => setMode('write')}
            className={cn(
              'rounded-[4px] px-2 py-0.5 text-[10px] font-medium transition-colors flex items-center gap-1',
              mode === 'write' ? 'bg-surface-hover text-primary' : 'text-muted hover:text-secondary',
            )}
          >
            <Pencil size={10} />
            {t('createIssue.write')}
          </button>
          <button
            type="button"
            onClick={() => setMode('preview')}
            className={cn(
              'rounded-[4px] px-2 py-0.5 text-[10px] font-medium transition-colors flex items-center gap-1',
              mode === 'preview' ? 'bg-surface-hover text-primary' : 'text-muted hover:text-secondary',
            )}
          >
            <Eye size={10} />
            {t('createIssue.preview')}
          </button>
        </div>
      </div>

      {/* Content area */}
      {mode === 'write' ? (
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onPaste={handlePaste}
          placeholder={placeholder}
          rows={minRows}
          className="w-full bg-transparent text-sm text-primary p-3 outline-none resize-y min-h-[120px] placeholder-muted font-mono"
        />
      ) : (
        <div className="p-3 min-h-[120px] text-sm">
          {value ? (
            <MarkdownView content={value} />
          ) : (
            <p className="text-sm text-muted italic">{placeholder}</p>
          )}
        </div>
      )}

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={handleFileUpload}
      />
    </div>
  );
}

async function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.readAsDataURL(file);
  });
}
