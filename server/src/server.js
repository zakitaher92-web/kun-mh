'use strict';
// KUN Maintenance & Housekeeping - local server entry point.
// The routes are in app.js; this file connects them to PostgreSQL and starts listening.
const { EventEmitter } = require('events');
const { Client } = require('pg');
const { createPool, applySchema, connectionConfig } = require('./db');
const { createApp } = require('./app');

const PORT = Number(process.env.PORT || 3100);   // 3000 is used by another app on the server
const HOST = process.env.HOST || '127.0.0.1';              // only this computer by default
const CHANNEL = 'kun_mh_changes';
const RECONNECT_MS = 3000;

// Live updates (finding 4): one dedicated connection LISTENs on the change channel and passes each
// notice to the application. It reconnects by itself if the connection drops.
function startListener(notifier) {
  const client = new Client(connectionConfig());
  client.on('notification', msg => notifier.emit('notification', msg));
  client.on('error', e => {
    console.error('Live-update connection lost, reconnecting:', e.message);
    client.end().catch(() => { });
    setTimeout(() => startListener(notifier), RECONNECT_MS).unref();
  });
  return client.connect()
    .then(() => client.query(`LISTEN ${CHANNEL}`))
    .catch(e => {
      console.error('Live-update connection failed, retrying:', e.message);
      client.end().catch(() => { });
      setTimeout(() => startListener(notifier), RECONNECT_MS).unref();
    });
}

async function main() {
  const pool = createPool();
  await applySchema(pool);
  const notifier = new EventEmitter();
  // LIVE_UPDATES=off on serverless hosts (Vercel): a LISTEN connection cannot stay open there.
  if (process.env.LIVE_UPDATES !== 'off') await startListener(notifier);
  else console.log('Live updates are off (LIVE_UPDATES=off)');
  const { app } = createApp(pool, { notifier });
  const expire = () => pool.query('DELETE FROM sessions WHERE expires_at <= now()').catch(() => { });
  await expire();
  setInterval(expire, 3600000).unref();
  app.listen(PORT, HOST, () => console.log(`KUN MH server running at http://${HOST === '127.0.0.1' ? 'localhost' : HOST}:${PORT} (data: ${process.env.DATA_MODE || 'kv'})`));
}

if (require.main === module) {
  main().catch(e => {
    console.error('Could not start the server:', e.message);
    console.error('Check the DB_* settings in server/.env and that PostgreSQL is running.');
    process.exit(1);
  });
}

module.exports = { main, startListener };
