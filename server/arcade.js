// The arcade's rules: play sessions, scores, results, tickets, achievements,
// the prize counter and the activity feed. Every write goes through here so
// the side effects (records, tickets, achievements, live events) stay in one
// place.

import fs from 'node:fs';
import path from 'node:path';
import { config, log } from './config.js';
import { parseJson } from './db.js';
import { dayKey, metaMatches } from './boards.js';
import { allAchievements, evaluate } from './achievements.js';
import { levelFor, newId } from './players.js';

const ID_RE = /^[a-z0-9][a-z0-9-]{0,31}$/;
const OUTCOMES = new Set(['win', 'loss', 'draw']);
const STALE_MS = 3 * 60_000;

const httpError = (status, message) => Object.assign(new Error(message), { status });

function cleanMeta(meta) {
  if (meta === undefined || meta === null) return null;
  if (typeof meta !== 'object' || Array.isArray(meta)) throw httpError(400, 'meta must be an object');
  const json = JSON.stringify(meta);
  if (json.length > 2000) throw httpError(413, 'meta is too large');
  return json;
}

export function loadPrizes() {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(config.catalogDir, 'prizes.json'), 'utf8'));
    return (raw.prizes || []).filter((p) => p && ID_RE.test(p.id) && ['hat', 'face', 'neck', 'frame', 'title'].includes(p.slot));
  } catch (e) {
    log.warn(`could not read prizes.json: ${e.message}`);
    return [];
  }
}

export class Arcade {
  constructor({ store, catalog, players, boards, hub }) {
    this.store = store;
    this.catalog = catalog;
    this.players = players;
    this.boards = boards;
    this.hub = hub;
    this.prizes = loadPrizes();
    this.prizeById = new Map(this.prizes.map((p) => [p.id, p]));
  }

  // ───────────── the day ─────────────

  /** The game of the day earns double tickets. Same pick all day, for everyone. */
  gameOfDay(t = Date.now()) {
    const games = this.catalog.enabled().map((g) => g.id).sort();
    if (!games.length) return null;
    const key = dayKey(t);
    let h = 2166136261;
    for (const ch of key) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
    return games[h % games.length];
  }

  // ───────────── tickets ─────────────

  award(playerId, amount, reason, ref = null) {
    const n = Math.round(amount);
    if (!n) return null;
    const before = this.store.one('SELECT tickets, lifetime FROM players WHERE id = ?', playerId);
    if (!before) return null;
    const lifetime = before.lifetime + Math.max(0, n);
    this.store.run('UPDATE players SET tickets = MAX(0, tickets + ?), lifetime = ? WHERE id = ?', n, lifetime, playerId);
    this.store.run('INSERT INTO ledger (player_id, delta, reason, ref, created_at) VALUES (?, ?, ?, ?, ?)', playerId, n, reason, ref, Date.now());
    const oldLevel = levelFor(before.lifetime);
    const newLevel = levelFor(lifetime);
    if (newLevel > oldLevel) this.event('levelup', playerId, null, { level: newLevel });
    return { balance: Math.max(0, before.tickets + n), lifetime, levelUp: newLevel > oldLevel ? newLevel : null };
  }

  /** The first play of a day earns a small bonus. */
  dailyBonus(playerId, now = Date.now()) {
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    const already = this.store.one(
      "SELECT 1 AS x FROM ledger WHERE player_id = ? AND reason = 'daily' AND created_at >= ? LIMIT 1",
      playerId, start.getTime(),
    );
    if (already) return 0;
    this.award(playerId, 5, 'daily', dayKey(now));
    return 5;
  }

  // ───────────── achievements ─────────────

  achievements() {
    return allAchievements(this.catalog);
  }

  checkAchievements(playerId, ev) {
    const earned = evaluate({ store: this.store, boards: this.boards, catalog: this.catalog }, playerId, ev);
    const now = Date.now();
    for (const a of earned) {
      this.store.run('INSERT OR IGNORE INTO achievements (player_id, achievement_id, unlocked_at) VALUES (?, ?, ?)', playerId, a.id, now);
      if (a.tickets) this.award(playerId, a.tickets, 'achievement', a.id);
      this.event('achievement', playerId, a.game, { id: a.id, name: a.name, desc: a.desc, icon: a.icon, tickets: a.tickets });
    }
    return earned;
  }

  // ───────────── events ─────────────

