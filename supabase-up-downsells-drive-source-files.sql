-- ============================================================================
-- Up-/Downsells: Google-Drive-ZIP Tracking + erweiterte Import-Run-Metadaten
-- Datum: 23. April 2026
-- ============================================================================

CREATE TABLE IF NOT EXISTS up_downsells_source_files (
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

CREATE INDEX IF NOT EXISTS idx_up_downsells_source_files_modified_at
  ON up_downsells_source_files(modified_at DESC);

CREATE INDEX IF NOT EXISTS idx_up_downsells_source_files_status
  ON up_downsells_source_files(status);

ALTER TABLE up_downsells_import_runs
  ADD COLUMN IF NOT EXISTS source_file_name TEXT,
  ADD COLUMN IF NOT EXISTS csv_entry_name TEXT,
  ADD COLUMN IF NOT EXISTS zip_entries INTEGER NOT NULL DEFAULT 0;
