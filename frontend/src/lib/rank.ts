import { generateKeyBetween } from 'fractional-indexing';

/**
 * Compute a fractional-indexing rank that sorts strictly between `prevRank`
 * and `nextRank`. Handles all edge cases:
 *   - empty column        → computeRankBetween(null, null)
 *   - insert at top        → computeRankBetween(null, firstRank)
 *   - insert at bottom     → computeRankBetween(lastRank, null)
 *   - insert between       → computeRankBetween(prevRank, nextRank)
 *
 * `generateKeyBetween` requires strictly ordered args; if a neighbour has a
 * null/undefined rank (not yet backfilled) we treat it as an open bound.
 */
export function computeRankBetween(
  prevRank?: string | null,
  nextRank?: string | null,
): string {
  const a = prevRank ?? null;
  const b = nextRank ?? null;
  // generateKeyBetween throws if a >= b; guard by dropping the invalid bound.
  if (a !== null && b !== null && a >= b) {
    return generateKeyBetween(a, null);
  }
  return generateKeyBetween(a, b);
}
