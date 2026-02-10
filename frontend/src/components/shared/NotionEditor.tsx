/**
 * Notion-style WYSIWYG editor powered by Novel (Tiptap).
 * Slash commands, bubble menu, dark/light mode.
 */
import { useMemo, useCallback, useRef } from 'react';
import {
  EditorRoot,
  EditorContent,
  EditorCommand,
  EditorCommandItem,
  EditorCommandEmpty,
  EditorCommandList,
  EditorBubble,
  type JSONContent,
  type EditorInstance,
  useEditor as useNovelEditor,
  createSuggestionItems,
  handleCommandNavigation,
  handleImagePaste,
  handleImageDrop,
  createImageUpload,
  Command,
  renderItems,
  Placeholder,
  StarterKit,
  TaskList,
  TaskItem,
  TiptapLink,
  UpdatedImage,
  TiptapUnderline,
  HighlightExtension,
  HorizontalRule,
  Color,
  TextStyle,
  GlobalDragHandle,
} from 'novel';
import { generateJSON } from '@tiptap/core';
import { useTranslation } from '@/hooks/useTranslation';
import { cn } from '@/lib/utils';
import {
  Heading1, Heading2, Heading3, List, ListOrdered, CheckSquare,
  Code, Quote, Minus, Bold, Italic, Underline, Strikethrough,
  Code2, Highlighter, Type, ImageIcon,
} from 'lucide-react';

// ─── Slash command items (static, never re-created) ─
const SUGGESTION_ITEMS = createSuggestionItems([
  {
    title: 'Text',
    description: 'Plain paragraph',
    searchTerms: ['p', 'paragraph', 'text'],
    icon: <Type size={18} />,
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).toggleNode('paragraph', 'paragraph').run();
    },
  },
  {
    title: 'Heading 1',
    description: 'Large heading',
    searchTerms: ['h1', 'title', 'big'],
    icon: <Heading1 size={18} />,
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).setNode('heading', { level: 1 }).run();
    },
  },
  {
    title: 'Heading 2',
    description: 'Medium heading',
    searchTerms: ['h2', 'subtitle'],
    icon: <Heading2 size={18} />,
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).setNode('heading', { level: 2 }).run();
    },
  },
  {
    title: 'Heading 3',
    description: 'Small heading',
    searchTerms: ['h3'],
    icon: <Heading3 size={18} />,
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).setNode('heading', { level: 3 }).run();
    },
  },
  {
    title: 'Bullet List',
    description: 'Unordered list',
    searchTerms: ['ul', 'unordered', 'list'],
    icon: <List size={18} />,
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).toggleBulletList().run();
    },
  },
  {
    title: 'Numbered List',
    description: 'Ordered list',
    searchTerms: ['ol', 'ordered', 'numbered'],
    icon: <ListOrdered size={18} />,
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).toggleOrderedList().run();
    },
  },
  {
    title: 'Task List',
    description: 'Checklist with checkboxes',
    searchTerms: ['todo', 'checkbox', 'task'],
    icon: <CheckSquare size={18} />,
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).toggleTaskList().run();
    },
  },
  {
    title: 'Code Block',
    description: 'Code snippet',
    searchTerms: ['code', 'pre', 'snippet'],
    icon: <Code size={18} />,
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).toggleCodeBlock().run();
    },
  },
  {
    title: 'Blockquote',
    description: 'Quote block',
    searchTerms: ['quote', 'cite', 'blockquote'],
    icon: <Quote size={18} />,
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).toggleBlockquote().run();
    },
  },
  {
    title: 'Divider',
    description: 'Horizontal rule',
    searchTerms: ['hr', 'separator', 'line', 'divider'],
    icon: <Minus size={18} />,
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).setHorizontalRule().run();
    },
  },
  {
    title: 'Image',
    description: 'Upload or paste an image',
    searchTerms: ['image', 'photo', 'picture', 'img'],
    icon: <ImageIcon size={18} />,
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).run();
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      input.onchange = async (e) => {
        const file = (e.target as HTMLInputElement).files?.[0];
        if (file) {
          const url = await uploadImage(file);
          if (url) {
            editor.chain().focus().setImage({ src: url }).run();
          }
        }
      };
      input.click();
    },
  },
]);

