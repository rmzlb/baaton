/**
 * Notification UX tests — pure logic + type contract
 *
 * Mirrors the component logic without React rendering (React 19 CJS act issue).
 * Tests the behavioral rules that the new UX enforces:
 *
 * 1. Effective value = override ?? default (no customize gate)
 * 2. Reset button visible only when override exists
 * 3. Status chips state computed directly from effective value
 * 4. org_name field present on ProjectSubscription
 * 5. Multi-org grouping and search filter logic
 * 6. Unverified channel: reconnect action path exists
 * 7. TelegramLinkResult: command field optional
 * 8. setChannel supports threadId for Telegram topics
 */

import { describe, it, expect } from 'vitest';
import type {
  ProjectSubscription,
  UserNotificationChannel,
  TelegramBotInfo,
  TelegramLinkResult,
} from '@/lib/types';

// ─── Factories ────────────────────────────────────────────────────────────────

function makeSub(overrides: Partial<ProjectSubscription> = {}): ProjectSubscription {
  return {
    project_id: 'proj-1',
    project_name: 'Alpha',
    project_slug: 'alpha',
    org_id: 'org-1',
    org_name: 'Acme',
    enabled: true,
    notify_comments: null,
    notify_issue_created: null,
    notify_statuses: null,
    channels: ['telegram'],
    project_defaults: {
      notify_statuses: ['in_progress'],
      notify_comments: false,
      notify_issue_created: true,
    },
    statuses: [
      { key: 'todo', label: 'Todo', color: '#888' },
      { key: 'in_progress', label: 'In Progress', color: '#f59e0b' },
    ],
    ...overrides,
  };
}

function makeChannel(overrides: Partial<UserNotificationChannel> = {}): UserNotificationChannel {
  return {
    channel: 'telegram',
    address_masked: '***1234',
    verified: true,
    created_at: '2024-01-01T00:00:00Z',
    telegram_thread_id: null,
    telegram_bot_username: null,
    ...overrides,
  };
}

// ─── Effective value logic (override ?? default) ──────────────────────────────

/** Mirrors the effective-value pattern used throughout the new UX */
function effectiveBool(override: boolean | null, dflt: boolean): boolean {
  return override ?? dflt;
}

function effectiveStatuses(override: string[] | null, dflt: string[]): string[] {
  return override ?? dflt;
}

/** Whether the reset button is shown: only when override is non-null */
function hasOverride<T>(v: T | null): v is T {
  return v !== null;
}

describe('effective value: override ?? default', () => {
  it('null override uses default (false)', () => {
    expect(effectiveBool(null, false)).toBe(false);
  });

  it('null override uses default (true)', () => {
    expect(effectiveBool(null, true)).toBe(true);
  });

  it('explicit override true beats default false', () => {
    expect(effectiveBool(true, false)).toBe(true);
  });

  it('explicit override false beats default true', () => {
    expect(effectiveBool(false, true)).toBe(false);
  });

  it('null statuses override falls back to defaults', () => {
    const sub = makeSub({ notify_statuses: null });
    const effective = effectiveStatuses(sub.notify_statuses, sub.project_defaults.notify_statuses);
    expect(effective).toEqual(['in_progress']);
  });

  it('explicit statuses override uses override, not defaults', () => {
    const sub = makeSub({ notify_statuses: ['todo', 'done'] });
    const effective = effectiveStatuses(sub.notify_statuses, sub.project_defaults.notify_statuses);
    expect(effective).toEqual(['todo', 'done']);
  });
});

// ─── Reset button visibility ──────────────────────────────────────────────────

