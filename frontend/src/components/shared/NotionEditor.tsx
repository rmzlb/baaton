/**
 * Notion-style block editor powered by BlockNote.
 * WYSIWYG editing with slash commands, drag & drop, image paste/upload.
 * Content stored as Markdown for compatibility.
 */
import { useCallback, useMemo } from 'react';
import { useCreateBlockNote } from '@blocknote/react';
import { BlockNoteView } from '@blocknote/shadcn';
import type { PartialBlock } from '@blocknote/core';
import '@blocknote/shadcn/style.css';
import '@blocknote/core/fonts/inter.css';

interface NotionEditorProps {
  /** Initial content as Markdown string */
  initialContent?: string;
  /** Called when content changes — receives Markdown string */
  onChange?: (markdown: string) => void;
  /** Placeholder text for empty editor */
  placeholder?: string;
  /** Whether the editor is read-only */
  editable?: boolean;
  /** Additional CSS classes */
  className?: string;
  /** Dark theme */
  theme?: 'light' | 'dark';
}

export function NotionEditor({
  initialContent,
  onChange,
  placeholder = 'Tapez / pour les commandes…',
  editable = true,
  className,
  theme,
}: NotionEditorProps) {
  // Convert initial markdown to blocks
  const initialBlocks = useMemo(() => {
    if (!initialContent) return undefined;
    // We'll set initial content via the editor API after creation
    return undefined;
  }, [initialContent]);

  // Image upload handler — converts to base64 data URL
  const uploadFile = useCallback(async (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }, []);

  const editor = useCreateBlockNote({
    initialContent: initialBlocks as PartialBlock[] | undefined,
    uploadFile,
    domAttributes: {
      editor: {
        'data-placeholder': placeholder,
      },
    },
  });

  // Set initial markdown content after editor creation
  useMemo(() => {
    if (initialContent && editor) {
      (async () => {
        try {
          const blocks = await editor.tryParseMarkdownToBlocks(initialContent);
          editor.replaceBlocks(editor.document, blocks);
        } catch {
          // If markdown parsing fails, leave editor empty
        }
      })();
    }
  }, [initialContent, editor]);

  // Handle content changes
  const handleChange = useCallback(async () => {
    if (!onChange || !editor) return;
    try {
      const markdown = await editor.blocksToMarkdownLossy(editor.document);
      onChange(markdown);
    } catch {
      // Ignore serialization errors during rapid typing
    }
  }, [onChange, editor]);

  // Detect theme from HTML class if not provided
  const resolvedTheme = theme || (
    typeof document !== 'undefined' && document.documentElement.classList.contains('dark')
      ? 'dark'
      : 'light'
  );

  return (
    <div className={`notion-editor ${className || ''}`}>
      <BlockNoteView
        editor={editor}
        editable={editable}
        onChange={handleChange}
        theme={resolvedTheme}
        data-theming-css-variables-demo
      />
    </div>
  );
}

/**
 * Lightweight read-only Notion renderer.
 * Renders Markdown content as BlockNote blocks (non-editable).
 */
export function NotionViewer({
  content,
  className,
  theme,
}: {
  content: string;
  className?: string;
  theme?: 'light' | 'dark';
}) {
  return (
    <NotionEditor
      initialContent={content}
      editable={false}
      className={className}
      theme={theme}
    />
  );
}