  event(type, playerId, gameId, data = {}, { store = true } = {}) {
    const at = Date.now();
    let id = null;
    if (store) {
      id = Number(
        this.store.run('INSERT INTO events (type, player_id, game_id, data, created_at) VALUES (?, ?, ?, ?, ?)', type, playerId, gameId, JSON.stringify(data), at)
          .lastInsertRowid,
      );
    }
    this.hub?.send(type, { id, type, at, game: gameId, player: playerId ? this.players.get(playerId) : null, ...data });
    return id;
  }

  feed({ limit = 20, before = null, playerId = null } = {}) {
    const rows = this.store.all(
      `SELECT e.* FROM events e LEFT JOIN players p ON p.id = e.player_id
       WHERE (? IS NULL OR e.id < ?) AND (? IS NULL OR e.player_id = ?) AND (p.id IS NULL OR p.hidden = 0)
       ORDER BY e.id DESC LIMIT ?`,
      before, before, playerId, playerId, Math.max(1, Math.min(100, limit)),
    );
    const cache = new Map();
    const who = (id) => {
      if (!id) return null;
      if (!cache.has(id)) cache.set(id, this.players.get(id));
      return cache.get(id);
    };
    return rows.map((r) => ({ id: r.id, type: r.type, at: r.created_at, game: r.game_id, player: who(r.player_id), ...parseJson(r.data, {}) }));
  }

  // ───────────── sessions ─────────────

  startSession({ playerId, gameId, deviceId, source = 'arcade' }) {
    const game = this.catalog.get(gameId);
    if (!game) throw httpError(404, 'No such game.');
    const id = newId(9);
    const now = Date.now();
    return this.store.tx(() => {
      this.store.run(
        'INSERT INTO sessions (id, player_id, game_id, device_id, source, started_at, last_beat) VALUES (?, ?, ?, ?, ?, ?, ?)',
        id, playerId, gameId, deviceId, source, now, now,
      );
      let daily = 0;
      let achievements = [];
      if (playerId) {
        this.store.run('UPDATE players SET last_played_at = ? WHERE id = ?', now, playerId);
        daily = this.dailyBonus(playerId, now);
        achievements = this.checkAchievements(playerId, { gameId, hour: new Date(now).getHours(), kind: 'session' });
        this.hub?.send('session', { state: 'start', game: gameId, player: this.players.get(playerId), at: now });
      }
      return { id, daily, achievements, tickets: playerId ? this.players.get(playerId).tickets : 0 };
    });
  }

  session(id) {
    return this.store.one('SELECT * FROM sessions WHERE id = ?', String(id ?? ''));
  }

  beat(id, deviceId) {
    const s = this.session(id);
    if (!s || s.ended_at || (s.device_id && s.device_id !== deviceId)) return false;
    this.store.run('UPDATE sessions SET last_beat = ? WHERE id = ?', Date.now(), id);
    if (s.player_id && Date.now() - s.started_at >= 30 * 60_000) {
      this.checkAchievements(s.player_id, { gameId: s.game_id, kind: 'beat' });
    }
    return true;
  }

  endSession(id, deviceId) {
    const s = this.session(id);
    if (!s || s.ended_at || (s.device_id && s.device_id !== deviceId)) return false;
    const now = Date.now();
    const end = Math.min(now, s.last_beat + 90_000);
    this.store.run('UPDATE sessions SET ended_at = ?, last_beat = MAX(last_beat, ?) WHERE id = ?', end, end, id);
    if (s.player_id) this.hub?.send('session', { state: 'end', game: s.game_id, player: this.players.get(s.player_id), at: now, ms: end - s.started_at });
    return true;
  }

  /** Closes sessions whose page went away without saying so. */
  sweep() {
    const cutoff = Date.now() - STALE_MS;
    this.store.run('UPDATE sessions SET ended_at = last_beat WHERE ended_at IS NULL AND last_beat < ?', cutoff);
  }

  // ───────────── scores ─────────────

