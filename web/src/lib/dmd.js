// The dot-matrix display. A canvas of round plasma dots (unlit ones faintly
// visible), a 16-level frame buffer, and a little scene player for the
// attract loop and announcements, like a pinball machine's DMD.

import { glyph, measure, GLYPH_HEIGHT } from './dmdfont.js';

const LEVELS = 16;
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

export class Dmd {
  constructor(canvas, { rows = 32, color = '#ff8a24', fps = 30 } = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.rows = rows;
    this.color = color;
    this.frameMs = 1000 / fps;
    this.cols = 128;
    this.fb = new Uint8Array(this.cols * this.rows);
    this.queue = [];
    this.loop = [];
    this.loopIndex = 0;
    this.scene = null;
    this.sceneStart = 0;
    this.last = 0;
    this.running = false;
    this.onScene = null;
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(canvas);
    this.resize();
  }

  // ───────────── drawing surface ─────────────

  resize() {
    const r = this.canvas.getBoundingClientRect();
    if (!r.width || !r.height) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const pitch = r.height / this.rows;
    const cols = Math.max(32, Math.floor(r.width / pitch));
    this.canvas.width = Math.round(r.width * dpr);
    this.canvas.height = Math.round(r.height * dpr);
    this.pitch = pitch * dpr;
    this.offsetX = (this.canvas.width - cols * this.pitch) / 2;
    if (cols !== this.cols) {
      this.cols = cols;
      this.fb = new Uint8Array(this.cols * this.rows);
    }
    this.buildSprites();
    this.paintNow();
  }

  buildSprites() {
    const p = this.pitch;
    const size = Math.ceil(p * 2);
    this.sprites = [];
    const [r, g, b] = hexRgb(this.color);
    for (let i = 0; i < LEVELS; i++) {
      const c = document.createElement('canvas');
      c.width = c.height = size;
      const x = c.getContext('2d');
      const k = i / (LEVELS - 1);
      const cx = size / 2;
      if (i > 0) {
        const halo = x.createRadialGradient(cx, cx, 0, cx, cx, p * 0.95);
        halo.addColorStop(0, `rgba(${r},${g},${b},${0.32 * k})`);
        halo.addColorStop(1, `rgba(${r},${g},${b},0)`);
        x.fillStyle = halo;
        x.fillRect(0, 0, size, size);
      }
      const core = x.createRadialGradient(cx - p * 0.08, cx - p * 0.08, 0, cx, cx, p * 0.4);
      const lift = (v) => Math.round(v + (255 - v) * 0.55 * k * k);
      core.addColorStop(0, i ? `rgb(${lift(r)},${lift(g)},${lift(b)})` : 'rgba(255,255,255,0.05)');
      core.addColorStop(0.7, i ? `rgba(${r},${g},${b},${0.35 + 0.65 * k})` : `rgba(${r},${g},${b},0.09)`);
      core.addColorStop(1, `rgba(${r},${g},${b},${i ? 0.25 * k : 0.04})`);
      x.fillStyle = core;
      x.beginPath();
      x.arc(cx, cx, p * 0.4, 0, Math.PI * 2);
      x.fill();
      this.sprites.push(c);
    }
    // The unlit grid never changes: draw it once.
    this.grid = document.createElement('canvas');
    this.grid.width = this.canvas.width;
    this.grid.height = this.canvas.height;
    const gx = this.grid.getContext('2d');
    for (let y = 0; y < this.rows; y++) {
      for (let x = 0; x < this.cols; x++) {
        gx.drawImage(this.sprites[0], this.offsetX + x * this.pitch - this.pitch / 2, y * this.pitch - this.pitch / 2);
      }
    }
  }

