// Little synthesized arcade sounds. No audio files: a coin drop, menu blips,
// a ticket dispenser chattering out tickets, a record fanfare.

import { soundOn } from '../state.js';

let ctx = null;
let master = null;

function audio() {
  if (!soundOn.value) return null;
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.32;
    master.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}

// Browsers only allow sound after a gesture: wake the context on the first one.
for (const type of ['pointerdown', 'keydown', 'touchstart']) {
  window.addEventListener(type, () => audio(), { once: true, capture: true, passive: true });
}

function tone(freq, start, dur, { type = 'square', vol = 0.25, slide = 0, attack = 0.004 } = {}) {
  const a = audio();
  if (!a) return;
  const t = a.currentTime + start;
  const o = a.createOscillator();
  const g = a.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq * slide), t + dur);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(vol, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(master);
  o.start(t);
  o.stop(t + dur + 0.02);
}

function click(start, vol = 0.18) {
  const a = audio();
  if (!a) return;
  const t = a.currentTime + start;
  const len = Math.floor(a.sampleRate * 0.012);
  const buf = a.createBuffer(1, len, a.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 2;
  const s = a.createBufferSource();
  s.buffer = buf;
  const f = a.createBiquadFilter();
  f.type = 'bandpass';
  f.frequency.value = 2400;
  const g = a.createGain();
  g.gain.value = vol;
  s.connect(f).connect(g).connect(master);
  s.start(t);
}

const N = (n) => 440 * 2 ** ((n - 69) / 12); // MIDI note → Hz

export const sfx = {
  move: () => tone(1046, 0, 0.045, { vol: 0.08 }),
  select: () => {
    tone(N(76), 0, 0.06, { vol: 0.14 });
    tone(N(83), 0.055, 0.09, { vol: 0.14 });
  },
  back: () => {
    tone(N(79), 0, 0.06, { vol: 0.12 });
    tone(N(72), 0.05, 0.08, { vol: 0.12 });
  },
  coin: () => {
    tone(987.77, 0, 0.08, { vol: 0.16 });
    tone(1318.5, 0.075, 0.38, { vol: 0.16 });
  },
  start: () => [60, 64, 67, 72, 76].forEach((n, i) => tone(N(n), i * 0.07, 0.16, { vol: 0.13, type: 'square' })),
  error: () => tone(130, 0, 0.22, { vol: 0.16, type: 'sawtooth', slide: 0.7 }),
  tickets: (n = 10) => {
    const count = Math.min(40, Math.max(3, n));
    for (let i = 0; i < count; i++) click(i * 0.045, 0.16);
  },
  record: () => {
    [72, 76, 79, 84, 79, 84, 88].forEach((n, i) => tone(N(n), i * 0.11, i === 6 ? 0.6 : 0.14, { vol: 0.15, type: i % 2 ? 'square' : 'triangle' }));
    [48, 55, 60].forEach((n, i) => tone(N(n), 0.66 + i * 0.001, 0.6, { vol: 0.1, type: 'triangle' }));
  },
  achievement: () => [84, 88, 91, 96].forEach((n, i) => {
    tone(N(n), i * 0.09, 0.5, { vol: 0.09, type: 'sine' });
    tone(N(n) * 2.01, i * 0.09, 0.25, { vol: 0.03, type: 'sine' });
  }),
  levelup: () => [67, 71, 74, 79, 83, 86].forEach((n, i) => tone(N(n), i * 0.06, 0.2, { vol: 0.12, type: 'square' })),
  buy: () => {
    tone(N(84), 0, 0.08, { vol: 0.12, type: 'triangle' });
    tone(N(91), 0.08, 0.3, { vol: 0.12, type: 'triangle' });
    click(0.02, 0.2);
  },
};
