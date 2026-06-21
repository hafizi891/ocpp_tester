'use strict';

require('dotenv').config();

const fs   = require('fs');
const path = require('path');
const pool = require('./pool');

const STATE_FILE = path.join(__dirname, '../data/cpms-state.json');

const FALLBACK_STATE = {
  chargers: [],
  sessions: [],
  hourlyEnergy: [2,1,1,0,1,2,9,24,38,44,40,32,30,34,38,42,55,60,50,38,24,15,8,4],
};

function readState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8').replace(/^﻿/, ''));
  } catch {
    console.warn('cpms-state.json not found, using fallback seed data.');
    return FALLBACK_STATE;
  }
}

async function seed() {
  const { rows: [{ count }] } = await pool.query('SELECT COUNT(*)::int AS count FROM chargers');
  if (count > 0) {
    console.log(`Database already has ${count} charger(s) — skipping seed.`);
    await pool.end();
    return;
  }

  const state = readState();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    for (const c of state.chargers) {
      await client.query(
        `INSERT INTO chargers (id, station, status, kw, max_kw, ocpp_identity)
         VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING`,
        [c.id, c.station, c.status, c.kw, c.maxKw, c.ocppIdentity]
      );
    }

    for (const s of state.sessions) {
      await client.query(
        `INSERT INTO sessions (id, charger_id, user_name, started_at, energy_kwh, amount, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING`,
        [s.id, s.chargerId, s.user, s.startedAt, s.energyKwh, s.amount, s.status]
      );
    }

    if (state.sessions.length > 0) {
      await client.query(`SELECT setval('sessions_id_seq', (SELECT MAX(id) FROM sessions))`);
    }

    const kwh = state.hourlyEnergy || FALLBACK_STATE.hourlyEnergy;
    for (let hour = 0; hour < 24; hour++) {
      await client.query(
        `INSERT INTO hourly_energy (hour, kwh)
         VALUES ($1,$2) ON CONFLICT (hour) DO UPDATE SET kwh = EXCLUDED.kwh, updated_at = NOW()`,
        [hour, kwh[hour] ?? 0]
      );
    }

    await client.query('COMMIT');
    console.log(`Seeded ${state.chargers.length} charger(s), ${state.sessions.length} session(s).`);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

seed().catch(err => {
  console.error('Seed failed:', err.message);
  process.exit(1);
});
