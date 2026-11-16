// Achievements. The arcade-wide ones are defined here; each game adds its own
// in the catalog ("when": a board threshold or a number of wins), so games
// only ever report scores and results and never have to know about them.

import { metaMatches } from './boards.js';

const DAY = 86_400_000;

/** Arcade-wide achievements: id, display fields, tickets, and a check. */
export const ARCADE_ACHIEVEMENTS = [
  {
    id: 'first-quarter', name: 'First Quarter', desc: 'Play your first game', icon: 'coin', tickets: 5,
    check: ({ q, pid }) => q('SELECT 1 FROM sessions WHERE player_id = ? UNION SELECT 1 FROM scores WHERE player_id = ? LIMIT 1', pid, pid),
  },
  {
    id: 'tourist', name: 'Tourist', desc: 'Play four different games', icon: 'map', tickets: 15,
    check: ({ distinctGames }) => distinctGames() >= 4,
  },
  {
    id: 'every-machine', name: 'Every Machine', desc: 'Play every game in the arcade', icon: 'joystick', tickets: 50,
    check: ({ distinctGames, catalog }) => {
      const n = catalog.enabled().length;
      return n > 1 && distinctGames(true) >= n;
    },
  },
  {
    id: 'getting-better', name: 'Getting Better', desc: 'Beat your own best score', icon: 'arrow', tickets: 5,
    check: ({ ev }) => ev?.personalBest && ev?.hadBest,
  },
  {
    id: 'top-spot', name: 'Top Spot', desc: 'Hold first place on any leaderboard', icon: 'trophy', tickets: 20,
    check: ({ recordsHeld }) => recordsHeld().length >= 1,
  },
  {
    id: 'record-breaker', name: 'Record Breaker', desc: "Take a record from someone else", icon: 'bolt', tickets: 25,
    check: ({ ev }) => Boolean(ev?.record && ev?.prevHolder && ev.prevHolder !== ev.playerId),
  },
  {
    id: 'triple-crown', name: 'Triple Crown', desc: 'Hold the record on three different games at once', icon: 'crown', tickets: 75,
    check: ({ recordsHeld }) => new Set(recordsHeld()).size >= 3,
  },
  {
    id: 'night-owl', name: 'Night Owl', desc: 'Play after 10 at night', icon: 'moon', tickets: 10,
    check: ({ ev }) => ev?.hour !== undefined && (ev.hour >= 22 || ev.hour < 3),
  },
  {
    id: 'early-bird', name: 'Early Bird', desc: 'Play before 7 in the morning', icon: 'sun', tickets: 10,
    check: ({ ev }) => ev?.hour !== undefined && ev.hour >= 4 && ev.hour < 7,
  },
  {
    id: 'marathon', name: 'Marathon', desc: 'Play one game for 30 minutes straight', icon: 'clock', tickets: 20,
    check: ({ q, pid }) => q('SELECT 1 FROM sessions WHERE player_id = ? AND last_beat - started_at >= ? LIMIT 1', pid, 30 * 60_000),
  },
  {
    id: 'regular', name: 'Regular', desc: 'Play on seven different days', icon: 'calendar', tickets: 30,
    check: ({ q, pid }) =>
      q(
        `SELECT COUNT(*) >= 7 AS ok FROM (
           SELECT date(started_at / 1000, 'unixepoch', 'localtime') AS d FROM sessions WHERE player_id = ?
           UNION SELECT date(created_at / 1000, 'unixepoch', 'localtime') FROM scores WHERE player_id = ?)`,
        pid, pid,
      )?.ok === 1,
  },
  {
    id: 'pinball-wizard', name: 'Pinball Wizard', desc: 'Post a score on two pinball tables', icon: 'flipper', tickets: 20,
    check: ({ q, pid, catalog }) => {
      const tables = catalog.enabled().filter((g) => /pinball/i.test(g.genre)).map((g) => g.id);
      if (tables.length < 2) return false;
      const marks = tables.map(() => '?').join(',');
      return (q(`SELECT COUNT(DISTINCT game_id) AS n FROM scores WHERE player_id = ? AND game_id IN (${marks})`, pid, ...tables)?.n || 0) >= 2;
    },
  },
  {
    id: 'card-shark', name: 'Card Shark', desc: 'Win ten multiplayer games', icon: 'spade', tickets: 30,
    check: ({ q, pid }) => (q("SELECT COUNT(*) AS n FROM results WHERE player_id = ? AND outcome = 'win'", pid)?.n || 0) >= 10,
  },
  {
    id: 'family-night', name: 'Family Game Night', desc: 'Play on a day when three or more players play', icon: 'house', tickets: 15,
    check: ({ q, pid }) => {
      const since = new Date();
      since.setHours(0, 0, 0, 0);
      const t = since.getTime();
      const played = q('SELECT 1 FROM sessions WHERE player_id = ? AND started_at >= ? LIMIT 1', pid, t);
      if (!played) return false;
      return (q('SELECT COUNT(DISTINCT player_id) AS n FROM sessions WHERE started_at >= ?', t)?.n || 0) >= 3;
    },
  },
  {
    id: 'ticket-tycoon', name: 'Ticket Tycoon', desc: 'Earn 1,000 tickets', icon: 'ticket', tickets: 50,
    check: ({ q, pid }) => (q('SELECT lifetime FROM players WHERE id = ?', pid)?.lifetime || 0) >= 1000,
  },
  {
    id: 'big-spender', name: 'Big Spender', desc: 'Buy something at the prize counter', icon: 'gift', tickets: 0,
    check: ({ q, pid }) => q('SELECT 1 FROM inventory WHERE player_id = ? LIMIT 1', pid),
  },
];

