# 📊 Technische Analyse - AE Kompensation App v3.17.0

**Erstellt:** 18.01.2026  
**Analyst:** Claude (Cursor AI)  
**Zweck:** Basis für Neuausrichtung und Konzeptentwicklung

---

## 1. Architektur-Übersicht

### 1.1 Tech-Stack

| Bereich | Technologie | Version |
|---------|-------------|---------|
| Framework | Next.js | 14.0.4 |
| UI | React + Tailwind CSS | 18.x / 3.3.x |
| Datenbank | Supabase (PostgreSQL) | - |
| Charts | Recharts | 2.10.0 |
| CSV-Parsing | PapaParse | 5.4.1 |

### 1.2 Datei-Struktur

```
src/
├── app/                    # Next.js Entry Point
│   └── page.tsx           # Routing-Logik (44 Zeilen - sehr clean)
├── components/            # 28 Komponenten
│   ├── Dashboard.tsx      # 1167 Zeilen - HAUPTPROBLEM: zu groß!
│   ├── Pipeline.tsx       # Pipeline-Management
│   ├── Leaderboard.tsx    # Rangliste + Challenges
│   └── ... (25 weitere)
└── lib/                   # Business-Logik
    ├── hooks.ts           # 1765 Zeilen - sehr umfangreich
    ├── calculations.ts    # Provisions-Berechnungen
    ├── types.ts           # TypeScript Definitionen
    ├── pipeline-types.ts  # Pipeline-spezifische Types
    └── demo-data/         # Demo-Modus Daten
```

---

## 2. Feature-Matrix

| Feature | Status | Komplexität | Code-Qualität |
|---------|--------|-------------|---------------|
| **Auth & Rollen** | ✅ Fertig | Mittel | Gut |
| **Go-Live Erfassung** | ✅ Fertig | Niedrig | Gut |
| **Provisions-Berechnung** | ✅ Fertig | Hoch | Gut (sauber in `calculations.ts`) |
| **Dashboard (KPIs)** | ✅ Fertig | Hoch | Problematisch (alles in einer Datei) |
| **Jahresübersicht** | ✅ Fertig | Mittel | OK |
| **Leaderboard** | ✅ Fertig | Mittel | OK |
| **Challenge-System** | ✅ Fertig | Hoch | Komplex aber funktional |
| **Demo-Modus** | ✅ Fertig | Mittel | Gut separiert |
| **Pipeline (Leads/Opps)** | ✅ Fertig | Sehr hoch | Komplex |
| **Salesforce Import** | ✅ Fertig | Sehr hoch | Funktional aber komplex |
| **Mehrsprachigkeit** | ✅ Fertig | Mittel | Gut (i18n.ts) |
| **Backup/Restore** | ✅ Fertig | Niedrig | Gut |

---

## 3. Komplexitäts-Hotspots (Problembereiche)

### 🔴 Dashboard.tsx (1167 Zeilen)

**Problem:** Enthält zu viel Logik:
- Navigation
- User-Selection
- Demo-Modus Handling
- View-Routing (10 verschiedene Views!)
- Comparison-Komponente inline

**Empfehlung:** In mehrere Dateien aufteilen (Navigation, ViewRouter, etc.)

### 🔴 hooks.ts (1765 Zeilen)

**Problem:** Monolithische Hook-Datei mit:
- Auth (220 Zeilen)
- Settings (480 Zeilen)
- GoLives (530 Zeilen)
- Challenges (270 Zeilen)
- Backup/Restore (265 Zeilen)

**Empfehlung:** In separate Hook-Dateien aufteilen

### 🟡 Rollen-System (6 Rollen)

| Rolle | Genutzt? | Notiz |
|-------|----------|-------|
| `country_manager` | ✅ Ja | Admin |
| `line_manager` | ✅ Ja | Team-Lead |
| `ae` | ✅ Ja | Haupt-User |
| `head_of_partnerships` | 🤷 Unklar | Hinzugefügt, aber Zweck unklar |
| `sdr` | ❌ Nein | "Noch nicht aktiv" |
| `sonstiges` | ✅ Ja | Sammelkonto |

**Frage:** Braucht ihr wirklich 6 Rollen?

