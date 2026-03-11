# Import Playbook

Dieses Dokument ist die Standardvorlage fuer neue Import-Routinen in `ae-comp-app`.
Ziel ist ein stabiler, nachvollziehbarer und idempotenter Betrieb.

## 1. Mindest-Architektur je Import

Jede neue Import-Routine hat mindestens:

- Dry-Run Endpoint (Vorschau und Validierung, keine Writes)
- Commit Endpoint (persistiert Daten)
- Optional Cron Endpoint (nur mit `Authorization: Bearer CRON_SECRET`)
- Persistentes Auto-Import-Flag in `import_controls`
- Import-Historie mit Runs und Run-Items

Empfohlene API-Struktur:

- `GET /api/<domain>/sync` -> Dry-Run
- `POST /api/<domain>/sync` -> Commit
- `GET /api/<domain>/sync/cron` -> geplanter Lauf
- `GET /api/<domain>/sync/history?limit=20` -> letzte Runs
- `GET /api/<domain>/sync/history?runId=<id>` -> Laufdetails

## 2. Datenbank-Standard

Pflicht pro Import:

1) Historie-Tabellen
- `<domain>_import_runs`
- `<domain>_import_run_items`

2) Upsert-Voraussetzung
- Eindeutiger Business-Key per `UNIQUE INDEX` (ggf. partial index)
- Vorherige Dublettenbereinigung in der Zieltabelle

3) Optionales Control-Flag
- `import_controls.key = '<domain>_auto_import_enabled'`

## 3. Commit-Flow (Referenzablauf)

1. Quelldaten laden (Google Sheets, CSV oder API)
2. Header und Pflichtspalten pruefen
3. Werte normalisieren (Datum, Zahlen, Bool, Strings)
4. Fachlich validieren (Pflichtfelder, fachliche Regeln)
5. Source-Dubletten aufloesen ("letzte Zeile gewinnt") + Warning
6. Zielrecords aufbauen
7. Batch-Upsert mit `onConflict` auf Business-Key
8. Fehler und Warnungen sammeln
9. Laufstatus bestimmen (`success | partial | failed | skipped`)
10. Run + Run-Items persistieren

## 4. Status- und Error-Modell

Run-Status:

- `success`: keine fehlgeschlagenen Writes
- `partial`: teilweise erfolgreich
- `failed`: keine erfolgreichen Writes
- `skipped`: bewusst nicht ausgefuehrt (z. B. Auto-Import aus)

Run-Items:

- `warning`: verarbeitbar, aber auffaellig
- `error`: nicht verarbeitet
- `duplicate`: Dubletten-Fall

## 5. UI-Standard fuer Admin-Flaechen

Die Admin-UI soll pro Import bieten:

- Feld-Mapping (Quelle -> Ziel -> Transformation)
- Dry-Run Vorschau mit normalisierten Daten
- Warning/Error-Box
- Commit-Trigger ("Jetzt importieren")
- Historie-Liste + Detailansicht
- Toggle fuer Auto-Import (falls unterstuetzt)

## 6. Sicherheits- und Betriebsregeln

- Cron-Endpoints nur mit Secret absichern
- Service-Role nur serverseitig verwenden
- Import idempotent designen (Upsert + eindeutiger Key)
- Deploy immer lokal + remote verifizieren
- Fehlertexte fachlich verstaendlich halten

## 7. SQL-Pruefungen (Definition of Done)

Unique-Index vorhanden:

```sql
SELECT indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename = '<target_table>'
  AND indexname = '<expected_unique_index>';
```

Keine verbleibenden Dubletten:

```sql
SELECT <business_key>, COUNT(*)
FROM <target_table>
WHERE <business_key> IS NOT NULL
GROUP BY <business_key>
HAVING COUNT(*) > 1;
```

## 8. Lessons Learned aus dem Go-Live Import

- Upsert braucht zwingend den DB-seitigen Unique-Constraint
- Historie macht Cron- und Manual-Runs transparent
- Source-Dedupe muss sichtbar als Warning dokumentiert sein
- Fachregeln, wenn moeglich, zentral und wiederverwendbar halten
- Rechenlogik in `src/lib/calculations.ts` zentralisieren

## 9. Verbindlicher Standard fuer alle neuen Importe

Ab sofort gilt:

- Jeder neue Import wird exakt nach diesem Playbook umgesetzt.
- Architektur, API-Schnittstellen, Auto-Import-Logik, Historie und UI sind verpflichtend.
- Abweichungen nur bei expliziter fachlicher Anforderung.

Der Satz

- `Baue ein Import wie in der Dokumentation beschrieben`

ist als vollstaendiger Implementierungsauftrag zu verstehen.

