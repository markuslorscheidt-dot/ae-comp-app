# Übergabe – ae-comp-app (DLT Planning + Go-Live/Churn/Up-Downsells Importe)

## 1) Zusammenfassung des Gesamtstands

- `DLTSettings` wurde in zwei Bereichen stark erweitert:
  - `Planning`:
    - `2. EXPANDING ARR` mit manueller Monats-UI (Upgrades, Downgrades, Net ARR)
    - `3. CHURN ARR` mit manueller Monats-UI, negativer Logik, Auto-Save, Statusanzeige
    - Planning-Kategorien `1..6` sind ein-/ausklappbar
  - `Importe`:
    - `+New Business Go-Lives` (bestehend, weiterhin aktiv)
    - `Churn - Importe` (neu, komplett inkl. Dry-Run/Commit/Auto/Cron/History)
    - `Up-Downsells Import` (neu, komplett inkl. Dry-Run/Commit/Auto/Cron/History)

---

## 2) Neu implementierte Backend-Importe

### A) Churn Import (`mirror__Churn`)

- API:
  - `src/app/api/churn/sync/route.ts`
  - `src/app/api/churn/sync/shared.ts`
  - `src/app/api/churn/sync/auto-import/route.ts`
  - `src/app/api/churn/sync/cron/route.ts`
  - `src/app/api/churn/sync/history/route.ts`
- SQL:
  - `supabase-churn-import.sql`
- Zieltabellen:
  - `churn_events`
  - `churn_import_runs`
  - `churn_import_run_items`
- Auto-Import-Flag:
  - `import_controls.key = 'churn_auto_import_enabled'`
- Business Key:
  - `churn_events.oak_id` (unique index)

### B) Up-Downsells Import (`mirror__Upsell Downsell`)

- API:
  - `src/app/api/upDownsells/sync/route.ts`
  - `src/app/api/upDownsells/sync/shared.ts`
  - `src/app/api/upDownsells/sync/auto-import/route.ts`
  - `src/app/api/upDownsells/sync/cron/route.ts`
  - `src/app/api/upDownsells/sync/history/route.ts`
- SQL:
  - `supabase-up-downsells-import.sql`
- Zieltabellen:
  - `up_downsells_events`
  - `up_downsells_import_runs`
  - `up_downsells_import_run_items`
- Auto-Import-Flag:
  - `import_controls.key = 'up_downsells_auto_import_enabled'`
- Business Key:
  - `(event_month, oak_id)` unique

---

## 3) Wichtige Fach-/Validierungslogik

### Churn

- Pflicht:
  - `Churn Month`, `Oak ID`, `Customer Name`, `Total ARR Lost`
- `Subs Revenue Lost` / `Pay Revenue Lost`:
  - optional
  - bei fehlendem/ungueltigem Wert: Warning + Speicherung als `0`
- Dedupe:
  - doppelte OAK im Sheet: letzte Zeile gewinnt (Warning)

### Up-Downsells

- Pflicht:
  - `Upgrade / Downgrade Month`, `Oak ID`, `Customer Name`
  - mindestens einer von `Net Growth ARR` / `Net Loss ARR`
- Dedupe:
  - doppelte Kombination `(Monat + OAK)` wird zusammengeführt
  - Growth/Loss wird summiert, Warning wird geloggt
- `net_arr` wird als `net_growth_arr + net_loss_arr` gespeichert

---

## 4) ENV-Konfiguration (relevant)

- Bestehend:
  - `GOOGLE_SHEETS_RANGE_GOLIVE`
  - `GOOGLE_SHEETS_RANGE_CHURN`
- Für Up-Downsells unterstützt:
  - `GOOGLE_SHEETS_RANGE_UP_DOWNSELLS`
  - fallback-kompatibel auch: `GOOGLE_SHEETS_RANGE_UPSELL`
- Aktueller robuster Fallback im Code:
  - `"'mirror__Upsell Downsell'!A:Z"`

---

## 5) UI-Stand in `DLTSettings`

- Import-Subtabs:
  - `+New Business Go-Lives`
  - `Churn - Importe`
  - `Up-Downsells Import`
- Jede neue Import-Kachel bietet:
  - Modus-Buttons (manuell/automatisch)
  - Auto-Import Toggle
  - Dry-Run + Commit Buttons
  - Feld-Mapping-Tabelle
  - Dry-Run-Vorschau
  - Import-Historie + Laufdetails

---

## 6) Betriebs-Hinweise

1. SQL-Migrationen in Supabase ausführen:
   - `supabase-churn-import.sql`
   - `supabase-up-downsells-import.sql`
2. Danach Dev-Server neu starten (`npm run dev`), damit neue ENV-Werte sicher geladen sind.
3. Bei Schema-Cache-Fehlern in History:
   - einmal Seite hart neu laden
   - und in der jeweiligen History auf `Aktualisieren` klicken

---

## 7) Nächste sinnvolle Schritte

1. End-to-End-Check je Import:
   - Dry-Run -> Commit -> History -> Details
2. Optional: Cron-Run manuell triggern und Auto-Import-Flags verifizieren.
3. Danach Planungslogik koppeln:
   - Übernahme von Churn-/UpDownsell-Istwerten in `dlt_planzahlen` (falls fachlich gewünscht).
