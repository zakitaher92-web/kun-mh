'use strict';
// Server-side write rules (phase 3, gap A2).
// The browser already hides pages by role; this module makes the server refuse writes that the
// role may not make. Reads stay open to any signed-in user because the app loads its whole
// working set into the browser on start (see README "Access enforcement").
//
// The default rights below must match MODULES in index.html. test/permissions.test.js checks that.

const ROLES = ['Admin', 'Sigat', 'Internal Auditor', 'Maintenance Masool', 'GRN Officer', 'HK Supervisor', 'Accounts'];

// Page (sheet) -> rights per role, in ROLES order. E = edit, V = view, H = hidden.
const DEFAULT_RIGHTS = {
  'Guide': 'EVVHVVV',
  'Dashboard': 'EVVHHHV',
  'Rooms': 'EVVEVEH',
  'Settings': 'EVVHHHH',
  'Budget': 'EVVHHHV',
  'Items': 'EVVHHHV',
  'Vendors': 'EVVHHHV',
  'MPL': 'EVVHHHV',
  'PO Register': 'EVEEVHV',
  'PO Lines': 'EVVEVHV',
  'Advances': 'EVVEHHE',
  'GRN': 'EVVVEHV',
  'SRN': 'EVVEHHV',
  'Bills': 'EVEEHHE',
  'Payment Pack': 'EEEHHHE',
  'Consolidated PV': 'EEEHHHE',
  'Issues': 'EVVVEVV',
  'Stores': 'EVVVEHV',
  'HK Norms': 'EVVVHVV',
  'Linen Par': 'EVVVHEV',
  'Laundry Log': 'EVVVHEV',
  'Job Cards': 'EVVEVVH',
  'PPM AMC': 'EVVEHHH',
  'Audit Log': 'VVVHHHH',
  'Notifications': 'VVVHHHH',
  'Number Log': 'VHHHHHH',
  'Users': 'EHHHHHH',
  'Access': 'EHHHHHH',
};

// Stored collection -> the page that owns it. Anything not listed is refused for writes.
const COLLECTION_PAGE = {
  'cfg/settings': 'Settings',
  'cfg/lists': 'Settings',
  'cfg/meta': 'Settings',
  'cfg/categories': 'Settings',
  'cfg/budgetLines': 'Budget',
  'cfg/mpl': 'MPL',
  'cfg/access': 'Access',
  'cfg/counts': 'Stores',
  'cfg/linenCounts': 'Linen Par',
  'cfg/hkExplain': 'HK Norms',
  'm_items': 'Items',
  'm_vendors': 'Vendors',
  'm_rooms': 'Rooms',
  'm_users': 'Users',
  'm_pos': 'PO Register',
  'm_advances': 'Advances',
  'm_grns': 'GRN',
  'm_srns': 'SRN',
  'm_bills': 'Bills',
  'm_cpvs': 'Consolidated PV',
  'm_issues': 'Issues',
  'm_jobs': 'Job Cards',
  'm_ppm': 'PPM AMC',
  'm_laundry': 'Laundry Log',
};

// Written by every signed-in user as part of their work: the audit trail, notices, document
// number log and short locks. Restricting these would stop normal entries from being recorded.
const ANY_USER_COLLECTIONS = new Set(['m_audit', 'm_notifs', 'm_numlog']);
const ANY_USER_PREFIXES = ['locks/'];

function defaultRight(page, role) {
  const i = ROLES.indexOf(role);
  const rights = DEFAULT_RIGHTS[page];
  if (i < 0 || !rights) return 'H';
  return rights[i];
}

// access: the saved access matrix from cfg/access ({ page: { role: 'E'|'V'|'H' } }) or null.
// Returns the right for a role on a page: the saved value when present, else the default.
function rightFor(page, role, access) {
  const saved = access && access[page] && access[page][role];
  return saved || defaultRight(page, role);
}

// May this role write this collection/document? role is null when the account is not linked to
// an in-app user; such accounts may write only the any-user collections.
function canWrite({ role, collection, access }) {
  if (ANY_USER_COLLECTIONS.has(collection) || ANY_USER_PREFIXES.some(p => collection.startsWith(p))) {
    return true;
  }
  if (!role || !ROLES.includes(role)) return false;
  if (role === 'Admin') return true;                       // Admin always may (as in the app)
  const page = COLLECTION_PAGE[collection];
  if (!page) return false;                                  // unknown collection: refuse
  return rightFor(page, role, access) === 'E';
}

module.exports = { ROLES, DEFAULT_RIGHTS, COLLECTION_PAGE, canWrite, rightFor, defaultRight };