  submitScore({ playerId, gameId, boardId, value, meta, sessionId = null, source = 'arcade' }) {
    const game = this.catalog.get(gameId);
    if (!game || !game.enabled) throw httpError(404, 'No such game.');
    if (!ID_RE.test(String(boardId || ''))) throw httpError(400, 'Bad board.');
    const v = Number(value);
    if (!Number.isFinite(v) || Math.abs(v) > 1e12) throw httpError(400, 'Bad score.');
    const board = this.catalog.board(game, boardId);
    if (board && board.kind === 'wins') throw httpError(400, 'That board counts wins; report a result instead.');
    const metaJson = cleanMeta(meta);
    const player = this.players.row(playerId);
    if (!player) throw httpError(404, 'No such player.');
    const now = Date.now();
    const order = board?.order || 'desc';
    const better = (a, b) => (order === 'asc' ? a < b : a > b);

    return this.store.tx(() => {
      const prevBest = this.boards.bestOf(gameId, boardId, playerId, order);
      const top = board ? this.boards.bestRows(gameId, board, { limit: 1 })[0] : null;
      const sid = sessionId && this.session(sessionId)?.player_id === playerId ? sessionId : null;
      this.store.run(
        'INSERT INTO scores (player_id, game_id, board_id, value, meta, session_id, source, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        playerId, gameId, boardId, v, metaJson, sid, source, now,
      );
      this.store.run('UPDATE players SET last_played_at = ? WHERE id = ?', now, playerId);

      const personalBest = prevBest === null || better(v, prevBest);
      const hadBest = prevBest !== null;
      const record = Boolean(board) && (!top || better(v, top.value));
      const firstRecord = record && !top;
      const prevHolder = record && top ? top.player_id : null;
      const standing = board ? this.boards.standing(gameId, board, playerId) : null;

      // Tickets: the game's own rate, doubled on the game of the day, plus bonuses.
      const breakdown = [];
      let base = 0;
      for (const r of game.tickets.filter((t) => t.board === boardId && t.per > 0)) {
        base += Math.max(0, Math.min(r.max ?? Infinity, Math.floor((order === 'asc' ? 0 : v) / r.per)));
      }
      if (base) breakdown.push({ label: 'Score', n: base });
      if (base && this.gameOfDay(now) === gameId) breakdown.push({ label: 'Game of the day', n: base });
      if (board && personalBest && hadBest) breakdown.push({ label: 'Personal best', n: 5 });
      if (record) breakdown.push({ label: firstRecord ? 'First record' : 'New record', n: firstRecord ? 10 : 20 });
      const earned = breakdown.reduce((s, b) => s + b.n, 0);
      if (earned) this.award(playerId, earned, 'score', `${gameId}:${boardId}`);
      const daily = this.dailyBonus(playerId, now);
      if (daily) breakdown.push({ label: 'Daily visit', n: daily });

      if (record) {
        this.event('record', playerId, gameId, {
          board: boardId,
          boardName: board.name,
          value: v,
          format: board.format,
          prevHolder: prevHolder ? this.players.get(prevHolder) : null,
          prevValue: top ? top.value : null,
        });
      } else if (board && personalBest && standing && standing.rank <= 3) {
        this.event('podium', playerId, gameId, { board: boardId, boardName: board.name, value: v, format: board.format, rank: standing.rank });
      }
      const achievements = this.checkAchievements(playerId, {
        gameId,
        kind: 'score',
        personalBest: Boolean(board) && personalBest,
        hadBest,
        record,
        prevHolder,
        hour: new Date(now).getHours(),
      });
      const fresh = this.players.get(playerId);
      this.hub?.send('score', {
        at: now,
        game: gameId,
        board: boardId,
        value: v,
        player: fresh,
        rank: standing?.rank ?? null,
        personalBest: Boolean(board) && personalBest,
        record,
      });
      return {
        ok: true,
        game: gameId,
        board: boardId,
        value: v,
        best: personalBest ? v : prevBest,
        rank: standing?.rank ?? null,
        personalBest: Boolean(board) && personalBest,
        record,
        firstRecord,
        prevHolder: prevHolder ? this.players.get(prevHolder) : null,
        tickets: { earned: breakdown.reduce((s, b) => s + b.n, 0), breakdown, balance: fresh.tickets },
        achievements,
        player: fresh,
      };
    });
  }

