/* Patch: Pay-Ist (pay_arr) trotz go_live_manual_write_locked speicherbar.
   Nach supabase-go-live-manual-write-lock.sql ausfuehren. Ersetzt nur die Funktion. */

CREATE OR REPLACE FUNCTION enforce_go_lives_manual_write_lock()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  manual_locked BOOLEAN;
BEGIN
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
    IF TG_OP = 'UPDATE' THEN
      IF (to_jsonb(NEW) - 'pay_arr' - 'updated_at')
         IS NOT DISTINCT FROM (to_jsonb(OLD) - 'pay_arr' - 'updated_at') THEN
        RETURN NEW;
      END IF;
    END IF;

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
