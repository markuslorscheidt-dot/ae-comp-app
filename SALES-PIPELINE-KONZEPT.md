# Sales Pipeline & Forecasting
## Konzept-Paper v1.0

**Datum:** 12. Januar 2026  
**Status:** Entwurf zur Diskussion  
**Ziel:** Erweiterung der AE Kompensation App um Pipeline-Management und Forecasting

---

## 1. Executive Summary

Die AE Kompensation App wird um ein vollständiges Sales Pipeline Management erweitert. Dies ermöglicht:

- **Pipeline-Tracking:** Verfolgung von Deals durch alle Stages (SQL → Demo → Sign-up → Go-Live)
- **Forecasting:** Gewichtete Prognosen basierend auf Probability und Sales Cycle Length
- **Conversion Analytics:** Historische Conversion-Rates zwischen Stages
- **Nahtlose Integration:** Automatische Übernahme von Pipeline-Deals in Go-Lives

---

## 2. Pipeline Stages

### 2.1 Stage-Definition

| Stage | Beschreibung | Default Probability | Typische Verweildauer |
|-------|--------------|--------------------|-----------------------|
| **SQL** | Sales Qualified Lead - Qualifizierter Kontakt, Interesse bestätigt | 15% | 7-14 Tage |
| **Demo Booked** | Demo-Termin ist vereinbart | 25% | 3-7 Tage |
| **Demo Completed** | Demo wurde durchgeführt | 50% | 7-14 Tage |
| **Sent Quote** | Angebot/Sign-up Link wurde versendet | 75% | 3-7 Tage |
| **Close Won** | Deal gewonnen → Go-Live erstellen | 100% | - |
| **Close Lost** | Deal verloren | 0% | - |

### 2.2 Stage-Übergangsregeln

```
SQL ──► Demo Booked ──► Demo Completed ──► Sent Quote ──► Close Won ──► Go-Live
 │           │               │                │              │
 │           │               │                │              └── Automatisch: Go-Live Entry
 │           │               │                │                  erstellt und verknüpft
 │           │               │                │
 │           │               │                └── Sign-up Link / Angebot versendet
 │           │               │                    Kunde hat Preise erhalten
 │           │               │
 │           │               └── Demo wurde durchgeführt
 │           │                   Kunde kennt das Produkt
 │           │
 │           └── Demo-Termin ist fest vereinbart
 │               Datum und Uhrzeit stehen fest
 │
 └── Lead ist qualifiziert:
     - Interesse bestätigt
     - Kontaktperson identifiziert
     - Grundsätzlicher Fit gegeben

                    │
                    ▼
              Close Lost (jederzeit möglich)
```

### 2.3 Abbruch-Status (Close Lost)

Deals können in jeder Stage als "Close Lost" markiert werden. 

**Standard Lost Reasons:**
| Grund | Beschreibung |
|-------|--------------|
| Konkurrenz gewählt | Kunde hat sich für Wettbewerber entschieden |
| Kein Budget | Finanzielle Mittel nicht vorhanden |
| Kein Bedarf mehr | Interesse erloschen |
| Timing passt nicht | Aktuell nicht der richtige Zeitpunkt |
| Keine Rückmeldung | Kunde reagiert nicht mehr |
| Zu teuer | Preislich nicht passend |

**Feature Lost Reasons:** (anlegbar)
| Grund | Beschreibung |
|-------|--------------|
| Feature fehlt: [X] | Spezifisches Feature wird benötigt aber fehlt |
| Integration fehlt | Benötigte Integration nicht vorhanden |

> ℹ️ **Lost Reasons sind erweiterbar:** Admins können zusätzliche Gründe anlegen.

### 2.4 Weitere Status

| Status | Beschreibung |
|--------|--------------|
| **Nurture** | Zurückgestellt, später wieder aufnehmen |
| **Disqualified** | Kein Fit (zu klein, falsches Segment, etc.) |

---

## 3. Sales Cycle Length

### 3.1 Konzept

Die **Sales Cycle Length** gibt an, wie lange ein Deal typischerweise von einer Stage bis zum Go-Live braucht. Dies ermöglicht präzisere Forecasts.

### 3.2 Berechnung

```
Expected Go-Live Date = Current Date + Remaining Cycle Time

Beispiel (Deal aktuell in "Demo"):
- Demo → Sign-up:  10 Tage (Durchschnitt)
- Sign-up → Go-Live: 5 Tage (Durchschnitt)
- Remaining Cycle: 15 Tage
- Expected Go-Live: Heute + 15 Tage
```

### 3.3 Konfigurierbare Defaults

| Von Stage | Nach Stage | Default (Tage) | Anpassbar |
|-----------|------------|----------------|-----------|
| SQL | Demo | 14 | ✅ Pro AE / Global |
| Demo | Sign-up | 10 | ✅ Pro AE / Global |
| Sign-up | Go-Live | 5 | ✅ Pro AE / Global |
| **SQL → Go-Live (gesamt)** | | **29** | Berechnet |

### 3.4 Lernende Cycle Times

Das System berechnet automatisch Durchschnittswerte aus historischen Daten:

```typescript
// Beispiel: Durchschnittliche Zeit Demo → Sign-up für AE "Lisa Schmidt"
const avgDemoToSignup = completedDeals
  .filter(d => d.user_id === 'lisa' && d.demo_date && d.signup_date)
  .map(d => daysBetween(d.demo_date, d.signup_date))
  .average(); // z.B. 8.5 Tage
```

---

## 4. Forecasting-Modell

### 4.1 Weighted Pipeline Value

```typescript
interface ForecastEntry {
  deal: PipelineEntry;
  probability: number;           // Stage-basiert oder manuell überschrieben
  expected_value: number;        // expected_subs_arr × probability
  expected_go_live_date: Date;   // Basierend auf Sales Cycle Length
}

// Forecast für Zeitraum berechnen
function calculateForecast(
  pipeline: PipelineEntry[],
  startDate: Date,
  endDate: Date
): ForecastResult {
  const relevantDeals = pipeline.filter(deal => 
    deal.expected_go_live_date >= startDate &&
    deal.expected_go_live_date <= endDate &&
    deal.stage !== 'lost'
  );
  
  return {
    weighted_subs_arr: sum(relevantDeals.map(d => d.expected_subs_arr * d.probability)),
    weighted_pay_arr: sum(relevantDeals.map(d => d.expected_pay_arr * d.probability)),
    deal_count: relevantDeals.length,
    best_case: sum(relevantDeals.map(d => d.expected_subs_arr)),  // 100%
    worst_case: sum(relevantDeals.filter(d => d.stage === 'signup').map(d => d.expected_subs_arr)),
  };
}
```

### 4.2 Forecast-Perioden

| Periode | Beschreibung | Anzeige |
|---------|--------------|---------|
| Aktueller Monat | Deals mit Expected Go-Live in diesem Monat | Primär |
| Nächster Monat | M+1 Forecast | Sekundär |
| Aktuelles Quartal | Q Forecast | Dashboard |
| Rest des Jahres | Jahres-Forecast | Übersicht |

### 4.3 Forecast vs. Target Vergleich

```
┌────────────────────────────────────────────────────────┐
│ Forecast Januar 2026                                   │
├────────────────────────────────────────────────────────┤
│                                                        │
│ Target Subs ARR:        45.000 €                       │
│ Forecast (weighted):    52.000 € ──── +15% 🟢          │
│ Best Case:              68.000 €                       │
│ Worst Case:             31.000 €                       │
│                                                        │
│ ├─────────────────────────────────────────┤            │
│ 0%              Target              150%               │
│                   │                                    │
│         ████████████████░░░░ 115%                      │
│                                                        │
└────────────────────────────────────────────────────────┘
```

---

## 5. Conversion Analytics

### 5.1 Conversion Rates

Das System trackt automatisch Conversion Rates zwischen Stages:

```typescript
interface ConversionMetrics {
  sql_to_demo: number;      // z.B. 67%
  demo_to_signup: number;   // z.B. 62%
  signup_to_golive: number; // z.B. 94%
  sql_to_golive: number;    // z.B. 39% (Gesamt)
}
```

