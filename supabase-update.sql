-- =====================================================
-- DATENBANK-UPDATE für AE Kompensationsmodell v2
-- Führe dieses SQL in Supabase SQL Editor aus
-- =====================================================

-- Neue Spalten zu ae_settings hinzufügen
ALTER TABLE ae_settings 
ADD COLUMN IF NOT EXISTS monthly_subs_targets JSONB DEFAULT '[58799,70350,86800,91700,91700,86800,72800,65800,112700,112700,105000,42000]',
ADD COLUMN IF NOT EXISTS monthly_pay_targets JSONB DEFAULT '[25200,30150,37200,39300,39300,37200,31200,28200,48300,48300,45000,18000]',
ADD COLUMN IF NOT EXISTS subs_tiers JSONB DEFAULT '[{"label":"< 50%","min":0,"max":0.5,"rate":0},{"label":"50% - 70%","min":0.5,"max":0.7,"rate":0.055},{"label":"70% - 85%","min":0.7,"max":0.85,"rate":0.06},{"label":"85% - 100%","min":0.85,"max":1.0,"rate":0.065},{"label":"100% - 110%","min":1.0,"max":1.1,"rate":0.07},{"label":"110% - 120%","min":1.1,"max":1.2,"rate":0.08},{"label":"120%+","min":1.2,"max":999,"rate":0.10}]',
ADD COLUMN IF NOT EXISTS pay_tiers JSONB DEFAULT '[{"label":"< 50%","min":0,"max":0.5,"rate":0.10},{"label":"50% - 70%","min":0.5,"max":0.7,"rate":0.055},{"label":"70% - 85%","min":0.7,"max":0.85,"rate":0.06},{"label":"85% - 100%","min":0.85,"max":1.0,"rate":0.065},{"label":"100% - 110%","min":1.0,"max":1.1,"rate":0.07},{"label":"110% - 120%","min":1.1,"max":1.2,"rate":0.08},{"label":"120%+","min":1.2,"max":999,"rate":0.10}]';

-- Neue Spalten zu go_lives hinzufügen
ALTER TABLE go_lives
ADD COLUMN IF NOT EXISTS subs_monthly NUMERIC DEFAULT 0,
ADD COLUMN IF NOT EXISTS subs_arr NUMERIC DEFAULT 0;

-- Bestehende Daten aktualisieren (falls vorhanden)
UPDATE ae_settings 
SET 
  monthly_subs_targets = '[58799,70350,86800,91700,91700,86800,72800,65800,112700,112700,105000,42000]',
  monthly_pay_targets = '[25200,30150,37200,39300,39300,37200,31200,28200,48300,48300,45000,18000]',
  subs_tiers = '[{"label":"< 50%","min":0,"max":0.5,"rate":0},{"label":"50% - 70%","min":0.5,"max":0.7,"rate":0.055},{"label":"70% - 85%","min":0.7,"max":0.85,"rate":0.06},{"label":"85% - 100%","min":0.85,"max":1.0,"rate":0.065},{"label":"100% - 110%","min":1.0,"max":1.1,"rate":0.07},{"label":"110% - 120%","min":1.1,"max":1.2,"rate":0.08},{"label":"120%+","min":1.2,"max":999,"rate":0.10}]',
  pay_tiers = '[{"label":"< 50%","min":0,"max":0.5,"rate":0.10},{"label":"50% - 70%","min":0.5,"max":0.7,"rate":0.055},{"label":"70% - 85%","min":0.7,"max":0.85,"rate":0.06},{"label":"85% - 100%","min":0.85,"max":1.0,"rate":0.065},{"label":"100% - 110%","min":1.0,"max":1.1,"rate":0.07},{"label":"110% - 120%","min":1.1,"max":1.2,"rate":0.08},{"label":"120%+","min":1.2,"max":999,"rate":0.10}]'
WHERE monthly_subs_targets IS NULL;
