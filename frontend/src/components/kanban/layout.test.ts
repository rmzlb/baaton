import { describe, expect, it } from 'vitest';
import { COLLAPSED_COLUMN_WIDTH, TIGHT_GAP, TIGHT_PADDING, getBoardLayout, getOffscreenSide } from './layout';

const base = { containerWidth: 1056, viewportWidth: 1280, columnCount: 5, emptyColumnCount: 0, density: 'default' as const };

function usedWidth(result: ReturnType<typeof getBoardLayout>, columns: number, empty = 0) {
  return (columns - empty) * result.columnWidth + empty * COLLAPSED_COLUMN_WIDTH
    + (columns - 1) * TIGHT_GAP + 2 * TIGHT_PADDING;
}

describe('auto-tight uses the real container and normal-density overflow', () => {
  it.each([1280, 1366, 1440])('fits five populated columns at %ipx with an expanded sidebar', (viewportWidth) => {
    // Also allow 15px for the document scrollbar gutter.
    const containerWidth = viewportWidth - 224 - 15;
    const result = getBoardLayout({ ...base, viewportWidth, containerWidth });
    expect(result.isTight).toBe(true);
    expect(usedWidth(result, 5)).toBeLessThanOrEqual(containerWidth);
    expect(result.columnWidth).toBeGreaterThanOrEqual(176);
  });

  it('can fit five populated + two empty columns at 1280px', () => {
    const containerWidth = 1280 - 224 - 15;
    const result = getBoardLayout({ ...base, containerWidth, columnCount: 7, emptyColumnCount: 2 });
    expect(result.isTight).toBe(true);
    expect(usedWidth(result, 7, 2)).toBeLessThanOrEqual(containerWidth);
  });

  it('responds to a sidebar/panel resize without a viewport resize', () => {
    const viewportWidth = 1920;
    expect(getBoardLayout({ ...base, viewportWidth, containerWidth: 1850 }).isTight).toBe(false);
    expect(getBoardLayout({ ...base, viewportWidth, containerWidth: 1200 }).isTight).toBe(true);
  });

  it('preserves the user density when all columns fit', () => {
    expect(getBoardLayout({ ...base, containerWidth: 1400, viewportWidth: 1600, density: 'compact' }).isTight).toBe(false);
    expect(getBoardLayout({ ...base, containerWidth: 1400, viewportWidth: 1600, density: 'spacious' }).isTight).toBe(true);
  });

  it('counts normal-layout padding and gaps at the boundary', () => {
    const needed = 5 * 320 + 4 * 16 + 48;
    expect(getBoardLayout({ ...base, containerWidth: needed }).isTight).toBe(false);
    expect(getBoardLayout({ ...base, containerWidth: needed - 1 }).isTight).toBe(true);
  });

  it('keeps readable columns and guided scrolling on narrow windows', () => {
    const result = getBoardLayout({ ...base, viewportWidth: 900, containerWidth: 650 });
    expect(result.isTight).toBe(true);
    expect(result.columnWidth).toBe(176);
    expect(usedWidth(result, 5)).toBeGreaterThan(650);
  });

  it.each([375, 639])('preserves the touch-sized board at %ipx', (viewportWidth) => {
    expect(getBoardLayout({ ...base, viewportWidth, containerWidth: viewportWidth }).isTight).toBe(false);
  });

  it('handles empty and not-yet-measured boards without division by zero', () => {
    expect(getBoardLayout({ ...base, containerWidth: 0 }).isTight).toBe(false);
    expect(getBoardLayout({ ...base, columnCount: 0 }).isTight).toBe(false);
    const result = getBoardLayout({ ...base, emptyColumnCount: 5 });
    expect(result.isTight).toBe(true);
    expect(Number.isFinite(result.columnWidth)).toBe(true);
    expect(usedWidth(result, 5, 5)).toBeLessThan(base.containerWidth);
  });
});

describe('status-strip scroll direction', () => {
  it.each([
    [-150, 40, 0, 800, 'left'],
    [790, 980, 0, 800, 'right'],
    [900, 1090, 0, 800, 'right'],
    [20, 212, 0, 800, undefined],
    [-0.5, 191.5, 0, 800, undefined],
    [224, 416, 224, 1280, undefined],
  ] as const)('classifies column [%s, %s] in viewport [%s, %s]', (left, right, viewportLeft, viewportRight, side) => {
    expect(getOffscreenSide(left, right, viewportLeft, viewportRight)).toBe(side);
  });
});
