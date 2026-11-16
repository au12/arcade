// All configuration comes from environment variables, so the same image runs
// anywhere. Every value has a sensible default.

import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const env = process.env;

const int = (name, fallback, min, max) => {
  const n = Number.parseInt(env[name] ?? '', 10);
  if (Number.isNaN(n)) return fallback;
  return Math.max(min, Math.min(max, n));
};

const bool = (name, fallback) => {
  const v = String(env[name] ?? '').trim().toLowerCase();
  if (!v) return fallback;
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
};

const cleanUrl = (value) => String(value ?? '').trim().replace(/\/+$/, '');

export const config = {
  root,
  host: env.HOST || '0.0.0.0',
  port: int('PORT', 8080, 1, 65535),
  // Shown in the header, the attract loop and the installed app's name.
  arcadeName: (env.ARCADE_NAME || 'au12 Arcade').slice(0, 40),
  // The public address of this arcade (https://arcade.example.com). Used for
  // QR codes and links; if empty, the address the browser used is taken.
  publicUrl: cleanUrl(env.PUBLIC_URL),
  // Games are reached at their own subdomains. A game whose URL isn't set in
  // the admin page or by GAME_<ID>_URL gets https://<id>.<GAME_DOMAIN>.
  gameDomain: String(env.GAME_DOMAIN || '').trim().replace(/^\.+|\.+$/g, ''),
  webDir: env.WEB_DIR || path.join(root, 'web', 'dist'),
  catalogDir: env.CATALOG_DIR || path.join(root, 'catalog'),
  dataDir: env.DATA_DIR || path.join(root, 'data'),
  // The admin page at /admin. Left empty, the page is switched off.
  adminPassword: env.ADMIN_PASSWORD || '',
  adminSessionHours: int('ADMIN_SESSION_HOURS', 12, 1, 24 * 30),
  // Anyone who can open the arcade can add a player. Set false to make new
  // players an admin-only job.
  openSignup: bool('OPEN_SIGNUP', true),
  maxPlayers: int('MAX_PLAYERS', 64, 1, 1000),
  // How many reverse proxies sit in front of the server (Nginx Proxy Manager
  // is one). Decides which X-Forwarded-For entry is believed for rate limits.
  trustProxy: int('TRUST_PROXY', 1, 0, 10),
  trustAnyProxy: bool('TRUST_PROXY_ANY', false),
  // Extra origins (comma separated) allowed to post scores straight to the
  // API, besides the games in the catalog. For games hosted somewhere odd.
  extraOrigins: String(env.EXTRA_ORIGINS || '')
    .split(',')
    .map((s) => cleanUrl(s))
    .filter(Boolean),
  logLevel: env.LOG_LEVEL || 'info',
  version: env.VERSION || 'dev',
};

export const log = {
  info: (...a) => config.logLevel !== 'silent' && console.log(new Date().toISOString(), ...a),
  warn: (...a) => config.logLevel !== 'silent' && console.warn(new Date().toISOString(), 'WARN', ...a),
  debug: (...a) => config.logLevel === 'debug' && console.log(new Date().toISOString(), 'DEBUG', ...a),
};
