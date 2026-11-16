// Small HTTP helpers: JSON in and out, cookies, client addresses, rate
// limits and static files (with precompressed .br / .gz siblings).

import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { config } from './config.js';

export const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.webmanifest': 'application/manifest+json',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
};

export class HttpError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

export function send(res, status, body, headers = {}) {
  if (res.headersSent) return;
  const isText = typeof body === 'string' || Buffer.isBuffer(body);
  const data = isText ? body : JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': isText ? 'text/plain; charset=utf-8' : 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(data);
}

export function readBody(req, limit = 16 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new HttpError(413, 'That is too big.'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

export async function readJson(req, limit) {
  const raw = await readBody(req, limit);
  if (!raw.trim()) return {};
  try {
    const v = JSON.parse(raw);
    if (v === null || typeof v !== 'object') throw new Error('not an object');
    return v;
  } catch {
    throw new HttpError(400, 'Expected a JSON object.');
  }
}

export function parseCookies(req) {
  const out = {};
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    if (!k) continue;
    try {
      out[k] = decodeURIComponent(part.slice(i + 1).trim());
    } catch {
      out[k] = part.slice(i + 1).trim();
    }
  }
  return out;
}

export function cookie(name, value, { maxAge, secure, httpOnly = true, sameSite = 'Lax', path: p = '/' } = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`, `Path=${p}`, `SameSite=${sameSite}`];
  if (maxAge !== undefined) parts.push(`Max-Age=${Math.floor(maxAge)}`);
  if (httpOnly) parts.push('HttpOnly');
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

const cleanIp = (raw) => {
  const ip = String(raw ?? '').trim().replace(/^::ffff:/i, '');
  return net.isIP(ip) ? ip : '';
};

export function isPrivate(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254) || (a === 100 && b >= 64 && b <= 127);
  }
  return ip === '::1' || /^f[cd]/i.test(ip) || /^fe[89ab]/i.test(ip);
}

const viaProxy = (req) => config.trustProxy > 0 && (config.trustAnyProxy || isPrivate(cleanIp(req.socket.remoteAddress)));

export function clientIp(req) {
  const direct = cleanIp(req.socket.remoteAddress) || 'unknown';
  if (!viaProxy(req)) return direct;
  const chain = String(req.headers['x-forwarded-for'] || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (!chain.length) return direct;
  return cleanIp(chain[Math.max(0, chain.length - config.trustProxy)]) || direct;
}

export function isHttps(req) {
  if (req.socket.encrypted) return true;
  return viaProxy(req) && String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https';
}

/** The origin this request was addressed to, as the browser sees it. */
export function ownOrigin(req) {
  if (config.publicUrl) {
    try {
      return new URL(config.publicUrl).origin;
    } catch {
      /* fall through */
    }
  }
  const host = (viaProxy(req) && String(req.headers['x-forwarded-host'] || '').split(',')[0].trim()) || req.headers.host || 'localhost';
  return `${isHttps(req) ? 'https' : 'http'}://${host}`;
}

/** Fixed-window limiter: `limit` hits per `windowMs` per key. */
export function limiter(limit, windowMs) {
  const hits = new Map();
  const t = setInterval(() => hits.clear(), windowMs);
  t.unref();
  return (key) => {
    const n = (hits.get(key) ?? 0) + 1;
    hits.set(key, n);
    return n <= limit;
  };
}

/**
 * Serves a file from `root`. Long cache for content-hashed names
 * (name.abcdef12.ext), no-cache for everything else.
 */
export function serveFile(req, res, root, rel, extraHeaders = {}) {
  const safe = path.normalize(`/${rel}`).replace(/^(\.\.[/\\])+/, '');
  const file = path.join(root, safe);
  if (!file.startsWith(path.resolve(root))) return false;
  let stat;
  try {
    stat = fs.statSync(file);
  } catch {
    return false;
  }
  if (!stat.isFile()) return false;
  const ext = path.extname(file).toLowerCase();
  const hashed = /\.[0-9a-z]{8,}\.(js|css|woff2|png|svg|jpg|webp)$/i.test(file);
  const headers = {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Cache-Control': hashed ? 'public, max-age=31536000, immutable' : 'no-cache',
    ETag: `"${stat.size.toString(36)}-${Math.floor(stat.mtimeMs).toString(36)}"`,
    ...extraHeaders,
  };
  if (req.headers['if-none-match'] === headers.ETag) {
    res.writeHead(304, headers);
    res.end();
    return true;
  }
  const accept = String(req.headers['accept-encoding'] || '');
  let body = file;
  if (/\bbr\b/.test(accept) && fs.existsSync(`${file}.br`)) {
    body = `${file}.br`;
    headers['Content-Encoding'] = 'br';
    headers.Vary = 'Accept-Encoding';
  } else if (/\bgzip\b/.test(accept) && fs.existsSync(`${file}.gz`)) {
    body = `${file}.gz`;
    headers['Content-Encoding'] = 'gzip';
    headers.Vary = 'Accept-Encoding';
  }
  res.writeHead(200, headers);
  if (req.method === 'HEAD') {
    res.end();
    return true;
  }
  fs.createReadStream(body).pipe(res);
  return true;
}
