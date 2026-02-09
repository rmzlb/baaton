/**
 * Pixel Baton — conductor's baton in 8-bit pixel art
 * Minimalist: dark handle, amber tip, diagonal angle
 * 16x16 grid
 */
interface PixelBatonProps {
  size?: number;
  className?: string;
}

// 16x16 pixel grid
// 0 = empty, 1 = handle (dark wood), 2 = shaft (light), 3 = tip (amber glow), 4 = grip (cork)
const GRID = [
  [0,0,0,0,0,0,0,0,0,0,0,0,0,3,3,0],
  [0,0,0,0,0,0,0,0,0,0,0,0,3,3,0,0],
  [0,0,0,0,0,0,0,0,0,0,0,3,2,0,0,0],
  [0,0,0,0,0,0,0,0,0,0,2,2,0,0,0,0],
  [0,0,0,0,0,0,0,0,0,2,2,0,0,0,0,0],
  [0,0,0,0,0,0,0,0,2,2,0,0,0,0,0,0],
  [0,0,0,0,0,0,0,2,2,0,0,0,0,0,0,0],
  [0,0,0,0,0,0,2,2,0,0,0,0,0,0,0,0],
  [0,0,0,0,0,2,2,0,0,0,0,0,0,0,0,0],
  [0,0,0,0,2,2,0,0,0,0,0,0,0,0,0,0],
  [0,0,0,2,2,0,0,0,0,0,0,0,0,0,0,0],
  [0,0,4,4,0,0,0,0,0,0,0,0,0,0,0,0],
  [0,4,1,4,0,0,0,0,0,0,0,0,0,0,0,0],
  [0,4,1,4,0,0,0,0,0,0,0,0,0,0,0,0],
  [0,0,1,0,0,0,0,0,0,0,0,0,0,0,0,0],
  [0,0,1,0,0,0,0,0,0,0,0,0,0,0,0,0],
];

const COLORS: Record<number, string> = {
  0: 'transparent',
  1: '#1c1210',  // handle (dark ebony)
  2: '#e8dfd5',  // shaft (birch white)
  3: '#f59e0b',  // tip (amber glow)
  4: '#8b6f47',  // cork grip
};

export function PixelBaton({ size = 48, className }: PixelBatonProps) {
  const px = size / 16;

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className={className}
      role="img"
      aria-label="Baaton — conductor's baton"
    >
      {GRID.map((row, y) =>
        row.map((cell, x) => {
          if (cell === 0) return null;
          return (
            <rect
              key={`${x}-${y}`}
              x={x * px}
              y={y * px}
              width={px}
              height={px}
              fill={COLORS[cell]}
            />
          );
        }),
      )}
      {/* Subtle amber glow on tip */}
      <circle
        cx={13.5 * px}
        cy={0.5 * px}
        r={px * 2.5}
        fill="#f59e0b"
        opacity={0.15}
      />
    </svg>
  );
}
