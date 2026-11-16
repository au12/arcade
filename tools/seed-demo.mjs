// Fills an arcade with a made-up family's history, for screenshots and for
// trying things out:  DATA_DIR=./demo-data node tools/seed-demo.mjs
// Never run it against your real data folder: it adds players and scores.

import path from 'node:path';
import fs from 'node:fs';

process.env.LOG_LEVEL ||= 'silent';
process.env.GAME_DOMAIN ||= 'example.com';
const dir = process.env.DATA_DIR || path.resolve('demo-data');
fs.mkdirSync(dir, { recursive: true });

const { openStore } = await import('../server/db.js');
const { Catalog } = await import('../server/catalog.js');
const { Players } = await import('../server/players.js');
const { Boards } = await import('../server/boards.js');
const { Arcade } = await import('../server/arcade.js');

const store = openStore(path.join(dir, 'arcade.db'));
if (store.one('SELECT COUNT(*) AS n FROM players').n > 0) {
  console.log(`${dir} already has players; leaving it alone.`);
  process.exit(0);
}
const catalog = new Catalog(store);
const players = new Players(store);
const boards = new Boards(store, catalog, players);
const arcade = new Arcade({ store, catalog, players, boards, hub: null });

const family = [
  { name: 'Dad', initials: 'DAD', color: '#4361ee', avatar: { body: 2, ears: 3, eyes: 1, mouth: 0, pattern: 1, feet: 2 } },
  { name: 'Mom', initials: 'MOM', color: '#3ddc97', avatar: { body: 1, ears: 1, eyes: 0, mouth: 3, pattern: 4, feet: 1 } },
  { name: 'Grandma', initials: 'GMA', color: '#b15cff', avatar: { body: 7, ears: 6, eyes: 3, mouth: 0, pattern: 4, feet: 1 } },
  { name: 'Sprout', initials: 'SPR', color: '#ffd23f', avatar: { body: 0, ears: 2, eyes: 1, mouth: 1, pattern: 1, feet: 1 } },
  { name: 'Uncle Ray', initials: 'RAY', color: '#ff6b35', avatar: { body: 5, ears: 4, eyes: 6, mouth: 5, pattern: 2, feet: 3 } },
];
const ids = {};
for (const f of family) ids[f.name] = players.create(f).id;

// Rewind the clock so the history spreads over the last few weeks.
const realNow = Date.now;
let fake = realNow() - 24 * 86_400_000;
Date.now = () => fake;
const step = (mins) => {
  fake += mins * 60_000;
};

const play = (who, game, value, board = 'score', meta) => {
  const s = arcade.startSession({ playerId: ids[who], gameId: game, deviceId: null });
  step(6 + Math.random() * 20);
  arcade.beat(s.id, null);
  if (value !== undefined) arcade.submitScore({ playerId: ids[who], gameId: game, boardId: board, value, meta });
  arcade.endSession(s.id, null);
  step(30 + Math.random() * 240);
};
const result = (who, game, outcome, meta) => {
  arcade.submitResult({ playerId: ids[who], gameId: game, outcome, meta });
  step(20 + Math.random() * 90);
};

play('Grandma', 'totem', 86_420);
play('Dad', 'totem', 64_310);
play('Sprout', 'chalkfall', 7, 'stars');
play('Dad', 'spacecadet', 1_284_500);
play('Mom', 'marbledrop', 3_420, 'total');
arcade.submitScore({ playerId: ids.Mom, gameId: 'marbledrop', boardId: 'solved', value: 6 });
play('Grandma', 'totem', 142_870);
result('Dad', 'swipe', 'win');
result('Mom', 'swipe', 'loss');
result('Sprout', 'swipe', 'loss');
step(60 * 20);
play('Sprout', 'nanosaur', 12_450);
play('Dad', 'nanosaur', 18_900);
play('Uncle Ray', 'spacecadet', 2_046_250);
result('Sprout', 'pazaak', 'win', { vs: 'bot', bot: 'easy' });
result('Sprout', 'pazaak', 'loss', { vs: 'bot', bot: 'normal' });
result('Dad', 'pazaak', 'win', { vs: 'bot', bot: 'hard' });
play('Mom', 'chalkfall', 21, 'stars');
arcade.submitScore({ playerId: ids.Mom, gameId: 'chalkfall', boardId: 'total', value: 18_650 });
step(60 * 30);
play('Grandma', 'totem', 211_340);
play('Dad', 'spacecadet', 2_311_750);
result('Mom', 'tradecraft', 'win');
result('Dad', 'tradecraft', 'loss');
result('Uncle Ray', 'tradecraft', 'win');
play('Sprout', 'chalkfall', 16, 'stars');
arcade.submitScore({ playerId: ids.Sprout, gameId: 'chalkfall', boardId: 'total', value: 12_900 });
step(60 * 40);
play('Mom', 'marbledrop', 9_870, 'total');
arcade.submitScore({ playerId: ids.Mom, gameId: 'marbledrop', boardId: 'solved', value: 14 });
play('Dad', 'marbledrop', 4_210, 'total');
arcade.submitScore({ playerId: ids.Dad, gameId: 'marbledrop', boardId: 'solved', value: 5 });
result('Grandma', 'swipe', 'win', { match: true });
result('Dad', 'swipe', 'loss');
play('Uncle Ray', 'nanosaur', 22_310);
play('Sprout', 'totem', 38_900);
step(60 * 20);
play('Dad', 'totem', 167_200);
play('Grandma', 'spacecadet', 905_000);
result('Sprout', 'pazaak', 'win', { vs: 'bot', bot: 'normal' });
result('Mom', 'swipe', 'win');
play('Mom', 'chalkfall', 33, 'stars');
arcade.submitScore({ playerId: ids.Mom, gameId: 'chalkfall', boardId: 'total', value: 31_400 });
step(60 * 12);
play('Grandma', 'totem', 256_780);

// A little shopping.
Date.now = realNow;
for (const [who, items] of Object.entries({ Grandma: ['crown', 'gold'], Sprout: ['propeller', 'shades'], Dad: ['headphones', 't-pinball'], Mom: ['wizard', 'neon'], 'Uncle Ray': ['cowboy'] })) {
  for (const item of items) {
    const p = players.row(ids[who]);
    const price = arcade.prizeById.get(item).price;
    if (p.tickets < price) arcade.award(ids[who], price - p.tickets + 15, 'demo');
    arcade.purchase(ids[who], item);
  }
}
const summary = players.list().map((p) => `${p.name} (${p.tickets} tickets, level ${p.level})`).join(', ');
console.log(`seeded ${dir}: ${summary}`);
store.close();