### 5.2 Conversion-Ansicht

```
┌────────────────────────────────────────────────────────┐
│ Conversion Funnel (Letzte 90 Tage)                     │
├────────────────────────────────────────────────────────┤
│                                                        │
│ SQL (48)        ████████████████████████████  100%     │
│                          │                             │
│                         67%                            │
│                          ▼                             │
│ Demo (32)       ██████████████████            67%      │
│                          │                             │
│                         62%                            │
│                          ▼                             │
│ Sign-up (20)    ████████████                  42%      │
│                          │                             │
│                         94%                            │
│                          ▼                             │
│ Go-Live (19)    ███████████                   39%      │
│                                                        │
│ ℹ️ Durchschnittlicher Sales Cycle: 26 Tage             │
└────────────────────────────────────────────────────────┘
```

### 5.3 Conversion-Vergleich

| Vergleich | Beschreibung |
|-----------|--------------|
| AE vs. Team | Individuelle Performance vs. Team-Durchschnitt |
| Monat vs. Monat | Trend-Entwicklung |
| Nach Lead-Quelle | Welche Quellen konvertieren besser? |

---

## 6. Datenmodell

### 6.1 Konzept: Lead → Opportunity → Go-Live

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        DATENBANK-ARCHITEKTUR                            │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│   ┌─────────────┐                                                       │
│   │   LEADS     │  = Unternehmen/Salon (Stammdaten)                    │
│   │  (Accounts) │  • 1 Lead kann mehrere Filialen haben                │
│   └──────┬──────┘  • Enthält: Name, Mitarbeiter, aktuelle Software     │
│          │                                                              │
│          │ 1:n                                                          │
│          ▼                                                              │
│   ┌──────────────────┐                                                  │
│   │  OPPORTUNITIES   │  = Einzelne Deals/Filialen                      │
│   │    (Deals)       │  • Jede Filiale ist eine Opportunity            │
│   └──────┬───────────┘  • Durchläuft Pipeline-Stages                   │
│          │                                                              │
│          │ 1:1 (bei Close Won)                                          │
│          ▼                                                              │
│   ┌───────────┐                                                         │
│   │ GO-LIVES  │  = Provisionierter Abschluss                           │
│   │           │  • Wird aus Opportunity erstellt                       │
│   └───────────┘  • Verknüpft mit Lead + Opportunity                    │
│                                                                         │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  SUPPORT TABLES              SYSTEM TABLES                              │
│  ──────────────              ─────────────                              │
│  opportunity_stage_history   notifications                              │
│  pipeline_settings           notification_settings                      │
│  pipeline_activities         lost_reasons (konfigurierbar)             │
│  competitors (konfigurierbar)                                           │
│                                                                         │
│  INTEGRATION TABLES                                                     │
│  ──────────────────                                                     │
│  crm_integrations                                                       │
│  crm_sync_log                                                           │
│  crm_id_mapping                                                         │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### 6.2 Beispiel: Multi-Filial Deal

```
Lead: "Salon Müller GmbH"
├── Stammdaten:
│   • Mitarbeiter: 12
│   • Filialen: 3
│   • Quelle: Inbound Marketing
│   • Aktuelle Software: Shore
│   • Notizen: "Unzufrieden mit Shore Support"
│
├── Opportunity 1: "Filiale Köln"
│   • Stage: Close Won ✅
│   • Subs Monthly: 180€
│   • → Go-Live erstellt
│
├── Opportunity 2: "Filiale Bonn"  
│   • Stage: Demo Completed
│   • Subs Monthly: 150€
│   • Expected Close: 20.01.2026
│
└── Opportunity 3: "Filiale Düsseldorf"
    • Stage: SQL
    • Subs Monthly: 200€
    • Expected Close: 15.02.2026
```

### 6.3 Neue Tabelle: `leads`

```sql
CREATE TABLE leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),  -- Zuständiger AE
  
  -- Unternehmensdaten
  company_name VARCHAR(255) NOT NULL,
  contact_name VARCHAR(255),
  contact_email VARCHAR(255),
  contact_phone VARCHAR(50),
  
  -- Unternehmensgröße
  employee_count INTEGER,           -- Anzahl Mitarbeiter
  location_count INTEGER DEFAULT 1, -- Anzahl Filialen/Standorte
  
  -- Lead-Ursprung
  lead_source VARCHAR(50) NOT NULL,  -- 'inbound', 'outbound', 'partnership', 'enterprise'
  
  -- Aktuelle Software-Situation
  has_existing_software BOOLEAN DEFAULT false,
  competitor_id UUID REFERENCES competitors(id),  -- Welche Software nutzen sie?
  
  -- Notizen
  notes TEXT,
  
  -- Status
  status VARCHAR(20) DEFAULT 'active',  -- 'active', 'nurture', 'disqualified'
  
  -- Import-Tracking
  imported_from VARCHAR(50),      -- 'csv', 'salesforce', 'hubspot', NULL
  external_id VARCHAR(255),       -- ID im externen System
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indizes
CREATE INDEX idx_leads_user ON leads(user_id);
CREATE INDEX idx_leads_source ON leads(lead_source);
CREATE INDEX idx_leads_status ON leads(status);
CREATE INDEX idx_leads_external ON leads(imported_from, external_id);
```

### 6.4 Neue Tabelle: `opportunities`

```sql
CREATE TABLE opportunities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id),  -- Kann vom Lead abweichen
  
  -- Opportunity-Name (z.B. Filialname)
  name VARCHAR(255) NOT NULL,  -- z.B. "Filiale Köln" oder gleich wie Lead
  
  -- Stage
  stage VARCHAR(30) NOT NULL DEFAULT 'sql',  
  -- 'sql', 'demo_booked', 'demo_completed', 'sent_quote', 'close_won', 'close_lost', 'nurture'
  stage_changed_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Lost Details (wenn stage = 'close_lost')
  lost_reason_id UUID REFERENCES lost_reasons(id),
  lost_reason_notes TEXT,  -- Freitext für Details
  
  -- Werte (monatlich → ARR wird berechnet)
  expected_subs_monthly DECIMAL(10,2) NOT NULL,
  expected_subs_arr DECIMAL(10,2) GENERATED ALWAYS AS (expected_subs_monthly * 12) STORED,
  expected_pay_monthly DECIMAL(10,2) DEFAULT 0,
  expected_pay_arr DECIMAL(10,2) GENERATED ALWAYS AS (expected_pay_monthly * 12) STORED,
  has_terminal BOOLEAN DEFAULT false,
  
  -- Probability & Timing
  probability DECIMAL(3,2),        -- NULL = Stage-Default verwenden
  expected_close_date DATE,        -- Manuell oder berechnet
  
  -- Tracking-Daten
  demo_booked_date DATE,
  demo_completed_date DATE,
  quote_sent_date DATE,
  
  -- Verknüpfung zu Go-Live
  go_live_id UUID REFERENCES go_lives(id),
  
  -- Import-Tracking
  imported_from VARCHAR(50),
  external_id VARCHAR(255),
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indizes
CREATE INDEX idx_opportunities_lead ON opportunities(lead_id);
CREATE INDEX idx_opportunities_user ON opportunities(user_id);
CREATE INDEX idx_opportunities_stage ON opportunities(stage);
CREATE INDEX idx_opportunities_expected_close ON opportunities(expected_close_date);
CREATE INDEX idx_opportunities_external ON opportunities(imported_from, external_id);
```

### 6.5 Neue Tabelle: `competitors` (konfigurierbar)

```sql
CREATE TABLE competitors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(100) NOT NULL UNIQUE,
  website VARCHAR(255),
  notes TEXT,
  is_active BOOLEAN DEFAULT true,
  display_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Standard-Wettbewerber einfügen
INSERT INTO competitors (name, display_order) VALUES
  ('Shore', 1),
  ('Treatwell', 2),
  ('Planity', 3),
  ('Salonized', 4),
  ('Phorest', 5),
  ('Fresha', 6),
  ('Timify', 7),
  ('Keine Software', 99),
  ('Sonstige', 100);
```

