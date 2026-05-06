-- ============================================================================
-- Phorest Pay Revenue: Net Margin DACH (total_net_margin CSV) + Monats-Dedupe
-- Datum: 23. April 2026
-- ============================================================================
-- Voraussetzung: ZIP importiert alle CSVs (siehe phorestPayRevenue sync shared.ts).
-- Net-Margin-Dateien: csv_entry_name enthaelt typisch "total_net_margin" / "net_margin",
-- nicht "stripe_value_processed".
-- ============================================================================

-- Basis-View Net Margin (Pivot analog stripe_value_processed: _1/Activity Month, Region, DACH, _3)
CREATE OR REPLACE VIEW reporting_phorest_pay_revenue_net_margin_base AS
SELECT
  e.id,
  e.source_file_id,
  e.source_file_name,
  e.source_row_number,
  e.csv_entry_name,
  e.modified_at,
  e.created_at,
  e.updated_at,
  COALESCE(
    NULLIF(TRIM(e.payload ->> '_1'), ''),
    NULLIF(TRIM(e.payload ->> 'Activity Month'), '')
  ) AS activity_month_raw,
  COALESCE(
    NULLIF(TRIM(e.payload ->> 'Region'), ''),
    NULLIF(TRIM(e.payload ->> 'Phorest Pay channel'), '')
  ) AS region_or_channel_raw,
  CASE
    WHEN COALESCE(
      NULLIF(TRIM(e.payload ->> '_1'), ''),
      NULLIF(TRIM(e.payload ->> 'Activity Month'), '')
    ) = 'Activity Month' THEN 'header'
    WHEN COALESCE(
      NULLIF(TRIM(e.payload ->> '_1'), ''),
      NULLIF(TRIM(e.payload ->> 'Activity Month'), '')
    ) IS NULL
      AND COALESCE(
        NULLIF(TRIM(e.payload ->> 'Region'), ''),
        NULLIF(TRIM(e.payload ->> 'Phorest Pay channel'), '')
      ) IS NULL THEN 'grand_total'
    WHEN COALESCE(
      NULLIF(TRIM(e.payload ->> '_1'), ''),
      NULLIF(TRIM(e.payload ->> 'Activity Month'), '')
    ) ~ '^\d{4}-\d{2}$'
      AND COALESCE(
        NULLIF(TRIM(e.payload ->> 'Region'), ''),
        NULLIF(TRIM(e.payload ->> 'Phorest Pay channel'), '')
      ) IS NULL THEN 'month_total'
    WHEN COALESCE(
      NULLIF(TRIM(e.payload ->> '_1'), ''),
      NULLIF(TRIM(e.payload ->> 'Activity Month'), '')
    ) ~ '^\d{4}-\d{2}$'
      AND COALESCE(
        NULLIF(TRIM(e.payload ->> 'Region'), ''),
        NULLIF(TRIM(e.payload ->> 'Phorest Pay channel'), '')
      ) IS NOT NULL THEN 'channel_row'
    ELSE 'other'
  END AS row_type,
  CASE
    WHEN COALESCE(
      NULLIF(TRIM(e.payload ->> '_1'), ''),
      NULLIF(TRIM(e.payload ->> 'Activity Month'), '')
    ) ~ '^\d{4}-\d{2}$'
      THEN TO_DATE(
        COALESCE(
          NULLIF(TRIM(e.payload ->> '_1'), ''),
          NULLIF(TRIM(e.payload ->> 'Activity Month'), '')
        ) || '-01',
        'YYYY-MM-DD'
      )
    ELSE NULL
  END AS activity_month_date,
  COALESCE(
    NULLIF(REGEXP_REPLACE(COALESCE(e.payload ->> 'DACH', ''), '[^0-9.\-]', '', 'g'), '')::NUMERIC(18, 2),
    NULLIF(REGEXP_REPLACE(COALESCE(e.payload ->> 'Net Margin', ''), '[^0-9.\-]', '', 'g'), '')::NUMERIC(18, 2),
    NULLIF(REGEXP_REPLACE(COALESCE(e.payload ->> 'Total Net Margin', ''), '[^0-9.\-]', '', 'g'), '')::NUMERIC(18, 2)
  ) AS dach_net_margin,
  NULLIF(REGEXP_REPLACE(COALESCE(e.payload ->> '_3', e.payload ->> 'Total', ''), '[^0-9.\-]', '', 'g'), '')::NUMERIC(18, 2)
    AS global_net_margin
FROM phorest_pay_revenue_events e
WHERE LOWER(e.csv_entry_name) LIKE '%net_margin%'
  AND LOWER(e.csv_entry_name) NOT LIKE '%stripe_value_processed%';

-- Monatssicht: eine Zeile pro Monat (juengster Import gewinnt)
CREATE OR REPLACE VIEW reporting_phorest_pay_revenue_dach_net_margin_monthly AS
SELECT DISTINCT ON (activity_month_raw)
  activity_month_raw AS activity_month,
  activity_month_date,
  dach_net_margin,
  global_net_margin
FROM reporting_phorest_pay_revenue_net_margin_base
WHERE row_type = 'month_total'
  AND dach_net_margin IS NOT NULL
ORDER BY activity_month_raw, updated_at DESC NULLS LAST, id DESC;

-- Bestehende Transaction-View: Dedupe gleicher Monate (mehrere ZIP-Laeufe)
CREATE OR REPLACE VIEW reporting_phorest_pay_revenue_dach_monthly AS
SELECT DISTINCT ON (activity_month_raw)
  activity_month_raw AS activity_month,
  activity_month_date,
  dach_total_transaction_value,
  global_total_transaction_value
FROM reporting_phorest_pay_revenue_stripe_processed_base
WHERE row_type = 'month_total'
  AND COALESCE(global_total_transaction_value, 0) > 0
ORDER BY activity_month_raw, updated_at DESC NULLS LAST, id DESC;
