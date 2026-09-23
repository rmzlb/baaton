import { describe, expect, it } from 'vitest';
import { mirrorIssueType } from '../wire';

describe('mirrorIssueType', () => {
  it('exposes the wire issue_type as type, in lists and nested objects', () => {
    const data = mirrorIssueType({
      items: [{ id: 'a', issue_type: 'bug' }, { id: 'b', issue_type: 'question' }],
      parent: { issue_type: 'improvement' },
    }) as { items: { type?: string }[]; parent: { type?: string } };
    expect(data.items.map((i) => i.type)).toEqual(['bug', 'question']);
    expect(data.parent.type).toBe('improvement');
  });

  it('keeps an explicit type and leaves objects without issue_type alone', () => {
    expect(mirrorIssueType({ type: 'feature', issue_type: 'bug' })).toEqual({ type: 'feature', issue_type: 'bug' });
    expect(mirrorIssueType({ type: 'issue.updated' })).toEqual({ type: 'issue.updated' });
    expect(mirrorIssueType(null)).toBeNull();
  });
});
