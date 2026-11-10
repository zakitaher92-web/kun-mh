'use strict';
// PostgreSQL connection pool and schema set-up.
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

// Connection settings from server/.env (shared by the pool and the live-update listener).
// DATABASE_URL (used on Vercel with Neon) takes precedence over the DB_* settings.
// DB_SSL=require turns on TLS, which Neon needs.
function connectionConfig() {
  const ssl = process.env.DB_SSL === 'require' ? { rejectUnauthorized: true } : undefined;
  if (process.env.DATABASE_URL) return { connectionString: process.env.DATABASE_URL, ssl };
  return {
    ssl,
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 5433),
    user: process.env.DB_USER || 'kunmh',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'kun_mh',
  };
}

function createPool() {
  // Serverless hosts (Vercel) need a small pool per instance; a server keeps 10.
  const pool = new Pool({ ...connectionConfig(), max: Number(process.env.DB_POOL_MAX || 10) });
  // an idle connection that drops must not stop the server
  pool.on('error', e => console.error('Database connection problem:', e.message));
  return pool;
}

// Runs schema.sql (all statements in one call; they are idempotent).
async function applySchema(pool) {
  const sql = fs.readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf8');
  await pool.query(sql);
}

module.exports = { createPool, applySchema, connectionConfig };
