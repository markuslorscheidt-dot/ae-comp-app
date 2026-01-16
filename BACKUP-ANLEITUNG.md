# 💾 AE Kompensation - Backup & Restore Anleitung

## Übersicht

Es gibt **zwei Wege** um Backups wiederherzustellen:

| Methode | Wann verwenden? |
|---------|-----------------|
| **In der App** | App funktioniert normal, du willst nur Daten zurücksetzen |
| **Standalone Script** | App startet nicht mehr, Datenbank-Crash |

---

## 1. Backup erstellen (in der App)

1. Einloggen als Admin (Country Manager)
2. Gehe zu **⚙️ Admin-Bereich**
3. Klicke auf **💾 Backup**
4. Klicke auf **"💾 Backup herunterladen"**
5. Die Datei `backup_ae-comp_DATUM_UHRZEIT.json` wird heruntergeladen

### 📁 Backup sicher aufbewahren

Speichere das Backup an einem sicheren Ort:
- Google Drive
- Dropbox
- Lokaler Ordner mit Backup
- USB-Stick

**Empfehlung:** Erstelle mindestens wöchentlich ein Backup und **vor jedem App-Update**!

---

## 2. Backup wiederherstellen (in der App)

Wenn die App noch funktioniert:

1. Einloggen als Admin
2. **⚙️ Admin-Bereich** → **💾 Backup**
3. Klicke auf **"📁 Backup-Datei auswählen"**
4. Wähle deine Backup-Datei
5. Überprüfe die Vorschau
6. Klicke auf **"⚠️ Jetzt wiederherstellen"**
7. Warte bis die Seite neu lädt

---

## 3. Notfall-Wiederherstellung (Standalone Script)

### Wann brauche ich das?

- App zeigt Fehlermeldung beim Login
- Weiße Seite / App lädt nicht
- Datenbank ist kaputt
- Du kommst nicht mehr ins Admin-Panel

### Voraussetzungen

1. **Node.js** installiert (Version 16 oder höher)
   - Download: https://nodejs.org/
   - Prüfen: `node --version`

2. **Supabase Zugangsdaten** (einmalig einrichten)
   - Supabase Dashboard öffnen
   - **Project Settings** → **API**
   - Kopiere: **Project URL** und **service_role key**

### Einrichtung (einmalig)

1. Erstelle einen Ordner für Notfall-Restore, z.B. `ae-comp-restore`

2. Kopiere diese Dateien in den Ordner:
   - `restore-backup.js` (das Script)
   - Dein aktuelles Backup `.json`

3. Öffne Terminal/Eingabeaufforderung im Ordner

4. Installiere Supabase-Client:
   ```bash
   npm install @supabase/supabase-js
   ```

5. Erstelle eine `.env` Datei im Ordner mit deinen Daten:
   ```
   SUPABASE_URL=https://xxxxx.supabase.co
   SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
   ```
   
   **⚠️ WICHTIG:** Den `service_role` Key niemals teilen! Er hat vollen Datenbankzugriff.

### Verwendung bei Notfall

1. Öffne Terminal im Ordner mit dem Script

2. **Erst testen** (Dry-Run):
   ```bash
   node restore-backup.js backup_ae-comp_2026-01-12.json --dry-run
   ```
   Das prüft nur, ob das Backup gültig ist.

3. **Wiederherstellen**:
   ```bash
   node restore-backup.js backup_ae-comp_2026-01-12.json
   ```

4. Bestätige mit **JA** (in Großbuchstaben)

5. Warte auf die Erfolgsmeldung

6. Teste die App - sie sollte wieder funktionieren!

### Beispiel-Ausgabe

```
============================================================
  AE Kompensation - Backup Restore Script
============================================================

✅ .env Datei geladen
📁 Lade Backup: backup_ae-comp_2026-01-12-14-30-00.json

📋 Backup-Informationen:
────────────────────────────────────────
   Erstellt am:    12.1.2026, 14:30:00
   App-Version:    3.14.0
   Backup-Version: 1.0

   Enthaltene Daten:
   • 5 Benutzer
   • 3 AE-Settings
   • 47 Go-Lives
   • 2 Challenges

⚠️  WARNUNG: Dies wird folgende Daten ÜBERSCHREIBEN:
   • Alle Go-Lives
   • Alle AE-Settings
   • Alle Challenges
   • Alle Berechtigungen
   • Benutzer-Profile (Accounts bleiben erhalten)

Bist du sicher? Tippe "JA" zum Fortfahren: JA

🔄 Starte Wiederherstellung...

   Challenges... ✅ 2 wiederhergestellt
   Go-Lives... ✅ 47 wiederhergestellt
   AE-Settings... ✅ 3 wiederhergestellt
   Berechtigungen... ✅ 5 wiederhergestellt
   Benutzer-Profile... ✅ 5/5 aktualisiert

============================================================
  ✅ WIEDERHERSTELLUNG ERFOLGREICH!
============================================================

Zusammenfassung:
   ✅ 2 Challenges
   ✅ 47 Go-Lives
   ✅ 3 AE-Settings
   ✅ 5 Berechtigungen
   ✅ 5 Benutzer-Profile

🎉 Du kannst die App jetzt wieder normal verwenden.
```

---

## 4. Ordnerstruktur für Notfall-Kit

Erstelle diesen Ordner und halte ihn aktuell:

```
ae-comp-restore/
├── restore-backup.js          ← Das Restore-Script
├── .env                       ← Deine Supabase-Zugangsdaten
├── node_modules/              ← Wird automatisch erstellt
├── package.json               ← Wird automatisch erstellt
└── backups/                   ← Deine Backup-Dateien
    ├── backup_ae-comp_2026-01-12.json
    ├── backup_ae-comp_2026-01-05.json
    └── ...
```

---

## 5. Häufige Fragen

### Was passiert mit den Benutzer-Accounts?

Benutzer-Accounts (Login-Daten) werden **nicht gelöscht**. Nur die Profildaten (Name, Rolle, Region) werden aktualisiert.

### Kann ich nur bestimmte Daten wiederherstellen?

Aktuell wird immer alles wiederhergestellt. Wenn du nur bestimmte Daten brauchst, musst du die JSON-Datei manuell bearbeiten.

### Was wenn das Restore fehlschlägt?

1. Prüfe die Fehlermeldung
2. Stelle sicher, dass die `.env` Daten korrekt sind
3. Prüfe deine Internetverbindung
4. Versuche es erneut

### Wie alt darf ein Backup sein?

Backups von älteren App-Versionen sollten funktionieren. Bei großen Versionssprüngen könnte es Probleme geben - teste vorher mit `--dry-run`.

---

## 6. Checkliste vor App-Updates

- [ ] Aktuelles Backup erstellt?
- [ ] Backup heruntergeladen und gespeichert?
- [ ] Notfall-Script einsatzbereit?
- [ ] `.env` Datei aktuell?

---

## 7. Support

Bei Problemen:
1. Prüfe diese Anleitung
2. Prüfe die Fehlermeldung genau
3. Erstelle ein neues Backup (falls möglich)
4. Kontaktiere den Entwickler mit der Fehlermeldung
