# Phorest Pay Revenue Business-Logik

Dieses Dokument beschreibt die fachliche Logik fuer den Import `Phorest Pay Revenue` (ZIP aus Google Drive) und die Auswertung fuer KPI- und Reporting-Zwecke.

## Ziel

Der Import soll aus einem Drive-ZIP die fachlich relevante CSV fuer Revenue-KPIs laden und in `phorest_pay_revenue_events` speichern, damit spaeter reproduzierbar nach Monat, Channel und KPI-Feld ausgewertet werden kann.

## Import-Quelle und Priorisierung

Der ZIP-Import verarbeitet **alle** enthaltenen CSV-Dateien in einem Lauf (alphabetisch sortiert).

Die **Prioritaetsliste** steuert nur noch, welcher Dateiname im Import-Run-Log als Referenz (`csv_entry_name`) gilt — nicht mehr, welche Datei allein importiert wird.

Prioritaet (hoeher = Referenz fuer Run-Log):

1. Dateiname enthaelt `total_transaction_value`
2. Dateiname enthaelt `stripe_value_processed`
3. Dateiname enthaelt `dach`
4. Dateiname enthaelt `total_net_margin`
5. Sonst alphabetischer Fallback

Hinweis: Run-Warnings listen alle CSVs und den Row-Offset (siehe unten).

## Speicherung

Die Daten werden roh (normalisierte String-Werte) in `phorest_pay_revenue_events.payload` gespeichert.
Zusatzfelder pro Zeile:

- `source_file_id`
- `source_file_name`
- `source_row_number`
- `csv_entry_name`
- `modified_at`

Damit bleiben Quelle und Feldherkunft nachvollziehbar.

### Schluessel-Strategie bei mehreren CSVs

- Jede CSV-Zeile: `source_row_number = datei_index * 1_000_000 + (CSV-Datenzeile, 1-basiert inkl. Header-Offset wie bisher)`
- Dadurch keine Kollision auf `(source_file_id, source_row_number)` zwischen Dateien derselben ZIP.

Die erste Datei (alphabetisch) behaelt damit weiterhin die kleinsten Nummern (kompatibel mit aelteren Ein-CSV-Imports).

## KPI-Mapping

### DACH / Total Transaction Value

Fachliches Ziel-Feld: `Stripe Value Processed DACH / Total Transaction Value`.

Technische Zuordnung:

- Primar ueber CSV-Spalte `Total Transaction Value` (wenn in der priorisierten CSV vorhanden)
- Alternativ ueber CSV-Spalte `Total gross Fees (PAY DB)`, falls das Exportlayout diese Bezeichnung nutzt

Wichtig: Ohne explizites Regionsfeld in der CSV kann `DACH` nur dann als Filter gelten, wenn der Export in Looker bereits auf DACH gefiltert wurde.

### Monatliche Aggregation

Monatsauswertung ueber `Activity Month` (Format `YYYY-MM`).

Typischer Total-Filter:

- Zeilen mit leerem Channel (`Phorest Pay channel = ''`) repraesentieren oft Summenzeilen
- `0.00`-Platzhalterzeilen muessen optional ausgeschlossen werden

## Betriebsregeln

- Dry-Run prueft Struktur, Header und Anzahl valider/invalid Zeilen.
- Commit schreibt/aktualisiert Datensaetze idempotent.
- Auto-Import verarbeitet nur, wenn `import_controls.key = 'phorest_pay_revenue_auto_import_enabled'` aktiviert ist.
- Cron-Run loggt `skipped`, wenn Auto-Import deaktiviert ist.

## Empfehlung fuer Weiterentwicklung

1. Regionsfeld (`Region`/`Country`) verpflichtend importieren, damit DACH-Filter datengetrieben statt implizit ist
2. Optional: UI-Schalter fuer KPI-Auswahl (Transaction Value vs. Net Margin) in Berichten

## Reporting-Views (umgesetzt)

Migration/SQL-Dateien:

- `supabase-phorest-pay-revenue-reporting-views.sql` — Stripe / Transaction Value (Pivot-CSV)
- `supabase-phorest-pay-revenue-net-margin-views.sql` — **Net Margin DACH** (`*net_margin*`-CSV, ohne `stripe_value_processed`), plus Monats-Dedupe fuer beide Monats-Views

Enthaelt u. a.:

- `reporting_phorest_pay_revenue_stripe_processed_base`
- `reporting_phorest_pay_revenue_dach_monthly` (Transaction Volume, eine Zeile pro Monat / juengster Import)
- `reporting_phorest_pay_revenue_dach_grand_total`
- `reporting_phorest_pay_revenue_net_margin_base`
- `reporting_phorest_pay_revenue_dach_net_margin_monthly` — **fuer NRR / Expanding ARR (Pay-Delta)**

### Beispielabfragen

Monatswerte DACH / Total Transaction Value:

```sql
SELECT activity_month, dach_total_transaction_value, global_total_transaction_value
FROM reporting_phorest_pay_revenue_dach_monthly;
```

Monatswerte DACH / Net Margin (NRR):

```sql
SELECT activity_month, dach_net_margin, global_net_margin
FROM reporting_phorest_pay_revenue_dach_net_margin_monthly;
```

Gesamtwert DACH / Total Transaction Value:

```sql
SELECT dach_total_transaction_value, global_total_transaction_value
FROM reporting_phorest_pay_revenue_dach_grand_total;
```
