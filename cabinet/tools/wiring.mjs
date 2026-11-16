#!/usr/bin/env node
// Draws the controller's wiring (cabinet/docs/wiring.svg) from the Pico's
// pinout and the pins in controller/firmware/.../config.h.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const config = fs.readFileSync(path.join(here, '../../controller/firmware/au12-arcade-controller/config.h'), 'utf8');
const pin = (name) => Number(new RegExp(`#define ${name} (\\d+)`).exec(config)[1]);

// The Pico, seen from above with its USB socket at the top.
const LEFT = ['GP0', 'GP1', 'GND', 'GP2', 'GP3', 'GP4', 'GP5', 'GND', 'GP6', 'GP7', 'GP8', 'GP9', 'GND', 'GP10', 'GP11', 'GP12', 'GP13', 'GND', 'GP14', 'GP15'];
const RIGHT = ['VBUS', 'VSYS', 'GND', '3V3_EN', '3V3', 'ADC_VREF', 'GP28', 'AGND', 'GP27', 'GP26', 'RUN', 'GP22', 'GND', 'GP21', 'GP20', 'GP19', 'GP18', 'GND', 'GP17', 'GP16'];

const GROUPS = {
  stick: { color: '#d64545', name: 'Joystick' },
  buttons: { color: '#e09a1a', name: 'Player buttons' },
  system: { color: '#3d8bd9', name: 'Start, Coin, Menu' },
  pinball: { color: '#8a55d6', name: 'Pinball' },
  accel: { color: '#2aa198', name: 'Nudge sensor (LSM6DSOX)' },
  knob: { color: '#5c6370', name: 'Volume knob (EC11)' },
  leds: { color: '#c2185b', name: 'Marquee LEDs' },
  power: { color: '#222222', name: 'Power' },
};

const wires = [
  ['UP', 'PIN_UP', 'stick', 'Stick up'], ['DOWN', 'PIN_DOWN', 'stick', 'Stick down'], ['LEFT', 'PIN_LEFT', 'stick', 'Stick left'], ['RIGHT', 'PIN_RIGHT', 'stick', 'Stick right'],
  ['SDA', 'PIN_SDA', 'accel', 'SDA'], ['SCL', 'PIN_SCL', 'accel', 'SCL'],
  ['B1', 'PIN_B1', 'buttons', 'B1 (top left)'], ['B2', 'PIN_B2', 'buttons', 'B2 (top middle)'], ['B3', 'PIN_B3', 'buttons', 'B3 (top right)'],
  ['B4', 'PIN_B4', 'buttons', 'B4 (bottom left)'], ['B5', 'PIN_B5', 'buttons', 'B5 (bottom middle)'], ['B6', 'PIN_B6', 'buttons', 'B6 (bottom right)'],
  ['START', 'PIN_START', 'system', 'Start'], ['COIN', 'PIN_COIN', 'system', 'Coin'], ['HOME', 'PIN_HOME', 'system', 'Menu'],
  ['LFLIP', 'PIN_LFLIP', 'pinball', 'Left flipper (side)'], ['RFLIP', 'PIN_RFLIP', 'pinball', 'Right flipper (side)'], ['LAUNCH', 'PIN_LAUNCH', 'pinball', 'Launch (front)'],
  ['KA', 'PIN_KNOB_A', 'knob', 'Knob A'], ['KB', 'PIN_KNOB_B', 'knob', 'Knob B'], ['KSW', 'PIN_KNOB_SW', 'knob', 'Knob push (mute)'],
  ['LED', 'PIN_LEDS', 'leds', 'LED data, via 74AHCT125 and 330 Ω'],
  ['PLG', 'PIN_PLUNGER', 'pinball', 'Plunger pot, wiper'],
].map(([id, def, group, label]) => ({ id, gp: `GP${pin(def)}`, group, label }));

const extra = [
  { pinName: '3V3', group: 'power', label: 'Nudge sensor VIN, plunger pot (one end)' },
  { pinName: 'AGND', group: 'power', label: 'Plunger pot (other end)' },
  { pinName: 'GND', group: 'power', label: 'Ground: switches, sensor, LED supply' },
];