  submitResult({ playerId, gameId, outcome, meta, sessionId = null, source = 'arcade' }) {
    const game = this.catalog.get(gameId);
    if (!game || !game.enabled) throw httpError(404, 'No such game.');
    if (!OUTCOMES.has(outcome)) throw httpError(400, 'Outcome is win, loss or draw.');
    const metaJson = cleanMeta(meta);
    const metaObj = parseJson(metaJson, {}) || {};
    if (!this.players.row(playerId)) throw httpError(404, 'No such player.');
    const now = Date.now();
    return this.store.tx(() => {
      const sid = sessionId && this.session(sessionId)?.player_id === playerId ? sessionId : null;
      this.store.run(
        'INSERT INTO results (player_id, game_id, outcome, meta, session_id, source, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        playerId, gameId, outcome, metaJson, sid, source, now,
      );
      this.store.run('UPDATE players SET last_played_at = ? WHERE id = ?', now, playerId);
      const breakdown = [];
      for (const r of game.tickets.filter((t) => t.outcome === outcome && metaMatches(metaObj, t.filter))) {
        const n = Math.max(0, Math.min(500, Number(r.amount) || 0));
        if (n) breakdown.push({ label: r.filter ? 'Bonus' : outcome === 'win' ? 'Win' : 'Good game', n });
      }
      const base = breakdown.reduce((s, b) => s + b.n, 0);
      if (base && this.gameOfDay(now) === gameId) breakdown.push({ label: 'Game of the day', n: base });
      const earned = breakdown.reduce((s, b) => s + b.n, 0);
      if (earned) this.award(playerId, earned, 'result', `${gameId}:${outcome}`);
      const daily = this.dailyBonus(playerId, now);
      if (daily) breakdown.push({ label: 'Daily visit', n: daily });

      // Leading a wins board is a record too.
      let record = false;
      let rank = null;
      if (outcome === 'win') {
        for (const b of game.boards.filter((x) => x.kind === 'wins' && metaMatches(metaObj, x.filter))) {
          const rows = this.boards.winRows(gameId, b, { limit: 2 });
          if (rows[0]?.player_id === playerId) {
            if (b.primary) rank = 1;
            const lead = rows[0].wins - (rows[1]?.wins ?? 0);
            if (lead === 1 && b.primary) record = true; // just took (or extended into) sole first place
          } else if (b.primary) {
            rank = this.boards.standing(gameId, b, playerId)?.rank ?? null;
          }
        }
        this.event('win', playerId, gameId, { meta: metaObj, opponents: Array.isArray(metaObj.opponents) ? metaObj.opponents.slice(0, 8) : undefined });
      }
      const achievements = this.checkAchievements(playerId, { gameId, kind: 'result', outcome, meta: metaObj, hour: new Date(now).getHours() });
      const fresh = this.players.get(playerId);
      this.hub?.send('result', { at: now, game: gameId, outcome, player: fresh, rank });
      return {
        ok: true,
        game: gameId,
        outcome,
        rank,
        record,
        tickets: { earned: breakdown.reduce((s, b) => s + b.n, 0), breakdown, balance: fresh.tickets },
        achievements,
        player: fresh,
      };
    });
  }

  /** A game's own achievement, unlocked by the game itself (Arcade.achieve). */
  unlockGameAchievement({ playerId, gameId, achievementId }) {
    const game = this.catalog.get(gameId);
    const a = game?.achievements.find((x) => x.id === achievementId);
    if (!a) throw httpError(404, 'No such achievement.');
    const id = `${gameId}:${a.id}`;
    const have = this.store.one('SELECT 1 AS x FROM achievements WHERE player_id = ? AND achievement_id = ?', playerId, id);
    if (have) return { ok: true, achievements: [] };
    const now = Date.now();
    this.store.tx(() => {
      this.store.run('INSERT INTO achievements (player_id, achievement_id, unlocked_at) VALUES (?, ?, ?)', playerId, id, now);
      if (a.tickets) this.award(playerId, a.tickets, 'achievement', id);
      this.event('achievement', playerId, gameId, { id, name: a.name, desc: a.desc, icon: a.icon, tickets: a.tickets });
    });
    return { ok: true, achievements: [{ id, name: a.name, desc: a.desc, icon: a.icon, tickets: a.tickets, game: gameId }], player: this.players.get(playerId) };
  }

  // ───────────── prize counter ─────────────