describe('reset button: visible only when override exists', () => {
  it('no reset when notify_comments is null (inherited)', () => {
    const sub = makeSub({ notify_comments: null });
    expect(hasOverride(sub.notify_comments)).toBe(false);
  });

  it('reset shown when notify_comments is explicitly true', () => {
    const sub = makeSub({ notify_comments: true });
    expect(hasOverride(sub.notify_comments)).toBe(true);
  });

  it('reset shown when notify_comments is explicitly false', () => {
    const sub = makeSub({ notify_comments: false });
    expect(hasOverride(sub.notify_comments)).toBe(true);
  });

  it('no reset when notify_issue_created is null', () => {
    const sub = makeSub({ notify_issue_created: null });
    expect(hasOverride(sub.notify_issue_created)).toBe(false);
  });

  it('no reset when notify_statuses is null', () => {
    const sub = makeSub({ notify_statuses: null });
    expect(hasOverride(sub.notify_statuses)).toBe(false);
  });

  it('reset shown when notify_statuses has explicit override', () => {
    const sub = makeSub({ notify_statuses: ['todo'] });
    expect(hasOverride(sub.notify_statuses)).toBe(true);
  });
});

// ─── Status chip toggle logic ─────────────────────────────────────────────────

/** Mirrors handleToggleStatus: toggle a key in the effective list */
function toggleStatusInList(current: string[], key: string): string[] {
  return current.includes(key)
    ? current.filter((k) => k !== key)
    : [...current, key];
}

describe('status chip: direct toggle (no customize gate)', () => {
  it('adding an inactive status appends it', () => {
    expect(toggleStatusInList(['in_progress'], 'todo')).toEqual(['in_progress', 'todo']);
  });

  it('removing an active status filters it out', () => {
    expect(toggleStatusInList(['in_progress', 'todo'], 'in_progress')).toEqual(['todo']);
  });

  it('toggling last status yields empty array', () => {
    expect(toggleStatusInList(['todo'], 'todo')).toEqual([]);
  });

  it('works on inherited effective list (override was null, now editing)', () => {
    const sub = makeSub({ notify_statuses: null });
    const defaults = sub.project_defaults.notify_statuses; // ['in_progress']
    const effective = effectiveStatuses(sub.notify_statuses, defaults);
    // Toggle 'todo' onto inherited list
    const next = toggleStatusInList(effective, 'todo');
    expect(next).toEqual(['in_progress', 'todo']);
    // This next value becomes the new override (non-null)
    expect(hasOverride<string[]>(next)).toBe(true);
  });
});

// ─── Multi-org grouping logic ─────────────────────────────────────────────────

interface ProjectOption {
  project_id: string;
  project_name: string;
  org_id: string;
  org_name: string;
}

function groupByOrg(options: ProjectOption[]): Map<string, { org_name: string; projects: ProjectOption[] }> {
  const groups = new Map<string, { org_name: string; projects: ProjectOption[] }>();
  for (const o of options) {
    if (!groups.has(o.org_id)) groups.set(o.org_id, { org_name: o.org_name, projects: [] });
    groups.get(o.org_id)!.projects.push(o);
  }
  return groups;
}

function filterOptions(options: ProjectOption[], search: string): ProjectOption[] {
  if (!search.trim()) return options;
  const q = search.toLowerCase();
  return options.filter(
    (o) => o.project_name.toLowerCase().includes(q) || o.org_name.toLowerCase().includes(q),
  );
}

