-- =============================================
-- Migration: avg_pay_bill_tipping + target_percentage
-- Datum: 2026-01-18
-- Beschreibung: Neue Felder für Pay Bill Tipping und AE-Prozentsatz
-- =============================================

-- 1. avg_pay_bill_tipping Feld hinzufügen
ALTER TABLE ae_settings
ADD COLUMN IF NOT EXISTS avg_pay_bill_tipping NUMERIC DEFAULT 30;

UPDATE ae_settings
SET avg_pay_bill_tipping = 30
WHERE avg_pay_bill_tipping IS NULL;

COMMENT ON COLUMN ae_settings.avg_pay_bill_tipping IS 'Durchschnittlicher monatlicher Pay Bill für Tipping-Terminals (€30 default)';

-- 2. target_percentage Feld hinzufügen
ALTER TABLE ae_settings
ADD COLUMN IF NOT EXISTS target_percentage NUMERIC DEFAULT NULL;

COMMENT ON COLUMN ae_settings.target_percentage IS 'Prozentuale Verteilung der Business Targets auf diesen AE (z.B. 60 = 60%)';

-- =============================================
-- Rollback (falls nötig):
-- ALTER TABLE ae_settings DROP COLUMN IF EXISTS avg_pay_bill_tipping;
-- ALTER TABLE ae_settings DROP COLUMN IF EXISTS target_percentage;
-- =============================================