  purchase(playerId, itemId) {
    const item = this.prizeById.get(itemId);
    if (!item) throw httpError(404, 'No such prize.');
    const p = this.players.row(playerId);
    if (!p) throw httpError(404, 'No such player.');
    return this.store.tx(() => {
      if (this.store.one('SELECT 1 AS x FROM inventory WHERE player_id = ? AND item_id = ?', playerId, itemId)) throw httpError(409, 'You already have that.');
      if (p.tickets < item.price) throw httpError(402, `You need ${item.price - p.tickets} more tickets.`);
      this.store.run('INSERT INTO inventory (player_id, item_id, acquired_at) VALUES (?, ?, ?)', playerId, itemId, Date.now());
      this.store.run('UPDATE players SET tickets = tickets - ? WHERE id = ?', item.price, playerId);
      this.store.run('INSERT INTO ledger (player_id, delta, reason, ref, created_at) VALUES (?, ?, ?, ?, ?)', playerId, -item.price, 'prize', itemId, Date.now());
      const equipped = parseJson(p.equipped, {});
      equipped[item.slot] = itemId;
      this.store.run('UPDATE players SET equipped = ? WHERE id = ?', JSON.stringify(equipped), playerId);
      this.event('purchase', playerId, null, { item: itemId, name: item.name, slot: item.slot, price: item.price });
      const achievements = this.checkAchievements(playerId, { kind: 'purchase' });
      return { ok: true, item, achievements, player: this.players.get(playerId, { inventory: true }) };
    });
  }

  equip(playerId, slot, itemId) {
    const p = this.players.row(playerId);
    if (!p) throw httpError(404, 'No such player.');
    if (!['hat', 'face', 'neck', 'frame', 'title'].includes(slot)) throw httpError(400, 'Bad slot.');
    const equipped = parseJson(p.equipped, {});
    if (itemId) {
      const item = this.prizeById.get(itemId);
      if (!item || item.slot !== slot) throw httpError(400, 'That prize does not go there.');
      if (!this.store.one('SELECT 1 AS x FROM inventory WHERE player_id = ? AND item_id = ?', playerId, itemId)) throw httpError(403, "You don't own that yet.");
      equipped[slot] = itemId;
    } else delete equipped[slot];
    this.store.run('UPDATE players SET equipped = ?, updated_at = ? WHERE id = ?', JSON.stringify(equipped), Date.now(), playerId);
    const player = this.players.get(playerId, { inventory: true });
    this.hub?.send('player', { player });
    return { ok: true, player };
  }

  // ───────────── admin ─────────────

  deleteScore(id) {
    this.store.run('DELETE FROM scores WHERE id = ?', id);
  }

  deleteResult(id) {
    this.store.run('DELETE FROM results WHERE id = ?', id);
  }

  recentScores({ gameId = null, playerId = null, limit = 50 } = {}) {
    return this.store
      .all(
        `SELECT s.*, p.name AS player_name FROM scores s JOIN players p ON p.id = s.player_id
         WHERE (? IS NULL OR s.game_id = ?) AND (? IS NULL OR s.player_id = ?)
         ORDER BY s.id DESC LIMIT ?`,
        gameId, gameId, playerId, playerId, Math.max(1, Math.min(500, limit)),
      )
      .map((r) => ({ ...r, meta: parseJson(r.meta, null) }));
  }

  recentResults({ gameId = null, playerId = null, limit = 50 } = {}) {
    return this.store
      .all(
        `SELECT r.*, p.name AS player_name FROM results r JOIN players p ON p.id = r.player_id
         WHERE (? IS NULL OR r.game_id = ?) AND (? IS NULL OR r.player_id = ?)
         ORDER BY r.id DESC LIMIT ?`,
        gameId, gameId, playerId, playerId, Math.max(1, Math.min(500, limit)),
      )
      .map((r) => ({ ...r, meta: parseJson(r.meta, null) }));
  }

  exportAll() {
    const tables = ['players', 'devices', 'sessions', 'scores', 'results', 'achievements', 'ledger', 'inventory', 'events', 'settings'];
    const out = { format: 'au12-arcade', version: 1, exportedAt: new Date().toISOString(), tables: {} };
    for (const t of tables) out.tables[t] = this.store.all(`SELECT * FROM ${t}`);
    return out;
  }

  importAll(data) {
    if (!data || data.format !== 'au12-arcade' || !data.tables) throw httpError(400, 'That is not an arcade backup.');
    const order = ['players', 'devices', 'sessions', 'scores', 'results', 'achievements', 'ledger', 'inventory', 'events', 'settings'];
    this.store.tx(() => {
      for (const t of [...order].reverse()) this.store.run(`DELETE FROM ${t}`);
      for (const t of order) {
        for (const row of data.tables[t] || []) {
          const cols = Object.keys(row).filter((c) => /^[a-z_]+$/.test(c));
          if (!cols.length) continue;
          this.store.db
            .prepare(`INSERT INTO ${t} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`)
            .run(...cols.map((c) => row[c]));
        }
      }
    });
    this.catalog.rebuild();
  }
}
