// The game catalog: catalog/games.json (shipped with the image), changed by
// the admin page (stored in the settings table) and by GAME_<ID>_URL.
//
// Each game is reached at its own address and opened inside the arcade in a
// frame. The arcade only ever talks to a game through the SDK's messages, and
// accepts score posts straight from a game's own origin for direct play.

import fs from 'node:fs';
import path from 'node:path';
import { config, log } from './config.js';

const ID_RE = /^[a-z0-9][a-z0-9-]{0,31}$/;
const COLOR_RE = /^#[0-9a-f]{6}$/i;

export const INPUTS = [
  'UP', 'DOWN', 'LEFT', 'RIGHT', 'B1', 'B2', 'B3', 'B4', 'B5', 'B6',
  'START', 'COIN', 'HOME', 'LFLIP', 'RFLIP', 'LAUNCH', 'PLUNGER', 'NUDGE_UP', 'NUDGE_L', 'NUDGE_R', 'KNOB',
];

const text = (v, max) => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);

export function cleanUrl(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  try {
    const u = new URL(raw);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return '';
    u.hash = '';
    return u.href.replace(/\/+$/, '');
  } catch {
    return '';
  }
}

export const originOf = (url) => {
  try {
    return new URL(url).origin;
  } catch {
    return '';
  }
};

function cleanBoard(b) {
  if (!b || !ID_RE.test(String(b.id || ''))) return null;
  const kind = b.kind === 'wins' ? 'wins' : 'best';
  return {
    id: b.id,
    name: text(b.name || b.id, 40),
    kind,
    order: b.order === 'asc' ? 'asc' : 'desc',
    format: ['int', 'time', 'decimal'].includes(b.format) ? b.format : 'int',
    primary: Boolean(b.primary),
    of: Number.isFinite(b.of) ? b.of : undefined,
    filter: b.filter && typeof b.filter === 'object' ? b.filter : undefined,
  };
}

function cleanAchievement(a) {
  if (!a || !ID_RE.test(String(a.id || ''))) return null;
  return {
    id: a.id,
    name: text(a.name, 40),
    desc: text(a.desc, 120),
    icon: text(a.icon || 'star', 20),
    tickets: Math.max(0, Math.min(1000, Number(a.tickets) || 0)),
    when: a.when && typeof a.when === 'object' ? a.when : null,
    secret: Boolean(a.secret),
  };
}

/** Normalises one game definition (from the shipped catalog or the admin page). */
export function cleanGame(g, base = {}) {
  const id = String(g.id || base.id || '');
  if (!ID_RE.test(id)) throw new Error(`bad game id "${id}"`);
  const theme = { ...(base.theme || {}), ...(g.theme || {}) };
  for (const k of Object.keys(theme)) if (!COLOR_RE.test(theme[k])) delete theme[k];
  const pick = (k, fallback) => (g[k] !== undefined ? g[k] : base[k] !== undefined ? base[k] : fallback);
  const boards = (pick('boards', []) || []).map(cleanBoard).filter(Boolean);
  if (!boards.length) boards.push(cleanBoard({ id: 'score', name: 'High Score', primary: true }));
  if (!boards.some((b) => b.primary)) boards[0].primary = true;
  return {
    id,
    title: text(pick('title', id), 40),
    maker: text(pick('maker', ''), 40),
    year: Number(pick('year', 0)) || null,
    genre: text(pick('genre', 'Game'), 24),
    players: text(pick('players', '1'), 12),
    multiplayer: Boolean(pick('multiplayer', false)),
    tagline: text(pick('tagline', ''), 90),
    description: text(pick('description', ''), 600),
    url: cleanUrl(pick('url', '')),
    repo: cleanUrl(pick('repo', '')),
    theme: { primary: '#ff3d7f', secondary: '#21d4fd', accent: '#ffe066', bg: '#120c2a', ...theme },
    art: text(pick('art', ''), 120),
    icon: text(pick('icon', ''), 120),
    orientation: ['any', 'landscape', 'portrait'].includes(pick('orientation', 'any')) ? pick('orientation', 'any') : 'any',
    // Where the arcade's little menu tab sits over the game (out of the way of its own buttons).
    hud: ['top', 'bottom', 'top-left', 'top-right', 'bottom-left', 'bottom-right'].includes(pick('hud', 'top')) ? pick('hud', 'top') : 'top',
    boards,
    tickets: Array.isArray(pick('tickets', [])) ? pick('tickets', []) : [],
    achievements: (pick('achievements', []) || []).map(cleanAchievement).filter(Boolean),
    keys: Array.isArray(pick('keys', [])) ? pick('keys', []).slice(0, 10).map((r) => [text(r[0], 30), text(r[1], 50)]) : [],
    cabinet: cleanCabinet(pick('cabinet', {})),
    enabled: pick('enabled', true) !== false,
    order: Number.isFinite(Number(pick('order', NaN))) ? Number(pick('order', 0)) : undefined,
    custom: Boolean(g.custom || base.custom),
  };
}

