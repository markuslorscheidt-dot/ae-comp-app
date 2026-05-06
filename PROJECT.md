# Commercial Business Planner - Projektuebersicht

## Kurzbeschreibung

`ae-comp-app` ist eine Next.js-Anwendung fuer Commercial Planning, Sales Performance, ARR-Tracking, Forecasting, Import-Prozesse und Provisionslogik im DACH-Kontext. Die Anwendung kombiniert rollenbasierte Benutzerfuehrung, Supabase als Daten- und Auth-Layer, mehrere fachliche Dashboards und automatisierte Datenimporte.

## Ziele

- Zentrale Steuerung von DACH Commercial KPIs.
- Transparente Planung und Auswertung von New Business, Expanding Business, Marketing und DLT.
- Nachvollziehbare Go-Live-, ARR-, Pipeline- und Forecast-Daten.
- Rollenbasierter Zugriff mit historisierten Rollenwechseln.
- Idempotente Import-Workflows mit Dry-Run, Commit, Historie und Cron-Ausfuehrung.

## Technologie-Stack

- Framework: Next.js App Router
- Sprache: TypeScript
- UI: React, Tailwind CSS
- Datenbank und Auth: Supabase, PostgreSQL, Row Level Security
- Charts und Exporte: Recharts, jsPDF, html2canvas, pdf-lib
- Imports: Google Drive API, CSV/ZIP-Verarbeitung, PapaParse, adm-zip
- Deployment: Vercel

Aktuelle Versionen stehen in `package.json`.

## Projektstruktur

```text
ae-comp-app/
├── src/
│   ├── app/                  # Next.js App Router, API Routes und Einstieg
│   ├── components/           # UI-Komponenten und Feature-Screens
│   └── lib/                  # Fachlogik, Hooks, Typen, Supabase-Clients
├── docs/                     # Fach- und Importdokumentation
├── scripts/                  # Lokale Setup-, Cron- und Import-Skripte
├── supabase/                 # Lokale Supabase-Konfiguration und Migrationen
├── supabase-*.sql            # Projektmigrationen und Reporting-Views
├── README.md                 # Schneller Einstieg
├── DOCUMENTATION.md          # Historische technische Langdokumentation
├── AGENTS.md                 # Operativer Agenten-Kontext
└── project-context.json      # Maschinenlesbarer Projektkontext
```

## Zentrale Module

### App und Routing

- `src/app/page.tsx` ist der zentrale Einstieg in die Anwendung.
- `src/app/api/**/route.ts` enthaelt serverseitige API-Endpunkte fuer Imports, Forecasting, Rollen, Auth-Onboarding und Reporting.
- API-Routen verwenden Next.js Route Handler und greifen je nach Use Case auf Supabase-Clients mit anon oder service role zu.

### Komponenten

- `src/components/Dashboard.tsx`: Hauptdashboard.
- `src/components/DLTDashboard.tsx`: DLT-Sicht auf Commercial KPIs.
- `src/components/DLTSettings.tsx`: Zentrale Planungs- und Einstellungsoberflaeche.
- `src/components/DLTStrategicReports.tsx`: Strategische Reports, Forecasts und Exporte.
- `src/components/Pipeline.tsx`: Pipeline- und Opportunity-Management.
- `src/components/PipelineAnalytics.tsx`: Funnel-, Conversion- und Cycle-Time-Auswertungen.
- `src/components/YearOverview.tsx` und `src/components/MonthDetail.tsx`: Jahres- und Monatsauswertungen.
- `src/components/AdminPanel.tsx` und `src/components/UserProfile.tsx`: Benutzer-, Rollen- und Profilverwaltung.

### Fachlogik

- `src/lib/types.ts`: Domain-Typen fuer Rollen, Business Areas, User, Go-Lives, Settings und Pipeline.
- `src/lib/hooks.ts`: Supabase-Zugriffe und orchestrierende Datenlogik.
- `src/lib/calculations.ts`: Provisions-, ARR-, M0/M3- und Clawback-Logik.
- `src/lib/permissions.ts`: Rollen- und Berechtigungspruefungen.
- `src/lib/supabase.ts`: Clientseitige Supabase-Umgebungsauswahl.
- `src/lib/supabaseServer.ts`: Serverseitige Supabase-Clients fuer lokale und Online-Umgebungen.
- `src/lib/pdf-export.ts`, `src/lib/forecastScenarioPdf.ts`: PDF-Exportlogik.
- `src/lib/forecastScenarioReport.ts`, `src/lib/forecastScenarioReportOpenAI.ts`: Forecast-Report-Erstellung.

