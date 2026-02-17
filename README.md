# Commercial Business Planner

Web-App zur Steuerung von Sales-Performance, Targets und Provisionen (DACH) mit rollenbasierter Sicht auf New Business, DLT, Expanding Business und Marketing.

## Kernfunktionen

- Authentifizierung und Rollenmodell auf Supabase
- Go-Live-Erfassung inklusive Subs ARR, Terminal, Pay ARR
- Provisionsberechnung (M0/M3, Clawback, Tier-Logik)
- Team- und User-Management mit Rollenwechseln
- User-Lifecycle mit Eintritt/Austritt und datumsbasierter Zuordnungslogik
- Pipeline (Leads/Opportunities), Salesforce-Import, Analytics
- DLT-Settings, strategische Reports, PDF-Export

## Technologie

- Next.js 14, React 18, TypeScript, Tailwind CSS
- Supabase (PostgreSQL, Auth, RLS)
- Recharts, jsPDF, html2canvas

## Projektstruktur (Auszug)

- `src/app` – App Router Einstieg
- `src/components` – UI-Komponenten und Feature-Screens
- `src/lib` – Typen, Hooks, Berechnungen, Berechtigungen, API-nahe Logik
- `supabase-*.sql` – SQL-Migrationen/Policies
- `DOCUMENTATION.md` – ausführliche technische Langdoku
- `AGENTS.md` – AI/Agent-Betriebswissen
- `project-context.json` – maschinenlesbarer Projektkontext

## Setup

```bash
npm install
npm run dev
```

Lokale URL: `http://localhost:3000`

## Wichtige Scripts

- `npm run dev` – Development Server
- `npm run build` – Produktionsbuild
- `npm run start` – Produktionsstart
- `npm run lint` – Linting

## Daten- und Rollenlogik (wichtig)

- User können über `entry_date` und `exit_date` zeitlich aktiviert/deaktiviert werden.
- Go-Lives dürfen nur innerhalb des aktiven Beschäftigungszeitraums eines Users angelegt/umgehängt werden.
- Rollenwechsel werden in `user_role_history` mit `effective_from` / `effective_to` historisiert.
- Die Provisionsrelevanz kann datumsabhängig aus der effektiven Rolle abgeleitet werden.

## Dokumentations-Status

Diese README ist die schnelle Einstiegssicht.  
Für Details und Agenten-Kontext:

- Human-Detaildoku: `DOCUMENTATION.md`
- Agenten-/AI-Kontext: `AGENTS.md`
- Maschinenlesbar: `project-context.json`