function cleanCabinet(c) {
  const out = { stick: c?.stick === 'mouse' ? 'mouse' : 'keys', map: {}, hints: [] };
  const map = c?.map && typeof c.map === 'object' ? c.map : {};
  for (const [k, v] of Object.entries(map)) {
    if (!INPUTS.includes(k)) continue;
    if (typeof v === 'string' && /^(mouse:(left|right|middle)|[A-Za-z0-9]{1,24})$/.test(v)) out.map[k] = v;
    else if (v && typeof v === 'object' && typeof v.key === 'string') {
      out.map[k] = { key: v.key.slice(0, 24), mode: v.mode === 'proportional' ? 'proportional' : 'hold' };
    }
  }
  if (Array.isArray(c?.hints)) out.hints = c.hints.slice(0, 10).map((h) => [text(h[0], 16), text(h[1], 60)]);
  return out;
}

export class Catalog {
  constructor(store) {
    this.store = store;
    this.shipped = [];
    this.loadShipped();
    this.rebuild();
  }

  loadShipped() {
    const file = path.join(config.catalogDir, 'games.json');
    try {
      const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
      this.shipped = (raw.games || []).map((g, i) => cleanGame({ ...g, order: g.order ?? i }));
    } catch (e) {
      log.warn(`could not read the game catalog at ${file}: ${e.message}`);
      this.shipped = [];
    }
  }

  /** Recomputes the live list from the shipped games and the admin's changes. */
  rebuild() {
    const overrides = this.store.getSetting('games', {}) || {};
    const custom = this.store.getSetting('customGames', []) || [];
    const list = [];
    for (const g of this.shipped) {
      const o = overrides[g.id] || {};
      list.push(cleanGame({ ...o, id: g.id }, g));
    }
    for (const c of custom) {
      try {
        if (list.some((g) => g.id === c.id)) continue;
        list.push(cleanGame({ ...c, custom: true }));
      } catch (e) {
        log.warn(`skipping custom game: ${e.message}`);
      }
    }
    for (const g of list) {
      const envUrl = cleanUrl(process.env[`GAME_${g.id.toUpperCase().replace(/-/g, '_')}_URL`]);
      if (envUrl && !(overrides[g.id] && overrides[g.id].url)) g.url = envUrl;
      if (!g.url && config.gameDomain) g.url = `https://${g.id}.${config.gameDomain}`;
    }
    list.sort((a, b) => (a.order ?? 999) - (b.order ?? 999) || a.title.localeCompare(b.title));
    list.forEach((g, i) => {
      g.order = i;
    });
    this.games = list;
    this.byId = new Map(list.map((g) => [g.id, g]));
    this.origins = new Set([...list.filter((g) => g.url).map((g) => originOf(g.url)), ...config.extraOrigins.map(originOf)].filter(Boolean));
  }

  get(id) {
    return this.byId.get(id);
  }

  enabled() {
    return this.games.filter((g) => g.enabled && g.url);
  }

  /** The game whose origin sent a request, for direct play. */
  byOrigin(origin) {
    return this.games.filter((g) => g.url && originOf(g.url) === origin);
  }

  allowsOrigin(origin) {
    return Boolean(origin) && this.origins.has(origin);
  }

  board(game, boardId) {
    return game?.boards.find((b) => b.id === boardId);
  }

  /** What the app needs to draw the games (no admin-only fields). */
  publicList() {
    return this.enabled().map((g) => ({
      id: g.id,
      title: g.title,
      maker: g.maker,
      year: g.year,
      genre: g.genre,
      players: g.players,
      multiplayer: g.multiplayer,
      tagline: g.tagline,
      description: g.description,
      url: g.url,
      repo: g.repo,
      theme: g.theme,
      art: g.art ? `/catalog/${g.art}` : '',
      icon: g.icon ? `/catalog/${g.icon}` : '',
      orientation: g.orientation,
      hud: g.hud,
      boards: g.boards,
      achievements: g.achievements.filter((a) => !a.secret).map(({ when, ...a }) => a),
      keys: g.keys,
      cabinet: g.cabinet,
    }));
  }

  /** Changes to a shipped game, or a whole custom game. */
  saveOverride(id, patch) {
    const shipped = this.shipped.find((g) => g.id === id);
    if (shipped) {
      const all = this.store.getSetting('games', {}) || {};
      const allowed = ['url', 'enabled', 'order', 'title', 'tagline', 'description', 'tickets', 'cabinet', 'theme', 'hud'];
      const next = { ...(all[id] || {}) };
      for (const k of allowed) if (k in patch) next[k] = patch[k];
      if ('url' in patch) next.url = cleanUrl(patch.url);
      cleanGame({ ...next, id }, shipped); // throws if invalid
      all[id] = next;
      this.store.setSetting('games', all);
    } else {
      const custom = this.store.getSetting('customGames', []) || [];
      const i = custom.findIndex((g) => g.id === id);
      const merged = { ...(i >= 0 ? custom[i] : {}), ...patch, id };
      cleanGame({ ...merged, custom: true });
      if (i >= 0) custom[i] = merged;
      else custom.push(merged);
      this.store.setSetting('customGames', custom);
    }
    this.rebuild();
    return this.get(id);
  }

  resetOverride(id) {
    const all = this.store.getSetting('games', {}) || {};
    delete all[id];
    this.store.setSetting('games', all);
    this.rebuild();
  }

  removeCustom(id) {
    const custom = (this.store.getSetting('customGames', []) || []).filter((g) => g.id !== id);
    this.store.setSetting('customGames', custom);
    this.rebuild();
  }
}
