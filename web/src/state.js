// App-wide state (Preact signals) and the actions that change it.

import { signal, computed, batch } from '@preact/signals';
import { api } from './lib/api.js';

export const config = signal(null);
export const games = signal([]);
export const gameOfDay = signal(null);
export const me = signal(null);
export const players = signal([]);
export const prizes = signal([]);
export const achievementDefs = signal([]);
export const online = signal(true);
export const toasts = signal([]);
export const route = signal(parse(location.pathname + location.search));
export const playing = signal(null); // { game, session, menu } while a game is open
export const lastInput = signal(Date.now()); // the last time anyone touched anything

// This device is the cabinet: attract loop, controller, big-screen layout.
const params = new URLSearchParams(location.search);
if (params.has('kiosk')) {
  try {
    localStorage.setItem('arcade.kiosk', params.get('kiosk') === '0' ? '0' : '1');
  } catch {
    /* private mode */
  }
}
const stored = (k, d) => {
  try {
    const v = localStorage.getItem(k);
    return v === null ? d : v;
  } catch {
    return d;
  }
};
export const kiosk = signal(stored('arcade.kiosk', '0') === '1');
export const soundOn = signal(stored('arcade.sound', '1') === '1');

export const gameById = computed(() => new Map(games.value.map((g) => [g.id, g])));

export function setKiosk(on) {
  kiosk.value = on;
  try {
    localStorage.setItem('arcade.kiosk', on ? '1' : '0');
  } catch {
    /* ignore */
  }
  api.setKiosk(on).catch(() => {});
}

export function setSound(on) {
  soundOn.value = on;
  try {
    localStorage.setItem('arcade.sound', on ? '1' : '0');
  } catch {
    /* ignore */
  }
}

// ───────────── routing ─────────────

function parse(url) {
  const u = new URL(url, location.origin);
  const parts = u.pathname.split('/').filter(Boolean).map(decodeURIComponent);
  return { path: u.pathname, parts, query: u.searchParams };
}

export function go(path, { replace = false } = {}) {
  const next = parse(path);
  if (next.path === route.value.path && next.query.toString() === route.value.query.toString()) return;
  if (replace) history.replaceState({}, '', path);
  else history.pushState({}, '', path);
  route.value = next;
}

export function back(fallback = '/') {
  if (history.state && history.length > 1 && document.referrer.startsWith(location.origin)) history.back();
  else if (history.length > 1) history.back();
  else go(fallback, { replace: true });
}

window.addEventListener('popstate', () => {
  route.value = parse(location.pathname + location.search);
});

// ───────────── toasts ─────────────

let toastId = 0;
export function toast(message, { kind = 'info', ms = 3800 } = {}) {
  const id = ++toastId;
  toasts.value = [...toasts.value, { id, message, kind }];
  setTimeout(() => {
    toasts.value = toasts.value.filter((t) => t.id !== id);
  }, ms);
}

// ───────────── loading ─────────────

export async function loadAll() {
  const [cfg, g, m, p, pz, ach] = await Promise.all([
    api.config(),
    api.games(),
    api.me(),
    api.players(),
    api.prizes().catch(() => ({ prizes: [] })),
    api.achievements().catch(() => ({ achievements: [] })),
  ]);
  batch(() => {
    config.value = cfg;
    games.value = g.games;
    gameOfDay.value = g.gameOfDay;
    me.value = m.player;
    players.value = p.players;
    prizes.value = pz.prizes;
    achievementDefs.value = ach.achievements;
  });
  if (kiosk.value && !m.kiosk) api.setKiosk(true).catch(() => {});
}

export async function refreshGames() {
  try {
    const g = await api.games();
    batch(() => {
      games.value = g.games;
      gameOfDay.value = g.gameOfDay;
    });
  } catch {
    /* keep what we have */
  }
}

export async function refreshPlayers() {
  try {
    players.value = (await api.players()).players;
  } catch {
    /* keep */
  }
}

export async function refreshMe() {
  try {
    me.value = (await api.me()).player;
  } catch {
    /* keep */
  }
}

/** Play as someone. Resolves { needPin: true } if they have a PIN. */
export async function playAs(player, pin) {
  try {
    const r = await api.playAs(player, pin);
    me.value = r.player;
    refreshGames();
    return { ok: true };
  } catch (e) {
    if (e.status === 401 && e.body?.needPin) return { needPin: true };
    throw e;
  }
}

export async function signOut() {
  await api.signOut().catch(() => {});
  me.value = null;
  refreshGames();
}

/** Applies a fresh copy of a player everywhere it shows. */
export function updatePlayer(p) {
  if (!p) return;
  if (me.value && me.value.id === p.id) me.value = { ...me.value, ...p };
  players.value = players.value.map((x) => (x.id === p.id ? { ...x, ...p } : x));
}
