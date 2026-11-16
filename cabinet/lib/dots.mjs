// Dot-matrix lettering for engraving and cutting, in the arcade's DMD font.

import { glyph, measure } from '../../web/src/lib/dmdfont.js';

/**
 * Dots for `text` with its top-left at (x, y), `pitch` mm apart, y growing
 * downward in the text (flip with `up`). Returns [{ x, y, r }].
 */
export function dotText(text, { x = 0, y = 0, pitch = 1, r = pitch * 0.38, up = true, center = false } = {}) {
  const width = measure(text) * pitch;
  let cx = center ? x - width / 2 + pitch / 2 : x;
  const dots = [];
  for (const ch of String(text)) {
    const g = glyph(ch);
    for (let row = 0; row < 7; row++) {
      for (let col = 0; col < g.w; col++) {
        if (!g.rows[row][col]) continue;
        const dy = (center ? row - 3 : row) * pitch;
        dots.push({ x: cx + col * pitch, y: up ? y - dy : y + dy, r });
      }
    }
    cx += (g.w + 1) * pitch;
  }
  return dots;
}

export const textWidth = (text, pitch) => measure(text) * pitch;

/** Holes on a square grid filling a circle (speaker grilles). */
export function dotCircle(cx, cy, radius, pitch, r) {
  const dots = [];
  const n = Math.ceil(radius / pitch);
  for (let i = -n; i <= n; i++) {
    for (let j = -n; j <= n; j++) {
      // offset every other row: a tighter, rounder grille
      const x = cx + (i + (j % 2 ? 0.5 : 0)) * pitch;
      const y = cy + j * pitch * 0.866;
      if (Math.hypot(x - cx, y - cy) <= radius - r) dots.push({ x, y, r });
    }
  }
  return dots;
}

/** Holes filling a rectangle (vents). */
export function dotRect(x0, y0, x1, y1, pitch, r) {
  const dots = [];
  for (let y = y0 + r, row = 0; y <= y1 - r + 1e-9; y += pitch * 0.866, row++) {
    for (let x = x0 + r + (row % 2 ? pitch / 2 : 0); x <= x1 - r + 1e-9; x += pitch) dots.push({ x, y, r });
  }
  return dots;
}
