'use client';

import { useState, useEffect } from 'react';
import { supabase } from './supabase';
import { 
  User, 
  UserRole,
  AESettings, 
  GoLive,
  DEFAULT_SUBS_TIERS,
  DEFAULT_PAY_TIERS,
  DEFAULT_MONTHLY_GO_LIVE_TARGETS,
  DEFAULT_MONTHLY_INBOUND_TARGETS,
  DEFAULT_MONTHLY_OUTBOUND_TARGETS,
  DEFAULT_MONTHLY_PARTNERSHIPS_TARGETS,
  DEFAULT_SETTINGS,
  calculateMonthlySubsTargets,
  calculateMonthlyPayTargets,
  calculateTotalGoLives,
  googleSheetToCsvUrl
} from './types';

// ============================================
// AUTH HOOK (mit Timeout und robustem Error Handling)
// ============================================

const AUTH_TIMEOUT = 8000; // 8 Sekunden Timeout

// Helper: Promise mit Timeout
function withTimeout<T>(promise: Promise<T>, ms: number, errorMsg: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => 
      setTimeout(() => reject(new Error(errorMsg)), ms)
    )
  ]);
}

// Helper: Korrupte Session bereinigen
async function clearCorruptSession() {
  try {
    // LocalStorage Auth-Daten löschen
    const keysToRemove = Object.keys(localStorage).filter(key => 
      key.startsWith('sb-') || key.includes('supabase')
    );
    keysToRemove.forEach(key => localStorage.removeItem(key));
    
    // Supabase Session beenden
    await supabase.auth.signOut();
  } catch (e) {
    console.warn('Session cleanup error:', e);
  }
}

export function useAuth() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    const getSession = async () => {
      try {
        // Session mit Timeout abrufen
        const { data: { session }, error: sessionError } = await withTimeout(
          supabase.auth.getSession(),
          AUTH_TIMEOUT,
          'Session timeout - bitte neu einloggen'
        );
        
        if (sessionError) {
          console.error('Session error:', sessionError);
          await clearCorruptSession();
          if (mounted) setLoading(false);
          return;
        }
        
        if (session?.user && mounted) {
          // Prüfe ob Token noch gültig ist
          const expiresAt = session.expires_at;
          if (expiresAt && expiresAt * 1000 < Date.now()) {
            console.warn('Session abgelaufen, bereinige...');
            await clearCorruptSession();
            if (mounted) setLoading(false);
            return;
          }

          // Profil laden mit Timeout
          const { data: profile, error: profileError } = await withTimeout(
            supabase
              .from('users')
              .select('*')
              .eq('id', session.user.id)
              .single(),
            AUTH_TIMEOUT,
            'Profil-Timeout'
          );

          if (profileError) {
            console.error('Profile error:', profileError);
            if (mounted) setLoading(false);
            return;
          }

          if (profile && mounted) {
            setUser({
              id: profile.id,
              email: profile.email,
              name: profile.name,
              role: profile.role as UserRole,
              language: profile.language,
              created_at: profile.created_at
            });
          }
        }
      } catch (error: any) {
        console.error('Auth error:', error?.message || error);
        
        // Bei Timeout oder Fehler: Session bereinigen
        if (error?.message?.includes('timeout') || error?.message?.includes('aborted')) {
          console.warn('Auth timeout, bereinige Session...');
          await clearCorruptSession();
        }
      } finally {
        if (mounted) setLoading(false);
      }
    };

    getSession();

    // Auth State Change Listener
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      console.log('Auth event:', event);
      
      if (event === 'SIGNED_OUT' || event === 'TOKEN_REFRESHED' && !session) {
        if (mounted) {
          setUser(null);
          setLoading(false);
        }
        return;
      }

      if (event === 'TOKEN_REFRESHED' && session) {
        console.log('Token erfolgreich erneuert');
      }

      if (session?.user && mounted) {
        try {
          const { data: profile } = await withTimeout(
            supabase
              .from('users')
              .select('*')
              .eq('id', session.user.id)
              .single(),
            AUTH_TIMEOUT,
            'Profil-Timeout bei Auth-Change'
          );

          if (profile && mounted) {
            setUser({
              id: profile.id,
              email: profile.email,
              name: profile.name,
              role: profile.role as UserRole,
              language: profile.language,
              created_at: profile.created_at
            });
          }
        } catch (error) {
          console.error('Profile fetch error:', error);
        }
      }
      if (mounted) setLoading(false);
    });

    // Cleanup
    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  const signIn = async (email: string, password: string) => {
    try {
      const { error } = await withTimeout(
        supabase.auth.signInWithPassword({ email, password }),
        AUTH_TIMEOUT,
        'Login timeout - bitte erneut versuchen'
      );
      return { error };
    } catch (error: any) {
      return { error: { message: error.message } };
    }
  };

  const signUp = async (email: string, password: string, name: string) => {
    try {
      const { error } = await withTimeout(
        supabase.auth.signUp({
          email,
          password,
          options: { data: { name } }
        }),
        AUTH_TIMEOUT,
        'Registrierung timeout - bitte erneut versuchen'
      );
      return { error };
    } catch (error: any) {
      return { error: { message: error.message } };
    }
  };

  const signOut = async () => {
    try {
      await supabase.auth.signOut();
    } catch (e) {
      console.warn('SignOut error:', e);
    }
    // Immer aufräumen, auch bei Fehler
    await clearCorruptSession();
    setUser(null);
  };

  return { user, loading, signIn, signUp, signOut };
}

// ============================================
// SETTINGS HOOK
// ============================================

function parseSettings(data: any): AESettings {
  // Go-Live Kategorien parsen
  const inboundTargets = data.monthly_inbound_targets || DEFAULT_MONTHLY_INBOUND_TARGETS;
  const outboundTargets = data.monthly_outbound_targets || DEFAULT_MONTHLY_OUTBOUND_TARGETS;
  const partnershipsTargets = data.monthly_partnerships_targets || DEFAULT_MONTHLY_PARTNERSHIPS_TARGETS;
  
  // Go-Live Targets: Wenn Kategorien vorhanden, summieren; sonst Legacy-Feld nutzen
  const goLiveTargets = data.monthly_go_live_targets || 
    calculateTotalGoLives(inboundTargets, outboundTargets, partnershipsTargets);
  
  const avgSubsBill = Number(data.avg_subs_bill) || DEFAULT_SETTINGS.avg_subs_bill;
  const avgPayBill = Number(data.avg_pay_bill) || DEFAULT_SETTINGS.avg_pay_bill;
  const avgPayBillTipping = Number(data.avg_pay_bill_tipping) || DEFAULT_SETTINGS.avg_pay_bill_tipping;
  const payArrFactor = Number(data.pay_arr_factor) || DEFAULT_SETTINGS.pay_arr_factor;
  
  // Subs ARR-Ziele: Aus DB laden ODER aus Go-Lives berechnen (Fallback)
  const subsTargets = data.monthly_subs_targets || 
    calculateMonthlySubsTargets(goLiveTargets, avgSubsBill);
  
  // Pay ARR-Ziele: Aus DB laden ODER aus Sheet ODER berechnet (Legacy)
  const payTargets = data.monthly_pay_targets || data.monthly_pay_arr_targets || 
    calculateMonthlyPayTargets(subsTargets, payArrFactor);

  return {
    id: data.id,
    user_id: data.user_id,
    year: data.year,
    region: data.region || 'DACH',
    ote: Number(data.ote) || DEFAULT_SETTINGS.ote,
    monthly_go_live_targets: goLiveTargets,
    // NEU: Go-Live Kategorien
    monthly_inbound_targets: inboundTargets,
    monthly_outbound_targets: outboundTargets,
    monthly_partnerships_targets: partnershipsTargets,
    // NEU: AE Target-Prozentsatz
    target_percentage: data.target_percentage || null,
    avg_subs_bill: avgSubsBill,
    avg_pay_bill: avgPayBill,
    avg_pay_bill_tipping: avgPayBillTipping,
    pay_arr_factor: payArrFactor,
    monthly_subs_targets: subsTargets,
    monthly_pay_targets: payTargets,
    // NEU: Pay ARR direkt aus Sheet
    monthly_pay_arr_targets: data.monthly_pay_arr_targets || null,
    terminal_base: Number(data.terminal_base) || DEFAULT_SETTINGS.terminal_base,
    terminal_bonus: Number(data.terminal_bonus) || DEFAULT_SETTINGS.terminal_bonus,
    terminal_penetration_threshold: Number(data.terminal_penetration_threshold) || DEFAULT_SETTINGS.terminal_penetration_threshold,
    subs_tiers: data.subs_tiers || DEFAULT_SUBS_TIERS,
    pay_tiers: data.pay_tiers || DEFAULT_PAY_TIERS,
    // NEU: Google Sheets Integration
    google_sheet_url: data.google_sheet_url || null,
    use_google_sheet: data.use_google_sheet || false,
    last_sheet_sync: data.last_sheet_sync || null,
    created_at: data.created_at,
    updated_at: data.updated_at
  };
}

