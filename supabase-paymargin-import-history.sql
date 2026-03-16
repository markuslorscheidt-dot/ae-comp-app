-- ============================================================================
-- PAYMARGIN Import-Historie (CSV Quelle je Kohorte nachvollziehen)
-- Datum: 12. Maerz 2026
-- ============================================================================

CREATE TABLE IF NOT EXISTS paymargin_import_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mode TEXT NOT NULL CHECK (mode IN ('dry-run', 'commit')),
  status TEXT NOT NULL CHECK (status IN ('success', 'failed')),
  source_file_name TEXT NOT NULL,
  year INTEGER NOT NULL,
  go_live_month INTEGER NOT NULL CHECK (go_live_month BETWEEN 1 AND 12),
  seasonal_factor NUMERIC(10, 4),
  rows_parsed INTEGER NOT NULL DEFAULT 0,
  rows_valid INTEGER NOT NULL DEFAULT 0,
  rows_skipped_no_oak INTEGER NOT NULL DEFAULT 0,
  rows_skipped_invalid_margin INTEGER NOT NULL DEFAULT 0,
  rows_skipped_no_match INTEGER NOT NULL DEFAULT 0,
  rows_matched_go_lives INTEGER NOT NULL DEFAULT 0,
  rows_would_update INTEGER NOT NULL DEFAULT 0,
  rows_updated INTEGER NOT NULL DEFAULT 0,
  duplicate_oak_rows INTEGER NOT NULL DEFAULT 0,
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_paymargin_import_runs_created_at
  ON paymargin_import_runs(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_paymargin_import_runs_cohort_created_at
  ON paymargin_import_runs(year, go_live_month, created_at DESC);
