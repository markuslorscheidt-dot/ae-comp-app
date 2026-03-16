-- AE Settings: OTC/Multiple Modell (rueckwaertskompatibel)
-- Fuegt neue Spalten hinzu, ohne bestehende Logik zu brechen.

ALTER TABLE ae_settings
  ADD COLUMN IF NOT EXISTS base_salary NUMERIC,
  ADD COLUMN IF NOT EXISTS variable_ote NUMERIC,
  ADD COLUMN IF NOT EXISTS arr_multiple NUMERIC,
  ADD COLUMN IF NOT EXISTS gross_margin_pct NUMERIC,
  ADD COLUMN IF NOT EXISTS monthly_total_arr_targets NUMERIC[],
  ADD COLUMN IF NOT EXISTS total_arr_tiers JSONB;

-- Sinnvolle Defaults fuer Bestandsdaten (nur setzen, wenn leer)
UPDATE ae_settings
SET
  base_salary = COALESCE(base_salary, 42000),
  variable_ote = COALESCE(variable_ote, ote),
  arr_multiple = COALESCE(arr_multiple, 5),
  gross_margin_pct = COALESCE(gross_margin_pct, 70),
  monthly_total_arr_targets = COALESCE(
    monthly_total_arr_targets,
    ARRAY(
      SELECT
        COALESCE((to_jsonb(monthly_subs_targets) ->> (i - 1))::numeric, 0)
        + COALESCE((to_jsonb(monthly_pay_targets) ->> (i - 1))::numeric, 0)
      FROM generate_series(1, 12) AS s(i)
    )
  ),
  total_arr_tiers = COALESCE(total_arr_tiers, to_jsonb(subs_tiers))
WHERE
  base_salary IS NULL
  OR variable_ote IS NULL
  OR arr_multiple IS NULL
  OR gross_margin_pct IS NULL
  OR monthly_total_arr_targets IS NULL
  OR total_arr_tiers IS NULL;