export function useSettings(userId: string | undefined) {
  const [settings, setSettings] = useState<AESettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    const fetchSettings = async () => {
      if (!userId) {
        setLoading(false);
        return;
      }

      try {
        const { data, error: fetchError } = await supabase
          .from('ae_settings')
          .select('*')
          .eq('user_id', userId)
          .eq('year', 2026)
          .maybeSingle();

        if (fetchError) {
          console.error('Settings fetch error:', fetchError);
          if (mounted) setError(fetchError.message);
        } else if (data && mounted) {
          setSettings(parseSettings(data));
        }
      } catch (err) {
        console.error('Settings error:', err);
        if (mounted) setError('Fehler beim Laden der Einstellungen');
      } finally {
        if (mounted) setLoading(false);
      }
    };

    fetchSettings();

    return () => { mounted = false; };
  }, [userId]);

  const updateSettings = async (updates: Partial<AESettings>) => {
    if (!settings?.id) return { error: { message: 'Keine Einstellungen vorhanden' } };

    const updateData: any = {
      updated_at: new Date().toISOString()
    };

    // Alle aktualisierbaren Felder
    if (updates.year !== undefined) updateData.year = updates.year;
    if (updates.region !== undefined) updateData.region = updates.region;
    if (updates.ote !== undefined) updateData.ote = updates.ote;
    if (updates.monthly_go_live_targets !== undefined) updateData.monthly_go_live_targets = updates.monthly_go_live_targets;
    // NEU: Go-Live Kategorien
    if (updates.monthly_inbound_targets !== undefined) updateData.monthly_inbound_targets = updates.monthly_inbound_targets;
    if (updates.monthly_outbound_targets !== undefined) updateData.monthly_outbound_targets = updates.monthly_outbound_targets;
    if (updates.monthly_partnerships_targets !== undefined) updateData.monthly_partnerships_targets = updates.monthly_partnerships_targets;
    // NEU: AE Target-Prozentsatz
    if (updates.target_percentage !== undefined) updateData.target_percentage = updates.target_percentage;
    if (updates.avg_subs_bill !== undefined) updateData.avg_subs_bill = updates.avg_subs_bill;
    if (updates.avg_pay_bill !== undefined) updateData.avg_pay_bill = updates.avg_pay_bill;
    if (updates.avg_pay_bill_tipping !== undefined) updateData.avg_pay_bill_tipping = updates.avg_pay_bill_tipping;
    if (updates.pay_arr_factor !== undefined) updateData.pay_arr_factor = updates.pay_arr_factor;
    if (updates.monthly_subs_targets !== undefined) updateData.monthly_subs_targets = updates.monthly_subs_targets;
    if (updates.monthly_pay_targets !== undefined) updateData.monthly_pay_targets = updates.monthly_pay_targets;
    // NEU: Pay ARR direkt
    if (updates.monthly_pay_arr_targets !== undefined) updateData.monthly_pay_arr_targets = updates.monthly_pay_arr_targets;
    if (updates.terminal_base !== undefined) updateData.terminal_base = updates.terminal_base;
    if (updates.terminal_bonus !== undefined) updateData.terminal_bonus = updates.terminal_bonus;
    if (updates.terminal_penetration_threshold !== undefined) updateData.terminal_penetration_threshold = updates.terminal_penetration_threshold;
    if (updates.subs_tiers !== undefined) updateData.subs_tiers = updates.subs_tiers;
    if (updates.pay_tiers !== undefined) updateData.pay_tiers = updates.pay_tiers;
    // NEU: Google Sheets Integration
    if (updates.google_sheet_url !== undefined) updateData.google_sheet_url = updates.google_sheet_url;
    if (updates.use_google_sheet !== undefined) updateData.use_google_sheet = updates.use_google_sheet;
    if (updates.last_sheet_sync !== undefined) updateData.last_sheet_sync = updates.last_sheet_sync;

    const { error } = await supabase
      .from('ae_settings')
      .update(updateData)
      .eq('id', settings.id);

    if (!error) {
      setSettings({ ...settings, ...updates });
    }
    return { error };
  };

  return { settings, loading, error, updateSettings };
}

// ============================================
// GO-LIVES HOOK
// ============================================

export function useGoLives(userId: string | undefined, year: number = 2026) {
  const [goLives, setGoLives] = useState<GoLive[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchGoLives = async () => {
    if (!userId) {
      setLoading(false);
      return;
    }

    try {
      const { data, error: fetchError } = await supabase
        .from('go_lives')
        .select('*')
        .eq('user_id', userId)
        .eq('year', year)
        .order('go_live_date', { ascending: true });

      if (fetchError) {
        console.error('GoLives fetch error:', fetchError);
        setError(fetchError.message);
      } else {
        const transformed = (data || []).map(gl => ({
          id: gl.id,
          user_id: gl.user_id,
          year: gl.year,
          month: gl.month,
          customer_name: gl.customer_name,
          oak_id: gl.oak_id ? Number(gl.oak_id) : null,
          go_live_date: gl.go_live_date,
          subs_monthly: Number(gl.subs_monthly) || 0,
          subs_arr: Number(gl.subs_arr) || (Number(gl.subs_monthly) || 0) * 12,
          has_terminal: gl.has_terminal || false,
          pay_arr: gl.pay_arr ? Number(gl.pay_arr) : null,
          commission_relevant: gl.commission_relevant ?? true,
          partner_id: gl.partner_id || null,
          is_enterprise: gl.is_enterprise || false,
          subscription_package_id: gl.subscription_package_id || null,
          notes: gl.notes,
          created_at: gl.created_at,
          updated_at: gl.updated_at
        }));
        setGoLives(transformed);
      }
    } catch (err) {
      console.error('GoLives error:', err);
      setError('Fehler beim Laden der Go-Lives');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let mounted = true;
    
    if (mounted) {
      fetchGoLives();
    }

    return () => { mounted = false; };
  }, [userId, year]);

  const addGoLive = async (goLive: Partial<GoLive>) => {
    const subsArr = (goLive.subs_monthly || 0) * 12;
    
    const { data, error } = await supabase
      .from('go_lives')
      .insert({
        user_id: goLive.user_id,
        year: goLive.year || 2026,
        month: goLive.month,
        customer_name: goLive.customer_name,
        go_live_date: goLive.go_live_date,
        subs_monthly: goLive.subs_monthly || 0,
        subs_arr: subsArr,
        has_terminal: goLive.has_terminal || false,
        pay_arr_target: goLive.pay_arr_target || null,  // NEU: Pay ARR Target bei Go-Live
        pay_arr: goLive.pay_arr || null,
        commission_relevant: goLive.commission_relevant ?? true,
        // NEU: Partnership & Enterprise
        partner_id: goLive.partner_id || null,
        is_enterprise: goLive.is_enterprise || false,
        // NEU: Subscription Package
        subscription_package_id: goLive.subscription_package_id || null,
        notes: goLive.notes || null
      })
      .select()
      .single();

    if (!error && data) {
      await fetchGoLives();
    }
    return { data, error };
  };

  const updateGoLive = async (id: string, updates: Partial<GoLive>) => {
    const updateData: any = { updated_at: new Date().toISOString() };
    if (updates.user_id !== undefined) updateData.user_id = updates.user_id;
    if (updates.customer_name !== undefined) updateData.customer_name = updates.customer_name;
    if (updates.oak_id !== undefined) updateData.oak_id = updates.oak_id;
    if (updates.go_live_date !== undefined) updateData.go_live_date = updates.go_live_date;
    if (updates.subs_monthly !== undefined) {
      updateData.subs_monthly = updates.subs_monthly;
      updateData.subs_arr = updates.subs_monthly * 12;
    }
    if (updates.has_terminal !== undefined) updateData.has_terminal = updates.has_terminal;
    if (updates.pay_arr_target !== undefined) updateData.pay_arr_target = updates.pay_arr_target;  // NEU
    if (updates.pay_arr !== undefined) updateData.pay_arr = updates.pay_arr;
    if (updates.notes !== undefined) updateData.notes = updates.notes;
    if (updates.commission_relevant !== undefined) updateData.commission_relevant = updates.commission_relevant;
    // NEU: Partnership & Enterprise
    if (updates.partner_id !== undefined) updateData.partner_id = updates.partner_id;
    if (updates.is_enterprise !== undefined) updateData.is_enterprise = updates.is_enterprise;
    // NEU: Subscription Package
    if (updates.subscription_package_id !== undefined) updateData.subscription_package_id = updates.subscription_package_id;
    // NEU: Monat (bei Datumsänderung)
    if (updates.month !== undefined) updateData.month = updates.month;

    const { error } = await supabase
      .from('go_lives')
      .update(updateData)
      .eq('id', id);

    if (!error) {
      await fetchGoLives();
    }
    return { error };
  };

  const deleteGoLive = async (id: string) => {
    const { error } = await supabase
      .from('go_lives')
      .delete()
      .eq('id', id);

    if (!error) {
      setGoLives(prev => prev.filter(gl => gl.id !== id));
    }
    return { error };
  };

  return { goLives, loading, error, addGoLive, updateGoLive, deleteGoLive, refetch: fetchGoLives };
}

// ============================================
// ADMIN HOOKS
// ============================================

export function useAllUsers() {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchUsers = async () => {
    try {
      const { data, error: fetchError } = await supabase
        .from('users')
        .select('*')
        .order('name');

      if (fetchError) {
        console.error('Users fetch error:', fetchError);
        setError(fetchError.message);
      } else {
        setUsers((data || []).map(p => ({
          id: p.id,
          email: p.email,
          name: p.name,
          role: p.role as UserRole,
          language: p.language,
          created_at: p.created_at,
          employee_id: p.employee_id,
          phone: p.phone,
          region: p.region,
          start_date: p.start_date,
          manager_id: p.manager_id,
          photo_url: p.photo_url,
        })));
      }
    } catch (err) {
      console.error('Users error:', err);
      setError('Fehler beim Laden der User');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUsers();
  }, []);

  const updateUserRole = async (userId: string, newRole: UserRole) => {
    const { error } = await supabase
      .from('users')
      .update({ role: newRole })
      .eq('id', userId);

    if (!error) {
      setUsers(prev => prev.map(u => 
        u.id === userId ? { ...u, role: newRole } : u
      ));
    }
    return { error };
  };

  const deleteUser = async (userId: string) => {
    await supabase.from('go_lives').delete().eq('user_id', userId);
    await supabase.from('ae_settings').delete().eq('user_id', userId);
    const { error } = await supabase.from('users').delete().eq('id', userId);
    
    if (!error) {
      setUsers(prev => prev.filter(u => u.id !== userId));
    }
    return { error };
  };

  return { users, loading, error, updateUserRole, deleteUser, refetch: fetchUsers };
}

// ============================================
// ALL GO-LIVES HOOK (für Admin)
// ============================================

export function useAllGoLives(year: number = 2026) {
  const [goLives, setGoLives] = useState<GoLive[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchAllGoLives = async () => {
      try {
        const { data, error: fetchError } = await supabase
          .from('go_lives')
          .select('*')
          .eq('year', year)
          .order('go_live_date', { ascending: true });

        if (fetchError) {
          setError(fetchError.message);
        } else {
          const transformed = (data || []).map(gl => ({
            id: gl.id,
            user_id: gl.user_id,
            year: gl.year,
            month: gl.month,
            customer_name: gl.customer_name,
            oak_id: gl.oak_id ? Number(gl.oak_id) : null,
            go_live_date: gl.go_live_date,
            subs_monthly: Number(gl.subs_monthly) || 0,
            subs_arr: Number(gl.subs_arr) || (Number(gl.subs_monthly) || 0) * 12,
            has_terminal: gl.has_terminal || false,
            pay_arr: gl.pay_arr ? Number(gl.pay_arr) : null,
            commission_relevant: gl.commission_relevant ?? true,
            partner_id: gl.partner_id || null,
            is_enterprise: gl.is_enterprise || false,
            subscription_package_id: gl.subscription_package_id || null,
            notes: gl.notes,
            created_at: gl.created_at,
            updated_at: gl.updated_at
          }));
          setGoLives(transformed);
        }
      } catch (err) {
        setError('Fehler beim Laden der Go-Lives');
      } finally {
        setLoading(false);
      }
    };

    fetchAllGoLives();
  }, [year]);

  return { goLives, loading, error };
}

