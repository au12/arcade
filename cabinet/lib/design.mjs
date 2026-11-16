// The au12 Arcade bartop cabinet, as numbers.
//
// Everything is worked out from a handful of parameters (the monitor, the
// plywood, the laser's bed and kerf, a few angles), so a different monitor
// or a thicker sheet is a new set of cut files, not a redesign.
//
// Coordinates: the side profile is drawn in (z, y): z is depth (0 at the
// front, growing toward the back), y is height (0 on the table). Across the
// cabinet runs X, 0 at the left side's inner face, W at the right's.
//
// Each side is two layers of plywood glued together. The inner layer carries
// slots for every cross panel's tabs, so the outside of the cabinet shows no
// joints at all, and the layers' seams fall in different places, so the
// pieces (each small enough for the laser) lock each other flat.

import { add, sub, mul, dot, norm, deg, right, intersect, strip, rect, roundRect, circlePoly, carve, overlapArea, polyDistance, bounds, area, pointInPoly, len } from './geom.mjs';
import { dotText, dotCircle, dotRect, textWidth } from './dots.mjs';

export const MONITORS = {
  // w × h × d: the body without its stand. edge: how thick it is at its left and right ends.
  // view: the lit area; viewBottom: from the body's bottom edge to the lit area.
  // vesaDepth: from the screen to the VESA mounting face; vesaY: from the bottom edge to the VESA centre.
  '21.5': { name: '21.5" 16:9 (Dell SE2222H and the like)', w: 491.5, h: 292.7, d: 54, edge: 24, viewW: 476.1, viewH: 267.8, viewBottom: 17, vesa: 100, vesaDepth: 50, vesaY: 150 },
  '21.5-thin': { name: '21.5" 16:9 with thin bezels', w: 488.0, h: 285.0, d: 45, edge: 12, viewW: 476.1, viewH: 267.8, viewBottom: 10, vesa: 100, vesaDepth: 42, vesaY: 145 },
  '19.5': { name: '19.5" 16:9', w: 442.0, h: 262.0, d: 45, edge: 20, viewW: 432.0, viewH: 243.0, viewBottom: 14, vesa: 100, vesaDepth: 40, vesaY: 131 },
  '19-4:3': { name: '19" 4:3 (an old square one)', w: 410.0, h: 345.0, d: 55, edge: 30, viewW: 376.0, viewH: 301.0, viewBottom: 30, vesa: 100, vesaDepth: 50, vesaY: 172 },
};

export const DEFAULTS = {
  monitor: '21.5',
  ply: 6.0, // measure yours: "6 mm" Baltic birch is anything from 5.6 to 6.4
  acrylic: 3.0,
  kerf: 0.15, // what the laser burns away; slots and holes are sized for it
  fit: 0.1, // slots come out this much wider than the plywood
  bed: [508, 305], // the laser's work area (12 × 20 in)
  margin: 3, // keep parts this far from the bed's edges
  spacing: 3, // and from each other
  clearance: 3, // around the monitor, each side
  baseLift: 12, // the sides stand the floor this far off the table
  apronHeight: 120,
  cpAngle: 9,
  cpLength: 232,
  screenTilt: 18,
  speakerLength: 92,
  marqueeLength: 128,
  marqueeTilt: 12,
  depth: 470,
  reveal: 3, // the sides stand this far proud of the panels' faces
  inset: 6, // the front apron and the back sit this far in
  layoutScale: 0.6, // mm per unit of the arcade's control-panel drawing
  holes: { button: 28.6, small: 24, stick: 24, encoder: 7, plunger: 27, flipper: 28.6 },
  speaker: { frame: 78, screws: 66, grille: 64, screw: 3.2, spread: 150 },
  door: { lower: 190, height: 260 },
  lightGap: 40, // from the marquee to the LED board
  leds: { perMetre: 60, rows: 2 },
  marqueeText: 'AU12 ARCADE',
};

// The arcade's control-panel drawing (web/src/components/game.jsx): the
// cabinet is built to the same layout, so the drawing on screen is the panel
// under your hands.
export const LAYOUT = {
  STICK: { x: 196, y: 186, hole: 'stick' },
  B1: { x: 430, y: 166, hole: 'button' },
  B2: { x: 506, y: 146, hole: 'button' },
  B3: { x: 582, y: 146, hole: 'button' },
  B4: { x: 424, y: 236, hole: 'button' },
  B5: { x: 500, y: 216, hole: 'button' },
  B6: { x: 576, y: 216, hole: 'button' },
  HOME: { x: 92, y: 96, hole: 'small', label: 'MENU' },
  COIN: { x: 300, y: 96, hole: 'small', label: 'COIN' },
  START: { x: 356, y: 96, hole: 'small', label: 'START' },
  KNOB: { x: 712, y: 96, hole: 'encoder', label: 'VOL' },
  LAUNCH: { x: 130, hole: 'button', label: 'LAUNCH' },
  PLUNGER: { x: 670, hole: 'plunger' },
};

const merge = (a, b) => {
  const out = { ...a };
  for (const [k, v] of Object.entries(b || {})) {
    out[k] = v && typeof v === 'object' && !Array.isArray(v) && a[k] && typeof a[k] === 'object' ? merge(a[k], v) : v;
  }
  return out;
};

const to3 = (pt) => [0, pt[1], pt[0]]; // profile [z, y] → [X, Y, Z]

