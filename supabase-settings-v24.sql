-- =====================================================
-- SETTINGS-UPDATE für AE Kompensationsmodell v2.4
-- Führe dieses SQL in Supabase SQL Editor aus
-- =====================================================

-- Neue Spalten für ae_settings hinzufügen
ALTER TABLE ae_settings 
  ADD COLUMN IF NOT EXISTS monthly_go_live_targets JSONB DEFAULT '[25, 30, 32, 49, 39, 32, 31, 28, 48, 48, 45, 18]',
  ADD COLUMN IF NOT EXISTS avg_subs_bill NUMERIC DEFAULT 155,
  ADD COLUMN IF NOT EXISTS avg_pay_bill NUMERIC DEFAULT 162,
  ADD COLUMN IF NOT EXISTS pay_arr_factor NUMERIC DEFAULT 0.75;

-- Aktualisiere bestehende Einträge mit neuen Default-Werten
UPDATE ae_settings
SET 
  monthly_go_live_targets = '[25, 30, 32, 49, 39, 32, 31, 28, 48, 48, 45, 18]'::jsonb,
  avg_subs_bill = 155,
  avg_pay_bill = 162,
  pay_arr_factor = 0.75
WHERE monthly_go_live_targets IS NULL;

-- Aktualisiere die monatlichen ARR-Ziele mit den neuen Werten (basierend auf Excel)
UPDATE ae_settings
SET 
  monthly_subs_targets = '[46500, 55800, 59520, 91140, 72540, 59520, 57660, 52080, 89280, 89280, 83700, 33480]'::jsonb,
  monthly_pay_targets = '[34875, 41850, 44640, 68355, 54405, 44640, 43245, 39060, 66960, 66960, 62775, 25110]'::jsonb
WHERE user_id IS NOT NULL;

-- Aktualisiere die Provisions-Stufen mit den neuen Raten (aus Screenshot)
UPDATE ae_settings
SET 
  subs_tiers = '[
    {"label":"< 50%","min":0,"max":0.5,"rate":0},
    {"label":"50% - 70%","min":0.5,"max":0.7,"rate":0.015},
    {"label":"70% - 85%","min":0.7,"max":0.85,"rate":0.02},
    {"label":"85% - 100%","min":0.85,"max":1.0,"rate":0.025},
    {"label":"100% - 110%","min":1.0,"max":1.1,"rate":0.029},
    {"label":"110% - 120%","min":1.1,"max":1.2,"rate":0.04},
    {"label":"120%+","min":1.2,"max":999,"rate":0.05}
  ]'::jsonb,
  pay_tiers = '[
    {"label":"< 50%","min":0,"max":0.5,"rate":0.01},
    {"label":"50% - 70%","min":0.5,"max":0.7,"rate":0.015},
    {"label":"70% - 85%","min":0.7,"max":0.85,"rate":0.02},
    {"label":"85% - 100%","min":0.85,"max":1.0,"rate":0.025},
    {"label":"100% - 110%","min":1.0,"max":1.1,"rate":0.029},
    {"label":"110% - 120%","min":1.1,"max":1.2,"rate":0.04},
    {"label":"120%+","min":1.2,"max":999,"rate":0.05}
  ]'::jsonb
WHERE user_id IS NOT NULL;

-- Aktualisiere den Trigger für neue User mit den neuen Defaults
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, email, name, role, language)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1)),
    'ae',
    'de'
  );
  
  INSERT INTO public.ae_settings (
    user_id, year, region, ote,
    monthly_go_live_targets,
    avg_subs_bill, avg_pay_bill, pay_arr_factor,
    terminal_base, terminal_bonus, terminal_penetration_threshold,
    monthly_subs_targets, monthly_pay_targets,
    subs_tiers, pay_tiers
  ) VALUES (
    NEW.id, 2026, 'DACH', 57000,
    '[25, 30, 32, 49, 39, 32, 31, 28, 48, 48, 45, 18]',
    155, 162, 0.75,
    30, 50, 0.70,
    '[46500, 55800, 59520, 91140, 72540, 59520, 57660, 52080, 89280, 89280, 83700, 33480]',
    '[34875, 41850, 44640, 68355, 54405, 44640, 43245, 39060, 66960, 66960, 62775, 25110]',
    '[{"label":"< 50%","min":0,"max":0.5,"rate":0},{"label":"50% - 70%","min":0.5,"max":0.7,"rate":0.015},{"label":"70% - 85%","min":0.7,"max":0.85,"rate":0.02},{"label":"85% - 100%","min":0.85,"max":1.0,"rate":0.025},{"label":"100% - 110%","min":1.0,"max":1.1,"rate":0.029},{"label":"110% - 120%","min":1.1,"max":1.2,"rate":0.04},{"label":"120%+","min":1.2,"max":999,"rate":0.05}]',
    '[{"label":"< 50%","min":0,"max":0.5,"rate":0.01},{"label":"50% - 70%","min":0.5,"max":0.7,"rate":0.015},{"label":"70% - 85%","min":0.7,"max":0.85,"rate":0.02},{"label":"85% - 100%","min":0.85,"max":1.0,"rate":0.025},{"label":"100% - 110%","min":1.0,"max":1.1,"rate":0.029},{"label":"110% - 120%","min":1.1,"max":1.2,"rate":0.04},{"label":"120%+","min":1.2,"max":999,"rate":0.05}]'
  );
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Bestätigungsnachricht
SELECT 'Settings-Update v2.4 erfolgreich!' as status;
