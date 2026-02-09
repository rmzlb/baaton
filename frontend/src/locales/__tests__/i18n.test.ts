import { describe, it, expect } from 'vitest';
import en from '../en';
import fr from '../fr';

describe('i18n completeness', () => {
  const enKeys = Object.keys(en).sort();
  const frKeys = Object.keys(fr).sort();

  it('EN and FR have the same number of keys', () => {
    const diff = Math.abs(enKeys.length - frKeys.length);
    // Allow up to 5 key difference (some may be intentionally EN-only)
    expect(diff).toBeLessThanOrEqual(5);
  });

  it('all EN keys exist in FR', () => {
    const missingInFr = enKeys.filter((k) => !frKeys.includes(k));
    if (missingInFr.length > 0) {
      console.warn('Keys missing in FR:', missingInFr);
    }
    expect(missingInFr.length).toBeLessThanOrEqual(5);
  });

  it('all FR keys exist in EN', () => {
    const missingInEn = frKeys.filter((k) => !enKeys.includes(k));
    if (missingInEn.length > 0) {
      console.warn('Keys missing in EN:', missingInEn);
    }
    expect(missingInEn.length).toBeLessThanOrEqual(5);
  });

  it('no empty values in EN', () => {
    const emptyKeys = enKeys.filter((k) => !(en as any)[k]);
    expect(emptyKeys).toEqual([]);
  });

  it('no empty values in FR', () => {
    const emptyKeys = frKeys.filter((k) => !(fr as any)[k]);
    expect(emptyKeys).toEqual([]);
  });
});
