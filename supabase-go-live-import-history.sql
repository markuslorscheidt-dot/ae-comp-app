-- ============================================================================
-- GO_LIVES: Import-Historie (Run + Detail-Items)
-- Datum: 04. Maerz 2026
-- ============================================================================

CREATE TABLE IF NOT EXISTS go_live_import_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  triggered_by TEXT NOT NULL CHECK (triggered_by IN ('manual', 'cron')),
  status TEXT NOT NULL CHECK (status IN ('success', 'partial', 'failed', 'skipped')),
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ,
  sheet_range TEXT,
  total_rows INTEGER NOT NULL DEFAULT 0,
  parsed_rows INTEGER NOT NULL DEFAULT 0,
  valid_rows INTEGER NOT NULL DEFAULT 0,
  invalid_rows INTEGER NOT NULL DEFAULT 0,
  to_import INTEGER NOT NULL DEFAULT 0,
  imported INTEGER NOT NULL DEFAULT 0,
  failed INTEGER NOT NULL DEFAULT 0,
  duplicates INTEGER NOT NULL DEFAULT 0,
  auto_import_enabled BOOLEAN NOT NULL DEFAULT false,
  skipped BOOLEAN NOT NULL DEFAULT false,
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS go_live_import_run_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES go_live_import_runs(id) ON DELETE CASCADE,
  row_number INTEGER,
  oak_id INTEGER,
  level TEXT NOT NULL CHECK (level IN ('error', 'warning', 'duplicate')),
  message TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_go_live_import_runs_started_at
  ON go_live_import_runs(started_at DESC);

CREATE INDEX IF NOT EXISTS idx_go_live_import_runs_status
  ON go_live_import_runs(status);

CREATE INDEX IF NOT EXISTS idx_go_live_import_items_run_id
  ON go_live_import_run_items(run_id);

CREATE INDEX IF NOT EXISTS idx_go_live_import_items_level
  ON go_live_import_run_items(level);

