import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { LexicalComposer } from '@lexical/react/LexicalComposer';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { PlainTextPlugin } from '@lexical/react/LexicalPlainTextPlugin';
import { ContentEditable } from '@lexical/react/LexicalContentEditable';
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary';
import { HistoryPlugin } from '@lexical/react/LexicalHistoryPlugin';
import { OnChangePlugin } from '@lexical/react/LexicalOnChangePlugin';
import { AutoFocusPlugin } from '@lexical/react/LexicalAutoFocusPlugin';
import { LexicalTypeaheadMenuPlugin, MenuOption, type MenuTextMatch } from '@lexical/react/LexicalTypeaheadMenuPlugin';
import {
  $applyNodeReplacement,
  $createLineBreakNode,
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $isElementNode,
  $isLineBreakNode,
  BLUR_COMMAND,
  COMMAND_PRIORITY_EDITOR,
  COMMAND_PRIORITY_HIGH,
  FOCUS_COMMAND,
  KEY_ENTER_COMMAND,
  KEY_ESCAPE_COMMAND,
  TextNode,
  mergeRegister,
  type EditorConfig,
  type LexicalNode,
  type NodeKey,
  type SerializedTextNode,
  type Spread,
} from 'lexical';
import { useTranslation } from '@/hooks/useTranslation';
import { cn } from '@/lib/utils';
import { activeMentionQuery, mentionChipLabel, mentionToken, splitMentions } from '@/lib/mentions';
import type { OrgMember } from '@/hooks/useOrgMembers';

const MAX_SUGGESTIONS = 6;

/** Name written into the stored token — unchanged since BAA-33. */
export function memberLabel(m: OrgMember): string {
  return `${m.first_name || ''} ${m.last_name || ''}`.trim() || m.email || m.user_id;
}

/** Name shown on the chip and in the picker: never the id. */
function memberChipLabel(m: OrgMember): string {
  return `${m.first_name || ''} ${m.last_name || ''}`.trim() || mentionChipLabel(m.email || '') || '?';
}

/* ── Mention node: an atomic `@Name` chip ─────────── */

type SerializedMentionNode = Spread<{ userId: string; storedName: string | null }, SerializedTextNode>;

const CHIP_CLASS =
  'rounded bg-accent/15 px-1 py-px font-medium text-accent [box-decoration-break:clone]';

export class MentionNode extends TextNode {
  __userId: string;
  /** Name inside the stored token; `null` for a bare `@user_xxx`. */
  __storedName: string | null;

  static getType(): string {
    return 'baaton-mention';
  }

  static clone(node: MentionNode): MentionNode {
    return new MentionNode(node.__text, node.__userId, node.__storedName, node.__key);
  }

  static importJSON(json: SerializedMentionNode): MentionNode {
    return $createMentionNode(json.text.replace(/^@/, ''), json.userId, json.storedName).updateFromJSON(json);
  }

  constructor(text: string, userId: string, storedName: string | null, key?: NodeKey) {
    super(text, key);
    this.__userId = userId;
    this.__storedName = storedName;
  }

  exportJSON(): SerializedMentionNode {
    return { ...super.exportJSON(), userId: this.__userId, storedName: this.__storedName };
  }

  createDOM(config: EditorConfig): HTMLElement {
    const dom = super.createDOM(config);
    dom.className = CHIP_CLASS;
    dom.spellcheck = false;
    dom.setAttribute('data-mention-id', this.__userId);
    return dom;
  }

  /** The text sent to the API for this chip. */
  toToken(): string {
    const self = this.getLatest();
    return self.__storedName === null ? `@${self.__userId}` : mentionToken(self.__storedName, self.__userId);
  }

  isTextEntity(): true {
    return true;
  }

  canInsertTextBefore(): boolean {
    return false;
  }

  canInsertTextAfter(): boolean {
    return false;
  }
}

function $createMentionNode(label: string, userId: string, storedName: string | null): MentionNode {
  return $applyNodeReplacement(new MentionNode(`@${label}`, userId, storedName)).setMode('token');
}

function $isMentionNode(node: LexicalNode | null | undefined): node is MentionNode {
  return node instanceof MentionNode;
}

/* ── Stored text ⇄ editor content ─────────────────── */

/** Editor content → `text @[Name](user_id) text`, exactly the format the server parses. */
function $serialize(): string {
  return $getRoot()
    .getChildren()
    .map((block) =>
      $isElementNode(block)
        ? block
            .getChildren()
            .map((n) => ($isMentionNode(n) ? n.toToken() : $isLineBreakNode(n) ? '\n' : n.getTextContent()))
            .join('')
        : block.getTextContent(),
    )
    .join('\n');
}

