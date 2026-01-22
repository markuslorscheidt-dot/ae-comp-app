-- =============================================
-- Migration: Subscription Packages
-- Datum: 2026-01-22
-- Beschreibung: Subscription-Paketverwaltung für Go-Lives
-- =============================================

-- 1. NEUE TABELLE: subscription_packages
CREATE TABLE IF NOT EXISTS subscription_packages (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name VARCHAR(100) NOT NULL UNIQUE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

COMMENT ON TABLE subscription_packages IS 'Subscription-Pakete (Kickstart, Power, Power Plus, etc.)';

-- RLS aktivieren
ALTER TABLE subscription_packages ENABLE ROW LEVEL SECURITY;

-- RLS Policies für subscription_packages
CREATE POLICY "Subscription Packages sind für alle authentifizierten User sichtbar"
  ON subscription_packages FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Admins können Subscription Packages anlegen"
  ON subscription_packages FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM users 
      WHERE users.id = auth.uid() 
      AND users.role IN (
        'country_manager',
        'line_manager_new_business',
        'line_manager_expanding_business',
        'line_manager_marketing',
        'dlt_member'
      )
    )
  );

CREATE POLICY "Admins können Subscription Packages bearbeiten"
  ON subscription_packages FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users 
      WHERE users.id = auth.uid() 
      AND users.role IN (
        'country_manager',
        'line_manager_new_business',
        'line_manager_expanding_business',
        'line_manager_marketing',
        'dlt_member'
      )
    )
  );

CREATE POLICY "Admins können Subscription Packages löschen"
  ON subscription_packages FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users 
      WHERE users.id = auth.uid() 
      AND users.role IN (
        'country_manager',
        'line_manager_new_business',
        'line_manager_expanding_business',
        'dlt_member'
      )
    )
  );

-- Index für schnelle Suche
CREATE INDEX IF NOT EXISTS idx_subscription_packages_name ON subscription_packages(name);

-- 2. NEUES FELD in go_lives
ALTER TABLE go_lives
ADD COLUMN IF NOT EXISTS subscription_package_id UUID REFERENCES subscription_packages(id) ON DELETE SET NULL;

COMMENT ON COLUMN go_lives.subscription_package_id IS 'Zugeordnetes Subscription-Paket (Kickstart, Power, etc.)';

-- Index für Join-Performance
CREATE INDEX IF NOT EXISTS idx_go_lives_subscription_package ON go_lives(subscription_package_id);

-- 3. INITIALE DATEN: Standard-Pakete
INSERT INTO subscription_packages (name) VALUES 
  ('Kickstart'),
  ('Power'),
  ('Power Plus')
ON CONFLICT (name) DO NOTHING;

-- =============================================
-- Rollback (falls nötig):
-- DROP TABLE IF EXISTS subscription_packages CASCADE;
-- ALTER TABLE go_lives DROP COLUMN IF EXISTS subscription_package_id;
-- =============================================
