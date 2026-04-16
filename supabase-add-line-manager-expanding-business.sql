-- =====================================================
-- Neue Rolle: line_manager_expanding_business
-- Datum: 2026-03-26
-- =====================================================

-- 1) users.role CHECK-Constraint erweitern
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;

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
    'line_manager_expanding_business',
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

-- 2) Default Permissions für die neue Rolle
INSERT INTO role_permissions (
  role,
  view_all_users,
  enter_own_go_lives,
  enter_go_lives_for_others,
  enter_pay_arr,
  edit_settings,
  edit_tiers,
  manage_users,
  assign_roles,
  view_all_reports,
  export_reports,
  has_admin_access
)
VALUES (
  'line_manager_expanding_business',
  true,
  true,
  false,
  false,
  true,
  false,
  true,
  false,
  true,
  true,
  true
)
ON CONFLICT (role) DO NOTHING;

-- 3) Optional: bestehende Expanding-Manager umhängen (auskommentiert)
-- UPDATE users
-- SET role = 'line_manager_expanding_business'
-- WHERE role = 'head_of_expanding_revenue'
--   AND email ILIKE '%dein-kriterium%';
