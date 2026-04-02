# Übergabe – neuer Thread (Stand 2026-03-07)

## 1) Kurzstatus

- Letzter gepushter Commit auf `main`:
  - `d310631` – `feat(imports): add churn and up-downsells pipelines with DLT UI`
- Alle großen Import-Erweiterungen (Go-Live / Churn / Up-Downsells) inkl. UI sind in diesem Commit enthalten und auf GitHub.

## 2) Aktuell noch **lokal offen** (nicht committed / nicht gepusht)

Es gibt genau 2 lokale Änderungen:

- `src/app/api/churn/sync/shared.ts`
- `src/app/api/upDownsells/sync/shared.ts`

Inhalt der offenen Änderungen:

- Parser für Monats-/Datumsfelder wurde erweitert.
- Akzeptiert jetzt robust:
  - `YYYY-MM`
  - `YYYY-MM-DD`
  - `DD.MM.YYYY` (deutsches Format, optional mit Uhrzeit-Suffix)
- Ausgabe bleibt für beide Importe konsistent auf Monatsanfang:
  - `YYYY-MM-01`

Zweck:

- Dry-Run soll trotz deutschem Datumsformat im Google Sheet wieder valide Zeilen liefern.

## 3) Bereits implementierte Import-Pipelines (im gepushten Stand)

### Churn Import

- API:
  - `src/app/api/churn/sync/route.ts`
  - `src/app/api/churn/sync/shared.ts`
  - `src/app/api/churn/sync/auto-import/route.ts`
  - `src/app/api/churn/sync/cron/route.ts`
  - `src/app/api/churn/sync/history/route.ts`
- SQL:
  - `supabase-churn-import.sql`
- Tabellen:
  - `churn_events`
  - `churn_import_runs`
  - `churn_import_run_items`

### Up-Downsells Import

- API:
  - `src/app/api/upDownsells/sync/route.ts`
  - `src/app/api/upDownsells/sync/shared.ts`
  - `src/app/api/upDownsells/sync/auto-import/route.ts`
  - `src/app/api/upDownsells/sync/cron/route.ts`
  - `src/app/api/upDownsells/sync/history/route.ts`
- SQL:
  - `supabase-up-downsells-import.sql`
- Tabellen:
  - `up_downsells_events`
  - `up_downsells_import_runs`
  - `up_downsells_import_run_items`

### DLT Settings UI

- Import-Subtabs:
  - `+New Business Go-Lives`
  - `Churn - Importe`
  - `Up-Downsells Import`
- Je Subtab:
  - Dry-Run / Commit
  - Auto-Import Toggle
  - Historie + Laufdetails
  - Mapping + Vorschau

## 4) ENV-Hinweise

- Churn-Range:
  - `GOOGLE_SHEETS_RANGE_CHURN=mirror__Churn!A:Z`
- Up-Downsells-Range:
  - bevorzugt: `GOOGLE_SHEETS_RANGE_UP_DOWNSELLS`
  - kompatibel zusätzlich: `GOOGLE_SHEETS_RANGE_UPSELL`
- Bei ENV-Änderungen:
  - Dev-Server neu starten (`npm run dev`).

## 5) Nächste Schritte im neuen Thread

1. Lokale Parser-Änderungen verifizieren:
   - Dry-Run Churn
   - Dry-Run Up-Downsells
2. Wenn valide:
   - Commit + Push der 2 Parser-Dateien.
3. Optional:
   - kleinen Regressionstest mit deutschem vs. ISO-Datum dokumentieren.

## 6) Empfohlener Commit für den offenen Rest

`fix(imports): accept german date formats in churn and up-downsells parsers`

