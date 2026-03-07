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
