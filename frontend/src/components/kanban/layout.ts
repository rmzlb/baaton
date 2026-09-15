export type BoardDensity = 'compact' | 'default' | 'spacious';
export type OffscreenSide = 'left' | 'right';

const NORMAL_COLUMN_WIDTH: Record<BoardDensity, number> = {
  compact: 256,
  default: 320,
  spacious: 340,
};

// Shared with the board's inline spacing and the collapsed column width.
export const COLLAPSED_COLUMN_WIDTH = 20;
export const TIGHT_GAP = 8;
export const TIGHT_PADDING = 12;
const TIGHT_MIN_WIDTH = 176;
const TIGHT_MAX_WIDTH = 192;
/** Minimum column width on desktop — keeps all statuses reachable as drag targets
 *  and lets ≥ 6 columns fit on a 13" screen (≈ 1440 px wide). */
export const MIN_DESKTOP_COL_WIDTH = 160;

export function getBoardLayout({
  containerWidth,
  viewportWidth,
  columnCount,
  emptyColumnCount,
  density,
}: {
  containerWidth: number;
  viewportWidth: number;
  columnCount: number;
  emptyColumnCount: number;
  density: BoardDensity;
}) {
  const regularGap = viewportWidth >= 768 ? 16 : 12;
  const regularPadding = viewportWidth >= 768 ? 24 : 12;
  const regularWidth = columnCount * NORMAL_COLUMN_WIDTH[density]
    + Math.max(0, columnCount - 1) * regularGap + 2 * regularPadding;
  // Preserve the existing touch-sized, horizontally scrollable mobile board.
  // Compare the *normal* layout, not the already-tight width (avoids oscillation).
  const isTight = viewportWidth >= 640 && containerWidth > 0
    && columnCount > 0 && regularWidth > containerWidth;

  // On desktop (≥ 1280 px) keep every status column fully visible so every
  // status is always reachable as a drag-and-drop target — never collapse.
  const isDesktop = viewportWidth >= 1024;

  const emptyCount = Math.min(columnCount, Math.max(0, emptyColumnCount));
  const filledCount = columnCount - emptyCount;

  if (isDesktop && isTight) {
    // Filled columns get more space; empty columns are narrower but total fills width.
    const availableForAll = containerWidth - 2 * TIGHT_PADDING
      - Math.max(0, columnCount - 1) * TIGHT_GAP;
    const EMPTY_RATIO = 0.45; // empty col = 45 % of filled col width
    let columnWidth: number;
    let emptyColumnWidth: number;
    if (filledCount > 0 && emptyCount > 0) {
      const raw = availableForAll / (filledCount + EMPTY_RATIO * emptyCount);
      columnWidth = Math.max(MIN_DESKTOP_COL_WIDTH, Math.floor(raw));
      emptyColumnWidth = Math.max(100, Math.floor(columnWidth * EMPTY_RATIO));
    } else {
      columnWidth = Math.max(MIN_DESKTOP_COL_WIDTH, Math.floor(availableForAll / columnCount));
      emptyColumnWidth = columnWidth;
    }
    return { isTight, columnWidth, emptyColumnWidth, collapseEmpty: false };
  }

  const availableForCards = containerWidth - 2 * TIGHT_PADDING
    - Math.max(0, columnCount - 1) * TIGHT_GAP
    - emptyCount * COLLAPSED_COLUMN_WIDTH;
  const columnWidth = filledCount === 0 ? TIGHT_MAX_WIDTH : Math.max(
    TIGHT_MIN_WIDTH,
    Math.min(TIGHT_MAX_WIDTH, Math.floor(availableForCards / filledCount)),
  );
  return { isTight, columnWidth, emptyColumnWidth: columnWidth, collapseEmpty: isTight && !isDesktop };
}

/** Horizontal clipping only; vertical card scrolling does not hide a column. */
export function getOffscreenSide(
  columnLeft: number,
  columnRight: number,
  viewportLeft: number,
  viewportRight: number,
): OffscreenSide | undefined {
  if (columnLeft < viewportLeft - 1) return 'left';
  if (columnRight > viewportRight + 1) return 'right';
  return undefined;
}
