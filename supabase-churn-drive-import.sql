-- ============================================================================
-- CHURN Drive ZIP Import: file-tracking + scheduled + rollups + run-history
-- Datum: 17. Maerz 2026
-- ============================================================================

-- 1) Source-File Tracking (inkrementell per Drive file id / modified_at)
CREATE TABLE IF NOT EXISTS churn_drive_source_files (
  drive_file_id TEXT PRIMARY KEY,
  file_name TEXT NOT NULL,
  modified_at TIMESTAMPTZ NOT NULL,
  processed_at TIMESTAMPTZ,
  status TEXT NOT NULL CHECK (status IN ('processing', 'success', 'failed')),
  error_message TEXT,
  imported_rows INTEGER,
  updated_rows INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_churn_drive_source_files_modified_at
  ON churn_drive_source_files(modified_at DESC);

CREATE INDEX IF NOT EXISTS idx_churn_drive_source_files_status
  ON churn_drive_source_files(status);

-- 2) Scheduled Churn Detail (separat von churn_events)
CREATE TABLE IF NOT EXISTS churn_scheduled_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  oak_id INTEGER NOT NULL,
  churn_month DATE NOT NULL,
  gl_month DATE,
  business_name TEXT NOT NULL,
  branch_name TEXT,
  package_tier_number TEXT,
  business_advisor TEXT,
  pay_account_executive TEXT,
  health_score NUMERIC(10, 2),
  billing_currency TEXT,
  churn_reason TEXT,
  schedule_churn_arr NUMERIC(14, 2),
  estimated_lost_bill NUMERIC(14, 2),
  source_file_id TEXT,
  source_file_name TEXT,
  source_row_number INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_churn_scheduled_events_oak_id_unique
  ON churn_scheduled_events(oak_id);

CREATE INDEX IF NOT EXISTS idx_churn_scheduled_events_churn_month
  ON churn_scheduled_events(churn_month);

CREATE OR REPLACE FUNCTION set_churn_scheduled_events_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_set_churn_scheduled_events_updated_at ON churn_scheduled_events;
CREATE TRIGGER trg_set_churn_scheduled_events_updated_at
BEFORE UPDATE ON churn_scheduled_events
FOR EACH ROW
EXECUTE FUNCTION set_churn_scheduled_events_updated_at();

-- 3) Rollup/Summary Snapshots (monatlich + ytd + scheduled summary)
CREATE TABLE IF NOT EXISTS churn_rollup_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_date DATE NOT NULL,
  metric_type TEXT NOT NULL,
  event_month DATE,
  event_month_key TEXT NOT NULL,
  number_of_net_churns NUMERIC(14, 2),
  total_lost_arr NUMERIC(14, 2),
  avg_bill_of_churned_client NUMERIC(14, 2),
  number_of_scheduled_churns NUMERIC(14, 2),
  scheduled_churn_arr NUMERIC(14, 2),
  expected_lost_bill_scheduled NUMERIC(14, 2),
  source_file_id TEXT,
  source_file_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_churn_rollup_events_snapshot_metric_unique
  ON churn_rollup_events(snapshot_date, metric_type, event_month_key);

CREATE INDEX IF NOT EXISTS idx_churn_rollup_events_snapshot_date
  ON churn_rollup_events(snapshot_date DESC);

CREATE OR REPLACE FUNCTION set_churn_rollup_events_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_set_churn_rollup_events_updated_at ON churn_rollup_events;
CREATE TRIGGER trg_set_churn_rollup_events_updated_at
BEFORE UPDATE ON churn_rollup_events
FOR EACH ROW
EXECUTE FUNCTION set_churn_rollup_events_updated_at();

-- 4) Import Runs + Items (Drive spezifisch)
CREATE TABLE IF NOT EXISTS churn_drive_import_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  triggered_by TEXT NOT NULL CHECK (triggered_by IN ('manual', 'cron')),
  status TEXT NOT NULL CHECK (status IN ('success', 'partial', 'failed', 'skipped')),
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ,
  source_file_name TEXT,
  zip_entries INTEGER NOT NULL DEFAULT 0,
  client_list_rows INTEGER NOT NULL DEFAULT 0,
  scheduled_detail_rows INTEGER NOT NULL DEFAULT 0,
  summary_rows INTEGER NOT NULL DEFAULT 0,
  imported INTEGER NOT NULL DEFAULT 0,
  updated INTEGER NOT NULL DEFAULT 0,
  failed INTEGER NOT NULL DEFAULT 0,
  auto_import_enabled BOOLEAN NOT NULL DEFAULT false,
  skipped BOOLEAN NOT NULL DEFAULT false,
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS churn_drive_import_run_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES churn_drive_import_runs(id) ON DELETE CASCADE,
  level TEXT NOT NULL CHECK (level IN ('warning', 'error', 'duplicate')),
  message TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_churn_drive_import_runs_started_at
  ON churn_drive_import_runs(started_at DESC);

CREATE INDEX IF NOT EXISTS idx_churn_drive_import_items_run_id
  ON churn_drive_import_run_items(run_id);

-- 5) Auto-Import Flag in import_controls
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
VALUES ('churn_drive_auto_import_enabled', false)
ON CONFLICT (key) DO NOTHING;