### 6.6 Neue Tabelle: `lost_reasons` (konfigurierbar)

```sql
CREATE TABLE lost_reasons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reason VARCHAR(100) NOT NULL UNIQUE,
  category VARCHAR(50) DEFAULT 'general',  -- 'general', 'feature', 'price', 'timing'
  is_active BOOLEAN DEFAULT true,
  display_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Standard-Gründe einfügen
INSERT INTO lost_reasons (reason, category, display_order) VALUES
  ('Konkurrenz gewählt', 'general', 1),
  ('Kein Budget', 'price', 2),
  ('Kein Bedarf mehr', 'general', 3),
  ('Timing passt nicht', 'timing', 4),
  ('Keine Rückmeldung', 'general', 5),
  ('Zu teuer', 'price', 6),
  ('Feature fehlt', 'feature', 7),
  ('Integration fehlt', 'feature', 8),
  ('Sonstige', 'general', 99);
```

### 6.7 Neue Tabelle: `opportunity_stage_history`

```sql
CREATE TABLE opportunity_stage_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  opportunity_id UUID NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
  
  from_stage VARCHAR(30),
  to_stage VARCHAR(30) NOT NULL,
  changed_at TIMESTAMPTZ DEFAULT NOW(),
  changed_by UUID REFERENCES users(id),
  
  -- Snapshot der Werte zum Zeitpunkt des Wechsels
  probability_at_change DECIMAL(3,2),
  expected_arr_at_change DECIMAL(10,2)
);

CREATE INDEX idx_opp_history_opportunity ON opportunity_stage_history(opportunity_id);
CREATE INDEX idx_opp_history_date ON opportunity_stage_history(changed_at);
```

### 6.8 Neue Tabelle: `pipeline_settings`

```sql
CREATE TABLE pipeline_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id),  -- NULL = globale Defaults
  
  -- Stage Probabilities (editierbar)
  sql_probability DECIMAL(3,2) DEFAULT 0.15,
  demo_booked_probability DECIMAL(3,2) DEFAULT 0.25,
  demo_completed_probability DECIMAL(3,2) DEFAULT 0.50,
  sent_quote_probability DECIMAL(3,2) DEFAULT 0.75,
  
  -- Cycle Length in Tagen (editierbar)
  sql_to_demo_booked_days INTEGER DEFAULT 7,
  demo_booked_to_completed_days INTEGER DEFAULT 5,
  demo_completed_to_quote_days INTEGER DEFAULT 7,
  quote_to_close_days INTEGER DEFAULT 5,
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(user_id)
);

-- Globale Defaults einfügen
INSERT INTO pipeline_settings (user_id) VALUES (NULL);
```

### 6.9 Neue Tabelle: `pipeline_activities` (DB-Vorbereitung, UI später)

```sql
CREATE TABLE pipeline_activities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  opportunity_id UUID REFERENCES opportunities(id) ON DELETE CASCADE,
  lead_id UUID REFERENCES leads(id) ON DELETE CASCADE,  -- Oder direkt am Lead
  user_id UUID NOT NULL REFERENCES users(id),
  
  -- Mindestens eine Verknüpfung erforderlich
  CONSTRAINT activity_has_reference CHECK (
    opportunity_id IS NOT NULL OR lead_id IS NOT NULL
  ),
  
  -- Aktivitäts-Typ
  activity_type VARCHAR(50) NOT NULL,  -- 'call', 'email', 'meeting', 'note', 'task'
  
  -- Inhalt
  subject VARCHAR(255),
  description TEXT,
  
  -- Timing
  activity_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  duration_minutes INTEGER,
  
  -- Für Meetings
  meeting_type VARCHAR(50),  -- 'demo', 'followup', 'negotiation'
  
  -- Outcome
  outcome VARCHAR(50),  -- 'positive', 'neutral', 'negative', 'no_answer'
  next_action TEXT,
  next_action_date DATE,
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_activities_opportunity ON pipeline_activities(opportunity_id);
CREATE INDEX idx_activities_lead ON pipeline_activities(lead_id);
CREATE INDEX idx_activities_date ON pipeline_activities(activity_date);
```

### 6.10 Neue Tabelle: `notifications`

```sql
CREATE TABLE notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  
  -- Typ & Inhalt
  type VARCHAR(50) NOT NULL,
  title VARCHAR(255) NOT NULL,
  message TEXT,
  
  -- Verknüpfung
  related_type VARCHAR(50),   -- 'opportunity', 'lead', 'go_live', 'challenge'
  related_id UUID,
  
  -- Status
  is_read BOOLEAN DEFAULT false,
  read_at TIMESTAMPTZ,
  priority VARCHAR(20) DEFAULT 'normal',
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ
);

CREATE INDEX idx_notifications_user ON notifications(user_id);
CREATE INDEX idx_notifications_unread ON notifications(user_id, is_read) WHERE is_read = false;
```

### 6.11 Neue Tabelle: `notification_settings`

```sql
CREATE TABLE notification_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) UNIQUE,
  
  -- Deal-Benachrichtigungen
  notify_deal_overdue BOOLEAN DEFAULT true,
  notify_deal_stuck BOOLEAN DEFAULT true,
  notify_deal_stuck_days INTEGER DEFAULT 7,
  
  -- Forecast-Benachrichtigungen
  notify_forecast_warning BOOLEAN DEFAULT true,
  forecast_warning_threshold DECIMAL(3,2) DEFAULT 0.80,
  
  -- Team-Benachrichtigungen (nur Manager)
  notify_team_deals BOOLEAN DEFAULT false,
  notify_team_golives BOOLEAN DEFAULT true,
  
  -- Delivery
  in_app_enabled BOOLEAN DEFAULT true,
  email_enabled BOOLEAN DEFAULT false,
  email_digest VARCHAR(20) DEFAULT 'daily',
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

### 6.12 CRM-Integration Tabellen (Vorbereitung)

```sql
-- CRM Verbindungen
CREATE TABLE crm_integrations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  crm_type VARCHAR(50) NOT NULL,  -- 'salesforce', 'hubspot'
  credentials JSONB,
  sync_enabled BOOLEAN DEFAULT false,
  sync_direction VARCHAR(20) DEFAULT 'both',
  sync_frequency VARCHAR(20) DEFAULT 'hourly',
  last_sync_at TIMESTAMPTZ,
  last_sync_status VARCHAR(50),
  field_mapping JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Sync Log
CREATE TABLE crm_sync_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  integration_id UUID NOT NULL REFERENCES crm_integrations(id),
  sync_type VARCHAR(20) NOT NULL,
  direction VARCHAR(20) NOT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  status VARCHAR(50) NOT NULL DEFAULT 'running',
  records_processed INTEGER DEFAULT 0,
  records_created INTEGER DEFAULT 0,
  records_updated INTEGER DEFAULT 0,
  records_failed INTEGER DEFAULT 0,
  errors JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ID-Mapping
CREATE TABLE crm_id_mapping (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  integration_id UUID NOT NULL REFERENCES crm_integrations(id),
  local_type VARCHAR(50) NOT NULL,  -- 'lead', 'opportunity', 'go_live'
  local_id UUID NOT NULL,
  remote_type VARCHAR(50) NOT NULL,
  remote_id VARCHAR(255) NOT NULL,
  last_synced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(integration_id, local_type, local_id),
  UNIQUE(integration_id, remote_type, remote_id)
);
```

### 6.13 Erweiterung: `go_lives` Tabelle

```sql
ALTER TABLE go_lives 
ADD COLUMN lead_id UUID REFERENCES leads(id),
ADD COLUMN opportunity_id UUID REFERENCES opportunities(id);

