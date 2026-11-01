'use strict';
// PostgreSQL connection pool and schema set-up.
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

function createPool() {
  const pool = new Pool({
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 5432),
    user: process.env.DB_USER || 'kunmh',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'kun_mh',
    max: 10,
  });
  // an idle connection that drops must not stop the server
  pool.on('error', e => console.error('Database connection problem:', e.message));
  return pool;
}

// Runs schema.sql (all statements in one call; they are idempotent).
async function applySchema(pool) {
  const sql = fs.readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf8');
  await pool.query(sql);
}

module.exports = { createPool, applySchema };