/** Stored text → editor content, each mention token becoming a chip. */
function $load(value: string, members: OrgMember[]) {
  const root = $getRoot();
  root.clear();
  const p = $createParagraphNode();
  const byId = new Map(members.map((m) => [m.user_id, m]));
  for (const seg of splitMentions(value)) {
    if (seg.kind === 'mention') {
      const member = byId.get(seg.userId);
      if (seg.name !== null) {
        p.append($createMentionNode(member ? memberChipLabel(member) : mentionChipLabel(seg.name), seg.userId, seg.name));
        continue;
      }
      if (member) {
        p.append($createMentionNode(memberChipLabel(member), seg.userId, null));
        continue;
      }
    }
    const text = seg.kind === 'text' ? seg.text : `@${seg.userId}`;
    text.split('\n').forEach((line, i) => {
      if (i > 0) p.append($createLineBreakNode());
      if (line) p.append($createTextNode(line));
    });
  }
  root.append(p);
}

/* ── Plugins ─────────────────────────────────────── */

/** Keeps the editor and the parent's string in step (clear after send, cancel…). */
function ValueSyncPlugin({ value, onChange, members }: { value: string; onChange: (v: string) => void; members: OrgMember[] }) {
  const [editor] = useLexicalComposerContext();
  const last = useRef(value);

  useEffect(() => {
    if (value === last.current) return;
    last.current = value;
    editor.update(() => $load(value, members));
  }, [editor, value, members]);

  return (
    <OnChangePlugin
      ignoreSelectionChange
      onChange={(state) => {
        const next = state.read($serialize);
        if (next === last.current) return;
        last.current = next;
        onChange(next);
      }}
    />
  );
}

function KeysPlugin({ onSubmit, onEscape, onFocusChange }: { onSubmit?: () => void; onEscape?: () => void; onFocusChange: (f: boolean) => void }) {
  const [editor] = useLexicalComposerContext();
  useEffect(
    () =>
      mergeRegister(
        // Above the picker: ⌘/Ctrl+Enter always sends, even with suggestions open.
        editor.registerCommand(
          KEY_ENTER_COMMAND,
          (e) => {
            if (!e || !(e.metaKey || e.ctrlKey) || !onSubmit) return false;
            e.preventDefault();
            onSubmit();
            return true;
          },
          COMMAND_PRIORITY_HIGH,
        ),
        // Below the picker, which handles Escape itself while open.
        editor.registerCommand(
          KEY_ESCAPE_COMMAND,
          () => {
            if (!onEscape) return false;
            onEscape();
            return true;
          },
          COMMAND_PRIORITY_EDITOR,
        ),
        editor.registerCommand(FOCUS_COMMAND, () => (onFocusChange(true), false), COMMAND_PRIORITY_EDITOR),
        editor.registerCommand(BLUR_COMMAND, () => (onFocusChange(false), false), COMMAND_PRIORITY_EDITOR),
      ),
    [editor, onSubmit, onEscape, onFocusChange],
  );
  return null;
}

class MemberOption extends MenuOption {
  member: OrgMember;
  constructor(member: OrgMember) {
    super(member.user_id);
    this.member = member;
  }
}

/** `@query` before the caret; same rule as before: start of text or after whitespace. */
function mentionTrigger(text: string): MenuTextMatch | null {
  const m = activeMentionQuery(text, text.length);
  if (!m) return null;
  return { leadOffset: m.start, matchingString: m.query, replaceableString: `@${m.query}` };
}

/* ── Component ───────────────────────────────────── */

interface MentionTextareaProps {
  value: string;
  onChange: (value: string) => void;
  /** Members of the issue's org — the only people who can be mentioned. */
  members: OrgMember[];
  /** ⌘/Ctrl+Enter. */
  onSubmit?: () => void;
  /** Escape while the picker is closed. Unset: Escape reaches the drawer. */
  onEscape?: () => void;
  placeholder?: string;
  ariaLabel?: string;
  rows?: number;
  autoFocus?: boolean;
  className?: string;
}

/**
 * Plain-text comment field with an `@` member picker. A chosen member shows as
 * an atomic `@Name` chip; the value stays `@[Name](user_id)`, which the server
 * turns into a notification.
 */
