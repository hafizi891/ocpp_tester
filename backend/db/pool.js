'use strict';

const { Pool } = require('pg');

// Accepts either individual parts OR a full DATABASE_URL (individual parts take priority)
const config = process.env.DB_HOST
  ? {
      host:     process.env.DB_HOST,
      port:     Number(process.env.DB_PORT)     || 5432,
      database: process.env.DB_NAME             || 'cpms',
      user:     process.env.DB_USER,
      password: process.env.DB_PASSWORD,
    }
  : {
      connectionString: process.env.DATABASE_URL,
    };

const pool = new Pool({
  ...config,
  ssl:                    process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : false,
  max:                    Number(process.env.DB_POOL_MAX)          || 10,
  idleTimeoutMillis:      Number(process.env.DB_IDLE_TIMEOUT_MS)   || 30000,
  connectionTimeoutMillis: Number(process.env.DB_CONNECT_TIMEOUT_MS) || 5000,
});

pool.on('error', (err) => {
  console.error('Unexpected error on idle DB client:', err.message);
});

module.exports = pool;