CREATE INDEX idx_golives_lead ON go_lives(lead_id);
CREATE INDEX idx_golives_opportunity ON go_lives(opportunity_id);
```

---

## 7. Berechtigungen

### 7.1 Rollen-Matrix

| Aktion | AE | Line Manager | Country Manager |
|--------|:--:|:------------:|:---------------:|
| Eigene Pipeline-Einträge erstellen | ✅ | ✅ | ✅ |
| Eigene Pipeline-Einträge bearbeiten | ✅ | ✅ | ✅ |
| Pipeline anderer AEs sehen | ❌ | ✅ | ✅ |
| Pipeline anderer AEs bearbeiten | ❌ | ✅ | ✅ |
| Globale Pipeline-Settings ändern | ❌ | ❌ | ✅ |
| Conversion Analytics (Team) | ❌ | ✅ | ✅ |
| Conversion Analytics (Alle) | ❌ | ❌ | ✅ |

### 7.2 RLS Policies

```sql
-- Pipeline Entries: Eigene oder wenn Manager
CREATE POLICY pipeline_entries_select ON pipeline_entries
  FOR SELECT USING (
    user_id = auth.uid() OR
    EXISTS (
      SELECT 1 FROM users 
      WHERE id = auth.uid() 
      AND role IN ('line_manager', 'country_manager')
    )
  );

-- Pipeline Entries: Bearbeiten
CREATE POLICY pipeline_entries_update ON pipeline_entries
  FOR UPDATE USING (
    user_id = auth.uid() OR
    EXISTS (
      SELECT 1 FROM users 
      WHERE id = auth.uid() 
      AND role IN ('line_manager', 'country_manager')
    )
  );
```

---

## 8. User Interface

### 8.1 Neuer Haupt-Tab: "Pipeline"

```
┌─────────────────────────────────────────────────────────────────────────┐
│ Dashboard │ Jahresübersicht │ 📊 Pipeline │ 🏆 Leaderboard │ ⚙️        │
├─────────────────────────────────────────────────────────────────────────┤
```

### 8.2 Pipeline-Hauptansicht (zwei Ebenen: Leads & Opportunities)

```
┌─────────────────────────────────────────────────────────────────────────┐
│ 📊 Sales Pipeline                              [+ Neuer Lead] [📥 CSV] │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│ ┌─── Forecast Januar 2026 ────────────────────────────────────────────┐ │
│ │                                                                     │ │
│ │  Target: 45.000€     Forecast: 52.000€ (+15%) 🟢                   │ │
│ │                                                                     │ │
│ │  ████████████████████████████░░░░░░░░  115%                        │ │
│ │                                                                     │ │
│ │  Best Case: 68.000€  │  Worst Case: 31.000€  │  Opps: 18           │ │
│ └─────────────────────────────────────────────────────────────────────┘ │
│                                                                         │
│ ┌─── Pipeline Stages ─────────────────────────────────────────────────┐ │
│ │                                                                     │ │
│ │  SQL       Demo       Demo         Sent        Close                │ │
│ │            Booked     Completed    Quote       Won                  │ │
│ │  ┌─────┐  ┌─────┐    ┌─────┐     ┌─────┐     ┌─────┐               │ │
│ │  │  12 │─►│  8  │───►│  6  │────►│  4  │────►│  2  │ (diesen M.)  │ │
│ │  │ 36k │  │ 28k │    │ 22k │     │ 18k │     │ 12k │               │ │
│ │  │ 15% │  │ 25% │    │ 50% │     │ 75% │     │100% │               │ │
│ │  └─────┘  └─────┘    └─────┘     └─────┘     └─────┘               │ │
│ │                                                                     │ │
│ └─────────────────────────────────────────────────────────────────────┘ │
│                                                                         │
│ ┌─── Ansicht: [🏢 Leads ▼] ─────────────────── [Alle Stages ▼] ───────┐ │
│ │                                                                     │ │
│ │  🏢 LEADS (Unternehmen)                                             │ │
│ │  ─────────────────────────────────────────────────────────────────  │ │
│ │                                                                     │ │
│ │  ▼ Salon Müller GmbH                    Inbound │ 3 Filialen │ 12 MA│ │
│ │    │ Aktuelle Software: Shore                                       │ │
│ │    │                                                                │ │
│ │    ├─ Filiale Köln      │ ✅ Close Won │ 180€/M │ 08.01. │ [Go-Live]│ │
│ │    ├─ Filiale Bonn      │ 🟡 Demo Comp │ 150€/M │ 20.01. │ [→][✎]  │ │
│ │    └─ Filiale Düsseldorf│ 🔵 SQL       │ 200€/M │ 15.02. │ [→][✎]  │ │
│ │                                                                     │ │
│ │  ▶ Hair Design Studio                   Outbound │ 1 Filiale │ 5 MA │ │
│ │    1 Opportunity: Demo Booked                                       │ │
│ │                                                                     │ │
│ │  ▶ Beauty Corner                        Partnership │ 2 Filialen    │ │
│ │    2 Opportunities: 1× Sent Quote, 1× SQL                          │ │
│ │                                                                     │ │
│ │  ▼ Enterprise Salon Group               Enterprise │ 8 Filialen     │ │
│ │    │ Aktuelle Software: Phorest                                     │ │
│ │    │                                                                │ │
│ │    ├─ Filiale Hamburg   │ 🟢 Sent Quote│ 280€/M │ 12.01. │ [→][✎]  │ │
│ │    ├─ Filiale Berlin    │ 🟡 Demo Comp │ 320€/M │ 18.01. │ [→][✎]  │ │
│ │    ├─ Filiale München   │ 🟡 Demo Book │ 290€/M │ 25.01. │ [→][✎]  │ │
│ │    └─ ... +5 weitere                                                │ │
│ │                                                                     │ │
│ └─────────────────────────────────────────────────────────────────────┘ │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### 8.3 Neuen Lead erstellen

```
┌─────────────────────────────────────────────────────────────────────────┐
│ Neuer Lead                                                       [✕]   │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  Unternehmensdaten                                                      │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │ Unternehmensname *    [Salon Beispiel GmbH                   ]  │   │
│  │ Kontaktperson         [Maria Müller                          ]  │   │
│  │ E-Mail                [maria@salon-beispiel.de               ]  │   │
│  │ Telefon               [+49 221 12345678                      ]  │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│  Unternehmensgröße                                                      │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │ Anzahl Mitarbeiter    [      8      ]                           │   │
│  │ Anzahl Filialen       [      2      ]                           │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│  Lead-Ursprung *                                                        │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  ○ Inbound Marketing                                            │   │
│  │  ● Outbound                                                     │   │
│  │  ○ Partnership                                                  │   │
│  │  ○ Enterprise (5+ Filialen)                                     │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│  Aktuelle Software-Situation                                            │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │ Nutzt bereits Software?  [✓] Ja                                 │   │
│  │ Welche?                  [Shore                             ▼]  │   │
│  │                          + Neuen Wettbewerber anlegen           │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│  Notizen                                                                │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │ Unzufrieden mit aktuellem Support. Sucht nach Alternative.      │   │
│  │                                                                 │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│  ☐ Direkt erste Opportunity anlegen                                    │
│                                                                         │
│                                    [Abbrechen]  [💾 Lead erstellen]     │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### 8.4 Neue Opportunity erstellen (zu einem Lead)

```
┌─────────────────────────────────────────────────────────────────────────┐
│ Neue Opportunity für: Salon Müller GmbH                          [✕]   │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  Opportunity-Details                                                    │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │ Name/Filiale *        [Filiale Düsseldorf                    ]  │   │
│  │                       (Leer lassen für Single-Location Lead)    │   │
│  │                                                                 │   │
│  │ Stage *               [🔵 SQL                              ▼]  │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│  Erwartete Werte (monatlich)                                            │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │ Subs monatlich *      [         200 ] €                        │   │
│  │ → Subs ARR:           2.400 € (berechnet)                       │   │
│  │                                                                 │   │
│  │ Pay monatlich         [          50 ] €                        │   │
│  │ → Pay ARR:            600 € (berechnet)                         │   │
│  │                                                                 │   │
│  │ Terminal              [✓] Ja                                    │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│  Prognose                                                               │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │ Probability           [  15 ]% (SQL Default)      [✎ ändern]   │   │
│  │                                                                 │   │
│  │ Erwartetes Close-Datum                                          │   │
│  │   ● Automatisch: 15.02.2026 (24 Tage ab heute)                 │   │
│  │   ○ Manuell setzen: [ _________________ 📅]                     │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│                                  [Abbrechen]  [💾 Opportunity erstellen]│
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### 8.5 Stage-Wechsel Dialog

