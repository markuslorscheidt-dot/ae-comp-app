-- ============================================================================
-- SALESPIPE Import: Zieltabelle + Import-Historie + Auto-Import-Control
-- Datum: 11. Maerz 2026
-- ============================================================================

-- 1) Zieltabelle fuer mirror_salespipe_raw
CREATE TABLE IF NOT EXISTS salespipe_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  opportunity_id TEXT NOT NULL,
  oak_id INTEGER,
  opportunity_name TEXT NOT NULL,
  rating TEXT,
  next_step TEXT,
  close_date DATE,
  last_activity_date DATE,
  stage TEXT,
  estimated_arr NUMERIC(14, 2),
  probability NUMERIC(6, 2),
  lead_source TEXT,
  days_demo_to_closure INTEGER,
  days_sentquote_to_close INTEGER,
  decision_criteria TEXT,
  created_date DATE,
  opportunity_owner TEXT,
  source_tab TEXT NOT NULL DEFAULT 'mirror_salespipe_raw',
  source_row_number INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Fuehrender Business Key: Opportunity-ID
CREATE UNIQUE INDEX IF NOT EXISTS idx_salespipe_events_opportunity_id_unique
  ON salespipe_events(opportunity_id);

CREATE INDEX IF NOT EXISTS idx_salespipe_events_oak_id
  ON salespipe_events(oak_id);

CREATE INDEX IF NOT EXISTS idx_salespipe_events_stage
  ON salespipe_events(stage);

CREATE INDEX IF NOT EXISTS idx_salespipe_events_updated_at
  ON salespipe_events(updated_at DESC);

-- updated_at Trigger
CREATE OR REPLACE FUNCTION set_salespipe_events_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_set_salespipe_events_updated_at ON salespipe_events;
CREATE TRIGGER trg_set_salespipe_events_updated_at
BEFORE UPDATE ON salespipe_events
FOR EACH ROW
EXECUTE FUNCTION set_salespipe_events_updated_at();

-- 2) Historie-Tabellen analog bestehender Importe
CREATE TABLE IF NOT EXISTS salespipe_import_runs (
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

CREATE TABLE IF NOT EXISTS salespipe_import_run_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES salespipe_import_runs(id) ON DELETE CASCADE,
  row_number INTEGER,
  oak_id INTEGER,
  level TEXT NOT NULL CHECK (level IN ('error', 'warning', 'duplicate')),
  message TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_salespipe_import_runs_started_at
  ON salespipe_import_runs(started_at DESC);

CREATE INDEX IF NOT EXISTS idx_salespipe_import_runs_status
  ON salespipe_import_runs(status);

CREATE INDEX IF NOT EXISTS idx_salespipe_import_items_run_id
  ON salespipe_import_run_items(run_id);

CREATE INDEX IF NOT EXISTS idx_salespipe_import_items_level
  ON salespipe_import_run_items(level);

-- 3) Persistentes Auto-Import-Flag (shared import_controls)
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
VALUES ('salespipe_auto_import_enabled', false)
ON CONFLICT (key) DO NOTHING;
