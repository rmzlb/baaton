/**
 * The API serializes an issue's classification as `issue_type` (the Rust field
 * name) while it accepts `type` on writes, and the frontend reads `issue.type`.
 * Without this bridge every card fell back to the "feature" icon and the drawer
 * showed a generic "Issue" label, whatever the real type.
 *
 * Applied once at the boundary (REST responses and SSE events): any object that
 * carries a string `issue_type` and no `type` gets `type` mirrored from it.
 */
export function mirrorIssueType<T>(value: T): T {
  if (Array.isArray(value)) {
    for (const item of value) mirrorIssueType(item);
    return value;
  }
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    if (typeof obj.issue_type === 'string' && obj.type === undefined) {
      obj.type = obj.issue_type;
    }
    for (const key in obj) {
      const child = obj[key];
      if (child && typeof child === 'object') mirrorIssueType(child);
    }
  }
  return value;
}
