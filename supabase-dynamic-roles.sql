-- =====================================================
-- Dynamische Rollenverwaltung (UI "Rolle hinzufügen")
-- Datum: 2026-03-26
-- =====================================================

-- 1) Rollen-Metadaten
CREATE TABLE IF NOT EXISTS app_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  role_key TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  description TEXT,
  areas JSONB NOT NULL DEFAULT '[]'::jsonb,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT app_roles_key_format CHECK (role_key ~ '^[a-z][a-z0-9_]{2,63}$')
);

CREATE INDEX IF NOT EXISTS idx_app_roles_role_key ON app_roles(role_key);
CREATE INDEX IF NOT EXISTS idx_app_roles_active ON app_roles(is_active);

-- Trigger fuer updated_at (bestehende Funktion im Projekt)
DROP TRIGGER IF EXISTS app_roles_updated_at ON app_roles;
CREATE TRIGGER app_roles_updated_at
BEFORE UPDATE ON app_roles
FOR EACH ROW
EXECUTE FUNCTION update_updated_at();

-- 2) RLS
ALTER TABLE app_roles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "app_roles_read_all_auth" ON app_roles;
CREATE POLICY "app_roles_read_all_auth" ON app_roles
FOR SELECT USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "app_roles_write_country_manager" ON app_roles;
CREATE POLICY "app_roles_write_country_manager" ON app_roles
FOR ALL USING (
  EXISTS (
    SELECT 1
    FROM users
    WHERE users.id = auth.uid()
      AND users.role IN ('country_manager', 'dlt_member')
  )
);

-- 3) Optional: users.role Constraint entfernen (damit dynamische Rollen zuweisbar sind)
-- Falls ihr bereits mit `users_role_check` arbeitet, muss die Constraint geloest oder dynamisch ersetzt werden.
-- ACHTUNG: Nur ausfuehren, wenn ihr dynamische Rollen wirklich produktiv zuweisen wollt.
--
-- ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
