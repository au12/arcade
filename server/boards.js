// Leaderboards, the hall of fame and player records: read-only queries.

import { parseJson } from './db.js';

const FILTER_KEY = /^[a-z][a-zA-Z0-9_]{0,31}$/;

export function periodStart(period, now = new Date()) {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  if (period === 'today') return d.getTime();
  if (period === 'week') {
    const back = (d.getDay() + 6) % 7; // weeks start on Monday
    d.setDate(d.getDate() - back);
    return d.getTime();
  }
  if (period === 'month') {
    d.setDate(1);
    return d.getTime();
  }
  return 0;
}

export function dayKey(t = Date.now()) {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** SQL for "meta matches filter" on the results table (values compared as JSON scalars). */
export function filterSql(filter, alias = 'r') {
  const parts = [];
  const params = [];
  for (const [k, v] of Object.entries(filter || {})) {
    if (!FILTER_KEY.test(k)) continue;
    const at = `json_extract(${alias}.meta, '$.${k}')`;
    // true and false mean truthy and falsy, as in metaMatches: a result with
    // no such key at all counts as false.
    if (v === true) parts.push(`(${at} IS NOT NULL AND ${at} NOT IN (0, ''))`);
    else if (v === false) parts.push(`(${at} IS NULL OR ${at} IN (0, ''))`);
    else {
      parts.push(`${at} = ?`);
      params.push(v);
    }
  }
  return { sql: parts.length ? ` AND ${parts.join(' AND ')}` : '', params };
}

export function metaMatches(meta, filter) {
  for (const [k, v] of Object.entries(filter || {})) {
    const got = meta?.[k];
    if (v === true || v === false) {
      if (Boolean(got) !== v) return false;
    } else if (got !== v) return false;
  }
  return true;
}

export class Boards {
  constructor(store, catalog, players) {
    this.store = store;
    this.catalog = catalog;
    this.players = players;
  }

  /** One row per player: their best on a "best" board. */
  bestRows(gameId, board, { since = 0, limit = 10 } = {}) {
    const dir = board.order === 'asc' ? 'ASC' : 'DESC';
    return this.store.all(
      `SELECT player_id, value, created_at, meta FROM (
         SELECT s.player_id, s.value, s.created_at, s.meta,
                ROW_NUMBER() OVER (PARTITION BY s.player_id ORDER BY s.value ${dir}, s.created_at ASC) AS rn
         FROM scores s JOIN players p ON p.id = s.player_id
         WHERE s.game_id = ? AND s.board_id = ? AND s.created_at >= ? AND p.hidden = 0
       ) WHERE rn = 1
       ORDER BY value ${dir}, created_at ASC
       LIMIT ?`,
      gameId, board.id, since, limit,
    );
  }

  /** The classic arcade list: the top games, one player can appear many times. */
  topGames(gameId, board, { since = 0, limit = 10 } = {}) {
    const dir = board.order === 'asc' ? 'ASC' : 'DESC';
    return this.store.all(
      `SELECT s.id, s.player_id, s.value, s.created_at, s.meta FROM scores s JOIN players p ON p.id = s.player_id
       WHERE s.game_id = ? AND s.board_id = ? AND s.created_at >= ? AND p.hidden = 0
       ORDER BY s.value ${dir}, s.created_at ASC LIMIT ?`,
      gameId, board.id, since, limit,
    );
  }

  winRows(gameId, board, { since = 0, limit = 10 } = {}) {
    const f = filterSql(board.filter);
    return this.store.all(
      `SELECT r.player_id,
              SUM(r.outcome = 'win') AS wins, SUM(r.outcome = 'loss') AS losses, SUM(r.outcome = 'draw') AS draws,
              COUNT(*) AS played, MAX(r.created_at) AS created_at
       FROM results r JOIN players p ON p.id = r.player_id
       WHERE r.game_id = ? AND r.created_at >= ? AND p.hidden = 0 ${f.sql}
       GROUP BY r.player_id
       HAVING wins > 0
       ORDER BY wins DESC, losses ASC, created_at ASC
       LIMIT ?`,
      gameId, since, ...f.params, limit,
    );
  }

  /** A leaderboard ready for the app. */
  board(gameId, boardId, { period = 'all', limit = 10, view = 'players', me = null } = {}) {
    const game = this.catalog.get(gameId);
    const board = this.catalog.board(game, boardId);
    if (!game || !board) return null;
    const since = periodStart(period);
    const cap = Math.max(1, Math.min(100, limit));
    let rows;
    if (board.kind === 'wins') {
      rows = this.winRows(gameId, board, { since, limit: 1000 }).map((r) => ({
        playerId: r.player_id,
        value: r.wins,
        wins: r.wins,
        losses: r.losses,
        draws: r.draws,
        played: r.played,
        at: r.created_at,
      }));
    } else if (view === 'games') {
      rows = this.topGames(gameId, board, { since, limit: cap }).map((r) => ({
        playerId: r.player_id,
        value: r.value,
        at: r.created_at,
        meta: parseJson(r.meta, null),
      }));
    } else {
      rows = this.bestRows(gameId, board, { since, limit: 1000 }).map((r) => ({
        playerId: r.player_id,
        value: r.value,
        at: r.created_at,
        meta: parseJson(r.meta, null),
      }));
    }
    let rank = 0;
    let prev;
    rows.forEach((r, i) => {
      if (prev === undefined || r.value !== prev) rank = i + 1;
      r.rank = rank;
      prev = r.value;
    });
    const mine = me ? rows.find((r) => r.playerId === me) : null;
    const entries = rows.slice(0, cap);
    const cache = new Map();
    const who = (id) => {
      if (!cache.has(id)) cache.set(id, this.players.get(id));
      return cache.get(id);
    };
    for (const r of entries) r.player = who(r.playerId);
    if (mine && !entries.includes(mine)) mine.player = who(mine.playerId);
    return {
      game: gameId,
      board,
      period,
      view: board.kind === 'wins' ? 'players' : view,
      entries,
      me: mine || null,
      total: rows.length,
    };
  }

  /** A player's best value on a board and their rank, or null. */
  standing(gameId, board, playerId) {
    if (board.kind === 'wins') {
      const rows = this.winRows(gameId, board, { limit: 1000 });
      const i = rows.findIndex((r) => r.player_id === playerId);
      return i < 0 ? null : { value: rows[i].wins, rank: i + 1 };
    }
    const rows = this.bestRows(gameId, board, { limit: 1000 });
    const i = rows.findIndex((r) => r.player_id === playerId);
    if (i < 0) return null;
    const v = rows[i].value;
    const rank = rows.findIndex((r) => r.value === v) + 1;
    return { value: v, rank };
  }

  bestOf(gameId, boardId, playerId, order = 'desc') {
    const row = this.store.one(
      `SELECT ${order === 'asc' ? 'MIN' : 'MAX'}(value) AS v FROM scores WHERE game_id = ? AND board_id = ? AND player_id = ?`,
      gameId, boardId, playerId,
    );
    return row && row.v !== null ? row.v : null;
  }

  winsOf(gameId, playerId, filter) {
    const f = filterSql(filter);
    return this.store.one(
      `SELECT COUNT(*) AS n FROM results r WHERE r.game_id = ? AND r.player_id = ? AND r.outcome = 'win' ${f.sql}`,
      gameId, playerId, ...f.params,
    ).n;
  }

  /** Record holder of every primary board: { gameId: { board, playerId, value } } */
  records() {
    const out = {};
    for (const g of this.catalog.enabled()) {
      out[g.id] = {};
      for (const b of g.boards) {
        const top = b.kind === 'wins' ? this.winRows(g.id, b, { limit: 1 })[0] : this.bestRows(g.id, b, { limit: 1 })[0];
        if (top) out[g.id][b.id] = { playerId: top.player_id, value: b.kind === 'wins' ? top.wins : top.value, at: top.created_at };
      }
    }
    return out;
  }

  /**
   * The medal table: gold, silver and bronze on each game's primary board,
   * ranked like the Olympics (golds first, then silvers, then bronzes).
   */
  medals({ period = 'all' } = {}) {
    const since = periodStart(period);
    const table = new Map();
    const podiums = [];
    for (const g of this.catalog.enabled()) {
      for (const b of g.boards.filter((x) => x.primary)) {
        const rows = b.kind === 'wins' ? this.winRows(g.id, b, { since, limit: 3 }) : this.bestRows(g.id, b, { since, limit: 3 });
        const podium = rows.map((r, i) => ({ playerId: r.player_id, value: b.kind === 'wins' ? r.wins : r.value, place: i + 1 }));
        podiums.push({ game: g.id, board: b.id, podium });
        podium.forEach((p) => {
          const t = table.get(p.playerId) || { playerId: p.playerId, gold: 0, silver: 0, bronze: 0, games: [] };
          if (p.place === 1) t.gold += 1;
          else if (p.place === 2) t.silver += 1;
          else t.bronze += 1;
          if (p.place === 1) t.games.push(g.id);
          table.set(p.playerId, t);
        });
      }
    }
    const rows = [...table.values()]
      .map((t) => ({ ...t, points: t.gold * 3 + t.silver * 2 + t.bronze, player: this.players.get(t.playerId) }))
      .filter((t) => t.player && !t.player.hidden)
      .sort((a, b) => b.gold - a.gold || b.silver - a.silver || b.bronze - a.bronze || a.player.name.localeCompare(b.player.name));
    return { table: rows, podiums };
  }

  /** Everything the profile page shows about one player. */
  profile(playerId) {
    const player = this.players.get(playerId, { inventory: true });
    if (!player) return null;
    const games = [];
    for (const g of this.catalog.enabled()) {
      const boards = g.boards.map((b) => ({ id: b.id, name: b.name, kind: b.kind, format: b.format, of: b.of, standing: this.standing(g.id, b, playerId) }));
      const s = this.store.one(
        `SELECT COUNT(*) AS plays, COALESCE(SUM(MAX(last_beat, COALESCE(ended_at, last_beat)) - started_at), 0) AS ms, MAX(started_at) AS last
         FROM sessions WHERE player_id = ? AND game_id = ?`,
        playerId, g.id,
      );
      const r = this.store.one(
        `SELECT SUM(outcome = 'win') AS wins, SUM(outcome = 'loss') AS losses, COUNT(*) AS played FROM results WHERE player_id = ? AND game_id = ?`,
        playerId, g.id,
      );
      const scores = this.store.one('SELECT COUNT(*) AS n, MAX(created_at) AS last FROM scores WHERE player_id = ? AND game_id = ?', playerId, g.id);
      games.push({
        id: g.id,
        boards,
        plays: s.plays,
        playMs: Math.max(0, s.ms),
        lastPlayed: Math.max(s.last || 0, scores.last || 0) || null,
        wins: r.wins || 0,
        losses: r.losses || 0,
        played: r.played || 0,
        scores: scores.n,
      });
    }
    const achievements = this.store.all('SELECT achievement_id AS id, unlocked_at AS at FROM achievements WHERE player_id = ? ORDER BY unlocked_at DESC', playerId);
    const totals = this.store.one(
      `SELECT COUNT(*) AS sessions, COALESCE(SUM(MAX(last_beat, COALESCE(ended_at, last_beat)) - started_at), 0) AS ms,
              COUNT(DISTINCT date(started_at / 1000, 'unixepoch', 'localtime')) AS days
       FROM sessions WHERE player_id = ?`,
      playerId,
    );
    const medals = this.medals().table.find((t) => t.playerId === playerId) || { gold: 0, silver: 0, bronze: 0, games: [] };
    return {
      player,
      games,
      achievements,
      medals: { gold: medals.gold, silver: medals.silver, bronze: medals.bronze, records: medals.games },
      totals: { sessions: totals.sessions, playMs: Math.max(0, totals.ms), days: totals.days },
    };
  }
}
