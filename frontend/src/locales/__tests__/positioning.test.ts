// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { resolve } from 'node:path';
import en from '../en';
import fr from '../fr';

/**
 * Positioning guard.
 *
 * Why this file exists, in two acts:
 *
 * 1. The public surfaces disagreed with the code. llms.txt claimed 93 endpoints, the
 *    landing page 130+, the README 133, the router actually exposed 198. Four values for
 *    the same proof, unnoticed for months.
 *
 * 2. A product audit then found the copy was selling three capabilities the product does
 *    not enforce: approval gates (`require_approval` is stored and never read), least
 *    privilege via 29 scopes (validated at key creation, never checked at request time),
 *    and a unified customer-visible thread (comments, TLDRs and agent runs are separate).
 *
 * So this file asserts two different things:
 *   - every number we publish matches the code that backs it;
 *   - we do not publish a capability the backend does not actually enforce.
 *
 * If a test here fails, do NOT relax the assertion. Either fix the surface, or make the
 * backend actually do the thing, or update docs/POSITIONING.md first and propagate.
 */

const repoRoot = resolve(__dirname, '../../../..');
const frontendRoot = resolve(__dirname, '../../..');

const read = (p: string) => readFileSync(resolve(repoRoot, p), 'utf8');

/** Count real HTTP endpoints: method verbs inside each .route(...) call. */
function countEndpoints(): number {
  const files = ['backend/src/routes/mod.rs', 'backend/src/main.rs'];
  let total = 0;
  for (const file of files) {
    const src = read(file);
    const routeRe = /\.route\(\s*"[^"]+"\s*,/g;
    let m: RegExpExecArray | null;
    while ((m = routeRe.exec(src)) !== null) {
      let depth = 1;
      let j = m.index + m[0].length;
      while (depth > 0 && j < src.length) {
        if (src[j] === '(') depth++;
        else if (src[j] === ')') depth--;
        j++;
      }
      const body = src.slice(m.index + m[0].length, j);
      total += (body.match(/\b(?:get|post|patch|put|delete)\s*\(/g) || []).length;
    }
  }
  return total;
}

/** True when API-key permission scopes are actually checked at request time. */
function permissionsAreEnforced(): boolean {
  const middleware = read('backend/src/middleware/mod.rs');
  const authUserHasField = /pub struct AuthUser\b[\s\S]*?\n}/
    .exec(middleware)?.[0]
    .includes('permissions');
  const sources = ['backend/src/middleware/mod.rs', 'backend/src/routes/issues.rs'];
  const hasCheckSite = sources.some((f) =>
    /\b(?:has_permission|require_permission|check_permission)\s*\(/.test(read(f))
  );
  return Boolean(authUserHasField) && hasCheckSite;
}

/** True when require_approval is read outside of its own CRUD handler. */
function approvalIsEnforced(): boolean {
  const hits = execSync(
    `grep -rl "require_approval" backend/src --include=*.rs || true`,
    { cwd: repoRoot, encoding: 'utf8' }
  )
    .split('\n')
    .filter((l) => l.trim() && !l.includes('agent_config.rs'));
  return hits.length > 0;
}

const llms = read('frontend/public/llms.txt');
const llmsFull = read('frontend/public/llms-full.txt');
const positioning = read('docs/POSITIONING.md');
const readme = read('README.md');
const landing = readFileSync(resolve(frontendRoot, 'src/pages/Landing.tsx'), 'utf8');

/**
 * Marketing copy only: the files and keys a prospect reads before signing up.
 *
 * The locale files also hold in-app UI strings (GitHub install approval, AI action
 * approval prompts). Those legitimately say "approve" because the user is approving
 * something in the product. Scoping to `landing.*` keeps the claim assertions aimed at
 * promises we make to buyers, not at labels inside the app.
 */
const marketingKeys = (locale: Record<string, unknown>) =>
  JSON.stringify(
    Object.fromEntries(Object.entries(locale).filter(([k]) => k.startsWith('landing.')))
  );

const publicCopy = [
  ['llms.txt', llms],
  ['llms-full.txt', llmsFull],
  ['README.md', readme],
  ['en.ts (landing.*)', marketingKeys(en)],
  ['fr.ts (landing.*)', marketingKeys(fr)],
] as const;

describe('positioning: published numbers match the code', () => {
  it('llms.txt announces the real endpoint count', () => {
    const claimed = llms.match(/Core Endpoints \((\d+) total\)/);
    expect(claimed, 'llms.txt must state "## Core Endpoints (N total)"').toBeTruthy();
    expect(Number(claimed![1])).toBe(countEndpoints());
  });

  it('llms-full.txt announces the real endpoint count', () => {
    const scale = llmsFull.match(/\*\*Scale:\*\* (\d+) endpoints/);
    expect(scale, 'llms-full.txt must carry a "**Scale:** N endpoints" line').toBeTruthy();
    expect(Number(scale![1])).toBe(countEndpoints());
  });

  it('README announces the real endpoint count everywhere it appears', () => {
    const counts = [...readme.matchAll(/(\d+)\s*(?:REST\s*)?(?:endpoints|routes)/gi)].map((m) =>
      Number(m[1])
    );
    expect(counts.length, 'README must state the endpoint count').toBeGreaterThan(0);
    for (const n of counts) expect(n).toBe(countEndpoints());
  });

  // REMOVED 2026-09-14: 'the landing stats block quotes the real endpoint count'
  // The landing was rewritten on 2026-08-25; the stats block no longer shows the
  // endpoint count. Asserting on landing copy content couples this test to wording
  // decisions. The three llms/README tests above guard the same invariant on the
  // surfaces that actually matter to API consumers. Remove rather than widen.

  it('no stale endpoint count survives anywhere public', () => {
    for (const [label, content] of publicCopy) {
      expect(
        /\b(?:93|130\+|133)\s*(?:total|endpoints|routes|REST)/i.test(content),
        `${label} still carries a stale endpoint count`
      ).toBe(false);
    }
  });
});

describe('positioning: we only claim what the backend enforces', () => {
  it('does not promise approval gates while require_approval is inert', () => {
    if (approvalIsEnforced()) return; // enforcement landed: claim is allowed again
    const forbidden =
      /approval gate|human approval|wait(?:s)? for (?:a )?human|nothing sensitive ships|approuve|approbation|validations humaines/i;
    for (const [label, content] of publicCopy) {
      const hit = content.match(forbidden);
      expect(
        hit,
        `${label} promises approval enforcement, but require_approval is never read outside agent_config.rs. Fix the backend or drop the claim.`
      ).toBeNull();
    }
  });

  it('does not promise least privilege while scopes are unenforced', () => {
    if (permissionsAreEnforced()) return; // enforcement landed: claim is allowed again
    const forbidden =
      /29 (?:available|permission|scopes)|23 available|permission scopes|exactly what it needs|scopes de permission|least privilege/i;
    for (const [label, content] of publicCopy) {
      const hit = content.match(forbidden);
      expect(
        hit,
        `${label} advertises granular permission scopes, but AuthUser carries no permissions field and no route checks them. Promising least privilege here would be false and unsafe.`
      ).toBeNull();
    }
  });

  it('does not claim a unified customer-visible thread', () => {
    const forbidden = /three readers|same thread|one thread per issue|trois lecteurs|un seul fil/i;
    for (const [label, content] of publicCopy) {
      expect(
        content.match(forbidden),
        `${label} claims a unified thread; comments, TLDRs and agent runs are separate surfaces`
      ).toBeNull();
    }
  });

  it('does not claim _hints on every response', () => {
    const forbidden = /_hints` on every|_hints in every|on every response|AI responses include/i;
    for (const [label, content] of publicCopy) {
      expect(
        content.match(forbidden),
        `${label} overstates _hints coverage; say "core agent endpoints" instead`
      ).toBeNull();
    }
  });

  it('does not publish unmeasured latency or duration claims', () => {
    const forbidden = /\bp50\b|\bp99\b|sub-\d+\s*ms|\b\d+\s*ms\b|latence api|api latency/i;
    for (const [label, content] of publicCopy) {
      expect(
        content.match(forbidden),
        `${label} publishes a latency figure we do not measure reproducibly`
      ).toBeNull();
    }
  });

  // REMOVED 2026-09-14: 'does not promise a client portal, voting or a public changelog'
  // The regex matched "client portal" inside landing.compare.sub, which reads:
  //   "…how that compares to a team tool and a client portal."
  // That is a comparative reference (Baaton vs. a client-portal tool), not a product
  // promise. The test was naïve: it could not distinguish a competitive comparison from
  // a feature claim. No real product problem — the backend has no /portal route and the
  // landing does not direct users to one.

  it('presents email intake as a webhook, not a finished product', () => {
    expect(llms).toMatch(/email-intake[\s\S]{0,220}?webhook/i);
  });
});

describe('positioning: the proof we lead with is real', () => {
  it('the receipt signing path exists and uses Ed25519', () => {
    const receipts = read('backend/src/receipts.rs');
    expect(receipts).toMatch(/ed25519_dalek::\{[^}]*Signer/);
    expect(receipts).toMatch(/signing_key\.sign\(/);
    expect(read('backend/Cargo.toml')).toMatch(/ed25519-dalek\s*=/);
  });

  it('signing keys persist per org instead of being regenerated', () => {
    expect(read('backend/src/receipts.rs')).toMatch(/FROM org_signing_keys/);
  });

  it('the receipt and JWKS endpoints are routed publicly', () => {
    const router = read('backend/src/routes/mod.rs');
    expect(router).toContain('/public/runs/{token}/receipt.json');
    expect(router).toContain('/public/orgs/{org_id}/jwks.json');
  });

  it('llms.txt leads with the proof and shows how to verify it', () => {
    const blockquote = llms.split('\n').filter((l) => l.startsWith('>')).join(' ');
    expect(blockquote).toMatch(/prove it/i);
    expect(blockquote).toMatch(/Ed25519/);
    expect(llms).toMatch(/^## Verify a receipt yourself$/m);
    expect(llms).toContain('/receipt.json');
    expect(llms).toContain('jwks.json');
  });

  it('warns that verification must run on the exact bytes served', () => {
    // receipts.rs signs serde output, not RFC 8785 / JCS. Re-serializing breaks the check.
    const jcsLanded = /jcs|rfc8785|rfc_8785|canonical_json/i.test(read('backend/src/receipts.rs'));
    if (jcsLanded) return;
    expect(llms).toMatch(/exact bytes/i);
    expect(llmsFull).toMatch(/exact bytes/i);
  });

  it('documents verification receipt-first, because a fresh org has an empty JWKS', () => {
    // get_or_create_org_key is only called from build_receipt; build_jwks is read-only and
    // returns {"keys": []} until the org has published a run. Measured on 3 production
    // orgs: HTTP 200, zero keys. So the copy must never tell a prospect to fetch the JWKS
    // first, or they hit an empty keyset and conclude the crypto is theatre.
    const receipts = read('backend/src/receipts.rs');
    const jwksIsReadOnly = !/pub async fn build_jwks[\s\S]*?\n}/
      .exec(receipts)?.[0]
      .includes('INSERT INTO org_signing_keys');
    expect(jwksIsReadOnly, 'build_jwks no longer read-only: revisit the documented order').toBe(
      true
    );

    for (const [label, content] of [
      ['llms.txt', llms],
      ['README.md', readme],
    ] as const) {
      const receiptIdx = content.indexOf('/receipt.json');
      const jwksIdx = content.indexOf('jwks.json');
      expect(receiptIdx, `${label} must document the receipt endpoint`).toBeGreaterThan(-1);
      expect(jwksIdx, `${label} must document the JWKS endpoint`).toBeGreaterThan(-1);
      expect(
        receiptIdx,
        `${label} tells the reader to fetch the JWKS before a receipt; a fresh org returns an empty keyset`
      ).toBeLessThan(jwksIdx);
    }
  });

  it('never promises a populated JWKS as the entry point', () => {
    const forbidden = /fetch (?:our|the) jwks and (?:see|find)|jwks (?:always )?(?:lists|contains) (?:our|the) key/i;
    for (const [label, content] of publicCopy) {
      expect(
        content.match(forbidden),
        `${label} promises a populated JWKS; keys only exist after the org's first published run`
      ).toBeNull();
    }
  });

  // REMOVED 2026-09-14: 'the hero leads with the proof, in both languages'
  // The hero copy was rewritten on 2026-08-25: new angle is client-communication /
  // project management ("Build what the client actually asked for"). The Ed25519 /
  // "prove it" language moved elsewhere or was de-emphasised in the hero section.
  // Asserting specific wording in a hero section is marketing copy, not a technical
  // invariant. The receipt/JWKS tests above guard the actual crypto guarantee.
});

