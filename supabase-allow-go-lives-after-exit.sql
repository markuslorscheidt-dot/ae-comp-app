-- ============================================================================
-- GO_LIVES: Vor/Nach Zeitraum erlauben (Warnung statt Blocker)
-- Datum: 04. März 2026
-- ============================================================================
--
-- Business-Entscheidung:
-- - Go-Lives vor Eintrittsdatum werden zugelassen, aber als NOTICE protokolliert.
-- - Go-Lives nach Austrittsdatum werden ebenfalls zugelassen und als NOTICE
--   protokolliert.
--
-- Hinweis:
-- Diese Migration überschreibt die vorhandene Trigger-Funktion
-- validate_go_live_user_assignment().
-- ============================================================================

CREATE OR REPLACE FUNCTION validate_go_live_user_assignment()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_entry_date DATE;
  v_exit_date DATE;
BEGIN
  SELECT entry_date, exit_date
  INTO v_entry_date, v_exit_date
  FROM users
  WHERE id = NEW.user_id;

  IF v_entry_date IS NOT NULL AND NEW.go_live_date::date < v_entry_date THEN
    RAISE NOTICE 'Go-Live liegt vor Eintrittsdatum (zugelassen): user_id=%, go_live_date=%, entry_date=%',
      NEW.user_id, NEW.go_live_date::date, v_entry_date;
  END IF;

  IF v_exit_date IS NOT NULL AND NEW.go_live_date::date > v_exit_date THEN
    RAISE NOTICE 'Go-Live liegt nach Austrittsdatum (zugelassen): user_id=%, go_live_date=%, exit_date=%',
      NEW.user_id, NEW.go_live_date::date, v_exit_date;
  END IF;

  RETURN NEW;
END;
$$;

