/**
 * @vitest-environment node
 *
 * The permission picker is the only place a human grants API credentials, so a
 * scope that exists in the backend but not here is invisible — and a scope shown
 * here but unknown to the backend is rejected at creation with a 422.
 *
 * The generic i18n test tolerates up to 5 missing keys, so it would not catch an
 * unlabelled permission (it would render as a raw `apiKeys.perm.x:y` string).
 * These tests bind the three sources together: the backend vocabulary, the UI
 * groups, and both locales.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import en from '../locales/en';
import fr from '../locales/fr';
import { PERMISSION_GROUPS } from '../pages/ApiKeys';

/** Scope vocabulary parsed from the Rust source: the single source of truth. */
function backendScopes(): string[] {
  const src = readFileSync(
    join(__dirname, '../../../backend/src/routes/api_keys.rs'),
    'utf8',
  );
  const block = src.split('VALID_PERMISSIONS: &[&str] = &[')[1]?.split('];')[0];
  if (!block) throw new Error('VALID_PERMISSIONS literal not found in api_keys.rs');
  return [...block.matchAll(/"([a-z-]+:[a-z]+)"/g)].map((m) => m[1]);
}

const uiScopes = PERMISSION_GROUPS.flatMap((g) => [...g.perms]);

describe('API key permission picker', () => {
  it('parses a plausible backend vocabulary', () => {
    expect(backendScopes().length).toBeGreaterThan(20);
  });

  it('offers every scope the backend accepts', () => {
    const missing = backendScopes().filter((s) => !uiScopes.includes(s));
    expect(missing).toEqual([]);
  });

  it('offers no scope the backend would reject', () => {
    const unknown = uiScopes.filter((s) => !backendScopes().includes(s));
    expect(unknown).toEqual([]);
  });

  it('labels every scope in EN and FR', () => {
    const unlabelled = uiScopes.flatMap((s) => {
      const key = `apiKeys.perm.${s}`;
      return [
        ...((en as Record<string, string>)[key] ? [] : [`EN ${key}`]),
        ...((fr as Record<string, string>)[key] ? [] : [`FR ${key}`]),
      ];
    });
    expect(unlabelled).toEqual([]);
  });

  it('labels every group in EN and FR', () => {
    const unlabelled = PERMISSION_GROUPS.flatMap((g) => {
      const key = `apiKeys.permGroup.${g.key}`;
      return [
        ...((en as Record<string, string>)[key] ? [] : [`EN ${key}`]),
        ...((fr as Record<string, string>)[key] ? [] : [`FR ${key}`]),
      ];
    });
    expect(unlabelled).toEqual([]);
  });

  it('exposes key management as its own group, separate from admin', () => {
    const group = PERMISSION_GROUPS.find((g) => g.key === 'apiKeys');
    expect(group).toBeDefined();
    expect([...group!.perms]).toEqual(['api-keys:read', 'api-keys:write']);
    // Granting key management must be a deliberate act, not a side effect of
    // ticking `admin:full`.
    const admin = PERMISSION_GROUPS.find((g) => g.key === 'admin');
    expect([...admin!.perms]).toEqual(['admin:full']);
  });

  it('lists no scope twice across groups', () => {
    expect(uiScopes.length).toBe(new Set(uiScopes).size);
  });
});