  paintNow() {
    const ctx = this.ctx;
    if (!this.grid) return;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.drawImage(this.grid, 0, 0);
    ctx.globalCompositeOperation = 'lighter';
    const { cols, rows, pitch, fb, sprites, offsetX } = this;
    const half = pitch / 2;
    for (let y = 0; y < rows; y++) {
      const row = y * cols;
      for (let x = 0; x < cols; x++) {
        const v = fb[row + x];
        if (v) ctx.drawImage(sprites[v], offsetX + x * pitch - half, y * pitch - half);
      }
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  // ───────────── frame buffer ─────────────

  clear() {
    this.fb.fill(0);
  }

  set(x, y, v = 15) {
    x |= 0;
    y |= 0;
    if (x < 0 || y < 0 || x >= this.cols || y >= this.rows) return;
    const i = y * this.cols + x;
    if (v > this.fb[i]) this.fb[i] = Math.min(15, v);
  }

  /** Draws text with its top-left corner at (x, y). */
  text(str, x, y, { scale = 1, v = 15 } = {}) {
    let cx = Math.round(x);
    for (const ch of String(str)) {
      const g = glyph(ch);
      for (let gy = 0; gy < GLYPH_HEIGHT; gy++) {
        const row = g.rows[gy];
        for (let gx = 0; gx < g.w; gx++) {
          if (!row[gx]) continue;
          for (let sy = 0; sy < scale; sy++) for (let sx = 0; sx < scale; sx++) this.set(cx + gx * scale + sx, y + gy * scale + sy, v);
        }
      }
      cx += (g.w + 1) * scale;
    }
    return cx;
  }

  /** The biggest scale (up to max) at which every line fits. */
  fit(lines, max = 4) {
    for (let s = max; s >= 1; s--) {
      const h = lines.length * GLYPH_HEIGHT * s + (lines.length - 1) * (s + 1);
      if (h <= this.rows && lines.every((l) => measure(l, s) <= this.cols - 2)) return s;
    }
    return 1;
  }

  centered(lines, { scale, v = 15, dy = 0 } = {}) {
    const s = scale || this.fit(lines);
    const gap = s + 1;
    const h = lines.length * GLYPH_HEIGHT * s + (lines.length - 1) * gap;
    let y = Math.round((this.rows - h) / 2) + dy;
    for (const l of lines) {
      this.text(l, Math.round((this.cols - measure(l, s)) / 2), y, { scale: s, v });
      y += GLYPH_HEIGHT * s + gap;
    }
    return s;
  }

  // ───────────── scenes ─────────────

  /** Scenes to cycle through when nothing else is being announced. */
  setLoop(scenes) {
    this.loop = scenes.filter(Boolean);
    this.loopIndex = 0;
    if (!this.queue.length) this.next();
  }

  /** Interrupts the loop with an announcement (or several). */
  say(...scenes) {
    this.queue.push(...scenes.filter(Boolean));
    if (!this.scene || !this.scene.urgent) this.next();
  }

  next() {
    if (this.queue.length) this.scene = { ...this.queue.shift(), urgent: true };
    else if (this.loop.length) {
      this.scene = this.loop[this.loopIndex % this.loop.length];
      this.loopIndex += 1;
    } else this.scene = null;
    this.sceneStart = performance.now();
    this.onScene?.(this.scene);
  }

  start() {
    if (this.running) return;
    this.running = true;
    const tick = (now) => {
      if (!this.running) return;
      this.raf = requestAnimationFrame(tick);
      if (now - this.last < this.frameMs) return;
      this.last = now;
      this.render(now);
    };
    this.raf = requestAnimationFrame(tick);
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  destroy() {
    this.stop();
    this.ro.disconnect();
  }

  render(now) {
    const s = this.scene;
    this.clear();
    if (s) {
      const t = now - this.sceneStart;
      const dur = sceneDuration(s, this);
      if (t >= dur) {
        this.next();
        return this.render(now);
      }
      drawScene(this, s, t, dur);
    }
    this.paintNow();
  }
}

// ───────────── scene kinds ─────────────

function sceneDuration(s, d) {
  if (s.ms) return s.ms;
  if (s.kind === 'scroll') return ((d.cols + measure(s.text, s.scale || d.fit([s.text], 3))) / (s.speed || 60)) * 1000 + 300;
  if (s.kind === 'table') return 1600 + (s.rows?.length || 0) * 900;
  return 3000;
}

function ease(t) {
  return t < 0 ? 0 : t > 1 ? 1 : 1 - (1 - t) ** 3;
}

function drawScene(d, s, t, dur) {
  const still = reduced();
  switch (s.kind) {
    case 'text': {
      const lines = s.lines || [s.text || ''];
      if (s.blink && !still && Math.floor(t / 450) % 2 === 1) return;
      if (s.enter === 'drop' && !still) {
        const k = ease(t / 450);
        d.centered(lines, { scale: s.scale, dy: Math.round((k - 1) * d.rows) });
      } else if (s.enter === 'wipe' && !still) {
        d.centered(lines, { scale: s.scale });
        const edge = Math.floor(ease(t / 600) * (d.cols + 8));
        for (let y = 0; y < d.rows; y++) for (let x = edge; x < d.cols; x++) d.fb[y * d.cols + x] = 0;
        for (let y = 0; y < d.rows; y++) for (let dx = 0; dx < 3; dx++) d.set(edge - dx, y, 15 - dx * 5);
      } else d.centered(lines, { scale: s.scale });
      if (s.sparkle && !still) sparkle(d, t, 0.012);
      break;
    }
    case 'scroll': {
      const scale = s.scale || d.fit([s.text], 3);
      const x = d.cols - (t / 1000) * (s.speed || 60);
      const y = Math.round((d.rows - GLYPH_HEIGHT * scale) / 2);
      d.text(s.text, Math.round(x), y, { scale });
      break;
    }
    case 'split': {
      // Two lines: a heading and a value, like "PLAYER 1" / "DAD".
      const top = s.top || '';
      const bottom = s.bottom || '';
      const sTop = Math.min(2, d.fit([top], 2));
      const sBot = Math.max(1, d.fit([bottom], 3));
      const hTop = GLYPH_HEIGHT * sTop;
      const hBot = GLYPH_HEIGHT * sBot;
      const gap = Math.max(2, Math.floor((d.rows - hTop - hBot) / 3));
      d.text(top, Math.round((d.cols - measure(top, sTop)) / 2), gap, { scale: sTop, v: 11 });
      const flash = s.flash && !still && Math.floor(t / 220) % 2 === 1;
      d.text(bottom, Math.round((d.cols - measure(bottom, sBot)) / 2), gap * 2 + hTop, { scale: sBot, v: flash ? 6 : 15 });
      break;
    }
    case 'table': {
      // A title, then rows rolling up one at a time.
      const title = s.title || '';
      const rows = s.rows || [];
      const titleScale = d.rows >= 32 ? 2 : 1;
      if (t < 1400) {
        d.centered([title], { scale: d.fit([title], 3) });
        if (!still) sparkle(d, t, 0.008);
        break;
      }
      const i = Math.min(rows.length - 1, Math.floor((t - 1400) / 900));
      const local = t - 1400 - i * 900;
      const slide = still ? 0 : Math.round((1 - ease(local / 260)) * d.rows);
      d.text(title, Math.round((d.cols - measure(title, 1)) / 2), 1, { scale: 1, v: 9 });
      const row = rows[i] || [];
      const line = row.join('  ');
      const sc = Math.max(1, Math.min(titleScale, d.fit([line], 2)));
      const y = 10 + slide;
      if (row.length === 3 && measure(line, sc) <= d.cols - 4) {
        const [rank, name, val] = row;
        d.text(rank, 3, y, { scale: sc, v: 10 });
        d.text(name, 3 + measure(`${rank}  `, sc), y, { scale: sc });
        d.text(val, d.cols - 3 - measure(val, sc), y, { scale: sc });
      } else d.text(line, Math.round((d.cols - measure(line, sc)) / 2), y, { scale: sc });
      break;
    }
    case 'record': {
      // NEW RECORD: a burst, then the name and number flashing.
      const head = s.title || 'NEW RECORD';
      if (t < 900 && !still) {
        burst(d, t / 900);
        d.centered([head], { scale: d.fit([head], 3), v: Math.round(4 + 11 * ease(t / 900)) });
      } else if (t < 2200) {
        const on = still || Math.floor(t / 160) % 2 === 0;
        d.centered([head], { scale: d.fit([head], 3), v: on ? 15 : 5 });
        if (!still) sparkle(d, t, 0.03);
      } else {
        d.centered([s.name || '', s.value || ''], { scale: d.fit([s.name || '', s.value || ''], 2) });
        if (!still) sparkle(d, t, 0.015);
      }
      break;
    }
    case 'logo': {
      const lines = s.lines || ['AU12', 'ARCADE'];
      const sc = d.fit(lines, 4);
      d.centered(lines, { scale: sc });
      if (!still) {
        // A glint sweeping across.
        const sweep = ((t % 2600) / 2600) * (d.cols + d.rows * 2) - d.rows;
        // Lit dots dim slightly, and a glint runs across them.
        for (let i = 0; i < d.fb.length; i++) if (d.fb[i]) d.fb[i] = 11;
        for (let y = 0; y < d.rows; y++) {
          const x0 = Math.round(sweep + y * 0.6);
          for (let x = Math.max(0, x0); x < Math.min(d.cols, x0 + 4); x++) {
            const i = y * d.cols + x;
            if (d.fb[i]) d.fb[i] = 15;
          }
        }
        if (t < 500) {
          // Power-on: dots fade up.
          const k = ease(t / 500);
          for (let i = 0; i < d.fb.length; i++) d.fb[i] = Math.round(d.fb[i] * k);
        }
      }
      break;
    }
    default:
      break;
  }
}

function sparkle(d, t, density) {
  const n = Math.floor(d.cols * d.rows * density);
  const seed = Math.floor(t / 90);
  for (let i = 0; i < n; i++) {
    const h = hash(seed * 7919 + i * 104729);
    d.set(h % d.cols, Math.floor(h / d.cols) % d.rows, 4 + (h % 9));
  }
}

function burst(d, k) {
  const cx = d.cols / 2;
  const cy = d.rows / 2;
  for (let i = 0; i < 90; i++) {
    const h = hash(i * 2654435761);
    const a = (h % 6283) / 1000;
    const sp = 0.4 + ((h >> 8) % 100) / 100;
    const r = k * d.cols * 0.6 * sp;
    d.set(cx + Math.cos(a) * r, cy + Math.sin(a) * r * 0.5, Math.round(15 * (1 - k * 0.7)));
  }
}

function hash(n) {
  n = (n ^ 61) ^ (n >>> 16);
  n = Math.imul(n, 9);
  n ^= n >>> 4;
  n = Math.imul(n, 0x27d4eb2d);
  n ^= n >>> 15;
  return n >>> 0;
}

function hexRgb(hex) {
  const n = Number.parseInt(String(hex).replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Uppercase and squeeze text for the display. */
export const dmdText = (s) =>
  String(s ?? '')
    .toUpperCase()
    .replace(/[’‘]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
