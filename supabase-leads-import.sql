-- ============================================================================
-- LEADS Import: Zieltabelle + Import-Historie + Auto-Import-Control
-- Datum: 30. Maerz 2026
-- ============================================================================

-- 1) Zieltabelle fuer leads_inbound_raw
CREATE TABLE IF NOT EXISTS leads_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id TEXT NOT NULL,
  first_name TEXT,
  last_name TEXT,
  company_account TEXT NOT NULL,
  lead_source TEXT,
  demo_or_quote TEXT,
  number_of_locations INTEGER,
  employees_range TEXT,
  salon_type TEXT,
  lead_owner TEXT,
  lead_status TEXT,
  lead_sub_status TEXT,
  created_date DATE,
  last_activity_date DATE,
  updated_on_date DATE,
  conversion_date DATE,
  opportunity_id TEXT,
  opportunity_owner TEXT,
  opportunity_name TEXT,
  opportunity_account TEXT,
  opportunity_amount_currency TEXT,
  opportunity_amount NUMERIC(14, 2),
  opportunity_close_date DATE,
  created_by TEXT,
  source_tab TEXT NOT NULL DEFAULT 'leads_inbound_raw',
  source_row_number INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Fuehrender Business Key: Lead-ID
CREATE UNIQUE INDEX IF NOT EXISTS idx_leads_events_lead_id_unique
  ON leads_events(lead_id);

CREATE INDEX IF NOT EXISTS idx_leads_events_opportunity_id
  ON leads_events(opportunity_id);

CREATE INDEX IF NOT EXISTS idx_leads_events_lead_status
  ON leads_events(lead_status);

CREATE INDEX IF NOT EXISTS idx_leads_events_updated_at
  ON leads_events(updated_at DESC);

-- updated_at Trigger
CREATE OR REPLACE FUNCTION set_leads_events_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_set_leads_events_updated_at ON leads_events;
CREATE TRIGGER trg_set_leads_events_updated_at
BEFORE UPDATE ON leads_events
FOR EACH ROW
EXECUTE FUNCTION set_leads_events_updated_at();

-- 2) Historie-Tabellen
CREATE TABLE IF NOT EXISTS leads_import_runs (
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

CREATE TABLE IF NOT EXISTS leads_import_run_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES leads_import_runs(id) ON DELETE CASCADE,
  row_number INTEGER,
  lead_id TEXT,
  level TEXT NOT NULL CHECK (level IN ('error', 'warning', 'duplicate')),
  message TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_leads_import_runs_started_at
  ON leads_import_runs(started_at DESC);

CREATE INDEX IF NOT EXISTS idx_leads_import_runs_status
  ON leads_import_runs(status);

CREATE INDEX IF NOT EXISTS idx_leads_import_items_run_id
  ON leads_import_run_items(run_id);

CREATE INDEX IF NOT EXISTS idx_leads_import_items_level
  ON leads_import_run_items(level);

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
VALUES ('leads_auto_import_enabled', false)
ON CONFLICT (key) DO NOTHING;
