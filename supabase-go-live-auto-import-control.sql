-- ============================================================================
-- GO_LIVES: Persistente Auto-Import-Flag fuer Cron
-- Datum: 04. Maerz 2026
-- ============================================================================
--
-- Zweck:
-- - Speichert zentral, ob der Go-Live Auto-Import aktiv ist.
-- - Cron-Endpoint importiert nur bei enabled = true.
-- ============================================================================

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
VALUES ('go_live_auto_import_enabled', false)
ON CONFLICT (key) DO NOTHING;

