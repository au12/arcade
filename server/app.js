// The HTTP API and the site.
//
//   GET    /                          the arcade (app routes all serve index.html)
//   GET    /admin                     the admin page (needs ADMIN_PASSWORD)
//   GET    /sdk/v1/arcade.js          the SDK games load
//   GET    /api/v1/config             arcade name, settings, game of the day
//   GET    /api/v1/games              the games, with record holders
//   GET    /api/v1/games/:id/boards/:board?period=&view=&limit=
//   GET    /api/v1/hall               medal table and records
//   GET    /api/v1/players            everyone      POST: add a player
//   GET    /api/v1/players/:id        a profile     PATCH: edit (as that player)
//   GET    /api/v1/me                 this device's player   POST {player, pin}: play as  DELETE: nobody
//   POST   /api/v1/sessions           start playing a game   (/:id/beat, /:id/end)
//   POST   /api/v1/scores             a score from a game
//   POST   /api/v1/results            a win, loss or draw from a game
//   POST   /api/v1/achievements       a game's own achievement
//   GET    /api/v1/feed               recent records, wins, achievements
//   GET    /api/v1/prizes             the prize counter    POST /api/v1/prizes/:id/buy
//   GET    /api/v1/stream             live events (server-sent events)
//
// Games post to the API in one of two ways: through the arcade page they are
// framed in (same origin), or straight from their own origin when played on
// their own (CORS with credentials; the origin must belong to that game).

import http from 'node:http';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';
import { config, log } from './config.js';
import { openStore } from './db.js';
import { Catalog, originOf } from './catalog.js';
import { Players, PALETTE, GENES } from './players.js';
import { Boards } from './boards.js';
import { Hub } from './hub.js';
import { Arcade } from './arcade.js';
import { HttpError, send, readJson, parseCookies, cookie, clientIp, isHttps, ownOrigin, limiter, serveFile } from './http.js';
import { adminRoutes } from './admin.js';

export const APP_DEFAULTS = {
  attractSeconds: 90, // menus idle this long on the cabinet → attract loop
  idleMinutes: 15, // nobody touches a game for this long on the cabinet → "still playing?"
  signOutOnAttract: true,
  attractSound: false,
  buttonColors: { B1: '#e8322f', B2: '#f5c000', B3: '#1e7be6', B4: '#2fb34a', B5: '#ffffff', B6: '#8a3ffc', START: '#ffffff', COIN: '#f5c000', HOME: '#222222', LFLIP: '#ffffff', RFLIP: '#ffffff', LAUNCH: '#e8322f' },
  welcome: 'Insert coin',
};

const DEVICE_COOKIE = 'arcade_device';
const SPA_ROUTES = /^\/(?:$|play\/|game\/|player\/|players|hall|prizes|attract|controller|settings|cabinet|new)/;