```
┌─────────────────────────────────────────────────────────────────────────┐
│ Stage ändern: Filiale Bonn                                       [✕]   │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  Lead: Salon Müller GmbH                                                │
│  Aktuell: 🟡 Demo Completed (50%)                                       │
│                                                                         │
│  Neue Stage:                                                            │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  ○  🔵 SQL              - Zurück zu SQL (15%)                  │   │
│  │  ○  📅 Demo Booked      - Demo ist terminiert (25%)            │   │
│  │  ○  🟡 Demo Completed   - Aktuelle Stage                       │   │
│  │  ●  🟢 Sent Quote       - Angebot versendet (75%)              │   │
│  │  ○  ✅ Close Won        - Deal gewonnen → Go-Live              │   │
│  │  ○  ❌ Close Lost       - Deal verloren                         │   │
│  │  ○  ⏸️ Nurture          - Zurückstellen                         │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│  📅 Angebot gesendet am:  [ 12.01.2026            📅]                  │
│                                                                         │
│  ℹ️ Neue Probability: 75%                                               │
│  ℹ️ Neues Expected Close: 17.01.2026 (5 Tage)                          │
│                                                                         │
│                                    [Abbrechen]  [✓ Stage ändern]        │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### 8.6 Close Lost Dialog

```
┌─────────────────────────────────────────────────────────────────────────┐
│ ❌ Deal als verloren markieren                                    [✕]   │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  Lead: Hair Design Studio                                               │
│  Opportunity: Hauptstandort                                             │
│                                                                         │
│  Grund für Verlust *                                                    │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  ○  Konkurrenz gewählt                                         │   │
│  │  ○  Kein Budget                                                 │   │
│  │  ○  Kein Bedarf mehr                                            │   │
│  │  ●  Feature fehlt                                               │   │
│  │  ○  Zu teuer                                                    │   │
│  │  ○  Keine Rückmeldung                                           │   │
│  │  ○  Timing passt nicht                                          │   │
│  │  ○  Sonstige                                                    │   │
│  │                                                                 │   │
│  │  [+ Neuen Grund anlegen]                                        │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│  Details zum Grund                                                      │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │ Welches Feature fehlt?                                          │   │
│  │ [Online-Terminbuchung mit Anzahlung                          ]  │   │
│  │                                                                 │   │
│  │ Weitere Notizen:                                                │   │
│  │ [Kunde möchte Anzahlungen bei Buchung. Aktuell nicht möglich.] │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│                                    [Abbrechen]  [❌ Als Lost markieren] │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### 8.7 Go-Live aus Opportunity erstellen

```
┌─────────────────────────────────────────────────────────────────────────┐
│ 🎉 Go-Live erstellen                                             [✕]   │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  Lead: Salon Müller GmbH                                                │
│  Opportunity: Filiale Köln                                              │
│                                                                         │
│  Übernommene Daten:                                                     │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │ Kundenname           Salon Müller GmbH - Filiale Köln           │   │
│  │ Subs ARR             2.160 € (180€ × 12)                        │   │
│  │ Pay ARR              600 €                                      │   │
│  │ Terminal             Ja                                         │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│  Zusätzliche Go-Live Daten:                                             │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │ OAK-ID *             [ OAK-2026-0042                         ]  │   │
│  │ Go-Live Datum *      [ 08.01.2026            📅]                │   │
│  │ Provisionsrelevant   [✓] Ja                                     │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│  ℹ️ Die Opportunity wird automatisch auf "Close Won" gesetzt            │
│     und mit dem Go-Live verknüpft.                                      │
│                                                                         │
│                                    [Abbrechen]  [🎉 Go-Live erstellen]  │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### 8.8 Admin: Konfiguration (Lost Reasons & Competitors)

```
┌─────────────────────────────────────────────────────────────────────────┐
│ ⚙️ Pipeline-Einstellungen                                               │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  [Probabilities] [Cycle Times] [Lost Reasons] [Wettbewerber]           │
│  ════════════════════════════════════════════════════════════           │
│                                                                         │
│  Lost Reasons verwalten                              [+ Neuer Grund]    │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                                                                 │   │
│  │  ☰ Konkurrenz gewählt        │ Allgemein │ ✓ Aktiv │ [✎] [🗑️] │   │
│  │  ☰ Kein Budget               │ Preis     │ ✓ Aktiv │ [✎] [🗑️] │   │
│  │  ☰ Kein Bedarf mehr          │ Allgemein │ ✓ Aktiv │ [✎] [🗑️] │   │
│  │  ☰ Timing passt nicht        │ Timing    │ ✓ Aktiv │ [✎] [🗑️] │   │
│  │  ☰ Keine Rückmeldung         │ Allgemein │ ✓ Aktiv │ [✎] [🗑️] │   │
│  │  ☰ Zu teuer                  │ Preis     │ ✓ Aktiv │ [✎] [🗑️] │   │
│  │  ☰ Feature fehlt             │ Feature   │ ✓ Aktiv │ [✎] [🗑️] │   │
│  │  ☰ Integration fehlt         │ Feature   │ ✓ Aktiv │ [✎] [🗑️] │   │
│  │  ☰ Sonstige                  │ Allgemein │ ✓ Aktiv │ [✎] [🗑️] │   │
│  │                                                                 │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│  Wettbewerber verwalten                          [+ Neuer Wettbewerber] │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                                                                 │   │
│  │  ☰ Shore                     │ shore.com      │ ✓ Aktiv │ [✎]  │   │
│  │  ☰ Treatwell                 │ treatwell.de   │ ✓ Aktiv │ [✎]  │   │
│  │  ☰ Planity                   │ planity.com    │ ✓ Aktiv │ [✎]  │   │
│  │  ☰ Salonized                 │ salonized.com  │ ✓ Aktiv │ [✎]  │   │
│  │  ☰ Phorest                   │ phorest.com    │ ✓ Aktiv │ [✎]  │   │
│  │  ☰ Fresha                    │ fresha.com     │ ✓ Aktiv │ [✎]  │   │
│  │  ☰ Timify                    │ timify.com     │ ✓ Aktiv │ [✎]  │   │
│  │  ☰ Keine Software            │ -              │ ✓ Aktiv │ [✎]  │   │
│  │  ☰ Sonstige                  │ -              │ ✓ Aktiv │ [✎]  │   │
│  │                                                                 │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 9. Dashboard Integration

### 9.1 Pipeline Widget im Dashboard