## 10. Konkretes Umsetzungs-Template (Pflicht)

### 10.1 API-Dateistruktur

Fuer jede neue Domain `<domain>`:

- `src/app/api/<domain>/sync/route.ts`
- `src/app/api/<domain>/sync/shared.ts`
- `src/app/api/<domain>/sync/auto-import/route.ts`
- `src/app/api/<domain>/sync/cron/route.ts`
- `src/app/api/<domain>/sync/history/route.ts`

### 10.2 Endpoints und Verhalten

- `GET /api/<domain>/sync`:
  - Dry-Run, keine Writes
  - Header-/Pflichtfeld-Validierung
  - `stats` + `preview.valid` + `preview.invalid`

- `POST /api/<domain>/sync`:
  - Commit-Import mit Batch-Upsert
  - `stats` + `errors` + `warnings`
  - Run-Logging in Historie

- `GET /api/<domain>/sync/auto-import`:
  - aktuellen persistenten Toggle-Status liefern

- `PUT /api/<domain>/sync/auto-import`:
  - Toggle-Status speichern in `import_controls`

- `GET|POST /api/<domain>/sync/cron`:
  - Secret-geschuetzt
  - akzeptiert `Authorization: Bearer <CRON_SECRET>`, `x-cron-secret`, optional `cronSecret` Query
  - fuehrt nur aus, wenn Auto-Import aktiv
  - loggt `skipped`, wenn Auto-Import aus

- `GET /api/<domain>/sync/history?limit=20`:
  - letzte Runs

- `GET /api/<domain>/sync/history?runId=<id>`:
  - Run-Items (Warnings/Errors/Duplicates)

### 10.3 Datenbank / SQL-Migration

Pro Domain eine SQL-Datei `supabase-<domain>-import.sql` mit:

- Zieltabelle `<domain>_events` (oder fachlich passender Name)
- Unique Business Key als `UNIQUE INDEX` fuer Upsert
- `updated_at` Trigger
- Historie-Tabellen:
  - `<domain>_import_runs`
  - `<domain>_import_run_items`
- `import_controls` Eintrag:
  - `<domain>_auto_import_enabled`

### 10.4 ENV-Konvention

Pflicht:

- `GOOGLE_SHEETS_API_KEY`
- `GOOGLE_SHEETS_SPREADSHEET_ID`
- domain-spezifischer Range-Key:
  - `GOOGLE_SHEETS_RANGE_<DOMAIN>` (z. B. `GOOGLE_SHEETS_RANGE_SALESPIPE`)

Empfehlung:

- In `shared.ts` einen stabilen Default-Range auf den exakten Tabnamen setzen.
- Bei Range-Fehlern (`Unable to parse range`) eine klare, fachliche Fehlermeldung zur ENV ausgeben.

### 10.5 UI-Standard (DLT Settings > Importe)

Jeder neue Import bekommt einen eigenen Subtab mit identischem Aufbau:

- Modus-Schalter `Manuell pruefen` / `Automatisch einlaufen`
- Toggle `Auto-Import aktivieren`
- Buttons:
  - `Batch pruefen (Dry-Run)`
  - `Jetzt importieren (Commit)`
- Ergebnis-Kacheln (`toImport`, `imported`, `updated`, `failed`, `duplicates`)
- Feld-Mapping-Tabelle (Quelle -> DB -> Transformation -> Pflicht)
- Vorschau geparster Datensaetze
- Fehler-/Warnboxen
- Import-Historie + Run-Details
- Anzeige `Letzter Auto-Run (Cron)`

### 10.6 Import-Logik-Standard in `shared.ts`

- Parsing robust fuer DE/EN Zahlenformate
- Datumsparser robust (mind. `YYYY-MM-DD`, `DD.MM.YYYY`, optional Zeit-Suffix)
- Pflichtvalidierung pro Zeile
- Source-Dedupe (letzte Zeile gewinnt oder fachlich definiertes Merge)
- Batch-Upsert mit sauberem `onConflict`
- Fehler/Warnungen run-item-faehig sammeln
- finaler Run-Status:
  - `success | partial | failed | skipped`

## 11. Abnahme-Checkliste (Definition of Done je neuem Import)

- SQL-Migration ausgefuehrt und Tabellen/Indizes vorhanden
- Dry-Run liefert valide `stats` und nachvollziehbare Vorschau
- Commit importiert ohne strukturelle Fehler
- Auto-Import Toggle wirkt persistent
- Cron-Endpoint mit Secret laeuft und respektiert Toggle
- Historie + Run-Details werden in UI korrekt angezeigt
- Vercel ENV fuer Domain-Range gesetzt und dokumentiert
