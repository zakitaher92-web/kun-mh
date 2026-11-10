'use strict';
// Server-side write rules (phase 3, gap A2).
// The browser already hides pages by role; this module makes the server refuse writes that the
// role may not make. Reads stay open to any signed-in user because the app loads its whole
// working set into the browser on start (see README "Access enforcement").
//
// The default rights below must match MODULES in index.html. test/permissions.test.js checks that.

const ROLES = ['Admin', 'Sigat', 'Internal Auditor', 'Maintenance Masool', 'GRN Officer', 'HK Supervisor', 'Accounts', 'Store Keeper'];

// Page (sheet) -> rights per role, in ROLES order. E = edit, V = view, H = hidden.
const DEFAULT_RIGHTS = {
  'Guide': 'EVEHVVVV',
  'Dashboard': 'EVEHHHVH',
  'Rooms': 'EVVEVEHH',
  'Settings': 'EVEHHHHH',
  'Budget': 'EVEHHHVH',
  'Items': 'EVEEVHVH',
  'Vendors': 'EVEEHHVH',
  'MPL': 'EVEEVHVH',
  'PO Print': 'EEEEEHEE',
  'Advance Print': 'EEEEHHEH',
  'GRN Print': 'EEEEEHEE',
  'SRN Print': 'EEEEHHEH',
  'Payment Voucher': 'EEEEHHEH',
  'PO Register': 'EVEEVHVV',
  'PO Lines': 'EVEEVHVV',
  'Advances': 'EVEEHHEH',
  'GRN': 'EVEEEHVE',
  'SRN': 'EVEEHHVH',
  'Bills': 'EVEEHHEH',
  'Bill Lines': 'EVEEHHEH',
  'Payment Pack': 'EEEHHHEH',
  'Consolidated PV': 'EEEHHHEH',
  'Issues': 'EVEEEVVE',
  'Stores': 'EVEEEHVE',
  'HK Norms': 'EVEEHVVH',
  'Linen Par': 'EVEEHEVH',
  'Laundry Log': 'EVEEHEVH',
  'Job Cards': 'EVEEVVHV',
  'PPM AMC': 'EVEEHHHH',
  'Audit Log': 'VVVHHHHH',
  'Notifications': 'VVVHHHHH',
  'Number Log': 'VHHHHHHH',
  'Users': 'EHEHHHHH',
  'Access': 'EHEHHHHH',
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
  'cfg/roles': 'Access',
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

// Read rules (A2 follow-up). A role may read a restricted collection only if it can see at least one
// page that uses it (V or E). Restricted reads return an empty list, which the app treats as "nothing
// to show". Always readable: the settings and lists every page needs, the user list (the app finds the
// signed-in user there and shows names), the item master, rooms, and the audit, notice and number logs.
const READ_PAGES = {
  m_pos: ['PO Register', 'PO Lines', 'PO Print', 'Advances', 'GRN', 'SRN', 'Bills', 'Payment Pack', 'Consolidated PV', 'Dashboard', 'Issues'],
  m_advances: ['Advances', 'Advance Print', 'PO Register', 'Bills', 'Payment Pack', 'Dashboard'],
  m_grns: ['GRN', 'GRN Print', 'SRN', 'PO Register', 'PO Lines', 'Bills', 'Stores', 'Dashboard', 'Issues'],
  m_srns: ['SRN', 'SRN Print', 'Bills', 'PO Register', 'Dashboard'],
  m_bills: ['Bills', 'Payment Voucher', 'Payment Pack', 'Consolidated PV', 'Dashboard', 'PO Register'],
  m_cpvs: ['Consolidated PV', 'Payment Pack', 'Dashboard'],
  m_issues: ['Issues', 'Stores', 'Job Cards', 'Dashboard'],
  m_jobs: ['Job Cards', 'PPM AMC', 'Rooms', 'Dashboard'],
  m_ppm: ['PPM AMC', 'Dashboard'],
  m_laundry: ['Laundry Log', 'Linen Par', 'Dashboard'],
  m_vendors: ['Vendors', 'PO Register', 'PO Lines', 'Advances', 'Bills', 'MPL', 'Consolidated PV', 'Dashboard', 'Items'],
};
const ALWAYS_READ = new Set(['m_users', 'm_items', 'm_rooms', 'm_audit', 'm_notifs', 'm_numlog']);

function canRead({ role, collection, access, roles }) {
  if (collection.startsWith('cfg') || collection.startsWith('locks/') || ALWAYS_READ.has(collection)) return true;
  const list = roles || ROLES;
  if (!role || !list.includes(role)) return false;
  if (role === 'Admin') return true;
  const pages = READ_PAGES[collection];
  if (!pages) return false;                                 // unknown collection: refuse
  return pages.some(page => rightFor(page, role, access) !== 'H');
}

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
function canWrite({ role, collection, access, roles }) {
  if (ANY_USER_COLLECTIONS.has(collection) || ANY_USER_PREFIXES.some(p => collection.startsWith(p))) {
    return true;
  }
  const list = roles || ROLES;                              // the stored role list (cfg/roles), or the eight base roles
  if (!role || !list.includes(role)) return false;
  if (role === 'Admin') return true;                       // Admin always may (as in the app)
  const page = COLLECTION_PAGE[collection];
  if (!page) return false;                                  // unknown collection: refuse
  return rightFor(page, role, access) === 'E';
}

module.exports = { ROLES, DEFAULT_RIGHTS, COLLECTION_PAGE, READ_PAGES, ALWAYS_READ, canWrite, canRead, rightFor, defaultRight };
