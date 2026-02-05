# Changelog

Alle wichtigen Änderungen an diesem Projekt werden in dieser Datei dokumentiert.

## [Unreleased]

### Hinzugefügt
- **Monatsübersicht: Neue Spalten**
  - "Partner" Spalte - zeigt an, ob ein Go-Live ein Partner-Deal ist (basierend auf `partner_id`)
  - "Enterprise" Spalte - zeigt an, ob ein Go-Live ein Enterprise-Kunde ist (basierend auf `is_enterprise`)
  - "Gesamt ARR" Spalte - berechnet automatisch Subs ARR + Pay ARR
  - Sortierung für alle neuen Spalten (klickbare Spaltenüberschriften)

- **Verbesserte Benutzerführung**
  - Tabellenzeilen sind jetzt klickbar zum Bearbeiten (kein separater "Bearbeiten"-Button mehr nötig)
  - Modal-Fenster für Monatsdetails ist breiter (max-w-6xl statt max-w-4xl)
  - Mobile View zeigt alle neuen Felder in optimiertem Layout

### Geändert
- **Pay ARR Berechnung korrigiert**
  - "Pay ARR Ist" wird jetzt als monatlicher Wert eingegeben und automatisch × 12 gerechnet
  - Anzeige zeigt den Ist-Wert (wenn vorhanden) statt dem Target-Wert
  - Gesamt ARR verwendet Ist-Wert für die Berechnung, wenn vorhanden
  - Formularfeld "Pay monatlich Ist" erscheint nur wenn Terminal verkauft ist

### Behoben
- **Fix: pay_arr_target** wird jetzt korrekt in der Datenbank gespeichert (fehlte in `updateGoLiveUniversal`)
- **Fix: Pay ARR Anzeige** - zeigt jetzt "Target: X €" als Unterzeile wenn beide Werte vorhanden sind

---

## [v3.18.x] - Vorherige Version

Siehe Git-History für ältere Änderungen.
