-- =============================================
-- Migration: Partners RLS Policies Fix
-- Datum: 2026-01-18
-- Problem: RLS verwendet alte Rollen (line_manager statt line_manager_new_business)
-- =============================================

-- 1. Alte Policies löschen
DROP POLICY IF EXISTS "Admins und Head of Partnerships können Partner anlegen" ON partners;
DROP POLICY IF EXISTS "Admins können Partner bearbeiten" ON partners;
DROP POLICY IF EXISTS "Admins können Partner löschen" ON partners;

-- 2. Neue Policies mit korrekten Rollen erstellen

-- INSERT Policy
CREATE POLICY "Admins und Head of Partnerships können Partner anlegen"
  ON partners FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM users 
      WHERE users.id = auth.uid() 
      AND users.role IN (
        'country_manager',
        'line_manager_new_business',
        'line_manager_expanding_business',
        'line_manager_marketing',
        'head_of_partnerships',
        'dlt_member'
      )
    )
  );

-- UPDATE Policy
CREATE POLICY "Admins können Partner bearbeiten"
  ON partners FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users 
      WHERE users.id = auth.uid() 
      AND users.role IN (
        'country_manager',
        'line_manager_new_business',
        'line_manager_expanding_business',
        'line_manager_marketing',
        'head_of_partnerships',
        'dlt_member'
      )
    )
  );

-- DELETE Policy
CREATE POLICY "Admins können Partner löschen"
  ON partners FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users 
      WHERE users.id = auth.uid() 
      AND users.role IN (
        'country_manager',
        'line_manager_new_business',
        'line_manager_expanding_business',
        'line_manager_marketing',
        'dlt_member'
      )
    )
  );

-- =============================================
-- Rollback (falls nötig):
-- DROP POLICY IF EXISTS "Admins und Head of Partnerships können Partner anlegen" ON partners;
-- DROP POLICY IF EXISTS "Admins können Partner bearbeiten" ON partners;
-- DROP POLICY IF EXISTS "Admins können Partner löschen" ON partners;
-- (Dann alte Policies aus 20260115-golive-partnerships.sql wiederherstellen)
-- =============================================
