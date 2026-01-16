-- ============================================================================
-- SALESFORCE IMPORT STAGING TABLES
-- Version: 1.0
-- Datum: 12. Januar 2026
-- ============================================================================

-- 1. IMPORT BATCHES (Buchungsstapel)
-- ============================================================================
CREATE TABLE IF NOT EXISTS import_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID NOT NULL REFERENCES users(id),
  
  -- Datei-Info
  source_filename VARCHAR(255) NOT NULL,
  source_type VARCHAR(50) DEFAULT 'salesforce',  -- 'salesforce', 'csv', 'api'
  
  -- Status
  status VARCHAR(20) NOT NULL DEFAULT 'open',  -- 'open', 'completed', 'discarded', 'rolled_back'
  
  -- Timestamps
  completed_at TIMESTAMPTZ,
  discarded_at TIMESTAMPTZ,
  rolled_back_at TIMESTAMPTZ,
  rolled_back_by UUID REFERENCES users(id),
  
  -- Statistiken (nach Übernahme gefüllt)
  stats_total INTEGER DEFAULT 0,
  stats_new INTEGER DEFAULT 0,
  stats_updated INTEGER DEFAULT 0,
  stats_skipped INTEGER DEFAULT 0,
  stats_conflicts INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_import_batches_status ON import_batches(status);
CREATE INDEX IF NOT EXISTS idx_import_batches_created_by ON import_batches(created_by);

-- 2. IMPORT STAGING (Einzelne Datensätze im Stapel)
-- ============================================================================
CREATE TABLE IF NOT EXISTS import_staging (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id UUID NOT NULL REFERENCES import_batches(id) ON DELETE CASCADE,
  row_number INTEGER NOT NULL,
  
  -- Rohdaten
  raw_data JSONB NOT NULL,  -- Original CSV-Zeile
  
  -- Geparste Daten
  parsed_company_name VARCHAR(255),
  parsed_opportunity_name VARCHAR(255),
  parsed_stage VARCHAR(30),
  parsed_close_date DATE,
  parsed_created_date DATE,
  parsed_owner_name VARCHAR(100),
  parsed_notes TEXT,
  parsed_rating VARCHAR(50),
  
  -- Salesforce ID (extrahiert aus Sign-Up Link)
  sfid VARCHAR(50),
  
  -- Matching-Ergebnis
  match_status VARCHAR(20) NOT NULL DEFAULT 'pending',  -- 'new', 'changed', 'unchanged', 'conflict'
  matched_lead_id UUID REFERENCES leads(id),
  matched_opportunity_id UUID REFERENCES opportunities(id),
  
  -- User-Matching
  matched_user_id UUID REFERENCES users(id),
  user_match_status VARCHAR(20) DEFAULT 'pending',  -- 'matched', 'unmatched', 'manual'
  
  -- Änderungen (falls 'changed')
  changes JSONB,  -- z.B. {"stage": {"from": "sql", "to": "demo_booked"}}
  
  -- Auswahl durch User
  is_selected BOOLEAN DEFAULT true,
  conflict_resolved BOOLEAN DEFAULT false,
  
  -- Nach Übernahme
  created_lead_id UUID REFERENCES leads(id),
  created_opportunity_id UUID REFERENCES opportunities(id),
  
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_import_staging_batch ON import_staging(batch_id);
CREATE INDEX IF NOT EXISTS idx_import_staging_status ON import_staging(match_status);
CREATE INDEX IF NOT EXISTS idx_import_staging_sfid ON import_staging(sfid);

-- 3. ERWEITERUNG: leads Tabelle
-- ============================================================================
ALTER TABLE leads 
ADD COLUMN IF NOT EXISTS import_batch_id UUID REFERENCES import_batches(id),
ADD COLUMN IF NOT EXISTS sfid VARCHAR(50);

CREATE INDEX IF NOT EXISTS idx_leads_import_batch ON leads(import_batch_id);
CREATE INDEX IF NOT EXISTS idx_leads_sfid ON leads(sfid);

-- 4. ERWEITERUNG: opportunities Tabelle
-- ============================================================================
ALTER TABLE opportunities 
ADD COLUMN IF NOT EXISTS import_batch_id UUID REFERENCES import_batches(id),
ADD COLUMN IF NOT EXISTS sfid VARCHAR(50);

CREATE INDEX IF NOT EXISTS idx_opportunities_import_batch ON opportunities(import_batch_id);
CREATE INDEX IF NOT EXISTS idx_opportunities_sfid ON opportunities(sfid);

-- ============================================================================
-- ROW LEVEL SECURITY (RLS)
-- ============================================================================

-- Import Batches: Nur CM/LM können lesen und schreiben
ALTER TABLE import_batches ENABLE ROW LEVEL SECURITY;

CREATE POLICY "import_batches_admin" ON import_batches
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM users 
      WHERE users.id = auth.uid() 
      AND users.role IN ('country_manager', 'line_manager')
    )
  );

-- Import Staging: Nur CM/LM können lesen und schreiben
ALTER TABLE import_staging ENABLE ROW LEVEL SECURITY;

CREATE POLICY "import_staging_admin" ON import_staging
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM users 
      WHERE users.id = auth.uid() 
      AND users.role IN ('country_manager', 'line_manager')
    )
  );

-- ============================================================================
-- HILFSFUNKTIONEN
-- ============================================================================

-- Funktion: Prüfen ob ein offener Batch existiert
CREATE OR REPLACE FUNCTION has_open_import_batch()
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM import_batches WHERE status = 'open'
  );
END;
$$ LANGUAGE plpgsql;

-- Funktion: Rollback eines Batches
CREATE OR REPLACE FUNCTION rollback_import_batch(
  p_batch_id UUID,
  p_user_id UUID
)
RETURNS JSONB AS $$
DECLARE
  v_batch import_batches;
  v_deleted_leads INTEGER;
  v_deleted_opps INTEGER;
  v_updated_golives INTEGER;
BEGIN
  -- Batch laden und prüfen
  SELECT * INTO v_batch FROM import_batches WHERE id = p_batch_id;
  
  IF v_batch IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Batch nicht gefunden');
  END IF;
  
  IF v_batch.status != 'completed' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Nur abgeschlossene Batches können zurückgerollt werden');
  END IF;
  
  -- Go-Lives entkoppeln (nicht löschen!)
  UPDATE go_lives 
  SET opportunity_id = NULL, lead_id = NULL
  WHERE opportunity_id IN (SELECT id FROM opportunities WHERE import_batch_id = p_batch_id)
     OR lead_id IN (SELECT id FROM leads WHERE import_batch_id = p_batch_id);
  GET DIAGNOSTICS v_updated_golives = ROW_COUNT;
  
  -- Opportunities löschen
  DELETE FROM opportunities WHERE import_batch_id = p_batch_id;
  GET DIAGNOSTICS v_deleted_opps = ROW_COUNT;
  
  -- Leads löschen
  DELETE FROM leads WHERE import_batch_id = p_batch_id;
  GET DIAGNOSTICS v_deleted_leads = ROW_COUNT;
  
  -- Batch-Status aktualisieren
  UPDATE import_batches 
  SET 
    status = 'rolled_back',
    rolled_back_at = NOW(),
    rolled_back_by = p_user_id
  WHERE id = p_batch_id;
  
  RETURN jsonb_build_object(
    'success', true,
    'deleted_leads', v_deleted_leads,
    'deleted_opportunities', v_deleted_opps,
    'updated_golives', v_updated_golives
  );
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- FERTIG
-- ============================================================================
