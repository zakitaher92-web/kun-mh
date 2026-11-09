'use strict';
// KUN Maintenance & Housekeeping - local server entry point.
// The routes are in app.js; this file connects them to PostgreSQL and starts listening.
const { createPool, applySchema } = require('./db');
const { createApp } = require('./app');

const PORT = Number(process.env.PORT || 3100);   // 3000 is used by another app on the server
const HOST = process.env.HOST || '127.0.0.1';              // only this computer by default

async function main() {
  const pool = createPool();
  await applySchema(pool);
  const { app } = createApp(pool);
  const expire = () => pool.query('DELETE FROM sessions WHERE expires_at <= now()').catch(() => { });
  await expire();
  setInterval(expire, 3600000).unref();
  app.listen(PORT, HOST, () => console.log(`KUN MH server running at http://${HOST === '127.0.0.1' ? 'localhost' : HOST}:${PORT}`));
}

if (require.main === module) {
  main().catch(e => {
    console.error('Could not start the server:', e.message);
    console.error('Check the DB_* settings in server/.env and that PostgreSQL is running.');
    process.exit(1);
  });
}

module.exports = { main };
