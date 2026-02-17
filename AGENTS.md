# AGENTS.md

Diese Datei ist der operative Kontext für Coding-Agents in diesem Repository.

## Projektziel

`ae-comp-app` ist ein Commercial Business Planner für DACH.  
Die App kombiniert:

- Sales-/Go-Live-Erfassung
- Provisions- und Targetlogik
- rollenbasierten Zugriff
- Pipeline- und Import-Workflows

## Architektur auf einen Blick

- Frontend: Next.js App Router (`src/app`)
- Fachlogik: `src/lib`
  - `types.ts` – zentrale Domain-Typen
  - `hooks.ts` – Supabase-Zugriffe und orchestrierende Datenlogik
  - `calculations.ts` – Berechnungslogik Provision/ARR
  - `permissions.ts` – Rollenberechtigungen
- UI/Features: `src/components`
- Datenbankmigrationen: `supabase-*.sql`

## Business-kritische Regeln

1. **User-Lifecycle**
   - `users.entry_date` / `users.exit_date`
   - Zuordnung von Go-Lives nur im gültigen Zeitfenster

2. **Rollenhistorie**
   - `user_role_history` mit `effective_from` / `effective_to`
   - Rollenwechsel sind zeitlich historisiert, nicht nur statisch

3. **Provision**
   - M0/M3-Logik in `calculations.ts`
   - Provisionsrelevanz kann aus der effektiven Rolle zum Go-Live-Datum abgeleitet werden

4. **Datenkonsistenz**
   - DB-seitige Trigger/Checks aus SQL-Migrationen beachten
   - Keine Logik nur im Frontend absichern, wenn DB-Regel existiert

## Wo Änderungen typischerweise passieren

- Neue Domain-Felder:
  - SQL Migration
  - `src/lib/types.ts`
  - Mapping in `src/lib/hooks.ts`
  - UI-Formulare in `src/components/*`

- Rollen-/Rechteänderungen:
  - `src/lib/permissions.ts`
  - ggf. `role_permissions`-bezogene Hooks/UI

- Provisionsanpassungen:
  - `src/lib/calculations.ts`
  - betroffene Dashboards (`Dashboard`, `YearOverview`, `MonthDetail`)

## Agent-Hinweise

- Vor größeren Änderungen zuerst bestehende SQL-Dateien prüfen (RLS, Trigger, Constraints).
- Bei User-/Rollenänderungen immer Datumslogik mitdenken.
- Bei UI-Änderungen in Userlisten prüfen, ob mehrere Admin-Oberflächen existieren (`AdminPanel`, `DLTSettings`).
- Keine fachlichen Annahmen ohne Prüfung in `hooks.ts` und `calculations.ts`.

## Maschinenlesbarer Kontext

Zusätzlich zu dieser Datei existiert `project-context.json` mit strukturierter Projektbeschreibung.
