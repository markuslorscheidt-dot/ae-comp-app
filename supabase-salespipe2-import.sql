-- ============================================================================
-- SALESPIPE 2 Import: Import-Historie + Auto-Import-Control
-- Datum: 31. Maerz 2026
-- Hinweis: Zieltabelle ist salespipe_events (bestehend)
-- ============================================================================

CREATE TABLE IF NOT EXISTS salespipe2_import_runs (
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
  updated INTEGER NOT NULL DEFAULT 0,
  auto_import_enabled BOOLEAN NOT NULL DEFAULT false,
  skipped BOOLEAN NOT NULL DEFAULT false,
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS salespipe2_import_run_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES salespipe2_import_runs(id) ON DELETE CASCADE,
  row_number INTEGER,
  opportunity_id TEXT,
  level TEXT NOT NULL CHECK (level IN ('error', 'warning', 'duplicate')),
  message TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_salespipe2_import_runs_started_at
  ON salespipe2_import_runs(started_at DESC);

CREATE INDEX IF NOT EXISTS idx_salespipe2_import_runs_status
  ON salespipe2_import_runs(status);

CREATE INDEX IF NOT EXISTS idx_salespipe2_import_items_run_id
  ON salespipe2_import_run_items(run_id);

CREATE INDEX IF NOT EXISTS idx_salespipe2_import_items_level
  ON salespipe2_import_run_items(level);

CREATE TABLE IF NOT EXISTS import_controls (
  key TEXT PRIMARY KEY,
  enabled BOOLEAN NOT NULL DEFAULT false,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE OR REPLACE FUNCTION set_import_controls_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_set_import_controls_updated_at ON import_controls;
CREATE TRIGGER trg_set_import_controls_updated_at
BEFORE UPDATE ON import_controls
FOR EACH ROW
EXECUTE FUNCTION set_import_controls_updated_at();

INSERT INTO import_controls (key, enabled)
VALUES ('salespipe2_auto_import_enabled', false)
ON CONFLICT (key) DO NOTHING;

