/**
 * Pixel Tanuki mascot — the clever orchestrator
 * 16x16 grid rendered in CSS/SVG
 * A raccoon dog holding a conductor's baton
 */
interface PixelTanukiProps {
  size?: number;
  className?: string;
}

// 16x16 pixel grid — 1 = body, 2 = dark, 3 = eyes, 4 = baton/accent, 0 = empty
const GRID = [
  [0,0,0,0,0,2,2,0,0,2,2,0,0,0,0,0],
  [0,0,0,0,2,1,1,2,2,1,1,2,0,0,0,0],
  [0,0,0,2,1,1,1,1,1,1,1,1,2,0,0,0],
  [0,0,2,1,1,1,1,1,1,1,1,1,1,2,0,0],
  [0,0,2,1,2,3,1,1,1,2,3,1,1,2,0,0],
  [0,0,2,1,1,1,1,2,1,1,1,1,1,2,0,0],
  [0,0,0,2,1,1,1,1,1,1,1,1,2,0,0,0],
  [0,0,0,0,2,1,1,1,1,1,1,2,0,0,0,0],
  [0,0,0,2,1,1,1,1,1,1,1,1,2,0,0,0],
  [0,0,2,1,1,1,1,1,1,1,1,1,1,2,0,4],
  [0,0,2,1,1,1,1,1,1,1,1,1,1,2,4,0],
  [0,0,0,2,1,1,1,1,1,1,1,1,4,0,0,0],
  [0,0,0,0,2,2,1,1,1,2,2,4,0,0,0,0],
  [0,0,0,0,2,1,2,0,2,1,4,0,0,0,0,0],
  [0,0,0,0,2,1,2,0,2,4,2,0,0,0,0,0],
  [0,0,0,0,2,2,2,0,4,2,2,0,0,0,0,0],
];

const COLORS: Record<number, string> = {
  0: 'transparent',
  1: '#d4a574',  // body (warm tan)
  2: '#5c3d2e',  // dark outline
  3: '#1a1a1a',  // eyes
  4: '#f59e0b',  // baton (amber accent)
};

export function PixelTanuki({ size = 48, className }: PixelTanukiProps) {
  const pixelSize = size / 16;

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className={className}
      role="img"
      aria-label="Baaton Tanuki mascot"
    >
      {GRID.map((row, y) =>
        row.map((cell, x) => {
          if (cell === 0) return null;
          return (
            <rect
              key={`${x}-${y}`}
              x={x * pixelSize}
              y={y * pixelSize}
              width={pixelSize}
              height={pixelSize}
              fill={COLORS[cell]}
            />
          );
        }),
      )}
    </svg>
  );
}
