-- ============================================================================
-- GO_LIVES: month aus go_live_date ableiten
-- Datum: 17. Februar 2026
-- ============================================================================

-- 1) Backfill: bestehende Zeilen konsistent setzen
UPDATE go_lives
SET month = EXTRACT(MONTH FROM go_live_date)::INTEGER
WHERE go_live_date IS NOT NULL
  AND (
    month IS NULL
    OR month <> EXTRACT(MONTH FROM go_live_date)::INTEGER
  );

-- 2) Trigger-Funktion: month immer aus go_live_date ableiten
CREATE OR REPLACE FUNCTION sync_go_live_month_from_date()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.go_live_date IS NOT NULL THEN
    NEW.month := EXTRACT(MONTH FROM NEW.go_live_date)::INTEGER;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_go_live_month_from_date ON go_lives;
CREATE TRIGGER trg_sync_go_live_month_from_date
BEFORE INSERT OR UPDATE OF go_live_date ON go_lives
FOR EACH ROW
EXECUTE FUNCTION sync_go_live_month_from_date();