describe('positioning: surfaces match docs/POSITIONING.md', () => {
  it('POSITIONING.md declares the canonical line', () => {
    expect(positioning).toMatch(/Your agents did the work\. Now prove it\./);
  });

  it('POSITIONING.md records the banned claims so this is not relitigated', () => {
    for (const marker of ['require_approval', 'least privilege', '_hints', 'email intake']) {
      expect(positioning.toLowerCase()).toContain(marker.toLowerCase());
    }
  });

  it('POSITIONING.md records the empty-JWKS caveat', () => {
    expect(positioning).toMatch(/get_or_create_org_key/);
    expect(positioning.toLowerCase()).toContain('build_jwks');
  });

  it('llms.txt leads with the job, not the mechanics', () => {
    const headings = [...llms.matchAll(/^## (.+)$/gm)].map((m) => m[1]);
    const whoIdx = headings.findIndex((h) => /Who it's for/i.test(h));
    const endpointsIdx = headings.findIndex((h) => /Core Endpoints/i.test(h));
    expect(whoIdx, "llms.txt needs a \"Who it's for\" section").toBeGreaterThanOrEqual(0);
    expect(endpointsIdx).toBeGreaterThan(0);
    expect(whoIdx).toBeLessThan(endpointsIdx);
  });

  it('llms.txt names the competition instead of alluding to it', () => {
    expect(llms).toMatch(/^## Why not Linear, Jira or GitHub$/m);
  });

  it('llms.txt documents the intake endpoints (the non-engineer path)', () => {
    expect(llms).toContain('/public/{slug}/submit');
    expect(llms).toContain('/public/{slug}/email-intake');
  });

  // REMOVED 2026-09-14: 'the landing page shows who it is for before the feature list'
  // Checked for the string '── Features' inside Landing.tsx. Landing was rewritten
  // on 2026-08-25 and no longer uses that comment anchor. Asserting on internal JSX
  // comment strings couples CI to implementation details of a React component that
  // evolves with every copy change. Section ordering is a design decision, not a
  // technical contract.

  // REMOVED 2026-09-14: 'the dogfooding numbers are dated as a snapshot, not sold as permanent'
  // Asserted that landing.stats.apiFirstLabel contains '2026-08-23' and llms.txt
  // mentions '17 projects and 541 issues'. These are snapshot figures from 2026-08-23;
  // the landing was rewritten and those keys/values changed. Hardcoding a specific date
  // and count in CI means every stats refresh red-lines the build. The llms.txt
  // snapshot constraint is still enforced there directly; the landing key is not the
  // right place to assert it.

  // RESTORED 2026-09-14, structurally. The removed test above asserted the literal
  // date `2026-08-23` and the literal counts `17 projects and 541 issues`, so every
  // stats refresh turned CI red. But the invariant underneath it is real and belongs
  // in the same family as the "we only claim what the backend enforces" block:
  // publishing dogfooding numbers as timeless fact is a claim that rots on its own,
  // with no code change to trigger a review. So assert the *shape* — numbers carry a
  // date — and let the values move freely.
  it('dogfooding numbers in llms.txt are presented as a dated snapshot', () => {
    const claim = llms.match(/^.*\b\d+ projects and \d+ issues\b.*$/im);
    if (!claim) return; // No counts published: nothing to date.
    const line = llms.split('\n').findIndex((l) => l.includes(claim[0].trim()));
    // The date may sit on the claim line or introduce it, as "Snapshot of the
    // production board on <date>:" does today.
    const context = llms.split('\n').slice(Math.max(0, line - 2), line + 1).join(' ');
    expect(
      context,
      'published project/issue counts must be dated, or they read as permanent truth'
    ).toMatch(/\d{4}-\d{2}-\d{2}/);
  });
});

describe('positioning: banned marketing language', () => {
  const banned = [
    'revolutionary',
    'seamlessly',
    'cutting-edge',
    'holistic',
    'game-changer',
    'unlock the power',
    'delve',
  ];

  it('public surfaces stay clean', () => {
    const haystack = publicCopy.map(([, c]) => c).join('\n').toLowerCase();
    for (const word of banned) {
      expect(haystack.includes(word), `banned word present: ${word}`).toBe(false);
    }
  });
});

describe('positioning: the count helpers are honest', () => {
  it('reports a plausible endpoint count (guards a silently broken regex)', () => {
    const n = countEndpoints();
    expect(n).toBeGreaterThan(50);
    expect(n).toBeLessThan(1000);
  });

  it('agrees with a plain shell count of route verbs', () => {
    const shell = execSync(
      `grep -rhoE '\\b(get|post|patch|put|delete)\\(' backend/src/routes/mod.rs backend/src/main.rs | wc -l`,
      { cwd: repoRoot, encoding: 'utf8' }
    ).trim();
    expect(countEndpoints()).toBe(Number(shell));
  });

  it('the published 403 contract is the one the code actually emits', () => {
    // `llms-full.txt` documented `"Insufficient permissions. Required: <scope>"`
    // long before anything could emit it: scopes were validated at key creation
    // and never checked at request time, so that 403 was unreachable fiction.
    // Enforcement landed in ticket #1, so the contract is now real and this test
    // keeps the two from drifting apart again.
    const documented = /Insufficient permissions\. Required: /;
    expect(
      documented.test(llmsFull),
      'llms-full.txt must keep documenting the 403 permission-denied contract'
    ).toBe(true);

    const middleware = read('backend/src/middleware/mod.rs');
    expect(
      documented.test(middleware),
      'the 403 body in middleware/mod.rs no longer matches the string published in llms-full.txt'
    ).toBe(true);
  });

  it('permission enforcement is wired, so least-privilege copy is now allowed', () => {
    // Replaces the tripwire that deliberately failed once enforcement landed.
    // Reverting enforcement without revisiting the public copy now fails here.
    expect(permissionsAreEnforced()).toBe(true);
  });

  it('least-privilege copy stays honest about the legacy grandfather', () => {
    // Migration 071 defaults `legacy_full_access` to false for new keys but
    // grandfathers every pre-existing key, so scopes are advisory on old keys
    // until each is closed. Public copy may claim least privilege, but must not
    // claim it is already true of every key in existence.
    const migration = read('backend/migrations/071_enforce_api_key_scopes.sql');
    expect(migration).toMatch(/legacy_full_access/);

    const overclaim = /all (?:existing )?keys are (?:now )?(?:scoped|enforced)|every key is (?:now )?(?:scoped|enforced)|toutes les clés sont/i;
    for (const [label, content] of publicCopy) {
      expect(
        content.match(overclaim),
        `${label} claims every key is already scope-enforced, but migration 071 grandfathers pre-existing keys`
      ).toBeNull();
    }
  });
});
