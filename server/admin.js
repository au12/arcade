// The admin API behind /admin: games and their addresses, players, scores,
// settings, backups. Switched off unless ADMIN_PASSWORD is set. As with your
// other apps, consider limiting /admin and /api/admin to your LAN in Nginx
// Proxy Manager as well.

import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { config } from './config.js';
import { cookie, isHttps, readJson, send } from './http.js';

const COOKIE = 'arcade_admin';

function same(a, b) {
  const ha = createHash('sha256').update(String(a)).digest();
  const hb = createHash('sha256').update(String(b)).digest();
  return timingSafeEqual(ha, hb);
}

export function adminRoutes({ route, store, catalog, players, arcade, boards, hub, limits, appSettings, HttpError }) {
  let secret = store.getSetting('adminSecret', null);
  if (!secret) {
    secret = randomBytes(32).toString('base64url');
    store.setSetting('adminSecret', secret);
  }
  const sign = (exp) => createHmac('sha256', secret).update(`admin:${exp}`).digest('base64url');

  const isAdmin = (ctx) => {
    if (!config.adminPassword) return false;
    const raw = ctx.cookies[COOKIE] || '';
    const [exp, sig] = raw.split('.');
    if (!exp || !sig || Number(exp) < Date.now()) return false;
    return same(sig, sign(exp));
  };

  const guard = (handler) => async (ctx) => {
    if (!config.adminPassword) throw new HttpError(404, 'The admin page is switched off. Set ADMIN_PASSWORD to use it.');
    if (!isAdmin(ctx)) throw new HttpError(401, 'Sign in first.');
    return handler(ctx);
  };

  route('GET', '/api/admin/session', (ctx) => ({ enabled: Boolean(config.adminPassword), signedIn: isAdmin(ctx) }));

  route('POST', '/api/admin/login', async (ctx) => {
    if (!config.adminPassword) throw new HttpError(404, 'The admin page is switched off. Set ADMIN_PASSWORD to use it.');
    if (!limits.admin(ctx.ip)) throw new HttpError(429, 'Too many tries. Wait a minute.');
    const body = await readJson(ctx.req);
    if (!same(String(body.password || ''), config.adminPassword)) throw new HttpError(403, 'Wrong password.');
    const exp = Date.now() + config.adminSessionHours * 3_600_000;
    ctx.setCookies.push(cookie(COOKIE, `${exp}.${sign(exp)}`, { maxAge: config.adminSessionHours * 3600, secure: isHttps(ctx.req), sameSite: 'Strict' }));
    return { ok: true };
  });

  route('POST', '/api/admin/logout', (ctx) => {
    ctx.setCookies.push(cookie(COOKIE, '', { maxAge: 0, sameSite: 'Strict' }));
    return { ok: true };
  });

  route(
    'GET',
    '/api/admin/state',
    guard(() => {
      const counts = {};
      for (const t of ['players', 'devices', 'sessions', 'scores', 'results', 'achievements', 'events']) counts[t] = store.one(`SELECT COUNT(*) AS n FROM ${t}`).n;
      const devices = store
        .all('SELECT d.id, d.player_id, d.kiosk, d.ua, d.created_at, d.last_seen, p.name AS player_name FROM devices d LEFT JOIN players p ON p.id = d.player_id ORDER BY d.last_seen DESC LIMIT 100')
        .map((d) => ({ ...d, id: d.id.slice(0, 10) }));
      return {
        games: catalog.games,
        shipped: catalog.shipped.map((g) => g.id),
        players: players.list({ includeHidden: true }),
        settings: { arcadeName: store.getSetting('arcadeName', null) || config.arcadeName, app: appSettings() },
        counts,
        devices,
        gameOfDay: arcade.gameOfDay(),
        version: config.version,
      };
    }),
  );

  route(
    'PUT',
    '/api/admin/settings',
    guard(async (ctx) => {
      const body = await readJson(ctx.req);
      if ('arcadeName' in body) store.setSetting('arcadeName', String(body.arcadeName || '').trim().slice(0, 40) || null);
      if (body.app && typeof body.app === 'object') {
        const cur = store.getSetting('app', {}) || {};
        const next = { ...cur };
        const num = (k, min, max) => {
          if (k in body.app) next[k] = Math.max(min, Math.min(max, Number(body.app[k]) || min));
        };
        num('attractSeconds', 15, 3600);
        num('idleMinutes', 1, 240);
        for (const k of ['signOutOnAttract', 'attractSound']) if (k in body.app) next[k] = Boolean(body.app[k]);
        if ('welcome' in body.app) next.welcome = String(body.app.welcome || '').slice(0, 40);
        if (body.app.buttonColors && typeof body.app.buttonColors === 'object') {
          next.buttonColors = {};
          for (const [k, v] of Object.entries(body.app.buttonColors)) if (/^#[0-9a-f]{6}$/i.test(v)) next.buttonColors[k] = v;
        }
        store.setSetting('app', next);
      }
      hub.send('config', {});
      return { ok: true, settings: { arcadeName: store.getSetting('arcadeName', null) || config.arcadeName, app: appSettings() } };
    }),
  );

  route(
    'PUT',
    '/api/admin/games/:id',
    guard(async (ctx) => {
      const body = await readJson(ctx.req, 64 * 1024);
      try {
        const g = catalog.saveOverride(ctx.params.id, body);
        hub.send('config', {});
        return { game: g };
      } catch (e) {
        throw new HttpError(400, e.message);
      }
    }),
  );

  route(
    'POST',
    '/api/admin/games/order',
    guard(async (ctx) => {
      const body = await readJson(ctx.req);
      const ids = Array.isArray(body.order) ? body.order.map(String) : [];
      ids.forEach((id, i) => {
        if (catalog.get(id)) catalog.saveOverride(id, { order: i });
      });
      hub.send('config', {});
      return { games: catalog.games };
    }),
  );

  route(
    'POST',
    '/api/admin/games',
    guard(async (ctx) => {
      const body = await readJson(ctx.req, 64 * 1024);
      if (catalog.get(String(body.id || ''))) throw new HttpError(409, 'A game with that id already exists.');
      try {
        const g = catalog.saveOverride(String(body.id || ''), { ...body, custom: true });
        hub.send('config', {});
        return { game: g };
      } catch (e) {
        throw new HttpError(400, e.message);
      }
    }),
  );

  route(
    'DELETE',
    '/api/admin/games/:id',
    guard((ctx) => {
      const g = catalog.get(ctx.params.id);
      if (!g) throw new HttpError(404, 'No such game.');
      if (g.custom) catalog.removeCustom(g.id);
      else catalog.resetOverride(g.id);
      hub.send('config', {});
      return { ok: true };
    }),
  );

  route(
    'PATCH',
    '/api/admin/players/:id',
    guard(async (ctx) => {
      const body = await readJson(ctx.req);
      const p = players.update(ctx.params.id, body);
      if ('pin' in body) players.setPin(ctx.params.id, body.pin || null);
      hub.send('player', { player: p });
      return { player: players.get(ctx.params.id) };
    }),
  );

  route(
    'POST',
    '/api/admin/players',
    guard(async (ctx) => {
      const body = await readJson(ctx.req);
      const p = players.create(body);
      arcade.event('join', p.id, null, {});
      return { player: p };
    }),
  );

  route(
    'DELETE',
    '/api/admin/players/:id',
    guard((ctx) => {
      players.remove(ctx.params.id);
      return { ok: true };
    }),
  );

  route(
    'POST',
    '/api/admin/players/:id/merge',
    guard(async (ctx) => {
      const body = await readJson(ctx.req);
      players.merge(ctx.params.id, String(body.into || ''));
      return { ok: true };
    }),
  );

  route(
    'POST',
    '/api/admin/players/:id/tickets',
    guard(async (ctx) => {
      const body = await readJson(ctx.req);
      const delta = Math.trunc(Number(body.delta) || 0);
      if (!delta || Math.abs(delta) > 100000) throw new HttpError(400, 'Give a number of tickets.');
      arcade.award(ctx.params.id, delta, 'admin', String(body.reason || '').slice(0, 80) || null);
      return { player: players.get(ctx.params.id) };
    }),
  );

  route(
    'GET',
    '/api/admin/scores',
    guard((ctx) => ({
      scores: arcade.recentScores({ gameId: ctx.query.get('game'), playerId: ctx.query.get('player'), limit: Number(ctx.query.get('limit')) || 100 }),
      results: arcade.recentResults({ gameId: ctx.query.get('game'), playerId: ctx.query.get('player'), limit: Number(ctx.query.get('limit')) || 100 }),
    })),
  );

  route(
    'DELETE',
    '/api/admin/scores/:id',
    guard((ctx) => {
      arcade.deleteScore(Number(ctx.params.id));
      return { ok: true };
    }),
  );

  route(
    'DELETE',
    '/api/admin/results/:id',
    guard((ctx) => {
      arcade.deleteResult(Number(ctx.params.id));
      return { ok: true };
    }),
  );

  route(
    'GET',
    '/api/admin/export',
    guard((ctx) => {
      const data = arcade.exportAll();
      const stamp = new Date().toISOString().slice(0, 10);
      send(ctx.res, 200, data, { 'Content-Disposition': `attachment; filename="arcade-backup-${stamp}.json"` });
      return undefined;
    }),
  );

  route(
    'POST',
    '/api/admin/import',
    guard(async (ctx) => {
      const body = await readJson(ctx.req, 64 * 1024 * 1024);
      arcade.importAll(body);
      return { ok: true };
    }),
  );

  // Handy for setting up: what the cabinet will see for a game.
  route(
    'GET',
    '/api/admin/boards/:game/:board',
    guard((ctx) => boards.board(ctx.params.game, ctx.params.board, { limit: 100, view: ctx.query.get('view') === 'games' ? 'games' : 'players' })),
  );
}
