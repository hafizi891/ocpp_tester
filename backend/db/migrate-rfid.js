'use strict';

/**
 * One-time migration: copies id_tags from PostgreSQL → local SQLite.
 *
 * On the RPi:
 *   npm install pg          (temporarily)
 *   node db/migrate-rfid.js
 *   npm uninstall pg
 */

require('dotenv').config();

let Pool;
try {
  Pool = require('pg').Pool;
} catch {
  console.error('pg not installed. Run: npm install pg');
  process.exit(1);
}

const db = require('./pool');

const pgConfig = process.env.DB_HOST
  ? {
      host:     process.env.DB_HOST,
      port:     Number(process.env.DB_PORT) || 5432,
      database: process.env.DB_NAME || 'cpms',
      user:     process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      ssl:      process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : false,
    }
  : { connectionString: process.env.DATABASE_URL };

async function main() {
  const pool = new Pool(pgConfig);

  console.log('Connecting to PostgreSQL...');
  const { rows } = await pool.query('SELECT * FROM id_tags ORDER BY id_tag');
  console.log(`Found ${rows.length} RFID tag(s)`);

  const insert = db.prepare(`
    INSERT INTO id_tags (id_tag, status, expiry_date, parent_id_tag, note)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(id_tag) DO UPDATE SET
      status        = excluded.status,
      expiry_date   = excluded.expiry_date,
      parent_id_tag = excluded.parent_id_tag,
      note          = excluded.note,
      updated_at    = datetime('now')
  `);

  let count = 0;
  for (const row of rows) {
    insert.run(
      row.id_tag,
      row.status || 'Accepted',
      row.expiry_date ?? null,
      row.parent_id_tag ?? null,
      row.note ?? null,
    );
    console.log(`  ✓ ${row.id_tag}  (${row.status})`);
    count++;
  }

  await pool.end();
  console.log(`\nDone — ${count} tag(s) migrated to SQLite.`);
}

main().catch(err => {
  console.error('Migration failed:', err.message);
  process.exit(1);
});