/** Every achievement the app can show: the arcade's and each game's. */
export function allAchievements(catalog) {
  const list = ARCADE_ACHIEVEMENTS.map(({ check, ...a }) => ({ ...a, id: `arcade:${a.id}`, game: null }));
  for (const g of catalog.enabled()) {
    for (const a of g.achievements) {
      list.push({ id: `${g.id}:${a.id}`, name: a.name, desc: a.desc, icon: a.icon, tickets: a.tickets, game: g.id, secret: a.secret });
    }
  }
  return list;
}

/**
 * Works out which achievements a player has just earned. `ev` describes what
 * just happened (a score's flags, a result, the local hour).
 */
export function evaluate({ store, boards, catalog }, playerId, ev = {}) {
  const have = new Set(store.all('SELECT achievement_id AS id FROM achievements WHERE player_id = ?', playerId).map((r) => r.id));
  const q = (sql, ...p) => store.one(sql, ...p);
  let distinct;
  let held;
  const ctx = {
    q,
    pid: playerId,
    ev: { ...ev, playerId },
    catalog,
    distinctGames: (enabledOnly = false) => {
      if (distinct === undefined) {
        distinct = store
          .all(
            `SELECT DISTINCT game_id AS g FROM sessions WHERE player_id = ?
             UNION SELECT DISTINCT game_id FROM scores WHERE player_id = ?
             UNION SELECT DISTINCT game_id FROM results WHERE player_id = ?`,
            playerId, playerId, playerId,
          )
          .map((r) => r.g);
      }
      if (!enabledOnly) return distinct.length;
      const live = new Set(catalog.enabled().map((g) => g.id));
      return distinct.filter((g) => live.has(g)).length;
    },
    recordsHeld: () => {
      if (!held) {
        held = [];
        const recs = boards.records();
        for (const [gid, byBoard] of Object.entries(recs)) {
          for (const r of Object.values(byBoard)) if (r.playerId === playerId) held.push(gid);
        }
      }
      return held;
    },
  };

  const earned = [];
  for (const a of ARCADE_ACHIEVEMENTS) {
    const id = `arcade:${a.id}`;
    if (have.has(id)) continue;
    let ok = false;
    try {
      ok = Boolean(a.check(ctx));
    } catch {
      ok = false;
    }
    if (ok) earned.push({ id, name: a.name, desc: a.desc, icon: a.icon, tickets: a.tickets, game: null });
  }

  // Game achievements only need checking for the game that just reported.
  const g = ev.gameId ? catalog.get(ev.gameId) : null;
  if (g) {
    for (const a of g.achievements) {
      const id = `${g.id}:${a.id}`;
      if (have.has(id) || !a.when) continue;
      let ok = false;
      const w = a.when;
      if (w.board) {
        const b = g.boards.find((x) => x.id === w.board) || { id: w.board, order: 'desc' };
        const best = boards.bestOf(g.id, w.board, playerId, b.order);
        if (best !== null) ok = w.gte !== undefined ? best >= w.gte : w.lte !== undefined ? best <= w.lte : true;
      } else if (w.wins !== undefined) {
        ok = boards.winsOf(g.id, playerId, w.filter) >= w.wins;
      } else if (w.plays !== undefined) {
        ok = (q('SELECT COUNT(*) AS n FROM sessions WHERE player_id = ? AND game_id = ?', playerId, g.id)?.n || 0) >= w.plays;
      } else if (w.result) {
        ok = ev.outcome === w.result && metaMatches(ev.meta, w.filter);
      }
      if (ok) earned.push({ id, name: a.name, desc: a.desc, icon: a.icon, tickets: a.tickets, game: g.id });
    }
  }
  return earned;
}

export const DAY_MS = DAY;
