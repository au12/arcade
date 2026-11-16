// Cut sheets as SVG, in millimetres, laid out for LightBurn and friends:
// red lines are cuts, blue dots are engraving, green dots are part labels
// (engrave them lightly, or delete the layer).

import { bounds, pointInPoly, transform } from './geom.mjs';
import { onSheet } from './nest.mjs';
import { dotText, textWidth } from './dots.mjs';

export const COLORS = { cut: '#ff0000', engrave: '#0000ff', label: '#00a000', pocket: '#ff00ff' };

const f = (v) => (Math.round(v * 1000) / 1000).toString();
const path = (poly) => `M${poly.map(([x, y]) => `${f(x)} ${f(y)}`).join('L')}Z`;

/** Where a label of `text` fits inside the placed part, clear of its holes. */
function labelSpot(outline, holes, circles, text, pitch) {
  const w = textWidth(text, pitch) + 10, h = 7 * pitch + 10; // with room to spare round it
  const b = bounds([outline]);
  const fits = (cx, cy) => {
    const pts = [];
    for (let i = 0; i <= 4; i++) for (let j = 0; j <= 2; j++) pts.push([cx - w / 2 + (w * i) / 4, cy - h / 2 + (h * j) / 2]);
    if (!pts.every((q) => pointInPoly(q, outline))) return false;
    if (pts.some((q) => holes.some((hp) => pointInPoly(q, hp)))) return false;
    return !circles.some((c) => c.x + c.r > cx - w / 2 - 1 && c.x - c.r < cx + w / 2 + 1 && c.y + c.r > cy - h / 2 - 1 && c.y - c.r < cy + h / 2 + 1);
  };
  const cx0 = (b.x0 + b.x1) / 2, cy0 = (b.y0 + b.y1) / 2;
  let best = null;
  for (let r = 0; r < Math.max(b.w, b.h); r += 6) {
    for (let a = 0; a < (r ? 16 : 1); a++) {
      const cx = cx0 + r * Math.cos((a / 16) * Math.PI * 2), cy = cy0 + r * Math.sin((a / 16) * Math.PI * 2);
      if (fits(cx, cy)) return [cx, cy];
    }
  }
  return best;
}

