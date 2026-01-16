-- ============================================
-- Migration: sf_created_date Feld hinzufügen
-- Version: 3.16.30
-- Datum: 15.01.2026
-- ============================================

-- Neues Feld für Salesforce Erstelldatum
-- Dieses Feld speichert das Original-Erstelldatum aus Salesforce,
-- nicht das Datum wann der Datensatz in diese App importiert wurde.

ALTER TABLE opportunities 
ADD COLUMN IF NOT EXISTS sf_created_date DATE;

-- Kommentar zur Dokumentation
COMMENT ON COLUMN opportunities.sf_created_date IS 'Salesforce Erstelldatum (aus CSV Import). Unterscheidet sich von created_at, welches das Import-Datum ist.';

-- Index für bessere Performance bei Datumsfiltern
CREATE INDEX IF NOT EXISTS idx_opportunities_sf_created_date 
ON opportunities(sf_created_date);

-- ============================================
-- WICHTIG: Nach dieser Migration muss ein 
-- neuer CSV-Import durchgeführt werden, damit
-- das sf_created_date Feld befüllt wird!
-- ============================================
