// Players, their critters, PINs, and the devices that play as them.
//
// There are no accounts. Each browser gets a device cookie; a device "is"
// whichever player last picked themselves on it. A player can set a PIN, and
// then a device has to know the PIN once before it can play as them.

import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { parseJson } from './db.js';

export const PALETTE = [
  '#ff4d6d', '#ff8c42', '#ffd23f', '#9be564', '#3ddc97', '#2ec4b6', '#4cc9f0', '#4361ee',
  '#7b5cff', '#b15cff', '#f15bb5', '#ff99c8', '#c9a227', '#a3b1c6', '#f1f1f1', '#ff6b35',
];

// Critter genes: each is a small index the app turns into pixels.
export const GENES = { body: 8, ears: 8, eyes: 8, mouth: 6, pattern: 5, feet: 4 };

const NAME_RE = /^[\p{L}\p{N}][\p{L}\p{N} .'&!?-]{0,19}$/u;

export const clean = (v, max) => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);

export function newId(bytes = 6) {
  return randomBytes(bytes).toString('base64url').replace(/[-_]/g, 'x');
}

export function hashToken(token) {
  return createHash('sha256').update(String(token)).digest('hex');
}

export function cleanInitials(v, name = '') {
  let s = String(v ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 3);
  if (!s) {
    s = String(name).toUpperCase().replace(/[^A-Z0-9 ]/g, '').split(' ').filter(Boolean).map((w) => w[0]).join('').slice(0, 3);
    if (s.length < 2) s = String(name).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 3);
  }
  return s || 'AAA';
}

export function cleanAvatar(a) {
  const src = a && typeof a === 'object' ? a : {};
  const out = {};
  for (const [k, n] of Object.entries(GENES)) {
    const v = Number.parseInt(src[k], 10);
    out[k] = Number.isFinite(v) ? ((v % n) + n) % n : Math.floor(Math.random() * n);
  }
  return out;
}

export function randomAvatar() {
  return cleanAvatar({});
}

