/**
 * Lightweight Markdown Editor — GitHub-style.
 * Textarea + toolbar + live preview toggle.
 * Zero heavy deps — uses react-markdown (already installed).
 * ~5KB vs 500KB+ for BlockNote.
 */
import { useRef, useCallback, useState } from 'react';
import {
  Bold, Italic, Code, Heading2, List, ListOrdered,
  Link, Image, Eye, EyeOff, Quote, CheckSquare,
} from 'lucide-react';
import { MarkdownView } from './MarkdownView';
import { cn } from '@/lib/utils';

interface NotionEditorProps {
  initialContent?: string;
  onChange?: (md: string) => void;
  placeholder?: string;
  editable?: boolean;
  className?: string;
  minRows?: number;
  theme?: 'light' | 'dark';
}

// ─── Toolbar action ───────────────────────────
type Action = { icon: typeof Bold; label: string; prefix: string; suffix?: string; block?: boolean };

const ACTIONS: Action[] = [
  { icon: Bold, label: 'Bold', prefix: '**', suffix: '**' },
  { icon: Italic, label: 'Italic', prefix: '*', suffix: '*' },
  { icon: Code, label: 'Code', prefix: '`', suffix: '`' },
  { icon: Heading2, label: 'Heading', prefix: '## ', block: true },
  { icon: Quote, label: 'Quote', prefix: '> ', block: true },
  { icon: List, label: 'List', prefix: '- ', block: true },
  { icon: ListOrdered, label: 'Ordered', prefix: '1. ', block: true },
  { icon: CheckSquare, label: 'Task', prefix: '- [ ] ', block: true },
  { icon: Link, label: 'Link', prefix: '[', suffix: '](url)' },
];

export function NotionEditor({
  initialContent = '',
  onChange,
  placeholder = 'Write in Markdown…',
  editable = true,
  className,
  minRows = 8,
}: NotionEditorProps) {
  const [value, setValue] = useState(initialContent);
  const [preview, setPreview] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);

  // Read-only mode — just render markdown
  if (!editable) {
    return (
      <div className={cn('prose-sm', className)}>
        <MarkdownView content={initialContent || value} />
      </div>
    );
  }

  const handleChange = useCallback(
    (text: string) => {
      setValue(text);
      onChange?.(text);
    },
    [onChange],
  );

  // Insert markdown syntax at cursor
  const insert = useCallback(
    (action: Action) => {
      const ta = ref.current;
      if (!ta) return;
      const start = ta.selectionStart;
      const end = ta.selectionEnd;
      const selected = value.slice(start, end);
      const before = value.slice(0, start);
      const after = value.slice(end);

      let newText: string;
      let cursorPos: number;

      if (action.block) {
        // Block-level: insert at line start
        const lineStart = before.lastIndexOf('\n') + 1;
        const beforeLine = value.slice(0, lineStart);
        const rest = value.slice(lineStart);
        newText = beforeLine + action.prefix + rest;
        cursorPos = lineStart + action.prefix.length + (end - lineStart);
      } else {
        // Inline: wrap selection
        const suffix = action.suffix || '';
        newText = before + action.prefix + (selected || action.label.toLowerCase()) + suffix + after;
        cursorPos = start + action.prefix.length + (selected ? selected.length : action.label.toLowerCase().length);
      }

      handleChange(newText);
      // Restore cursor after React re-render
      requestAnimationFrame(() => {
        ta.focus();
        ta.setSelectionRange(cursorPos, cursorPos);
      });
    },
    [value, handleChange],
  );

  // Handle image paste from clipboard
  const handlePaste = useCallback(
    (e: React.ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;

      for (const item of items) {
        if (item.type.startsWith('image/')) {
          e.preventDefault();
          const file = item.getAsFile();
          if (!file) return;

          const reader = new FileReader();
          reader.onload = () => {
            const dataUrl = reader.result as string;
            const ta = ref.current;
            if (!ta) return;
            const pos = ta.selectionStart;
            const before = value.slice(0, pos);
            const after = value.slice(pos);
            const imgMd = `![image](${dataUrl})\n`;
            handleChange(before + imgMd + after);
          };
          reader.readAsDataURL(file);
          return;
        }
      }
    },
    [value, handleChange],
  );

  // Image upload via file picker
  const handleImageUpload = useCallback(() => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = reader.result as string;
        const ta = ref.current;
        if (!ta) return;
        const pos = ta.selectionStart;
        const before = value.slice(0, pos);
        const after = value.slice(pos);
        handleChange(before + `![${file.name}](${dataUrl})\n` + after);
      };
      reader.readAsDataURL(file);
    };
    input.click();
  }, [value, handleChange]);

  // Keyboard shortcuts
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key === 'b') { e.preventDefault(); insert(ACTIONS[0]); }
      if (mod && e.key === 'i') { e.preventDefault(); insert(ACTIONS[1]); }
      if (mod && e.key === 'e') { e.preventDefault(); insert(ACTIONS[2]); }
      if (mod && e.key === 'k') { e.preventDefault(); insert(ACTIONS[8]); }
    },
    [insert],
  );

  return (
    <div className={cn('rounded-lg border border-border bg-surface overflow-hidden', className)}>
      {/* Toolbar */}
      <div className="flex items-center gap-0.5 border-b border-border px-2 py-1 bg-surface-hover/30">
        {ACTIONS.map((action) => (
          <button
            key={action.label}
            type="button"
            onClick={() => insert(action)}
            className="rounded p-1.5 text-muted hover:text-primary hover:bg-surface-hover transition-colors"
            title={action.label}
          >
            <action.icon size={14} />
          </button>
        ))}

        {/* Image upload */}
        <button
          type="button"
          onClick={handleImageUpload}
          className="rounded p-1.5 text-muted hover:text-primary hover:bg-surface-hover transition-colors"
          title="Upload image"
        >
          <Image size={14} />
        </button>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Preview toggle */}
        <button
          type="button"
          onClick={() => setPreview(!preview)}
          className={cn(
            'flex items-center gap-1 rounded px-2 py-1 text-[10px] transition-colors',
            preview ? 'text-accent bg-accent/10' : 'text-muted hover:text-primary',
          )}
        >
          {preview ? <EyeOff size={12} /> : <Eye size={12} />}
          {preview ? 'Edit' : 'Preview'}
        </button>
      </div>

      {/* Editor / Preview */}
      {preview ? (
        <div className="p-4 min-h-[160px] text-sm">
          {value ? (
            <MarkdownView content={value} />
          ) : (
            <p className="text-muted italic text-sm">Nothing to preview</p>
          )}
        </div>
      ) : (
        <textarea
          ref={ref}
          value={value}
          onChange={(e) => handleChange(e.target.value)}
          onPaste={handlePaste}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          rows={minRows}
          className="w-full bg-transparent text-sm text-primary p-4 outline-none resize-y min-h-[160px] placeholder-muted"
        />
      )}
    </div>
  );
}

/**
 * Read-only viewer — just renders markdown with the MarkdownView component.
 */
export function NotionViewer({
  content,
  className,
}: {
  content: string;
  className?: string;
  theme?: 'light' | 'dark';
}) {
  return (
    <div className={cn('prose-sm', className)}>
      <MarkdownView content={content} />
    </div>
  );
}
