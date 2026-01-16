-- ============================================
-- ARCHIVE FEATURE FÜR OPPORTUNITIES UND LEADS
-- Version: 3.16.15
-- Datum: 14.01.2026
-- ============================================

-- 1. Archived Spalte zu opportunities hinzufügen
ALTER TABLE opportunities 
ADD COLUMN IF NOT EXISTS archived BOOLEAN DEFAULT false;

-- 2. Archived Spalte zu leads hinzufügen
ALTER TABLE leads 
ADD COLUMN IF NOT EXISTS archived BOOLEAN DEFAULT false;

-- 3. Index für schnellere Filterung
CREATE INDEX IF NOT EXISTS idx_opportunities_archived ON opportunities(archived);
CREATE INDEX IF NOT EXISTS idx_leads_archived ON leads(archived);

-- 4. Archived_at Timestamp (optional, für Audit-Trail)
ALTER TABLE opportunities 
ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;

ALTER TABLE leads 
ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;

-- ============================================
-- HINWEIS:
-- Nach dem Ausführen dieses Scripts werden:
-- - Archivierte Opportunities nicht mehr in der Pipeline angezeigt
-- - Archivierte Leads nicht mehr in der Lead-Liste angezeigt
-- - Beim Salesforce-Import werden auch archivierte Datensätze
--   anhand der SFID erkannt und nicht erneut importiert
-- ============================================
