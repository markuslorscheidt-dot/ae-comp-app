# Go-Live Mail->Drive->Sheet Playbook

Dieses Playbook beschreibt die spaetere Programmierung fuer den automatisierten Go-Live-Import:

1. Salesforce Report als CSV per E-Mail
2. Gmail -> Google Drive (Anhang speichern)
3. Google Drive -> Google Sheet Tab `Go-Live Sheet New Business`
4. App-Import nutzt den Tab wie bisher weiter (kompatibles Zielschema)

Stand: Basierend auf CSV wie `report1773170074523.csv`.

---

## 1) Ziel und Scope

Ziel ist, den aktuell manuell gepflegten Tab `Go-Live Sheet New Business` automatisiert und reproduzierbar zu befuellen.

Wichtig:
- Der bestehende App-Import fuer Go-Live soll ohne API-Aenderung weiterlaufen.
- Das Zielschema im Sheet muss deshalb die von der App erwarteten Pflichtspalten enthalten.

---

## 2) Quelle (Salesforce CSV)

Bekannte Quellspalten:

- `OAKID`
- `Accountname`
- `Accountinhaber`
- `Region`
- `Signup Package`
- `Monthly_Fee`
- `Phorest Pay AE Name`
- `Go Live Date`
- `Partnership(s)`
- `Business Revenue Waehrung`
- `Business Revenue`
- `Number Of Locations`
- `Month`

Transportannahmen:
- Encoding: UTF-8
- Delimiter: `;`

---

## 3) Zielschema im Sheet (app-kompatibel)

Der Tab `Go-Live Sheet New Business` muss mindestens folgende Spalten enthalten (exakte Schreibweise):

- `GL-Date`
- `Oak ID`
- `Customer Name`
- `COO`
- `monthly subs`
- `Package`
- `Terminal sold`
- `AE`
- `Provisionsrelevant`
- `Partnerships J/N`
- `Partnerschaftsname`
- `Enterprise`
- `Pay Value after 3 month`

Zusaetzlich neu:
- `Business Revenue`

Hinweis:
- Die App validiert Pflichtspalten streng.
- Header im Zieltab daher nicht frei umbenennen.

---

## 4) Mapping und Transformationsregeln

### 4.1 Direktes Mapping

- `GL-Date` <- `Go Live Date`
- `Oak ID` <- `OAKID`
- `Customer Name` <- `Accountname`
- `monthly subs` <- `Monthly_Fee`
- `Package` <- `Signup Package`
- `AE` <- `Accountinhaber`
- `Partnerschaftsname` <- `Partnership(s)`
- `Business Revenue` <- `Business Revenue`

### 4.2 Regelbasiertes Mapping

1) `Terminal sold`
- Wenn `Phorest Pay AE Name` nicht leer -> `Ja`
- Sonst -> `Nein`

2) `Enterprise`
- Wenn `Number Of Locations >= 5` -> `Ja`
- Sonst (unter 5 oder leer) -> `Nein`

3) `Partnerships J/N`
- Wenn `Partnerschaftsname` nicht leer -> `Ja`
- Sonst -> `Nein`

### 4.3 Provisorische Fachregeln (fest gecoded)

`Provisionsrelevant`:
- `Ja`, wenn `Accountinhaber` = `Christiane Venditti` oder `Slavo Ristanovic`
- Sonst `Nein`

`Pay Value after 3 month`:
- Immer leer (Default leer / optional `0`, bevorzugt leer)

`COO`:
- Default leer, solange keine belastbare Quelle vorliegt

---

## 5) Orchestrierung (Apps Script, Zielbild)

Empfohlene Funktionen:

- `saveGoLiveCsvAttachmentsToDrive()`
  - Sucht Gmail-Mails mit Label (z. B. `golive_csv`)
  - Prueft Dateinamenmuster
  - Speichert neue CSV-Anhaenge in Drive-Ordner
  - Dedupe ueber `messageId + filename + size`

- `importNewestGoLiveCsvFromDriveToSheet()`
  - Ermittelt neueste passende CSV aus Drive
  - Parsed CSV
  - Wendet Mapping + Regeln an
  - Schreibt Snapshot in `Go-Live Sheet New Business`
  - Merkt `last_imported_file_id`

- `runGoLiveWorkflow()`
  - Optionaler Wrapper fuer beide Schritte nacheinander

---

## 6) Schreibstrategie im Zieltab

Snapshot-Ansatz:

1. Headerzeile fix halten (Zeile 1)
2. Datenbereich ab Zeile 2 loeschen
3. Neu berechnete Zielzeilen schreiben

Vorteile:
- idempotent
- keine Altlasten aus manuellem Edit
- klare Nachvollziehbarkeit

---

## 7) Validierung vor Schreiben

Pflichtchecks Quelle:
- `OAKID`, `Accountname`, `Accountinhaber`, `Go Live Date`, `Monthly_Fee` Header vorhanden

Zeilenchecks:
- Leere Vollzeilen verwerfen
- Datum normalisieren (`Go Live Date` -> Zielformat passend zum Tab)
- Numerik robust parsen (`Monthly_Fee`, `Business Revenue`, `Number Of Locations`)
- `Oak ID` als Integer schreiben, falls gueltig

Fehlerstrategie:
- Harte Header-Fehler: Lauf `failed`
- Zeilenfehler: Zeile skippen + im Log als Warning/Error erfassen

---

## 8) Trigger-Betrieb

Empfehlung:
- Trigger A (Mail -> Drive): alle 15 oder 60 Minuten
- Trigger B (Drive -> Sheet): alle 15 oder 60 Minuten

Beide Trigger koennen getrennt laufen.
So blockiert ein Fehler in Schritt A nicht dauerhaft Schritt B.

---

## 9) Logging / Monitoring

Tab `import_log` mit mindestens:
- `run_at`
- `step`
- `status` (`OK | SKIP | FAILED`)
- `file`
- `rows`
- `note`

Sollverhalten:
- Keine neue Datei -> `SKIP`
- Neue Datei + erfolgreich -> `OK` mit Zeilenanzahl > 0

---

## 10) Definition of Done (DoD)

Die Automatisierung gilt als produktionsreif, wenn:

1. Neue Salesforce-Mail landet im Gmail-Label
2. CSV erscheint automatisch im Drive-Ordner
3. Neueste CSV wird in `Go-Live Sheet New Business` geschrieben
4. Header im Zieltab entsprechen dem app-erwarteten Schema
5. Dry-Run der Go-Live-API liefert valide Zeilen (keine strukturellen Header-Fehler)
6. Provisoriumsregeln sind im Ergebnis sichtbar:
   - `Provisionsrelevant` fuer Christiane/Slavo = `Ja`
   - `Pay Value after 3 month` leer

---

## 11) Offene Punkte fuer spaeter

- Provisorium `Provisionsrelevant` durch belastbare Fachlogik ersetzen
- `Pay Value after 3 month` ggf. fachlich berechnen statt leer
- Optional: CSV-Archivierungsregel in Drive (z. B. >30 Tage)
- Optional: Fehlerbenachrichtigung per E-Mail bei `FAILED`