const W = 1080, rowH = 22, top = 120;
const boardX = 430, boardW = 220, boardTop = top - 26, boardH = 20 * rowH + 40;
const out = [];
out.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${boardTop + boardH + 170}" font-family="system-ui, -apple-system, Segoe UI, sans-serif">`);
out.push(`<rect width="100%" height="100%" fill="#fbf7ef"/>`);
out.push(`<text x="40" y="52" font-size="26" font-weight="800" fill="#1a1220">Controller wiring</text>`);
out.push(`<text x="40" y="78" font-size="14" fill="#5a5060">Raspberry Pi Pico, seen from above. Every switch goes between its pin and ground; the Pico's pull-ups do the rest.</text>`);
out.push(`<rect x="${boardX}" y="${boardTop}" width="${boardW}" height="${boardH}" rx="10" fill="#1f7a3a"/>`);
out.push(`<rect x="${boardX + boardW / 2 - 22}" y="${boardTop - 14}" width="44" height="22" rx="4" fill="#b9c0c8"/>`);
out.push(`<text x="${boardX + boardW / 2}" y="${boardTop + boardH / 2}" font-size="20" font-weight="800" fill="#e8f5e9" text-anchor="middle">PICO</text>`);

const used = new Map(wires.map((w) => [w.gp, w]));
const drawSide = (names, side) => {
  names.forEach((name, i) => {
    const y = top + i * rowH;
    const px = side === 'L' ? boardX : boardX + boardW;
    const n = side === 'L' ? i + 1 : 40 - i;
    out.push(`<circle cx="${px}" cy="${y}" r="5" fill="#f0c94a" stroke="#8a6d10"/>`);
    out.push(`<text x="${side === 'L' ? px + 12 : px - 12}" y="${y + 3.5}" font-size="9.5" fill="#9fd3ac" text-anchor="${side === 'L' ? 'start' : 'end'}">${n}</text>`);
    out.push(`<text x="${side === 'L' ? px + 32 : px - 32}" y="${y + 4}" font-size="11.5" fill="#e8f5e9" text-anchor="${side === 'L' ? 'start' : 'end'}">${name}</text>`);
    const w = used.get(name);
    const ex = extra.find((e) => e.pinName === name && (name !== 'GND' || (side === 'R' && i === 2)));
    const target = w || ex;
    if (!target) return;
    const g = GROUPS[target.group];
    const x1 = side === 'L' ? px - 5 : px + 5;
    const x2 = side === 'L' ? 60 + 250 : W - 60 - 250;
    out.push(`<line x1="${x1}" y1="${y}" x2="${x2}" y2="${y}" stroke="${g.color}" stroke-width="3" stroke-linecap="round"/>`);
    out.push(`<text x="${side === 'L' ? x2 - 10 : x2 + 10}" y="${y + 4.5}" font-size="13.5" fill="#1a1220" text-anchor="${side === 'L' ? 'end' : 'start'}">${target.label}</text>`);
  });
};
drawSide(LEFT, 'L');
drawSide(RIGHT, 'R');

// Key and the LED power note.
let ky = boardTop + boardH + 46;
let kx = 40;
for (const g of Object.values(GROUPS)) {
  out.push(`<rect x="${kx}" y="${ky - 10}" width="22" height="6" rx="3" fill="${g.color}"/>`);
  out.push(`<text x="${kx + 30}" y="${ky - 2}" font-size="13" fill="#1a1220">${g.name}</text>`);
  kx += 30 + g.name.length * 7.2 + 26;
  if (kx > W - 200) {
    kx = 40;
    ky += 26;
  }
}
ky += 40;
out.push(`<text x="40" y="${ky}" font-size="13" fill="#5a5060">The LEDs take 5 V from their own supply (4 A), not from the Pico. Join that supply's ground to the Pico's, put 1000 µF across the strip's power,</text>`);
out.push(`<text x="40" y="${ky + 19}" font-size="13" fill="#5a5060">and run the data line through the 74AHCT125 (powered from the 5 V supply) so the strip sees 5 V logic. The Pico itself runs from the PC's USB.</text>`);
out.push('</svg>');
const dest = path.join(here, '../docs/wiring.svg');
fs.mkdirSync(path.dirname(dest), { recursive: true });
fs.writeFileSync(dest, out.join('\n'));
console.log(`wiring → ${path.relative(process.cwd(), dest)}`);
