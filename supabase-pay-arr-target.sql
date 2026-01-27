-- Migration: Pay ARR Target Feature
-- Datum: 2026-01-26
-- Beschreibung: Fügt pay_arr_target Feld zu go_lives hinzu für Target-basierte Pay Provision

-- 1. Neues Feld hinzufügen
ALTER TABLE go_lives ADD COLUMN IF NOT EXISTS pay_arr_target DECIMAL(10,2);

-- 2. Kommentar für Dokumentation
COMMENT ON COLUMN go_lives.pay_arr_target IS 'Pay ARR Target bei Go-Live (aus Einstellungen: avg_pay_bill_terminal × 12). Für M0 Provision.';

-- 3. Bestehende Go-Lives: pay_arr als Target setzen (falls vorhanden)
-- UPDATE go_lives SET pay_arr_target = pay_arr WHERE pay_arr IS NOT NULL AND pay_arr_target IS NULL;

-- Hinweis: Die Zeile oben ist auskommentiert. 
-- Führe sie manuell aus, wenn du bestehende Go-Lives migrieren möchtest.
