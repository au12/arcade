// The cabinet's controller, over Web Serial (Chromium). The controller is a
// USB keyboard + mouse + gamepad for the games; this line is how the arcade
// tells it which game is on (so the buttons mean the right keys), lights the
// marquee, and hears the menu button even while a game has the keyboard.
//
// Protocol: plain text lines, 115200 baud (ignored over USB).
//   → HELLO                       ← HELLO au12-arcade-controller <fw> <board>
//   → PROFILE <name> STICK=KEYS|MOUSE UP=k52 B1=m1 PLUNGER=k2c:hold …
//   → FX <attract|idle|game|record|coin|off> [rrggbb]
//   → TEST ON|OFF                 ← IN <INPUT> <0|1> / PLG <0-1000> / NUD <x> <y>
//   → CAL PLUNGER REST|MAX|SAVE   ← OK CAL …
//                                 ← BTN HOME|COIN|START <0|1>, ACT (someone is playing)

import { signal } from '@preact/signals';
import { navProfile, profileLine } from './hid.js';

export const controller = signal({
  supported: typeof navigator !== 'undefined' && 'serial' in navigator,
  connected: false,
  fw: null,
  board: null,
  profile: null,
  testing: false,
  inputs: {},
  plunger: 0,
  nudge: [0, 0],
  lastActivity: 0,
});

const VENDOR = 0x2e8a; // Raspberry Pi (RP2040 / RP2350)
const listeners = new Set();
let port = null;
let writer = null;
let reading = false;
let currentProfile = null;

const patch = (p) => {
  controller.value = { ...controller.value, ...p };
};

/** Lines from the controller: BTN/ACT/IN/PLG/NUD events. */
export function onControllerEvent(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export async function autoConnect() {
  if (!controller.value.supported) return false;
  try {
    const ports = await navigator.serial.getPorts();
    const pick = ports.find((p) => p.getInfo().usbVendorId === VENDOR) || ports[0];
    if (pick) return open(pick);
  } catch {
    /* not allowed */
  }
  return false;
}

/** Asks the browser for the controller (needs a click; kiosks pre-allow it by policy). */
export async function connect() {
  if (!controller.value.supported) return false;
  const p = await navigator.serial.requestPort({ filters: [{ usbVendorId: VENDOR }] });
  return open(p);
}

async function open(p) {
  try {
    if (port === p && controller.value.connected) return true;
    await p.open({ baudRate: 115200 });
  } catch (e) {
    if (!/already open/i.test(String(e))) return false;
  }
  port = p;
  writer = p.writable.getWriter();
  patch({ connected: true });
  readLoop();
  await send('HELLO');
  await send(currentProfile || navProfile());
  return true;
}

export async function disconnect() {
  try {
    reading = false;
    writer?.releaseLock();
    await port?.close();
  } catch {
    /* gone */
  }
  port = null;
  writer = null;
  patch({ connected: false, fw: null });
}

async function readLoop() {
  if (reading || !port?.readable) return;
  reading = true;
  const decoder = new TextDecoderStream();
  const closed = port.readable.pipeTo(decoder.writable).catch(() => {});
  const reader = decoder.readable.getReader();
  let buf = '';
  try {
    while (reading) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += value;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (line) handleLine(line);
      }
    }
  } catch {
    /* unplugged */
  } finally {
    reader.releaseLock();
    await closed;
    reading = false;
    patch({ connected: false });
  }
}

function handleLine(line) {
  const [kind, ...rest] = line.split(/\s+/);
  const c = controller.value;
  if (kind === 'HELLO') patch({ fw: rest[1] || rest[0], board: rest[2] || null });
  else if (kind === 'IN') patch({ inputs: { ...c.inputs, [rest[0]]: rest[1] === '1' } });
  else if (kind === 'PLG') patch({ plunger: Number(rest[0]) / 1000 });
  else if (kind === 'NUD') patch({ nudge: [Number(rest[0]) || 0, Number(rest[1]) || 0] });
  else if (kind === 'ACT' || kind === 'BTN') patch({ lastActivity: Date.now() });
  for (const fn of listeners) fn({ kind, args: rest, line });
}

export async function send(line) {
  if (!writer) return false;
  try {
    await writer.write(new TextEncoder().encode(`${line}\n`));
    return true;
  } catch {
    return false;
  }
}

/** Makes the buttons mean what this game expects (or the arcade's menus with no game). */
export function useProfileFor(game) {
  currentProfile = game ? profileLine(game.id, game.cabinet) : navProfile();
  patch({ profile: game ? game.id : 'arcade' });
  return send(currentProfile);
}

export const fx = (name, color) => send(`FX ${name}${color ? ` ${String(color).replace('#', '')}` : ''}`);

export async function setTesting(on) {
  patch({ testing: on, inputs: {} });
  return send(`TEST ${on ? 'ON' : 'OFF'}`);
}

export const calibrate = (step) => send(`CAL PLUNGER ${step}`);

if (controller.value.supported) {
  navigator.serial.addEventListener('connect', (e) => open(e.target));
  navigator.serial.addEventListener('disconnect', (e) => {
    if (e.target === port) {
      reading = false;
      port = null;
      writer = null;
      patch({ connected: false, fw: null });
    }
  });
}
