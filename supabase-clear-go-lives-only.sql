-- ============================================================================
-- GO_LIVES CLEANUP (SAFE)
-- Ziel:
--   1) Alle aktuellen go_lives sichern (Backup-Tabelle)
--   2) FK-Verknuepfungen aus opportunities.go_live_id loesen
--   3) Nur go_lives leeren
--
-- Hinweis:
--   Andere Tabellen/Daten bleiben erhalten.
-- ============================================================================

BEGIN;

-- 1) Backup-Tabelle anlegen (falls nicht vorhanden)
--    Ohne Constraints, damit mehrere Backup-Laeufe moeglich sind.
CREATE TABLE IF NOT EXISTS go_lives_backup AS
SELECT
  g.*,
  NULL::uuid AS backup_batch_id,
  NULL::timestamptz AS backed_up_at
FROM go_lives g
WHERE FALSE;

-- 2) Technische Meta-Spalten nachziehen (falls Tabelle schon existierte)
ALTER TABLE go_lives_backup
  ADD COLUMN IF NOT EXISTS backup_batch_id uuid;

ALTER TABLE go_lives_backup
  ADD COLUMN IF NOT EXISTS backed_up_at timestamptz;

-- 3) Aktuelle go_lives in Backup schreiben
WITH meta AS (
  SELECT gen_random_uuid() AS batch_id, NOW() AS ts
)
INSERT INTO go_lives_backup
SELECT
  g.*,
  meta.batch_id,
  meta.ts
FROM go_lives g
CROSS JOIN meta;

-- 4) FK-Referenzen auf go_lives entfernen (Pipeline / Opportunities)
UPDATE opportunities
SET go_live_id = NULL
WHERE go_live_id IS NOT NULL;

-- 5) Nur go_lives loeschen
DELETE FROM go_lives;

COMMIT;

-- Optionaler Check nach Ausfuehrung:
-- SELECT COUNT(*) AS go_lives_count_after FROM go_lives;
-- SELECT COUNT(*) AS backup_count FROM go_lives_backup;
