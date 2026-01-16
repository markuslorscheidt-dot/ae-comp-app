-- =====================================================
-- SPRACH-UPDATE für AE Kompensationsmodell v2.3
-- Führe dieses SQL in Supabase SQL Editor aus
-- =====================================================

-- Sprache-Spalte zur profiles Tabelle hinzufügen
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS language TEXT DEFAULT 'de';

-- Constraint für gültige Sprachen
ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_language_check;
ALTER TABLE profiles ADD CONSTRAINT profiles_language_check 
  CHECK (language IN ('de', 'en', 'ksh'));
