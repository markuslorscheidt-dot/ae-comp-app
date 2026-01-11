-- ============================================
-- CHALLENGES TABELLE
-- ============================================

-- Challenges Tabelle erstellen
CREATE TABLE IF NOT EXISTS challenges (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  
  -- Basis-Infos
  name VARCHAR(100) NOT NULL,
  description TEXT,
  icon VARCHAR(10) DEFAULT '🎯',
  
  -- Typ: team (alle AEs zusammen) oder individual (jeder AE für sich)
  type VARCHAR(20) NOT NULL DEFAULT 'team' CHECK (type IN ('team', 'individual')),
  
  -- Metrik die gemessen wird
  metric VARCHAR(30) NOT NULL DEFAULT 'go_lives' CHECK (metric IN (
    'go_lives',           -- Anzahl Go-Lives
    'subs_arr',           -- Subs ARR in €
    'pay_arr',            -- Pay ARR in €
    'total_arr',          -- Subs + Pay ARR
    'terminals',          -- Anzahl Terminals
    'achievement',        -- Zielerreichung in %
    'premium_go_lives'    -- Go-Lives mit >200€/Monat
  )),
  
  -- Zielwert
  target_value NUMERIC NOT NULL,
  
  -- Zeitraum
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  
  -- Belohnung
  reward_type VARCHAR(20) DEFAULT 'badge' CHECK (reward_type IN ('badge', 'points', 'custom')),
  reward_value VARCHAR(100), -- Badge-ID oder Punkte-Anzahl oder Custom-Text
  
  -- Status
  is_active BOOLEAN DEFAULT true,
  
  -- Audit
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index für aktive Challenges
CREATE INDEX IF NOT EXISTS idx_challenges_active ON challenges(is_active, start_date, end_date);

-- RLS aktivieren
ALTER TABLE challenges ENABLE ROW LEVEL SECURITY;

-- Policies
DROP POLICY IF EXISTS "Enable read for authenticated users" ON challenges;
CREATE POLICY "Enable read for authenticated users" ON challenges
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "Enable insert for authenticated users" ON challenges;
CREATE POLICY "Enable insert for authenticated users" ON challenges
  FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "Enable update for authenticated users" ON challenges;
CREATE POLICY "Enable update for authenticated users" ON challenges
  FOR UPDATE USING (true);

DROP POLICY IF EXISTS "Enable delete for authenticated users" ON challenges;
CREATE POLICY "Enable delete for authenticated users" ON challenges
  FOR DELETE USING (true);

-- ============================================
-- BEISPIEL-CHALLENGES EINFÜGEN
-- ============================================

INSERT INTO challenges (name, description, icon, type, metric, target_value, start_date, end_date, reward_type, reward_value)
VALUES 
  (
    'Team Goal',
    'Alle AEs erreichen gemeinsam 80% Zielerreichung diesen Monat',
    '🎯',
    'team',
    'achievement',
    80,
    DATE_TRUNC('month', CURRENT_DATE),
    (DATE_TRUNC('month', CURRENT_DATE) + INTERVAL '1 month - 1 day')::DATE,
    'badge',
    'team_player'
  ),
  (
    'Sprint Week',
    '25 Go-Lives diese Woche als Team',
    '🏃',
    'team',
    'go_lives',
    25,
    DATE_TRUNC('week', CURRENT_DATE),
    (DATE_TRUNC('week', CURRENT_DATE) + INTERVAL '6 days')::DATE,
    'points',
    '500'
  ),
  (
    'Premium Push',
    '10x Go-Lives mit >€200/M Subs',
    '💎',
    'individual',
    'premium_go_lives',
    10,
    DATE_TRUNC('month', CURRENT_DATE),
    (DATE_TRUNC('month', CURRENT_DATE) + INTERVAL '1 month - 1 day')::DATE,
    'badge',
    'premium_hunter'
  )
ON CONFLICT DO NOTHING;
