-- ============================================================================
-- Reporting Views: Phorest Pay Revenue (Stripe Value Processed)
-- Datum: 15. April 2026
-- ============================================================================

-- Basis-View fuer die CSV:
-- dashboard-phorest_pay_revenue_by_channel_&_region/stripe_value_processed.csv
-- Die CSV hat ein Pivot-Layout, daher wird ueber technische Header-Felder gemappt:
-- _1      -> Activity Month
-- Region  -> Channel / Zeilentyp
-- DACH    -> DACH Total Transaction Value
-- _3      -> Global Total Transaction Value

CREATE OR REPLACE VIEW reporting_phorest_pay_revenue_stripe_processed_base AS
SELECT
  e.id,
  e.source_file_id,
  e.source_file_name,
  e.source_row_number,
  e.csv_entry_name,
  e.modified_at,
  e.created_at,
  e.updated_at,
  NULLIF(TRIM(e.payload ->> '_1'), '') AS activity_month_raw,
  NULLIF(TRIM(e.payload ->> 'Region'), '') AS region_or_channel_raw,
  CASE
    WHEN NULLIF(TRIM(e.payload ->> '_1'), '') = 'Activity Month' THEN 'header'
    WHEN NULLIF(TRIM(e.payload ->> '_1'), '') IS NULL
      AND NULLIF(TRIM(e.payload ->> 'Region'), '') IS NULL THEN 'grand_total'
    WHEN NULLIF(TRIM(e.payload ->> '_1'), '') ~ '^\d{4}-\d{2}$'
      AND NULLIF(TRIM(e.payload ->> 'Region'), '') IS NULL THEN 'month_total'
    WHEN NULLIF(TRIM(e.payload ->> '_1'), '') ~ '^\d{4}-\d{2}$'
      AND NULLIF(TRIM(e.payload ->> 'Region'), '') IS NOT NULL THEN 'channel_row'
    ELSE 'other'
  END AS row_type,
  CASE
    WHEN NULLIF(TRIM(e.payload ->> '_1'), '') ~ '^\d{4}-\d{2}$'
      THEN TO_DATE(NULLIF(TRIM(e.payload ->> '_1'), '') || '-01', 'YYYY-MM-DD')
    ELSE NULL
  END AS activity_month_date,
  NULLIF(REGEXP_REPLACE(COALESCE(e.payload ->> 'DACH', ''), '[^0-9.\-]', '', 'g'), '')::NUMERIC(18, 2)
    AS dach_total_transaction_value,
  NULLIF(REGEXP_REPLACE(COALESCE(e.payload ->> '_3', ''), '[^0-9.\-]', '', 'g'), '')::NUMERIC(18, 2)
    AS global_total_transaction_value
FROM phorest_pay_revenue_events e
WHERE e.csv_entry_name = 'dashboard-phorest_pay_revenue_by_channel_&_region/stripe_value_processed.csv';

-- Monatssicht fuer DACH Total Transaction Value:
-- nur echte Monatstotals (ohne Header/Grand-Total/Channelzeilen)
CREATE OR REPLACE VIEW reporting_phorest_pay_revenue_dach_monthly AS
SELECT
  activity_month_raw AS activity_month,
  activity_month_date,
  dach_total_transaction_value,
  global_total_transaction_value
FROM reporting_phorest_pay_revenue_stripe_processed_base
WHERE row_type = 'month_total'
  AND COALESCE(global_total_transaction_value, 0) > 0
ORDER BY activity_month_date;

-- Gesamtsicht fuer DACH:
CREATE OR REPLACE VIEW reporting_phorest_pay_revenue_dach_grand_total AS
SELECT
  dach_total_transaction_value,
  global_total_transaction_value
FROM reporting_phorest_pay_revenue_stripe_processed_base
WHERE row_type = 'grand_total';

