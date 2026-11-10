'use strict';
// Vercel entry point. Every request goes to one Express app (server/src/app.js).
// The schema is applied once per instance, on the first request.
const { createPool, applySchema } = require('../server/src/db');
const { createApp } = require('../server/src/app');

const pool = createPool();
const { app } = createApp(pool);
let ready = null;

module.exports = async (req, res) => {
  ready = ready || applySchema(pool).catch(e => { ready = null; throw e; });
  await ready;
  return app(req, res);
};
