import type { Issue } from './types';

export interface CreatorIdentity {
  /** The person to credit: the reporter behind an API key, else the creator. */
  name: string;
  /** The API key that wrote the issue, when a human is credited through it. */
  via: string | null;
}

type ResolveUserName = (id: string | null | undefined, fallback?: string | null) => string;

/**
 * Who created an issue, as a reader understands it.
 *
 * An issue written through an API key carries the key as its creator
 * (`created_by_id = apikey:<id>`, `created_by_name = <key name>`), yet the
 * person who asked for it is usually known: the reporter an integration such
 * as the Sqare assistant attaches. That person is credited, and the key is
 * kept as the channel it came through.
 */
export function creatorIdentity(
  issue: Pick<Issue, 'created_by_id' | 'created_by_name' | 'reporter_name' | 'reporter_email'>,
  resolveUserName: ResolveUserName,
): CreatorIdentity {
  const keyName = issue.created_by_name?.trim() || null;
  if (issue.created_by_id?.startsWith('apikey:')) {
    const reporter = issue.reporter_name?.trim() || issue.reporter_email?.trim() || null;
    if (reporter) return { name: reporter, via: keyName ?? 'API' };
    return { name: keyName ?? 'API', via: null };
  }
  return { name: resolveUserName(issue.created_by_id, issue.created_by_name), via: null };
}
