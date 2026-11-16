// SQLite storage (node:sqlite, built into Node 22+). One file: DATA_DIR/arcade.db.
//
// Everything the arcade remembers lives here: players and their critters,
// which device is playing as whom, play sessions, every score and result,
// achievements, the ticket ledger and the prize counter's inventory.

import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { config, log } from './config.js';

const MIGRATIONS = [
  // 1: the first schema
  `
  CREATE TABLE players (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    initials TEXT NOT NULL,
    color TEXT NOT NULL,
    avatar TEXT NOT NULL,
    equipped TEXT NOT NULL DEFAULT '{}',
    pin_hash TEXT,
    tickets INTEGER NOT NULL DEFAULT 0,
    lifetime INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    last_played_at INTEGER,
    hidden INTEGER NOT NULL DEFAULT 0
  );
  CREATE UNIQUE INDEX players_name ON players(name COLLATE NOCASE);

  CREATE TABLE devices (
    id TEXT PRIMARY KEY,
    player_id TEXT REFERENCES players(id) ON DELETE SET NULL,
    trusted TEXT NOT NULL DEFAULT '[]',
    label TEXT,
    ua TEXT,
    kiosk INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    last_seen INTEGER NOT NULL
  );

  CREATE TABLE sessions (
    id TEXT PRIMARY KEY,
    player_id TEXT REFERENCES players(id) ON DELETE CASCADE,
    game_id TEXT NOT NULL,
    device_id TEXT,
    source TEXT NOT NULL,
    started_at INTEGER NOT NULL,
    last_beat INTEGER NOT NULL,
    ended_at INTEGER
  );
  CREATE INDEX sessions_player ON sessions(player_id, started_at);
  CREATE INDEX sessions_game ON sessions(game_id, started_at);

  CREATE TABLE scores (
    id INTEGER PRIMARY KEY,
    player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    game_id TEXT NOT NULL,
    board_id TEXT NOT NULL,
    value REAL NOT NULL,
    meta TEXT,
    session_id TEXT,
    source TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX scores_board ON scores(game_id, board_id, value);
  CREATE INDEX scores_player ON scores(player_id, game_id, board_id);
  CREATE INDEX scores_time ON scores(created_at);

  CREATE TABLE results (
    id INTEGER PRIMARY KEY,
    player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    game_id TEXT NOT NULL,
    outcome TEXT NOT NULL,
    meta TEXT,
    session_id TEXT,
    source TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX results_game ON results(game_id, player_id);
  CREATE INDEX results_time ON results(created_at);

  CREATE TABLE achievements (
    player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    achievement_id TEXT NOT NULL,
    unlocked_at INTEGER NOT NULL,
    PRIMARY KEY (player_id, achievement_id)
  );

  CREATE TABLE ledger (
    id INTEGER PRIMARY KEY,
    player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    delta INTEGER NOT NULL,
    reason TEXT NOT NULL,
    ref TEXT,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX ledger_player ON ledger(player_id, created_at);

  CREATE TABLE inventory (
    player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    item_id TEXT NOT NULL,
    acquired_at INTEGER NOT NULL,
    PRIMARY KEY (player_id, item_id)
  );

  CREATE TABLE events (
    id INTEGER PRIMARY KEY,
    type TEXT NOT NULL,
    player_id TEXT REFERENCES players(id) ON DELETE CASCADE,
    game_id TEXT,
    data TEXT,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX events_time ON events(created_at);

  CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  `,
];

export class Store {
  constructor(file) {
    this.file = file;
    if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
    this.db = new DatabaseSync(file);
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 3000;');
    this.cache = new Map();
    this.migrate();
  }

  migrate() {
    this.db.exec('CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT)');
    const row = this.db.prepare("SELECT value FROM meta WHERE key = 'schema'").get();
    let version = row ? Number(row.value) : 0;
    while (version < MIGRATIONS.length) {
      this.tx(() => {
        this.db.exec(MIGRATIONS[version]);
        version += 1;
        this.db.prepare("INSERT INTO meta (key, value) VALUES ('schema', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(String(version));
      });
      log.info(`database schema is at version ${version}`);
    }
  }

  stmt(sql) {
    let s = this.cache.get(sql);
    if (!s) {
      s = this.db.prepare(sql);
      this.cache.set(sql, s);
    }
    return s;
  }

  one(sql, ...params) {
    const row = this.stmt(sql).get(...params);
    return row ? { ...row } : undefined;
  }

  all(sql, ...params) {
    return this.stmt(sql).all(...params).map((r) => ({ ...r }));
  }

  run(sql, ...params) {
    return this.stmt(sql).run(...params);
  }

  /** Runs fn inside a transaction (nested calls join the outer one). */
  tx(fn) {
    if (this.inTx) return fn();
    this.inTx = true;
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const out = fn();
      this.db.exec('COMMIT');
      return out;
    } catch (e) {
      try {
        this.db.exec('ROLLBACK');
      } catch {
        /* already rolled back */
      }
      throw e;
    } finally {
      this.inTx = false;
    }
  }

  getSetting(key, fallback = null) {
    const row = this.one('SELECT value FROM settings WHERE key = ?', key);
    if (!row) return fallback;
    try {
      return JSON.parse(row.value);
    } catch {
      return fallback;
    }
  }

  setSetting(key, value) {
    if (value === undefined || value === null) {
      this.run('DELETE FROM settings WHERE key = ?', key);
      return;
    }
    this.run(
      'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      key,
      JSON.stringify(value),
    );
  }

  close() {
    this.db.close();
  }
}

export function openStore(file = path.join(config.dataDir, 'arcade.db')) {
  return new Store(file);
}

export const parseJson = (text, fallback) => {
  if (text === null || text === undefined || text === '') return fallback;
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
};