describe('multi-org grouping', () => {
  const subs = [
    makeSub({ project_id: 'p1', project_name: 'Alpha', org_id: 'org-1', org_name: 'Acme' }),
    makeSub({ project_id: 'p2', project_name: 'Beta', org_id: 'org-2', org_name: 'Globex' }),
    makeSub({ project_id: 'p3', project_name: 'Gamma', org_id: 'org-1', org_name: 'Acme' }),
  ];
  const options: ProjectOption[] = subs.map((s) => ({
    project_id: s.project_id,
    project_name: s.project_name,
    org_id: s.org_id,
    org_name: s.org_name,
  }));

  it('groups options by org_id', () => {
    const groups = groupByOrg(options);
    expect(groups.size).toBe(2);
    expect(groups.get('org-1')!.projects).toHaveLength(2);
    expect(groups.get('org-2')!.projects).toHaveLength(1);
  });

  it('preserves org_name per group', () => {
    const groups = groupByOrg(options);
    expect(groups.get('org-1')!.org_name).toBe('Acme');
    expect(groups.get('org-2')!.org_name).toBe('Globex');
  });

  it('empty search returns all options', () => {
    expect(filterOptions(options, '')).toHaveLength(3);
  });

  it('search by project name (case insensitive)', () => {
    const result = filterOptions(options, 'bet');
    expect(result).toHaveLength(1);
    expect(result[0].project_name).toBe('Beta');
  });

  it('search by org name', () => {
    const result = filterOptions(options, 'acme');
    expect(result).toHaveLength(2);
    expect(result.map((o) => o.org_name)).toEqual(['Acme', 'Acme']);
  });

  it('search with no match returns empty array', () => {
    expect(filterOptions(options, 'zzznomatch')).toHaveLength(0);
  });

  it('selected count = number of enabled subs', () => {
    const enabled = subs.filter((s) => s.enabled);
    expect(enabled.length).toBe(3); // all enabled in fixture
    const selectedSet = new Set(enabled.map((s) => s.project_id));
    expect(selectedSet.size).toBe(3);
  });
});

// ─── Channel verification UX ──────────────────────────────────────────────────

/**
 * In the new UX, unverified channels show a "Reconnect" action path
 * without requiring delete first.
 *
 * This models the decision: showReconnect = existing && !verified
 */
function channelUxState(existing: UserNotificationChannel | undefined): {
  showVerified: boolean;
  showReconnect: boolean;
  showConnect: boolean;
} {
  if (!existing) return { showVerified: false, showReconnect: false, showConnect: true };
  return {
    showVerified: existing.verified,
    showReconnect: !existing.verified,
    showConnect: false,
  };
}

describe('channel UX state', () => {
  it('no existing channel → show Connect, hide Verified/Reconnect', () => {
    const state = channelUxState(undefined);
    expect(state.showConnect).toBe(true);
    expect(state.showVerified).toBe(false);
    expect(state.showReconnect).toBe(false);
  });

  it('verified channel → show Verified, hide Reconnect and Connect', () => {
    const state = channelUxState(makeChannel({ verified: true }));
    expect(state.showVerified).toBe(true);
    expect(state.showReconnect).toBe(false);
    expect(state.showConnect).toBe(false);
  });

  it('unverified channel → show Reconnect, hide Verified and Connect', () => {
    const state = channelUxState(makeChannel({ verified: false }));
    expect(state.showReconnect).toBe(true);
    expect(state.showVerified).toBe(false);
    expect(state.showConnect).toBe(false);
  });
});

// ─── Type contracts ───────────────────────────────────────────────────────────

describe('type contracts — new fields on types', () => {
  it('UserNotificationChannel has telegram_thread_id and telegram_bot_username', () => {
    const ch = makeChannel();
    // Compile-time: TypeScript would fail if fields don't exist on type.
    expect('telegram_thread_id' in ch).toBe(true);
    expect('telegram_bot_username' in ch).toBe(true);
  });

  it('UserNotificationChannel telegram_thread_id can be number or null', () => {
    const withThread = makeChannel({ telegram_thread_id: 12345 });
    expect(withThread.telegram_thread_id).toBe(12345);
    expect(makeChannel().telegram_thread_id).toBeNull();
  });

  it('TelegramBotInfo has source and can_link fields', () => {
    const bot: TelegramBotInfo = {
      bot_username: 'mybot',
      owned: true,
      webhook_registered: true,
      source: 'personal',
      can_link: true,
    };
    expect(bot.source).toBe('personal');
    expect(bot.can_link).toBe(true);
  });

  it('TelegramBotInfo source can be instance', () => {
    const bot: TelegramBotInfo = {
      bot_username: 'sharedbot',
      owned: false,
      webhook_registered: true,
      source: 'instance',
      can_link: true,
    };
    expect(bot.source).toBe('instance');
  });

  it('TelegramLinkResult has optional command field', () => {
    const withCommand: TelegramLinkResult = {
      deep_link: 'https://t.me/bot?start=abc',
      expires_at: '2024-01-01T01:00:00Z',
      command: '/start abc123',
    };
    const withoutCommand: TelegramLinkResult = {
      deep_link: 'https://t.me/bot?start=abc',
      expires_at: '2024-01-01T01:00:00Z',
    };
    expect(withCommand.command).toBe('/start abc123');
    expect(withoutCommand.command).toBeUndefined();
  });

  it('ProjectSubscription has org_name field', () => {
    const sub = makeSub();
    expect('org_name' in sub).toBe(true);
    expect(sub.org_name).toBe('Acme');
  });

  it('ProjectSubscription org_name is a string (not same as org_id)', () => {
    const sub = makeSub({ org_id: 'org-abc-123', org_name: 'Human-Readable Corp' });
    expect(typeof sub.org_name).toBe('string');
    expect(sub.org_name).toBe('Human-Readable Corp');
    expect(sub.org_id).toBe('org-abc-123');
    expect(sub.org_id).not.toBe(sub.org_name);
  });
});