export function MentionTextarea({ value, onChange, members, onSubmit, onEscape, placeholder, ariaLabel, rows = 2, autoFocus, className }: MentionTextareaProps) {
  const { t } = useTranslation();
  const [query, setQuery] = useState<string | null>(null);
  const [focused, setFocused] = useState(false);
  const membersRef = useRef(members);
  membersRef.current = members;

  const initialConfig = useMemo(
    () => ({
      namespace: 'baaton-comment',
      nodes: [MentionNode],
      theme: { paragraph: 'm-0' },
      onError: (error: Error) => {
        throw error;
      },
      editorState: () => $load(value, membersRef.current),
    }),
    // Built once per mount; later values go through ValueSyncPlugin.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const options = useMemo(() => {
    if (query === null) return [];
    const q = query.toLowerCase();
    return members
      .filter((m) => !q || memberChipLabel(m).toLowerCase().includes(q) || (m.email || '').toLowerCase().includes(q))
      .slice(0, MAX_SUGGESTIONS)
      .map((m) => new MemberOption(m));
  }, [query, members]);

  const onSelectOption = useCallback((option: MemberOption, nodeToReplace: TextNode | null, closeMenu: () => void) => {
    const m = option.member;
    const chip = $createMentionNode(memberChipLabel(m), m.user_id, memberLabel(m));
    if (nodeToReplace) nodeToReplace.replace(chip);
    const space = $createTextNode(' ');
    chip.insertAfter(space);
    space.select(1, 1);
    closeMenu();
  }, []);

  const listId = `mentions-${useId().replace(/:/g, '')}`;
  const minHeight = `${rows * 1.25}rem`;

  return (
    <LexicalComposer initialConfig={initialConfig}>
      <div className="relative">
        <PlainTextPlugin
          contentEditable={
            <ContentEditable
              ariaLabel={ariaLabel}
              aria-placeholder={placeholder ?? ''}
              ariaMultiline
              placeholder={
                <div className="pointer-events-none absolute left-0 top-0 text-xs text-muted select-none">{placeholder}</div>
              }
              spellCheck
              style={{ minHeight }}
              className={cn('whitespace-pre-wrap break-words', className)}
            />
          }
          ErrorBoundary={LexicalErrorBoundary}
        />
        <HistoryPlugin />
        {autoFocus && <AutoFocusPlugin defaultSelection="rootEnd" />}
        <ValueSyncPlugin value={value} onChange={onChange} members={members} />
        <KeysPlugin onSubmit={onSubmit} onEscape={onEscape} onFocusChange={setFocused} />
        <LexicalTypeaheadMenuPlugin<MemberOption>
          triggerFn={mentionTrigger}
          onQueryChange={setQuery}
          onSelectOption={onSelectOption}
          options={options}
          // Lexical's caret anchor goes to <body>: keep it from catching clicks
          // (a click there would count as outside the drawer).
          anchorClassName="pointer-events-none"
          menuRenderFn={(_anchor, { selectedIndex, selectOptionAndCleanUp, setHighlightedIndex }) => {
            if (!focused) return null;
            // Rendered next to the field, inside the drawer, not in Lexical's <body> anchor.
            const list = (
              <div
                id={listId}
                role="listbox"
                aria-label={t('mentions.listLabel', { defaultValue: 'Mention a member' })}
                className="absolute bottom-full left-0 z-20 mb-1 w-64 max-w-full overflow-hidden rounded-xl border border-border bg-surface py-1"
              >
                {options.length === 0 ? (
                  <p className="px-3 py-2 text-[11px] text-muted">
                    {members.length === 0
                      ? t('mentions.loading', { defaultValue: 'Loading members…' })
                      : t('mentions.noMatch', { defaultValue: 'No member matches' })}
                  </p>
                ) : (
                  options.map((option, i) => {
                    const m = option.member;
                    const label = memberChipLabel(m);
                    return (
                      <button
                        key={option.key}
                        ref={option.setRefElement}
                        id={`${listId}-${m.user_id}`}
                        type="button"
                        role="option"
                        aria-selected={i === selectedIndex}
                        // mousedown, not click: keep the editor focused and its selection intact.
                        onMouseDown={(e) => {
                          e.preventDefault();
                          setHighlightedIndex(i);
                          selectOptionAndCleanUp(option);
                        }}
                        onMouseEnter={() => setHighlightedIndex(i)}
                        className={cn(
                          'flex w-full items-center gap-2 px-3 py-1.5 text-left transition-colors duration-150 ease-[cubic-bezier(0.16,1,0.3,1)]',
                          i === selectedIndex ? 'bg-surface-hover' : 'hover:bg-surface-hover',
                        )}
                      >
                        {m.image_url ? (
                          <img src={m.image_url} alt="" className="h-5 w-5 shrink-0 rounded-full" />
                        ) : (
                          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent/20 text-[8px] font-bold text-accent">
                            {label.slice(0, 2).toUpperCase()}
                          </span>
                        )}
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-xs text-primary">{label}</span>
                          {m.email && m.email !== label && <span className="block truncate text-[10px] text-muted">{m.email}</span>}
                        </span>
                      </button>
                    );
                  })
                )}
              </div>
            );
            return list;
          }}
        />
      </div>
    </LexicalComposer>
  );
}
