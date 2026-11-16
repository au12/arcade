// au12 Arcade: one portal for every game on the shelf.

import { config, log } from './config.js';
import { createApp, checkWebBuild } from './app.js';

if (process.argv.includes('-healthcheck')) {
  const res = await fetch(`http://127.0.0.1:${config.port}/healthz`).catch(() => null);
  process.exit(res && res.ok ? 0 : 1);
}

checkWebBuild();
const app = createApp();
app.server.listen(config.port, config.host, () => {
  const games = app.catalog.enabled();
  log.info(`${config.arcadeName} ${config.version} listening on http://${config.host}:${config.port}`);
  log.info(`${games.length} game(s) ready: ${games.map((g) => g.id).join(', ') || 'none (set GAME_DOMAIN or add game URLs in /admin)'}`);
  const missing = app.catalog.games.filter((g) => g.enabled && !g.url).map((g) => g.id);
  if (missing.length) log.info(`no address yet for: ${missing.join(', ')}`);
  if (!config.adminPassword) log.info('the admin page is off (set ADMIN_PASSWORD to turn it on)');
});

let closing = false;
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, async () => {
    if (closing) return;
    closing = true;
    log.info(`${sig}: closing`);
    await app.close();
    process.exit(0);
  });
}
