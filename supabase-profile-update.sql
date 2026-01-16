-- =============================================
-- PROFIL-ERWEITERUNG FÜR USERS
-- Version 3.0 - Stammdaten für AEs und SDRs
-- =============================================

-- Erweitere users Tabelle um Profil-Felder
ALTER TABLE users ADD COLUMN IF NOT EXISTS employee_id TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS region TEXT DEFAULT 'DACH';
ALTER TABLE users ADD COLUMN IF NOT EXISTS start_date DATE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS manager_id UUID REFERENCES users(id);
ALTER TABLE users ADD COLUMN IF NOT EXISTS photo_url TEXT;

-- Index für Manager-Abfragen
CREATE INDEX IF NOT EXISTS idx_users_manager_id ON users(manager_id);

-- Index für Region-Abfragen
CREATE INDEX IF NOT EXISTS idx_users_region ON users(region);

-- Kommentare für Dokumentation
COMMENT ON COLUMN users.employee_id IS 'Interne Mitarbeiter-Nummer';
COMMENT ON COLUMN users.phone IS 'Telefonnummer des Mitarbeiters';
COMMENT ON COLUMN users.region IS 'Arbeitsregion (DACH, Deutschland, Österreich, Schweiz, etc.)';
COMMENT ON COLUMN users.start_date IS 'Datum des Arbeitsbeginns';
COMMENT ON COLUMN users.manager_id IS 'ID des direkten Vorgesetzten';
COMMENT ON COLUMN users.photo_url IS 'URL zum Profilbild';

-- =============================================
-- BEISPIEL-UPDATE FÜR EXISTIERENDE USER
-- (Optional - nur als Referenz)
-- =============================================

-- UPDATE users SET 
--   employee_id = 'AE-001',
--   region = 'DACH',
--   start_date = '2025-01-01'
-- WHERE email = 'user@example.com';
