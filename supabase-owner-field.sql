-- ============================================
-- SF OWNER NAME FELD FÜR OPPORTUNITIES
-- Version: 3.16.18
-- Datum: 14.01.2026
-- ============================================

-- Neues Feld für Original Salesforce Owner Name
-- Speichert den Owner-Namen aus SF auch wenn kein App-User Match
ALTER TABLE opportunities 
ADD COLUMN IF NOT EXISTS sf_owner_name VARCHAR(255);

-- Kommentar für Dokumentation
COMMENT ON COLUMN opportunities.sf_owner_name IS 
'Original Salesforce Owner Name - wird beim Import gespeichert, auch wenn kein App-User Match existiert. Ermöglicht Win-Rate Analyse nach ehemaligem AE.';

-- Index für schnelle Suche nach unassigned Opportunities
CREATE INDEX IF NOT EXISTS idx_opportunities_unassigned 
ON opportunities(user_id) WHERE user_id IS NULL;

-- ============================================
-- HINWEIS:
-- Nach diesem Update:
-- - sf_owner_name speichert immer den Original-Namen aus Salesforce
-- - user_id kann NULL sein für "unassigned" Opportunities
-- - UI zeigt "⚠️ {SF-Name}" wenn kein App-User zugewiesen
-- ============================================