```
┌─────────────────────────────────────────────────────────────────────────┐
│ 📊 Pipeline Snapshot                              [→ Zur Pipeline]     │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  SQL: 8 │ Demo: 5 │ Sign-up: 3                                         │
│                                                                         │
│  Forecast Januar: 52.000€ (+15% vs Target) 🟢                          │
│                                                                         │
│  Nächste Aktionen:                                                      │
│  • Hair & Beauty: Sign-up Link senden (überfällig!)                    │
│  • Salon Müller: Demo morgen um 14:00                                   │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 10. Implementierungsplan

### Phase 1: Foundation (1-2 Wochen)

| Task | Aufwand | Priorität |
|------|---------|-----------|
| Datenbank-Tabellen erstellen (inkl. alle neuen Tabellen) | 3h | P0 |
| RLS Policies | 2h | P0 |
| TypeScript Types definieren | 2h | P0 |
| Basis-Hooks (CRUD Pipeline) | 4h | P0 |
| Pipeline-Liste Komponente | 4h | P0 |
| Pipeline-Entry Formular | 4h | P0 |

### Phase 2: Core Features (1-2 Wochen)

| Task | Aufwand | Priorität |
|------|---------|-----------|
| Stage-Wechsel mit History | 3h | P0 |
| Forecast-Berechnung | 4h | P0 |
| Forecast-Anzeige | 3h | P0 |
| Go-Live aus Pipeline erstellen | 3h | P0 |
| Pipeline-Settings (Admin) | 2h | P1 |
| **CSV-Import UI + Logik** | 4h | P1 |

### Phase 3: Analytics & Notifications (1-2 Wochen)

| Task | Aufwand | Priorität |
|------|---------|-----------|
| Conversion Funnel | 4h | P1 |
| Cycle Time Tracking | 3h | P1 |
| AE Vergleich | 2h | P1 |
| Lead-Quellen Analyse | 2h | P2 |
| **Notification System Backend** | 4h | P1 |
| **Notification UI (Bell + Panel)** | 3h | P1 |
| **Notification Settings** | 2h | P1 |

### Phase 4: Multi-Year & Polish (1 Woche)

| Task | Aufwand | Priorität |
|------|---------|-----------|
| **Multi-Year Forecast Berechnung** | 3h | P1 |
| **Multi-Year Forecast UI** | 3h | P1 |
| Dashboard Widget | 2h | P1 |
| Demo-Daten für Pipeline | 2h | P1 |
| i18n (DE/EN/Kölsch) | 2h | P1 |
| Mobile Optimierung | 3h | P2 |
| Dokumentation | 2h | P1 |

### Phase 5: Integration Prep (Optional, nach Launch)

| Task | Aufwand | Priorität |
|------|---------|-----------|
| **CRM Integration Tables** | 1h | P2 |
| **Salesforce OAuth Flow** | 4h | P2 |
| **Salesforce Sync Logic** | 6h | P2 |
| **HubSpot OAuth Flow** | 4h | P2 |
| **HubSpot Sync Logic** | 6h | P2 |
| **Activity Log UI** | 4h | P2 |

### Gesamtaufwand

| Phase | Aufwand | Priorität |
|-------|---------|-----------|
| Phase 1-4 (MVP) | ~6-8 Wochen | P0-P1 |
| Phase 5 (Integrationen) | ~3-4 Wochen | P2 |
| **Gesamt** | **~10-12 Wochen** | |

---

## 11. Entscheidungen & Erweiterungen

### 11.1 Bulk-Import ✅

**Entscheidung:** CSV-Import vorbereiten

```
┌─────────────────────────────────────────────────────────────────────────┐
│ 📥 Pipeline Import                                               [✕]   │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  1. CSV-Datei hochladen                                                 │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                                                                 │   │
│  │     📄 pipeline_import.csv                                      │   │
│  │        45 Einträge erkannt                                      │   │
│  │                                                    [Ändern]     │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│  2. Spalten-Mapping                                                     │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  CSV-Spalte          →  Pipeline-Feld                          │   │
│  │  ─────────────────────────────────────────────────────────────  │   │
│  │  "Kunde"             →  [customer_name           ▼]            │   │
│  │  "Status"            →  [stage                   ▼]            │   │
│  │  "Monatlich"         →  [expected_subs_monthly   ▼]            │   │
│  │  "Quelle"            →  [lead_source             ▼]            │   │
│  │  "Notizen"           →  [notes                   ▼]            │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│  3. Vorschau (erste 5 Einträge)                                         │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  ✅ Salon Müller      │ SQL   │ 180€/M │ Website               │   │
│  │  ✅ Hair Design       │ Demo  │ 220€/M │ Referral              │   │
│  │  ⚠️ Beauty Box        │ ???   │ 150€/M │ -        Stage fehlt  │   │
│  │  ✅ Styling Lounge    │ Sign  │ 280€/M │ Event                 │   │
│  │  ❌ [leer]            │ SQL   │ 200€/M │ -        Name fehlt   │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│  Zusammenfassung: 42 gültig │ 2 Warnungen │ 1 Fehler                   │
│                                                                         │
│                          [Abbrechen]  [📥 42 Einträge importieren]      │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

**CSV-Template:**
```csv
customer_name,contact_name,contact_email,stage,expected_subs_monthly,expected_pay_arr,has_terminal,lead_source,notes
"Salon Müller","Maria Müller","maria@salon-mueller.de","sql",180,0,false,"website","Interessiert an Starter-Paket"
"Hair Design","Tom Schmidt","tom@hairdesign.de","demo",220,600,true,"referral","Demo am 15.01."
```

---

### 11.2 Benachrichtigungen ✅

**Entscheidung:** Ja, implementieren

#### Neue Tabelle: `notifications`

```sql
CREATE TABLE notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  
  -- Typ & Inhalt
  type VARCHAR(50) NOT NULL,  -- 'deal_overdue', 'deal_stuck', 'forecast_warning', 'stage_change', etc.
  title VARCHAR(255) NOT NULL,
  message TEXT,
  
  -- Verknüpfung
  related_type VARCHAR(50),   -- 'pipeline_entry', 'go_live', 'challenge', etc.
  related_id UUID,
  
  -- Status
  is_read BOOLEAN DEFAULT false,
  read_at TIMESTAMPTZ,
  
  -- Priorität
  priority VARCHAR(20) DEFAULT 'normal',  -- 'low', 'normal', 'high', 'urgent'
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ  -- Optional: Auto-Löschung
);

CREATE INDEX idx_notifications_user ON notifications(user_id);
CREATE INDEX idx_notifications_unread ON notifications(user_id, is_read) WHERE is_read = false;
```

#### Neue Tabelle: `notification_settings`

```sql
CREATE TABLE notification_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) UNIQUE,
  
  -- Deal-Benachrichtigungen
  notify_deal_overdue BOOLEAN DEFAULT true,
  notify_deal_stuck BOOLEAN DEFAULT true,
  notify_deal_stuck_days INTEGER DEFAULT 7,  -- Nach X Tagen in gleicher Stage
  
  -- Forecast-Benachrichtigungen
  notify_forecast_warning BOOLEAN DEFAULT true,
  forecast_warning_threshold DECIMAL(3,2) DEFAULT 0.80,  -- Warnung wenn < 80% des Targets
  
  -- Team-Benachrichtigungen (nur Manager)
  notify_team_deals BOOLEAN DEFAULT false,
  notify_team_golives BOOLEAN DEFAULT true,
  
  -- Delivery
  in_app_enabled BOOLEAN DEFAULT true,
  email_enabled BOOLEAN DEFAULT false,
  email_digest VARCHAR(20) DEFAULT 'daily',  -- 'instant', 'daily', 'weekly', 'none'
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

#### Notification Types

| Type | Trigger | Empfänger | Priorität |
|------|---------|-----------|-----------|
| `deal_overdue` | Expected Close Date überschritten | Deal Owner | High |
| `deal_stuck` | Deal > X Tage in gleicher Stage | Deal Owner + Manager | Normal |
| `forecast_warning` | Forecast < X% des Targets | AE + Manager | High |
| `forecast_critical` | Forecast < 50% des Targets | AE + Manager | Urgent |
| `stage_changed` | Deal Stage wurde geändert | Manager (bei Team-Deals) | Low |
| `deal_won` | Deal wurde Go-Live | Team | Normal |
| `deal_lost` | Deal wurde Lost | Manager | Normal |

#### UI: Notification Bell

```
┌─────────────────────────────────────────────────────────────────────────┐
│ Dashboard    │    ...    │    🔔³    │  Lisa Schmidt                    │
├─────────────────────────────────────────────────────────────────────────┤
                              │
                              ▼
                 ┌────────────────────────────────┐
                 │ Benachrichtigungen         [⚙️] │
                 ├────────────────────────────────┤
                 │ 🔴 Salon Müller überfällig     │
                 │    Expected: 10.01. (vor 2 T.) │
                 │    vor 2 Stunden               │
                 ├────────────────────────────────┤
                 │ 🟡 Hair Design steckt fest     │
                 │    8 Tage in "Demo"            │
                 │    vor 1 Tag                   │
                 ├────────────────────────────────┤
                 │ 🟢 Beauty Box → Go-Live! 🎉    │
                 │    3.200€ ARR gewonnen         │
                 │    vor 3 Tagen                 │
                 ├────────────────────────────────┤
                 │        [Alle als gelesen]      │
                 └────────────────────────────────┘
