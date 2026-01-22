-- ============================================
-- ROLLEN-MIGRATION v4.0
-- Commercial Business Planner
-- ============================================
-- 
-- Dieses Skript migriert die alten Rollen zu den neuen Rollen.
-- 
-- ALTE ROLLEN → NEUE ROLLEN:
-- country_manager      → country_manager (bleibt gleich - Superuser)
-- line_manager         → line_manager_new_business
-- ae                   → ae_subscription_sales
-- sdr                  → cs_sdr (wird zu Customer Success SDR)
-- sonstiges            → sonstiges (bleibt gleich)
-- head_of_partnerships → head_of_partnerships (bleibt gleich)
--
-- NEUE ROLLEN (müssen manuell zugewiesen werden):
-- dlt_member, ae_payments, commercial_director,
-- head_of_expanding_revenue, cs_account_executive, cs_account_manager,
-- head_of_marketing, marketing_specialist, marketing_executive,
-- demand_generation_specialist
--
-- ============================================

-- Schritt 1: Backup der aktuellen Rollen erstellen (optional aber empfohlen)
-- SELECT id, email, name, role as old_role FROM users;

-- ============================================
-- Schritt 2: Rollen-Migration durchführen
-- ============================================

-- line_manager → line_manager_new_business
UPDATE users 
SET role = 'line_manager_new_business' 
WHERE role = 'line_manager';

-- ae → ae_subscription_sales
UPDATE users 
SET role = 'ae_subscription_sales' 
WHERE role = 'ae';

-- sdr → cs_sdr (Customer Success SDR)
UPDATE users 
SET role = 'cs_sdr' 
WHERE role = 'sdr';

-- country_manager, sonstiges, head_of_partnerships bleiben unverändert

-- ============================================
-- Schritt 3: Ergebnis prüfen
-- ============================================

-- Zeige alle User mit ihren neuen Rollen
SELECT id, email, name, role FROM users ORDER BY role, name;

-- ============================================
-- OPTIONAL: Constraint für erlaubte Rollen
-- ============================================
-- Falls du sicherstellen willst, dass nur gültige Rollen verwendet werden:

-- Erst alte Constraint entfernen (falls vorhanden)
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;

-- Neue Constraint mit allen erlaubten Rollen
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (
  role IN (
    -- Superuser
    'country_manager',
    -- DLT
    'dlt_member',
    -- New Business
    'line_manager_new_business',
    'ae_subscription_sales',
    'ae_payments',
    'commercial_director',
    'head_of_partnerships',
    -- Expanding Business
    'head_of_expanding_revenue',
    'cs_account_executive',
    'cs_account_manager',
    'cs_sdr',
    -- Marketing
    'head_of_marketing',
    'marketing_specialist',
    'marketing_executive',
    'demand_generation_specialist',
    -- Sonstige
    'sonstiges'
  )
);

-- ============================================
-- ROLLBACK (falls nötig)
-- ============================================
-- Falls etwas schief geht, kannst du diese Befehle ausführen:
--
-- UPDATE users SET role = 'line_manager' WHERE role = 'line_manager_new_business';
-- UPDATE users SET role = 'ae' WHERE role = 'ae_subscription_sales';
-- UPDATE users SET role = 'sdr' WHERE role = 'cs_sdr';
-- ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
--
-- ============================================

-- Fertig! Prüfe das Ergebnis oben.
