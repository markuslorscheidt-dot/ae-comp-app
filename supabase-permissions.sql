-- =============================================
-- PERMISSIONS TABELLE
-- Speichert editierbare Berechtigungen pro Rolle
-- =============================================

-- Permissions Tabelle erstellen
CREATE TABLE IF NOT EXISTS role_permissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  role TEXT NOT NULL UNIQUE CHECK (role IN ('country_manager', 'line_manager', 'ae', 'sdr')),
  
  -- Berechtigungen (Boolean Flags)
  view_all_users BOOLEAN DEFAULT false,
  enter_own_go_lives BOOLEAN DEFAULT false,
  enter_go_lives_for_others BOOLEAN DEFAULT false,
  enter_pay_arr BOOLEAN DEFAULT false,
  edit_settings BOOLEAN DEFAULT false,
  edit_tiers BOOLEAN DEFAULT false,
  manage_users BOOLEAN DEFAULT false,
  assign_roles BOOLEAN DEFAULT false,
  view_all_reports BOOLEAN DEFAULT false,
  export_reports BOOLEAN DEFAULT false,
  has_admin_access BOOLEAN DEFAULT false,
  
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Index für Role-Abfragen
CREATE INDEX IF NOT EXISTS idx_role_permissions_role ON role_permissions(role);

-- Default-Werte für alle Rollen einfügen
INSERT INTO role_permissions (role, view_all_users, enter_own_go_lives, enter_go_lives_for_others, enter_pay_arr, edit_settings, edit_tiers, manage_users, assign_roles, view_all_reports, export_reports, has_admin_access)
VALUES 
  ('country_manager', true, true, true, true, true, true, true, true, true, true, true),
  ('line_manager', true, true, true, true, true, false, false, false, true, false, false),
  ('ae', false, true, false, false, false, false, false, false, false, true, false),
  ('sdr', false, false, false, false, false, false, false, false, false, false, false)
ON CONFLICT (role) DO NOTHING;

-- Row Level Security
ALTER TABLE role_permissions ENABLE ROW LEVEL SECURITY;

-- Alle können lesen
DROP POLICY IF EXISTS "Anyone can view permissions" ON role_permissions;
CREATE POLICY "Anyone can view permissions" ON role_permissions FOR SELECT USING (true);

-- Nur Country Manager und Line Manager können updaten (wird im Frontend weiter eingeschränkt)
DROP POLICY IF EXISTS "Managers can update permissions" ON role_permissions;
CREATE POLICY "Managers can update permissions" ON role_permissions FOR UPDATE USING (true);

-- Trigger für updated_at
DROP TRIGGER IF EXISTS role_permissions_updated_at ON role_permissions;
CREATE TRIGGER role_permissions_updated_at BEFORE UPDATE ON role_permissions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
