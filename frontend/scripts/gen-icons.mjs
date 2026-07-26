#!/usr/bin/env node
/**
 * Generate the PWA icon set from the Pixel Tanuki mascot grid.
 *
 * iOS ignores SVG for `apple-touch-icon` and for manifest icons, so the home
 * screen falls back to a screenshot/letter thumbnail. This script emits real
 * PNGs at the sizes iOS and Android actually read.
 *
 * Output (frontend/public/):
 *   apple-touch-icon.png  180x180  opaque, no transparency (iOS requirement)
 *   icon-192.png          192x192  manifest "any"
 *   icon-512.png          512x512  manifest "any"
 *   icon-maskable-512.png 512x512  manifest "maskable" (mascot inside the
 *                                  80% safe zone so Android/iOS cropping to a
 *                                  circle or squircle never clips it)
 *
 * Requires `rsvg-convert` (librsvg). Run: node scripts/gen-icons.mjs
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const PUBLIC_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');

// Mirror of src/components/shared/PixelTanuki.tsx — keep in sync.
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

const COLORS = { 1: '#d4a574', 2: '#5c3d2e', 3: '#1a1a1a', 4: '#f59e0b' };
const BG = '#0a0a0a'; // brand black — matches manifest background_color

/**
 * @param {number} size    output edge in px
 * @param {number} scale   mascot size as a fraction of the canvas
 * @param {boolean} rounded  rounded corners (home-screen icons) vs full bleed
 *                           (maskable, where the OS applies its own mask)
 */
function buildSvg(size, scale, rounded) {
  const art = size * scale;
  const px = art / 16;
  const offset = (size - art) / 2;
  const radius = rounded ? size * 0.22 : 0; // ~iOS squircle
  const cells = [];
  GRID.forEach((row, y) => {
    row.forEach((cell, x) => {
      if (!cell) return;
      // +0.5px overlap avoids hairline seams between pixels after rasterizing.
      cells.push(
        `<rect x="${offset + x * px}" y="${offset + y * px}" width="${px + 0.5}" height="${px + 0.5}" fill="${COLORS[cell]}"/>`,
      );
    });
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">`
    + `<rect width="${size}" height="${size}" rx="${radius}" fill="${BG}"/>`
    + cells.join('')
    + '</svg>';
}

const targets = [
  { file: 'apple-touch-icon.png', size: 180, scale: 0.74, rounded: true },
  { file: 'icon-192.png', size: 192, scale: 0.74, rounded: true },
  { file: 'icon-512.png', size: 512, scale: 0.74, rounded: true },
  // Maskable: mascot inside the 80% safe zone, background bleeds to the edge.
  { file: 'icon-maskable-512.png', size: 512, scale: 0.56, rounded: false },
];

const tmp = mkdtempSync(join(tmpdir(), 'baaton-icons-'));
try {
  for (const { file, size, scale, rounded } of targets) {
    const svgPath = join(tmp, `${file}.svg`);
    writeFileSync(svgPath, buildSvg(size, scale, rounded));
    execFileSync('rsvg-convert', [
      svgPath,
      '-w', String(size),
      '-h', String(size),
      '-o', join(PUBLIC_DIR, file),
    ]);
    console.log(`✓ ${file} (${size}x${size})`);
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
