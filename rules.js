/* KUN MH - calculation rules (pure functions, no page state).
   Used by index.html (as window.KUNRules) and by the server tests (require).
   Amounts are IQD. Thresholds come from the Settings page (MH-01). */
(function (root) {
  'use strict';

  // Who must sign a PO, by amount (approval matrix, Settings section D).
  function approvalFor(amount, st) {
    return amount <= st.masoolLimit ? 'Maintenance Masool'
      : amount <= st.masoolHoaLimit ? 'Masool + Head of Accounts'
        : 'Masool + Head of Accounts + Sigat';
  }

  // Document type for a PO value: PO-cum-Quotation above the limit, PO from the PO limit, else no PO.
  function docTypeFor(value, st) {
    return value > st.qcpoAbove ? 'PO-cum-Quotation' : value >= st.poFrom ? 'PO' : 'PO (below PO limit)';
  }

  // Who approves a rate above the MPL by more than the price tolerance.
  function priceApprovalFor(amount, above, st) {
    return above ? (amount <= st.masoolLimit ? 'Head of Accounts' : 'Sigat') : '';
  }

  // Does a bill need variance approval? recvOver / poOver are the fractional excess over
  // received value and PO value (0.1 = 10 % over). A bill with no received value counts as over
  // when anything has been billed (pass Infinity from the caller).
  function needsVarianceApproval(recvOver, poOver, billTol) {
    return Math.max(recvOver, poOver) > billTol + 1e-9;
  }

  // Cash PV: a bill may be paid on a consolidated cash voucher only if it is at most the limit.
  function cashPvEligible(net, cpvMax) {
    return net > 0 && net <= cpvMax;
  }

  // Advance status: not paid, adjusted in full, overdue, or still being adjusted.
  function advanceStatus(paidDate, balance, days, advDays) {
    return !paidDate ? 'Not paid yet' : balance <= 0.5 ? 'Adjusted' : days > advDays ? 'Not adjusted - follow up' : 'Being adjusted';
  }

  // Bill payment status shown on the Bills register and the dashboard (one rule for both).
  function billPayStatus(bill) {
    return bill.payDate ? 'Paid' : bill.audit === 'Clear' ? 'Cleared - awaiting payment'
      : bill.audit === 'Hold' ? 'On hold' : bill.audit === 'Query' ? 'Query' : 'Awaiting audit';
  }

  // Finding 9: a copy of the data for a backup file. Staff contact details (e-mail, phone and similar)
  // are removed from each user record; the input is not changed.
  const CONTACT_KEY = /email|phone|mobile|contact|address/i;
  function stripStaffContacts(data) {
    const out = JSON.parse(JSON.stringify(data));
    (out.users || []).forEach(u => Object.keys(u).forEach(k => { if (CONTACT_KEY.test(k)) delete u[k]; }));
    out.backupNote = 'Staff contact details are not included in this file.';
    return out;
  }

  const api = { approvalFor, docTypeFor, priceApprovalFor, needsVarianceApproval, cashPvEligible, advanceStatus, billPayStatus, stripStaffContacts };
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.KUNRules = api;
})(typeof window !== 'undefined' ? window : globalThis);
