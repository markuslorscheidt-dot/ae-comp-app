-- ============================================================================
-- LOCAL BOOTSTRAP SCHEMA
-- Zweck:
--   Stellt minimale Basistabellen/Funktionen bereit, damit historische
--   supabase-*.sql Updates auf einer leeren lokalen DB ausgefuehrt werden koennen.
-- ============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE,
  name TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL DEFAULT 'ae',
  start_date DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  is_active BOOLEAN DEFAULT true
);

CREATE TABLE IF NOT EXISTS profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT UNIQUE,
  name TEXT,
  role TEXT DEFAULT 'ae',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ae_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  year INTEGER NOT NULL DEFAULT 2026,
  region TEXT DEFAULT 'DACH',
  ote NUMERIC DEFAULT 0,
  terminal_base NUMERIC DEFAULT 0,
  terminal_bonus NUMERIC DEFAULT 0,
  terminal_penetration_threshold NUMERIC DEFAULT 0.7,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, year)
);

CREATE TABLE IF NOT EXISTS go_lives (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  customer_name TEXT,
  go_live_date DATE DEFAULT CURRENT_DATE,
  year INTEGER,
  month INTEGER,
  subs_monthly NUMERIC DEFAULT 0,
  subs_arr NUMERIC DEFAULT 0,
  has_terminal BOOLEAN DEFAULT false,
  pay_arr NUMERIC,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS trg_users_set_updated_at ON users;
CREATE TRIGGER trg_users_set_updated_at
BEFORE UPDATE ON users
FOR EACH ROW
EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS trg_profiles_set_updated_at ON profiles;
CREATE TRIGGER trg_profiles_set_updated_at
BEFORE UPDATE ON profiles
FOR EACH ROW
EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS trg_ae_settings_set_updated_at ON ae_settings;
CREATE TRIGGER trg_ae_settings_set_updated_at
BEFORE UPDATE ON ae_settings
FOR EACH ROW
EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS trg_go_lives_set_updated_at ON go_lives;
CREATE TRIGGER trg_go_lives_set_updated_at
BEFORE UPDATE ON go_lives
FOR EACH ROW
EXECUTE FUNCTION update_updated_at();

COMMIT;