export function design(input = {}) {
  const p = merge(DEFAULTS, input);
  const mon = typeof p.monitor === 'string' ? MONITORS[p.monitor] : merge(MONITORS['21.5'], p.monitor);
  if (mon && typeof p.monitor === 'object' && !p.monitor.name) mon.name = `${mon.w} × ${mon.h} mm monitor`;
  if (!mon) throw new Error(`Unknown monitor "${p.monitor}". Try one of: ${Object.keys(MONITORS).join(', ')}, or give its sizes.`);
  const t = p.ply, ta = p.acrylic, k = p.kerf;
  const tab = t - 0.5; // how far a tab reaches into the inner layer
  const usable = [p.bed[0] - 2 * p.margin, p.bed[1] - 2 * p.margin];
  const notes = [];

  // ── how wide inside: the monitor, within what the bed can cut ──
  let W = Math.ceil(mon.w + 2 * p.clearance - 2 * t);
  if (W + 2 * tab > usable[0]) {
    W = Math.floor(usable[0] - 2 * tab);
    const room = (W + 2 * t - mon.w) / 2;
    if (room < 1.5) {
      throw new Error(`A ${mon.w} mm monitor needs panels ${Math.ceil(mon.w + 3 - 2 * t + 2 * tab)} mm wide; the bed fits ${usable[0]} mm. Use a smaller monitor or a bigger bed.`);
    }
    notes.push(`The bed limits the inside width to ${W} mm: ${room.toFixed(1)} mm of room each side of the monitor.`);
  }

  // ── the side profile ──
  const a = deg(p.cpAngle), s = deg(p.screenTilt), m = deg(p.marqueeTilt);
  const uCp = [Math.cos(a), Math.sin(a)];
  const uFace = [Math.sin(s), Math.cos(s)];
  const uMq = [-Math.sin(m), Math.cos(m)];
  const F0 = [0, 0];
  const F1 = [0, p.apronHeight];
  const F2 = add(F1, mul(uCp, p.cpLength));
  const nCp = right(uCp), nFace = right(uFace), nMq = right(uMq);
  // Outer face lines of the shell panels (each `reveal` in from the side's edge).
  const lineCp = { p: add(F1, mul(nCp, p.reveal)), d: uCp, n: nCp };
  const lineFace = { p: add(F2, mul(nFace, p.reveal)), d: uFace, n: nFace };
  const X1 = intersect(lineCp.p, uCp, lineFace.p, uFace); // where the control panel meets the screen
  const gm = 4; // the monitor's bottom edge, this far up the face from the control panel
  const faceRun = gm + mon.h + 2 + p.speakerLength; // control panel to marquee, along the face
  // F3 so that the face's outer line runs `faceRun` from X1 to the marquee corner.
  const cornerAt = (F3) => intersect(lineFace.p, uFace, add(F3, mul(nMq, p.reveal)), uMq);
  let F3 = add(F2, mul(uFace, faceRun));
  F3 = add(F3, mul(uFace, faceRun - dot(sub(cornerAt(F3), X1), uFace)));
  const C3 = cornerAt(F3);
  const F4 = add(F3, mul(uMq, p.marqueeLength));
  const D = p.depth;
  const F5 = [D, F4[1]], F6 = [D, 0];
  const profile = [F0, F1, F2, F3, F4, F5, F6];
  const H = F4[1];
  const lineMq = { p: add(F3, mul(nMq, p.reveal)), d: uMq, n: nMq };
  const topY = H - p.reveal; // the top panel's upper face
  const C4 = intersect(lineMq.p, uMq, [0, topY], [1, 0]);

  // ── cross panels ──
  const parts = [];
  const slots = []; // in the inner layer, profile coordinates
  const strips = []; // every panel's section in the profile, for the checks
  const props = []; // things that aren't cut: the monitor, buttons, speakers…

  const tabsFor = (length) => {
    if (length < 50) return [[8, length - 8]];
    const count = Math.max(1, Math.min(4, Math.round(length / 110)));
    const seg = length / count;
    const tl = Math.min(45, seg - 24);
    return Array.from({ length: count }, (_, i) => [seg * (i + 0.5) - tl / 2, seg * (i + 0.5) + tl / 2]);
  };

  /** A panel across the cabinet: its outer face starts at `at`, runs `length` along `d`, `th` thick toward `n`. */
  function panel(id, name, { at, d, n, length, th = t, material = 'ply6', tabs = 'auto', width = W, group = 'shell' }) {
    const intervals = tabs === 'auto' ? tabsFor(length) : tabs === 'full' ? [[0, length]] : tabs || [];
    // The outline: the body W wide, tabs out to either side.
    const outline = [[0, 0], [width, 0]];
    for (const [v0, v1] of intervals) outline.push([width, v0], [width + tab, v0], [width + tab, v1], [width, v1]);
    outline.push([width, length], [0, length]);
    for (const [v0, v1] of [...intervals].reverse()) outline.push([0, v1], [-tab, v1], [-tab, v0], [0, v0]);
    const clean = outline.filter((pt, i) => i === 0 || pt[0] !== outline[i - 1][0] || pt[1] !== outline[i - 1][1]);
    while (clean.length > 1 && clean.at(-1)[0] === clean[0][0] && clean.at(-1)[1] === clean[0][1]) clean.pop();
    const e = (p.fit - k) / 2; // slot widening each side, after the laser takes its kerf
    const c = (0.4 - k) / 2; // slack along the slot
    for (const [v0, v1] of intervals) {
      slots.push({
        panel: id,
        poly: strip(add(at, add(mul(d, v0 - c), mul(n, -e))), add(at, add(mul(d, v1 + c), mul(n, -e))), n, th + 2 * e),
      });
    }
    const part = {
      id, name, material, thickness: th, group,
      outline: clean, circles: [], polys: [], engrave: [], labels: [],
      length, width,
      section: strip(at, add(at, mul(d, length)), n, th),
      frame: { o: to3(at), u: [1, 0, 0], v: to3(d), w: to3(n) },
      explode: to3(mul(n, -1)),
      at, d, n,
    };
    // where something at (u, v) on the panel's face is, in 3D
    part.point = (u, v, w = 0) => {
      const q = add(at, add(mul(d, v), mul(n, w)));
      return [u, q[1], q[0]];
    };
    strips.push({ id, poly: part.section });
    parts.push(part);
    return part;
  }

  const hole = (part, x, y, dia) => part.circles.push({ x, y, r: (dia - k) / 2 });

  // Floor: two panels front and back, each tabbed into the sides on its own.
  const floorFront = p.inset, floorBack = D - p.inset;
  const floorSplit = Math.min(floorFront + usable[1], floorFront + (floorBack - floorFront) * 0.62);
  const base1 = panel('floor-front', 'Floor, front', { at: [floorFront, p.baseLift], d: [1, 0], n: [0, 1], length: floorSplit - floorFront });
  const base2 = panel('floor-back', 'Floor, back', { at: [floorSplit + 0.2, p.baseLift], d: [1, 0], n: [0, 1], length: floorBack - floorSplit - 0.2 });
  const floorTop = p.baseLift + t;

  // Control panel: from just behind the sides' front edge to the screen.
  const cpStart = intersect(lineCp.p, uCp, [p.reveal, 0], [0, 1]);
  const cpLen = dot(sub(X1, cpStart), uCp);
  const cp = panel('cp', 'Control panel', { at: cpStart, d: uCp, n: nCp, length: cpLen });
  // Apron: up from the floor to just under the control panel.
  const cpUnder = (z) => intersect(add(lineCp.p, mul(nCp, t)), uCp, [z, 0], [0, 1])[1];
  const apronTop = Math.min(cpUnder(p.inset), cpUnder(p.inset + t)) - 0.5;
  const apron = panel('apron', 'Front', { at: [p.inset, floorTop], d: [0, 1], n: [1, 0], length: apronTop - floorTop });

  // A beam under the control panel's back edge stiffens it; below it the
  // control box stays open, so its wiring is in reach from the back door.
  const wallZ = X1[0] - 14;
  const wallTop = Math.min(cpUnder(wallZ - t), cpUnder(wallZ)) - 0.5;
  const beamH = 48;
  const wall = panel('cp-beam', 'Control panel beam', { at: [wallZ, wallTop - beamH], d: [0, 1], n: [-1, 0], length: beamH, group: 'inner' });

  // The monitor: its screen on the face's outer line, its bottom edge `gm` up from the control panel.
  const monFace = add(X1, mul(uFace, gm));
  const monitor = {
    face: monFace,
    section: strip(monFace, add(monFace, mul(uFace, mon.h)), nFace, mon.vesaDepth),
    edgeSection: strip(monFace, add(monFace, mul(uFace, mon.h)), nFace, mon.edge),
  };
  // Shelf under the monitor, square to the screen; it drops into the bottom of the monitor's recess.
  const shelfDepth = Math.min(62, mon.vesaDepth + 8);
  const shelfAt = add(monFace, mul(nFace, 6));
  const shelf = panel('shelf', 'Monitor shelf', { at: shelfAt, d: nFace, n: mul(uFace, -1), length: shelfDepth, tabs: 'full', group: 'inner' });

  // VESA brace behind the monitor.
  const braceLen = 150;
  const braceAt = add(add(monFace, mul(uFace, mon.vesaY - braceLen / 2)), mul(nFace, mon.vesaDepth));
  const brace = panel('vesa', 'Monitor brace (VESA)', { at: braceAt, d: uFace, n: nFace, length: braceLen, group: 'inner' });

  // Speaker panel: from just above the monitor to the marquee corner.
  const spkStart = add(monFace, mul(uFace, mon.h + 2));
  const spkLen = dot(sub(C3, spkStart), uFace);
  const speaker = panel('speaker', 'Speaker panel', { at: spkStart, d: uFace, n: nFace, length: spkLen });

  // Top: from the marquee's top corner to the back.
  const topInner = topY - t;
  const top = panel('top', 'Top', { at: [C4[0], topY], d: [1, 0], n: [0, -1], length: D - p.inset - C4[0] });

  // Marquee: from the corner over the speakers up to the top's underside.
  // (its inner corner sits higher than its outer one: keep that one under the top)
  const mqEnd = intersect(lineMq.p, uMq, [0, topInner - 1 - t * Math.max(0, nMq[1])], [1, 0]);
  const mqLen = dot(sub(mqEnd, C3), uMq);
  const marquee = panel('marquee', 'Marquee', { at: C3, d: uMq, n: nMq, length: mqLen });
  const opalLen = mqLen - 10;
  const opal = {
    id: 'marquee-diffuser', name: 'Marquee diffuser (opal acrylic, glued behind the marquee)', material: 'opal3', thickness: ta, group: 'shell',
    outline: rect(0.5, 0, W - 0.5, opalLen), circles: [], polys: [], engrave: [], labels: [], width: W - 1, length: opalLen,
    frame: { o: to3(add(add(C3, mul(uMq, 5)), mul(nMq, t))), u: [1, 0, 0], v: to3(uMq), w: to3(nMq) },
    explode: to3(mul(nMq, -1)),
    section: strip(add(add(C3, mul(uMq, 5)), mul(nMq, t)), add(add(C3, mul(uMq, 5 + opalLen)), mul(nMq, t)), nMq, ta),
  };
  parts.push(opal);
  strips.push({ id: opal.id, poly: opal.section, glued: 'marquee' });

  // LED board behind the marquee.
  const ledDepth = t + ta + p.lightGap;
  const backerTry = (v0, v1) => strip(add(add(C3, mul(uMq, v0)), mul(nMq, ledDepth)), add(add(C3, mul(uMq, v1)), mul(nMq, ledDepth)), nMq, t);
  let bv0 = 0;
  while (bv0 < mqLen && (overlapArea(backerTry(bv0, mqLen), speaker.section) > 0 || polyDistance(backerTry(bv0, bv0 + 1), speaker.section) < 4)) bv0 += 1;
  let bv1 = mqLen;
  const topSection = top.section;
  while (bv1 > bv0 && polyDistance(backerTry(bv1 - 1, bv1), topSection) < 4) bv1 -= 1;
  const backer = panel('led-board', 'LED board', { at: add(add(C3, mul(uMq, bv0)), mul(nMq, ledDepth)), d: uMq, n: nMq, length: bv1 - bv0, group: 'inner' });

  // Back: a rail at the bottom, a door, a rail at the top.
  const backZ = D - p.inset;
  const lowerTop = floorTop + p.door.lower;
  const doorTop = lowerTop + p.door.height;
  const backLower = panel('back-lower', 'Back, lower', { at: [backZ, floorTop], d: [0, 1], n: [-1, 0], length: p.door.lower });
  const backUpper = panel('back-upper', 'Back, upper', { at: [backZ, doorTop], d: [0, 1], n: [-1, 0], length: topInner - 0.5 - doorTop });
  const door = {
    id: 'door', name: 'Back door', material: 'ply6', thickness: t, group: 'shell',
    outline: rect(0, 0, W - 2, p.door.height - 2), circles: [], polys: [], engrave: [], labels: [], width: W - 2, length: p.door.height - 2,
    frame: { o: [1, lowerTop + 1, backZ], u: [1, 0, 0], v: [0, 1, 0], w: [0, 0, -1] },
    explode: [0, 0, 1],
    section: strip([backZ, lowerTop + 1], [backZ, doorTop - 1], [-1, 0], t),
  };
  parts.push(door);
  strips.push({ id: door.id, poly: door.section });
  const stops = [lowerTop - 16, doorTop - 18].map((y0, i) => {
    const part = {
      id: `door-stop-${i + 1}`, name: `Door stop ${i ? 'top' : 'bottom'}`, material: 'ply6', thickness: t, group: 'inner',
      outline: rect(0, 0, W, 24), circles: [], polys: [], engrave: [], labels: [], width: W, length: 24,
      frame: { o: to3([backZ - t, y0]), u: [1, 0, 0], v: [0, 1, 0], w: [0, 0, -1] },
      explode: [0, 0, -1],
      section: strip([backZ - t, y0], [backZ - t, y0 + 24], [-1, 0], t),
    };
    parts.push(part);
    strips.push({ id: part.id, poly: part.section, glued: i ? 'back-upper' : 'back-lower' });
    return part;
  });

  // ── holes and engraving ──

  // Control panel: the arcade's layout, centred, top row toward the screen.
  const sc = Math.min(p.layoutScale, W / 736);
  const backRow = cpLen - 52; // the top row's centre, from the panel's front edge (clear of the box's back wall)
  const cpAt = (lx, ly) => [W / 2 + (lx - 400) * sc, backRow - (ly - 96) * sc];
  const controls = {};
  for (const [id, c] of Object.entries(LAYOUT)) {
    if (c.y === undefined) continue;
    const [x, y] = cpAt(c.x, c.y);
    controls[id] = { x, y, dia: p.holes[c.hole] };
    hole(cp, x, y, p.holes[c.hole]);
    if (c.label) cp.engrave.push(...dotText(c.label, { x, y: y - p.holes[c.hole] / 2 - 4.5, pitch: 1.05, r: 0.42, center: true }));
  }
  const apronMid = apron.length / 2;
  for (const id of ['LAUNCH', 'PLUNGER']) {
    const c = LAYOUT[id];
    const x = W / 2 + (c.x - 400) * sc;
    hole(apron, x, apronMid, p.holes[c.hole]);
    controls[id] = { x, y: apronMid, dia: p.holes[c.hole] };
    if (c.label) apron.engrave.push(...dotText(c.label, { x, y: apronMid + p.holes[c.hole] / 2 + 10, pitch: 1.05, r: 0.42, center: true }));
  }
  props.push({ kind: 'controls', cp: controls, layout: LAYOUT });

  // Flipper buttons in the sides: 95 mm back from the control panel's front, below its surface.
  const flipper = add(add(cpStart, mul(uCp, 95)), mul(nCp, 32));


  // Shelf: a notch for the monitor's cables.
  shelf.polys.push(roundRect(W / 2 - 50, shelf.length - 22, W / 2 + 50, shelf.length - 6, 6));

  // VESA brace: slotted holes for 100 and 75 patterns (±6 mm of adjustment), and a cable hole.
  for (const pitch of [100, 75]) {
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
      const cx = W / 2 + (sx * pitch) / 2, cy = braceLen / 2 + (sy * pitch) / 2;
      brace.polys.push(roundRect(cx - (4.5 - k) / 2, cy - 6 - (4.5 - k) / 2, cx + (4.5 - k) / 2, cy + 6 + (4.5 - k) / 2, (4.5 - k) / 2));
    }
  }
  brace.polys.push(roundRect(W / 2 - 22, braceLen / 2 - 15, W / 2 + 22, braceLen / 2 + 15, 8));

  // Speakers: dot grilles, screw holes, and INSERT COIN between them.
  for (const sx of [-1, 1]) {
    const cx = W / 2 + sx * p.speaker.spread, cy = spkLen / 2;
    for (const d of dotCircle(cx, cy, p.speaker.grille / 2, 5.2, 1.75)) speaker.circles.push({ ...d, r: d.r - k / 2 });
    for (const qx of [-1, 1]) for (const qy of [-1, 1]) hole(speaker, cx + (qx * p.speaker.screws) / 2, cy + (qy * p.speaker.screws) / 2, p.speaker.screw);
  }
  speaker.engrave.push(...dotText('INSERT COIN', { x: W / 2, y: spkLen / 2, pitch: 1.9, r: 0.75, center: true }));

  // Marquee: the name in big dots, a row of "bulbs" round the edge; the LEDs shine through.
  {
    const text = p.marqueeText;
    const border = 11;
    const pitch = Math.min(((W - 2 * border - 40) * 0.92) / Math.max(1, textWidth(text, 1)), (mqLen - 2 * border - 30) / 7);
    for (const d of dotText(text, { x: W / 2, y: mqLen / 2, pitch, r: pitch * 0.34, center: true })) marquee.circles.push({ ...d, r: d.r - k / 2 });
    const bulb = 9;
    const nx = Math.round((W - 2 * border) / bulb), ny = Math.round((mqLen - 2 * border) / bulb);
    const sx = (W - 2 * border) / nx, sy = (mqLen - 2 * border) / ny;
    for (let i = 0; i <= nx; i++) for (const y of [border, mqLen - border]) marquee.circles.push({ x: border + i * sx, y, r: 1.9 - k / 2 });
    for (let j = 1; j < ny; j++) for (const x of [border, W - border]) marquee.circles.push({ x, y: border + j * sy, r: 1.9 - k / 2 });
  }

  // LED board: zip-tie slots for the strip's rows, and a cable hole.
  const ledRows = Math.max(1, p.leds.rows);
  const rowGap = backer.length / (ledRows + 1);
  for (let r = 1; r <= ledRows; r++) {
    for (let x = 30; x < W - 20; x += 90) {
      for (const dy of [-7, 7]) backer.polys.push(roundRect(x - 1.6, r * rowGap + dy - 2.2, x + 1.6, r * rowGap + dy + 2.2, 1.5));
    }
  }
  hole(backer, 14, rowGap, 10);
  const ledsPerRow = Math.floor(((W - 20) / 1000) * p.leds.perMetre);

  // Back: the power inlet and a USB socket in the lower rail; vents in everything.
  {
    const iec = { w: 28, h: 48 };
    backLower.polys.push(rect(40, 60, 40 + iec.w - k, 60 + iec.h - k));
    backLower.polys.push(rect(90, 70, 90 + 14.9 - k, 70 + 19.3 - k)); // keystone USB
    // Vents: low in the door for cool air in, high in the back for warm air out.
    for (const d of dotRect(W / 2 - 150, backUpper.length / 2 - 28, W / 2 + 150, backUpper.length / 2 + 28, 11, 3)) backUpper.circles.push({ ...d, r: d.r - k / 2 });
    for (const d of dotRect(door.width / 2 - 160, 50, door.width / 2 + 160, 120, 11, 3)) door.circles.push({ ...d, r: d.r - k / 2 });
    hole(door, door.width / 2, door.length - 30, 26); // finger pull
    for (const x of [40, door.width - 40]) hole(door, x, door.length - 8, 10.2); // magnets, over the top stop
    for (const x of [41, W - 41]) hole(stops[1], x, 9, 10.2);
    door.engrave.push(...dotText('PLAYER 1', { x: door.width / 2, y: 24, pitch: 2.2, r: 0.85, center: true }));
  }

  // ── the sides ──

  const holesOuter = [];
  const holesInner = [];
  holesOuter.push({ kind: 'flipper', poly: circlePoly(flipper[0], flipper[1], (p.holes.flipper - k) / 2) });
  holesInner.push({ kind: 'flipper', poly: circlePoly(flipper[0], flipper[1], 19) });
  // The monitor's recess: open at the face, as deep as the monitor's ends are thick; the shelf drops into its foot.
  const recess = [
    add(X1, mul(uFace, gm - t - 0.2)),
    add(add(X1, mul(uFace, gm - t - 0.2)), mul(nFace, 6 + shelfDepth + 0.3)),
    add(add(X1, mul(uFace, gm + 0.2)), mul(nFace, 6 + shelfDepth + 0.3)),
    add(add(X1, mul(uFace, gm + 0.2)), mul(nFace, mon.edge + 2)),
    add(add(X1, mul(uFace, gm + mon.h + 1.5)), mul(nFace, mon.edge + 2)),
    add(X1, mul(uFace, gm + mon.h + 1.5)),
    add(add(X1, mul(uFace, gm + mon.h + 1.5)), mul(nFace, -p.reveal - 1)),
    add(add(X1, mul(uFace, gm - t - 0.2)), mul(nFace, -p.reveal - 1)),
  ];
  holesInner.push({ kind: 'recess', poly: recess });
  // A hand hold through both layers: as high up the back as the slots allow.
  const hand = (() => {
    const avoid = [...slots.map((sl) => sl.poly), recess, circlePoly(flipper[0], flipper[1], 19)].map((poly) => ({ poly, b: bounds([poly]) }));
    const edgeDist = (q) => Math.min(...profile.map((a2, i) => distPtSeg(q, a2, profile[(i + 1) % profile.length])));
    for (let y = H - 45; y > H * 0.45; y -= 3) {
      for (let z = D - 40; z > D * 0.5; z -= 3) {
        const cand = roundRect(z - 48, y - 15, z + 48, y + 15, 15);
        if (!cand.every((q) => pointInPoly(q, profile) && edgeDist(q) >= 22)) continue;
        const cb = bounds([cand]);
        const near = avoid.filter(({ b }) => b.x0 < cb.x1 + 9 && b.x1 > cb.x0 - 9 && b.y0 < cb.y1 + 9 && b.y1 > cb.y0 - 9);
        if (near.every(({ poly }) => polyDistance(cand, poly) >= 9)) return cand;
      }
    }
    notes.push('No room for hand holds in the sides.');
    return null;
  })();
  if (hand) {
    holesOuter.push({ kind: 'hand', poly: hand });
    holesInner.push({ kind: 'hand', poly: hand });
  }
  for (const sl of slots) holesInner.push({ kind: 'slot', panel: sl.panel, poly: sl.poly });

  // Seams: horizontal, staggered between the layers, every piece within the bed.
  const pieceH = Math.min(usable[1], 280);
  const nOuter = Math.ceil(H / pieceH);
  const outerSeams = Array.from({ length: nOuter - 1 }, (_, i) => (H * (i + 1)) / nOuter);
  const innerSeams = [H / (2 * nOuter), ...outerSeams.map((y) => y + H / (2 * nOuter))].filter((y) => y < H - 20);
  // Seams keep off slots (no slivers between them), and away from the
  // shallow control-panel edge and the top, where a level cut would leave a
  // long thin strip.
  const nudge = (y, features) => {
    const bad = (yy) =>
      (yy > F1[1] - 45 && yy < F2[1] + 8) || yy > H - 50 || yy < 50 ||
      features.some((f) => { const b = bounds([f.poly]); return yy > b.y0 - 4 && yy < b.y1 + 4 && f.kind !== 'recess' && f.kind !== 'hand'; });
    for (let dy = 0; dy < 120; dy++) for (const sgn of [-1, 1]) if (!bad(y + sgn * dy)) return y + sgn * dy;
    return y;
  };
  const seamsOuter = outerSeams.map((y) => nudge(y, holesOuter));
  const seamsInner = innerSeams.map((y) => nudge(y, holesInner));

  // Dowel holes that pin the layers together while the glue dries.
  const dowels = [];
  {
    const all = [...holesInner, ...holesOuter].map((f) => f.poly);
    const ok = (pt) =>
      pointInPoly(pt, profile) &&
      profile.every((q, i) => distPtSeg(pt, q, profile[(i + 1) % profile.length]) > 14) &&
      all.every((f) => !pointInPoly(pt, f) && f.every((q, i) => distPtSeg(pt, q, f[(i + 1) % f.length]) > 9)) &&
      [...seamsOuter, ...seamsInner].every((y) => Math.abs(pt[1] - y) > 12);
    const cands = [];
    for (let z = 10; z < D; z += 6) for (let y = 10; y < H; y += 6) if (ok([z, y])) cands.push([z, y]);
    const bandOf = (y, seams) => seams.filter((s2) => y > s2).length;
    const need = new Map();
    for (const [seams, tag] of [[seamsOuter, 'o'], [seamsInner, 'i']]) for (let b = 0; b <= seams.length; b++) need.set(`${tag}${b}`, 2);
    for (let guard = 0; guard < 40; guard++) {
      const want = [...need.entries()].find(([, v]) => v > 0);
      if (!want) break;
      const [key] = want;
      const pool = cands.filter(([, y]) => `${key[0]}${bandOf(y, key[0] === 'o' ? seamsOuter : seamsInner)}` === key);
      if (!pool.length) {
        need.set(key, 0);
        notes.push(`No room for a dowel in side piece ${key}.`);
        continue;
      }
      let best = pool[0], bestD = -1;
      for (const c of pool) {
        const dd = dowels.length ? Math.min(...dowels.map((q) => len(sub(c, q)))) : len(sub(c, [D / 2, H / 2]));
        if (dd > bestD) { bestD = dd; best = c; }
      }
      dowels.push(best);
      need.set(`o${bandOf(best[1], seamsOuter)}`, need.get(`o${bandOf(best[1], seamsOuter)}`) - 1);
      need.set(`i${bandOf(best[1], seamsInner)}`, need.get(`i${bandOf(best[1], seamsInner)}`) - 1);
    }
  }
  const dowelPolys = dowels.map(([z, y]) => circlePoly(z, y, (6.1 - k) / 2, 32));

  const sidePieces = [];
  // Dowels go through the inner layer and into pockets engraved in the outer
  // layer's glued face, so nothing shows outside.
  const layer = (which) => {
    const feats = (which === 'outer' ? holesOuter.map((f) => f.poly) : holesInner.map((f) => f.poly).concat(dowelPolys));
    const seams = which === 'outer' ? seamsOuter : seamsInner;
    const edges = [-1, ...seams, H + 1];
    const out = [];
    for (let b = 0; b < edges.length - 1; b++) {
      const band = rect(-1, edges[b], D + 1, edges[b + 1]);
      for (const piece of carve(profile, feats, band)) out.push(piece);
    }
    return out;
  };
  for (const side of ['left', 'right']) {
    for (const which of ['outer', 'inner']) {
      const pieces = layer(which);
      pieces.forEach((pc, i) => {
        // Laser-up faces end up glued (hidden): see the README.
        const mirror = (side === 'left') === (which === 'outer');
        const x0 = side === 'left' ? (which === 'outer' ? -2 * t : -t) : which === 'outer' ? W + t : W;
        sidePieces.push({
          id: `${side}-${which}-${i + 1}`,
          name: `${side === 'left' ? 'Left' : 'Right'} side, ${which} layer, piece ${i + 1}`,
          material: 'ply6', thickness: t, group: 'side', side, layer: which,
          outline: pc.outer, holes: pc.holes, circles: [], polys: [], engrave: [], labels: [],
          pockets: which === 'outer' ? dowels.filter((q) => pointInPoly(q, pc.outer)).map(([x, y]) => ({ x, y, r: 3.15 })) : [],
          mirror,
          frame: { o: [x0, 0, 0], u: [0, 0, 1], v: [0, 1, 0], w: [1, 0, 0] },
          explode: [side === 'left' ? -1 : 1, 0, 0],
          explodeScale: which === 'outer' ? 1.6 : 1,
        });
      });
    }
  }
  parts.push(...sidePieces);

  // Parts need names on their hidden faces.
  for (const part of parts) {
    if (part.group === 'side' || ['floor-front', 'floor-back', 'cp-beam', 'shelf', 'vesa', 'led-board', 'back-lower', 'back-upper', 'door-stop-1', 'door-stop-2'].includes(part.id)) {
      part.labels.push(part.id.toUpperCase());
    }
  }

  // ── what isn't cut ──
  props.push({ kind: 'monitor', monitor: mon, at: to3(monFace), up: to3(uFace), back: to3(nFace), W, t });
  props.push({ kind: 'flippers', at: to3(flipper), W, t });
  props.push({ kind: 'speakers', panel: 'speaker', spread: p.speaker.spread, size: p.speaker.frame });
  props.push({ kind: 'leds', panel: 'led-board', rows: ledRows, perRow: ledsPerRow, rowGap });

  const model = {
    params: p, monitor: mon, W, t, tab, D, H, notes,
    width: W + 4 * t, profile, points: { F0, F1, F2, F3, F4, F5, F6, X1, C3, C4, cpStart, flipper, monFace },
    seams: { outer: seamsOuter, inner: seamsInner }, dowels, holesInner, holesOuter, slots, strips, parts, props,
    monitorSection: monitor.section,
    leds: { rows: ledRows, perRow: ledsPerRow, total: ledRows * ledsPerRow },
  };
  model.checks = check(model, { usable, monitor, apron, cp, wall, speaker, top, backer, brace, shelf, controls, sc, flipper });
  return model;
}

