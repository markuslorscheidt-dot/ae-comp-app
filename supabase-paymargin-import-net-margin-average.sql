-- ============================================================================
-- PAYMARGIN Import-Historie: Durchschnitt Net Margin pro Commit speichern
-- Datum: 13. April 2026
-- ============================================================================

ALTER TABLE paymargin_import_runs
  ADD COLUMN IF NOT EXISTS imported_oak_ids_count INTEGER NOT NULL DEFAULT 0;

ALTER TABLE paymargin_import_runs
  ADD COLUMN IF NOT EXISTS avg_net_margin_monthly NUMERIC(12, 2);

