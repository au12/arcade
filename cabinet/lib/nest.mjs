// Packing parts onto laser-bed-sized sheets: MaxRects, best short side fit,
// each part turned 0° or 90°, by its bounding box.

import { bounds, transform } from './geom.mjs';

/** The part's outline as it lies on the sheet (mirrored if its hidden face must be up). */
export function sheetShape(part) {
  return part.mirror ? transform(part.outline, { mirror: true }) : part.outline;
}

export function nest(parts, { size, spacing }) {
  const items = parts.map((part) => {
    const b = bounds([sheetShape(part)]);
    return { part, w: b.w + spacing, h: b.h + spacing, b };
  });
  items.sort((a, b) => Math.max(b.w, b.h) - Math.max(a.w, a.h) || b.w * b.h - a.w * a.h);
  const W = size[0] + spacing, H = size[1] + spacing;
  const sheets = [];

  const newSheet = () => {
    const s = { free: [{ x: 0, y: 0, w: W, h: H }], placed: [] };
    sheets.push(s);
    return s;
  };

  const place = (sheet, item) => {
    let best = null;
    for (const fr of sheet.free) {
      for (const rot of [0, 90]) {
        const w = rot ? item.h : item.w, h = rot ? item.w : item.h;
        if (w > fr.w + 1e-9 || h > fr.h + 1e-9) continue;
        const shortSide = Math.min(fr.w - w, fr.h - h), longSide = Math.max(fr.w - w, fr.h - h);
        if (!best || shortSide < best.shortSide || (shortSide === best.shortSide && longSide < best.longSide)) {
          best = { x: fr.x, y: fr.y, w, h, rot, shortSide, longSide };
        }
      }
    }
    if (!best) return false;
    sheet.placed.push({ item, x: best.x, y: best.y, rot: best.rot });
    // Split every free rectangle the new one overlaps.
    const next = [];
    for (const fr of sheet.free) {
      if (best.x >= fr.x + fr.w || best.x + best.w <= fr.x || best.y >= fr.y + fr.h || best.y + best.h <= fr.y) {
        next.push(fr);
        continue;
      }
      if (best.x > fr.x) next.push({ x: fr.x, y: fr.y, w: best.x - fr.x, h: fr.h });
      if (best.x + best.w < fr.x + fr.w) next.push({ x: best.x + best.w, y: fr.y, w: fr.x + fr.w - best.x - best.w, h: fr.h });
      if (best.y > fr.y) next.push({ x: fr.x, y: fr.y, w: fr.w, h: best.y - fr.y });
      if (best.y + best.h < fr.y + fr.h) next.push({ x: fr.x, y: best.y + best.h, w: fr.w, h: fr.y + fr.h - best.y - best.h });
    }
    sheet.free = next.filter((a, i) => !next.some((b, j) => j !== i && a.x >= b.x && a.y >= b.y && a.x + a.w <= b.x + b.w && a.y + a.h <= b.y + b.h && (j < i || a.w * a.h < b.w * b.h)));
    return true;
  };

  for (const item of items) {
    if (!sheets.some((s) => place(s, item))) {
      if (!place(newSheet(), item)) throw new Error(`${item.part.id} is too big for the bed`);
    }
  }
  return sheets.map((s) =>
    s.placed.map(({ item, x, y, rot }) => {
      // Sheet transform: mirror, turn, then move the turned box's corner to (x, y).
      const shape = transform(sheetShape(item.part), { rot: (rot * Math.PI) / 180 });
      const b = bounds([shape]);
      return { part: item.part, rot, mirror: Boolean(item.part.mirror), dx: x - b.x0, dy: y - b.y0 };
    }),
  );
}

/** A point of the part's own drawing, where it lands on the sheet. */
export function onSheet(pl, pt) {
  const [q] = transform([pt], { mirror: pl.mirror, rot: (pl.rot * Math.PI) / 180 });
  return [q[0] + pl.dx, q[1] + pl.dy];
}
