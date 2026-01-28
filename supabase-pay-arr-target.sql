-- =============================================
-- Migration: pay_arr_target Spalte hinzufügen
-- =============================================
-- Datum: 2026-01-27
-- Beschreibung: Fügt die pay_arr_target Spalte zur go_lives Tabelle hinzu
--               für die M0/M3 Clawback-Berechnung

-- 1. Spalte hinzufügen (falls nicht existiert)
ALTER TABLE go_lives 
ADD COLUMN IF NOT EXISTS pay_arr_target NUMERIC(10,2) DEFAULT NULL;

-- 2. Kommentar zur Spalte
COMMENT ON COLUMN go_lives.pay_arr_target IS 'Pay ARR Target bei Go-Live (avg_pay_bill × 12), für M0 Provision';

-- 3. Existierende Go-Lives mit Terminal aktualisieren
-- Setzt pay_arr_target auf €145 × 12 = €1.740 für alle Go-Lives mit Terminal
-- WICHTIG: Passe den Wert 145 an deinen avg_pay_bill Wert an!
UPDATE go_lives 
SET pay_arr_target = 145 * 12
WHERE has_terminal = true 
  AND pay_arr_target IS NULL;

-- 4. Prüfung: Zeige aktualisierte Einträge
SELECT 
  id,
  customer_name,
  has_terminal,
  pay_arr_target,
  pay_arr
FROM go_lives 
WHERE has_terminal = true
ORDER BY created_at DESC
LIMIT 20;