// ============================================
// ALL SETTINGS HOOK (für Admin)
// ============================================

export function useAllSettings(year: number = 2026) {
  const [settings, setSettings] = useState<AESettings[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchAllSettings = async () => {
      const { data } = await supabase
        .from('ae_settings')
        .select('*')
        .eq('year', year);

      if (data) {
        setSettings(data.map(s => parseSettings(s)));
      }
      setLoading(false);
    };

    fetchAllSettings();
  }, [year]);

  return { settings, loading };
}

// ============================================
// SETTINGS FOR SPECIFIC USER (für Multi-User Management)
// ============================================

export function useSettingsForUser(userId: string | undefined, year: number = 2026) {
  const [settings, setSettings] = useState<AESettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchSettings = async () => {
    if (!userId) {
      setSettings(null);
      setLoading(false);
      return;
    }

    // Loading wird bereits im useEffect gesetzt
    try {
      const { data, error: fetchError } = await supabase
        .from('ae_settings')
        .select('*')
        .eq('user_id', userId)
        .eq('year', year)
        .maybeSingle();

      if (fetchError) {
        setError(fetchError.message);
        setLoading(false);
        return;
      }
      
      if (data) {
        // Settings gefunden
        setSettings(parseSettings(data));
      } else {
        // Keine Settings vorhanden - erstelle Default-Settings
        console.log('Creating default settings for user:', userId);
        
        const defaultSettings = {
          user_id: userId,
          year: year,
          region: 'DACH',
          ote: DEFAULT_SETTINGS.ote,
          monthly_go_live_targets: DEFAULT_MONTHLY_GO_LIVE_TARGETS,
          // NEU: Go-Live Kategorien
          monthly_inbound_targets: DEFAULT_MONTHLY_INBOUND_TARGETS,
          monthly_outbound_targets: DEFAULT_MONTHLY_OUTBOUND_TARGETS,
          monthly_partnerships_targets: DEFAULT_MONTHLY_PARTNERSHIPS_TARGETS,
          // NEU: AE Target-Prozentsatz (wird in UI berechnet/gesetzt)
          target_percentage: null,
          avg_subs_bill: DEFAULT_SETTINGS.avg_subs_bill,
          avg_pay_bill: DEFAULT_SETTINGS.avg_pay_bill,
          avg_pay_bill_tipping: DEFAULT_SETTINGS.avg_pay_bill_tipping,
          pay_arr_factor: DEFAULT_SETTINGS.pay_arr_factor,
          monthly_subs_targets: calculateMonthlySubsTargets(DEFAULT_MONTHLY_GO_LIVE_TARGETS, DEFAULT_SETTINGS.avg_subs_bill),
          monthly_pay_targets: calculateMonthlyPayTargets(
            calculateMonthlySubsTargets(DEFAULT_MONTHLY_GO_LIVE_TARGETS, DEFAULT_SETTINGS.avg_subs_bill),
            DEFAULT_SETTINGS.pay_arr_factor
          ),
          terminal_base: DEFAULT_SETTINGS.terminal_base,
          terminal_bonus: DEFAULT_SETTINGS.terminal_bonus,
          terminal_penetration_threshold: DEFAULT_SETTINGS.terminal_penetration_threshold,
          subs_tiers: DEFAULT_SUBS_TIERS,
          pay_tiers: DEFAULT_PAY_TIERS,
          // NEU: Google Sheets Integration (Standard: deaktiviert)
          use_google_sheet: false,
        };

        const { data: newData, error: insertError } = await supabase
          .from('ae_settings')
          .insert(defaultSettings)
          .select()
          .single();

        if (insertError) {
          console.error('Error creating default settings:', insertError);
          setError('Fehler beim Erstellen der Einstellungen');
        } else if (newData) {
          setSettings(parseSettings(newData));
        }
      }
    } catch (err) {
      console.error('Error in fetchSettings:', err);
      setError('Fehler beim Laden der Einstellungen');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // Sofort loading auf true setzen wenn userId sich ändert
    setLoading(true);
    setError(null);
    fetchSettings();
  }, [userId, year]);

  const updateSettings = async (updates: Partial<AESettings>) => {
    if (!settings?.id) return { error: { message: 'Keine Einstellungen vorhanden' } };

    const updateData: any = {
      updated_at: new Date().toISOString()
    };

    if (updates.year !== undefined) updateData.year = updates.year;
    if (updates.region !== undefined) updateData.region = updates.region;
    if (updates.ote !== undefined) updateData.ote = updates.ote;
    if (updates.monthly_go_live_targets !== undefined) updateData.monthly_go_live_targets = updates.monthly_go_live_targets;
    // NEU: Go-Live Kategorien
    if (updates.monthly_inbound_targets !== undefined) updateData.monthly_inbound_targets = updates.monthly_inbound_targets;
    if (updates.monthly_outbound_targets !== undefined) updateData.monthly_outbound_targets = updates.monthly_outbound_targets;
    if (updates.monthly_partnerships_targets !== undefined) updateData.monthly_partnerships_targets = updates.monthly_partnerships_targets;
    // NEU: AE Target-Prozentsatz
    if (updates.target_percentage !== undefined) updateData.target_percentage = updates.target_percentage;
    if (updates.avg_subs_bill !== undefined) updateData.avg_subs_bill = updates.avg_subs_bill;
    if (updates.avg_pay_bill !== undefined) updateData.avg_pay_bill = updates.avg_pay_bill;
    if (updates.avg_pay_bill_tipping !== undefined) updateData.avg_pay_bill_tipping = updates.avg_pay_bill_tipping;
    if (updates.pay_arr_factor !== undefined) updateData.pay_arr_factor = updates.pay_arr_factor;
    if (updates.monthly_subs_targets !== undefined) updateData.monthly_subs_targets = updates.monthly_subs_targets;
    if (updates.monthly_pay_targets !== undefined) updateData.monthly_pay_targets = updates.monthly_pay_targets;
    // NEU: Pay ARR direkt
    if (updates.monthly_pay_arr_targets !== undefined) updateData.monthly_pay_arr_targets = updates.monthly_pay_arr_targets;
    if (updates.terminal_base !== undefined) updateData.terminal_base = updates.terminal_base;
    if (updates.terminal_bonus !== undefined) updateData.terminal_bonus = updates.terminal_bonus;
    if (updates.terminal_penetration_threshold !== undefined) updateData.terminal_penetration_threshold = updates.terminal_penetration_threshold;
    if (updates.subs_tiers !== undefined) updateData.subs_tiers = updates.subs_tiers;
    if (updates.pay_tiers !== undefined) updateData.pay_tiers = updates.pay_tiers;
    // NEU: Google Sheets Integration
    if (updates.google_sheet_url !== undefined) updateData.google_sheet_url = updates.google_sheet_url;
    if (updates.use_google_sheet !== undefined) updateData.use_google_sheet = updates.use_google_sheet;
    if (updates.last_sheet_sync !== undefined) updateData.last_sheet_sync = updates.last_sheet_sync;

    const { error } = await supabase
      .from('ae_settings')
      .update(updateData)
      .eq('id', settings.id);

    if (!error) {
      setSettings({ ...settings, ...updates });
    }
    return { error };
  };

  return { settings, loading, error, updateSettings, refetch: fetchSettings };
}

