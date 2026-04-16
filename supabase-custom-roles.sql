-- =====================================================
-- Dynamische Rollenverwaltung
-- Datum: 2026-03-26
-- =====================================================

-- 1) Tabelle für dynamische Rollen
CREATE TABLE IF NOT EXISTS custom_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  role_key TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  description TEXT,
  areas JSONB NOT NULL DEFAULT '["new_business"]'::jsonb,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT custom_roles_role_key_format CHECK (role_key ~ '^[a-z][a-z0-9_]{2,63}$')
);

CREATE INDEX IF NOT EXISTS idx_custom_roles_active ON custom_roles(is_active);

DROP TRIGGER IF EXISTS custom_roles_updated_at ON custom_roles;
CREATE TRIGGER custom_roles_updated_at
BEFORE UPDATE ON custom_roles
FOR EACH ROW
EXECUTE FUNCTION update_updated_at();

-- 2) role_permissions.role für neue Rollen öffnen (legacy CHECK entfernen)
ALTER TABLE role_permissions DROP CONSTRAINT IF EXISTS role_permissions_role_check;

-- 3) users.role CHECK aufheben, damit dynamische Rollen zugewiesen werden können
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;

-- 4) RLS für custom_roles
ALTER TABLE custom_roles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "custom_roles_read_all_auth" ON custom_roles;
CREATE POLICY "custom_roles_read_all_auth" ON custom_roles
  FOR SELECT
  USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "custom_roles_write_managers" ON custom_roles;
CREATE POLICY "custom_roles_write_managers" ON custom_roles
  FOR ALL
  USING (
    EXISTS (
      SELECT 1
      FROM users
      WHERE users.id = auth.uid()
        AND users.role IN ('country_manager', 'dlt_member')
    )
  );