// ─── Image upload handler (converts to base64 data URL) ─
const uploadImage = createImageUpload({
  onUpload: (file: File): Promise<string> => {
    return new Promise((resolve) => {
      const MAX = 1920;
      const img = new window.Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        URL.revokeObjectURL(url);
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
        // Use WebP if supported, fallback to JPEG
        const webp = canvas.toDataURL('image/webp', 0.82);
        if (webp.startsWith('data:image/webp')) {
          resolve(webp);
        } else {
          resolve(canvas.toDataURL('image/jpeg', 0.8));
        }
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.readAsDataURL(file);
      };
      img.src = url;
    });
  },
  validateFn: (file: File) => {
    if (!file.type.startsWith('image/')) return false;
    if (file.size > 20 * 1024 * 1024) return false;
    return true;
  },
});

// ─── Build extensions (must include Command for slash menu) ─
function buildExtensions(placeholder: string) {
  return [
    StarterKit.configure({
      heading: { levels: [1, 2, 3] },
      dropcursor: { color: '#f59e0b', width: 2 },
    }),
    Placeholder.configure({
      placeholder,
      showOnlyWhenEditable: true,
    }),
    // Slash command extension — this is what makes "/" trigger the menu
    Command.configure({
      suggestion: {
        items: () => SUGGESTION_ITEMS,
        render: renderItems,
      },
    }),
    TaskList,
    TaskItem.configure({ nested: true }),
    TiptapLink.configure({ openOnClick: false, autolink: true }),
    UpdatedImage,
    TiptapUnderline,
    HighlightExtension.configure({ multicolor: true }),
    HorizontalRule,
    Color,
    TextStyle,
    GlobalDragHandle,
  ];
}

// ─── Bubble toolbar ─────────────────────────────
function BubbleToolbar() {
  const { editor } = useNovelEditor();
  if (!editor) return null;

  const buttons = [
    { key: 'bold', icon: <Bold size={14} />, active: editor.isActive('bold'), action: () => editor.chain().focus().toggleBold().run() },
    { key: 'italic', icon: <Italic size={14} />, active: editor.isActive('italic'), action: () => editor.chain().focus().toggleItalic().run() },
    { key: 'underline', icon: <Underline size={14} />, active: editor.isActive('underline'), action: () => editor.chain().focus().toggleUnderline().run() },
    { key: 'strike', icon: <Strikethrough size={14} />, active: editor.isActive('strike'), action: () => editor.chain().focus().toggleStrike().run() },
    { key: 'code', icon: <Code2 size={14} />, active: editor.isActive('code'), action: () => editor.chain().focus().toggleCode().run() },
    { key: 'highlight', icon: <Highlighter size={14} />, active: editor.isActive('highlight'), action: () => editor.chain().focus().toggleHighlight().run() },
  ];

  return (
    <>
      {buttons.map((btn) => (
        <button
          key={btn.key}
          type="button"
          onClick={btn.action}
          className={cn(
            'rounded p-1.5 transition-colors',
            btn.active ? 'bg-accent/20 text-accent' : 'text-secondary hover:text-primary hover:bg-surface-hover',
          )}
        >
          {btn.icon}
        </button>
      ))}
    </>
  );
}

// ─── Markdown → Tiptap JSON converter ───────────
function markdownToTiptap(md: string): JSONContent {
  const lines = md.split('\n');
  const content: JSONContent[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    const h3 = line.match(/^### (.+)/);
    if (h3) { content.push({ type: 'heading', attrs: { level: 3 }, content: [{ type: 'text', text: h3[1] }] }); continue; }
    const h2 = line.match(/^## (.+)/);
    if (h2) { content.push({ type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: h2[1] }] }); continue; }
    const h1 = line.match(/^# (.+)/);
    if (h1) { content.push({ type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: h1[1] }] }); continue; }

    // Task list items
    const task = line.match(/^- \[( |x)\] (.*)/);
    if (task) {
      const items: JSONContent[] = [];
      let j = i;
      while (j < lines.length) {
        const tm = lines[j].match(/^- \[( |x)\] (.*)/);
        if (!tm) break;
        items.push({
          type: 'taskItem',
          attrs: { checked: tm[1] === 'x' },
          content: tm[2] ? [{ type: 'paragraph', content: [{ type: 'text', text: tm[2] }] }] : [{ type: 'paragraph' }],
        });
        j++;
      }
      content.push({ type: 'taskList', content: items });
      i = j - 1;
      continue;
    }

    const ul = line.match(/^- (.+)/);
    if (ul) {
      const items: JSONContent[] = [];
      let j = i;
      while (j < lines.length && lines[j].match(/^- (.+)/)) {
        const m = lines[j].match(/^- (.+)/)!;
        items.push({ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: m[1] }] }] });
        j++;
      }
      content.push({ type: 'bulletList', content: items });
      i = j - 1;
      continue;
    }

    const ol = line.match(/^\d+\. (.*)/);
    if (ol) {
      const items: JSONContent[] = [];
      let j = i;
      while (j < lines.length && lines[j].match(/^\d+\. (.*)/)) {
        const m = lines[j].match(/^\d+\. (.*)/)!;
        items.push({
          type: 'listItem',
          content: [{ type: 'paragraph', content: m[1] ? [{ type: 'text', text: m[1] }] : [] }],
        });
        j++;
      }
      content.push({ type: 'orderedList', content: items });
      i = j - 1;
      continue;
    }

    if (!line.trim()) { content.push({ type: 'paragraph' }); continue; }
    content.push({ type: 'paragraph', content: [{ type: 'text', text: line }] });
  }

  return { type: 'doc', content: content.length > 0 ? content : [{ type: 'paragraph' }] };
}