---

## 4. Datenmodell-Analyse

### 4.1 Haupt-Tabellen (Kompensation)

```
users ─────────┬─────────── ae_settings
               │                │
               │                │ (1:n pro Jahr)
               │                │
               └─────────── go_lives
                               │
                               └─── (commission_relevant, oak_id)
```

### 4.2 Pipeline-Tabellen

```
leads ──────────────────── opportunities
  │                            │
  │                            ├── stage_history
  │                            │
  └── import_staging ──────────┘
```

### 4.3 SQL-Migrations (16 Dateien!)

Das zeigt organisches Wachstum - viele Hotfixes und Erweiterungen.

---

## 5. Business-Logik Analyse

### 5.1 Provisions-Berechnung (gut strukturiert)

```typescript
// Sauber in calculations.ts
- getProvisionRate()       // Tier-basierte Rate ermitteln
- calculateMonthlyResult() // Monats-Provision berechnen
- calculateYearSummary()   // Jahres-Aggregation
- validateOTESettings()    // OTE-Validierung
```

### 5.2 Pipeline-Logik (komplex aber sauber)

```typescript
// In pipeline-types.ts
- 7 Stages (sql → close_won/lost)
- Probability-basiertes Forecasting
- Salesforce-Integration (Stage-Mapping)
```

### 5.3 Potenzielle Probleme

1. **commission_relevant Flag:** Komplexe Logik - ARR zählt immer, Provision nur wenn `true`
2. **Hardcoded 2026:** An mehreren Stellen ist das Jahr hardcoded
3. **Demo vs. Produktion:** Viel conditional Logic (`isDemo ? ... : ...`)

---

## 6. UI/UX Beobachtungen

### Positiv ✅

- Konsistente Tailwind-Klassen
- Mehrsprachigkeit gut umgesetzt
- Dashboard-KPIs klar strukturiert

### Problematisch ⚠️

- **Navigation:** 10+ Views, aber nur 6-7 Buttons sichtbar
- **Pipeline vs. Go-Lives:** Zwei getrennte Konzepte die sich überlappen
- **Demo-Banner:** Nimmt viel Platz ein
- **Viele Dropdowns:** User-Auswahl, Datenquelle, Sprache, ...

---

## 7. Was ist stabil und kann bleiben?

| Bereich | Bewertung | Empfehlung |
|---------|-----------|------------|
| **Auth-System** | ✅ Stabil | Behalten |
| **Supabase-Integration** | ✅ Stabil | Behalten |
| **Provisions-Berechnung** | ✅ Gut | Behalten |
| **Types/Interfaces** | ✅ Gut | Behalten |
| **i18n System** | ✅ Gut | Behalten |
| **Demo-Modus Infrastruktur** | ✅ Gut | Behalten |

---

## 8. Was sollte überarbeitet werden?

| Bereich | Problem | Vorschlag |
|---------|---------|-----------|
| **Dashboard.tsx** | Zu groß (1167 Zeilen) | In Komponenten aufteilen |
| **hooks.ts** | Monolithisch | In separate Dateien aufteilen |
| **View-Routing** | 10 Views in einer Komponente | Eigene Route-Struktur |
| **Rollen-System** | 6 Rollen, nicht alle genutzt | Vereinfachen auf 3-4 |
| **Pipeline vs. Go-Lives** | Überlappung | Klare Abgrenzung definieren |

---

## 9. Offene Fragen für Konzept

1. **Wer sind die echten Nutzer?** (AEs? Manager? Beide?)
2. **Pipeline oder nur Go-Lives?** (oder beides?)
3. **Salesforce-Integration?** (notwendig oder Nice-to-have?)
4. **Challenge-System?** (genutzt oder überflüssig?)
5. **Welche Rollen braucht ihr wirklich?**

---

## 10. Nächste Schritte

Nach Fertigstellung des Konzeptpapiers:

1. Konzept und technische Analyse zusammenführen
2. Priorisieren: Was muss bis Ende Januar fertig sein?
3. Entscheiden: Refactoring vs. Feature-Fokus
4. Aktionsplan erstellen

---

**Ende der technischen Analyse**
