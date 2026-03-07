-- ============================================================================
-- UP-DOWNSELLS Import: Zieltabelle + Import-Historie + Auto-Import-Control
-- Datum: 07. Maerz 2026
-- ============================================================================

-- 1) Zieltabelle fuer Upgrade/Downgrade Events (DACH-only, kein Region-Feld)
CREATE TABLE IF NOT EXISTS up_downsells_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_month DATE NOT NULL,
  oak_id INTEGER NOT NULL,
  customer_name TEXT NOT NULL,
  net_growth_arr NUMERIC(14, 2) NOT NULL DEFAULT 0,
  net_loss_arr NUMERIC(14, 2) NOT NULL DEFAULT 0,
  net_arr NUMERIC(14, 2) NOT NULL DEFAULT 0,
  source_tab TEXT NOT NULL DEFAULT 'mirror_Up_Downsells',
  source_row_number INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Business Key: Monat + OAK ID
CREATE UNIQUE INDEX IF NOT EXISTS idx_up_downsells_events_month_oak_unique
  ON up_downsells_events(event_month, oak_id);

CREATE INDEX IF NOT EXISTS idx_up_downsells_events_oak_id
  ON up_downsells_events(oak_id);

CREATE INDEX IF NOT EXISTS idx_up_downsells_events_updated_at
  ON up_downsells_events(updated_at DESC);

-- updated_at Trigger
CREATE OR REPLACE FUNCTION set_up_downsells_events_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_set_up_downsells_events_updated_at ON up_downsells_events;
CREATE TRIGGER trg_set_up_downsells_events_updated_at
BEFORE UPDATE ON up_downsells_events
FOR EACH ROW
EXECUTE FUNCTION set_up_downsells_events_updated_at();

-- 2) Historie-Tabellen analog go_live/churn Import
CREATE TABLE IF NOT EXISTS up_downsells_import_runs (
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

CREATE TABLE IF NOT EXISTS up_downsells_import_run_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES up_downsells_import_runs(id) ON DELETE CASCADE,
  row_number INTEGER,
  oak_id INTEGER,
  level TEXT NOT NULL CHECK (level IN ('error', 'warning', 'duplicate')),
  message TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_up_downsells_import_runs_started_at
  ON up_downsells_import_runs(started_at DESC);

CREATE INDEX IF NOT EXISTS idx_up_downsells_import_runs_status
  ON up_downsells_import_runs(status);

CREATE INDEX IF NOT EXISTS idx_up_downsells_import_items_run_id
  ON up_downsells_import_run_items(run_id);

CREATE INDEX IF NOT EXISTS idx_up_downsells_import_items_level
  ON up_downsells_import_run_items(level);

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
VALUES ('up_downsells_auto_import_enabled', false)
ON CONFLICT (key) DO NOTHING;

