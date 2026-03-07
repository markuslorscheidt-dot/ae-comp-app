-- ============================================================================
-- GO_LIVES: OAK-ID Upsert Constraint + Duplikat-Bereinigung
-- Datum: 07. Maerz 2026
-- ============================================================================
--
-- Ziel:
-- 1) Bestehende Dubletten je oak_id bereinigen (neuester Datensatz bleibt)
-- 2) Eindeutigkeit fuer oak_id erzwingen (nur nicht-NULL)
-- 3) Voraussetzung fuer ON CONFLICT (oak_id) Upsert schaffen
-- ============================================================================

BEGIN;

-- Optionales Backup fuer entfernte Dubletten
CREATE TABLE IF NOT EXISTS go_lives_duplicate_backup AS
SELECT
  g.*,
  NULL::timestamptz AS backed_up_at
FROM go_lives g
WHERE FALSE;

ALTER TABLE go_lives_duplicate_backup
  ADD COLUMN IF NOT EXISTS backed_up_at timestamptz;

WITH ranked AS (
  SELECT
    id,
    oak_id,
    ROW_NUMBER() OVER (
      PARTITION BY oak_id
      ORDER BY created_at DESC NULLS LAST, id DESC
    ) AS rn
  FROM go_lives
  WHERE oak_id IS NOT NULL
),
dupes AS (
  SELECT id
  FROM ranked
  WHERE rn > 1
)
INSERT INTO go_lives_duplicate_backup
SELECT
  g.*,
  NOW()
FROM go_lives g
JOIN dupes d ON d.id = g.id;

WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY oak_id
      ORDER BY created_at DESC NULLS LAST, id DESC
    ) AS rn
  FROM go_lives
  WHERE oak_id IS NOT NULL
)
DELETE FROM go_lives g
USING ranked r
WHERE g.id = r.id
  AND r.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS idx_go_lives_oak_id_unique
  ON go_lives(oak_id)
  WHERE oak_id IS NOT NULL;

COMMIT;

