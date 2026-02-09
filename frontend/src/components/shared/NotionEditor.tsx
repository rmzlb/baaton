/**
 * Notion-style WYSIWYG editor powered by Novel (Tiptap).
 * Lightweight (~40KB), slash commands, bubble menu, dark/light mode.
 * https://novel.sh
 */
import { useCallback, useRef } from 'react';
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
  Placeholder,
  StarterKit,
  TaskList,
  TaskItem,
  TiptapLink,
  UpdatedImage,
  TiptapUnderline,
  HighlightExtension,
  HorizontalRule,
  // CodeBlockLowlight removed — needs lowlight instance, too heavy
  Color,
  TextStyle,
  GlobalDragHandle,
  CustomKeymap,
} from 'novel';
import { useTranslation } from '@/hooks/useTranslation';
import { cn } from '@/lib/utils';
import {
  Heading1, Heading2, Heading3, List, ListOrdered, CheckSquare,
  Code, Quote, Minus, Bold, Italic, Underline, Strikethrough,
  Code2, Highlighter,
} from 'lucide-react';

// ─── Slash command items ────────────────────────
const suggestionItems = createSuggestionItems([
  { title: 'Heading 1', description: 'Large heading', searchTerms: ['h1', 'title'], icon: <Heading1 size={18} />, command: ({ editor, range }) => { editor.chain().focus().deleteRange(range).setNode('heading', { level: 1 }).run(); } },
  { title: 'Heading 2', description: 'Medium heading', searchTerms: ['h2', 'subtitle'], icon: <Heading2 size={18} />, command: ({ editor, range }) => { editor.chain().focus().deleteRange(range).setNode('heading', { level: 2 }).run(); } },
  { title: 'Heading 3', description: 'Small heading', searchTerms: ['h3'], icon: <Heading3 size={18} />, command: ({ editor, range }) => { editor.chain().focus().deleteRange(range).setNode('heading', { level: 3 }).run(); } },
  { title: 'Bullet List', description: 'Unordered list', searchTerms: ['ul', 'unordered'], icon: <List size={18} />, command: ({ editor, range }) => { editor.chain().focus().deleteRange(range).toggleBulletList().run(); } },
  { title: 'Numbered List', description: 'Ordered list', searchTerms: ['ol', 'ordered'], icon: <ListOrdered size={18} />, command: ({ editor, range }) => { editor.chain().focus().deleteRange(range).toggleOrderedList().run(); } },
  { title: 'Task List', description: 'Checklist', searchTerms: ['todo', 'checkbox'], icon: <CheckSquare size={18} />, command: ({ editor, range }) => { editor.chain().focus().deleteRange(range).toggleTaskList().run(); } },
  { title: 'Code Block', description: 'Code snippet', searchTerms: ['code', 'pre'], icon: <Code size={18} />, command: ({ editor, range }) => { editor.chain().focus().deleteRange(range).toggleCodeBlock().run(); } },
  { title: 'Blockquote', description: 'Quote block', searchTerms: ['quote', 'cite'], icon: <Quote size={18} />, command: ({ editor, range }) => { editor.chain().focus().deleteRange(range).toggleBlockquote().run(); } },
  { title: 'Divider', description: 'Horizontal rule', searchTerms: ['hr', 'separator', 'line'], icon: <Minus size={18} />, command: ({ editor, range }) => { editor.chain().focus().deleteRange(range).setHorizontalRule().run(); } },
]);

// ─── Extensions config ──────────────────────────
function getExtensions(placeholder: string) {
  return [
    StarterKit.configure({
      heading: { levels: [1, 2, 3] },
      dropcursor: { color: '#f59e0b', width: 2 },
    }),
    Placeholder.configure({ placeholder }),
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
    CustomKeymap,
  ];
}

// ─── Bubble toolbar (uses useEditor hook) ───────
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

// ─── Props ──────────────────────────────────────
interface NotionEditorProps {
  initialContent?: JSONContent | string;
  /** Called on every change. Receives plain text (for storage as markdown/string). */
  onChange?: (text: string) => void;
  placeholder?: string;
  editable?: boolean;
  className?: string;
  theme?: 'light' | 'dark';
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

  // Parse initial content
  const parsedContent: JSONContent | undefined = typeof initialContent === 'string' && initialContent.trim()
    ? { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: initialContent }] }] }
    : (initialContent as JSONContent | undefined);

  const handleUpdate = useCallback(
    ({ editor }: { editor: EditorInstance }) => {
      editorRef.current = editor;
      // Output plain text for storage compatibility
      const text = editor.getText();
      onChange?.(text);
    },
    [onChange],
  );

  return (
    <div className={cn('novel-editor rounded-lg border border-border bg-surface overflow-hidden', className)}>
      <EditorRoot>
        <EditorContent
          initialContent={parsedContent}
          extensions={getExtensions(resolvedPlaceholder)}
          editable={editable}
          onUpdate={handleUpdate}
          editorProps={{
            handleDOMEvents: {
              keydown: (_view, event) => handleCommandNavigation(event),
            },
            attributes: {
              class: cn(
                'prose prose-sm dark:prose-invert prose-headings:font-bold',
                'prose-p:my-1 prose-headings:my-2',
                'focus:outline-none min-h-[120px] px-4 py-3',
                'max-w-none',
                !editable && 'cursor-default',
              ),
            },
          }}
        >
          {/* Slash commands menu */}
          <EditorCommand className="z-50 rounded-lg border border-border bg-surface shadow-xl overflow-hidden">
            <EditorCommandEmpty className="px-3 py-2 text-sm text-muted">
              {t('editor.nothingToPreview')}
            </EditorCommandEmpty>
            <EditorCommandList>
              {suggestionItems.map((item) => (
                <EditorCommandItem
                  key={item.title}
                  value={item.title}
                  onCommand={(val) => item.command?.(val)}
                  className="flex items-center gap-3 px-3 py-2 text-sm text-primary hover:bg-surface-hover cursor-pointer aria-selected:bg-surface-hover"
                >
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border bg-bg text-secondary">
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

          {/* Bubble menu (appears on text selection) */}
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
 * Read-only viewer — renders JSON content with Novel.
 */
export function NotionViewer({
  content,
  className,
}: {
  content: JSONContent | string;
  className?: string;
  theme?: 'light' | 'dark';
}) {
  return <NotionEditor initialContent={content} editable={false} className={className} />;
}