## Rollen und Bereiche

Business Areas:

- `dlt`
- `new_business`
- `expanding_business`
- `marketing`

Wichtige Rollen:

- `country_manager`
- `dlt_member`
- `line_manager_new_business`
- `ae_subscription_sales`
- `ae_payments`
- `commercial_director`
- `head_of_partnerships`
- `head_of_expanding_revenue`
- `line_manager_expanding_business`
- `cs_account_executive`
- `cs_account_manager`
- `cs_sdr`
- `head_of_marketing`
- `marketing_specialist`
- `marketing_executive`
- `demand_generation_specialist`
- `sonstiges`

Berechtigungen werden zentral in `src/lib/permissions.ts` gepflegt. Die effektive Sichtbarkeit von Bereichen wird ueber Rolle, Business Area und spezielle Berechtigungsfunktionen gesteuert.

## Business-kritische Regeln

- User-Lifecycle basiert auf `users.entry_date`, `users.exit_date` und `users.is_active`.
- Go-Lives duerfen nur Usern im gueltigen Beschaeftigungszeitraum zugeordnet werden.
- Rollenwechsel werden in `user_role_history` mit `effective_from` und `effective_to` historisiert.
- Provisionsrelevanz kann aus der effektiven Rolle zum Go-Live-Datum abgeleitet werden.
- M0/M3-Logik und Clawbacks liegen zentral in `src/lib/calculations.ts`.
- DLT Planning ist die zentrale Pflegeoberflaeche fuer New ARR- und Commission-Planung.
- Datenkonsistenz wird nicht nur im Frontend, sondern auch ueber SQL-Constraints, Trigger und RLS-Regeln abgesichert.

## Datenmodell

Wichtige Tabellen und Konzepte:

- `users`: Benutzerprofile, Rollen, Lifecycle-Daten.
- `user_role_history`: Historisierte Rollenwechsel.
- `role_permissions`: Rollenbasierte Berechtigungen.
- `ae_settings`: AE-spezifische Ziel- und Provisionsparameter.
- `dlt_planzahlen`: DLT-Planungswerte und aggregierte Zielwerte.
- `go_lives`: Go-Live- und ARR-Istdaten.
- `leads`, `opportunities`, `opportunity_stage_history`: Pipeline-Daten.
- `import_controls`: Persistente Auto-Import-Schalter.
- `<domain>_import_runs`, `<domain>_import_run_items`: Import-Historie je Import-Domain.

SQL-Aenderungen liegen je nach Alter und Zweck in `supabase-*.sql`, `supabase-migrations/` und `supabase/migrations/`.

## Import-Architektur

Neue Import-Routinen folgen `docs/import-playbook.md`.

Standardstruktur je Domain:

- `GET /api/<domain>/sync`: Dry-Run ohne Writes.
- `POST /api/<domain>/sync`: Commit-Import mit Upsert und Run-Historie.
- `GET /api/<domain>/sync/history`: Import-Historie.
- `GET|POST /api/<domain>/sync/cron`: geplanter Importlauf.
- `GET|PUT /api/<domain>/sync/auto-import`: Persistenter Auto-Import-Toggle.

Aktive Import-Domains umfassen unter anderem:

- Go-Live
- Salespipe
- Salespipe2
- Leads
- Signups
- Churn
- Churn Drive
- Up-/Downsells
- SMS
- Pay Stripe Terminal Installation
- Phorest Pay Revenue
- Looker Leads
- DACH Client Numbers
- Marketing Costs

Cron-Zeitplaene sind in `vercel.json` definiert. Lokale Cron- und Import-Laeufe laufen ueber die Skripte in `scripts/`.

## Forecasting und Reports

Die Forecast-Funktionen decken gespeicherte Szenarien, Enterprise Deals, Scenario Reports und PDF-Exports ab.

Wichtige Dateien:

- `src/app/api/forecast/scenarios/route.ts`
- `src/app/api/forecast/scenarios/[scenarioId]/pdf/route.ts`
- `src/app/api/forecast/scenario-report/route.ts`
- `src/app/api/forecast/enterprise-deals/route.ts`
- `src/lib/forecastScenarioReport.ts`
- `src/lib/forecastScenarioReportOpenAI.ts`
- `src/lib/forecastScenarioPdf.ts`

## Lokale Entwicklung

Installation:

```bash
npm install
```

Development Server:

```bash
npm run dev
```

Optional mit Turbo:

```bash
npm run dev:turbo
```

Build:

```bash
npm run build
```

Linting:

```bash
npm run lint
```

Lokale Supabase- und Import-Helfer:

```bash
npm run cron:local
npm run imports:auto:run
npm run imports:auto:install
npm run imports:auto:status
npm run imports:auto:uninstall
```

## Environment Variablen

Eine Vorlage liegt in `.env.example`.

Hauefig benoetigte Variablen:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `NEXT_PUBLIC_SUPABASE_LOCAL_URL`
- `NEXT_PUBLIC_SUPABASE_LOCAL_ANON_KEY`
- `NEXT_PUBLIC_SUPABASE_ONLINE_URL`
- `NEXT_PUBLIC_SUPABASE_ONLINE_ANON_KEY`
- `NEXT_PUBLIC_SUPABASE_DEFAULT_SOURCE`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_LOCAL_SERVICE_ROLE_KEY`
- `SUPABASE_ONLINE_SERVICE_ROLE_KEY`
- `CRON_SECRET`
- `GOOGLE_DRIVE_SERVICE_ACCOUNT_EMAIL`
- `GOOGLE_DRIVE_PRIVATE_KEY`
- `GOOGLE_DRIVE_*_FOLDER_ID`
- `OPENAI_API_KEY` falls OpenAI-basierte Forecast-Reports genutzt werden

Secrets duerfen nicht committed werden. Lokale Werte gehoeren in `.env`, `.env.local` oder Vercel Environment Variables.

## Deployment

- Hosting erfolgt ueber Vercel.
- Cron-Jobs sind in `vercel.json` eingetragen.
- Supabase-Konfigurationen und Migrationen muessen vor fachlichen Releases mit der Zielumgebung abgeglichen werden.
- Service-Role-Keys duerfen nur serverseitig verwendet werden.
- Cron-Endpunkte muessen mit `Authorization: Bearer <CRON_SECRET>` abgesichert sein.

## Qualitaets- und Sicherheitsregeln

- Vor fachlichen Aenderungen relevante SQL-Migrationen, RLS-Regeln und Trigger pruefen.
- Bei Rollen- oder User-Aenderungen immer Datumslogik und Rollenhistorie beruecksichtigen.
- Neue Import-Routinen muessen idempotent sein und eine Historie schreiben.
- Berechnungslogik zentralisieren, insbesondere ARR, Provision, M0/M3 und Clawbacks.
- Keine produktiven Secrets oder lokalen Logs committen.
- Tests, Build und Linting sollten vor Deployment ausgefuehrt werden.

## Wichtige Dokumente

- `README.md`: schneller Einstieg.
- `DOCUMENTATION.md`: historische technische Langdokumentation.
- `AGENTS.md`: Arbeitskontext fuer Coding Agents.
- `project-context.json`: strukturierte maschinenlesbare Projektbeschreibung.
- `docs/import-playbook.md`: verbindlicher Standard fuer Import-Routinen.
- `docs/phorest-pay-revenue-business-logic.md`: Fachlogik fuer Phorest Pay Revenue.
- `docs/pay-margin-kpi-reference.md`: KPI-Referenz fuer Pay Margin.
- `docs/go-live-mail-drive-sheet-playbook.md`: Go-Live-Mail-/Drive-/Sheet-Prozess.

## Betriebshinweise

- `main` ist der aktive Hauptbranch.
- Remote: `origin` auf GitHub.
- Die App kann zwischen lokaler und Online-Supabase-Umgebung wechseln.
- Import- und Reporting-Features sind stark datenabhaengig; Datenbankmigrationen und Environment-Variablen sind Teil des Releases.
- `README.md` und dieses Dokument sollten bei groesseren Architektur-, Import- oder Betriebsveraenderungen aktualisiert werden.
