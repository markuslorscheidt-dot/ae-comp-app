# Session-Übergabe - Commercial Business Planner

**Datum:** 23.01.2026  
**Projekt:** Commercial Business Planner (ehemals AE Kompensationsmodell)

---

## ✅ Erledigte Features (v3.16.30 → v3.18.1)

### v3.17.0: Major Refactoring - Multi-Area Business Planner

**App Umbenennung:**
- Von "AE Kompensation" zu **"Commercial Business Planner"**

**Neue Business Areas:**
- DLT (Digital Leadership Team)
- New Business
- Expanding Business
- Marketing

**Erweitertes Rollen-System (6 → 15 Rollen):**
| Rolle | Bereich | Beschreibung |
|-------|---------|--------------|
| `country_manager` | Global | Superuser, Zugang zu allem |
| `dlt_member` | DLT | Leadership, sieht alle Bereiche |
| `line_manager_new_business` | New Business | Manager für New Business |
| `line_manager_expanding_business` | Expanding | Manager für Expanding |
| `line_manager_marketing` | Marketing | Manager für Marketing |
| `head_of_partnerships` | New Business | Partnerships-Verantwortlicher |
| `ae_new_business` | New Business | Account Executive |
| `ae_expanding_business` | Expanding | Account Executive |
| `marketing_specialist` | Marketing | Marketing-Mitarbeiter |
| `bdr` | New Business | Business Development |
| `sdr` | New Business | Sales Development |
| `sales_support` | New Business | Sales Support |
| `onboarding_specialist` | New Business | Onboarding |
| `viewer` | Global | Nur Lesezugriff |

**Neue Komponenten:**
- `AreaSelector.tsx` - Bereichsauswahl nach Login
- `AreaPlaceholder.tsx` - Platzhalter für noch nicht implementierte Bereiche

### v3.17.x: Business Targets & AE-Verteilung

**Go-Live Planung komplett überarbeitet:**
- **Business Targets (100%):** Globale monatliche Ziele für Inbound, Outbound, Partnerships
- **AE-Verteilung:** Prozentuale Zuweisung pro AE (z.B. 60%/40%)
- **Manuelle Feinsteuerung:** Berechnete Werte können manuell angepasst werden
- **Validierung:** Summe der AE-Prozentsätze muss 100% ergeben

**Neue Kategorien:**
- **Terminal Sales:** Prozent der Go-Lives (z.B. 75%)
- **Tipping:** Prozent der Terminal Sales (z.B. 24%)
- **Pay Terminals (Hardware):** Mit Penetrations-Berechnung

### v3.17.x: Provisionsmodell & OTE Validierung

**AE-spezifische Provision:**
- Terminal Base/Bonus Raten (€30/€50 je nach Penetration)
- Subs ARR Tiers (pro AE konfigurierbar)
- Pay ARR Tiers (pro AE konfigurierbar)

**OTE Validierung:**
- Szenarien: 75%, 100%, 120%
- Dynamische Terminal-Provision je Szenario
- Validierungs-Ampel (Grün/Gelb/Rot)

### v3.17.x: Partner-Verwaltung & Go-Live Erweiterungen

**Partner-Verwaltung:**
- Neue Sektion in Einstellungen
- Partner anlegen, anzeigen, löschen

**Go-Live Erweiterungen:**
- **Partnership:** Dropdown zur Partner-Zuordnung
- **Filialunternehmen:** Checkbox für Unternehmen mit ≥5 Filialen
- Beide Felder werden intern dem Head-of-Partnerships zugeordnet

### v3.18.0: Subscription-Paketverwaltung (22.01.2026)

**Neue Komponente:** `SubscriptionPackageManagement.tsx`
- Pakete anlegen, anzeigen, löschen
- Standard-Pakete: Kickstart, Power, Power Plus

**Go-Live Integration:**
- Neues Dropdown "Subscription Paket" in:
  - Go-Live Erfassungsmaske
  - Bearbeiten-Dialog (Jahresübersicht)
  - Bearbeiten-Dialog (Monatliche Übersicht)

### v3.18.1: Sortierbare Tabellen & Bugfixes (23.01.2026)

**Sortierbare Spalten in Go-Lives Tabellen:**
- **YearOverview.tsx** (Jahresübersicht → Monatliche Übersicht):
  - OAK ID, Kunde, Go-Live Datum, Subs €/Monat, Subs ARR, Terminal, Pay ARR, 💰
- **MonthDetail.tsx** (Monatliche Detailansicht):
  - Kunde, Datum, Subs ARR, Terminal, Pay ARR, 💰, Gesamt ARR