const cleanColor = (c) => (/^#[0-9a-f]{6}$/i.test(String(c)) ? String(c).toLowerCase() : PALETTE[Math.floor(Math.random() * PALETTE.length)]);

function hashPin(pin) {
  const salt = randomBytes(12);
  const key = scryptSync(String(pin), salt, 32);
  return `s1$${salt.toString('base64url')}$${key.toString('base64url')}`;
}

function checkPin(pin, stored) {
  if (!stored) return true;
  const [, salt, key] = String(stored).split('$');
  if (!salt || !key) return false;
  const got = scryptSync(String(pin ?? ''), Buffer.from(salt, 'base64url'), 32);
  const want = Buffer.from(key, 'base64url');
  return got.length === want.length && timingSafeEqual(got, want);
}

export const levelFor = (lifetime) => 1 + Math.floor(Math.sqrt(Math.max(0, lifetime) / 20));
export const ticketsForLevel = (level) => 20 * (level - 1) ** 2;

export class Players {
  constructor(store) {
    this.store = store;
  }

  /** The shape the app sees. */
  view(row, { inventory = false } = {}) {
    if (!row) return null;
    const level = levelFor(row.lifetime);
    const out = {
      id: row.id,
      name: row.name,
      initials: row.initials,
      color: row.color,
      avatar: parseJson(row.avatar, {}),
      equipped: parseJson(row.equipped, {}),
      tickets: row.tickets,
      lifetime: row.lifetime,
      level,
      nextLevelAt: ticketsForLevel(level + 1),
      levelFloor: ticketsForLevel(level),
      hasPin: Boolean(row.pin_hash),
      createdAt: row.created_at,
      lastPlayedAt: row.last_played_at,
      hidden: Boolean(row.hidden),
    };
    if (inventory) out.inventory = this.inventory(row.id);
    return out;
  }

  row(id) {
    return this.store.one('SELECT * FROM players WHERE id = ?', String(id ?? ''));
  }

  get(id, opts) {
    return this.view(this.row(id), opts);
  }

  list({ includeHidden = false } = {}) {
    const rows = this.store.all(
      `SELECT * FROM players ${includeHidden ? '' : 'WHERE hidden = 0'}
       ORDER BY COALESCE(last_played_at, created_at) DESC`,
    );
    return rows.map((r) => this.view(r));
  }

  count() {
    return this.store.one('SELECT COUNT(*) AS n FROM players WHERE hidden = 0').n;
  }

  validate({ name, initials, color, avatar }, existingId = null) {
    const n = clean(name, 20);
    if (!NAME_RE.test(n)) throw Object.assign(new Error('Names are 1 to 20 letters, numbers and spaces.'), { status: 400 });
    const clash = this.store.one('SELECT id FROM players WHERE name = ? COLLATE NOCASE', n);
    if (clash && clash.id !== existingId) throw Object.assign(new Error(`There's already a player called ${n}.`), { status: 409 });
    return { name: n, initials: cleanInitials(initials, n), color: cleanColor(color), avatar: cleanAvatar(avatar) };
  }

  create(input) {
    const v = this.validate(input);
    const id = newId();
    const now = Date.now();
    this.store.run(
      `INSERT INTO players (id, name, initials, color, avatar, equipped, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, '{}', ?, ?)`,
      id, v.name, v.initials, v.color, JSON.stringify(v.avatar), now, now,
    );
    if (input.pin) this.setPin(id, input.pin);
    return this.get(id);
  }

  update(id, patch) {
    const row = this.row(id);
    if (!row) throw Object.assign(new Error('No such player.'), { status: 404 });
    const v = this.validate(
      {
        name: patch.name ?? row.name,
        initials: patch.initials ?? row.initials,
        color: patch.color ?? row.color,
        avatar: patch.avatar ?? parseJson(row.avatar, {}),
      },
      id,
    );
    this.store.run(
      'UPDATE players SET name = ?, initials = ?, color = ?, avatar = ?, updated_at = ? WHERE id = ?',
      v.name, v.initials, v.color, JSON.stringify(v.avatar), Date.now(), id,
    );
    if ('hidden' in patch) this.store.run('UPDATE players SET hidden = ? WHERE id = ?', patch.hidden ? 1 : 0, id);
    return this.get(id);
  }

  setPin(id, pin) {
    if (pin === null || pin === '') {
      this.store.run('UPDATE players SET pin_hash = NULL WHERE id = ?', id);
      return;
    }
    if (!/^\d{4,6}$/.test(String(pin))) throw Object.assign(new Error('A PIN is 4 to 6 digits.'), { status: 400 });
    this.store.run('UPDATE players SET pin_hash = ? WHERE id = ?', hashPin(pin), id);
  }

  checkPin(id, pin) {
    const row = this.row(id);
    return row ? checkPin(pin, row.pin_hash) : false;
  }

  remove(id) {
    this.store.run('DELETE FROM players WHERE id = ?', id);
  }

  /** Moves everything of `fromId` onto `intoId` and deletes `fromId`. */
  merge(fromId, intoId) {
    if (fromId === intoId) return;
    const a = this.row(fromId);
    const b = this.row(intoId);
    if (!a || !b) throw Object.assign(new Error('No such player.'), { status: 404 });
    this.store.tx(() => {
      for (const t of ['sessions', 'scores', 'results', 'ledger', 'events']) {
        this.store.run(`UPDATE ${t} SET player_id = ? WHERE player_id = ?`, intoId, fromId);
      }
      this.store.run(
        `INSERT OR IGNORE INTO achievements (player_id, achievement_id, unlocked_at)
         SELECT ?, achievement_id, unlocked_at FROM achievements WHERE player_id = ?`,
        intoId, fromId,
      );
      this.store.run(
        `INSERT OR IGNORE INTO inventory (player_id, item_id, acquired_at)
         SELECT ?, item_id, acquired_at FROM inventory WHERE player_id = ?`,
        intoId, fromId,
      );
      this.store.run('UPDATE players SET tickets = tickets + ?, lifetime = lifetime + ? WHERE id = ?', a.tickets, a.lifetime, intoId);
      this.store.run('UPDATE devices SET player_id = ? WHERE player_id = ?', intoId, fromId);
      this.store.run('DELETE FROM players WHERE id = ?', fromId);
    });
  }

  inventory(id) {
    return this.store.all('SELECT item_id FROM inventory WHERE player_id = ? ORDER BY acquired_at', id).map((r) => r.item_id);
  }

  // ───────────── devices ─────────────

  /** The device for a cookie token, created on first sight. */
  device(token, ua = '') {
    const id = hashToken(token);
    const now = Date.now();
    let row = this.store.one('SELECT * FROM devices WHERE id = ?', id);
    if (!row) {
      this.store.run('INSERT INTO devices (id, ua, created_at, last_seen) VALUES (?, ?, ?, ?)', id, clean(ua, 200), now, now);
      row = this.store.one('SELECT * FROM devices WHERE id = ?', id);
    } else if (now - row.last_seen > 60_000) {
      this.store.run('UPDATE devices SET last_seen = ? WHERE id = ?', now, id);
    }
    return row;
  }

  /** Makes `playerId` the device's player. Returns false if a PIN is needed. */
  setDevicePlayer(device, playerId, pin) {
    if (playerId === null) {
      this.store.run('UPDATE devices SET player_id = NULL WHERE id = ?', device.id);
      return true;
    }
    const row = this.row(playerId);
    if (!row || row.hidden) throw Object.assign(new Error('No such player.'), { status: 404 });
    const trusted = parseJson(device.trusted, []);
    if (row.pin_hash && !trusted.includes(playerId)) {
      if (pin === undefined || pin === null || pin === '') return false;
      if (!checkPin(pin, row.pin_hash)) throw Object.assign(new Error('Wrong PIN.'), { status: 403 });
      // A shared cabinet asks every time; a phone remembers.
      if (!device.kiosk) {
        trusted.push(playerId);
        this.store.run('UPDATE devices SET trusted = ? WHERE id = ?', JSON.stringify(trusted.slice(-16)), device.id);
      }
    }
    this.store.run('UPDATE devices SET player_id = ? WHERE id = ?', playerId, device.id);
    return true;
  }

  setKiosk(device, on) {
    this.store.run('UPDATE devices SET kiosk = ?, trusted = ? WHERE id = ?', on ? 1 : 0, on ? '[]' : device.trusted, device.id);
  }
}
