// Plane geometry for the cabinet: points are [x, y] in millimetres.

import pc from 'polygon-clipping';

export const add = (a, b) => [a[0] + b[0], a[1] + b[1]];
export const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
export const mul = (a, k) => [a[0] * k, a[1] * k];
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1];
export const cross = (a, b) => a[0] * b[1] - a[1] * b[0];
export const len = (a) => Math.hypot(a[0], a[1]);
export const norm = (a) => mul(a, 1 / len(a));
export const deg = (d) => (d * Math.PI) / 180;
export const dir = (angle) => [Math.cos(angle), Math.sin(angle)];
/** Turned a quarter clockwise: for an edge running along `d`, the side to its right. */
export const right = (d) => [d[1], -d[0]];
export const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
export const round = (v, p = 3) => Math.round(v * 10 ** p) / 10 ** p;

/** Where the line through p along d meets the line through q along e. */
export function intersect(p, d, q, e) {
  const den = cross(d, e);
  if (Math.abs(den) < 1e-12) throw new Error('parallel lines');
  const t = cross(sub(q, p), e) / den;
  return add(p, mul(d, t));
}

/** Signed area (positive: counter-clockwise with y up). */
export function area(poly) {
  let a = 0;
  for (let i = 0; i < poly.length; i++) a += cross(poly[i], poly[(i + 1) % poly.length]);
  return a / 2;
}

export const ccw = (poly) => (area(poly) < 0 ? [...poly].reverse() : poly);
export const cw = (poly) => (area(poly) > 0 ? [...poly].reverse() : poly);

export function bounds(polys) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const poly of polys) for (const [x, y] of poly) {
    x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
  }
  return { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0 };
}

export function rect(x0, y0, x1, y1) {
  return [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
}

/** A circle as a polygon (for boolean work and the 3D viewer; sheets keep true circles). */
export function circlePoly(cx, cy, r, n = 0) {
  const k = n || Math.max(24, Math.min(96, Math.ceil(r * 2.4)));
  return Array.from({ length: k }, (_, i) => {
    const a = (i / k) * Math.PI * 2;
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  });
}

/** A rectangle with rounded corners. */
export function roundRect(x0, y0, x1, y1, r) {
  r = Math.min(r, (x1 - x0) / 2, (y1 - y0) / 2);
  const out = [];
  const arc = (cx, cy, a0) => {
    for (let i = 0; i <= 8; i++) {
      const a = a0 + (i / 8) * (Math.PI / 2);
      out.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
    }
  };
  arc(x1 - r, y0 + r, -Math.PI / 2);
  arc(x1 - r, y1 - r, 0);
  arc(x0 + r, y1 - r, Math.PI / 2);
  arc(x0 + r, y0 + r, Math.PI);
  return out.filter((q, i) => {
    const prev = out[(i + out.length - 1) % out.length];
    return Math.hypot(q[0] - prev[0], q[1] - prev[1]) > 1e-9;
  });
}

/** A strip in the profile: the face from p to q, `t` thick toward `n`. */
export function strip(p, q, n, t) {
  return [p, q, add(q, mul(n, t)), add(p, mul(n, t))];
}

export function transform(poly, { x = 0, y = 0, rot = 0, mirror = false } = {}) {
  const c = Math.cos(rot), s = Math.sin(rot);
  return poly.map(([px, py]) => {
    const mx = mirror ? -px : px;
    return [x + mx * c - py * s, y + mx * s + py * c];
  });
}

export function pointInPoly(pt, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if (yi > pt[1] !== yj > pt[1] && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// ───────────── booleans (polygon-clipping works on rings of [x, y]) ─────────────

const closeRing = (poly) => {
  const r = poly.map((p) => [p[0], p[1]]);
  const a = r[0], b = r[r.length - 1];
  if (a[0] !== b[0] || a[1] !== b[1]) r.push([a[0], a[1]]);
  return r;
};
const asGeom = (polys) => polys.map((p) => [closeRing(p)]);
const openRing = (ring) => ring.slice(0, -1);

/** `outline` minus `holes`, cut to `clip` (optional): [{ outer, holes: [] }]. */
export function carve(outline, holes = [], clip = null) {
  let g = [[closeRing(outline)]];
  if (clip) g = pc.intersection(g, [[closeRing(clip)]]);
  if (holes.length) g = pc.difference(g, ...asGeom(holes));
  return g.map((poly) => ({ outer: ccw(openRing(poly[0])), holes: poly.slice(1).map((h) => cw(openRing(h))) }));
}

/** Area shared by two polygons (0 when they only touch). */
export function overlapArea(a, b) {
  const g = pc.intersection([[closeRing(a)]], [[closeRing(b)]]);
  let s = 0;
  for (const poly of g) {
    s += Math.abs(area(openRing(poly[0])));
    for (const h of poly.slice(1)) s -= Math.abs(area(openRing(h)));
  }
  return s;
}

/** Shortest distance from point to segment. */
export function distToSegment(p, a, b) {
  const ab = sub(b, a);
  const l2 = dot(ab, ab);
  if (l2 < 1e-12) return len(sub(p, a));
  const t = Math.max(0, Math.min(1, dot(sub(p, a), ab) / l2));
  return len(sub(p, add(a, mul(ab, t))));
}

/** Shortest distance between two polygons' boundaries (0 if they cross). */
export function polyDistance(a, b) {
  if (overlapArea(a, b) > 1e-6) return 0;
  let d = Infinity;
  for (let i = 0; i < a.length; i++) for (let j = 0; j < b.length; j++) {
    d = Math.min(d, distToSegment(a[i], b[j], b[(j + 1) % b.length]), distToSegment(b[j], a[i], a[(i + 1) % a.length]));
  }
  return d;
}

// ───────────── joints ─────────────

/**
 * A jigsaw seam from (x, y0) to (x, y1): a vertical cut with `count` round
 * knobs that lock the two pieces together. Returns the polyline; the piece on
 * the left gets the knobs (pointing +x).
 */
export function puzzleSeam(x, y0, y1, count, { neck = 12, head = 20, reach = 16 } = {}) {
  const pts = [[x, y0]];
  const span = y1 - y0;
  const r = head / 2;
  const w = Math.sqrt(r * r - (neck / 2) ** 2); // where the neck meets the head
  const steps = 24;
  for (let k = 0; k < count; k++) {
    const c = y0 + (span * (k + 0.5)) / count;
    const cx = x + reach - r;
    pts.push([x, c - neck / 2], [cx - w, c - neck / 2]);
    // Round the head the long way, through its far side.
    const a0 = Math.atan2(-neck / 2, -w);
    const a1 = Math.atan2(neck / 2, -w);
    for (let i = 1; i < steps; i++) {
      const a = a0 + ((a1 - a0) * i) / steps;
      pts.push([cx + r * Math.cos(a), c + r * Math.sin(a)]);
    }
    pts.push([cx - w, c + neck / 2], [x, c + neck / 2]);
  }
  pts.push([x, y1]);
  return pts;
}
