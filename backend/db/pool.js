'use strict';

const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs   = require('fs');

const DATA_DIR = path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const DB_PATH = process.env.SQLITE_PATH || path.join(DATA_DIR, 'cpms.db');

const db = new DatabaseSync(DB_PATH);

// WAL + normal sync — safe and fast for single-process RPi app
db.exec("PRAGMA journal_mode = WAL");
db.exec("PRAGMA synchronous = NORMAL");
db.exec("PRAGMA foreign_keys = ON");

// ── Schema (idempotent) ────────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS chargers (
    id            TEXT PRIMARY KEY,
    station       TEXT NOT NULL DEFAULT 'Discovered',
    status        TEXT NOT NULL DEFAULT 'idle',
    kw            REAL NOT NULL DEFAULT 0,
    max_kw        REAL NOT NULL DEFAULT 22,
    ocpp_identity TEXT NOT NULL DEFAULT '',
    created_at    TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS sessions (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    charger_id      TEXT    NOT NULL,
    user_name       TEXT    NOT NULL DEFAULT '',
    started_at      TEXT    NOT NULL DEFAULT '',
    energy_kwh      REAL    NOT NULL DEFAULT 0,
    amount          REAL    NOT NULL DEFAULT 0,
    status          TEXT    NOT NULL DEFAULT 'charging',
    transaction_id  INTEGER,
    id_tag          TEXT,
    connector_id    INTEGER NOT NULL DEFAULT 1,
    meter_start     INTEGER NOT NULL DEFAULT 0,
    meter_stop      INTEGER,
    stop_reason     TEXT,
    created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS hourly_energy (
    hour        INTEGER PRIMARY KEY,
    kwh         REAL    NOT NULL DEFAULT 0,
    updated_at  TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS id_tags (
    id_tag        TEXT PRIMARY KEY,
    status        TEXT NOT NULL DEFAULT 'Accepted',
    expiry_date   TEXT,
    parent_id_tag TEXT,
    note          TEXT,
    created_at    TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS reservations (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    reservation_id INTEGER NOT NULL UNIQUE,
    charger_id     TEXT    NOT NULL,
    connector_id   INTEGER NOT NULL DEFAULT 1,
    id_tag         TEXT    NOT NULL,
    expiry_date    TEXT    NOT NULL,
    status         TEXT    NOT NULL DEFAULT 'active',
    created_at     TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS ocpp_event_log (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    charger_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    status     TEXT NOT NULL,
    payload    TEXT NOT NULL DEFAULT '{}',
    ts         TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS charging_profiles (
    id                       INTEGER PRIMARY KEY AUTOINCREMENT,
    charger_id               TEXT    NOT NULL,
    connector_id             INTEGER NOT NULL DEFAULT 0,
    charging_profile_id      INTEGER NOT NULL,
    stack_level              INTEGER NOT NULL DEFAULT 0,
    charging_profile_purpose TEXT    NOT NULL,
    charging_profile_kind    TEXT    NOT NULL,
    recurrency_kind          TEXT,
    valid_from               TEXT,
    valid_to                 TEXT,
    schedule                 TEXT    NOT NULL DEFAULT '{}',
    created_at               TEXT    NOT NULL DEFAULT (datetime('now')),
    UNIQUE(charger_id, connector_id, charging_profile_id)
  );

  CREATE TABLE IF NOT EXISTS ocpp_commands (
    id              TEXT PRIMARY KEY,
    ocpp_message_id TEXT NOT NULL,
    charge_point_id TEXT NOT NULL,
    action          TEXT NOT NULL,
    payload         TEXT NOT NULL DEFAULT '{}',
    status          TEXT NOT NULL DEFAULT 'pending',
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    sent_at         TEXT,
    response_at     TEXT,
    response        TEXT
  );

  CREATE TABLE IF NOT EXISTS ocpp_messages (
    id              TEXT PRIMARY KEY,
    ts              TEXT NOT NULL DEFAULT (datetime('now')),
    charge_point_id TEXT NOT NULL,
    direction       TEXT NOT NULL,
    action          TEXT NOT NULL,
    payload         TEXT NOT NULL DEFAULT '{}',
    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS car_profiles (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT NOT NULL,
    max_kw     REAL NOT NULL,
    phases     INTEGER NOT NULL DEFAULT 3,
    color      TEXT NOT NULL DEFAULT '#6366f1',
    schedule   TEXT NOT NULL DEFAULT '{"type":"always"}',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

// Seed hourly_energy rows 0-23 on first run
const hourCount = db.prepare('SELECT COUNT(*) AS n FROM hourly_energy').get().n;
if (hourCount === 0) {
  const ins = db.prepare('INSERT OR IGNORE INTO hourly_energy (hour, kwh) VALUES (?, 0)');
  for (let h = 0; h < 24; h++) ins.run(h);
}

console.log(`[db] SQLite  ${DB_PATH}`);

module.exports = db;
