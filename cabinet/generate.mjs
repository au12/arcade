#!/usr/bin/env node
// Builds the cabinet's cut files from its parameters.
//
//   node generate.mjs                          21.5" monitor, 6 mm plywood, 12 × 20 in bed
//   node generate.mjs --monitor 19.5
//   node generate.mjs --ply 5.8 --kerf 0.18 --bed 500x300 --out my-cabinet
//   node generate.mjs --list                   the monitors it knows
//
// Writes, into the output folder (cut/<monitor> by default):
//   ply-NN.svg, opal-NN.svg   one sheet per bed load, ready for LightBurn
//   parts.csv                 every part, its size and its sheet
//   profile.svg               a side view with the main dimensions
//   cabinet.json              the whole model, for the 3D viewer

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { design, MONITORS, DEFAULTS } from './lib/design.mjs';
import { nest } from './lib/nest.mjs';
import { sheetSvg, profileSvg } from './lib/svg.mjs';
import { bounds, rect } from './lib/geom.mjs';
import { dotText } from './lib/dots.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const opts = {};
  let out = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === '--list') opts.list = true;
    else if (a === '--out') out = next();
    else if (a === '--monitor') opts.monitor = next();
    else if (a === '--bed') opts.bed = next().split(/[x×,]/).map(Number);
    else if (a === '--quiet') opts.quiet = true;
    else if (a.startsWith('--')) {
      // --cp-angle 10, --holes.button 30, --monitor.w 480 (sizes of your own monitor)
      const [key, sub] = a.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase()).split('.');
      const raw = next();
      const v = Number.isFinite(Number(raw)) ? Number(raw) : raw;
      if (!(key in DEFAULTS)) throw new Error(`Unknown option ${a}. Options: ${Object.keys(DEFAULTS).join(', ')}`);
      if (sub) {
        const base = typeof opts[key] === 'object' ? opts[key] : key === 'monitor' && typeof opts.monitor === 'string' ? { ...MONITORS[opts.monitor] } : {};
        opts[key] = { ...base, [sub]: v };
        if (key === 'monitor') delete opts.monitor.name;
      } else opts[key] = v;
    }
  }
  return { opts, out };
}

export function build(opts = {}, outDir = null) {
  const model = design(opts);
  const dir = outDir || path.join(here, 'cut', typeof model.params.monitor === 'string' ? model.params.monitor : 'custom');
  fs.mkdirSync(dir, { recursive: true });
  for (const f of fs.readdirSync(dir)) if (/^(ply|opal|clear)-\d+\.svg$/.test(f)) fs.rmSync(path.join(dir, f));

  const { bed, margin, spacing } = model.params;
  const usable = [bed[0] - 2 * margin, bed[1] - 2 * margin];
  const sheets = [];
  const rows = [];
  for (const material of ['ply6', 'opal3']) {
    const parts = model.parts.filter((p) => p.material === material);
    if (!parts.length) continue;
    const prefix = material === 'ply6' ? 'ply' : 'opal';
    nest(parts, { size: usable, spacing }).forEach((placements, i) => {
      const name = `${prefix}-${String(i + 1).padStart(2, '0')}.svg`;
      const title = `au12 Arcade cabinet: ${material === 'ply6' ? `${model.t} mm plywood` : `${model.params.acrylic} mm opal acrylic`}, sheet ${i + 1}`;
      fs.writeFileSync(path.join(dir, name), sheetSvg(placements, { bed, margin, title }));
      sheets.push({ name, material, parts: placements.map((pl) => pl.part.id) });
      for (const pl of placements) {
        const b = bounds([pl.part.outline]);
        rows.push([pl.part.id, `"${pl.part.name}"`, material, b.w.toFixed(1), b.h.toFixed(1), name, pl.rot, pl.mirror ? 'flipped' : '']);
      }
    });
  }
  fs.writeFileSync(path.join(dir, 'test-fit.svg'), testFit(model));
  fs.writeFileSync(path.join(dir, 'parts.csv'), `id,name,material,width_mm,height_mm,sheet,turned,face\n${rows.map((r) => r.join(',')).join('\n')}\n`);
  fs.writeFileSync(path.join(dir, 'profile.svg'), profileSvg(model));
  fs.writeFileSync(path.join(dir, 'cabinet.json'), JSON.stringify(viewerModel(model, sheets)));
  return { model, sheets, dir };
}

/**
 * Cut this first: five slots from snug to loose with a tab to try in each,
 * and the button and stick holes. The slot that grips the tab firmly by hand
 * tells you the --fit to use; if none does, measure the plywood again.
 */
