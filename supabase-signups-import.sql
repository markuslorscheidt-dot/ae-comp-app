-- ============================================================================
-- SIGNUPS Import: Zieltabelle + Import-Historie + Auto-Import-Control
-- Datum: 16. Maerz 2026
-- ============================================================================

CREATE TABLE IF NOT EXISTS signups_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id TEXT NOT NULL,
  oak_id INTEGER,
  account_name TEXT NOT NULL,
  business_type TEXT,
  number_of_locations INTEGER,
  employees_range TEXT,
  signup_package TEXT,
  go_live_date DATE,
  customer_info_stage TEXT,
  account_owner TEXT,
  account_name_with_oak_id TEXT,
  signup_date DATE,
  germany_go_live_day TEXT,
  source_month INTEGER,
  region TEXT,
  source_tab TEXT NOT NULL DEFAULT 'sign_ups',
  source_row_number INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_signups_events_account_id_unique
  ON signups_events(account_id);

CREATE INDEX IF NOT EXISTS idx_signups_events_oak_id
  ON signups_events(oak_id);

CREATE INDEX IF NOT EXISTS idx_signups_events_updated_at
  ON signups_events(updated_at DESC);

CREATE OR REPLACE FUNCTION set_signups_events_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_set_signups_events_updated_at ON signups_events;
CREATE TRIGGER trg_set_signups_events_updated_at
BEFORE UPDATE ON signups_events
FOR EACH ROW
EXECUTE FUNCTION set_signups_events_updated_at();

CREATE TABLE IF NOT EXISTS signups_import_runs (
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

CREATE TABLE IF NOT EXISTS signups_import_run_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES signups_import_runs(id) ON DELETE CASCADE,
  row_number INTEGER,
  oak_id INTEGER,
  level TEXT NOT NULL CHECK (level IN ('error', 'warning', 'duplicate')),
  message TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_signups_import_runs_started_at
  ON signups_import_runs(started_at DESC);

CREATE INDEX IF NOT EXISTS idx_signups_import_runs_status
  ON signups_import_runs(status);

CREATE INDEX IF NOT EXISTS idx_signups_import_items_run_id
  ON signups_import_run_items(run_id);

CREATE INDEX IF NOT EXISTS idx_signups_import_items_level
  ON signups_import_run_items(level);

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
VALUES ('signups_auto_import_enabled', false)
ON CONFLICT (key) DO NOTHING;
