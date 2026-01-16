# Demo-Modus Implementierungsplan

**Erstellt:** 11.01.2026  
**Status:** Geplant (Start: 12.01.2026)

---

## Übersicht

Der bisherige "Simulator" wird entfernt und durch einen Demo-Modus ersetzt, der vorgefertigte Daten für Präsentationen/Demos bereitstellt.

---

## Anforderungen

| Aspekt | Entscheidung |
|--------|--------------|
| **Ansatz** | Option E - Demo-Daten im Frontend (statisch im Code) |
| **Szenarien** | 3 Stück |
| | 🟡 75% Zielerreichung (Subs + Pay ARR) |
| | 🟢 100% Zielerreichung (Subs + Pay ARR) |
| | 🚀 120% Zielerreichung (Subs + Pay ARR) |
| **Fiktive AEs** | 3 mit deutschen Namen |
| **Jahr** | 2026 (komplett gefüllt, 12 Monate) |
| **Challenges** | 12 (Mix aus aktiv/abgeschlossen/abgelaufen) |
| **Zugriff** | Nur Admins (Country Manager, Line Manager) sehen Dropdown |
| **Auth im Demo** | User bleibt eingeloggt, sieht aber Demo-Daten |
| **Visuell** | Orangener Banner "DEMO-MODUS" wenn aktiv |
| **Entfernt** | Simulator-Komponente komplett |

---

## Warum Option E (Frontend-basiert)?

### Vorteile:
- **Null** Arbeit in Supabase
- Demo-Daten sind Teil des Codes (versioniert in Git)
- Sofort verfügbar, kein DB-Setup nötig
- Perfekt für Präsentationen (funktioniert offline!)
- Keine Gefahr, Prod-Daten zu verändern
- Möglichst wenig manuelle Arbeit in Supabase (Sonja's Wunsch)

### Nachteile:
- Demo-Daten nicht editierbar in der UI (nicht benötigt)
- Bei Code-Updates müssen Demo-Daten ggf. angepasst werden

---

## Technische Architektur

```
┌─────────────────────────────────────────────────────────┐
│  Header                                                 │
│  ┌─────────────────────────────────────────────────┐   │
│  │ [Dropdown: Datenquelle] (nur für Admins)        │   │
│  │  🔴 Produktion                                  │   │
│  │  🟡 Demo 75% Zielerreichung                     │   │
│  │  🟢 Demo 100% Zielerreichung                    │   │
│  │  🚀 Demo 120% Zielerreichung                    │   │
│  └─────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│  ⚠️ DEMO-MODUS (75% Szenario) - Keine echten Daten     │  ← Banner
└─────────────────────────────────────────────────────────┘
```

### Datenfluss:

```
User wählt Datenquelle
         │
         ▼
┌─────────────────┐
│ DataSourceContext│
│ (Provider)       │
└────────┬────────┘
         │
         ▼
    ┌────┴────┐
    │         │
    ▼         ▼
Produktion   Demo
(Supabase)   (Statisch)
```

### Neue Dateien:

```
src/lib/demo-data/
  ├── index.ts           # Export aller Demo-Daten
  ├── users.ts           # 3 fiktive AEs (deutsche Namen)
  ├── settings.ts        # AE Settings für alle 3
  ├── scenario-75.ts     # Go-Lives für 75% Zielerreichung
  ├── scenario-100.ts    # Go-Lives für 100% Zielerreichung
  ├── scenario-120.ts    # Go-Lives für 120% Zielerreichung
  └── challenges.ts      # 12 Demo-Challenges

src/lib/DataSourceContext.tsx  # Context für Datenquellen-Wechsel
```

### Zu entfernende Dateien:

```
src/components/Simulator.tsx  # Komplett entfernen
```

---

## Demo-Daten Umfang

| Element | Anzahl | Details |
|---------|--------|---------|
| **Fiktive AEs** | 3 | Deutsche Namen (z.B. Lisa Schmidt, Max Weber, Anna Müller) |
| **Go-Lives** | ~150-200 | Verteilt auf 12 Monate 2026, angepasst an Szenario |
| **AE Settings** | 3 | Realistische Targets pro AE |
| **Challenges** | 12 | Mix aus aktiv, abgeschlossen, abgelaufen |

### Szenarien-Logik:

| Szenario | Subs ARR | Pay ARR | Gesamt |
|----------|----------|---------|--------|
| 75% | ~75% der Targets | ~75% der Targets | 75% |
| 100% | ~100% der Targets | ~100% der Targets | 100% |
| 120% | ~120% der Targets | ~120% der Targets | 120% |

---

## Implementierungsschritte

| # | Schritt | Beschreibung | Risiko |
|---|---------|--------------|--------|
| 1 | Simulator entfernen | `Simulator.tsx` löschen, Imports entfernen | Gering |
| 2 | Demo-Daten Struktur | Users, Settings, Go-Lives, Challenges erstellen | Gering |
| 3 | DataSourceContext | Provider + Hook für Datenquellen-Wechsel | Mittel |
| 4 | Dropdown im Header | Nur für Admins sichtbar (CM, LM) | Gering |
| 5 | Demo-Banner | Orangener Banner wenn Demo aktiv | Gering |
| 6 | Hooks anpassen | Supabase vs. Demo-Daten Switch | Mittel |
| 7 | Testen | Alle Szenarien durchspielen | - |

---

## Risiken & Mitigierungen

### Risiko 1: Hook-Anpassungen (MITTEL)
**Problem:** Die aktuellen Hooks greifen direkt auf Supabase zu.
**Lösung:** Wrapper-Logik die je nach Datenquelle entscheidet.

### Risiko 2: Features im Demo-Modus (GERING)
**Problem:** Im Demo kann man keine Daten speichern.
**Lösung:** Buttons disabled oder Info-Meldung zeigen.

### Risiko 3: Kompilier-Fehler (MITTEL)
**Problem:** Bei Refactoring können Fehler entstehen.
**Lösung:** Schrittweises Vorgehen mit Zwischen-Versionen.

---

## Berechtigungen

| Rolle | Sieht Dropdown? | Kann Demo nutzen? |
|-------|-----------------|-------------------|
| AE | Nein | Nein |
| Line Manager | Ja | Ja |
| Country Manager | Ja | Ja |
| Sonstiges | Nein | Nein |

---

## UI-Elemente

### Dropdown (im Header):
```
🔴 Produktion
🟡 Demo 75%
🟢 Demo 100%
🚀 Demo 120%
```

### Banner (wenn Demo aktiv):
```
┌─────────────────────────────────────────────────────────┐
│ ⚠️ DEMO-MODUS (75% Szenario) - Keine echten Daten      │
└─────────────────────────────────────────────────────────┘
```
- Farbe: Orange
- Position: Unter Header, über Content
- Sticky oder nicht? (TBD)

---

## Nächste Schritte

1. ✅ Konzept finalisiert (11.01.2026)
2. ⏳ Implementierung starten (12.01.2026)
3. ⏳ Testen
4. ⏳ Deployment

---

## Verwandte Dokumente

- `/home/claude/DOCUMENTATION.md` - Hauptdokumentation
- `/home/claude/src/components/Simulator.tsx` - Wird entfernt
