# Session-Übergabe - AE Kompensationsmodell App

**Datum:** 15.01.2026  
**Projekt:** AE Kompensationsmodell (Sales Compensation Dashboard)

---

## ✅ Erledigte Features (v3.16.24 → v3.16.26)

### v3.16.24: Zeilen-Klick für Opportunities
Klick auf Opportunity-Zeile öffnet Bearbeiten-Formular (löst Aktionen-Spalte Bug).

### v3.16.25: Leads Archivieren (Soft Delete)
Konsistente Archiv-Logik für Leads und Opportunities.

### v3.16.26: Salesforce als führendes System für Stages (StageChangeDialog)
**Stage ändern Dialog** überarbeitet:
- **Standard:** Hinweis "Stage wird über Salesforce Import aktualisiert"
- **Salesforce Link:** Button "☁️ In Salesforce öffnen" (wenn sfid vorhanden)
- **Manager Override:** Nur `line_manager` und `country_manager` können Stage manuell ändern

### v3.16.27: Salesforce-Logik auch im OpportunityForm
**Opportunity bearbeiten Formular** überarbeitet:
- **AEs:** Stage ist read-only (nur Anzeige, keine Auswahl)
- **Manager:** Können Stage ändern
- **Neue Opportunities:** Stage kann von jedem gesetzt werden
- Konsistent mit StageChangeDialog

### v3.16.28: Bugfix - Pipeline Settings 406 Error
**Problem:** `usePipelineSettings` Hook verwendete `.single()` was einen 406-Fehler wirft wenn kein Datensatz existiert.
**Lösung:** Geändert zu `.maybeSingle()` - gibt `null` zurück statt Fehler.

### v3.16.29: Analytics Filter-Modus (Erstelldatum vs. Close-Datum)
**Problem:** Im Conversion Funnel konnten mehr Closed Lost als SQL angezeigt werden, weil unterschiedliche Datumsfelder verwendet wurden.
**Lösung:** Zwei Filter-Modi zur Auswahl.

### v3.16.30: SF Erstelldatum (sf_created_date)
**Problem:** Der Erstelldatum-Filter funktionierte nicht, weil `created_at` das Import-Datum in die App ist, nicht das Salesforce-Erstelldatum.
**Lösung:** 
- Neues DB-Feld `sf_created_date` für das Original-Salesforce-Erstelldatum
- Import-Logik speichert jetzt das SF Erstelldatum aus der CSV
- Filter verwendet `sf_created_date` statt `created_at`

**WICHTIG:** Nach dem Deploy:
1. SQL-Migration ausführen: `supabase-sf-created-date.sql`
2. CSV neu importieren, damit `sf_created_date` befüllt wird

**Warum?** Salesforce ist Single Source of Truth. Daten-Konsistenz zwischen SF und der App.

---

## 📋 Projekt-Übersicht

### Was ist die App?
Sales Compensation Dashboard für Account Executives im DACH-Markt. Bildet das Kompensationsmodell ab:
- Subs ARR Provision (M0)
- Terminal Provision (M0)
- Pay ARR Provision (M3)

### Tech Stack
- **Frontend:** Next.js 14, React 18, TypeScript, Tailwind CSS
- **Backend:** Supabase (PostgreSQL + Auth)
- **Deployment:** Vercel via GitHub

### Repository
`https://github.com/markuslorscheidt-dot/ae-comp-app.git`

---

## 📁 Wichtige Dateien

| Datei | Zweck |
|-------|-------|
| `DOCUMENTATION.md` | Vollständige technische Dokumentation |
| `src/components/Pipeline.tsx` | Hauptkomponente für Pipeline (Bug hier!) |
| `src/components/OpportunityForm.tsx` | Formular mit Archivieren-Button |
| `src/lib/pipeline-hooks.ts` | Supabase-Queries für Pipeline |
| `src/lib/import-hooks.ts` | Salesforce Import-Logik |

---

## 🔄 Letzte Session (14.-15.01.2026)

### Implementierte Features (v3.16.12 → v3.16.23)

| Version | Feature |
|---------|---------|
| v3.16.15 | **Archive/Restore Feature** - Soft Delete statt Hard Delete |
| v3.16.18 | **Inhaber-Spalte** - sf_owner_name für Ex-Mitarbeiter |
| v3.16.19 | **Closed Stages Auto-Import** - Kein Konflikt bei Ex-MA |
| v3.16.20 | **Progress-Balken** mit Zeitschätzung |
| v3.16.22 | **Turbo-Import** - 100er Batch Chunks (59 Min → 1-2 Min) |
| v3.16.23 | **Pipeline Overview** Stage-Details + Archivieren-Button Fix |

### Datenbank-Änderungen (bereits in Supabase ausgeführt)
```sql
-- Archive Feature
ALTER TABLE opportunities ADD COLUMN archived BOOLEAN DEFAULT false;
ALTER TABLE opportunities ADD COLUMN archived_at TIMESTAMPTZ;
ALTER TABLE leads ADD COLUMN archived BOOLEAN DEFAULT false;
ALTER TABLE leads ADD COLUMN archived_at TIMESTAMPTZ;

-- Owner Feature
ALTER TABLE opportunities ADD COLUMN sf_owner_name VARCHAR(255);

-- Nullable user_id für Ex-Mitarbeiter Import
ALTER TABLE leads ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE opportunities ALTER COLUMN user_id DROP NOT NULL;
```

---

## 🎯 Nächste Schritte

1. ~~**Bug fixen:** Aktionen-Spalte~~ ✅ (v3.16.24)
2. ~~**Leads Archivieren:** Soft Delete~~ ✅ (v3.16.25)
3. ~~**Salesforce führend:** StageChangeDialog~~ ✅ (v3.16.26)
4. ~~**Salesforce führend:** OpportunityForm~~ ✅ (v3.16.27)
5. ~~**Bugfix:** Pipeline Settings 406~~ ✅ (v3.16.28)
6. ~~**Analytics Filter-Modus**~~ ✅ (v3.16.29)
7. ~~**SF Erstelldatum (sf_created_date)**~~ ✅ (v3.16.30)
8. **Nach Deploy:** SQL-Migration + CSV Re-Import

---

## 💡 Kontext für Claude

- User heißt **Sonja**
- Spricht **Deutsch**, Dokumentation auf Deutsch
- Lernt noch Programmieren, will gut erklärte Lösungen
- Deployment über GitHub → Vercel
- ZIP-Dateien werden für jede Version erstellt

### Deployment-Befehl (Standard)
```bash
cd ~/Downloads && rm -rf ae-comp-app && unzip ae-comp-app-vX.X.X.zip -d ae-comp-app && cd ae-comp-app && git init && git add . && git commit -m "vX.X.X - Beschreibung" && git remote add origin https://github.com/markuslorscheidt-dot/ae-comp-app.git && git push -u origin main --force
```

---

## 📦 Aktuelles Paket

Die Datei `ae-comp-app-v3.16.30.zip` enthält den kompletten, aktuellen Stand inkl. dieser Übergabe-Dokumentation.

**Version:** 3.16.30  
**Status:** ✅ Lauffähig, SF Erstelldatum (Migration + Re-Import erforderlich)
