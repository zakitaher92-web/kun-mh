/* ---- server-adapter.js ----
   Local server host: the records live in PostgreSQL behind server/src/server.js.
   This file gives the app the interface it uses for its data (window.kunBackend.use('db' | 'user')),
   so the rest of index.html works unchanged. It is injected into index.html by the server. */
(function () {
  window.KUN_HOST = 'server';

  const enc = encodeURIComponent;
  const snap = (id, r) => ({
    id, exists: !!(r && r.exists), data: () => (r && r.exists ? JSON.parse(JSON.stringify(r.data)) : undefined),
    metadata: { fromCache: false, hasPendingWrites: false },
  });
  const toSnap = docs => ({
    docs: docs.map(d => snap(d.id, { exists: true, data: d.data })), size: docs.length, empty: !docs.length,
    docChanges: () => [], metadata: { fromCache: false, hasPendingWrites: false },
  });

  let me = null;
  let resolveUser; const signedIn = new Promise(r => { resolveUser = r; });

  // One request to the server. Errors carry a code the app understands (invalid_argument, unavailable, revoked ...).
  async function api(method, url, body, quietAuth) {
    let res;
    try {
      res = await fetch(url, {
        method, credentials: 'same-origin',
        headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    } catch (e) { throw { code: 'unavailable', message: e.message }; }
    if (res.status === 401 && !quietAuth) { me = null; showLogin(); throw { code: 'revoked', message: 'Your log-in has ended. Log in again.' }; }
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw { code: j.code || (res.status >= 500 ? 'unavailable' : 'invalid_argument'), message: j.error || res.statusText };
    return j;
  }

  /* ----- live updates: the server says which collection changed; we re-read it ----- */
  const listeners = new Map();   // collection -> Set of { next, err }
  let stream = null, streamOpened = false;
  function ensureStream() {
    if (stream || typeof EventSource === 'undefined') return;
    stream = new EventSource('/api/events');
    stream.addEventListener('change', ev => refresh(JSON.parse(ev.data).coll));
    stream.onopen = () => { if (streamOpened) [...listeners.keys()].forEach(c => refresh(c)); streamOpened = true; };
  }
  async function refresh(coll, only) {
    const targets = only || [...(listeners.get(coll) || [])];
    if (!targets.length) return;
    try {
      const r = await api('GET', '/api/docs/' + enc(coll));
      targets.forEach(l => l.next(toSnap(r.docs)));
    } catch (e) { if (e.code !== 'revoked') targets.forEach(l => l.err && l.err(e)); }   // 'revoked' already shows the log-in page
  }
  function listen(coll, next, err) {
    const l = { next, err };
    if (!listeners.has(coll)) listeners.set(coll, new Set());
    listeners.get(coll).add(l);
    ensureStream();
    refresh(coll, [l]);
    return () => listeners.get(coll).delete(l);
  }

  /* ----- documents ----- */
  const docRef = (coll, id) => {
    const url = '/api/docs/' + enc(coll) + '/' + enc(id);
    return {
      id, path: coll + '/' + id,
      get: () => api('GET', url).then(r => snap(id, r)),
      set: data => api('PUT', url, { data, merge: false }).then(() => { }),
      update: data => api('PUT', url, { data, merge: true }).then(() => { }),   // nested merge, arrays replaced
      delete: () => api('DELETE', url).then(() => { }),
      acquire: o => api('POST', '/api/lease', { coll, id, holder: o.holder, ttlMs: o.ttlMs }),
      onSnapshot: (next, err) => listen(coll, docs => {
        const d = docs.docs.find(x => x.id === id);
        next(snap(id, d ? { exists: true, data: d.data() } : { exists: false }));
      }, err),
    };
  };
  const colRef = coll => ({
    path: coll,
    doc: id => docRef(coll, id),
    get: () => api('GET', '/api/docs/' + enc(coll)).then(r => toSnap(r.docs)),
    onSnapshot: (next, err) => listen(coll, next, err),
  });

  /* ----- people and the signed-in user ----- */
  const prof = (id, p) => ({ id, name: (p && (p.name || p.email)) || '', email: (p && p.email) || null, avatarUrl: '', color: '#6b7a74', isMe: !!me && id === me.id, guest: false });
  const userApi = {
    me: async () => ({ id: me.id, name: me.name || me.email || '', email: me.email, avatarUrl: '', color: '#6b7a74', isOwner: false, canEdit: true }),
    id: async () => (me ? me.id : null),
    isOwner: async () => false, canEdit: async () => true, can: async () => true,
    profiles: async ids => {
      const list = [].concat(ids);
      const r = await api('GET', '/api/people?ids=' + enc(list.join(',')));
      return Object.fromEntries(list.map(i => [i, prof(i, r.people[i])]));
    },
    search: async q => {
      const r = await api('GET', '/api/people?q=' + enc(q || ''));
      return r.people.map(p => prof(p.id, p));
    },
  };

  /* ----- log-in page ----- */
  function showLogin() {
    const app = document.getElementById('app'); if (!app) return setTimeout(showLogin, 50);
    app.innerHTML = `<div class="login"><form class="lcard" id="svForm">
      <div class="lbrand">Faiz E Husaini - Karbala (KUN)</div><h1>Maintenance &amp; Housekeeping</h1>
      <p class="muted">Log in with the email and password given to you by the Head of Accounts.</p>
      <label for="svEmail">Email</label><input id="svEmail" type="email" autocomplete="username" required>
      <label for="svPw">Password</label><input id="svPw" type="password" autocomplete="current-password" required>
      <div id="svErr" class="err"></div>
      <button class="btn pri full" type="submit">Log in</button>
      <ul class="notes"><li>Accounts are created by the Head of Accounts. There is no self sign-up.</li><li>Records are saved in the organisation's database and shared live with every user.</li></ul></form></div>`;
    const err = m => { document.getElementById('svErr').textContent = m; };
    document.getElementById('svForm').onsubmit = async e => {
      e.preventDefault(); err('');
      try {
        await api('POST', '/api/login', {
          email: document.getElementById('svEmail').value.trim(),
          password: document.getElementById('svPw').value,
        }, true);
        location.reload();
      } catch (x) { err(x.code === 'unavailable' ? 'Could not reach the server. Check that it is running.' : x.message); }
    };
  }

  window.kunSignOut = () => fetch('/api/logout', { method: 'POST', credentials: 'same-origin' }).finally(() => location.reload());
  // The app draws its "Loading" card before it asks for the database (use below). The log-in page must be
  // drawn after that, otherwise the loading card would replace it and wait for ever.
  let askedForDb = false, needLogin = false;
  window.kunBackend = {
    use: async name => {
      askedForDb = true;
      if (needLogin) showLogin();
      await signedIn;
      // the app asks for documents by full path, e.g. doc('m_rooms/all') or doc('cfg/settings')
      const doc = path => { const i = path.lastIndexOf('/'); return docRef(path.slice(0, i), path.slice(i + 1)); };
      return name === 'db' ? { doc, collection: colRef } : name === 'user' ? userApi : null;
    },
  };

  // Start: if the browser already has a valid log-in session the app starts, otherwise the log-in page shows.
  api('GET', '/api/me', undefined, true)
    .then(u => { me = u; resolveUser(u); })
    .catch(() => { needLogin = true; if (askedForDb) showLogin(); });
})();