- Klick auf Spaltenüberschrift = Sortierung (▲ aufsteigend / ▼ absteigend)

**Kritische Bugfixes - Persistenz:**
- `is_enterprise`, `partner_id`, `subscription_package_id` wurden nicht korrekt geladen/gespeichert
- **6 Stellen in `hooks.ts` gefixt:**
  - `useGoLives` - Transformation
  - `useAllGoLives` - Transformation
  - `useGoLivesForUser` - Transformation
  - `useMultiUserData` - Transformation (2x: initial load + refetch)
  - `updateGoLiveUniversal` - Update-Funktion erweitert

---

## 📋 Projekt-Übersicht

### Was ist die App?
**Commercial Business Planner** - Multi-Area Sales Dashboard für den DACH-Markt.

Kernfunktionen:
- Go-Live Tracking & Planung
- Kompensationsmodell (Subs ARR, Terminal, Pay ARR)
- Business Targets & AE-Verteilung
- OTE Validierung mit Szenarien
- Leaderboard
- Multi-Area Support (DLT, New Business, Expanding, Marketing)

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
| `src/app/page.tsx` | Hauptseite mit Area-Routing |
| `src/components/AreaSelector.tsx` | Bereichsauswahl nach Login |
| `src/components/Dashboard.tsx` | Haupt-Dashboard |
| `src/components/SettingsPanel.tsx` | Einstellungen (inkl. Business Targets, AE-Verteilung, OTE) |
| `src/components/GoLiveForm.tsx` | Go-Live Erfassung |
| `src/components/PartnerManagement.tsx` | Partner-Verwaltung |
| `src/components/SubscriptionPackageManagement.tsx` | Subscription-Pakete |
| `src/components/YearOverview.tsx` | Jahresübersicht mit sortierbaren Tabellen |
| `src/components/MonthDetail.tsx` | Monatsdetails mit sortierbaren Tabellen |
| `src/lib/types.ts` | TypeScript Interfaces |
| `src/lib/hooks.ts` | Supabase-Queries (alle Go-Live Transformationen) |
| `src/lib/permissions.ts` | Rollen & Berechtigungen |
| `src/lib/i18n.ts` | Übersetzungen (DE, EN, Kölsch) |

---

## 🗄️ Ausstehende SQL-Migrationen

**Diese Skripte müssen in Supabase ausgeführt werden:**

| Datei | Beschreibung | Status |
|-------|--------------|--------|
| `supabase-roles-migration-v4.sql` | Neue Rollen (6 → 15) | ⚠️ Prüfen |
| `supabase-avg-pay-bill-tipping.sql` | avg_pay_bill_tipping + target_percentage | ⚠️ Prüfen |
| `supabase-partners-rls-fix.sql` | RLS Fix für Partner-Tabelle | ⚠️ Prüfen |
| `supabase-subscription-packages.sql` | Subscription-Pakete Tabelle + Go-Live Feld | ⚠️ Ausstehend |

---

## 🎯 Nächste Schritte

1. **SQL-Migrationen prüfen/ausführen** (siehe oben)
2. **DLT-Bereich:** Leaderboards für alle Bereiche
3. **Expanding Business:** Dashboard & Features
4. **Marketing:** Dashboard & Features
5. **Go-Live Import:** CSV-Import aus Salesforce erweitern

---

## 💡 Kontext für Claude

- User heißt **Markus**
- Spricht **Deutsch**, Dokumentation auf Deutsch
- Worktree: `/Users/markuslorscheidt/.cursor/worktrees/ae-comp-app/ken`
- Deployment über GitHub → Vercel
- **MacBook für unterwegs:** Projekt von GitHub klonen

---

## 🚀 Setup auf neuem Rechner (MacBook)

```bash
# 1. Repository klonen
git clone https://github.com/markuslorscheidt-dot/ae-comp-app.git
cd ae-comp-app

# 2. Dependencies installieren
npm install

# 3. Environment-Datei erstellen (.env.local)
# Kopiere die Supabase-Credentials aus dem iMac oder Supabase Dashboard:
# NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
# NEXT_PUBLIC_SUPABASE_ANON_KEY=xxx

# 4. Dev-Server starten
npm run dev

# 5. Browser öffnen
# http://localhost:3000
```

---

## 📦 Aktuelles Paket

**Version:** 3.18.1  
**Status:** ✅ Lauffähig (SQL-Migrationen prüfen)  
**Letzte Änderung:** Sortierbare Tabellen & Persistenz-Bugfixes (23.01.2026)
