-- ============================================================================
-- SALES PIPELINE TABLES
-- Version: 1.0
-- Datum: 12. Januar 2026
-- ============================================================================

-- 1. COMPETITORS (Wettbewerber - konfigurierbar)
-- ============================================================================
CREATE TABLE IF NOT EXISTS competitors (
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
  ('Sonstige', 100)
ON CONFLICT (name) DO NOTHING;

-- 2. LOST REASONS (Verlustgründe - konfigurierbar)
-- ============================================================================
CREATE TABLE IF NOT EXISTS lost_reasons (
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
  ('Sonstige', 'general', 99)
ON CONFLICT (reason) DO NOTHING;

-- 3. LEADS (Unternehmen/Accounts)
-- ============================================================================
CREATE TABLE IF NOT EXISTS leads (
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
  lead_source VARCHAR(50) NOT NULL DEFAULT 'inbound',  -- 'inbound', 'outbound', 'partnership', 'enterprise'
  
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

-- Indizes für Leads
CREATE INDEX IF NOT EXISTS idx_leads_user ON leads(user_id);
CREATE INDEX IF NOT EXISTS idx_leads_source ON leads(lead_source);
CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status);
CREATE INDEX IF NOT EXISTS idx_leads_external ON leads(imported_from, external_id);

-- 4. OPPORTUNITIES (Deals/Filialen)
-- ============================================================================
CREATE TABLE IF NOT EXISTS opportunities (
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
  
  -- Werte (monatlich eingeben)
  expected_subs_monthly DECIMAL(10,2) NOT NULL DEFAULT 0,
  expected_pay_monthly DECIMAL(10,2) DEFAULT 0,
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

-- Indizes für Opportunities
CREATE INDEX IF NOT EXISTS idx_opportunities_lead ON opportunities(lead_id);
CREATE INDEX IF NOT EXISTS idx_opportunities_user ON opportunities(user_id);
CREATE INDEX IF NOT EXISTS idx_opportunities_stage ON opportunities(stage);
CREATE INDEX IF NOT EXISTS idx_opportunities_expected_close ON opportunities(expected_close_date);
CREATE INDEX IF NOT EXISTS idx_opportunities_external ON opportunities(imported_from, external_id);

-- 5. OPPORTUNITY STAGE HISTORY
-- ============================================================================
CREATE TABLE IF NOT EXISTS opportunity_stage_history (
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

CREATE INDEX IF NOT EXISTS idx_opp_history_opportunity ON opportunity_stage_history(opportunity_id);
CREATE INDEX IF NOT EXISTS idx_opp_history_date ON opportunity_stage_history(changed_at);

-- 6. PIPELINE SETTINGS
-- ============================================================================
CREATE TABLE IF NOT EXISTS pipeline_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) UNIQUE,  -- NULL = globale Defaults
  
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
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Globale Defaults einfügen
INSERT INTO pipeline_settings (user_id) VALUES (NULL)
ON CONFLICT DO NOTHING;

-- 7. PIPELINE ACTIVITIES (DB-Vorbereitung, UI später)
-- ============================================================================
CREATE TABLE IF NOT EXISTS pipeline_activities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  opportunity_id UUID REFERENCES opportunities(id) ON DELETE CASCADE,
  lead_id UUID REFERENCES leads(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id),
  
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
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Mindestens eine Verknüpfung erforderlich
  CONSTRAINT activity_has_reference CHECK (
    opportunity_id IS NOT NULL OR lead_id IS NOT NULL
  )
);

CREATE INDEX IF NOT EXISTS idx_activities_opportunity ON pipeline_activities(opportunity_id);
CREATE INDEX IF NOT EXISTS idx_activities_lead ON pipeline_activities(lead_id);
CREATE INDEX IF NOT EXISTS idx_activities_date ON pipeline_activities(activity_date);

-- 8. NOTIFICATIONS
-- ============================================================================
CREATE TABLE IF NOT EXISTS notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  
  -- Typ & Inhalt
  type VARCHAR(50) NOT NULL,  -- 'deal_overdue', 'deal_stuck', 'forecast_warning', etc.
  title VARCHAR(255) NOT NULL,
  message TEXT,
  
  -- Verknüpfung
  related_type VARCHAR(50),   -- 'opportunity', 'lead', 'go_live', 'challenge'
  related_id UUID,
  
  -- Status
  is_read BOOLEAN DEFAULT false,
  read_at TIMESTAMPTZ,
  priority VARCHAR(20) DEFAULT 'normal',  -- 'low', 'normal', 'high', 'urgent'
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_unread ON notifications(user_id, is_read) WHERE is_read = false;

-- 9. NOTIFICATION SETTINGS
-- ============================================================================
CREATE TABLE IF NOT EXISTS notification_settings (
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

-- 10. GO_LIVES ERWEITERUNG
-- ============================================================================
-- Füge Spalten für Lead/Opportunity-Verknüpfung hinzu
ALTER TABLE go_lives 
ADD COLUMN IF NOT EXISTS lead_id UUID REFERENCES leads(id),
ADD COLUMN IF NOT EXISTS opportunity_id UUID REFERENCES opportunities(id);

CREATE INDEX IF NOT EXISTS idx_golives_lead ON go_lives(lead_id);
CREATE INDEX IF NOT EXISTS idx_golives_opportunity ON go_lives(opportunity_id);

-- ============================================================================
-- ROW LEVEL SECURITY (RLS)
-- ============================================================================

-- Competitors: Alle können lesen, nur Admins können schreiben
ALTER TABLE competitors ENABLE ROW LEVEL SECURITY;

CREATE POLICY "competitors_read_all" ON competitors
  FOR SELECT USING (true);

CREATE POLICY "competitors_write_admin" ON competitors
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM users 
      WHERE users.id = auth.uid() 
      AND users.role IN ('country_manager', 'line_manager')
    )
  );

-- Lost Reasons: Alle können lesen, nur Admins können schreiben
ALTER TABLE lost_reasons ENABLE ROW LEVEL SECURITY;

CREATE POLICY "lost_reasons_read_all" ON lost_reasons
  FOR SELECT USING (true);

CREATE POLICY "lost_reasons_write_admin" ON lost_reasons
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM users 
      WHERE users.id = auth.uid() 
      AND users.role IN ('country_manager', 'line_manager')
    )
  );

