# Pay Margin & Terminal Installation KPI Reference

Dieses Dokument ist die verbindliche Referenz fuer weitere Business-Logik rund um:

- Terminal-Installationen (Pay Stripe Terminal Installation Import)
- Pay Margin KPI (monatlich / ARR)
- Dedupe- und Filterregeln fuer konsistente Auswertungen

## Ziel

Eine einheitliche KPI-Logik sicherstellen, damit Auswertungen in App, SQL und Assistenz-Entwicklung dieselben Zahlen liefern.

## Datenquellen

### 1) Pay Stripe Terminal Installation Import

Tabelle:

- `pay_stripe_terminal_installation_events`

Wichtige Payload-Felder:

- `OAK ID`
- `Branch Name`
- `Region`
- `First Pay terminal usage date Date`
- `Golive Date`
- `Phorest Pay Account Executive`
- `#Terminal Purchase`
- `Monthly Fee`

### 2) Go-Live / Pay-Werte

Tabelle:

- `go_lives`

Wichtige Felder:

- `oak_id`
- `go_live_date`
- `pay_arr` (Ist)
- `pay_arr_target` (Forecast/Fallback)

## KPI-Definitionen (verbindlich)

### Pay Margin (monatlich)

Prioritaet:

1. `Net Margin` (falls als eigene Quelle vorhanden)
2. sonst `Monthly Fee` aus `pay_stripe_terminal_installation_events`
3. sonst `NULL`

### Pay Margin (ARR / Jahr)

Prioritaet:

1. `Net Margin * 12`
2. sonst `Monthly Fee * 12`
3. sonst `NULL`

### Terminal Install Count

- Zaehlt Installations-Records, nicht Margin-Werte.
- Nicht aus `#Terminal Purchase` ableiten.

### Wichtige Abgrenzung

- `#Terminal Purchase` ist **kein** belastbarer Margin-Indikator.
- `Monthly Fee` ist der bessere Margin-nahe Fallback.

## Dedupe-Logik fuer Installationen

Fuer stabile KPI-Berechnung auf Installations-Ebene:

- Business Key: `oak_id + branch_name + first_pay_usage_date`

Bei mehrfachen Importen derselben Installation:

- letzte importierte Zeile gewinnt (`updated_at DESC`)

## Standard-Filter fuer Looker-nahe Auswertungen

Wenn die Looker-Kachel auf "Terminal Installed Count" basiert:

- `Region = DACH`
- `First Pay terminal usage date Date` im gewuenschten Jahr (z. B. 2026)
- optional `Phorest Pay Account Executive = 'Ben Zütphen'`

Hinweis:

- Filter auf `Golive Date` liefert andere Zahlen als Filter auf `First Pay terminal usage date Date`.

## SQL-View Template (Supabase/Postgres)

Die View unten erzeugt eine normalisierte, deduplizierte Basis fuer Reporting.

```sql
create or replace view reporting_terminal_installations_base as
with parsed as (
  select
    e.id,
    e.updated_at,
    e.source_file_name,
    e.source_row_number,
    nullif(trim(e.payload->>'OAK ID'), '')::bigint as oak_id,
    nullif(trim(e.payload->>'Branch Name'), '') as branch_name,
    upper(nullif(trim(e.payload->>'Region'), '')) as region,
    nullif(trim(e.payload->>'Phorest Pay Account Executive'), '') as phorest_pay_account_executive,
    nullif(trim(e.payload->>'Monthly Fee'), '') as monthly_fee_raw,
    nullif(trim(e.payload->>'#Terminal Purchase'), '') as terminal_purchase_raw,
    nullif(trim(e.payload->>'First Pay terminal usage date Date'), '') as first_pay_usage_date_raw,
    nullif(trim(e.payload->>'Golive Date'), '') as golive_date_raw
  from pay_stripe_terminal_installation_events e
),
normalized as (
  select
    p.*,
    case
      when p.first_pay_usage_date_raw ~ '^\d{4}-\d{2}-\d{2}$' then p.first_pay_usage_date_raw::date
      when p.first_pay_usage_date_raw ~ '^\d{2}\.\d{2}\.\d{4}$' then to_date(p.first_pay_usage_date_raw, 'DD.MM.YYYY')
      else null
    end as first_pay_usage_date,
    case
      when p.golive_date_raw ~ '^\d{4}-\d{2}-\d{2}$' then p.golive_date_raw::date
      when p.golive_date_raw ~ '^\d{2}\.\d{2}\.\d{4}$' then to_date(p.golive_date_raw, 'DD.MM.YYYY')
      else null
    end as golive_date,
    case
      when p.monthly_fee_raw is null then null
      when p.monthly_fee_raw ~ '^\d{1,3}(\.\d{3})*(,\d+)?$'
        then replace(replace(p.monthly_fee_raw, '.', ''), ',', '.')::numeric
      when p.monthly_fee_raw ~ '^\d{1,3}(,\d{3})*(\.\d+)?$'
        then replace(p.monthly_fee_raw, ',', '')::numeric
      else regexp_replace(p.monthly_fee_raw, '[^0-9\.,-]', '', 'g')::numeric
    end as monthly_fee,
    case
      when p.terminal_purchase_raw is null then null
      when p.terminal_purchase_raw ~ '^\d{1,3}(\.\d{3})*(,\d+)?$'
        then replace(replace(p.terminal_purchase_raw, '.', ''), ',', '.')::numeric
      when p.terminal_purchase_raw ~ '^\d{1,3}(,\d{3})*(\.\d+)?$'
        then replace(p.terminal_purchase_raw, ',', '')::numeric
      else regexp_replace(p.terminal_purchase_raw, '[^0-9\.,-]', '', 'g')::numeric
    end as terminal_purchase
  from parsed p
),
deduped as (
  select *
  from (
    select
      n.*,
      row_number() over (
        partition by n.oak_id, n.branch_name, n.first_pay_usage_date
        order by n.updated_at desc, n.id desc
      ) as rn
    from normalized n
  ) x
  where x.rn = 1
)
select
  oak_id,
  branch_name,
  region,
  phorest_pay_account_executive,
  first_pay_usage_date,
  golive_date,
  monthly_fee as pay_margin_monthly_fallback,
  (monthly_fee * 12) as pay_margin_arr_fallback,
  terminal_purchase,
  source_file_name,
  source_row_number,
  updated_at
from deduped;
```

## Beispiel-Abfragen

### 1) Terminal Installed Count in DACH fuer 2026

```sql
select count(*) as terminal_installed_count
from reporting_terminal_installations_base
where region = 'DACH'
  and first_pay_usage_date >= date '2026-01-01'
  and first_pay_usage_date <  date '2027-01-01';
```

### 2) Monatsverteilung fuer Ben Zütphen (2026)

```sql
select
  to_char(first_pay_usage_date, 'YYYY-MM') as month,
  count(*) as installs
from reporting_terminal_installations_base
where region = 'DACH'
  and first_pay_usage_date >= date '2026-01-01'
  and first_pay_usage_date <  date '2027-01-01'
  and phorest_pay_account_executive = 'Ben Zütphen'
group by 1
order by 1;
```

## Referenz fuer weitere Entwicklung

Wenn neue Business-Logik umgesetzt wird, soll immer auf dieses Dokument verwiesen werden:

- `docs/pay-margin-kpi-reference.md`

Empfohlene Formulierung im Task:

- "Nutze die KPI-Definitionen und Dedupe-Regeln aus `docs/pay-margin-kpi-reference.md`."

