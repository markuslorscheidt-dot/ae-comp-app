-- Migration: DLT Planzahlen Tabelle
-- Diese Tabelle speichert die zentralen Planzahlen für das DLT (Digital Leadership Team)
-- Erstellt: 2026-02-09

-- Tabelle erstellen
CREATE TABLE IF NOT EXISTS dlt_planzahlen (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  year INTEGER NOT NULL,
  region VARCHAR(50) DEFAULT 'DACH',
  
  -- 1. NEW ARR - Business Targets
  business_inbound INTEGER[] DEFAULT ARRAY[25, 25, 25, 30, 30, 20, 18, 15, 33, 34, 30, 15],
  business_outbound INTEGER[] DEFAULT ARRAY[0, 4, 4, 4, 4, 2, 2, 2, 4, 4, 4, 1],
  business_partnerships INTEGER[] DEFAULT ARRAY[0, 1, 3, 10, 10, 10, 11, 11, 11, 10, 11, 2],
  business_pay_terminals INTEGER[] DEFAULT ARRAY[]::INTEGER[],
  business_terminal_sales INTEGER[] DEFAULT ARRAY[]::INTEGER[],
  business_tipping INTEGER[] DEFAULT ARRAY[]::INTEGER[],
  
  -- Prozentsätze
  pay_terminals_percent INTEGER DEFAULT 75,
  terminal_penetration_threshold INTEGER DEFAULT 75,
  terminal_sales_percent INTEGER DEFAULT 75,
  tipping_percent INTEGER DEFAULT 24,
  
  -- Umsatz-Berechnung
  avg_subs_bill INTEGER DEFAULT 159,
  avg_pay_bill_terminal INTEGER DEFAULT 129,
  avg_pay_bill_tipping INTEGER DEFAULT 30,
  
  -- 2. EXPANDING ARR (JSON für flexible Struktur)
  expanding_arr_data JSONB DEFAULT '{}'::JSONB,
  
  -- 3. CHURN ARR
  churn_arr_data JSONB DEFAULT '{}'::JSONB,
  
  -- 4. New clients
  new_clients_data JSONB DEFAULT '{}'::JSONB,
  
  -- 5. Churned clients
  churned_clients_data JSONB DEFAULT '{}'::JSONB,
  
  -- 6. Ending clients
  ending_clients_data JSONB DEFAULT '{}'::JSONB,
  
  -- Meta
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Unique constraint: nur ein Eintrag pro Jahr
  UNIQUE(year)
);

-- Index für schnelle Jahr-Abfragen
CREATE INDEX IF NOT EXISTS idx_dlt_planzahlen_year ON dlt_planzahlen(year);

-- Row Level Security aktivieren
ALTER TABLE dlt_planzahlen ENABLE ROW LEVEL SECURITY;

-- Policy: Alle authentifizierten Benutzer können lesen
CREATE POLICY "Allow read access for authenticated users" ON dlt_planzahlen
  FOR SELECT
  TO authenticated
  USING (true);

-- Policy: Nur DLT-Mitglieder und Country Manager können schreiben
CREATE POLICY "Allow write access for DLT members" ON dlt_planzahlen
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- Kommentar zur Tabelle
COMMENT ON TABLE dlt_planzahlen IS 'Zentrale Planzahlen für das DLT (Digital Leadership Team) - enthält Business Targets, ARR-Berechnungen und Kundenkennzahlen';