-- Leads: AE sieht eigene, Manager sieht alle
ALTER TABLE leads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "leads_own" ON leads
  FOR ALL USING (
    user_id = auth.uid() OR
    EXISTS (
      SELECT 1 FROM users 
      WHERE users.id = auth.uid() 
      AND users.role IN ('country_manager', 'line_manager')
    )
  );

-- Opportunities: AE sieht eigene, Manager sieht alle
ALTER TABLE opportunities ENABLE ROW LEVEL SECURITY;

CREATE POLICY "opportunities_own" ON opportunities
  FOR ALL USING (
    user_id = auth.uid() OR
    EXISTS (
      SELECT 1 FROM users 
      WHERE users.id = auth.uid() 
      AND users.role IN ('country_manager', 'line_manager')
    )
  );

-- Opportunity Stage History: Gleiche Regeln wie Opportunities
ALTER TABLE opportunity_stage_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "opp_history_access" ON opportunity_stage_history
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM opportunities o
      WHERE o.id = opportunity_stage_history.opportunity_id
      AND (
        o.user_id = auth.uid() OR
        EXISTS (
          SELECT 1 FROM users 
          WHERE users.id = auth.uid() 
          AND users.role IN ('country_manager', 'line_manager')
        )
      )
    )
  );

-- Pipeline Settings: Jeder kann eigene lesen/schreiben, globale nur lesen
ALTER TABLE pipeline_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "pipeline_settings_own" ON pipeline_settings
  FOR ALL USING (
    user_id = auth.uid() OR 
    user_id IS NULL OR
    EXISTS (
      SELECT 1 FROM users 
      WHERE users.id = auth.uid() 
      AND users.role IN ('country_manager', 'line_manager')
    )
  );

-- Pipeline Activities: Gleiche Regeln wie Opportunities
ALTER TABLE pipeline_activities ENABLE ROW LEVEL SECURITY;

CREATE POLICY "activities_access" ON pipeline_activities
  FOR ALL USING (
    user_id = auth.uid() OR
    EXISTS (
      SELECT 1 FROM users 
      WHERE users.id = auth.uid() 
      AND users.role IN ('country_manager', 'line_manager')
    )
  );

-- Notifications: Nur eigene
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "notifications_own" ON notifications
  FOR ALL USING (user_id = auth.uid());

-- Notification Settings: Nur eigene
ALTER TABLE notification_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "notification_settings_own" ON notification_settings
  FOR ALL USING (user_id = auth.uid());

-- ============================================================================
-- FERTIG
-- ============================================================================
