/**
 * Comment mentions.
 *
 * Stored form: `@[Display Name](user_xxx)` — readable as raw text (API, email)
 * and carrying the id the server notifies. Agents may also write a bare
 * `@user_xxx`. Keep the pattern in sync with `MENTION_RE` in
 * `backend/src/novu.rs`.
 */
const MENTION_PATTERN = /@\[([^\]\n]{1,100})\]\((user_[a-zA-Z0-9]+)\)|@(user_[a-zA-Z0-9]+)/g;

export type CommentSegment =
  | { kind: 'text'; text: string }
  | { kind: 'mention'; userId: string; name: string | null };

export function splitMentions(body: string): CommentSegment[] {
  const out: CommentSegment[] = [];
  let last = 0;
  for (const m of body.matchAll(MENTION_PATTERN)) {
    const start = m.index ?? 0;
    if (start > last) out.push({ kind: 'text', text: body.slice(last, start) });
    out.push(m[2]
      ? { kind: 'mention', userId: m[2], name: m[1] }
      : { kind: 'mention', userId: m[3], name: null });
    last = start + m[0].length;
  }
  if (last < body.length) out.push({ kind: 'text', text: body.slice(last) });
  return out;
}

/** Brackets and newlines would end the stored token early. */
export function mentionToken(name: string, userId: string): string {
  const safe = name.replace(/[[\]\n]/g, ' ').trim().slice(0, 100) || userId;
  return `@[${safe}](${userId})`;
}

/**
 * What a mention chip shows: the stored name, or for an email only the part
 * before the @ (`eugenie.odinet@gmail.com` → `eugenie.odinet`).
 */
export function mentionChipLabel(name: string): string {
  const at = name.indexOf('@');
  return at > 0 && !name.includes(' ') ? name.slice(0, at) : name;
}

/**
 * The `@query` being typed right before the caret, if any. A mention starts at
 * the beginning of the text or after whitespace, so emails (`a@b`) don't open
 * the picker.
 */
export function activeMentionQuery(text: string, caret: number): { start: number; query: string } | null {
  const before = text.slice(0, caret);
  const m = /(^|\s)@([^\s@[\]()]{0,40})$/.exec(before);
  if (!m) return null;
  return { start: caret - m[2].length - 1, query: m[2] };
}
