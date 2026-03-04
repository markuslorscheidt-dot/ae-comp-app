-- ============================================================================
-- USER LIFECYCLE + ROLE HISTORY
-- Datum: 17. Februar 2026
-- ============================================================================

-- 1) Users um Lebenszyklus erweitern
ALTER TABLE users
ADD COLUMN IF NOT EXISTS entry_date DATE,
ADD COLUMN IF NOT EXISTS exit_date DATE,
ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true;

-- Backfill: start_date -> entry_date
UPDATE users
SET entry_date = start_date
WHERE entry_date IS NULL
  AND start_date IS NOT NULL;

-- Backfill: fehlendes Eintrittsdatum auf created_at (Tagesgenau)
UPDATE users
SET entry_date = created_at::date
WHERE entry_date IS NULL;

-- Backfill: is_active aus exit_date ableiten
UPDATE users
SET is_active = CASE
  WHEN exit_date IS NULL THEN true
  WHEN exit_date > CURRENT_DATE THEN true
  ELSE false
END
WHERE is_active IS NULL
   OR is_active <> CASE
     WHEN exit_date IS NULL THEN true
     WHEN exit_date > CURRENT_DATE THEN true
     ELSE false
   END;

-- Konsistenzcheck
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_employment_dates_check;
ALTER TABLE users
ADD CONSTRAINT users_employment_dates_check
CHECK (
  entry_date IS NULL
  OR exit_date IS NULL
  OR entry_date <= exit_date
);

-- Optional nützliche Indizes
CREATE INDEX IF NOT EXISTS idx_users_entry_date ON users(entry_date);
CREATE INDEX IF NOT EXISTS idx_users_exit_date ON users(exit_date);
CREATE INDEX IF NOT EXISTS idx_users_is_active ON users(is_active);


-- 2) Rollenhistorie (zeitbasiert)
CREATE TABLE IF NOT EXISTS user_role_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  effective_from DATE NOT NULL,
  effective_to DATE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID REFERENCES users(id),
  CONSTRAINT user_role_history_range_check CHECK (
    effective_to IS NULL OR effective_from <= effective_to
  )
);

CREATE INDEX IF NOT EXISTS idx_user_role_history_user_from
  ON user_role_history(user_id, effective_from);

CREATE INDEX IF NOT EXISTS idx_user_role_history_user_to
  ON user_role_history(user_id, effective_to);

-- Aktuelle Rolle als initiale Historie eintragen (falls noch keine Historie existiert)
INSERT INTO user_role_history (user_id, role, effective_from, effective_to, created_by)
SELECT
  u.id,
  u.role,
  COALESCE(u.entry_date, u.created_at::date) AS effective_from,
  NULL AS effective_to,
  NULL
FROM users u
WHERE NOT EXISTS (
  SELECT 1
  FROM user_role_history h
  WHERE h.user_id = u.id
);


-- 3) RLS für user_role_history
ALTER TABLE user_role_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "user_role_history_read_all_auth" ON user_role_history;
CREATE POLICY "user_role_history_read_all_auth" ON user_role_history
  FOR SELECT
  USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "user_role_history_write_managers" ON user_role_history;
CREATE POLICY "user_role_history_write_managers" ON user_role_history
  FOR ALL
  USING (
    EXISTS (
      SELECT 1
      FROM users
      WHERE users.id = auth.uid()
        AND users.role IN ('country_manager', 'dlt_member', 'line_manager_new_business')
    )
  );


-- 4) Hilfsfunktion: effektive Rolle an Datum
CREATE OR REPLACE FUNCTION get_effective_user_role_at_date(
  p_user_id UUID,
  p_date DATE
) RETURNS TEXT
LANGUAGE SQL
STABLE
AS $$
  SELECT h.role
  FROM user_role_history h
  WHERE h.user_id = p_user_id
    AND h.effective_from <= p_date
    AND (h.effective_to IS NULL OR h.effective_to >= p_date)
  ORDER BY h.effective_from DESC
  LIMIT 1
$$;


-- 5) Trigger: Go-Live wird auch außerhalb Beschäftigungszeitraum zugelassen
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

DROP TRIGGER IF EXISTS trg_validate_go_live_user_assignment ON go_lives;
CREATE TRIGGER trg_validate_go_live_user_assignment
BEFORE INSERT OR UPDATE ON go_lives
FOR EACH ROW
EXECUTE FUNCTION validate_go_live_user_assignment();


-- 6) Trigger: is_active automatisch aus exit_date ableiten
CREATE OR REPLACE FUNCTION sync_user_active_state()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.exit_date IS NULL THEN
    NEW.is_active := true;
  ELSIF NEW.exit_date > CURRENT_DATE THEN
    NEW.is_active := true;
  ELSE
    NEW.is_active := false;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_user_active_state ON users;
CREATE TRIGGER trg_sync_user_active_state
BEFORE INSERT OR UPDATE OF exit_date ON users
FOR EACH ROW
EXECUTE FUNCTION sync_user_active_state();

