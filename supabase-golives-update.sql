-- ============================================
-- GO-LIVES TABELLE ERWEITERN
-- ============================================

-- OAK ID Spalte hinzufügen (falls noch nicht vorhanden)
ALTER TABLE go_lives ADD COLUMN IF NOT EXISTS oak_id INTEGER;

-- Commission Relevant Spalte hinzufügen
-- Default ist TRUE für bestehende Daten (alle existierenden Go-Lives sind AE-Go-Lives)
ALTER TABLE go_lives ADD COLUMN IF NOT EXISTS commission_relevant BOOLEAN DEFAULT true;

-- Kommentar für Dokumentation
COMMENT ON COLUMN go_lives.commission_relevant IS 'Wenn TRUE, wird dieser Go-Live für Provisionsberechnung berücksichtigt. AE-Go-Lives sind standardmäßig TRUE, Manager/Sonstiges-Go-Lives standardmäßig FALSE.';
COMMENT ON COLUMN go_lives.oak_id IS 'Externe OAK ID für Referenz zu anderen Systemen';
