import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arcade-test-'));
process.env.DATA_DIR = dir;
process.env.GAME_DOMAIN = 'example.test';
process.env.ADMIN_PASSWORD = 'hunter22';
process.env.LOG_LEVEL = 'silent';
process.env.TRUST_PROXY = '0';

const { createApp } = await import('../server/app.js');
const { openStore } = await import('../server/db.js');

let app;
let base;

/** A browser: keeps its cookies, can pretend to be another origin. */
function client(origin = null) {
  const jar = new Map();
  const call = async (method, url, body, headers = {}) => {
    const h = { ...headers };
    if (jar.size) h.cookie = [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
    if (body !== undefined) h['content-type'] = 'application/json';
    if (origin) h.origin = origin;
    const res = await fetch(base + url, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
    for (const c of res.headers.getSetCookie()) {
      const [kv] = c.split(';');
      const i = kv.indexOf('=');
      jar.set(kv.slice(0, i), kv.slice(i + 1));
    }
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      /* not json */
    }
    return { status: res.status, json, headers: res.headers, text };
  };
  return {
    get: (u, h) => call('GET', u, undefined, h),
    post: (u, b = {}, h) => call('POST', u, b, h),
    patch: (u, b = {}) => call('PATCH', u, b),
    put: (u, b = {}) => call('PUT', u, b),
    del: (u) => call('DELETE', u),
    options: (u, h) => call('OPTIONS', u, undefined, h),
    jar,
  };
}

before(async () => {
  app = createApp({ store: openStore(path.join(dir, 'arcade.db')) });
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${app.server.address().port}`;
});

after(async () => {
  await app.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('config and games come from the catalog', async () => {
  const c = client();
  const cfg = await c.get('/api/v1/config');
  assert.equal(cfg.status, 200);
  assert.equal(cfg.json.name, 'au12 Arcade');
  assert.ok(cfg.json.gameOfDay);
  const g = await c.get('/api/v1/games');
  assert.equal(g.json.games.length, 8);
  const totem = g.json.games.find((x) => x.id === 'totem');
  assert.equal(totem.url, 'https://totem.example.test');
  assert.equal(totem.art, '/catalog/art/totem.svg');
});

test('players, scores, records, personal bests and tickets', async () => {
  const dad = client();
  const r = await dad.post('/api/v1/players', { name: 'Dad', initials: 'adu', color: '#ff4d6d' });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.player.initials, 'ADU');
  const me = await dad.get('/api/v1/me');
  assert.equal(me.json.player.name, 'Dad');

  const dup = await client().post('/api/v1/players', { name: 'dad' });
  assert.equal(dup.status, 409);

  const s = await dad.post('/api/v1/sessions', { game: 'totem' });
  assert.equal(s.status, 200);
  assert.ok(s.json.id);
  assert.equal(s.json.daily, 5);

  const first = await dad.post('/api/v1/scores', { game: 'totem', board: 'score', value: 120000, session: s.json.id });
  assert.equal(first.status, 200, first.text);
  assert.equal(first.json.record, true);
  assert.equal(first.json.firstRecord, true);
  assert.equal(first.json.personalBest, true);
  assert.equal(first.json.rank, 1);
  // 12 for the score (+12 more if Totem is the game of the day), 10 for the first record
  assert.ok(first.json.tickets.earned >= 22);
  const ids = first.json.achievements.map((a) => a.id);
  assert.ok(ids.includes('totem:fifty-k'));
  assert.ok(ids.includes('totem:six-figures'));
  assert.ok(ids.includes('arcade:top-spot'));

  const worse = await dad.post('/api/v1/scores', { game: 'totem', board: 'score', value: 90000 });
  assert.equal(worse.json.personalBest, false);
  assert.equal(worse.json.record, false);
  assert.equal(worse.json.best, 120000);

  const mom = client();
  await mom.post('/api/v1/players', { name: 'Grandma', color: '#7b5cff' });
  const beat = await mom.post('/api/v1/scores', { game: 'totem', board: 'score', value: 250500 });
  assert.equal(beat.json.record, true);
  assert.equal(beat.json.prevHolder.name, 'Dad');
  assert.ok(beat.json.achievements.some((a) => a.id === 'arcade:record-breaker'));
  assert.ok(beat.json.achievements.some((a) => a.id === 'totem:totem-master'));

  const board = await dad.get('/api/v1/games/totem/boards/score');
  assert.deepEqual(board.json.entries.map((e) => [e.player.name, e.value, e.rank]), [['Grandma', 250500, 1], ['Dad', 120000, 2]]);
  const games = await dad.get('/api/v1/games/totem/boards/score?view=games');
  assert.equal(games.json.entries.length, 3);

  const bad = await dad.post('/api/v1/scores', { game: 'totem', board: 'score', value: 'lots' });
  assert.equal(bad.status, 400);
  const nobody = await client().post('/api/v1/scores', { game: 'totem', value: 5 });
  assert.equal(nobody.status, 401);
});

test('results, wins boards and game achievements with filters', async () => {
  const kid = client();
  await kid.post('/api/v1/players', { name: 'Sprout' });
  const w = await kid.post('/api/v1/results', { game: 'pazaak', outcome: 'win', meta: { vs: 'bot', bot: 'hard' } });
  assert.equal(w.status, 200, w.text);
  assert.ok(w.json.achievements.some((a) => a.id === 'pazaak:beat-oru-kaan'));
  assert.ok(w.json.tickets.earned >= 30);
  await kid.post('/api/v1/results', { game: 'pazaak', outcome: 'loss', meta: { vs: 'human' } });
  const b = await kid.get('/api/v1/games/pazaak/boards/wins');
  assert.equal(b.json.entries[0].player.name, 'Sprout');
  assert.equal(b.json.entries[0].wins, 1);
  assert.equal(b.json.entries[0].losses, 1);
  const bots = await kid.get('/api/v1/games/pazaak/boards/bots');
  assert.equal(bots.json.entries[0].wins, 1);
  const wrong = await kid.post('/api/v1/results', { game: 'pazaak', outcome: 'victory' });
  assert.equal(wrong.status, 400);

  // A filter of false means "not true": a result without the key counts.
  const cards = client();
  await cards.post('/api/v1/players', { name: 'Card Shark' });
  await cards.post('/api/v1/results', { game: 'swipe', outcome: 'win' });
  await cards.post('/api/v1/results', { game: 'swipe', outcome: 'win', meta: { match: false, players: 3 } });
  const both = await cards.post('/api/v1/results', { game: 'swipe', outcome: 'win', meta: { match: true } });
  assert.ok(both.json.tickets.breakdown.some((x) => x.label === 'Match won'));
  const games = await cards.get('/api/v1/games/swipe/boards/wins');
  assert.equal(games.json.entries.find((e) => e.player.name === 'Card Shark').wins, 2);
  const matches = await cards.get('/api/v1/games/swipe/boards/matches');
  assert.equal(matches.json.entries.find((e) => e.player.name === 'Card Shark').wins, 1);
});

test('hall of fame medals and profiles', async () => {
  const hall = await client().get('/api/v1/hall');
  const top = hall.json.table[0];
  assert.ok(top.gold >= 1);
  const players = await client().get('/api/v1/players');
  const grandma = players.json.players.find((p) => p.name === 'Grandma');
  const prof = await client().get(`/api/v1/players/${grandma.id}`);
  assert.equal(prof.status, 200);
  const totem = prof.json.games.find((g) => g.id === 'totem');
  assert.equal(totem.boards[0].standing.rank, 1);
  assert.ok(prof.json.achievements.length >= 3);
  assert.ok(prof.json.feed.some((e) => e.type === 'record'));
});

test('prize counter: buy, equip, not enough tickets', async () => {
  const c = client();
  await c.post('/api/v1/players', { name: 'Shopper' });
  const poor = await c.post('/api/v1/prizes/crown/buy');
  assert.equal(poor.status, 402);
  await c.post('/api/v1/results', { game: 'swipe', outcome: 'win', meta: { match: true } });
  const me = await c.get('/api/v1/me');
  assert.ok(me.json.player.tickets >= 40, `has ${me.json.player.tickets}`);
  const buy = await c.post('/api/v1/prizes/party/buy');
  assert.equal(buy.status, 200, buy.text);
  assert.equal(buy.json.player.equipped.hat, 'party');
  assert.ok(buy.json.player.inventory.includes('party'));
  const again = await c.post('/api/v1/prizes/party/buy');
  assert.equal(again.status, 409);
  const off = await c.post('/api/v1/me/equip', { slot: 'hat', item: null });
  assert.equal(off.json.player.equipped.hat, undefined);
  const notMine = await c.post('/api/v1/me/equip', { slot: 'hat', item: 'crown' });
  assert.equal(notMine.status, 403);
});

test('PINs: a device must know the PIN once', async () => {
  const owner = client();
  const r = await owner.post('/api/v1/players', { name: 'Locked', pin: '4321' });
  const id = r.json.player.id;
  assert.equal(r.json.player.hasPin, true);
  const other = client();
  const no = await other.post('/api/v1/me', { player: id });
  assert.equal(no.status, 401);
  assert.equal(no.json.needPin, true);
  const wrong = await other.post('/api/v1/me', { player: id, pin: '0000' });
  assert.equal(wrong.status, 403);
  const ok = await other.post('/api/v1/me', { player: id, pin: '4321' });
  assert.equal(ok.status, 200);
  await other.del('/api/v1/me');
  const remembered = await other.post('/api/v1/me', { player: id });
  assert.equal(remembered.status, 200);
  // a cabinet forgets
  const cab = client();
  await cab.post('/api/v1/me/kiosk', { on: true });
  await cab.post('/api/v1/me', { player: id, pin: '4321' });
  await cab.del('/api/v1/me');
  const forgot = await cab.post('/api/v1/me', { player: id });
  assert.equal(forgot.status, 401);
});

test('direct play: CORS only for the game that owns the origin', async () => {
  // A phone that picked a player in the arcade, then opened Totem on its own.
  const phone = client();
  await phone.post('/api/v1/players', { name: 'Phone Player' });
  const cookieJar = phone.jar;
  const asTotem = client('https://totem.example.test');
  for (const [k, v] of cookieJar) asTotem.jar.set(k, v);

  const pre = await asTotem.options('/api/v1/scores', { 'access-control-request-method': 'POST' });
  assert.equal(pre.status, 204);
  assert.equal(pre.headers.get('access-control-allow-origin'), 'https://totem.example.test');
  assert.equal(pre.headers.get('access-control-allow-credentials'), 'true');

  const me = await asTotem.get('/api/v1/me');
  assert.equal(me.json.player.name, 'Phone Player');
  const s = await asTotem.post('/api/v1/scores', { game: 'totem', board: 'score', value: 1000 });
  assert.equal(s.status, 200, s.text);
  const other = await asTotem.post('/api/v1/scores', { game: 'spacecadet', board: 'score', value: 1000 });
  assert.equal(other.status, 403);

  const evil = client('https://evil.example.com');
  for (const [k, v] of cookieJar) evil.jar.set(k, v);
  const nope = await evil.post('/api/v1/scores', { game: 'totem', value: 99999999 });
  assert.equal(nope.status, 403);

  // Unknown phones are not given a device by a game's origin.
  const stranger = client('https://totem.example.test');
  const anon = await stranger.get('/api/v1/me');
  assert.equal(anon.json.player, null);
  assert.equal(stranger.jar.size, 0);
});

test('admin: sign in, change a game address, adjust tickets', async () => {
  const a = client();
  const no = await a.get('/api/admin/state');
  assert.equal(no.status, 401);
  const bad = await a.post('/api/admin/login', { password: 'nope' });
  assert.equal(bad.status, 403);
  const ok = await a.post('/api/admin/login', { password: 'hunter22' });
  assert.equal(ok.status, 200);
  const st = await a.get('/api/admin/state');
  assert.equal(st.status, 200);
  assert.ok(st.json.players.length >= 4);
  const put = await a.put('/api/admin/games/totem', { url: 'https://pinball.example.test/totem/' });
  assert.equal(put.status, 200, put.text);
  assert.equal(put.json.game.url, 'https://pinball.example.test/totem');
  const g = await client().get('/api/v1/games/totem');
  assert.equal(g.json.url, 'https://pinball.example.test/totem');
  // the new origin may post, the old one no longer can
  const fromNew = await client('https://pinball.example.test').options('/api/v1/scores');
  assert.equal(fromNew.status, 204);
  const pid = st.json.players[0].id;
  const t = await a.post(`/api/admin/players/${pid}/tickets`, { delta: 100 });
  assert.equal(t.status, 200);
  const backup = await a.get('/api/admin/export');
  assert.equal(backup.json.format, 'au12-arcade');
  assert.ok(backup.json.tables.scores.length >= 4);
});

test('server-sent events announce records', async () => {
  const res = await fetch(`${base}/api/v1/stream`);
  const reader = res.body.getReader();
  const c = client();
  await c.post('/api/v1/players', { name: 'Streamer' });
  await c.post('/api/v1/scores', { game: 'nanosaur', board: 'score', value: 31337 });
  let text = '';
  const deadline = Date.now() + 3000;
  while (!text.includes('event: record') && Date.now() < deadline) {
    const { value } = await reader.read();
    text += new TextDecoder().decode(value);
  }
  await reader.cancel();
  assert.ok(text.includes('event: record'));
  assert.ok(text.includes('31337'));
});
