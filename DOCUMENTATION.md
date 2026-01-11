# AE Kompensationsmodell - Technische Dokumentation

**Version:** 3.9.2  
**Letzte Aktualisierung:** 11.01.2026  
**Autor:** Claude (Anthropic)

---

## Inhaltsverzeichnis

1. [Projektübersicht](#1-projektübersicht)
2. [Technologie-Stack](#2-technologie-stack)
3. [Architektur](#3-architektur)
4. [Datenmodell](#4-datenmodell)
5. [Business-Logik](#5-business-logik)
6. [Rollen & Berechtigungen](#6-rollen--berechtigungen)
7. [Komponenten-Dokumentation](#7-komponenten-dokumentation)
8. [API & Hooks](#8-api--hooks)
9. [Multi-User Management](#9-multi-user-management)
10. [Mehrsprachigkeit](#10-mehrsprachigkeit)
11. [Deployment](#11-deployment)
12. [Changelog](#12-changelog)

---

## 1. Projektübersicht

### 1.1 Zweck

Die AE Kompensationsmodell App ist ein Sales Compensation Dashboard für Account Executives im DACH-Markt. Sie bildet das DACH-Kompensationsmodell ab, das auf drei Säulen basiert:

1. **Subs ARR Provision (M0)** - Subscription Revenue bei Go-Live
2. **Terminal Provision (M0)** - Hardware-Verkäufe bei Go-Live  
3. **Pay ARR Provision (M3)** - Payment Revenue nach 3 Monaten

### 1.2 Zielgruppen

- **Country Manager:** Vollständige Kontrolle über alle Daten und Einstellungen
- **Line Manager:** Team-Verwaltung und Dateneingabe
- **Account Executive:** Eigene Daten eingeben und Berichte ansehen
- **Sonstiges:** Zusätzliche Rollen für ARR-Tracking ohne Provision

### 1.3 Kernfunktionen

- Dashboard mit KPIs (YTD ARR, Provision, Zielerreichung)
- Go-Live Erfassung mit Subs, Terminal und Pay ARR
- **OAK ID** - Externe Referenz-ID für Go-Lives (NEU v3.6)
- **Provisions-relevant Checkbox** - Steuert ob Go-Live für Provision zählt (NEU v3.7)
- Monatliche und jährliche Übersichten
- **Klickbare Monate** mit Go-Live Details (NEU v3.6)
- **Go-Live Bearbeitung** mit User-Umbuchung (NEU v3.7.2)
- Automatische Provisionsberechnung nach DACH-Modell
- Rollenbasierte Zugriffskontrolle
- **Multi-User Management** (Einstellungen/Go-Lives pro Benutzer)
- **Alle Rollen in Anzeige** - inkl. Manager (NEU v3.7.4)
- **GESAMT-Ansicht** - Alle User aggregiert mit korrekten Zielen (NEU v3.7.6)
- **Vergleichsansicht** (mehrere Benutzer nebeneinander)
- **Mehrsprachigkeit** (Deutsch, Englisch, Kölsch) - komplett i18n (NEU v3.8.4)
- **OTE-Validierung** mit 7 Szenarien (alle Stufen) (NEU v3.8.1)
- **AE/SDR Transparency** - GESAMT sichtbar, Provision versteckt (NEU v3.8.0)
- **Leaderboard** - Provisions-Spalte nur für Manager sichtbar (NEU v3.8.0)
- **YearOverview Dashboard** - 3-Reihen KPI Layout mit Monthly Bills (NEU v3.7.9)

---

## 2. Technologie-Stack

### 2.1 Frontend

| Technologie | Version | Zweck |
|-------------|---------|-------|
| Next.js | 14.0.4 | React Framework mit App Router |
| React | 18.x | UI Library |
| TypeScript | 5.x | Typisierung |
| Tailwind CSS | 3.3.x | Styling |

### 2.2 Backend / Datenbank

| Technologie | Zweck |
|-------------|-------|
| Supabase | Backend-as-a-Service |
| PostgreSQL | Datenbank (via Supabase) |
| Supabase Auth | Authentifizierung |
| Row Level Security | Datenzugriffskontrolle |

### 2.3 Hosting

| Service | Zweck |
|---------|-------|
| Vercel | Frontend Hosting & Deployment |
| Supabase Cloud | Datenbank Hosting |

---

## 3. Architektur

### 3.1 Ordnerstruktur

```
ae-comp-app/
├── src/
│   ├── app/                    # Next.js App Router
│   │   ├── layout.tsx          # Root Layout
│   │   ├── page.tsx            # Haupt-Entry Point
│   │   └── globals.css         # Globale Styles
│   ├── components/             # React Komponenten
│   │   ├── AuthForm.tsx        # Login/Registrierung
│   │   ├── Dashboard.tsx       # Haupt-Dashboard mit Multi-User
│   │   ├── GoLiveForm.tsx      # Go-Live Eingabeformular
│   │   ├── MonthDetail.tsx     # Monatsdetail-Ansicht
│   │   ├── YearOverview.tsx    # Jahresübersicht mit 3-Reihen Dashboard
│   │   ├── AdminPanel.tsx      # Admin-Bereich
│   │   ├── SettingsPanel.tsx   # Einstellungen (komplett i18n)
│   │   ├── UserSelector.tsx    # User-Auswahl
│   │   ├── Leaderboard.tsx     # Rangliste mit Provisions-Kontrolle
│   │   ├── Simulator.tsx       # Provisions-Simulator
│   │   ├── DebugPanel.tsx      # Debug-Ansicht (nur Country Manager)
│   │   ├── LanguageSelector.tsx # Sprachauswahl
│   │   └── Confetti.tsx        # Animationen & Badge-Unlock
│   └── lib/                    # Utilities & Logik
│       ├── supabase.ts         # Supabase Client
│       ├── hooks.ts            # React Hooks für Daten
│       ├── types.ts            # TypeScript Typen
│       ├── calculations.ts     # Business-Logik + OTE-Projektion (7 Stufen)
│       ├── permissions.ts      # Berechtigungen (viewAllUsers für AE/SDR)
│       ├── badges.ts           # Badge-System
│       ├── i18n.ts             # Übersetzungen (DE, EN, Kölsch) - erweitert
│       └── LanguageContext.tsx # Sprach-Context
├── package.json
├── tsconfig.json
├── tailwind.config.js
├── next.config.js
├── supabase-settings-v24.sql   # Datenbank-Update v2.4
├── supabase-golives-rls-fix.sql # RLS Fix für Go-Live Insert (NEU v3.7.7)
└── DOCUMENTATION.md            # Diese Datei
```

### 3.2 Datenfluss

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Browser   │────▶│   Next.js   │────▶│  Supabase   │
│  (React UI) │◀────│   (Hooks)   │◀────│ (PostgreSQL)│
└─────────────┘     └─────────────┘     └─────────────┘
       │                  │
       ▼                  ▼
┌─────────────┐     ┌─────────────┐
│ UserSelector│     │ calculations│
│ (Multi-User)│     │ + OTE Valid │
└─────────────┘     └─────────────┘
```

---

## 4. Datenmodell

### 4.1 Entity Relationship Diagram

```
┌─────────────────┐       ┌─────────────────┐
│   auth.users    │       │    profiles     │
│─────────────────│       │─────────────────│
│ id (PK)         │──────▶│ id (PK, FK)     │
│ email           │       │ name            │
│ ...             │       │ email           │
└─────────────────┘       │ role            │
                          │ language        │
                          │ created_at      │
                          └────────┬────────┘
                                   │
                    ┌──────────────┼──────────────┐
                    │              │              │
                    ▼              ▼              ▼
          ┌─────────────┐  ┌─────────────┐  ┌─────────────┐
          │ ae_settings │  │  go_lives   │  │ leaderboard │
          │─────────────│  │─────────────│  │─────────────│
          │ id (PK)     │  │ id (PK)     │  │ (geplant)   │
          │ user_id(FK) │  │ user_id(FK) │  │             │
          │ year        │  │ year        │  │             │
          │ ...         │  │ month       │  │             │
          └─────────────┘  │ ...         │  └─────────────┘
                           └─────────────┘
```

### 4.2 Tabellen-Definitionen

#### 4.2.1 profiles

| Spalte | Typ | Beschreibung |
|--------|-----|--------------|
| id | UUID (PK, FK) | Referenz zu auth.users |
| name | TEXT | Anzeigename |
| email | TEXT | E-Mail Adresse |
| role | TEXT | Rolle: `country_manager`, `line_manager`, `ae`, `sdr` |
| language | TEXT | Sprache: `de`, `en`, `ksh` (NEU v2.3) |
| created_at | TIMESTAMPTZ | Erstellungsdatum |
| updated_at | TIMESTAMPTZ | Letzte Änderung |

#### 4.2.2 ae_settings (erweitert v2.4)

| Spalte | Typ | Beschreibung |
|--------|-----|--------------|
| id | UUID (PK) | Eindeutige ID |
| user_id | UUID (FK) | Referenz zu profiles |
| year | INTEGER | Geschäftsjahr |
| region | TEXT | Region (z.B. "DACH") |
| ote | NUMERIC | On-Target Earnings (€57.000) |
| **monthly_go_live_targets** | JSONB | Go-Lives pro Monat [25, 30, 32, ...] (NEU) |
| **avg_subs_bill** | NUMERIC | Durchschn. Subs €/Monat (€155) (NEU) |
| **avg_pay_bill** | NUMERIC | Durchschn. Pay €/Monat (€162) (NEU) |
| **pay_arr_factor** | NUMERIC | Pay ARR Faktor (0.75 = 75%) (NEU) |
| monthly_subs_targets | JSONB | Array mit 12 Monatszielen Subs ARR |
| monthly_pay_targets | JSONB | Array mit 12 Monatszielen Pay ARR |
| terminal_base | NUMERIC | Basis Terminal-Provision (€30) |
| terminal_bonus | NUMERIC | Bonus Terminal-Provision (€50) |
| terminal_penetration_threshold | NUMERIC | Schwelle für Bonus (0.70) |
| subs_tiers | JSONB | Subs ARR Provisions-Stufen |
| pay_tiers | JSONB | Pay ARR Provisions-Stufen |
| created_at | TIMESTAMPTZ | Erstellungsdatum |
| updated_at | TIMESTAMPTZ | Letzte Änderung |

#### 4.2.3 go_lives (erweitert v3.7)

| Spalte | Typ | Beschreibung |
|--------|-----|--------------|
| id | UUID (PK) | Eindeutige ID |
| user_id | UUID (FK) | Referenz zu profiles |
| year | INTEGER | Geschäftsjahr |
| month | INTEGER | Monat (1-12) |
| customer_name | TEXT | Kundenname |
| **oak_id** | INTEGER | Externe OAK ID (NEU v3.6) |
| go_live_date | DATE | Go-Live Datum |
| subs_monthly | NUMERIC | Monatlicher Subs-Betrag |
| subs_arr | NUMERIC | Subs ARR (= subs_monthly × 12) |
| has_terminal | BOOLEAN | Hat Terminal? |
| pay_arr | NUMERIC | Pay ARR (nach 3 Monaten) |
| **commission_relevant** | BOOLEAN | Provisions-relevant? (NEU v3.7) |
| notes | TEXT | Notizen |
| created_at | TIMESTAMPTZ | Erstellungsdatum |
| updated_at | TIMESTAMPTZ | Letzte Änderung |

---

## 5. Business-Logik

### 5.1 Das DACH-Kompensationsmodell

```
┌─────────────────────────────────────────────────────────────┐
│                    PROVISION TIMING                          │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  M0 (Go-Live)              M3 (nach 3 Monaten)              │
│  ┌─────────────────┐       ┌─────────────────┐              │
│  │ Subs ARR × Rate │       │ Pay ARR × Rate  │              │
│  │ + Terminals     │       │                 │              │
│  └─────────────────┘       └─────────────────┘              │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### 5.2 Provisions-Stufen (7 Stufen - erweitert v3.8.1)

#### Subs ARR Stufen (M0)

| Zielerreichung | Rate | Faktor für Projektion |
|----------------|------|----------------------|
| < 50% | 0,0% | 25% |
| 50% - 70% | 1,0% | 60% |
| 70% - 85% | 1,5% | 77,5% |
| 85% - 100% | 2,0% | 92,5% |
| **100% - 110%** | **2,5%** | **105%** (OTE-Referenz) |
| 110% - 120% | 3,0% | 115% |
| 120%+ | 4,0% | 125% |

#### Pay ARR Stufen (M3)

| Zielerreichung | Rate | Faktor für Projektion |
|----------------|------|----------------------|
| < 50% | 1,0% | 25% |
| 50% - 70% | 1,5% | 60% |
| 70% - 85% | 2,0% | 77,5% |
| 85% - 100% | 2,5% | 92,5% |
| **100% - 110%** | **2,9%** | **105%** (OTE-Referenz) |
| 110% - 120% | 4,0% | 115% |
| 120%+ | 5,0% | 125% |

#### Terminal-Provision (M0)

| Bedingung | Provision |
|-----------|-----------|
| Ab 1. Terminal | €30 (Basis) |
| Bei ≥70% Penetration | €50 (Bonus) |

### 5.3 Ziel-Berechnung (v2.4)

```
Monatl. Subs ARR Ziel = Go-Lives × Avg Subs Bill × 12
Monatl. Pay ARR Ziel  = Subs ARR Ziel × Pay ARR Faktor
```

**Beispiel Januar:**
- Go-Lives: 25
- Avg Subs Bill: €155
- Subs ARR Ziel: 25 × 155 × 12 = €46.500
- Pay ARR Ziel: 46.500 × 0.75 = €34.875

### 5.4 OTE-Validierung (erweitert v3.8.1)

Die App zeigt jetzt **alle 7 Projektions-Szenarien** in den Einstellungen:

| Szenario | Faktor | Beschreibung |
|----------|--------|--------------|
| < 50% | ×25% | Minimum |
| 50% - 70% | ×60% | Unterperformer |
| 70% - 85% | ×77,5% | Unter Ziel |
| 85% - 100% | ×92,5% | Knapp unter Ziel |
| **100% - 110%** | **×105%** | **Basis-Szenario (≈ OTE)** |
| 110% - 120% | ×115% | Übertreffer |
| 120%+ | ×125% | Top-Performer |

**OTE-Validierungslogik:**
```typescript
// In calculations.ts
const deviation = ((expectedProvision - ote) / ote) * 100;
const valid = Math.abs(deviation) <= 10; // ±10% Toleranz
```

### 5.5 ARR vs Provision Tracking (v3.7)

| Metrik | commission_relevant = true | commission_relevant = false |
|--------|---------------------------|----------------------------|
| ARR-Tracking | ✅ Zählt | ✅ Zählt |
| Zielerreichung % | ✅ Zählt | ❌ Zählt nicht |
| Provision | ✅ Berechnet | ❌ Keine Provision |

### 5.6 Monthly Bill Berechnung (v3.7.9)

```
Ø Monthly Subs Bill = (Total Subs ARR / 12) / Anzahl Go-Lives
Ø Monthly Pay Bill  = (Total Pay ARR / 12) / Anzahl Go-Lives
Ø Monthly All-in Bill = Ø Monthly Subs + Ø Monthly Pay
```

---

## 6. Rollen & Berechtigungen

### 6.1 Rollen-Hierarchie

```
Country Manager (Admin)
       │
       ├── Line Manager
       │        │
       │        └── Account Executive (AE)
       │                    │
       │                    └── SDR (eingeschränkt)
       │
       └── Sonstiges (nur ARR-Tracking)
```

### 6.2 Berechtigungs-Matrix (aktualisiert v3.8.0)

| Berechtigung | Country Manager | Line Manager | AE | SDR | Sonstiges |
|--------------|-----------------|--------------|----|----|-----------|
| **Ansichten** |
| Alle User sehen | ✅ | ✅ | ✅ | ✅ | ❌ |
| GESAMT-Ansicht | ✅ | ✅ | ✅ | ✅ | ❌ |
| Provisionen sehen | ✅ | ✅ | ❌ | ❌ | ❌ |
| Leaderboard komplett | ✅ | ✅ | ✅* | ✅* | ❌ |
| **Go-Lives** |
| Eigene Go-Lives eingeben | ✅ | ✅ | ✅ | ❌ | ❌ |
| Go-Lives für andere | ✅ | ✅ | ❌ | ❌ | ❌ |
| Go-Lives bearbeiten | ✅ | ✅ | ❌ | ❌ | ❌ |
| Go-Lives löschen | ✅ | ✅ | ❌ | ❌ | ❌ |
| Pay ARR eingeben | ✅ | ✅ | ❌ | ❌ | ❌ |
| **Einstellungen** |
| Einstellungen bearbeiten | ✅ | ✅ | ❌ | ❌ | ❌ |
| Provisions-Stufen ändern | ✅ | ❌ | ❌ | ❌ | ❌ |
| **Administration** |
| User anlegen/löschen | ✅ | ✅ | ❌ | ❌ | ❌ |
| Rollen zuweisen | ✅ | ❌ | ❌ | ❌ | ❌ |
| Admin-Bereich | ✅ | ✅ | ❌ | ❌ | ❌ |
| Alle Berichte sehen | ✅ | ✅ | ❌ | ❌ | ❌ |
| Berichte exportieren | ✅ | ✅ | ✅ | ❌ | ❌ |

*AE/SDR sehen Leaderboard **ohne Provisions-Spalte**

### 6.3 Go-Live Empfang nach Rolle (v3.7)

| Rolle | Kann Go-Lives erhalten | Hat Planung/Targets | Default commission_relevant |
|-------|------------------------|---------------------|----------------------------|
| Account Executive | ✅ | ✅ | ✅ true |
| Line Manager | ✅ | ❌ | ❌ false |
| Country Manager | ✅ | ❌ | ❌ false |
| Sonstiges | ✅ | ❌ | ❌ false |
| SDR | ❌ | ❌ | - |

### 6.4 Permissions Helper Functions (permissions.ts)

```typescript
canViewAllUsers(role)        // Wer kann alle User sehen?
canEditSettings(role)        // Wer kann Einstellungen bearbeiten?
canEnterPayARR(role)         // Wer kann Pay ARR eingeben?
canEnterGoLivesForOthers(role)  // Wer kann Go-Lives für andere eingeben?
canEnterOwnGoLives(role)     // Wer kann eigene Go-Lives eingeben?
canManageUsers(role)         // Wer kann User verwalten?
canAssignRoles(role)         // Wer kann Rollen zuweisen?
canEditTiers(role)           // Wer kann Provisions-Stufen ändern?
canReceiveGoLives(role)      // Kann Rolle Go-Lives erhalten?
getDefaultCommissionRelevant(role)  // Default für commission_relevant
```

---

## 7. Komponenten-Dokumentation

### 7.1 Dashboard.tsx (v3.8.0)

**Pfad:** `src/components/Dashboard.tsx`

**Zweck:** Haupt-Dashboard mit Multi-User Support und View-Routing

**State-Management:**
- `currentView`: 'dashboard' | 'year' | 'settings' | 'add' | 'admin' | 'leaderboard' | 'profile' | 'simulator'
- `selectedUserId`: Aktuell ausgewählter User
- `selectedUserIds`: Mehrere User für Vergleich

**Features:**
- User-Selector für alle Bereiche (Dashboard, Einstellungen, Go-Lives)
- Vergleichsansicht für Jahresübersicht
- GESAMT-Ansicht (alle User summiert)
- Routing zwischen allen Views

**Key Props nach unten:**
- `currentUser`, `selectedUser` an SettingsPanel
- `canEdit` an YearOverview (false für AE/SDR in GESAMT)
- `permissions` durchgereicht an alle Komponenten

### 7.2 SettingsPanel.tsx (v3.8.5)

**Pfad:** `src/components/SettingsPanel.tsx`

**Zweck:** Einstellungen basierend auf Excel-Vorlage, komplett i18n

**Bereiche:**
1. **Grundeinstellungen** - Jahr, Region, OTE
2. **Go-Lives pro Monat** - 12 Eingabefelder
3. **Durchschnittliche Monatsumsätze** - Avg Subs Bill, Avg Pay Bill, Pay ARR Faktor
4. **Monatliche ARR-Ziele** - Automatisch berechnet (read-only)
5. **Terminal-Provision** - Basis €30, Bonus €50
6. **Provisions-Stufen** - 7 editierbare Stufen (Subs + Pay)
7. **OTE-Validierung** - Alle 7 Szenarien mit Projektionen
8. **Legende** - Farbcodierung und Berechnungslogik

**Props:**
```typescript
interface SettingsPanelProps {
  settings: AESettings;
  onSave: (updates: Partial<AESettings>) => Promise<{ error: any }>;
  onBack: () => void;
  currentUser?: User;
  selectedUser?: User;  // NEU v3.8.2 - für Header "Einstellungen für X"
}
```

### 7.3 YearOverview.tsx (v3.7.9)

**Pfad:** `src/components/YearOverview.tsx`

**Zweck:** Jahresübersicht mit erweitertem Dashboard

**3-Reihen KPI Layout:**

```
┌─────────────────────────────────────────────────────────────┐
│ Reihe 1: Basis KPIs                                         │
│ ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐ │
│ │Go-Lives │ │Terminals│ │Ø Monthly│ │Ø Monthly│ │Ø Monthly│ │
│ │   25    │ │   24    │ │Subs Bill│ │Pay Bill │ │All-in   │ │
│ │         │ │         │ │  156 €  │ │   0 €   │ │  156 €  │ │
│ └─────────┘ └─────────┘ └─────────┘ └─────────┘ └─────────┘ │
├─────────────────────────────────────────────────────────────┤
│ Reihe 2: ARR vs Goals (mit Progress Bars)                   │
│ ┌───────────────┐ ┌───────────────┐ ┌───────────────┐       │
│ │ Subs ARR YTD  │ │ Pay ARR YTD   │ │ All-in ARR    │       │
│ │ vs Goal       │ │ vs Goal       │ │ YTD vs Goal   │       │
│ │ ████░░░ 45%   │ │ ░░░░░░░ 0%    │ │ ██░░░░░ 25%   │       │
│ └───────────────┘ └───────────────┘ └───────────────┘       │
├─────────────────────────────────────────────────────────────┤
│ Reihe 3: Provisionen                                        │
│ ┌───────────────┐ ┌───────────────┐ ┌───────────────┐       │
│ │Subs Provision │ │Pay Provision  │ │Gesamt Prov.   │       │
│ │    1.234 €    │ │      0 €      │ │    1.234 €    │       │
│ └───────────────┘ └───────────────┘ └───────────────┘       │
└─────────────────────────────────────────────────────────────┘
```

**Props:**
```typescript
interface YearOverviewProps {
  settings: AESettings;
  yearSummary: YearSummary;
  goLives: GoLive[];
  allUsers?: User[];
  onUpdateGoLive?: (id: string, updates: Partial<GoLive>) => Promise<void>;
  onDeleteGoLive?: (id: string) => Promise<void>;
  onBack: () => void;
  title?: string;
  canEdit?: boolean;  // false für AE/SDR
}
```

### 7.4 Leaderboard.tsx (v3.8.0)

**Pfad:** `src/components/Leaderboard.tsx`

**Zweck:** Sales Arena mit Rangliste und Achievements

**Provisions-Kontrolle:**
```typescript
// Nur Country Manager und Line Manager sehen Provision
const canViewProvision = currentUser.role === 'country_manager' 
                      || currentUser.role === 'line_manager';
```

**Bereiche:**
1. **Zeitraum-Filter** - Monat, Quartal, Jahr bis heute, Gesamtjahr
2. **Top Performer Podium** - Platz 1-3 mit Badges
3. **Komplette Rangliste** - Tabelle mit Trend-Indikatoren
4. **Hall of Fame** - All-Time Leader, Meiste Go-Lives, Höchster Monat
5. **Achievements Panel** - Badge-Übersicht

**Spalten (AE/SDR vs Manager):**
| Spalte | AE/SDR | Manager |
|--------|--------|---------|
| Rang | ✅ | ✅ |
| Trend | ✅ | ✅ |
| Name | ✅ | ✅ |
| Subs ARR | ✅ | ✅ |
| Erreichung | ✅ | ✅ |
| Pay ARR | ✅ | ✅ |
| Go-Lives | ✅ | ✅ |
| **Provision** | ❌ | ✅ |

### 7.5 GoLiveForm.tsx (v3.7.7)

**Pfad:** `src/components/GoLiveForm.tsx`

**Zweck:** Go-Live Eingabeformular

**Felder:**
- Kundenname (required)
- OAK ID (optional, numerisch)
- Go-Live Datum
- Subs €/Monat → automatisch × 12 = Subs ARR
- Terminal (Checkbox)
- Pay ARR (nur für Manager)
- Provisions-relevant (Checkbox, Default abhängig von Ziel-User)

**UX-Verbesserung (v3.7.7):**
- Nach Speichern bleibt Form offen (nicht zurück zum Dashboard)
- Felder werden geleert für schnelle Mehrfach-Eingabe
- Monat und commission_relevant bleiben erhalten
- Erfolgsmeldung für 1 Sekunde

### 7.6 MonthDetail.tsx (v3.7.2)

**Pfad:** `src/components/MonthDetail.tsx`

**Zweck:** Modal mit Go-Live Details eines Monats

**Features:**
- Liste aller Go-Lives des Monats
- Bearbeiten-Button pro Go-Live (für berechtigte User)
- Löschen-Button pro Go-Live
- Edit-Modal mit User-Umbuchung
- Summen im Footer

### 7.7 DebugPanel.tsx (v3.7.5)

**Pfad:** `src/components/DebugPanel.tsx`

**Zweck:** Debug-Informationen (nur für Country Manager)

**Anzeige:**
- currentUser (ID, Name, Role)
- selectedUserId / targetUserId
- viewUserIds
- Weitere Debug-Daten je nach Kontext

**Sichtbarkeit:**
```typescript
// Nur Country Manager sehen das Panel
{currentUser?.role === 'country_manager' && (
  <DebugPanel ... />
)}
```

### 7.8 UserSelector.tsx (v2.5)

**Pfad:** `src/components/UserSelector.tsx`

**Zweck:** User-Auswahl für Multi-User-Funktionen

**Modi:**
- `single` - Einzelauswahl (Dropdown)
- `multi` - Mehrfachauswahl (Checkboxen)
- `compare` - Vergleichsmodus (Toggle-Buttons mit "GESAMT" Option)

**Props:**
```typescript
interface UserSelectorProps {
  users: User[];
  selectedUserIds: string[];
  onSelectionChange: (ids: string[]) => void;
  currentUser: User;
  mode: 'single' | 'multi' | 'compare';
  label?: string;
  showAllOption?: boolean;  // Zeigt "GESAMT" Option
}
```

### 7.9 Simulator.tsx

**Pfad:** `src/components/Simulator.tsx`

**Zweck:** What-If Provisions-Simulator

**Features:**
- Eingabe von hypothetischen Go-Lives
- Berechnung der resultierenden Provision
- Vergleich verschiedener Szenarien

### 7.10 AdminPanel.tsx

**Pfad:** `src/components/AdminPanel.tsx`

**Zweck:** Admin-Bereich für User- und Systemverwaltung

**Tabs:**
1. **User-Verwaltung** - Liste aller User mit Rollen
2. **Neuer User** - Anlage-Formular
3. **Berechtigungen** - Matrix-Ansicht (read-only)
4. **Team-Übersicht** - Performance aller Team-Mitglieder

---

## 8. API & Hooks

### 8.1 Basis-Hooks

```typescript
// Auth
const { user, loading, signIn, signUp, signOut } = useAuth();

// Settings für aktuellen User
const { settings, loading, error, updateSettings } = useSettings(userId);

// Go-Lives für aktuellen User
const { goLives, loading, addGoLive, updateGoLive, deleteGoLive } = useGoLives(userId);
```

### 8.2 Multi-User Hooks (NEU v2.5)

```typescript
// Settings für beliebigen User
const { settings, updateSettings, refetch } = useSettingsForUser(userId);

// Go-Lives für beliebigen User
const { goLives, addGoLive, updateGoLive, deleteGoLive, refetch } = useGoLivesForUser(userId);

// Kombinierte Daten für mehrere User (Vergleich/Gesamt)
const { 
  settings,      // Map<userId, AESettings>
  goLives,       // Map<userId, GoLive[]>
  combined,      // { settings, goLives } summiert
  loading,
  refetch        // NEU v3.7.3
} = useMultiUserData(userIds);
```

### 8.3 Universal Functions (NEU v3.7.3)

Für User-übergreifende Updates ohne Hook-Abhängigkeit:

```typescript
// Universal Go-Live Update - kann User wechseln
const result = await updateGoLiveUniversal(id, {
  user_id: newUserId,
  customer_name: '...',
  commission_relevant: true,
  // ... weitere Felder
});

// Universal Go-Live Delete
const result = await deleteGoLiveUniversal(id);
```

### 8.4 Admin-Hooks

```typescript
// Alle User
const { users, updateUserRole, deleteUser, refetch } = useAllUsers();

// Alle Go-Lives (Admin)
const { goLives, loading } = useAllGoLives(year);

// Alle Settings (Admin)
const { settings, loading } = useAllSettings(year);
```

---

## 9. Multi-User Management (NEU v2.5)

### 9.1 Übersicht

Manager können Daten für jeden Benutzer verwalten:

```
┌─────────────────────────────────────────────────────┐
│  Dashboard für: [ Max Mustermann ▼ ]                │
├─────────────────────────────────────────────────────┤
│  YTD Subs ARR        YTD Pay ARR       Provision    │
│  €450.000 (95%)      €180.000 (85%)    €18.500      │
└─────────────────────────────────────────────────────┘
```

### 9.2 Bereiche mit User-Auswahl

| Bereich | Selector-Typ | Funktion |
|---------|--------------|----------|
| Dashboard | Dropdown (single) | Daten eines Users anzeigen |
| Einstellungen | Dropdown (single) | Einstellungen für User bearbeiten |
| + Go-Live | Dropdown (single) | Go-Live für User erfassen |
| Jahresübersicht | Buttons (multi) | Einzeln / Vergleich / GESAMT |

### 9.3 Vergleichsansicht

Bei Auswahl mehrerer User wird eine Vergleichstabelle angezeigt:

```
┌────────┬─────────────────────┬─────────────────────┐
│ Monat  │   Max Mustermann    │   Lisa Schmidt      │
│        │ Subs  │ Pay  │ Prov │ Subs  │ Pay  │ Prov │
├────────┼───────┼──────┼──────┼───────┼──────┼──────┤
│ Januar │ 45k   │ 18k  │ 1.8k │ 52k   │ 21k  │ 2.1k │
│ ...    │       │      │      │       │      │      │
├────────┼───────┼──────┼──────┼───────┼──────┼──────┤
│ GESAMT │ 450k  │ 180k │ 18k  │ 520k  │ 210k │ 24k  │
└────────┴───────┴──────┴──────┴───────┴──────┴──────┘
```

### 9.4 GESAMT-Ansicht

Bei Klick auf "📊 GESAMT" werden alle User summiert:
- Alle ARR-Ziele addiert
- Alle Go-Lives zusammengefasst
- Provision basierend auf Gesamt-Zielerreichung

---

## 10. Mehrsprachigkeit (erweitert v3.8.5)

### 10.1 Verfügbare Sprachen

| Code | Sprache | Flag |
|------|---------|------|
| de | Deutsch | 🇩🇪 |
| en | English | 🇬🇧 |
| ksh | Kölsch | 🍺 |

### 10.2 Speicherung

- **Vor Login:** localStorage
- **Nach Login:** Datenbank (profiles.language)

### 10.3 Verwendung

```typescript
const { t, language, setLanguage } = useLanguage();

// Übersetzung abrufen
<button>{t('common.save')}</button>  // → "Speichern" / "Save" / "Faßhalde"

// Mit Platzhaltern
t('settingsPanel.oteOverBy').replace('{percent}', '11.4')
// → "⚠ Provision 11.4% über OTE..."
```

### 10.4 i18n Struktur (i18n.ts)

```typescript
const translations = {
  de: {
    common: { ... },         // ~30 Keys
    auth: { ... },           // ~15 Keys
    nav: { ... },            // ~10 Keys
    dashboard: { ... },      // ~25 Keys
    goLive: { ... },         // ~20 Keys
    yearOverview: { ... },   // ~30 Keys (erweitert v3.8.3)
    settingsPanel: { ... },  // ~55 Keys (NEU v3.8.4)
    admin: { ... },          // ~30 Keys
    leaderboard: { ... },    // ~25 Keys
    simulator: { ... },      // ~15 Keys
    profile: { ... },        // ~10 Keys
    userSelector: { ... },   // ~10 Keys
    months: { ... },         // 12 Keys
  },
  en: { ... },  // Gleiche Struktur
  ksh: { ... }, // Gleiche Struktur
};
```

### 10.5 Wichtige i18n Sections

#### common (Basis)
```typescript
common: {
  save: 'Speichern',
  cancel: 'Abbrechen',
  delete: 'Löschen',
  edit: 'Bearbeiten',
  add: 'Hinzufügen',
  back: '← Zurück',
  loading: 'Laden...',
  error: 'Fehler',
  success: 'Erfolg',
  for: 'für',           // NEU v3.8.3
  saving: 'Speichern...', // NEU v3.8.3
  // ...
}
```

#### yearOverview (Dashboard KPIs - erweitert v3.8.3)
```typescript
yearOverview: {
  title: 'Jahresübersicht',
  goLives: 'Go-Lives',
  terminals: 'Terminals',
  m0Provision: 'Subs Provision',
  m3Provision: 'Pay Provision',
  total: 'Gesamt Provision',
  // NEU v3.8.3
  avgMonthlySubsBill: 'Ø Monthly Subs Bill',
  avgMonthlyPayBill: 'Ø Monthly Pay Bill',
  avgMonthlyAllInBill: 'Ø Monthly All-in Bill',
  subsArrYtdVsGoal: 'Subs ARR YTD vs Goal',
  payArrYtdVsGoal: 'Pay ARR YTD vs Goal',
  allInArrYtdVsGoal: 'All-in ARR YTD vs Goal',
  achieved: 'erreicht',
  // ...
}
```

#### settingsPanel (NEU v3.8.4 - ~55 Keys)
```typescript
settingsPanel: {
  // Bereiche
  basicSettings: 'Grundeinstellungen',
  goLivesPerMonth: 'Go-Lives pro AE pro Monat',
  avgMonthlyRevenue: 'Durchschnittliche Monatsumsätze',
  monthlyArrTargets: 'Monatliche ARR-Ziele (berechnet)',
  terminalProvision: 'Terminal-Provision',
  subsArrTiers: 'Subs ARR Provisions-Stufen',
  payArrTiers: 'Pay ARR Provisions-Stufen',
  oteValidation: 'OTE Validierung',
  projections: 'Projektionen bei verschiedenen Zielerreichungen',
  legendCalculation: 'Legende & Berechnungslogik',
  
  // Felder
  year: 'Jahr',
  companyRegion: 'Company / Region',
  avgSubsBill: 'Avg Subs Bill (€/Monat)',
  avgPayBill: 'Avg Pay Bill (€/Monat)',
  payArrFactor: 'Pay ARR Faktor',
  
  // Tabellen
  month: 'Monat',
  subsArrTarget: 'Subs ARR Ziel',
  payArrTarget: 'Pay ARR Ziel',
  totalArrTarget: 'Total ARR Ziel',
  yearlyTarget: 'Jahres-Ziel',
  achievement: 'Zielerreichung',
  
  // OTE Validierung (NEU v3.8.5)
  oteValid: '✓ OTE passt! Erwartete Provision bei 100-110%:',
  oteOverBy: '⚠ Provision {percent}% über OTE. Ggf. Raten oder Ziele anpassen.',
  oteUnderBy: '⚠ Provision {percent}% unter OTE. Ggf. Raten oder Ziele anpassen.',
  oteExpected: 'Erwartet',
  oteDeviation: 'Abweichung',
  
  // Aktionen
  saved: '✅ Einstellungen gespeichert!',
  saveError: '❌ Fehler beim Speichern',
  
  // Farbcodierung
  colorCoding: 'Farbcodierung:',
  greenSubs: 'Grün = Subs ARR (M0)',
  orangePay: 'Orange = Pay ARR (M3)',
  blueTerminal: 'Blau = Terminal',
  purpleTotal: 'Violett = Gesamt',
}
```

### 10.6 Kölsch-Highlights 🍺

| Deutsch | English | Kölsch |
|---------|---------|--------|
| Speichern | Save | Faßhalde |
| Abmelden | Log Out | Usslogge |
| Löschen | Delete | Fottschmieße |
| Hinzufügen | Add | Dobeipacke |
| Zurück | Back | Retuur |
| Laden... | Loading... | Lade am... |
| Fehler | Error | Fähler |
| Erfolg | Success | Joot jelaufe! |
| Januar | January | Jänner |
| März | March | Määz |
| erreicht | achieved | erreich |
| Erwartet | Expected | Erwaad |
| Abweichung | Deviation | Afwichung |

---

## 11. Deployment

### 11.1 Umgebungsvariablen

```env
NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbG...
```

### 11.2 Datenbank-Updates

Bei neuen Versionen müssen ggf. SQL-Scripts ausgeführt werden:

| Version | SQL-Datei | Beschreibung |
|---------|-----------|--------------|
| v2.1 | `supabase-roles-update.sql` | Rollen-System |
| v2.3 | `supabase-language-update.sql` | Sprach-Spalte |
| v2.4 | `supabase-settings-v24.sql` | Erweiterte Einstellungen |
| v3.5 | `supabase-challenges.sql` | Challenge-System |
| v3.6 | `supabase-golives-update.sql` | OAK ID Spalte |
| v3.7 | `supabase-golives-update.sql` | commission_relevant Spalte |
| v3.7.3 | `supabase-golives-rls-fix.sql` | RLS für UPDATE/DELETE |
| v3.7.7 | `supabase-golives-rls-fix.sql` | RLS für INSERT |

### 11.3 Kritische SQL-Scripts

**v3.7.7 - RLS INSERT Fix (WICHTIG!):**
```sql
DROP POLICY IF EXISTS "Users can insert own go_lives" ON go_lives;
CREATE POLICY "Authenticated users can insert go_lives" ON go_lives
  FOR INSERT WITH CHECK (auth.role() = 'authenticated');
```

**v3.7.3 - RLS UPDATE/DELETE Fix:**
```sql
DROP POLICY IF EXISTS "Users can update own go_lives" ON go_lives;
CREATE POLICY "Authenticated users can update all go_lives" ON go_lives
  FOR UPDATE
  USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Users can delete own go_lives" ON go_lives;
CREATE POLICY "Authenticated users can delete all go_lives" ON go_lives
  FOR DELETE
  USING (auth.role() = 'authenticated');
```

### 11.4 Deployment-Prozess (Vercel)

```bash
# 1. Download & Entpacken
cd ~/Downloads
rm -rf ae-comp-app
unzip ae-comp-app-vX.X.X.zip -d ae-comp-app

# 2. Git initialisieren
cd ae-comp-app
git init
git add .
git commit -m "vX.X.X - Beschreibung"

# 3. Push zu GitHub (löst Vercel Deploy aus)
git remote add origin https://github.com/USER/REPO.git
git push -u origin main --force
```

### 11.5 Custom Domain (Optional)

1. In Vercel: Settings → Domains → Add
2. Domain hinzufügen (z.B. `app.meinefirma.de`)
3. DNS-Einstellungen beim Domain-Provider:
   - CNAME: `app` → `cname.vercel-dns.com`
   - Oder A-Record: `76.76.21.21`
4. SSL wird automatisch von Vercel bereitgestellt

---

## 12. Changelog

### Version 3.9.2 (11.01.2026)

**Neu: Provision Area Chart (Trend-Charts Teil 3)**

- **Neue Komponente `ProvisionAreaChart`** in TrendCharts.tsx
- **Gestapeltes Flächendiagramm** zeigt kumulierte Provision:
  - Grün = M0 Provision (Subs + Terminal)
  - Orange = M3 Provision (Pay)
  - Gestrichelte Linie = OTE Referenz
- **Gradient-Füllung** für schöne Visualisierung
- **Header** zeigt Gesamt-Provision + OTE-Prozent
- **Tooltip** mit monatlichen und kumulierten Werten
- **Integration in YearOverview** nach dem Go-Lives Chart
- **Neue i18n Keys:** `m0Provision`, `m3Provision`

---

### Version 3.9.1 (11.01.2026)

**Neu: Go-Lives Bar Chart (Trend-Charts Teil 2)**

- **Neue Komponente `GoLivesBarChart`** in TrendCharts.tsx
- **Gestapeltes Balkendiagramm** zeigt Go-Lives pro Monat:
  - Grün = Ziel erreicht, Grau = Ziel verfehlt
  - Blauer Anteil = Terminals
  - Gestrichelte Linie = Zielwert
- **Interaktiv:** Klick auf Balken öffnet Monatsdetail-Modal
- **Tooltip** mit Go-Lives, Ziel, Terminals und Penetration
- **Integration in YearOverview** nach dem Performance-Chart
- **Neue i18n Keys:** `targetReached`, `targetMissed`, `clickForDetails`

---

### Version 3.9.0 (11.01.2026)

**Neu: Performance Chart (Trend-Charts Teil 1)**

- **Neue Komponente `TrendCharts.tsx`** mit `PerformanceChart`
- **Liniendiagramm** zeigt Subs ARR und Pay ARR über 12 Monate
  - Durchgezogene Linien = IST-Werte
  - Gestrichelte Linien = Ziel-Werte
  - Hover-Tooltip mit Details
- **Integration in YearOverview** nach den Provisions-KPIs
- **Neue i18n Section `trendCharts`** mit ~25 Keys (DE, EN, Kölsch)
- **Neue Dependency:** `recharts` ^2.10.0

**Technische Details:**
- Responsive Container passt sich Bildschirmgröße an
- Y-Achse formatiert als "k" für Tausender
- Custom Tooltip mit allen Details
- Farbcodierung konsistent: Grün=Subs, Orange=Pay

---

### Version 3.8.5 (11.01.2026)

**OTE Validierung komplett übersetzt**

- OTE Validierungsmeldungen jetzt in allen 3 Sprachen (DE, EN, Kölsch)
- Neue i18n Keys: `oteValid`, `oteOverBy`, `oteUnderBy`, `oteExpected`, `oteDeviation`
- `validateOTESettings()` gibt nur noch Daten zurück, Message wird in UI generiert

---

### Version 3.8.4 (11.01.2026)

**Komplette i18n für SettingsPanel**

- Alle Texte im Einstellungen-Bereich sind jetzt übersetzt (DE, EN, Kölsch)
- Neue `settingsPanel` Section in i18n.ts mit ~50 Keys
- Monatsnamen dynamisch aus i18n
- Speichern Erfolgs-/Fehlermeldungen übersetzt

---

### Version 3.8.3 (11.01.2026)

**YearOverview Dashboard i18n**

- Neue Dashboard KPIs übersetzt: avgMonthlySubsBill, avgMonthlyPayBill, avgMonthlyAllInBill
- ARR vs Goal Labels: subsArrYtdVsGoal, payArrYtdVsGoal, allInArrYtdVsGoal
- "achieved/erreicht/erreich" in allen 3 Sprachen
- Neue common Keys: `for`, `saving`

---

### Version 3.8.2 (11.01.2026)

**Einstellungen zeigt ausgewählten User**

- Header zeigt: "Einstellungen für [Name]" wenn AE ausgewählt
- Neues `selectedUser` Prop für SettingsPanel

---

### Version 3.8.1 (11.01.2026)

**Alle 7 Projektions-Stufen in Einstellungen**

- Projektionen-Tabelle zeigt jetzt alle 7 Stufen statt nur 3:
  - < 50%, 50%-70%, 70%-85%, 85%-100%, 100%-110%, 110%-120%, 120%+
- `calculateOTEProjections()` erweitert
- `validateOTESettings()` Index auf 4 (100-110%) angepasst

---

### Version 3.8.0 (11.01.2026)

**AE/SDR können GESAMT sehen, Provision versteckt**

- **Permission geändert:** `viewAllUsers` jetzt auch für AE und SDR
- **Leaderboard Provision ausgeblendet** für AE/SDR:
  - Nicht in "Dein aktueller Rang"
  - Nicht bei Top 1 Performer
  - Nicht in der Tabellen-Spalte
- **YearOverview:** AE/SDR sehen GESAMT aber können nicht bearbeiten/löschen
- Neue Variable `canViewProvision` in Leaderboard

---

### Version 3.7.9 (11.01.2026)

**Erweitertes YearOverview Dashboard**

- **Neues 3-Reihen KPI Layout:**
  - Reihe 1: Go-Lives, Terminals, Ø Monthly Subs/Pay/All-in Bill
  - Reihe 2: Subs/Pay/All-in ARR YTD vs Goal mit Progress-Bars
  - Reihe 3: Subs/Pay/Gesamt Provision
- Durchschnitt Bills = ARR / 12 / Go-Lives (Monthly)

---

### Version 3.7.8 (11.01.2026)

**Data Sync Fix**

- **Problem:** Nach Go-Live Hinzufügen zeigte YearOverview alte Daten
- **Lösung:** `refetchMulti()` nach erfolgreicher Go-Live Erstellung

---

### Version 3.7.7 (11.01.2026)

**RLS Policy Fix & Go-Live Workflow**

- **RLS Fix:** Manager konnten keine Go-Lives für andere erstellen
- **Neues SQL:** `supabase-golives-rls-fix.sql` (muss ausgeführt werden!)
- **UX:** Nach Speichern bleibt Form offen, Felder reset für schnelle Eingabe

---

### Version 3.7.6 (11.01.2026)

**GESAMT View Fixes & Spalten-Umbenennung**

- **Fix:** Go-Lives nach User-Änderung in GESAMT sichtbar
- **Fix:** GESAMT Targets nur von AEs summiert (nicht Manager)
- **Spalten umbenannt:**
  - M0 → Subs Provision
  - M3 → Pay Provision
  - Gesamt → Gesamt Provision
- Neue Spalten: Gesamt ARR Plan, Gesamt ARR IST

---

### Version 3.7.5 (11.01.2026)

**Debug Panel**

- Neue `DebugPanel` Komponente (nur für Country Manager sichtbar)
- Zeigt: currentUser, selectedUser, viewUserIds, etc.
- In Dashboard, YearOverview, GoLiveForm, Leaderboard integriert

---

### Version 3.7.4 (10.01.2026)

**Neu: Alle Rollen in Anzeige-Auswahl**

- **Line Manager und Country Manager** erscheinen jetzt im "Anzeigen"-Dropdown der Jahresübersicht
- Manager-Go-Lives können direkt eingesehen werden
- Titel zeigt "(nur ARR)" für nicht-planbare Rollen
- **useMultiUserData** lädt jetzt alle Go-Live-Empfänger

---

### Version 3.7.3 (10.01.2026)

**Fix: User-Änderung bei Go-Live Bearbeitung**

- **Problem:** User-Änderung wurde in DB gespeichert, aber UI zeigte es nicht korrekt an
- **Lösung:** Neue universelle Update/Delete-Funktionen
  - `updateGoLiveUniversal(id, updates)` - direkter Supabase-Zugriff
  - `deleteGoLiveUniversal(id)` - direkter Supabase-Zugriff
- Nach Update werden alle relevanten Daten neu geladen
- `useMultiUserData` hat jetzt `refetch` Funktion

**Hinweis:** Erfordert RLS Policy Update für go_lives (siehe SQL unten)

---

### Version 3.7.2 (10.01.2026)

**Neu: Bearbeiten-Button in Jahresübersicht**

- **Edit-Modal** auch im Monats-Detail der Jahresübersicht
- Bearbeiten und Löschen direkt aus der Monatsansicht
- Konsistente Bearbeitung an allen Stellen

---

### Version 3.7.1 (10.01.2026)

**Neu: Go-Live Bearbeiten mit User-Änderung**

- **MonthDetail** hat jetzt "Bearbeiten" Button pro Go-Live
- **Edit-Modal** mit allen Feldern:
  - Zugeordnet zu (User-Dropdown)
  - Kundenname, OAK ID, Datum
  - Subs €/Monat, Terminal, Pay ARR
  - Provisions-relevant Checkbox
- Go-Lives können zwischen Usern umgebucht werden

---

### Version 3.7.0 (10.01.2026)

**Neu: Provisions-relevant Checkbox & Go-Lives für alle Rollen**

- **Neues Feld `commission_relevant`** in go_lives Tabelle
  - Checkbox im Go-Live Formular
  - Default für AE: ✓ (provisions-relevant)
  - Default für Manager/Sonstiges: ✗ (nur ARR-Tracking)
  
- **Go-Lives für alle Rollen:**
  | Rolle | Go-Lives erhalten | Planung/Targets | Provisions-relevant (Default) |
  |-------|-------------------|-----------------|-------------------------------|
  | AE | ✓ | ✓ | ✓ Ja |
  | Line Manager | ✓ | ✗ | ✗ Nein |
  | Country Manager | ✓ | ✗ | ✗ Nein |
  | Sonstiges | ✓ | ✗ | ✗ Nein |

- **Berechnungslogik angepasst:**
  - ARR-Tracking: Alle Go-Lives zählen
  - Zielerreichung: Nur `commission_relevant = true`
  - Provision: Nur für `commission_relevant = true`

- **Neue Helper-Funktionen:**
  - `canReceiveGoLives(role)` - Kann Rolle Go-Lives erhalten?
  - `getDefaultCommissionRelevant(role)` - Default für Checkbox

---

### Version 3.6.0 (10.01.2026)

**Neu: OAK ID & Klickbare Monate**

- **OAK ID Feld** im Go-Live Formular
  - Nummerisches Feld für externe Referenz
  - Wird in allen Go-Live Listen angezeigt
  
- **Klickbare Monate in Jahresübersicht:**
  - Klick auf Monatszeile öffnet Detail-Modal
  - Zeigt alle Go-Lives des Monats:
    - OAK ID, Kundenname, Datum
    - Subs €/Monat, Subs ARR
    - Terminal (✓/-), Pay ARR
    - Provisions-relevant (💰)
  - Footer mit Summen

**Datenbank:**
```sql
ALTER TABLE go_lives ADD COLUMN IF NOT EXISTS oak_id INTEGER;
ALTER TABLE go_lives ADD COLUMN IF NOT EXISTS commission_relevant BOOLEAN DEFAULT true;
```

---

### Version 3.5.0 (09.01.2026)

**Neu: Challenge Management System**

- Challenges für Teams erstellen
- Fortschritts-Tracking
- Badge-System

---

### Version 2.5.0 (08.01.2026)

**Neu: Multi-User Management**

- **UserSelector-Komponente** für alle Bereiche
- **Dashboard** mit User-Auswahl (für Manager)
- **Einstellungen** pro Benutzer bearbeitbar
- **Go-Live** für anderen Benutzer erfassbar
- **Jahresübersicht** mit Vergleichsmodus
  - Einzelner User
  - Mehrere User nebeneinander
  - GESAMT (alle summiert)
- **Neue Hooks:**
  - `useSettingsForUser(userId)`
  - `useGoLivesForUser(userId)`
  - `useMultiUserData(userIds)`
- **ComparisonYearOverview** - Vergleichstabelle

**Berechtigungen:**
- AE: Nur eigene Daten
- Line Manager / Country Manager: Alle Daten

---

### Version 2.4.0 (08.01.2026)

**Neu: Settings-Panel (Excel Business-Logik)**

- **SettingsPanel-Komponente** mit allen Parametern
- **Grundeinstellungen:** Jahr, Region, OTE
- **Go-Lives pro Monat:** 12 Eingabefelder
- **Durchschnittliche Umsätze:** Avg Subs Bill, Avg Pay Bill, Pay ARR Faktor
- **Terminal-Provision:** Basis €30, Bonus €50
- **Provisions-Stufen:** Frei editierbar (Subs + Pay)
- **OTE-Validierung:** 3 Szenarien (100-110%, 110-120%, 120%+)
- **Automatische Ziel-Berechnung:** ARR = Go-Lives × Avg Bill × 12

**Datenbank:**
- Neue Spalten: `monthly_go_live_targets`, `avg_subs_bill`, `avg_pay_bill`, `pay_arr_factor`
- Neue Provisions-Raten (0%-5% statt 0%-10%)

---

### Version 2.3.0 (08.01.2026)

**Neu: Mehrsprachigkeit**

- **3 Sprachen:** Deutsch, English, Kölsch 🍺
- **LanguageSelector:** Button-Gruppe im Header
- **LanguageContext:** React Context für Sprache
- **i18n.ts:** Alle Übersetzungen
- **Speicherung:** localStorage + Datenbank

---

### Version 2.2.0 (08.01.2026)

**Neu: Admin-Panel erweitert**

- User-Anlage-Formular
- Berechtigungs-Matrix (read-only)
- Team-Übersicht mit Performance

---

### Version 2.1.0 (08.01.2026)

**Neu: Rollen-System**

- 4 Rollen (Country Manager, Line Manager, AE, SDR)
- Admin-Panel für User-Verwaltung
- Berechtigungs-System

---

### Version 2.0.0 (08.01.2026)

**Initial Release**

- DACH-Kompensationslogik
- 3-Säulen-Modell
- Dashboard, Go-Lives, Übersichten

---

## Anhang

### A. SQL Scripts

Alle SQL-Dateien sind im Repository enthalten:
- `supabase-update.sql` - Basis-Schema
- `supabase-roles-update.sql` - Rollen-Erweiterung
- `supabase-language-update.sql` - Sprach-Spalte
- `supabase-settings-v24.sql` - Einstellungen v2.4
- `supabase-golives-update.sql` - OAK ID & commission_relevant (v3.7)
- `supabase-challenges.sql` - Challenge System (v3.5)
- `supabase-golives-rls-fix.sql` - RLS Fix für Go-Live Insert (NEU v3.7.7)

### A.1 RLS Policy für Go-Live INSERT (v3.7.7)

**WICHTIG:** Dieses SQL muss in Supabase ausgeführt werden, damit Manager Go-Lives für andere User erstellen können:

```sql
-- RLS Policy für INSERT
DROP POLICY IF EXISTS "Users can insert own go_lives" ON go_lives;
CREATE POLICY "Authenticated users can insert go_lives" ON go_lives
  FOR INSERT WITH CHECK (auth.role() = 'authenticated');
```

### A.2 RLS Policy für Go-Live User-Änderung (v3.7.3)

Damit Go-Lives zwischen Usern umgebucht werden können, muss die RLS Policy angepasst werden:

```sql
-- Alte Policies löschen (falls vorhanden)
DROP POLICY IF EXISTS "Users can update own go_lives" ON go_lives;
DROP POLICY IF EXISTS "Users can update all go_lives" ON go_lives;

-- Neue Policy: Alle authentifizierten User können alle Go-Lives updaten
CREATE POLICY "Authenticated users can update all go_lives" ON go_lives
  FOR UPDATE
  USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

-- Auch für DELETE
DROP POLICY IF EXISTS "Users can delete own go_lives" ON go_lives;
DROP POLICY IF EXISTS "Users can delete all go_lives" ON go_lives;

CREATE POLICY "Authenticated users can delete all go_lives" ON go_lives
  FOR DELETE
  USING (auth.role() = 'authenticated');
```

### B. Kontakt

Bei Fragen zur Dokumentation oder Implementierung: Neue Chat-Session mit Claude starten und auf diese Dokumentation verweisen.

---

**Ende der Dokumentation**
