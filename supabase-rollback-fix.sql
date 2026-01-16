-- ============================================
-- CLEANUP + RLS FIX FÜR ROLLBACK
-- Version: 3.16.18
-- Datum: 14.01.2026
-- ============================================

-- ============================================
-- TEIL 1: DATEN CLEANUP (einmalig ausführen)
-- ============================================

-- Schritt 1: Staging-Referenzen aufräumen
UPDATE import_staging SET created_opportunity_id = NULL, created_lead_id = NULL;

-- Schritt 2: Opportunities löschen
DELETE FROM opportunities WHERE import_batch_id = '0a0f3cd8-671f-4f2c-845e-c33d56e2dda5';

-- Schritt 3: Leads löschen
DELETE FROM leads WHERE import_batch_id = '0a0f3cd8-671f-4f2c-845e-c33d56e2dda5';

-- Schritt 4: Staging-Daten aufräumen (optional)
DELETE FROM import_staging;

-- Prüfen ob alles weg ist:
SELECT 'opportunities' as table_name, COUNT(*) as count FROM opportunities
UNION ALL
SELECT 'leads', COUNT(*) FROM leads
UNION ALL
SELECT 'import_staging', COUNT(*) FROM import_staging;


-- ============================================
-- TEIL 2: RLS POLICIES FÜR DELETE FIXEN
-- ============================================

-- Opportunities: DELETE Policy für Manager
DROP POLICY IF EXISTS "opportunities_delete_policy" ON opportunities;
CREATE POLICY "opportunities_delete_policy" ON opportunities
  FOR DELETE
  USING (
    -- User kann eigene Opportunities löschen
    auth.uid() = user_id
    OR
    -- Manager können alle löschen
    EXISTS (
      SELECT 1 FROM users 
      WHERE users.id = auth.uid() 
      AND users.role IN ('country_manager', 'line_manager')
    )
    OR
    -- Importierte Opportunities (import_batch_id gesetzt) können gelöscht werden
    import_batch_id IS NOT NULL
  );

-- Leads: DELETE Policy für Manager
DROP POLICY IF EXISTS "leads_delete_policy" ON leads;
CREATE POLICY "leads_delete_policy" ON leads
  FOR DELETE
  USING (
    -- User kann eigene Leads löschen
    auth.uid() = user_id
    OR
    -- Manager können alle löschen
    EXISTS (
      SELECT 1 FROM users 
      WHERE users.id = auth.uid() 
      AND users.role IN ('country_manager', 'line_manager')
    )
    OR
    -- Importierte Leads (import_batch_id gesetzt) können gelöscht werden
    import_batch_id IS NOT NULL
  );

-- Import Staging: DELETE Policy
DROP POLICY IF EXISTS "import_staging_delete_policy" ON import_staging;
CREATE POLICY "import_staging_delete_policy" ON import_staging
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM users 
      WHERE users.id = auth.uid() 
      AND users.role IN ('country_manager', 'line_manager')
    )
  );

-- ============================================
-- TEIL 3: PRÜFEN OB POLICIES AKTIV SIND
-- ============================================

-- Zeigt alle Policies für die relevanten Tabellen
SELECT schemaname, tablename, policyname, cmd, qual 
FROM pg_policies 
WHERE tablename IN ('opportunities', 'leads', 'import_staging')
ORDER BY tablename, policyname;
