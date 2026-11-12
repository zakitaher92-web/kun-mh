-- KUN Maintenance & Housekeeping - relational tables, the target of src/migrate-to-tables.js.
-- Idempotent (IF NOT EXISTS). The server does not read these tables yet; they are filled by the copy script.
-- Each register keeps its full record in the record column (JSONB), plus typed columns for the fields
-- used in filters and reports. Lines of a document go to a child table.

-- Settings and config documents (cfg), one row per id, the whole document kept as data.
CREATE TABLE IF NOT EXISTS settings (
  key        TEXT        PRIMARY KEY,
  data       JSONB       NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Document-number counters (the locks/num-TYPE-YEAR documents). last_seq = highest number issued.
CREATE TABLE IF NOT EXISTS number_counters (
  type     TEXT NOT NULL,
  year     INT  NOT NULL,
  last_seq INT  NOT NULL,
  PRIMARY KEY (type, year)
);

CREATE TABLE IF NOT EXISTS budget_lines (
  code   TEXT PRIMARY KEY,
  name   TEXT NOT NULL DEFAULT '',
  basis  TEXT,
  annual NUMERIC(16,2),
  ord    INT  NOT NULL DEFAULT 0,
  record JSONB NOT NULL
);

CREATE TABLE IF NOT EXISTS categories (
  name        TEXT PRIMARY KEY,
  budget_line TEXT,
  type        TEXT,
  ord         INT  NOT NULL DEFAULT 0,
  record      JSONB NOT NULL
);

-- Purchase orders and their lines
CREATE TABLE IF NOT EXISTS pos (
  no          TEXT PRIMARY KEY,
  po_date     DATE,
  vendor      TEXT,
  budget_line TEXT,
  approved_by TEXT,
  cancelled   BOOLEAN NOT NULL DEFAULT FALSE,
  ord         INT  NOT NULL DEFAULT 0,
  record      JSONB NOT NULL
);
CREATE TABLE IF NOT EXISTS po_lines (
  po_no     TEXT NOT NULL REFERENCES pos (no) ON DELETE CASCADE,
  line_no   INT  NOT NULL,
  item_code TEXT,
  qty       NUMERIC(16,3),
  rate      NUMERIC(16,2),
  record    JSONB NOT NULL,
  PRIMARY KEY (po_no, line_no)
);

-- Advance vouchers
CREATE TABLE IF NOT EXISTS advances (
  no       TEXT PRIMARY KEY,
  adv_date DATE,
  po_no    TEXT,
  ord      INT  NOT NULL DEFAULT 0,
  record   JSONB NOT NULL
);

-- Goods receipt notes and their lines. no_po = TRUE for a receipt without a PO.
CREATE TABLE IF NOT EXISTS grns (
  no          TEXT PRIMARY KEY,
  grn_date    DATE,
  po_no       TEXT,
  no_po       BOOLEAN NOT NULL,
  vendor      TEXT,
  challan     TEXT,
  received_by TEXT,
  ord         INT  NOT NULL DEFAULT 0,
  record      JSONB NOT NULL
);
CREATE TABLE IF NOT EXISTS grn_lines (
  grn_no    TEXT NOT NULL REFERENCES grns (no) ON DELETE CASCADE,
  line_no   INT  NOT NULL,
  item_code TEXT,
  received  NUMERIC(16,3),
  accepted  NUMERIC(16,3),
  record    JSONB NOT NULL,
  PRIMARY KEY (grn_no, line_no)
);

-- Service receipt notes and their lines
CREATE TABLE IF NOT EXISTS srns (
  no       TEXT PRIMARY KEY,
  srn_date DATE,
  po_no    TEXT,
  ord      INT  NOT NULL DEFAULT 0,
  record   JSONB NOT NULL
);
CREATE TABLE IF NOT EXISTS srn_lines (
  srn_no    TEXT NOT NULL REFERENCES srns (no) ON DELETE CASCADE,
  line_no   INT  NOT NULL,
  item_code TEXT,
  qty       NUMERIC(16,3),
  record    JSONB NOT NULL,
  PRIMARY KEY (srn_no, line_no)
);

-- Bill entries and the items billed
CREATE TABLE IF NOT EXISTS bills (
  no        TEXT PRIMARY KEY,
  bill_date DATE,
  po_no     TEXT,
  vendor    TEXT,
  inv_no    TEXT,
  amount    NUMERIC(16,2),
  ord       INT  NOT NULL DEFAULT 0,
  record    JSONB NOT NULL
);
CREATE TABLE IF NOT EXISTS bill_items (
  bill_no   TEXT NOT NULL REFERENCES bills (no) ON DELETE CASCADE,
  line_no   INT  NOT NULL,
  item_code TEXT,
  qty       NUMERIC(16,3),
  rate      NUMERIC(16,2),
  amount    NUMERIC(16,2),
  record    JSONB NOT NULL,
  PRIMARY KEY (bill_no, line_no)
);

-- Consolidated cash payment vouchers
CREATE TABLE IF NOT EXISTS cpvs (
  no       TEXT PRIMARY KEY,
  cpv_date DATE,
  ord      INT  NOT NULL DEFAULT 0,
  record   JSONB NOT NULL
);

-- Issue slips and their lines
CREATE TABLE IF NOT EXISTS issues (
  no         TEXT PRIMARY KEY,
  issue_date DATE,
  job_no     TEXT,
  ord        INT  NOT NULL DEFAULT 0,
  record     JSONB NOT NULL
);
CREATE TABLE IF NOT EXISTS issue_lines (
  issue_no  TEXT NOT NULL REFERENCES issues (no) ON DELETE CASCADE,
  line_no   INT  NOT NULL,
  item_code TEXT,
  qty       NUMERIC(16,3),
  record    JSONB NOT NULL,
  PRIMARY KEY (issue_no, line_no)
);

-- Job cards, laundry, PPM equipment, rooms
CREATE TABLE IF NOT EXISTS jobs (
  no       TEXT PRIMARY KEY,
  job_date DATE,
  ord      INT  NOT NULL DEFAULT 0,
  record   JSONB NOT NULL
);
CREATE TABLE IF NOT EXISTS laundry (
  id           TEXT PRIMARY KEY,
  laundry_date DATE,
  ord          INT  NOT NULL DEFAULT 0,
  record       JSONB NOT NULL
);
CREATE TABLE IF NOT EXISTS ppm_equipment (
  id     TEXT PRIMARY KEY,
  ord    INT  NOT NULL DEFAULT 0,
  record JSONB NOT NULL
);
CREATE TABLE IF NOT EXISTS rooms (
  no     TEXT PRIMARY KEY,
  ord    INT  NOT NULL DEFAULT 0,
  record JSONB NOT NULL
);

-- Masters
CREATE TABLE IF NOT EXISTS items (
  code     TEXT PRIMARY KEY,
  name     TEXT,
  category TEXT,
  unit     TEXT,
  mpl_rate NUMERIC(16,2),
  ord      INT  NOT NULL DEFAULT 0,
  record   JSONB NOT NULL
);
CREATE TABLE IF NOT EXISTS vendors (
  code   TEXT PRIMARY KEY,
  name   TEXT,
  avl    BOOLEAN NOT NULL DEFAULT FALSE,
  ord    INT  NOT NULL DEFAULT 0,
  record JSONB NOT NULL
);
CREATE TABLE IF NOT EXISTS users (
  id     TEXT PRIMARY KEY,
  name   TEXT,
  role   TEXT,
  cid    TEXT,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  ord    INT  NOT NULL DEFAULT 0,
  record JSONB NOT NULL
);

-- Issued document numbers (from the number log). One row per number.
CREATE TABLE IF NOT EXISTS doc_numbers (
  no        TEXT PRIMARY KEY,
  type      TEXT NOT NULL,
  year      INT  NOT NULL,
  seq       INT  NOT NULL,
  issued_by TEXT,
  issued_at TIMESTAMP,
  record    JSONB NOT NULL,
  UNIQUE (type, year, seq)
);

-- Audit trail: rows are added, not changed.
CREATE TABLE IF NOT EXISTS audit_log (
  k        TEXT PRIMARY KEY,
  event_at TIMESTAMP,
  username TEXT,
  action   TEXT,
  ord      INT  NOT NULL DEFAULT 0,
  record   JSONB NOT NULL
);

CREATE TABLE IF NOT EXISTS notifications (
  id     TEXT PRIMARY KEY,
  ord    INT  NOT NULL DEFAULT 0,
  record JSONB NOT NULL
);

-- One row per copy run (kept across runs; the copy never empties it).
CREATE TABLE IF NOT EXISTS migration_runs (
  id          BIGSERIAL PRIMARY KEY,
  started_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  mode        TEXT NOT NULL,
  target      TEXT NOT NULL,
  status      TEXT NOT NULL,
  report      JSONB NOT NULL
);
