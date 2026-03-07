-- ============================================================================
-- GO_LIVES: Manueller Schreibschutz (Default: aktiv)
-- Datum: 07. Maerz 2026
-- ============================================================================
--
-- Zweck:
-- - Manuelle Writes auf go_lives (INSERT/UPDATE/DELETE) zentral sperren/freigeben
-- - Standard ist gesperrt (enabled = true)
-- - Service-Role (z. B. Batch-Import API) darf weiterhin schreiben
-- ============================================================================

BEGIN;

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
VALUES ('go_live_manual_write_locked', true)
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION enforce_go_lives_manual_write_lock()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  manual_locked BOOLEAN;
BEGIN
  -- Service-Role darf immer (Batch-Import/Backend-Jobs)
  IF auth.role() = 'service_role' THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NEW;
  END IF;

  SELECT enabled
  INTO manual_locked
  FROM import_controls
  WHERE key = 'go_live_manual_write_locked';

  IF COALESCE(manual_locked, true) THEN
    RAISE EXCEPTION
      USING MESSAGE = 'MANUAL_GO_LIVE_WRITE_LOCKED',
            HINT = 'Manuelle Go-Live-Erfassung ist aktuell schreibgeschuetzt.';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_go_lives_manual_write_lock ON go_lives;
CREATE TRIGGER trg_enforce_go_lives_manual_write_lock
BEFORE INSERT OR UPDATE OR DELETE ON go_lives
FOR EACH ROW
EXECUTE FUNCTION enforce_go_lives_manual_write_lock();

COMMIT;