// ─── Props ──────────────────────────────────────
interface NotionEditorProps {
  initialContent?: JSONContent | string;
  onChange?: (html: string) => void;
  placeholder?: string;
  editable?: boolean;
  className?: string;
}

export function NotionEditor({
  initialContent,
  onChange,
  placeholder,
  editable = true,
  className,
}: NotionEditorProps) {
  const { t } = useTranslation();
  const resolvedPlaceholder = placeholder || t('editor.placeholder');
  const editorRef = useRef<EditorInstance | null>(null);

  // Memoize extensions so they don't re-create on every render
  const extensions = useMemo(
    () => buildExtensions(resolvedPlaceholder),
    [resolvedPlaceholder],
  );

  // Parse initial content — memoize to avoid re-parsing
  const parsedContent = useMemo((): JSONContent | undefined => {
    if (typeof initialContent === 'string' && initialContent.trim()) {
      if (initialContent.trim().startsWith('<')) {
        return generateJSON(initialContent, extensions) as JSONContent;
      }
      return markdownToTiptap(initialContent);
    }
    return initialContent as JSONContent | undefined;
  }, [initialContent, extensions]);

  const handleUpdate = useCallback(
    ({ editor }: { editor: EditorInstance }) => {
      editorRef.current = editor;
      onChange?.(editor.getHTML());
    },
    [onChange],
  );

  return (
    <div className={cn('novel-editor', className)}>
      <EditorRoot>
        <EditorContent
          initialContent={parsedContent}
          extensions={extensions}
          editable={editable}
          onUpdate={handleUpdate}
          editorProps={{
            handleDOMEvents: {
              keydown: (_view, event) => {
                return handleCommandNavigation(event) ?? false;
              },
            },
            handlePaste: (view, event) => handleImagePaste(view, event, uploadImage),
            handleDrop: (view, event, _slice, moved) => handleImageDrop(view, event, moved, uploadImage),
            attributes: {
              class: 'focus:outline-none min-h-[120px]',
            },
          }}
        >
          {/* Slash commands menu — appears when user types "/" */}
          {editable && (
            <EditorCommand className="z-50 rounded-lg border border-border bg-surface shadow-xl overflow-hidden max-h-[330px] overflow-y-auto">
              <EditorCommandEmpty className="px-4 py-3 text-sm text-muted">
                No results
              </EditorCommandEmpty>
              <EditorCommandList>
                {SUGGESTION_ITEMS.map((item) => (
                  <EditorCommandItem
                    key={item.title}
                    value={item.title}
                    onCommand={(val) => item.command?.(val)}
                    className="flex items-center gap-3 px-3 py-2.5 text-sm text-primary hover:bg-surface-hover cursor-pointer aria-selected:bg-surface-hover transition-colors"
                  >
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border bg-bg text-secondary">
                      {item.icon}
                    </span>
                    <div>
                      <p className="font-medium">{item.title}</p>
                      <p className="text-xs text-muted">{item.description}</p>
                    </div>
                  </EditorCommandItem>
                ))}
              </EditorCommandList>
            </EditorCommand>
          )}

          {/* Bubble toolbar — appears on text selection */}
          {editable && (
            <EditorBubble className="flex items-center gap-0.5 rounded-lg border border-border bg-surface px-1.5 py-1 shadow-xl">
              <BubbleToolbar />
            </EditorBubble>
          )}
        </EditorContent>
      </EditorRoot>
    </div>
  );
}

/**
 * Read-only viewer.
 */
export function NotionViewer({
  content,
  className,
}: {
  content: JSONContent | string;
  className?: string;
}) {
  return <NotionEditor initialContent={content} editable={false} className={className} />;
}