export function createApp({ store = openStore() } = {}) {
  const catalog = new Catalog(store);
  const players = new Players(store);
  const boards = new Boards(store, catalog, players);
  const hub = new Hub();
  const arcade = new Arcade({ store, catalog, players, boards, hub });

  const appSettings = () => ({ ...APP_DEFAULTS, ...(store.getSetting('app', {}) || {}) });

  const limits = {
    signup: limiter(12, 60_000),
    pin: limiter(10, 60_000),
    write: limiter(90, 60_000),
    admin: limiter(8, 60_000),
  };

  const sweep = setInterval(() => arcade.sweep(), 60_000);
  sweep.unref();

  // ───────────── routing ─────────────

  const routes = [];
  const route = (method, pattern, handler, opts = {}) => {
    const keys = [];
    const re = new RegExp(`^${pattern.replace(/:(\w+)/g, (_, k) => (keys.push(k), '([^/]+)'))}/?$`);
    routes.push({ method, re, keys, handler, cors: Boolean(opts.cors) });
  };

  // Content-Security-Policy for the app's pages: games are allowed in frames.
  const csp = () => {
    const frames = [...catalog.origins].join(' ');
    return [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "font-src 'self'",
      "connect-src 'self'",
      `frame-src 'self' ${frames}`.trim(),
      "worker-src 'self'",
      "manifest-src 'self'",
      "object-src 'none'",
      "base-uri 'self'",
      "frame-ancestors 'self'",
    ].join('; ');
  };
  const pageHeaders = () => ({
    'Content-Security-Policy': csp(),
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'serial=(self), hid=(self), gamepad=*, fullscreen=*, autoplay=*, screen-wake-lock=*',
  });

  function deviceFor(ctx, { create = true } = {}) {
    if (ctx._device !== undefined) return ctx._device;
    let token = ctx.cookies[DEVICE_COOKIE];
    if (!token || !/^[A-Za-z0-9_-]{20,64}$/.test(token)) {
      if (!create || ctx.crossOrigin) {
        ctx._device = null;
        return null;
      }
      token = randomBytes(24).toString('base64url');
      ctx.setCookies.push(cookie(DEVICE_COOKIE, token, { maxAge: 5 * 365 * 86400, secure: isHttps(ctx.req) }));
    }
    ctx._device = players.device(token, ctx.req.headers['user-agent']);
    return ctx._device;
  }

  /** The player this device plays as (or a 401). */
  function requirePlayer(ctx) {
    const d = deviceFor(ctx);
    if (!d?.player_id) throw new HttpError(401, 'Pick a player first.');
    return d.player_id;
  }

  /** Which game a cross-origin request may speak for. */
  function gameForOrigin(ctx, gameId) {
    if (!ctx.crossOrigin) return;
    const games = catalog.byOrigin(ctx.origin).map((g) => g.id);
    if (!games.includes(gameId)) throw new HttpError(403, 'This site cannot post for that game.');
  }

  // ───────────── public API ─────────────

  route('GET', '/healthz', (ctx) => send(ctx.res, 200, 'ok\n'));

  route('GET', '/api/v1/config', (ctx) => {
    const app = appSettings();
    return {
      name: store.getSetting('arcadeName', null) || config.arcadeName,
      version: config.version,
      publicUrl: config.publicUrl || ownOrigin(ctx.req),
      gameOfDay: arcade.gameOfDay(),
      openSignup: config.openSignup,
      palette: PALETTE,
      genes: GENES,
      app,
      admin: Boolean(config.adminPassword),
    };
  });

  const gameSummaries = (me) => {
    const recs = boards.records();
    const plays = new Map(
      store.all("SELECT game_id AS g, COUNT(*) AS n FROM sessions WHERE started_at >= ? GROUP BY game_id", Date.now() - 30 * 86_400_000).map((r) => [r.g, r.n]),
    );
    const cache = new Map();
    const who = (id) => {
      if (!cache.has(id)) cache.set(id, players.get(id));
      return cache.get(id);
    };
    return catalog.publicList().map((g) => {
      const records = {};
      for (const [bid, r] of Object.entries(recs[g.id] || {})) records[bid] = { ...r, player: who(r.playerId) };
      const mine = {};
      if (me) {
        const game = catalog.get(g.id);
        for (const b of game.boards) {
          const s = boards.standing(g.id, b, me);
          if (s) mine[b.id] = s;
        }
      }
      return { ...g, records, mine, plays30: plays.get(g.id) || 0 };
    });
  };

  route('GET', '/api/v1/games', (ctx) => {
    const me = deviceFor(ctx)?.player_id || null;
    return { games: gameSummaries(me), gameOfDay: arcade.gameOfDay() };
  });

  route('GET', '/api/v1/games/:id', (ctx) => {
    const me = deviceFor(ctx)?.player_id || null;
    const g = gameSummaries(me).find((x) => x.id === ctx.params.id);
    if (!g) throw new HttpError(404, 'No such game.');
    return g;
  });

  route(
    'GET',
    '/api/v1/games/:id/boards/:board',
    (ctx) => {
      const q = ctx.query;
      const me = q.get('player') || deviceFor(ctx, { create: false })?.player_id || null;
      const b = boards.board(ctx.params.id, ctx.params.board, {
        period: ['all', 'month', 'week', 'today'].includes(q.get('period')) ? q.get('period') : 'all',
        view: q.get('view') === 'games' ? 'games' : 'players',
        limit: Number(q.get('limit')) || 10,
        me,
      });
      if (!b) throw new HttpError(404, 'No such board.');
      return b;
    },
    { cors: true },
  );

  route('GET', '/api/v1/hall', (ctx) => {
    const period = ['all', 'month', 'week', 'today'].includes(ctx.query.get('period')) ? ctx.query.get('period') : 'all';
    const m = boards.medals({ period });
    return { period, ...m };
  });

  route('GET', '/api/v1/achievements', () => ({ achievements: arcade.achievements() }));

  route('GET', '/api/v1/players', () => ({ players: players.list() }));

  route('POST', '/api/v1/players', async (ctx) => {
    if (!config.openSignup) throw new HttpError(403, 'Ask the arcade owner to add you.');
    if (!limits.signup(ctx.ip)) throw new HttpError(429, 'Slow down.');
    if (players.count() >= config.maxPlayers) throw new HttpError(409, 'The arcade is full.');
    const body = await readJson(ctx.req);
    const p = players.create({ name: body.name, initials: body.initials, color: body.color, avatar: body.avatar, pin: body.pin });
    // Whoever adds a player is playing as them on this device.
    players.setDevicePlayer(deviceFor(ctx), p.id, body.pin);
    arcade.event('join', p.id, null, {});
    return { player: players.get(p.id, { inventory: true }) };
  });

  route('GET', '/api/v1/players/:id', (ctx) => {
    const prof = boards.profile(ctx.params.id);
    if (!prof) throw new HttpError(404, 'No such player.');
    prof.feed = arcade.feed({ playerId: ctx.params.id, limit: 12 });
    return prof;
  });

  route('PATCH', '/api/v1/players/:id', async (ctx) => {
    const me = requirePlayer(ctx);
    if (me !== ctx.params.id) throw new HttpError(403, 'You can only change your own player.');
    const body = await readJson(ctx.req);
    const p = players.update(me, { name: body.name, initials: body.initials, color: body.color, avatar: body.avatar });
    hub.send('player', { player: p });
    return { player: players.get(me, { inventory: true }) };
  });

  route('POST', '/api/v1/players/:id/pin', async (ctx) => {
    const me = requirePlayer(ctx);
    if (me !== ctx.params.id) throw new HttpError(403, 'You can only change your own PIN.');
    const body = await readJson(ctx.req);
    players.setPin(me, body.pin || null);
    return { player: players.get(me, { inventory: true }) };
  });

  route(
    'GET',
    '/api/v1/me',
    (ctx) => {
      const d = deviceFor(ctx, { create: !ctx.crossOrigin });
      return { player: d?.player_id ? players.get(d.player_id, { inventory: !ctx.crossOrigin }) : null, kiosk: Boolean(d?.kiosk) };
    },
    { cors: true },
  );

  route('POST', '/api/v1/me', async (ctx) => {
    const d = deviceFor(ctx);
    if (!limits.pin(d.id)) throw new HttpError(429, 'Too many tries. Wait a minute.');
    const body = await readJson(ctx.req);
    const ok = players.setDevicePlayer(d, body.player ?? null, body.pin);
    if (!ok) throw new HttpError(401, 'This player has a PIN.', { needPin: true });
    return { player: body.player ? players.get(body.player, { inventory: true }) : null };
  });

  route('DELETE', '/api/v1/me', (ctx) => {
    const d = deviceFor(ctx);
    players.setDevicePlayer(d, null);
    return { player: null };
  });

  route('POST', '/api/v1/me/kiosk', async (ctx) => {
    const d = deviceFor(ctx);
    const body = await readJson(ctx.req);
    players.setKiosk(d, Boolean(body.on));
    return { kiosk: Boolean(body.on) };
  });

  route('POST', '/api/v1/me/equip', async (ctx) => {
    const me = requirePlayer(ctx);
    const body = await readJson(ctx.req);
    return arcade.equip(me, String(body.slot || ''), body.item ? String(body.item) : null);
  });

  route(
    'POST',
    '/api/v1/sessions',
    async (ctx) => {
      const body = await readJson(ctx.req);
      const gameId = String(body.game || '');
      gameForOrigin(ctx, gameId);
      const d = deviceFor(ctx, { create: !ctx.crossOrigin });
      if (!d) throw new HttpError(401, 'Unknown device.');
      if (!limits.write(d.id)) throw new HttpError(429, 'Slow down.');
      return arcade.startSession({ playerId: d.player_id || null, gameId, deviceId: d.id, source: ctx.crossOrigin ? 'direct' : 'arcade' });
    },
    { cors: true },
  );

  route(
    'POST',
    '/api/v1/sessions/:id/beat',
    (ctx) => {
      const d = deviceFor(ctx, { create: false });
      return { ok: arcade.beat(ctx.params.id, d?.id) };
    },
    { cors: true },
  );

  route(
    'POST',
    '/api/v1/sessions/:id/end',
    (ctx) => {
      const d = deviceFor(ctx, { create: false });
      return { ok: arcade.endSession(ctx.params.id, d?.id) };
    },
    { cors: true },
  );

  const playerForWrite = (ctx) => {
    const d = deviceFor(ctx, { create: !ctx.crossOrigin });
    if (!d) throw new HttpError(401, 'Unknown device.');
    if (!limits.write(d.id)) throw new HttpError(429, 'Slow down.');
    if (!d.player_id) throw new HttpError(401, 'Nobody is signed in on this device.');
    return d.player_id;
  };

  route(
    'POST',
    '/api/v1/scores',
    async (ctx) => {
      const body = await readJson(ctx.req);
      const gameId = String(body.game || '');
      gameForOrigin(ctx, gameId);
      const playerId = playerForWrite(ctx);
      return arcade.submitScore({
        playerId,
        gameId,
        boardId: String(body.board || 'score'),
        value: body.value,
        meta: body.meta,
        sessionId: body.session ? String(body.session) : null,
        source: ctx.crossOrigin ? 'direct' : 'arcade',
      });
    },
    { cors: true },
  );

  route(
    'POST',
    '/api/v1/results',
    async (ctx) => {
      const body = await readJson(ctx.req);
      const gameId = String(body.game || '');
      gameForOrigin(ctx, gameId);
      const playerId = playerForWrite(ctx);
      return arcade.submitResult({
        playerId,
        gameId,
        outcome: String(body.outcome || ''),
        meta: body.meta,
        sessionId: body.session ? String(body.session) : null,
        source: ctx.crossOrigin ? 'direct' : 'arcade',
      });
    },
    { cors: true },
  );

  route(
    'POST',
    '/api/v1/achievements',
    async (ctx) => {
      const body = await readJson(ctx.req);
      const gameId = String(body.game || '');
      gameForOrigin(ctx, gameId);
      const playerId = playerForWrite(ctx);
      return arcade.unlockGameAchievement({ playerId, gameId, achievementId: String(body.id || '') });
    },
    { cors: true },
  );

  route('GET', '/api/v1/feed', (ctx) => {
    const q = ctx.query;
    return { feed: arcade.feed({ limit: Number(q.get('limit')) || 20, before: q.get('before') ? Number(q.get('before')) : null, playerId: q.get('player') || null }) };
  });

  route('GET', '/api/v1/prizes', () => ({ prizes: arcade.prizes }));

  route('POST', '/api/v1/prizes/:id/buy', (ctx) => {
    const me = requirePlayer(ctx);
    return arcade.purchase(me, ctx.params.id);
  });

  route('GET', '/api/v1/stream', (ctx) => {
    hub.add(ctx.req, ctx.res);
    return undefined;
  });

  adminRoutes({ route, store, catalog, players, arcade, boards, hub, limits, appSettings, HttpError });

  // ───────────── the server ─────────────

  async function handle(req, res) {
    const url = new URL(req.url, 'http://x');
    const pathname = decodeURIComponent(url.pathname);
    const origin = req.headers.origin || '';
    const own = ownOrigin(req);
    const crossOrigin = Boolean(origin) && origin !== own && origin !== 'null';
    const ctx = {
      req,
      res,
      query: url.searchParams,
      cookies: parseCookies(req),
      ip: clientIp(req),
      origin,
      own,
      crossOrigin,
      setCookies: [],
      params: {},
    };

    if (pathname.startsWith('/api/')) {
      const match = routes.find((r) => (r.method === req.method || (req.method === 'OPTIONS' && r.cors)) && r.re.test(pathname));
      const corsHeaders = {};
      if (crossOrigin) {
        if (!match?.cors || !catalog.allowsOrigin(origin)) {
          return send(res, 403, { error: 'Not allowed from this origin.' });
        }
        Object.assign(corsHeaders, {
          'Access-Control-Allow-Origin': origin,
          'Access-Control-Allow-Credentials': 'true',
          Vary: 'Origin',
        });
        if (req.method === 'OPTIONS') {
          res.writeHead(204, {
            ...corsHeaders,
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type',
            'Access-Control-Max-Age': '600',
          });
          return res.end();
        }
      }
      if (!match) return send(res, 404, { error: 'Not found.' }, corsHeaders);
      const m = pathname.match(match.re);
      match.keys.forEach((k, i) => {
        ctx.params[k] = m[i + 1];
      });
      try {
        const out = await match.handler(ctx);
        if (out === undefined || res.headersSent) return undefined;
        const headers = { ...corsHeaders };
        if (ctx.setCookies.length) headers['Set-Cookie'] = ctx.setCookies;
        return send(res, 200, out, headers);
      } catch (e) {
        const status = e.status || 500;
        if (status >= 500) log.warn(`${req.method} ${pathname}: ${e.stack || e.message}`);
        const headers = { ...corsHeaders };
        if (ctx.setCookies.length) headers['Set-Cookie'] = ctx.setCookies;
        return send(res, status, { error: status >= 500 ? 'Something went wrong.' : e.message, ...(e.extra || {}) }, headers);
      }
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed\n');

    if (pathname === '/healthz') return send(res, 200, 'ok\n');

    // The SDK may be loaded by any game page.
    if (pathname.startsWith('/sdk/')) {
      if (serveFile(req, res, path.join(config.webDir, 'sdk'), pathname.slice(5), { 'Access-Control-Allow-Origin': '*', 'Cross-Origin-Resource-Policy': 'cross-origin' })) return undefined;
      return send(res, 404, 'Not found\n');
    }

    if (pathname.startsWith('/catalog/')) {
      const rel = pathname.slice('/catalog/'.length);
      if (/^(art|icons|shots)\//.test(rel) && serveFile(req, res, config.catalogDir, rel, { 'Cache-Control': 'public, max-age=86400' })) return undefined;
      return send(res, 404, 'Not found\n');
    }

    if (pathname === '/admin' || pathname === '/admin/') {
      if (serveFile(req, res, config.webDir, 'admin.html', pageHeaders())) return undefined;
      return send(res, 404, 'Not found\n');
    }

    if (pathname !== '/' && serveFile(req, res, config.webDir, pathname.slice(1), pathname.endsWith('.html') ? pageHeaders() : {})) return undefined;

    if (SPA_ROUTES.test(pathname)) {
      if (serveFile(req, res, config.webDir, 'index.html', pageHeaders())) return undefined;
      return send(res, 503, 'The app has not been built. Run npm run build in web/.\n');
    }
    return send(res, 404, 'Not found\n');
  }

  const server = http.createServer((req, res) => {
    handle(req, res).catch((e) => {
      log.warn(`unhandled: ${e.stack || e.message}`);
      if (!res.headersSent) send(res, 500, { error: 'Something went wrong.' });
    });
  });
  server.keepAliveTimeout = 65_000;

  const close = () =>
    new Promise((resolve) => {
      hub.close();
      clearInterval(sweep);
      server.close(() => {
        store.close();
        resolve();
      });
      server.closeAllConnections?.();
    });

  return { server, store, catalog, players, boards, arcade, hub, close, appSettings };
}

export function checkWebBuild() {
  if (!fs.existsSync(path.join(config.webDir, 'index.html'))) log.warn(`no built app in ${config.webDir}; run "npm run build" in web/`);
}

export { originOf };