// ─── setChannel with threadId ─────────────────────────────────────────────────

describe('setChannel body construction', () => {
  function buildSetChannelBody(
    channel: string,
    address: string,
    threadId?: number | null,
  ): Record<string, unknown> {
    const body: Record<string, unknown> = { address };
    if (channel === 'telegram' && threadId != null) {
      body.telegram_thread_id = threadId;
    }
    return body;
  }

  it('plain telegram setChannel has only address', () => {
    const body = buildSetChannelBody('telegram', '123456');
    expect(body).toEqual({ address: '123456' });
  });

  it('telegram setChannel with threadId includes telegram_thread_id', () => {
    const body = buildSetChannelBody('telegram', '-1001234567', 42);
    expect(body).toEqual({ address: '-1001234567', telegram_thread_id: 42 });
  });

  it('non-telegram channel ignores threadId', () => {
    const body = buildSetChannelBody('slack', 'https://hooks.slack.com/x', 99);
    expect(body).toEqual({ address: 'https://hooks.slack.com/x' });
  });

  it('threadId null is not included', () => {
    const body = buildSetChannelBody('telegram', '123456', null);
    expect(body).not.toHaveProperty('telegram_thread_id');
  });
});

// ─── getTelegramLink kind param ───────────────────────────────────────────────

describe('getTelegramLink opts', () => {
  function buildLinkBody(opts?: { kind?: 'private' | 'group' }): Record<string, unknown> {
    return opts ?? {};
  }

  it('no opts → empty body', () => {
    expect(buildLinkBody()).toEqual({});
  });

  it('kind private → { kind: "private" }', () => {
    expect(buildLinkBody({ kind: 'private' })).toEqual({ kind: 'private' });
  });

  it('kind group → { kind: "group" }', () => {
    expect(buildLinkBody({ kind: 'group' })).toEqual({ kind: 'group' });
  });
});

// ─── cacheScope per-user scoping ──────────────────────────────────────────────

describe('cacheScope user scoping', () => {
  function makeCacheScope(userId: string | null | undefined) {
    return ['notif-prefs', userId ?? 'anon'] as readonly string[];
  }

  it('different users produce different cache scopes', () => {
    const user1 = makeCacheScope('user-abc');
    const user2 = makeCacheScope('user-xyz');
    expect(user1).not.toEqual(user2);
  });

  it('same user produces same cache scope', () => {
    expect(makeCacheScope('user-abc')).toEqual(makeCacheScope('user-abc'));
  });

  it('null user falls back to anon scope', () => {
    expect(makeCacheScope(null)).toEqual(['notif-prefs', 'anon']);
  });

  it('subscriptions and channels use separate sub-keys', () => {
    const scope = makeCacheScope('user-1');
    const channelsKey = [...scope, 'channels'];
    const subsKey = [...scope, 'subscriptions'];
    expect(channelsKey).not.toEqual(subsKey);
  });
});
