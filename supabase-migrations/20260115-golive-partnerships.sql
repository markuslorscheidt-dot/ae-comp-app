-- ============================================================================
-- GO-LIVE IMPORT FEATURE: PARTNERSHIPS & ENTERPRISE SUPPORT
-- Version: v3.17.0
-- Datum: 15.01.2026
-- ============================================================================

-- ============================================================================
-- 1. NEUE TABELLE: partners
-- ============================================================================

CREATE TABLE IF NOT EXISTS partners (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Kommentar
COMMENT ON TABLE partners IS 'Partner-Unternehmen für Partnership-Deals (L''Oréal, Wella, etc.)';

-- RLS aktivieren
ALTER TABLE partners ENABLE ROW LEVEL SECURITY;

-- RLS Policies für partners
CREATE POLICY "Partners sind für alle authentifizierten User sichtbar"
  ON partners FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Admins und Head of Partnerships können Partner anlegen"
  ON partners FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM users 
      WHERE users.id = auth.uid() 
      AND users.role IN ('country_manager', 'line_manager', 'head_of_partnerships')
    )
  );

CREATE POLICY "Admins können Partner bearbeiten"
  ON partners FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users 
      WHERE users.id = auth.uid() 
      AND users.role IN ('country_manager', 'line_manager')
    )
  );

CREATE POLICY "Admins können Partner löschen"
  ON partners FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users 
      WHERE users.id = auth.uid() 
      AND users.role IN ('country_manager', 'line_manager')
    )
  );

-- Index für Performance
CREATE INDEX IF NOT EXISTS idx_partners_name ON partners(name);

-- ============================================================================
-- 2. ERWEITERTE TABELLE: go_lives
-- ============================================================================

-- Neue Spalten hinzufügen (falls nicht vorhanden)
DO $$ 
BEGIN
  -- partner_id Spalte
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'go_lives' AND column_name = 'partner_id'
  ) THEN
    ALTER TABLE go_lives ADD COLUMN partner_id UUID REFERENCES partners(id) ON DELETE SET NULL;
    COMMENT ON COLUMN go_lives.partner_id IS 'Partner-Zuordnung für Partnership-Deals (zählt zu Head of Partnerships ARR)';
  END IF;

  -- is_enterprise Spalte
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'go_lives' AND column_name = 'is_enterprise'
  ) THEN
    ALTER TABLE go_lives ADD COLUMN is_enterprise BOOLEAN DEFAULT false NOT NULL;
    COMMENT ON COLUMN go_lives.is_enterprise IS 'Enterprise-Deal Flag (zählt zu Head of Partnerships ARR)';
  END IF;

  -- oakid Spalte (TEXT für Salesforce OAKID - zusätzlich zum bestehenden oak_id)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'go_lives' AND column_name = 'oakid'
  ) THEN
    ALTER TABLE go_lives ADD COLUMN oakid TEXT;
    COMMENT ON COLUMN go_lives.oakid IS 'Salesforce OAKID (Text) für Import-Verlinkung und Duplikat-Erkennung';
  END IF;

  -- opportunity_id Spalte (falls nicht vorhanden - für Verknüpfung mit Pipeline)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'go_lives' AND column_name = 'opportunity_id'
  ) THEN
    ALTER TABLE go_lives ADD COLUMN opportunity_id UUID REFERENCES opportunities(id) ON DELETE SET NULL;
    COMMENT ON COLUMN go_lives.opportunity_id IS 'Verknüpfung zur Pipeline-Opportunity';
  END IF;
END $$;

-- Indices für Performance
CREATE INDEX IF NOT EXISTS idx_go_lives_partner_id ON go_lives(partner_id);
CREATE INDEX IF NOT EXISTS idx_go_lives_is_enterprise ON go_lives(is_enterprise);
CREATE INDEX IF NOT EXISTS idx_go_lives_oakid ON go_lives(oakid);
CREATE INDEX IF NOT EXISTS idx_go_lives_partnerships 
  ON go_lives(partner_id, is_enterprise, go_live_date);

-- ============================================================================
-- 3. USER ROLE: head_of_partnerships
-- ============================================================================

-- Hinweis: Die App verwendet aktuell keine ENUM-Types für user_role,
-- sondern speichert die Rolle als TEXT. Daher müssen wir nur sicherstellen,
-- dass die neue Rolle in der App-Logik unterstützt wird.

-- Falls du später einen ENUM-Type verwendest, wäre das der Befehl:
-- ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'head_of_partnerships';

-- Für jetzt: Silke's Rolle updaten (falls gewünscht - auskommentiert)
-- UPDATE users 
-- SET role = 'head_of_partnerships' 
-- WHERE name ILIKE '%Silke%Späth%' OR name ILIKE '%Silke%Hecht%';

-- ============================================================================
-- 4. HILFSFUNKTION: Partnerships-ARR Berechnung
-- ============================================================================

-- View für Partnerships-ARR pro Monat (für Silke's Dashboard)
CREATE OR REPLACE VIEW partnerships_arr_monthly AS
SELECT 
  DATE_TRUNC('month', go_live_date) as month,
  COUNT(*) as go_live_count,
  SUM(subs_arr) as total_subs_arr,
  SUM(CASE WHEN partner_id IS NOT NULL THEN subs_arr ELSE 0 END) as partner_arr,
  SUM(CASE WHEN is_enterprise = true THEN subs_arr ELSE 0 END) as enterprise_arr,
  -- Partnerships-ARR: Partner ODER Enterprise (nicht doppelt zählen!)
  SUM(CASE WHEN partner_id IS NOT NULL OR is_enterprise = true THEN subs_arr ELSE 0 END) as partnerships_arr
FROM go_lives
WHERE go_live_date IS NOT NULL
GROUP BY DATE_TRUNC('month', go_live_date)
ORDER BY month DESC;

-- ============================================================================
-- 5. BEISPIEL-PARTNER (optional - auskommentiert)
-- ============================================================================

-- Falls du direkt Partner anlegen möchtest:
-- INSERT INTO partners (name) VALUES 
--   ('L''Oréal Professional'),
--   ('Wella'),
--   ('Schwarzkopf Professional'),
--   ('Kérastase'),
--   ('Redken')
-- ON CONFLICT (name) DO NOTHING;

-- ============================================================================
-- MIGRATION ABGESCHLOSSEN
-- ============================================================================

-- Bestätigung (kann in Supabase SQL Editor ausgeführt werden)
SELECT 
  'Migration erfolgreich!' as status,
  (SELECT COUNT(*) FROM partners) as partners_count,
  (SELECT COUNT(*) FROM go_lives WHERE partner_id IS NOT NULL) as partnership_go_lives,
  (SELECT COUNT(*) FROM go_lives WHERE is_enterprise = true) as enterprise_go_lives;
