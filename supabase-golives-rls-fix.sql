-- RLS Policy Fix für go_lives INSERT
-- Problem: Manager können keine Go-Lives für andere User anlegen

-- Alte INSERT Policy löschen (falls vorhanden)
DROP POLICY IF EXISTS "Users can insert own go_lives" ON go_lives;
DROP POLICY IF EXISTS "Users can insert go_lives" ON go_lives;
DROP POLICY IF EXISTS "Authenticated users can insert go_lives" ON go_lives;

-- Neue Policy: Alle authentifizierten User können Go-Lives anlegen
CREATE POLICY "Authenticated users can insert go_lives" ON go_lives
  FOR INSERT
  WITH CHECK (auth.role() = 'authenticated');

-- Zur Sicherheit auch SELECT Policy prüfen
DROP POLICY IF EXISTS "Users can view own go_lives" ON go_lives;
DROP POLICY IF EXISTS "Authenticated users can view all go_lives" ON go_lives;

CREATE POLICY "Authenticated users can view all go_lives" ON go_lives
  FOR SELECT
  USING (auth.role() = 'authenticated');

-- Zusammenfassung der go_lives RLS Policies:
-- SELECT: Alle authentifizierten User können alle Go-Lives sehen
-- INSERT: Alle authentifizierten User können Go-Lives anlegen
-- UPDATE: Alle authentifizierten User können alle Go-Lives updaten
-- DELETE: Alle authentifizierten User können alle Go-Lives löschen
