'use strict';
// Local test server: the real app and routes on an in-memory database (no PostgreSQL needed).
// Use it only to try the screens. Data is lost when it stops. Not for the live system.
//   node testing/dev-server.js        -> http://127.0.0.1:3110
const { createApp } = require('../src/app');
const { createFakePool, hash } = require('./fake-pool');

const PORT = Number(process.env.TEST_PORT || 3110);
const PASSWORD = 'test-pass-123';
const pool = createFakePool({
  accounts: [
    { id: 'a-adm', email: 'hoa@test.local', name: 'Head of Accounts', password_hash: hash(PASSWORD) },
    { id: 'a-grn', email: 'grn@test.local', name: 'GRN Officer', password_hash: hash(PASSWORD) },
  ],
  kv: {
    'm_users|all': {
      rows: {
        HOA: { o: 0, r: { id: 'HOA', name: 'Head of Accounts', desig: 'Head of Accounts', role: 'Admin', cid: 'a-adm', active: 'Y', email: 'hoa@test.local' } },
        GRN: { o: 1, r: { id: 'GRN', name: 'GRN Officer', desig: 'GRN Officer', role: 'GRN Officer', cid: 'a-grn', active: 'Y', email: 'grn@test.local' } },
      },
    },
  },
});
// Log-in is switched off for local testing: every request acts as the Head of Accounts (Admin).
const DEV_USER = { id: 'a-adm', email: 'hoa@test.local', name: 'Head of Accounts' };
const { app } = createApp(pool, { cookieSecure: false, devUser: DEV_USER });
app.listen(PORT, '127.0.0.1', () => console.log(`test server on http://127.0.0.1:${PORT} (password for both accounts: ${PASSWORD})`));