// ============================================
// GO-LIVES FOR SPECIFIC USER (für Multi-User Management)
// ============================================

export function useGoLivesForUser(userId: string | undefined, year: number = 2026) {
  const [goLives, setGoLives] = useState<GoLive[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchGoLives = async () => {
    if (!userId) {
      setGoLives([]);
      setLoading(false);
      return;
    }

    // Loading wird bereits im useEffect gesetzt
    try {
      const { data, error: fetchError } = await supabase
        .from('go_lives')
        .select('*')
        .eq('user_id', userId)
        .eq('year', year)
        .order('go_live_date', { ascending: true });

      if (fetchError) {
        setError(fetchError.message);
      } else {
        const transformed = (data || []).map(gl => ({
          id: gl.id,
          user_id: gl.user_id,
          year: gl.year,
          month: gl.month,
          customer_name: gl.customer_name,
          oak_id: gl.oak_id ? Number(gl.oak_id) : null,
          go_live_date: gl.go_live_date,
          subs_monthly: Number(gl.subs_monthly) || 0,
          subs_arr: Number(gl.subs_arr) || (Number(gl.subs_monthly) || 0) * 12,
          has_terminal: gl.has_terminal || false,
          pay_arr: gl.pay_arr ? Number(gl.pay_arr) : null,
          commission_relevant: gl.commission_relevant ?? true,
          partner_id: gl.partner_id || null,
          is_enterprise: gl.is_enterprise || false,
          subscription_package_id: gl.subscription_package_id || null,
          notes: gl.notes,
          created_at: gl.created_at,
          updated_at: gl.updated_at
        }));
        setGoLives(transformed);
      }
    } catch (err) {
      setError('Fehler beim Laden der Go-Lives');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // Sofort loading auf true setzen wenn userId sich ändert
    setLoading(true);
    setError(null);
    fetchGoLives();
  }, [userId, year]);

  const addGoLive = async (goLive: Partial<GoLive>) => {
    const subsArr = (goLive.subs_monthly || 0) * 12;
    
    const { data, error } = await supabase
      .from('go_lives')
      .insert({
        user_id: goLive.user_id || userId,
        year: goLive.year || year,
        month: goLive.month,
        customer_name: goLive.customer_name,
        oak_id: goLive.oak_id || null,
        go_live_date: goLive.go_live_date,
        subs_monthly: goLive.subs_monthly || 0,
        subs_arr: subsArr,
        has_terminal: goLive.has_terminal || false,
        pay_arr_target: goLive.pay_arr_target || null,  // NEU: Pay ARR Target bei Go-Live
        pay_arr: goLive.pay_arr || null,
        commission_relevant: goLive.commission_relevant ?? true,
        // NEU: Partnership & Enterprise
        partner_id: goLive.partner_id || null,
        is_enterprise: goLive.is_enterprise || false,
        // NEU: Subscription Package
        subscription_package_id: goLive.subscription_package_id || null,
        notes: goLive.notes || null
      })
      .select()
      .single();

    if (!error && data) {
      await fetchGoLives();
    }
    return { data, error };
  };

  const updateGoLive = async (id: string, updates: Partial<GoLive>) => {
    const updateData: any = { updated_at: new Date().toISOString() };
    if (updates.user_id !== undefined) updateData.user_id = updates.user_id;
    if (updates.customer_name !== undefined) updateData.customer_name = updates.customer_name;
    if (updates.oak_id !== undefined) updateData.oak_id = updates.oak_id;
    if (updates.go_live_date !== undefined) updateData.go_live_date = updates.go_live_date;
    if (updates.subs_monthly !== undefined) {
      updateData.subs_monthly = updates.subs_monthly;
      updateData.subs_arr = updates.subs_monthly * 12;
    }
    if (updates.has_terminal !== undefined) updateData.has_terminal = updates.has_terminal;
    if (updates.pay_arr_target !== undefined) updateData.pay_arr_target = updates.pay_arr_target;  // NEU
    if (updates.pay_arr !== undefined) updateData.pay_arr = updates.pay_arr;
    if (updates.notes !== undefined) updateData.notes = updates.notes;
    if (updates.commission_relevant !== undefined) updateData.commission_relevant = updates.commission_relevant;
    // NEU: Partnership & Enterprise
    if (updates.partner_id !== undefined) updateData.partner_id = updates.partner_id;
    if (updates.is_enterprise !== undefined) updateData.is_enterprise = updates.is_enterprise;
    // NEU: Subscription Package
    if (updates.subscription_package_id !== undefined) updateData.subscription_package_id = updates.subscription_package_id;
    // NEU: Monat (bei Datumsänderung)
    if (updates.month !== undefined) updateData.month = updates.month;

    const { error } = await supabase
      .from('go_lives')
      .update(updateData)
      .eq('id', id);

    if (!error) {
      await fetchGoLives();
    }
    return { error };
  };

  const deleteGoLive = async (id: string) => {
    const { error } = await supabase
      .from('go_lives')
      .delete()
      .eq('id', id);

    if (!error) {
      setGoLives(prev => prev.filter(gl => gl.id !== id));
    }
    return { error };
  };

  return { goLives, loading, error, addGoLive, updateGoLive, deleteGoLive, refetch: fetchGoLives };
}

// ============================================
// COMBINED DATA FOR MULTIPLE USERS (für Vergleich/Gesamt)
// ============================================

export function useMultiUserData(userIds: string[], year: number = 2026, plannableUserIds?: string[]) {
  const [data, setData] = useState<{
    settings: Map<string, AESettings>;
    goLives: Map<string, GoLive[]>;
    combined: { settings: AESettings | null; goLives: GoLive[] };
  }>({
    settings: new Map(),
    goLives: new Map(),
    combined: { settings: null, goLives: [] }
  });
  const [loading, setLoading] = useState(true);

  // Welche User-IDs sollen für combined Settings verwendet werden?
  // Wenn plannableUserIds übergeben wird, nur diese; sonst alle
  const settingsUserIds = plannableUserIds || userIds;

  useEffect(() => {
    const fetchData = async () => {
      if (userIds.length === 0) {
        setLoading(false);
        return;
      }

      setLoading(true);

      // Fetch all settings
      const { data: settingsData } = await supabase
        .from('ae_settings')
        .select('*')
        .in('user_id', userIds)
        .eq('year', year);

      // Fetch all go-lives
      const { data: goLivesData } = await supabase
        .from('go_lives')
        .select('*')
        .in('user_id', userIds)
        .eq('year', year)
        .order('go_live_date', { ascending: true });

      // Build maps
      const settingsMap = new Map<string, AESettings>();
      const goLivesMap = new Map<string, GoLive[]>();

      (settingsData || []).forEach(s => {
        settingsMap.set(s.user_id, parseSettings(s));
      });

      userIds.forEach(uid => {
        goLivesMap.set(uid, []);
      });

      (goLivesData || []).forEach(gl => {
        const transformed: GoLive = {
          id: gl.id,
          user_id: gl.user_id,
          year: gl.year,
          month: gl.month,
          customer_name: gl.customer_name,
          oak_id: gl.oak_id ? Number(gl.oak_id) : null,
          go_live_date: gl.go_live_date,
          subs_monthly: Number(gl.subs_monthly) || 0,
          subs_arr: Number(gl.subs_arr) || (Number(gl.subs_monthly) || 0) * 12,
          has_terminal: gl.has_terminal || false,
          pay_arr: gl.pay_arr ? Number(gl.pay_arr) : null,
          commission_relevant: gl.commission_relevant ?? true,
          partner_id: gl.partner_id || null,
          is_enterprise: gl.is_enterprise || false,
          subscription_package_id: gl.subscription_package_id || null,
          notes: gl.notes,
          created_at: gl.created_at,
          updated_at: gl.updated_at
        };
        const existing = goLivesMap.get(gl.user_id) || [];
        goLivesMap.set(gl.user_id, [...existing, transformed]);
      });

      // Build combined settings (sum of targets from PLANNABLE users only)
      let combinedSettings: AESettings | null = null;
      
      // Filtere Settings auf plannable Users (wenn angegeben)
      const plannableSettings = Array.from(settingsMap.entries())
        .filter(([userId]) => settingsUserIds.includes(userId))
        .map(([, settings]) => settings);
      
      if (plannableSettings.length > 0) {
        const firstSettings = plannableSettings[0];
        
        combinedSettings = {
          ...firstSettings,
          id: 'combined',
          user_id: 'combined',
          ote: plannableSettings.reduce((sum, s) => sum + s.ote, 0),
          monthly_go_live_targets: firstSettings.monthly_go_live_targets.map((_, i) =>
            plannableSettings.reduce((sum, s) => sum + (s.monthly_go_live_targets?.[i] || 0), 0)
          ),
          monthly_subs_targets: firstSettings.monthly_subs_targets.map((_, i) =>
            plannableSettings.reduce((sum, s) => sum + (s.monthly_subs_targets?.[i] || 0), 0)
          ),
          monthly_pay_targets: firstSettings.monthly_pay_targets.map((_, i) =>
            plannableSettings.reduce((sum, s) => sum + (s.monthly_pay_targets?.[i] || 0), 0)
          ),
        };
      }

      // Combine all go-lives
      const allGoLives = Array.from(goLivesMap.values()).flat();

      setData({
        settings: settingsMap,
        goLives: goLivesMap,
        combined: { settings: combinedSettings, goLives: allGoLives }
      });
      setLoading(false);
    };

    fetchData();
  }, [userIds.join(','), settingsUserIds.join(','), year]);

  // Refetch function for manual reload
  const refetch = async () => {
    if (userIds.length === 0) return;

    setLoading(true);

    // Fetch all settings
    const { data: settingsData } = await supabase
      .from('ae_settings')
      .select('*')
      .in('user_id', userIds)
      .eq('year', year);

    // Fetch all go-lives
    const { data: goLivesData } = await supabase
      .from('go_lives')
      .select('*')
      .in('user_id', userIds)
      .eq('year', year)
      .order('go_live_date', { ascending: true });

    // Build maps
    const settingsMap = new Map<string, AESettings>();
    const goLivesMap = new Map<string, GoLive[]>();

    (settingsData || []).forEach(s => {
      settingsMap.set(s.user_id, parseSettings(s));
    });

    userIds.forEach(uid => {
      goLivesMap.set(uid, []);
    });

    (goLivesData || []).forEach(gl => {
      const transformed: GoLive = {
        id: gl.id,
        user_id: gl.user_id,
        year: gl.year,
        month: gl.month,
        customer_name: gl.customer_name,
        oak_id: gl.oak_id ? Number(gl.oak_id) : null,
        go_live_date: gl.go_live_date,
        subs_monthly: Number(gl.subs_monthly) || 0,
        subs_arr: Number(gl.subs_arr) || (Number(gl.subs_monthly) || 0) * 12,
        has_terminal: gl.has_terminal || false,
        pay_arr: gl.pay_arr ? Number(gl.pay_arr) : null,
        commission_relevant: gl.commission_relevant ?? true,
        partner_id: gl.partner_id || null,
        is_enterprise: gl.is_enterprise || false,
        subscription_package_id: gl.subscription_package_id || null,
        notes: gl.notes,
        created_at: gl.created_at,
        updated_at: gl.updated_at
      };
      const existing = goLivesMap.get(gl.user_id) || [];
      goLivesMap.set(gl.user_id, [...existing, transformed]);
    });

    // Build combined settings (sum of targets from PLANNABLE users only)
    let combinedSettings: AESettings | null = null;
    
    // Filtere Settings auf plannable Users (wenn angegeben)
    const plannableSettings = Array.from(settingsMap.entries())
      .filter(([userId]) => settingsUserIds.includes(userId))
      .map(([, settings]) => settings);
    
    if (plannableSettings.length > 0) {
      const firstSettings = plannableSettings[0];
      
      combinedSettings = {
        ...firstSettings,
        id: 'combined',
        user_id: 'combined',
        ote: plannableSettings.reduce((sum, s) => sum + s.ote, 0),
        monthly_go_live_targets: firstSettings.monthly_go_live_targets.map((_, i) =>
          plannableSettings.reduce((sum, s) => sum + (s.monthly_go_live_targets?.[i] || 0), 0)
        ),
        monthly_subs_targets: firstSettings.monthly_subs_targets.map((_, i) =>
          plannableSettings.reduce((sum, s) => sum + (s.monthly_subs_targets?.[i] || 0), 0)
        ),
        monthly_pay_targets: firstSettings.monthly_pay_targets.map((_, i) =>
          plannableSettings.reduce((sum, s) => sum + (s.monthly_pay_targets?.[i] || 0), 0)
        ),
      };
    }

    // Combine all go-lives
    const allGoLives = Array.from(goLivesMap.values()).flat();

    setData({
      settings: settingsMap,
      goLives: goLivesMap,
      combined: { settings: combinedSettings, goLives: allGoLives }
    });
    setLoading(false);
  };

  return { ...data, loading, refetch };
}

// ============================================
// ROLE PERMISSIONS HOOK
// Lädt und speichert Berechtigungen aus der DB
// ============================================

export interface RolePermissionRecord {
  role: UserRole;
  view_all_users: boolean;
  enter_own_go_lives: boolean;
  enter_go_lives_for_others: boolean;
  enter_pay_arr: boolean;
  edit_settings: boolean;
  edit_tiers: boolean;
  manage_users: boolean;
  assign_roles: boolean;
  view_all_reports: boolean;
  export_reports: boolean;
  has_admin_access: boolean;
}

export function useRolePermissions() {
  const [permissions, setPermissions] = useState<Record<UserRole, RolePermissionRecord>>({
    country_manager: {
      role: 'country_manager',
      view_all_users: true,
      enter_own_go_lives: true,
      enter_go_lives_for_others: true,
      enter_pay_arr: true,
      edit_settings: true,
      edit_tiers: true,
      manage_users: true,
      assign_roles: true,
      view_all_reports: true,
      export_reports: true,
      has_admin_access: true,
    },
    line_manager: {
      role: 'line_manager',
      view_all_users: true,
      enter_own_go_lives: true,
      enter_go_lives_for_others: true,
      enter_pay_arr: true,
      edit_settings: true,
      edit_tiers: false,
      manage_users: false,
      assign_roles: false,
      view_all_reports: true,
      export_reports: false,
      has_admin_access: false,
    },
    ae: {
      role: 'ae',
      view_all_users: false,
      enter_own_go_lives: true,
      enter_go_lives_for_others: false,
      enter_pay_arr: false,
      edit_settings: false,
      edit_tiers: false,
      manage_users: false,
      assign_roles: false,
      view_all_reports: false,
      export_reports: true,
      has_admin_access: false,
    },
    sdr: {
      role: 'sdr',
      view_all_users: false,
      enter_own_go_lives: false,
      enter_go_lives_for_others: false,
      enter_pay_arr: false,
      edit_settings: false,
      edit_tiers: false,
      manage_users: false,
      assign_roles: false,
      view_all_reports: false,
      export_reports: false,
      has_admin_access: false,
    },
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Permissions aus DB laden
  const fetchPermissions = async () => {
    try {
      const { data, error: fetchError } = await supabase
        .from('role_permissions')
        .select('*');

      if (fetchError) {
        // Falls Tabelle nicht existiert, nutze Defaults
        console.warn('Permissions table not found, using defaults:', fetchError);
        setLoading(false);
        return;
      }

      if (data && data.length > 0) {
        const permMap: Record<UserRole, RolePermissionRecord> = { ...permissions };
        data.forEach((row: any) => {
          if (row.role && permMap[row.role as UserRole]) {
            permMap[row.role as UserRole] = {
              role: row.role,
              view_all_users: row.view_all_users ?? false,
              enter_own_go_lives: row.enter_own_go_lives ?? false,
              enter_go_lives_for_others: row.enter_go_lives_for_others ?? false,
              enter_pay_arr: row.enter_pay_arr ?? false,
              edit_settings: row.edit_settings ?? false,
              edit_tiers: row.edit_tiers ?? false,
              manage_users: row.manage_users ?? false,
              assign_roles: row.assign_roles ?? false,
              view_all_reports: row.view_all_reports ?? false,
              export_reports: row.export_reports ?? false,
              has_admin_access: row.has_admin_access ?? false,
            };
          }
        });
        setPermissions(permMap);
      }
    } catch (err) {
      console.error('Error fetching permissions:', err);
      setError('Fehler beim Laden der Berechtigungen');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPermissions();
  }, []);

  // Einzelne Permission updaten
  const updatePermission = async (
    role: UserRole, 
    permKey: keyof Omit<RolePermissionRecord, 'role'>, 
    value: boolean
  ) => {
    // Optimistisches Update
    setPermissions(prev => ({
      ...prev,
      [role]: {
        ...prev[role],
        [permKey]: value
      }
    }));

    // In DB speichern
    const { error: updateError } = await supabase
      .from('role_permissions')
      .update({ [permKey]: value })
      .eq('role', role);

    if (updateError) {
      console.error('Error updating permission:', updateError);
      // Rollback bei Fehler
      fetchPermissions();
      return { error: updateError };
    }

    return { error: null };
  };

  // Alle Permissions für eine Rolle updaten
  const updateRolePermissions = async (role: UserRole, newPerms: Partial<RolePermissionRecord>) => {
    // Optimistisches Update
    setPermissions(prev => ({
      ...prev,
      [role]: {
        ...prev[role],
        ...newPerms
      }
    }));

    // In DB speichern
    const { error: updateError } = await supabase
      .from('role_permissions')
      .update(newPerms)
      .eq('role', role);

    if (updateError) {
      console.error('Error updating role permissions:', updateError);
      fetchPermissions();
      return { error: updateError };
    }

    return { error: null };
  };

  return { 
    permissions, 
    loading, 
    error, 
    updatePermission, 
    updateRolePermissions,
    refetch: fetchPermissions 
  };
}

// ============================================
// CHALLENGES HOOK
// ============================================

import { Challenge, ChallengeProgress, GoLive } from './types';

export function useChallenges() {
  const [challenges, setChallenges] = useState<Challenge[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchChallenges = async () => {
    setLoading(true);
    try {
      const { data, error: fetchError } = await supabase
        .from('challenges')
        .select('*')
        .order('created_at', { ascending: false });

      if (fetchError) {
        // Tabelle existiert vielleicht noch nicht
        console.log('Challenges table may not exist yet:', fetchError);
        setChallenges([]);
      } else {
        setChallenges(data || []);
      }
    } catch (err) {
      console.error('Error fetching challenges:', err);
      setError('Fehler beim Laden der Challenges');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchChallenges();
  }, []);

  const createChallenge = async (challenge: Partial<Challenge>) => {
    const { data, error } = await supabase
      .from('challenges')
      .insert(challenge)
      .select()
      .single();

    if (!error && data) {
      setChallenges(prev => [data, ...prev]);
    }
    return { data, error };
  };

  const updateChallenge = async (id: string, updates: Partial<Challenge>) => {
    const { data, error } = await supabase
      .from('challenges')
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single();

    if (!error && data) {
      setChallenges(prev => prev.map(c => c.id === id ? data : c));
    }
    return { data, error };
  };

  const deleteChallenge = async (id: string) => {
    const { error } = await supabase
      .from('challenges')
      .delete()
      .eq('id', id);

    if (!error) {
      setChallenges(prev => prev.filter(c => c.id !== id));
    }
    return { error };
  };

  return { 
    challenges, 
    loading, 
    error, 
    createChallenge, 
    updateChallenge, 
    deleteChallenge,
    refetch: fetchChallenges 
  };
}

// Berechne Challenge-Fortschritt basierend auf Go-Lives
export function calculateChallengeProgress(
  challenge: Challenge,
  allGoLives: GoLive[],
  settingsMap?: Map<string, { monthly_subs_targets: number[], monthly_pay_targets: number[] }>
): ChallengeProgress {
  const startDate = new Date(challenge.start_date);
  const endDate = new Date(challenge.end_date);
  const today = new Date();
  
  // Filtere Go-Lives im Challenge-Zeitraum
  const relevantGoLives = allGoLives.filter(gl => {
    const glDate = new Date(gl.go_live_date);
    return glDate >= startDate && glDate <= endDate;
  });

  let current_value = 0;
  const user_progress = new Map<string, number>();

  switch (challenge.metric) {
    case 'go_lives':
      current_value = relevantGoLives.length;
      // Pro User aufschlüsseln
      relevantGoLives.forEach(gl => {
        const prev = user_progress.get(gl.user_id) || 0;
        user_progress.set(gl.user_id, prev + 1);
      });
      break;

    case 'subs_arr':
      current_value = relevantGoLives.reduce((sum, gl) => sum + gl.subs_arr, 0);
      relevantGoLives.forEach(gl => {
        const prev = user_progress.get(gl.user_id) || 0;
        user_progress.set(gl.user_id, prev + gl.subs_arr);
      });
      break;

    case 'pay_arr':
      current_value = relevantGoLives.reduce((sum, gl) => sum + (gl.pay_arr || 0), 0);
      relevantGoLives.forEach(gl => {
        const prev = user_progress.get(gl.user_id) || 0;
        user_progress.set(gl.user_id, prev + (gl.pay_arr || 0));
      });
      break;

    case 'total_arr':
      current_value = relevantGoLives.reduce((sum, gl) => sum + gl.subs_arr + (gl.pay_arr || 0), 0);
      relevantGoLives.forEach(gl => {
        const prev = user_progress.get(gl.user_id) || 0;
        user_progress.set(gl.user_id, prev + gl.subs_arr + (gl.pay_arr || 0));
      });
      break;

    case 'terminals':
      current_value = relevantGoLives.filter(gl => gl.has_terminal).length;
      relevantGoLives.filter(gl => gl.has_terminal).forEach(gl => {
        const prev = user_progress.get(gl.user_id) || 0;
        user_progress.set(gl.user_id, prev + 1);
      });
      break;

    case 'premium_go_lives':
      // Go-Lives mit >200€/Monat Subs
      const premiumGoLives = relevantGoLives.filter(gl => gl.subs_monthly > 200);
      current_value = premiumGoLives.length;
      premiumGoLives.forEach(gl => {
        const prev = user_progress.get(gl.user_id) || 0;
        user_progress.set(gl.user_id, prev + 1);
      });
      break;

    case 'achievement':
      // Durchschnittliche Zielerreichung - komplexer zu berechnen
      if (settingsMap && settingsMap.size > 0) {
        let totalAchievement = 0;
        let userCount = 0;
        
        settingsMap.forEach((settings, userId) => {
          const userGoLives = relevantGoLives.filter(gl => gl.user_id === userId);
          const userSubsArr = userGoLives.reduce((sum, gl) => sum + gl.subs_arr, 0);
          
          // Berechne Ziel für den Zeitraum (vereinfacht: anteiliger Monatsziel)
          const month = startDate.getMonth();
          const monthTarget = settings.monthly_subs_targets?.[month] || 0;
          
          if (monthTarget > 0) {
            const achievement = (userSubsArr / monthTarget) * 100;
            totalAchievement += achievement;
            userCount++;
            user_progress.set(userId, achievement);
          }
        });
        
        current_value = userCount > 0 ? totalAchievement / userCount : 0;
      }
      break;

    case 'daily_go_live':
      // Streak-Challenge: Mindestens X Go-Lives pro Tag
      const minPerDay = challenge.streak_min_per_day || 1;
      const streak_days: boolean[] = [];
      let current_streak = 0;
      let best_streak = 0;
      let temp_streak = 0;
      
      // Iteriere durch alle Tage im Challenge-Zeitraum
      const dayCount = Math.ceil((Math.min(endDate.getTime(), today.getTime()) - startDate.getTime()) / (1000 * 60 * 60 * 24)) + 1;
      
      for (let i = 0; i < dayCount; i++) {
        const dayStart = new Date(startDate);
        dayStart.setDate(dayStart.getDate() + i);
        dayStart.setHours(0, 0, 0, 0);
        
        const dayEnd = new Date(dayStart);
        dayEnd.setHours(23, 59, 59, 999);
        
        // Go-Lives an diesem Tag zählen
        const dayGoLives = relevantGoLives.filter(gl => {
          const glDate = new Date(gl.go_live_date);
          return glDate >= dayStart && glDate <= dayEnd;
        });
        
        const daySuccess = dayGoLives.length >= minPerDay;
        streak_days.push(daySuccess);
        
        if (daySuccess) {
          temp_streak++;
          best_streak = Math.max(best_streak, temp_streak);
        } else {
          temp_streak = 0;
        }
      }
      
      // Aktuelle Streak ist die letzte zusammenhängende Serie
      current_streak = 0;
      for (let i = streak_days.length - 1; i >= 0; i--) {
        if (streak_days[i]) {
          current_streak++;
        } else {
          break;
        }
      }
      
      current_value = best_streak;
      
      // User Progress: Beste Streak pro User
      const userStreaks = new Map<string, number>();
      relevantGoLives.forEach(gl => {
        const prev = userStreaks.get(gl.user_id) || 0;
        userStreaks.set(gl.user_id, prev + 1);
      });
      userStreaks.forEach((count, userId) => {
        user_progress.set(userId, count);
      });
      
      // Return mit Streak-spezifischen Daten
      const streak_days_remaining = Math.max(0, Math.ceil((endDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)));
      const streak_progress_percent = Math.min(100, (best_streak / challenge.target_value) * 100);
      
      return {
        challenge,
        current_value: best_streak,
        target_value: challenge.target_value,
        progress_percent: streak_progress_percent,
        days_remaining: streak_days_remaining,
        is_completed: best_streak >= challenge.target_value,
        user_progress,
        current_streak,
        best_streak,
        streak_days,
      };
  }

  const days_remaining = Math.max(0, Math.ceil((endDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)));
  const progress_percent = Math.min(100, (current_value / challenge.target_value) * 100);

  return {
    challenge,
    current_value,
    target_value: challenge.target_value,
    progress_percent,
    days_remaining,
    is_completed: current_value >= challenge.target_value,
    user_progress: challenge.type !== 'team' ? user_progress : user_progress,
  };
}

// Universal Go-Live Update - kann User wechseln ohne Hook-Abhängigkeit
export async function updateGoLiveUniversal(id: string, updates: Partial<GoLive>): Promise<{ error: any }> {
  const updateData: any = { updated_at: new Date().toISOString() };
  
  if (updates.user_id !== undefined) updateData.user_id = updates.user_id;
  if (updates.customer_name !== undefined) updateData.customer_name = updates.customer_name;
  if (updates.oak_id !== undefined) updateData.oak_id = updates.oak_id;
  if (updates.go_live_date !== undefined) updateData.go_live_date = updates.go_live_date;
  if (updates.subs_monthly !== undefined) {
    updateData.subs_monthly = updates.subs_monthly;
    updateData.subs_arr = updates.subs_monthly * 12;
  }
  if (updates.has_terminal !== undefined) updateData.has_terminal = updates.has_terminal;
  if (updates.pay_arr !== undefined) updateData.pay_arr = updates.pay_arr;
  if (updates.notes !== undefined) updateData.notes = updates.notes;
  if (updates.commission_relevant !== undefined) updateData.commission_relevant = updates.commission_relevant;
  // NEU: Partnership & Enterprise
  if (updates.partner_id !== undefined) updateData.partner_id = updates.partner_id;
  if (updates.is_enterprise !== undefined) updateData.is_enterprise = updates.is_enterprise;
  // NEU: Subscription Package
  if (updates.subscription_package_id !== undefined) updateData.subscription_package_id = updates.subscription_package_id;
  // NEU: Monat (bei Datumsänderung)
  if (updates.month !== undefined) updateData.month = updates.month;

  const { error } = await supabase
    .from('go_lives')
    .update(updateData)
    .eq('id', id);

  return { error };
}

// Universal Go-Live Delete
export async function deleteGoLiveUniversal(id: string): Promise<{ error: any }> {
  const { error } = await supabase
    .from('go_lives')
    .delete()
    .eq('id', id);

  return { error };
}

// ============================================
// BACKUP & RESTORE
// ============================================

export interface BackupData {
  version: string;
  created_at: string;
  app_version: string;
  tables: {
    users: any[];
    ae_settings: any[];
    go_lives: any[];
    challenges: any[];
    role_permissions: any[];
  };
  metadata: {
    user_count: number;
    settings_count: number;
    go_lives_count: number;
    challenges_count: number;
  };
}

export async function createBackup(): Promise<{ data: BackupData | null; error: string | null }> {
  try {
    // Alle Tabellen laden
    const [usersRes, settingsRes, goLivesRes, challengesRes, permissionsRes] = await Promise.all([
      supabase.from('users').select('*'),
      supabase.from('ae_settings').select('*'),
      supabase.from('go_lives').select('*'),
      supabase.from('challenges').select('*'),
      supabase.from('role_permissions').select('*'),
    ]);

    // Fehler prüfen
    if (usersRes.error) throw new Error(`Users: ${usersRes.error.message}`);
    if (settingsRes.error) throw new Error(`Settings: ${settingsRes.error.message}`);
    if (goLivesRes.error) throw new Error(`Go-Lives: ${goLivesRes.error.message}`);
    // Challenges & Permissions können leer sein
    
    const backup: BackupData = {
      version: '1.0',
      created_at: new Date().toISOString(),
      app_version: '3.13.1',
      tables: {
        users: usersRes.data || [],
        ae_settings: settingsRes.data || [],
        go_lives: goLivesRes.data || [],
        challenges: challengesRes.data || [],
        role_permissions: permissionsRes.data || [],
      },
      metadata: {
        user_count: usersRes.data?.length || 0,
        settings_count: settingsRes.data?.length || 0,
        go_lives_count: goLivesRes.data?.length || 0,
        challenges_count: challengesRes.data?.length || 0,
      },
    };

    return { data: backup, error: null };
  } catch (err: any) {
    return { data: null, error: err.message || 'Backup fehlgeschlagen' };
  }
}

export async function restoreBackup(backup: BackupData): Promise<{ success: boolean; error: string | null; details: string[] }> {
  const details: string[] = [];
  
  try {
    // Validierung
    if (!backup.version || !backup.tables) {
      return { success: false, error: 'Ungültiges Backup-Format', details: [] };
    }

    // 1. Challenges löschen und wiederherstellen (keine Abhängigkeiten)
    if (backup.tables.challenges && backup.tables.challenges.length > 0) {
      const { error: deleteChErr } = await supabase.from('challenges').delete().neq('id', '00000000-0000-0000-0000-000000000000');
      if (deleteChErr) details.push(`⚠️ Challenges löschen: ${deleteChErr.message}`);
      
      const { error: insertChErr } = await supabase.from('challenges').insert(backup.tables.challenges);
      if (insertChErr) {
        details.push(`⚠️ Challenges einfügen: ${insertChErr.message}`);
      } else {
        details.push(`✅ ${backup.tables.challenges.length} Challenges wiederhergestellt`);
      }
    }

    // 2. Go-Lives löschen und wiederherstellen
    if (backup.tables.go_lives && backup.tables.go_lives.length > 0) {
      const { error: deleteGLErr } = await supabase.from('go_lives').delete().neq('id', '00000000-0000-0000-0000-000000000000');
      if (deleteGLErr) details.push(`⚠️ Go-Lives löschen: ${deleteGLErr.message}`);
      
      const { error: insertGLErr } = await supabase.from('go_lives').insert(backup.tables.go_lives);
      if (insertGLErr) {
        details.push(`⚠️ Go-Lives einfügen: ${insertGLErr.message}`);
      } else {
        details.push(`✅ ${backup.tables.go_lives.length} Go-Lives wiederhergestellt`);
      }
    }

    // 3. AE Settings löschen und wiederherstellen
    if (backup.tables.ae_settings && backup.tables.ae_settings.length > 0) {
      const { error: deleteSetErr } = await supabase.from('ae_settings').delete().neq('id', '00000000-0000-0000-0000-000000000000');
      if (deleteSetErr) details.push(`⚠️ Settings löschen: ${deleteSetErr.message}`);
      
      const { error: insertSetErr } = await supabase.from('ae_settings').insert(backup.tables.ae_settings);
      if (insertSetErr) {
        details.push(`⚠️ Settings einfügen: ${insertSetErr.message}`);
      } else {
        details.push(`✅ ${backup.tables.ae_settings.length} Settings wiederhergestellt`);
      }
    }

    // 4. Role Permissions wiederherstellen (upsert)
    if (backup.tables.role_permissions && backup.tables.role_permissions.length > 0) {
      const { error: permErr } = await supabase.from('role_permissions').upsert(backup.tables.role_permissions, { onConflict: 'role' });
      if (permErr) {
        details.push(`⚠️ Permissions: ${permErr.message}`);
      } else {
        details.push(`✅ ${backup.tables.role_permissions.length} Permissions wiederhergestellt`);
      }
    }

    // 5. Users aktualisieren (nicht löschen! Nur Profildaten updaten)
    // WICHTIG: Wir löschen keine User, da das Auth-System damit verknüpft ist
    if (backup.tables.users && backup.tables.users.length > 0) {
      let updatedCount = 0;
      for (const user of backup.tables.users) {
        const { error: updateErr } = await supabase
          .from('users')
          .update({
            name: user.name,
            role: user.role,
            language: user.language,
            employee_id: user.employee_id,
            phone: user.phone,
            region: user.region,
            start_date: user.start_date,
            manager_id: user.manager_id,
          })
          .eq('id', user.id);
        
        if (!updateErr) updatedCount++;
      }
      details.push(`✅ ${updatedCount}/${backup.tables.users.length} User-Profile aktualisiert`);
    }

    return { success: true, error: null, details };
  } catch (err: any) {
    return { success: false, error: err.message || 'Restore fehlgeschlagen', details };
  }
}

// ============================================
// GOOGLE SHEETS INTEGRATION
// ============================================

export interface GoogleSheetUserData {
  name: string;
  inbound: number[];      // 12 Monatswerte
  outbound: number[];     // 12 Monatswerte
  partnerships: number[]; // 12 Monatswerte
  payArr: number[];       // 12 Monatswerte
}

export interface GoogleSheetParseResult {
  success: boolean;
  error?: string;
  totalDach?: GoogleSheetUserData;
  users: GoogleSheetUserData[];
}

/**
 * Parst CSV-Daten aus Google Sheet
 * 
 * Struktur des Sheets (analysiert aus echten Daten):
 * 
 * Zeile für User-Header: "","Slavo","Slavo","","","100","100",...
 *   - Spalte 1+2: User-Name (identisch)
 * 
 * Zeile für Daten: "","","Inbound GoLive","","210","25","25","25","18",...
 *   - Spalte 2: Kategorie-Name
 *   - Spalte 4: Jahres-Total
 *   - Spalten 5-16: Monatswerte (Jan-Dez)
 * 
 * Kategorien die wir brauchen:
 * - "Partnerships & Enterprises GoLive" → partnerships
 * - "Inbound GoLive" → inbound  
 * - "Outbound GoLive" → outbound
 * - "Pay ARR incl Tipping" → payArr
 */
export function parseGoogleSheetCsv(csvText: string): GoogleSheetParseResult {
  try {
    // Einfaches CSV Parsing mit Regex für quoted values
    const parseCSVLine = (line: string): string[] => {
      const result: string[] = [];
      let current = '';
      let inQuotes = false;
      
      for (let i = 0; i < line.length; i++) {
        const char = line[i];
        if (char === '"') {
          inQuotes = !inQuotes;
        } else if (char === ',' && !inQuotes) {
          result.push(current);
          current = '';
        } else {
          current += char;
        }
      }
      result.push(current);
      return result;
    };
    
    const lines = csvText.split('\n').filter(line => line.trim());
    
    if (lines.length < 2) {
      return { success: false, error: 'Leere oder ungültige CSV-Daten', users: [] };
    }
    
    const userMap = new Map<string, GoogleSheetUserData>();
    let currentUserName = '';
    
    for (const line of lines) {
      const values = parseCSVLine(line);
      
      if (values.length < 17) {
        continue;
      }
      
      const col1 = values[1]?.trim() || '';
      const col2 = values[2]?.trim() || '';
      
      // Erkennung einer User-Header-Zeile: col1 und col2 sind identisch und nicht leer
      // z.B. "Slavo","Slavo" oder "Total DACH","Total DACH"
      if (col1 && col1 === col2 && !col1.includes('€') && col1 !== 'Month') {
        currentUserName = col1;
        
        if (!userMap.has(currentUserName)) {
          userMap.set(currentUserName, {
            name: currentUserName,
            inbound: new Array(12).fill(0),
            outbound: new Array(12).fill(0),
            partnerships: new Array(12).fill(0),
            payArr: new Array(12).fill(0)
          });
        }
        continue;
      }
      
      // Datenzeile verarbeiten
      if (!currentUserName) continue;
      
      const userData = userMap.get(currentUserName);
      if (!userData) continue;
      
      const category = col2.toLowerCase();
      
      // Monatswerte extrahieren (Spalten 5-16, also Index 5 bis 16)
      const extractMonthValues = (): number[] => {
        const vals: number[] = [];
        for (let i = 5; i <= 16; i++) {
          const raw = values[i] || '0';
          // Entferne € Symbol, Punkte als Tausendertrennzeichen, ersetze Komma durch Punkt
          const cleaned = raw.replace(/€/g, '').replace(/\s/g, '').replace(/\./g, '').replace(',', '.');
          const num = parseFloat(cleaned) || 0;
          vals.push(Math.round(num));
        }
        return vals;
      };
      
      // Kategorien matchen
      if (category === 'inbound golive' || category.includes('inbound golive')) {
        userData.inbound = extractMonthValues();
      } else if (category === 'outbound golive' || category.includes('outbound golive')) {
        userData.outbound = extractMonthValues();
      } else if (category.includes('partnerships') && category.includes('golive')) {
        userData.partnerships = extractMonthValues();
      } else if (category.includes('pay arr')) {
        userData.payArr = extractMonthValues();
      }
    }
    
    // Ergebnisse aufbereiten
    const totalDach = userMap.get('Total DACH');
    userMap.delete('Total DACH');
    
    const users = Array.from(userMap.values());
    
    // Debug-Output
    console.log('=== Google Sheet Parser Debug ===');
    console.log('Total users found:', users.length);
    users.forEach(u => {
      console.log(`User: ${u.name}`);
      console.log(`  Inbound: ${u.inbound.join(', ')} = ${u.inbound.reduce((a,b) => a+b, 0)}`);
      console.log(`  Outbound: ${u.outbound.join(', ')} = ${u.outbound.reduce((a,b) => a+b, 0)}`);
      console.log(`  Partnerships: ${u.partnerships.join(', ')} = ${u.partnerships.reduce((a,b) => a+b, 0)}`);
      console.log(`  Pay ARR: ${u.payArr.reduce((a,b) => a+b, 0)}`);
    });
    if (totalDach) {
      console.log('Total DACH found with', totalDach.inbound.reduce((a,b) => a+b, 0), 'inbound');
    }
    console.log('=================================');
    
    return {
      success: true,
      totalDach,
      users
    };
  } catch (err: any) {
    console.error('CSV Parse error:', err);
    return { success: false, error: err.message || 'Fehler beim Parsen der CSV-Daten', users: [] };
  }
}

/**
 * Fetch Google Sheet als CSV
 */
export async function fetchGoogleSheetCsv(sheetUrl: string): Promise<{ data: string | null; error: string | null }> {
  try {
    const csvUrl = googleSheetToCsvUrl(sheetUrl);
    if (!csvUrl) {
      return { data: null, error: 'Ungültige Google Sheet URL' };
    }
    
    const response = await fetch(csvUrl);
    
    if (!response.ok) {
      return { data: null, error: `HTTP ${response.status}: ${response.statusText}` };
    }
    
    const csvText = await response.text();
    return { data: csvText, error: null };
  } catch (err: any) {
    return { data: null, error: err.message || 'Netzwerkfehler beim Abrufen des Sheets' };
  }
}

/**
 * Synchronisiert Settings mit Google Sheet Daten
 * Matched User anhand Vorname (z.B. "Slavo" → "Slavo Ristanovic")
 */
export async function syncSettingsFromGoogleSheet(
  sheetUrl: string,
  allUsers: User[],
  currentSettings: Map<string, AESettings>,
  updateSettingsFn: (userId: string, updates: Partial<AESettings>) => Promise<{ error: any }>
): Promise<{ 
  success: boolean; 
  error?: string; 
  synced: string[]; 
  notFound: string[];
  totalDachData?: GoogleSheetUserData;
}> {
  // 1. Fetch CSV
  const { data: csvText, error: fetchError } = await fetchGoogleSheetCsv(sheetUrl);
  if (fetchError || !csvText) {
    return { success: false, error: fetchError || 'Keine Daten erhalten', synced: [], notFound: [] };
  }
  
  // 2. Parse CSV
  const parseResult = parseGoogleSheetCsv(csvText);
  if (!parseResult.success) {
    return { success: false, error: parseResult.error, synced: [], notFound: [] };
  }
  
  // 3. Match users and update settings
  const synced: string[] = [];
  const notFound: string[] = [];
  
  for (const sheetUser of parseResult.users) {
    // Match by first name (case insensitive)
    const firstName = sheetUser.name.toLowerCase();
    const matchedUser = allUsers.find(u => 
      u.name.toLowerCase().startsWith(firstName) ||
      u.name.toLowerCase().split(' ')[0] === firstName
    );
    
    if (!matchedUser) {
      notFound.push(sheetUser.name);
      continue;
    }
    
    // Calculate total Go-Lives from categories
    const goLiveTargets = calculateTotalGoLives(
      sheetUser.inbound,
      sheetUser.outbound,
      sheetUser.partnerships
    );
    
    // Build updates
    const updates: Partial<AESettings> = {
      monthly_inbound_targets: sheetUser.inbound,
      monthly_outbound_targets: sheetUser.outbound,
      monthly_partnerships_targets: sheetUser.partnerships,
      monthly_go_live_targets: goLiveTargets,
      monthly_pay_arr_targets: sheetUser.payArr,
      use_google_sheet: true,
      google_sheet_url: sheetUrl,
      last_sheet_sync: new Date().toISOString()
    };
    
    // Update settings
    const { error } = await updateSettingsFn(matchedUser.id, updates);
    if (error) {
      console.error(`Error updating settings for ${matchedUser.name}:`, error);
    } else {
      synced.push(matchedUser.name);
    }
  }
  
  return { 
    success: true, 
    synced, 
    notFound,
    totalDachData: parseResult.totalDach
  };
}

export function downloadBackup(backup: BackupData) {
  const json = JSON.stringify(backup, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  
  const date = new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-');
  const filename = `backup_ae-comp_${date}.json`;
  
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
