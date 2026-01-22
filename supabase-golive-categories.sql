-- =====================================================
-- SQL Migration: Go-Live Kategorien + Google Sheets Integration
-- Version: v4.1
-- Datum: 2026-01-18
-- 
-- Diese Migration fügt neue Spalten zur ae_settings Tabelle hinzu:
-- - monthly_inbound_targets: Inbound Go-Lives pro Monat
-- - monthly_outbound_targets: Outbound Go-Lives pro Monat  
-- - monthly_partnerships_targets: Partnerships Go-Lives pro Monat
-- - monthly_pay_arr_targets: Pay ARR Targets direkt aus Sheet
-- - google_sheet_url: URL zum Google Sheet
-- - use_google_sheet: Toggle für Sheet-Integration
-- - last_sheet_sync: Zeitstempel der letzten Synchronisation
-- =====================================================

-- 1. Neue Spalten hinzufügen
ALTER TABLE ae_settings
ADD COLUMN IF NOT EXISTS monthly_inbound_targets jsonb DEFAULT '[15, 18, 19, 30, 24, 19, 19, 17, 29, 29, 27, 11]'::jsonb,
ADD COLUMN IF NOT EXISTS monthly_outbound_targets jsonb DEFAULT '[5, 6, 6, 10, 8, 7, 6, 6, 10, 10, 9, 4]'::jsonb,
ADD COLUMN IF NOT EXISTS monthly_partnerships_targets jsonb DEFAULT '[5, 6, 7, 9, 7, 6, 6, 5, 9, 9, 9, 3]'::jsonb,
ADD COLUMN IF NOT EXISTS monthly_pay_arr_targets jsonb DEFAULT NULL,
ADD COLUMN IF NOT EXISTS google_sheet_url text DEFAULT NULL,
ADD COLUMN IF NOT EXISTS use_google_sheet boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS last_sheet_sync timestamptz DEFAULT NULL;

-- 2. Kommentare für Dokumentation
COMMENT ON COLUMN ae_settings.monthly_inbound_targets IS 'Inbound Go-Lives pro Monat (12 Werte)';
COMMENT ON COLUMN ae_settings.monthly_outbound_targets IS 'Outbound Go-Lives pro Monat (12 Werte)';
COMMENT ON COLUMN ae_settings.monthly_partnerships_targets IS 'Partnerships Go-Lives pro Monat (12 Werte)';
COMMENT ON COLUMN ae_settings.monthly_pay_arr_targets IS 'Pay ARR Targets direkt aus Google Sheet (12 Werte, ersetzt pay_arr_factor Berechnung)';
COMMENT ON COLUMN ae_settings.google_sheet_url IS 'URL zum Google Sheet für automatische Synchronisation';
COMMENT ON COLUMN ae_settings.use_google_sheet IS 'Ob Daten aus Google Sheet geladen werden sollen';
COMMENT ON COLUMN ae_settings.last_sheet_sync IS 'Zeitstempel der letzten Google Sheet Synchronisation';

-- 3. Optional: Bestehende Daten migrieren
-- Verteile bestehende monthly_go_live_targets auf die drei Kategorien
-- (60% Inbound, 20% Outbound, 20% Partnerships als Schätzung)
-- 
-- HINWEIS: Diese Migration ist optional und nur einmal auszuführen
-- Kommentiere sie aus, wenn du die bestehenden Werte behalten möchtest

/*
UPDATE ae_settings
SET 
  monthly_inbound_targets = (
    SELECT jsonb_agg(ROUND(value::numeric * 0.6)::int)
    FROM jsonb_array_elements(monthly_go_live_targets) AS value
  ),
  monthly_outbound_targets = (
    SELECT jsonb_agg(ROUND(value::numeric * 0.2)::int)
    FROM jsonb_array_elements(monthly_go_live_targets) AS value
  ),
  monthly_partnerships_targets = (
    SELECT jsonb_agg(ROUND(value::numeric * 0.2)::int)
    FROM jsonb_array_elements(monthly_go_live_targets) AS value
  )
WHERE monthly_inbound_targets IS NULL 
   OR monthly_inbound_targets = '[15, 18, 19, 30, 24, 19, 19, 17, 29, 29, 27, 11]'::jsonb;
*/

-- 4. Verifizierung
SELECT 
  'Neue Spalten erfolgreich hinzugefügt' AS status,
  COUNT(*) AS total_settings,
  COUNT(*) FILTER (WHERE use_google_sheet = true) AS google_sheet_enabled
FROM ae_settings;

-- =====================================================
-- ROLLBACK (falls nötig)
-- =====================================================
/*
ALTER TABLE ae_settings
DROP COLUMN IF EXISTS monthly_inbound_targets,
DROP COLUMN IF EXISTS monthly_outbound_targets,
DROP COLUMN IF EXISTS monthly_partnerships_targets,
DROP COLUMN IF EXISTS monthly_pay_arr_targets,
DROP COLUMN IF EXISTS google_sheet_url,
DROP COLUMN IF EXISTS use_google_sheet,
DROP COLUMN IF EXISTS last_sheet_sync;
*/
