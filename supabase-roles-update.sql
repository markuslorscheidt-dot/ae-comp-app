-- =====================================================
-- ROLLEN-UPDATE für AE Kompensationsmodell v2.1
-- Führe dieses SQL in Supabase SQL Editor aus
-- =====================================================

-- 1. Markus Lorscheidt als Country Manager setzen
UPDATE profiles 
SET role = 'country_manager' 
WHERE email = 'markus.lorscheidt@gmail.com';

-- 2. Falls der User noch 'admin' als Rolle hat, auch diese umwandeln
UPDATE profiles SET role = 'country_manager' WHERE role = 'admin';

-- 3. Aktualisiere den Trigger für neue User
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, email, name, role)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1)),
    'ae'
  );
  
  INSERT INTO public.ae_settings (
    user_id, year, region, ote,
    terminal_base, terminal_bonus, terminal_penetration_threshold,
    monthly_subs_targets, monthly_pay_targets,
    subs_tiers, pay_tiers
  ) VALUES (
    NEW.id, 2026, 'DACH', 57000, 30, 50, 0.70,
    '[58799,70350,86800,91700,91700,86800,72800,65800,112700,112700,105000,42000]',
    '[25200,30150,37200,39300,39300,37200,31200,28200,48300,48300,45000,18000]',
    '[{"label":"< 50%","min":0,"max":0.5,"rate":0},{"label":"50% - 70%","min":0.5,"max":0.7,"rate":0.055},{"label":"70% - 85%","min":0.7,"max":0.85,"rate":0.06},{"label":"85% - 100%","min":0.85,"max":1.0,"rate":0.065},{"label":"100% - 110%","min":1.0,"max":1.1,"rate":0.07},{"label":"110% - 120%","min":1.1,"max":1.2,"rate":0.08},{"label":"120%+","min":1.2,"max":999,"rate":0.10}]',
    '[{"label":"< 50%","min":0,"max":0.5,"rate":0.10},{"label":"50% - 70%","min":0.5,"max":0.7,"rate":0.055},{"label":"70% - 85%","min":0.7,"max":0.85,"rate":0.06},{"label":"85% - 100%","min":0.85,"max":1.0,"rate":0.065},{"label":"100% - 110%","min":1.0,"max":1.1,"rate":0.07},{"label":"110% - 120%","min":1.1,"max":1.2,"rate":0.08},{"label":"120%+","min":1.2,"max":999,"rate":0.10}]'
  );
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 4. RLS Policies für Admin-Zugriff
DROP POLICY IF EXISTS "Users can view profiles" ON profiles;
DROP POLICY IF EXISTS "Users can view own profile" ON profiles;
DROP POLICY IF EXISTS "Admins can view all profiles" ON profiles;

CREATE POLICY "Users can view profiles" ON profiles
  FOR SELECT USING (
    auth.uid() = id 
    OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('country_manager', 'line_manager'))
  );

DROP POLICY IF EXISTS "Users can update own profile" ON profiles;
CREATE POLICY "Users can update own profile" ON profiles
  FOR UPDATE USING (auth.uid() = id);

DROP POLICY IF EXISTS "Admins can update all profiles" ON profiles;
CREATE POLICY "Admins can update all profiles" ON profiles
  FOR UPDATE USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('country_manager', 'line_manager'))
  );

DROP POLICY IF EXISTS "Admins can delete profiles" ON profiles;
CREATE POLICY "Admins can delete profiles" ON profiles
  FOR DELETE USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('country_manager', 'line_manager'))
  );

-- Go-Lives Policies
DROP POLICY IF EXISTS "Users can view go_lives" ON go_lives;
DROP POLICY IF EXISTS "Users can view own go_lives" ON go_lives;

CREATE POLICY "Users can view go_lives" ON go_lives
  FOR SELECT USING (
    user_id = auth.uid() 
    OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('country_manager', 'line_manager'))
  );

DROP POLICY IF EXISTS "Users can insert own go_lives" ON go_lives;
CREATE POLICY "Users can insert own go_lives" ON go_lives
  FOR INSERT WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can update own go_lives" ON go_lives;
CREATE POLICY "Users can update go_lives" ON go_lives
  FOR UPDATE USING (
    user_id = auth.uid()
    OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('country_manager', 'line_manager'))
  );

DROP POLICY IF EXISTS "Users can delete own go_lives" ON go_lives;
CREATE POLICY "Users can delete go_lives" ON go_lives
  FOR DELETE USING (
    user_id = auth.uid()
    OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('country_manager', 'line_manager'))
  );

-- Settings Policies
DROP POLICY IF EXISTS "Users can view settings" ON ae_settings;
DROP POLICY IF EXISTS "Users can view own settings" ON ae_settings;

CREATE POLICY "Users can view settings" ON ae_settings
  FOR SELECT USING (
    user_id = auth.uid() 
    OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('country_manager', 'line_manager'))
  );

DROP POLICY IF EXISTS "Users can update own settings" ON ae_settings;
CREATE POLICY "Users can update own settings" ON ae_settings
  FOR UPDATE USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Admins can update all settings" ON ae_settings;
CREATE POLICY "Admins can update all settings" ON ae_settings
  FOR UPDATE USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('country_manager', 'line_manager'))
  );