```

---

### 11.3 Aktivitäten-Log ✅

**Entscheidung:** Datenbank vorbereiten, UI später

#### Neue Tabelle: `pipeline_activities`

```sql
CREATE TABLE pipeline_activities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pipeline_entry_id UUID NOT NULL REFERENCES pipeline_entries(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id),  -- Wer hat die Aktivität erstellt
  
  -- Aktivitäts-Typ
  activity_type VARCHAR(50) NOT NULL,  -- 'call', 'email', 'meeting', 'note', 'task', 'stage_change'
  
  -- Inhalt
  subject VARCHAR(255),
  description TEXT,
  
  -- Timing
  activity_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  duration_minutes INTEGER,  -- Für Calls/Meetings
  
  -- Für Meetings
  meeting_type VARCHAR(50),  -- 'demo', 'followup', 'negotiation', 'onboarding'
  attendees TEXT[],  -- Liste von Teilnehmern
  
  -- Für Tasks
  is_completed BOOLEAN DEFAULT false,
  due_date DATE,
  
  -- Outcome
  outcome VARCHAR(50),  -- 'positive', 'neutral', 'negative', 'no_answer', etc.
  next_action TEXT,
  next_action_date DATE,
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_activities_pipeline ON pipeline_activities(pipeline_entry_id);
CREATE INDEX idx_activities_user ON pipeline_activities(user_id);
CREATE INDEX idx_activities_date ON pipeline_activities(activity_date);
CREATE INDEX idx_activities_type ON pipeline_activities(activity_type);
```

#### Aktivitäts-Typen

| Type | Icon | Beschreibung |
|------|------|--------------|
| `call` | 📞 | Telefonat mit Kunde |
| `email` | 📧 | E-Mail gesendet/empfangen |
| `meeting` | 📅 | Meeting (Demo, Follow-up, etc.) |
| `note` | 📝 | Interne Notiz |
| `task` | ✅ | To-Do Aufgabe |
| `stage_change` | 🔄 | Automatisch bei Stage-Wechsel |
| `linkedin` | 💼 | LinkedIn Nachricht |
| `sms` | 💬 | SMS gesendet |

#### Beispiel-Einträge

```json
[
  {
    "activity_type": "call",
    "subject": "Erstgespräch",
    "description": "Interesse an Premium-Paket. Termin für Demo vereinbart.",
    "activity_date": "2026-01-10T14:30:00Z",
    "duration_minutes": 15,
    "outcome": "positive",
    "next_action": "Demo durchführen",
    "next_action_date": "2026-01-15"
  },
  {
    "activity_type": "meeting",
    "subject": "Produkt-Demo",
    "meeting_type": "demo",
    "description": "Demo gut verlaufen. Kunde möchte Angebot.",
    "activity_date": "2026-01-15T10:00:00Z",
    "duration_minutes": 45,
    "attendees": ["Maria Müller", "Tom (Inhaber)"],
    "outcome": "positive",
    "next_action": "Angebot senden",
    "next_action_date": "2026-01-16"
  }
]
```

---

### 11.4 CRM-Integration ✅

**Entscheidung:** Vorbereiten für Salesforce & HubSpot

#### Neue Tabelle: `crm_integrations`

```sql
CREATE TABLE crm_integrations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID,  -- Für Multi-Tenant (Zukunft)
  
  -- CRM System
  crm_type VARCHAR(50) NOT NULL,  -- 'salesforce', 'hubspot', 'pipedrive', etc.
  
  -- Credentials (verschlüsselt speichern!)
  credentials JSONB,  -- { "access_token": "...", "refresh_token": "...", "instance_url": "..." }
  
  -- Sync Settings
  sync_enabled BOOLEAN DEFAULT false,
  sync_direction VARCHAR(20) DEFAULT 'both',  -- 'import', 'export', 'both'
  sync_frequency VARCHAR(20) DEFAULT 'hourly',  -- 'realtime', 'hourly', 'daily', 'manual'
  last_sync_at TIMESTAMPTZ,
  last_sync_status VARCHAR(50),
  last_sync_error TEXT,
  
  -- Field Mapping
  field_mapping JSONB,  -- { "crm_field": "pipeline_field", ... }
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

#### Neue Tabelle: `crm_sync_log`

```sql
CREATE TABLE crm_sync_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  integration_id UUID NOT NULL REFERENCES crm_integrations(id),
  
  -- Sync Details
  sync_type VARCHAR(20) NOT NULL,  -- 'full', 'incremental', 'single'
  direction VARCHAR(20) NOT NULL,  -- 'import', 'export'
  
  -- Results
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  status VARCHAR(50) NOT NULL DEFAULT 'running',  -- 'running', 'success', 'partial', 'failed'
  
  -- Stats
  records_processed INTEGER DEFAULT 0,
  records_created INTEGER DEFAULT 0,
  records_updated INTEGER DEFAULT 0,
  records_failed INTEGER DEFAULT 0,
  
  -- Errors
  errors JSONB,  -- [{ "record_id": "...", "error": "..." }, ...]
  
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_sync_log_integration ON crm_sync_log(integration_id);
```

#### Neue Tabelle: `crm_id_mapping`

```sql
-- Mapping zwischen Pipeline-IDs und CRM-IDs
CREATE TABLE crm_id_mapping (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  integration_id UUID NOT NULL REFERENCES crm_integrations(id),
  
  -- Local
  local_type VARCHAR(50) NOT NULL,  -- 'pipeline_entry', 'go_live', 'user'
  local_id UUID NOT NULL,
  
  -- Remote
  remote_type VARCHAR(50) NOT NULL,  -- 'Opportunity', 'Deal', 'Contact', etc.
  remote_id VARCHAR(255) NOT NULL,
  
  -- Sync Status
  last_synced_at TIMESTAMPTZ,
  local_updated_at TIMESTAMPTZ,
  remote_updated_at TIMESTAMPTZ,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(integration_id, local_type, local_id),
  UNIQUE(integration_id, remote_type, remote_id)
);

CREATE INDEX idx_crm_mapping_local ON crm_id_mapping(local_type, local_id);
CREATE INDEX idx_crm_mapping_remote ON crm_id_mapping(remote_type, remote_id);
```

#### Salesforce Field Mapping (Default)

```json
{
  "salesforce_to_local": {
    "Account": {
      "Name": "leads.company_name",
      "NumberOfEmployees": "leads.employee_count",
      "Description": "leads.notes"
    },
    "Opportunity": {
      "Name": "opportunities.name",
      "StageName": "opportunities.stage",
      "Amount": "opportunities.expected_subs_monthly",
      "CloseDate": "opportunities.expected_close_date",
      "Probability": "opportunities.probability",
      "Description": "opportunities.notes"
    }
  },
  "stage_mapping": {
    "salesforce_to_local": {
      "Qualification": "sql",
      "Demo Booked": "demo_booked",
      "Demo Completed": "demo_completed",
      "Sent Quote": "sent_quote",
      "Closed Won": "close_won",
      "Closed Lost": "close_lost"
    },
    "local_to_salesforce": {
      "sql": "Qualification",
      "demo_booked": "Demo Booked",
      "demo_completed": "Demo Completed",
      "sent_quote": "Sent Quote",
      "close_won": "Closed Won",
      "close_lost": "Closed Lost"
    }
  },
  "lead_source_mapping": {
    "Web": "inbound",
    "Phone Inquiry": "outbound",
    "Partner Referral": "partnership",
    "Other": "inbound"
  }
}
```

#### HubSpot Field Mapping (Default)