export function sheetSvg(placements, { bed, margin, title = '' }) {
  const [W, H] = bed;
  const cut = [], engrave = [], label = [], pocket = [];
  for (const pl of placements) {
    const part = pl.part;
    const at = (pt) => {
      const q = onSheet(pl, pt);
      return [q[0] + margin, q[1] + margin];
    };
    const outline = part.outline.map(at);
    const holes = [...(part.holes || []), ...(part.polys || [])].map((hp) => hp.map(at));
    const circles = (part.circles || []).map((c) => {
      const [x, y] = at([c.x, c.y]);
      return { x, y, r: c.r };
    });
    cut.push(`<path id="${part.id}" d="${path(outline)}"/>`);
    for (const hp of holes) cut.push(`<path d="${path(hp)}"/>`);
    for (const c of circles) cut.push(`<circle cx="${f(c.x)}" cy="${f(c.y)}" r="${f(c.r)}"/>`);
    for (const d of part.engrave || []) {
      const [x, y] = at([d.x, d.y]);
      engrave.push(`<circle cx="${f(x)}" cy="${f(y)}" r="${f(d.r)}"/>`);
    }
    for (const d of part.pockets || []) {
      const [x, y] = at([d.x, d.y]);
      pocket.push(`<circle cx="${f(x)}" cy="${f(y)}" r="${f(d.r)}"/>`);
    }
    for (const text of part.labels || []) {
      const pitch = 1.1;
      const spot = labelSpot(outline, holes, circles, text, pitch);
      if (!spot) continue;
      for (const d of dotText(text, { x: spot[0], y: spot[1], pitch, r: 0.42, center: true })) label.push(`<circle cx="${f(d.x)}" cy="${f(d.y)}" r="${f(d.r)}"/>`);
    }
  }
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${W}mm" height="${H}mm" viewBox="0 0 ${W} ${H}">
<title>${title}</title>
<desc>au12 Arcade cabinet. Red: cut. Blue: engrave (fill). Green: part labels (light engrave, optional). Magenta: dowel pockets (engrave about 2.5 mm deep). Units: mm.</desc>
<g transform="matrix(1 0 0 -1 0 ${H})">
<g id="cut" fill="none" stroke="${COLORS.cut}" stroke-width="0.1">
${cut.join('\n')}
</g>
<g id="engrave" fill="${COLORS.engrave}" stroke="none">
${engrave.join('\n')}
</g>
<g id="labels" fill="${COLORS.label}" stroke="none">
${label.join('\n')}
</g>
<g id="pockets" fill="${COLORS.pocket}" stroke="none">
${pocket.join('\n')}
</g>
</g>
</svg>
`;
}

/** A dimensioned side view for the docs. */
export function profileSvg(model) {
  const pad = 70;
  const { profile, D, H } = model;
  const W = D + pad * 2, Ht = H + pad * 2;
  const y = (v) => Ht - pad - v;
  const x = (v) => pad + v;
  const pts = (poly) => poly.map(([z, yy]) => `${f(x(z))},${f(y(yy))}`).join(' ');
  const strips = model.strips.map((s) => `<polygon points="${pts(s.poly)}" class="panel"/>`).join('\n');
  const slots = model.holesInner.filter((h) => h.kind !== 'slot').map((h) => `<polygon points="${pts(h.poly)}" class="cut"/>`).join('\n');
  const mon = model.props.find((p) => p.kind === 'monitor');
  const P = model.points;
  const dim = (x0, y0, x1, y1, text, off = 0, vertical = false) => {
    const mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
    return `<line x1="${f(x0)}" y1="${f(y0)}" x2="${f(x1)}" y2="${f(y1)}" class="dim"/>
<text x="${f(vertical ? mx - 8 : mx)}" y="${f(vertical ? my : my - 6 + off)}" class="dimt" ${vertical ? `transform="rotate(-90 ${f(mx - 8)} ${f(my)})"` : ''}>${text}</text>`;
  };
  const monPoly = model.monitorSection ? `<polygon points="${pts(model.monitorSection)}" class="monitor"/>` : '';
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${f(W)} ${f(Ht)}" width="${f(W * 1.6)}" height="${f(Ht * 1.6)}">
<style>
  .side { fill: #e9cf9f; stroke: #8a6a3a; stroke-width: 1; }
  .panel { fill: #b88a4e; stroke: #5c4120; stroke-width: 0.6; }
  .cut { fill: #fffaf0; stroke: #8a6a3a; stroke-width: 0.5; stroke-dasharray: 2 2; }
  .monitor { fill: #1d1d24; opacity: 0.85; }
  .dim { stroke: #333; stroke-width: 0.6; marker-start: url(#a); marker-end: url(#a); }
  .dimt { font: 600 11px system-ui, sans-serif; fill: #333; text-anchor: middle; }
  .note { font: 500 10px system-ui, sans-serif; fill: #555; }
</style>
<defs><marker id="a" viewBox="-4 -4 8 8" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M-3,-3 L3,0 L-3,3" fill="#333"/></marker></defs>
<rect width="100%" height="100%" fill="#fbf7ef"/>
<polygon points="${pts(profile)}" class="side"/>
${slots}
${strips}
${monPoly}
${dim(x(0), y(-28), x(D), y(-28), `${Math.round(D)} mm deep`)}
${dim(x(D + 30), y(0), x(D + 30), y(H), `${Math.round(H)} mm tall`, 0, true)}
<text x="${f(x(P.F1[0] + 30))}" y="${f(y(P.F1[1] + 30))}" class="note">control panel ${model.params.cpAngle}°</text>
<text x="${f(x(P.X1[0] + 24))}" y="${f(y(P.X1[1] + 140))}" class="note">monitor, tilted ${model.params.screenTilt}°</text>
<text x="${f(x(P.C3[0] + 10))}" y="${f(y(P.C3[1] + 70))}" class="note">marquee</text>
<line x1="${f(x(-20))}" y1="${f(y(0))}" x2="${f(x(D + 20))}" y2="${f(y(0))}" stroke="#999" stroke-width="0.8"/>
</svg>
`;
}

export { transform };