function distPtSeg(pt, a, b) {
  const ab = sub(b, a);
  const tt = Math.max(0, Math.min(1, dot(sub(pt, a), ab) / dot(ab, ab)));
  return len(sub(pt, add(a, mul(ab, tt))));
}

/** The best-fitting rotation of a part on the bed: its size there, or null if it can't fit. */
export function fitOnBed(part, usable) {
  const polys = [part.outline];
  const b = bounds(polys);
  const sizes = [
    { rot: 0, w: b.w, h: b.h },
    { rot: 90, w: b.h, h: b.w },
  ];
  return sizes.find((sz) => sz.w <= usable[0] && sz.h <= usable[1]) || null;
}

function check(model, ctx) {
  const out = [];
  const add2 = (ok, what, detail = '') => out.push({ ok, what, detail });
  const { strips, profile, parts, holesInner } = model;

  // Every part fits on the bed.
  const tooBig = parts.filter((pt) => !fitOnBed(pt, ctx.usable));
  add2(!tooBig.length, 'Every part fits on the bed', tooBig.map((pt) => `${pt.id} ${bounds([pt.outline]).w.toFixed(0)}×${bounds([pt.outline]).h.toFixed(0)}`).join(', '));

  // Panels don't run into each other, and stay inside the sides.
  const clashes = [];
  for (let i = 0; i < strips.length; i++) {
    for (let j = i + 1; j < strips.length; j++) {
      const A = strips[i], B = strips[j];
      if (A.glued === B.id || B.glued === A.id) continue;
      const o = overlapArea(A.poly, B.poly);
      if (o > 0.05) clashes.push(`${A.id}/${B.id} ${o.toFixed(1)} mm²`);
    }
  }
  add2(!clashes.length, 'No two panels occupy the same space', clashes.join(', '));
  const outside = strips.filter((s2) => overlapArea(s2.poly, profile) < Math.abs(area(s2.poly)) - 0.05).map((s2) => s2.id);
  add2(!outside.length, 'Every panel is inside the side profile', outside.join(', '));

  // The monitor fits: nothing in its way but the shelf under it and the brace behind it.
  const mon = ctx.monitor.section.map((q) => q);
  const shrink = (poly, by) => { const c = poly.reduce((acc, q) => add(acc, mul(q, 1 / poly.length)), [0, 0]); return poly.map((q) => add(q, mul(norm(sub(c, q)), by))); };
  const monHits = strips.filter((s2) => overlapArea(shrink(mon, 0.8), s2.poly) > 0.05).map((s2) => s2.id);
  add2(!monHits.length, 'The monitor has room', monHits.join(', '));
  const roomEachSide = (model.W + 2 * model.t - model.monitor.w) / 2;
  add2(roomEachSide >= 1.5, `The monitor's width fits (${roomEachSide.toFixed(1)} mm each side)`);

  // Webs in the inner layer: slots don't crowd each other or the edge.
  const thin = [];
  const feats = holesInner.filter((f) => f.kind === 'slot' || f.kind === 'flipper');
  for (let i = 0; i < feats.length; i++) {
    for (let j = i + 1; j < feats.length; j++) {
      const dd = polyDistance(feats[i].poly, feats[j].poly);
      if (dd < 2.5) thin.push(`${feats[i].panel || feats[i].kind}/${feats[j].panel || feats[j].kind} ${dd.toFixed(1)} mm`);
    }
    const recess = holesInner.find((f) => f.kind === 'recess');
    if (feats[i].panel !== 'shelf') {
      const dd = polyDistance(feats[i].poly, recess.poly);
      if (dd < 2.5) thin.push(`${feats[i].panel || feats[i].kind}/recess ${dd.toFixed(1)} mm`);
    }
  }
  add2(!thin.length, 'Slots keep at least 2.5 mm of wood between them', thin.join(', '));
  const edgeThin = feats.filter((f) => profile.some((q, i) => f.poly.some((pt) => distPtSeg(pt, q, profile[(i + 1) % profile.length]) < 2.5))).map((f) => f.panel || f.kind);
  add2(!edgeThin.length, 'Slots stay 2.5 mm in from the outside edge', edgeThin.join(', '));

  // Holes in panels don't crowd each other or the edges.
  const crowded = [];
  for (const part of parts.filter((pp) => pp.group !== 'side')) {
    const b = bounds([part.outline]);
    for (const c of part.circles) {
      if (c.x - c.r < 2 || c.x + c.r > part.width - 2 || c.y - c.r < 2 || c.y + c.r > (part.length ?? b.h) - 2) crowded.push(`${part.id} hole at ${c.x.toFixed(0)},${c.y.toFixed(0)} is near the edge`);
    }
    const big = part.circles.filter((c) => c.r > 3);
    for (let i = 0; i < big.length; i++) for (let j = i + 1; j < big.length; j++) {
      const dd = Math.hypot(big[i].x - big[j].x, big[i].y - big[j].y) - big[i].r - big[j].r;
      if (dd < 3) crowded.push(`${part.id} holes ${dd.toFixed(1)} mm apart`);
    }
  }
  add2(!crowded.length, 'Holes keep 3 mm of wood around them', crowded.slice(0, 6).join(', '));

  // What hangs under the control panel clears the walls: buttons 45 mm deep, the stick 70.
  const blocked = [];
  for (const [id, c] of Object.entries(ctx.controls)) {
    if (id === 'LAUNCH' || id === 'PLUNGER') continue;
    const depth = id === 'STICK' ? 72 : id === 'KNOB' ? 25 : 45;
    const r = id === 'STICK' ? 45 : c.dia / 2 + 3;
    const body = strip(add(ctx.cp.at, mul(ctx.cp.d, c.y - r)), add(ctx.cp.at, mul(ctx.cp.d, c.y + r)), ctx.cp.n, depth);
    for (const other of [ctx.apron, ctx.wall]) if (overlapArea(body, other.section) > 0.05) blocked.push(`${id}/${other.id}`);
  }
  // The plunger runs 190 mm straight back from the front.
  const plungerBody = strip([ctx.apron.at[0], ctx.apron.at[1] + ctx.apron.length / 2 - 22], [ctx.apron.at[0] + 196, ctx.apron.at[1] + ctx.apron.length / 2 - 22], [0, 1], 44);
  if (overlapArea(plungerBody, ctx.wall.section) > 0.05) blocked.push('PLUNGER/cp-beam');
  add2(!blocked.length, 'Stick, buttons and plunger have room underneath', blocked.join(', '));

  // The flipper buttons sit below the control panel, clear of its slots.
  const flip = circlePoly(ctx.flipper[0], ctx.flipper[1], 19);
  const flipClash = strips.filter((s2) => overlapArea(flip, s2.poly) > 0.05).map((s2) => s2.id);
  add2(!flipClash.length, 'The flipper buttons clear the panels inside', flipClash.join(', '));

  return out;
}