export function testFit(model) {
  const { t, params } = model;
  const k = params.kerf;
  const fits = [-0.1, 0, 0.1, 0.2, 0.3];
  const coupon = {
    id: 'test-fit', name: 'Fit test', outline: rect(0, 0, 176, 70), holes: [], circles: [], polys: [], engrave: [], labels: [],
  };
  fits.forEach((fit, i) => {
    const x = 12 + i * 22;
    coupon.polys.push(rect(x, 34 - k / 2, x + 14 + 0.4 - k, 34 + t + fit - k));
    coupon.engrave.push(...dotText(fit >= 0 ? `+${fit.toFixed(1).replace('0.', '.')}` : fit.toFixed(1).replace('0.', '.'), { x: x + 7, y: 22, pitch: 0.9, r: 0.36, center: true }));
  });
  coupon.circles.push({ x: 132, y: 35, r: (params.holes.button - k) / 2 }, { x: 162, y: 49, r: (params.holes.small - k) / 2 }, { x: 162, y: 20, r: (params.holes.encoder - k) / 2 });
  coupon.engrave.push(...dotText(`${t} MM`, { x: 58, y: 60, pitch: 1, r: 0.4, center: true }));
  const tab = { id: 'test-tab', name: 'Fit test tab', outline: [[0, 0], [30, 0], [30, 24], [22, 24], [22, 24 + 12], [8, 24 + 12], [8, 24], [0, 24]], holes: [], circles: [], polys: [], engrave: [], labels: [] };
  const placements = [
    { part: coupon, rot: 0, mirror: false, dx: 0, dy: 0 },
    { part: tab, rot: 0, mirror: false, dx: 186, dy: 0 },
  ];
  return sheetSvg(placements, { bed: [230, 80], margin: 5, title: `Fit test for ${t} mm plywood, kerf ${k} mm` });
}

/** What the 3D viewer needs: shapes, where they go, and the bits that aren't cut. */
export function viewerModel(model, sheets = []) {
  const r = (v) => Math.round(v * 100) / 100;
  const rp = (poly) => poly.map(([x, y]) => [r(x), r(y)]);
  return {
    W: model.W, t: model.t, D: model.D, H: r(model.H), width: model.width,
    monitor: model.monitor, leds: model.leds, params: { cpAngle: model.params.cpAngle, screenTilt: model.params.screenTilt },
    points: Object.fromEntries(Object.entries(model.points).map(([k, v]) => [k, v.map(r)])),
    sheets: sheets.map((s) => ({ name: s.name, material: s.material, parts: s.parts.length })),
    parts: model.parts.map((p) => ({
      id: p.id, name: p.name, material: p.material, thickness: p.thickness, group: p.group,
      outline: rp(p.outline),
      holes: [...(p.holes || []), ...(p.polys || [])].map(rp),
      circles: (p.circles || []).map((c) => [r(c.x), r(c.y), r(c.r)]),
      engrave: (p.engrave || []).map((c) => [r(c.x), r(c.y), r(c.r)]),
      frame: Object.fromEntries(Object.entries(p.frame).map(([k, v]) => [k, v.map(r)])),
      explode: p.explode.map(r),
      explodeScale: p.explodeScale || 1,
      side: p.side, layer: p.layer,
    })),
    props: model.props,
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  try {
    const { opts, out } = parseArgs(process.argv.slice(2));
    if (opts.list) {
      for (const [k, m] of Object.entries(MONITORS)) console.log(`${k.padEnd(10)} ${m.name}: ${m.w} × ${m.h} mm`);
      process.exit(0);
    }
    const quiet = opts.quiet;
    delete opts.quiet;
    const { model, sheets, dir } = build(opts, out);
    const ok = model.checks.every((c) => c.ok);
    if (!quiet) {
      console.log(`au12 Arcade cabinet for a ${model.monitor.name}`);
      console.log(`  ${Math.round(model.width)} wide × ${Math.round(model.D)} deep × ${Math.round(model.H)} tall (mm), inside width ${model.W} mm`);
      const ply = sheets.filter((s) => s.material === 'ply6').length, opal = sheets.length - ply;
      console.log(`  ${ply} sheets of ${model.t} mm plywood${opal ? `, ${opal} of ${model.params.acrylic} mm opal acrylic` : ''} (${model.params.bed.join(' × ')} mm bed)`);
      console.log(`  marquee LEDs: ${model.leds.rows} rows of ${model.leds.perRow} (${model.leds.total} in all)`);
      for (const c of model.checks) console.log(`  ${c.ok ? '✓' : '✗'} ${c.what}${c.detail ? `: ${c.detail}` : ''}`);
      for (const n of model.notes) console.log(`  note: ${n}`);
      console.log(`  → ${path.relative(process.cwd(), dir) || '.'}`);
    }
    process.exit(ok ? 0 : 2);
  } catch (e) {
    console.error(`Can't build that cabinet: ${e.message}`);
    process.exit(1);
  }
}