```json
{
  "hubspot_to_local": {
    "Company": {
      "name": "leads.company_name",
      "numberofemployees": "leads.employee_count",
      "description": "leads.notes"
    },
    "Deal": {
      "dealname": "opportunities.name",
      "dealstage": "opportunities.stage",
      "amount": "opportunities.expected_subs_monthly",
      "closedate": "opportunities.expected_close_date",
      "hs_deal_stage_probability": "opportunities.probability"
    }
  },
  "stage_mapping": {
    "hubspot_to_local": {
      "qualifiedtobuy": "sql",
      "presentationscheduled": "demo_booked",
      "decisionmakerboughtin": "demo_completed",
      "contractsent": "sent_quote",
      "closedwon": "close_won",
      "closedlost": "close_lost"
    }
  }
}
```

#### UI: Integration Settings (Admin)

```
┌─────────────────────────────────────────────────────────────────────────┐
│ ⚙️ Einstellungen  │  🔗 Integrationen                                   │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  CRM-Integrationen                                                      │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                                                                 │   │
│  │  ☁️ Salesforce                              [Verbinden]         │   │
│  │     Synchronisiere Opportunities mit Pipeline                   │   │
│  │                                                                 │   │
│  │  🟠 HubSpot                                 [Verbinden]         │   │
│  │     Synchronisiere Deals mit Pipeline                           │   │
│  │                                                                 │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│  Nach Verbindung verfügbar:                                             │
│  • Automatischer Import von Deals                                       │
│  • Sync von Stage-Änderungen                                            │
│  • Bidirektionale Aktualisierung                                        │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

### 11.5 Multi-Year Forecasting ✅

**Entscheidung:** Ja, implementieren

#### Erweitertes Forecast-Modell

```typescript
interface MultiYearForecast {
  // Aktuelles Jahr
  current_year: {
    year: number;
    remaining_months: ForecastPeriod[];
    total_forecast: number;
    total_target: number;
    achievement_forecast: number;
  };
  
  // Nächstes Jahr
  next_year: {
    year: number;
    quarters: ForecastPeriod[];
    total_forecast: number;
    // Target noch nicht definiert? → Schätzung basierend auf Growth
    estimated_target: number;
    growth_assumption: number;  // z.B. 1.2 = 20% Wachstum
  };
}

interface ForecastPeriod {
  period: string;  // 'Jan 2026', 'Q1 2027', etc.
  start_date: Date;
  end_date: Date;
  
  // Deals in diesem Zeitraum
  deals_count: number;
  weighted_value: number;
  best_case: number;
  worst_case: number;
  
  // Target (wenn vorhanden)
  target?: number;
  achievement?: number;
}
```

#### UI: Multi-Year Ansicht

```
┌─────────────────────────────────────────────────────────────────────────┐
│ 📊 Forecast                    [2026 ▼]  [Alle AEs ▼]                   │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌─── 2026 (Aktuelles Jahr) ──────────────────────────────────────────┐ │
│  │                                                                     │ │
│  │   Jan    Feb    Mar    Apr    Mai    Jun    Jul    Aug    Sep  ...  │ │
│  │  ┌────┐ ┌────┐ ┌────┐ ┌────┐ ┌────┐ ┌────┐ ┌────┐ ┌────┐ ┌────┐    │ │
│  │  │ 52k│ │ 48k│ │ 55k│ │ 42k│ │ 38k│ │ 35k│ │ 28k│ │ 22k│ │ 18k│    │ │
│  │  │115%│ │102%│ │110%│ │ 95%│ │ 85%│ │ 78%│ │ 65%│ │ 52%│ │ 42%│    │ │
│  │  └────┘ └────┘ └────┘ └────┘ └────┘ └────┘ └────┘ └────┘ └────┘    │ │
│  │  ██████ ██████ ██████ █████▒ ████▒▒ ███▒▒▒ ██▒▒▒▒ █▒▒▒▒▒ █▒▒▒▒▒    │ │
│  │   🟢     🟢     🟢     🟡     🟡     🟠     🔴     🔴     🔴       │ │
│  │                                                                     │ │
│  │  Jahres-Forecast: 412.000€ (89% von 465.000€ Target)               │ │
│  │  ⚠️ Handlungsbedarf: Pipeline für H2 aufbauen!                      │ │
│  └─────────────────────────────────────────────────────────────────────┘ │
│                                                                         │
│  ┌─── 2027 (Vorschau) ────────────────────────────────────────────────┐ │
│  │                                                                     │ │
│  │   Q1 2027       Q2 2027       Q3 2027       Q4 2027                 │ │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐            │ │
│  │  │   85k    │  │   42k    │  │   15k    │  │    5k    │            │ │
│  │  │ 12 Deals │  │  6 Deals │  │  2 Deals │  │  1 Deal  │            │ │
│  │  └──────────┘  └──────────┘  └──────────┘  └──────────┘            │ │
│  │                                                                     │ │
│  │  Vorläufiger Forecast 2027: 147.000€                               │ │
│  │  (basierend auf aktueller Pipeline mit Close Date in 2027)         │ │
│  │                                                                     │ │
│  │  💡 Geschätztes Target 2027: 558.000€ (+20% vs. 2026)              │ │
│  │     → Aktuelle Pipeline deckt 26% des geschätzten Targets          │ │
│  └─────────────────────────────────────────────────────────────────────┘ │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

#### Pipeline-Eintrag mit Next-Year Close Date

```
┌─────────────────────────────────────────────────────────────────────────┐
│ Pipeline-Eintrag bearbeiten                                      [✕]   │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ...                                                                    │
│                                                                         │
│  Erwartetes Close-Datum                                                 │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                                                                 │   │
│  │  [ 15.03.2027            📅]                                   │   │
│  │                                                                 │   │
│  │  ℹ️ Dieser Deal wird im Forecast 2027 berücksichtigt            │   │
│  │                                                                 │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 12. Risiken & Mitigationen

| Risiko | Wahrscheinlichkeit | Impact | Mitigation |
|--------|-------------------|--------|------------|
| Doppelte Datenpflege (Pipeline + CRM) | Hoch | Mittel | CSV-Import, später API-Integration |
| Forecasts zu ungenau | Mittel | Hoch | Lernende Cycle Times, historische Daten |
| Komplexität überfordert User | Mittel | Hoch | Gute Defaults, progressive Disclosure |
| Performance bei vielen Einträgen | Niedrig | Mittel | Indizierung, Pagination |

---

## Anhang A: Glossar

| Begriff | Definition |
|---------|------------|
| **SQL** | Sales Qualified Lead - Ein Lead der die Qualifizierungskriterien erfüllt |
| **Demo** | Produktvorführung beim potenziellen Kunden |
| **Sign-up** | Der Kunde hat den Sign-up Link erhalten und ist im Onboarding |
| **Go-Live** | Der Kunde ist live und nutzt das Produkt aktiv |
| **Weighted Pipeline** | Summe aller erwarteten ARR × Probability |
| **Sales Cycle Length** | Zeit von SQL bis Go-Live |
| **Conversion Rate** | Prozentsatz der Deals die von einer Stage zur nächsten kommen |

---

## Anhang B: Beispiel-Daten

### Beispiel Pipeline-Einträge

```json
[
  {
    "customer_name": "Salon Elegance",
    "stage": "demo",
    "expected_subs_arr": 2400,
    "expected_pay_arr": 600,
    "probability": 0.50,
    "sql_date": "2025-12-28",
    "demo_date": "2026-01-10",
    "expected_close_date": "2026-01-25",
    "lead_source": "website"
  },
  {
    "customer_name": "Hair & Beauty Studio",
    "stage": "signup",
    "expected_subs_arr": 3200,
    "expected_pay_arr": 800,
    "probability": 0.90,
    "sql_date": "2025-12-15",
    "demo_date": "2025-12-22",
    "signup_date": "2026-01-08",
    "expected_close_date": "2026-01-13",
    "lead_source": "referral"
  }
]
```

---

**Ende des Konzept-Papers**

*Erstellt für: AE Kompensation App*  
*Version: 1.0*  
*Nächster Schritt: Review und Feedback*
