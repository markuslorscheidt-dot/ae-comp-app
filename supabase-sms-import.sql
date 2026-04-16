-- ============================================================================
-- SMS Import: Zieltabelle + Import-Historie + Auto-Import-Control
-- Datum: 02. April 2026
-- ============================================================================

-- 1) Zieltabelle fuer rohe SMS-CSV-Zeilen aus Google Drive
CREATE TABLE IF NOT EXISTS sms_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_file_id TEXT NOT NULL,
  source_file_name TEXT NOT NULL,
  source_row_number INTEGER NOT NULL,
  modified_at TIMESTAMPTZ,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Business Key: Datei + Zeilennummer
CREATE UNIQUE INDEX IF NOT EXISTS idx_sms_events_file_row_unique
  ON sms_events(source_file_id, source_row_number);

CREATE INDEX IF NOT EXISTS idx_sms_events_updated_at
  ON sms_events(updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_sms_events_source_file
  ON sms_events(source_file_id);

-- Trackt den Verarbeitungsstatus pro Drive-Datei
CREATE TABLE IF NOT EXISTS sms_source_files (
  drive_file_id TEXT PRIMARY KEY,
  file_name TEXT NOT NULL,
  modified_at TIMESTAMPTZ NOT NULL,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status TEXT NOT NULL CHECK (status IN ('processing', 'success', 'failed')),
  imported_rows INTEGER,
  updated_rows INTEGER,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sms_source_files_modified_at
  ON sms_source_files(modified_at DESC);

CREATE INDEX IF NOT EXISTS idx_sms_source_files_status
  ON sms_source_files(status);

-- updated_at Trigger
CREATE OR REPLACE FUNCTION set_sms_events_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_set_sms_events_updated_at ON sms_events;
CREATE TRIGGER trg_set_sms_events_updated_at
BEFORE UPDATE ON sms_events
FOR EACH ROW
EXECUTE FUNCTION set_sms_events_updated_at();

-- 2) Historie-Tabellen
CREATE TABLE IF NOT EXISTS sms_import_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  triggered_by TEXT NOT NULL CHECK (triggered_by IN ('manual', 'cron')),
  status TEXT NOT NULL CHECK (status IN ('success', 'partial', 'failed', 'skipped')),
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ,
  source_file_name TEXT,
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

CREATE TABLE IF NOT EXISTS sms_import_run_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES sms_import_runs(id) ON DELETE CASCADE,
  row_number INTEGER,
  level TEXT NOT NULL CHECK (level IN ('error', 'warning', 'duplicate')),
  message TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sms_import_runs_started_at
  ON sms_import_runs(started_at DESC);

CREATE INDEX IF NOT EXISTS idx_sms_import_runs_status
  ON sms_import_runs(status);

CREATE INDEX IF NOT EXISTS idx_sms_import_items_run_id
  ON sms_import_run_items(run_id);

CREATE INDEX IF NOT EXISTS idx_sms_import_items_level
  ON sms_import_run_items(level);

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
VALUES ('sms_auto_import_enabled', false)
ON CONFLICT (key) DO NOTHING;

