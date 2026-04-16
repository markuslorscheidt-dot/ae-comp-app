# Phorest Pay Revenue Business-Logik

Dieses Dokument beschreibt die fachliche Logik fuer den Import `Phorest Pay Revenue` (ZIP aus Google Drive) und die Auswertung fuer KPI- und Reporting-Zwecke.

## Ziel

Der Import soll aus einem Drive-ZIP die fachlich relevante CSV fuer Revenue-KPIs laden und in `phorest_pay_revenue_events` speichern, damit spaeter reproduzierbar nach Monat, Channel und KPI-Feld ausgewertet werden kann.

## Import-Quelle und Priorisierung

Der ZIP-Import kann mehrere CSV-Dateien enthalten. Alle CSV-Dateien werden in einem Lauf verarbeitet.
Die Priorisierung steuert dabei:

- welche CSV als `primary` fuer Referenzen/Run-Metadaten (`csv_entry_name`) gilt
- welche CSV den nativen Zeilenindex fuer `source_row_number` behaelt

Prioritaet:

1. Dateiname enthaelt `total_transaction_value` (hoechste Prioritaet)
2. Dateiname enthaelt `stripe_value_processed`
3. Dateiname enthaelt `dach`
4. Dateiname enthaelt `total_net_margin`
5. Sonst alphabetischer Fallback

Hinweis: Bei mehreren CSVs wird die priorisierte Datei in den Run-Warnings protokolliert (inkl. Liste aller verfuegbaren CSVs).

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

- Priorisierte CSV: `source_row_number = originale CSV-Zeilennummer`
- Weitere CSVs: deterministischer technischer Offset pro `csv_entry_name`, damit keine Kollision auf `(source_file_id, source_row_number)` entsteht

Dadurch sind alle CSVs derselben ZIP parallel speicherbar, ohne Schemawechsel.

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

1. CSV-Auswahl optional im UI explizit steuerbar machen (z. B. `total_transaction_value` vs `total_net_margin`)
2. Regionsfeld (`Region`/`Country`) verpflichtend importieren, damit DACH-Filter datengetrieben statt implizit ist
3. Dedizierte Reporting-View aufbauen, die KPI-Feldnamen stabilisiert (unabhaengig vom CSV-Header-Wording)

## Reporting-Views (umgesetzt)

Migration/SQL-Datei:

- `supabase-phorest-pay-revenue-reporting-views.sql`

Enthaelt:

- `reporting_phorest_pay_revenue_stripe_processed_base`
- `reporting_phorest_pay_revenue_dach_monthly`
- `reporting_phorest_pay_revenue_dach_grand_total`

### Beispielabfragen

Monatswerte DACH / Total Transaction Value:

```sql
SELECT activity_month, dach_total_transaction_value, global_total_transaction_value
FROM reporting_phorest_pay_revenue_dach_monthly;
```

Gesamtwert DACH / Total Transaction Value:

```sql
SELECT dach_total_transaction_value, global_total_transaction_value
FROM reporting_phorest_pay_revenue_dach_grand_total;
```
