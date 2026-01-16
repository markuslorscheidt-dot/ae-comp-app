// ============================================================================
// SALES PIPELINE HOOKS
// Version: 1.0
// ============================================================================

'use client';

import { useState, useEffect, useCallback } from 'react';
import { supabase } from './supabase';
import {
  Lead,
  Opportunity,
  OpportunityStage,
  OpportunityStageHistory,
  PipelineSettings,
  Competitor,
  LostReason,
  Notification,
  NotificationSettings,
  LeadSource,
  LeadStatus,
  calculateExpectedCloseDate,
  getDefaultProbability,
} from './pipeline-types';

// ============================================================================
// COMPETITORS HOOK
// ============================================================================

export function useCompetitors() {
  const [competitors, setCompetitors] = useState<Competitor[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchCompetitors = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error: fetchError } = await supabase
        .from('competitors')
        .select('*')
        .eq('is_active', true)
        .order('display_order');

      if (fetchError) throw fetchError;
      setCompetitors(data || []);
    } catch (err: any) {
      console.error('Error fetching competitors:', err);
      setError(err.message);
      setCompetitors([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchCompetitors();
  }, [fetchCompetitors]);

  const createCompetitor = async (name: string, website?: string) => {
    const maxOrder = Math.max(...competitors.map(c => c.display_order), 0);
    const { data, error } = await supabase
      .from('competitors')
      .insert({ name, website, display_order: maxOrder + 1 })
      .select()
      .single();

    if (!error && data) {
      setCompetitors(prev => [...prev, data].sort((a, b) => a.display_order - b.display_order));
    }
    return { data, error };
  };

  return { competitors, loading, error, refetch: fetchCompetitors, createCompetitor };
}

// ============================================================================
// LOST REASONS HOOK
// ============================================================================

export function useLostReasons() {
  const [lostReasons, setLostReasons] = useState<LostReason[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchLostReasons = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error: fetchError } = await supabase
        .from('lost_reasons')
        .select('*')
        .eq('is_active', true)
        .order('display_order');

      if (fetchError) throw fetchError;
      setLostReasons(data || []);
    } catch (err: any) {
      console.error('Error fetching lost reasons:', err);
      setError(err.message);
      setLostReasons([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchLostReasons();
  }, [fetchLostReasons]);

  const createLostReason = async (reason: string, category: string = 'general') => {
    const maxOrder = Math.max(...lostReasons.map(r => r.display_order), 0);
    const { data, error } = await supabase
      .from('lost_reasons')
      .insert({ reason, category, display_order: maxOrder + 1 })
      .select()
      .single();

    if (!error && data) {
      setLostReasons(prev => [...prev, data].sort((a, b) => a.display_order - b.display_order));
    }
    return { data, error };
  };

  return { lostReasons, loading, error, refetch: fetchLostReasons, createLostReason };
}

// ============================================================================
// PIPELINE SETTINGS HOOK
// ============================================================================

export function usePipelineSettings(userId?: string) {
  const [settings, setSettings] = useState<PipelineSettings | null>(null);
  const [globalSettings, setGlobalSettings] = useState<PipelineSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchSettings = useCallback(async () => {
    setLoading(true);
    try {
      // Globale Settings laden (maybeSingle - kann 0 oder 1 Ergebnis sein)
      const { data: globalData, error: globalError } = await supabase
        .from('pipeline_settings')
        .select('*')
        .is('user_id', null)
        .maybeSingle();

      if (globalError) throw globalError;
      setGlobalSettings(globalData);

      // User-spezifische Settings laden (falls userId)
      if (userId) {
        const { data: userData, error: userError } = await supabase
          .from('pipeline_settings')
          .select('*')
          .eq('user_id', userId)
          .maybeSingle();

        if (userError) throw userError;
        setSettings(userData || globalData);
      } else {
        setSettings(globalData);
      }
    } catch (err: any) {
      console.error('Error fetching pipeline settings:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  const updateSettings = async (updates: Partial<PipelineSettings>) => {
    if (!settings) return { error: new Error('No settings loaded') };

    const { data, error } = await supabase
      .from('pipeline_settings')
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq('id', settings.id)
      .select()
      .single();

    if (!error && data) {
      setSettings(data);
    }
    return { data, error };
  };

  // Effektive Settings (User oder Global)
  const effectiveSettings = settings || globalSettings;

  return { 
    settings: effectiveSettings, 
    globalSettings, 
    userSettings: settings, 
    loading, 
    error, 
    refetch: fetchSettings, 
    updateSettings 
  };
}

// ============================================================================
// LEADS HOOK
// ============================================================================

export function useLeads(userId?: string, showArchived: boolean = false) {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchLeads = useCallback(async () => {
    setLoading(true);
    try {
      let query = supabase
        .from('leads')
        .select(`
          *,
          competitor:competitors(id, name),
          opportunities(id)
        `)
        .order('created_at', { ascending: false });

      if (userId) {
        query = query.eq('user_id', userId);
      }

      // Archivierte Leads filtern (wenn showArchived false ist)
      if (!showArchived) {
        query = query.or('archived.is.null,archived.eq.false');
      }

      const { data, error: fetchError } = await query;

      if (fetchError) throw fetchError;
      
      // Opportunities count hinzufügen
      const leadsWithCount = (data || []).map(lead => ({
        ...lead,
        opportunities_count: lead.opportunities?.length || 0,
      }));
      
      setLeads(leadsWithCount);
    } catch (err: any) {
      console.error('Error fetching leads:', err);
      setError(err.message);
      setLeads([]);
    } finally {
      setLoading(false);
    }
  }, [userId, showArchived]);

  useEffect(() => {
    fetchLeads();
  }, [fetchLeads]);

  const createLead = async (lead: Partial<Lead>) => {
    const { data, error } = await supabase
      .from('leads')
      .insert(lead)
      .select(`
        *,
        competitor:competitors(id, name)
      `)
      .single();

    if (!error && data) {
      setLeads(prev => [{ ...data, opportunities_count: 0 }, ...prev]);
    }
    return { data, error };
  };

  const updateLead = async (id: string, updates: Partial<Lead>) => {
    const { data, error } = await supabase
      .from('leads')
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select(`
        *,
        competitor:competitors(id, name)
      `)
      .single();

    if (!error && data) {
      setLeads(prev => prev.map(l => l.id === id ? { ...data, opportunities_count: l.opportunities_count } : l));
    }
    return { data, error };
  };

  const deleteLead = async (id: string) => {
    const { error } = await supabase
      .from('leads')
      .delete()
      .eq('id', id);

    if (!error) {
      setLeads(prev => prev.filter(l => l.id !== id));
    }
    return { error };
  };

  // Archivieren statt Löschen (Soft Delete)
  const archiveLead = async (id: string) => {
    const { data, error } = await supabase
      .from('leads')
      .update({ 
        archived: true, 
        archived_at: new Date().toISOString(),
        updated_at: new Date().toISOString() 
      })
      .eq('id', id)
      .select(`
        *,
        competitor:competitors(id, name)
      `)
      .single();

    if (!error && data) {
      setLeads(prev => prev.map(l => l.id === id ? { ...data, opportunities_count: l.opportunities_count } : l));
    }
    return { data, error };
  };

  // Wiederherstellen aus Archiv
  const restoreLead = async (id: string) => {
    const { data, error } = await supabase
      .from('leads')
      .update({ 
        archived: false, 
        archived_at: null,
        updated_at: new Date().toISOString() 
      })
      .eq('id', id)
      .select(`
        *,
        competitor:competitors(id, name)
      `)
      .single();

    if (!error && data) {
      setLeads(prev => prev.map(l => l.id === id ? { ...data, opportunities_count: l.opportunities_count } : l));
    }
    return { data, error };
  };

  return { leads, loading, error, refetch: fetchLeads, createLead, updateLead, deleteLead, archiveLead, restoreLead };
}

// ============================================================================
// OPPORTUNITIES HOOK
// ============================================================================

export function useOpportunities(userId?: string, leadId?: string, includeArchived: boolean = false) {
  const [opportunities, setOpportunities] = useState<Opportunity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchOpportunities = useCallback(async () => {
    setLoading(true);
    try {
      let query = supabase
        .from('opportunities')
        .select(`
          *,
          lead:leads(id, company_name, contact_name, lead_source),
          lost_reason:lost_reasons(id, reason, category),
          assigned_user:users!opportunities_user_id_fkey(id, name)
        `)
        .order('created_at', { ascending: false });
      
      // Filter nach archived Status
      if (!includeArchived) {
        query = query.eq('archived', false);
      }

      if (userId) {
        query = query.eq('user_id', userId);
      }
      
      if (leadId) {
        query = query.eq('lead_id', leadId);
      }

      const { data, error: fetchError } = await query;

      if (fetchError) throw fetchError;
      setOpportunities(data || []);
    } catch (err: any) {
      console.error('Error fetching opportunities:', err);
      setError(err.message);
      setOpportunities([]);
    } finally {
      setLoading(false);
    }
  }, [userId, leadId, includeArchived]);

  useEffect(() => {
    fetchOpportunities();
  }, [fetchOpportunities]);

  const createOpportunity = async (
    opportunity: Partial<Opportunity>,
    settings?: PipelineSettings
  ) => {
    // Expected close date berechnen falls nicht gesetzt
    const stage = (opportunity.stage || 'sql') as OpportunityStage;
    const expectedCloseDate = opportunity.expected_close_date || 
      calculateExpectedCloseDate(stage, settings || undefined).toISOString().split('T')[0];

    const { data, error } = await supabase
      .from('opportunities')
      .insert({
        ...opportunity,
        expected_close_date: expectedCloseDate,
      })
      .select(`
        *,
        lead:leads(id, company_name, contact_name, lead_source),
        lost_reason:lost_reasons(id, reason, category)
      `)
      .single();

    if (!error && data) {
      setOpportunities(prev => [data, ...prev]);
      
      // Stage History eintragen
      await supabase.from('opportunity_stage_history').insert({
        opportunity_id: data.id,
        from_stage: null,
        to_stage: data.stage,
        changed_by: opportunity.user_id,
        probability_at_change: getDefaultProbability(stage, settings || undefined),
        expected_arr_at_change: (opportunity.expected_subs_monthly || 0) * 12,
      });
    }
    return { data, error };
  };

  const updateOpportunity = async (id: string, updates: Partial<Opportunity>) => {
    const { data, error } = await supabase
      .from('opportunities')
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select(`
        *,
        lead:leads(id, company_name, contact_name, lead_source),
        lost_reason:lost_reasons(id, reason, category)
      `)
      .single();

    if (!error && data) {
      setOpportunities(prev => prev.map(o => o.id === id ? data : o));
    }
    return { data, error };
  };

  const changeStage = async (
    id: string,
    newStage: OpportunityStage,
    userId: string,
    settings?: PipelineSettings,
    lostReasonId?: string,
    lostReasonNotes?: string
  ) => {
    const opportunity = opportunities.find(o => o.id === id);
    if (!opportunity) return { error: new Error('Opportunity not found') };

    const updates: Partial<Opportunity> = {
      stage: newStage,
      stage_changed_at: new Date().toISOString(),
    };

    // Bei Close Lost: Lost Reason setzen
    if (newStage === 'close_lost') {
      updates.lost_reason_id = lostReasonId || null;
      updates.lost_reason_notes = lostReasonNotes || null;
    }

    // Stage-spezifische Datumsfelder setzen
    const today = new Date().toISOString().split('T')[0];
    if (newStage === 'demo_booked' && !opportunity.demo_booked_date) {
      updates.demo_booked_date = today;
    } else if (newStage === 'demo_completed' && !opportunity.demo_completed_date) {
      updates.demo_completed_date = today;
    } else if (newStage === 'sent_quote' && !opportunity.quote_sent_date) {
      updates.quote_sent_date = today;
    }

    // Expected close date neu berechnen
    if (newStage !== 'close_won' && newStage !== 'close_lost') {
      updates.expected_close_date = calculateExpectedCloseDate(newStage, settings || undefined)
        .toISOString().split('T')[0];
    }

    const { data, error } = await updateOpportunity(id, updates);

    if (!error && data) {
      // Stage History eintragen
      await supabase.from('opportunity_stage_history').insert({
        opportunity_id: id,
        from_stage: opportunity.stage,
        to_stage: newStage,
        changed_by: userId,
        probability_at_change: getDefaultProbability(newStage, settings || undefined),
        expected_arr_at_change: opportunity.expected_subs_monthly * 12,
      });
    }

    return { data, error };
  };

  // Opportunity archivieren (Soft Delete)
  const archiveOpportunity = async (id: string) => {
    const { error } = await supabase
      .from('opportunities')
      .update({ 
        archived: true, 
        archived_at: new Date().toISOString() 
      })
      .eq('id', id);

    if (!error) {
      // Aus der aktiven Liste entfernen
      setOpportunities(prev => prev.filter(o => o.id !== id));
    }
    return { error };
  };

  // Opportunity wiederherstellen
  const restoreOpportunity = async (id: string) => {
    const { data, error } = await supabase
      .from('opportunities')
      .update({ 
        archived: false, 
        archived_at: null 
      })
      .eq('id', id)
      .select()
      .single();

    if (!error && data) {
      // Zur aktiven Liste hinzufügen
      setOpportunities(prev => [...prev, data]);
    }
    return { data, error };
  };

  return { 
    opportunities, 
    loading, 
    error, 
    refetch: fetchOpportunities, 
    createOpportunity, 
    updateOpportunity, 
    changeStage,
    archiveOpportunity,
    restoreOpportunity 
  };
}

// ============================================================================
// OPPORTUNITY STAGE HISTORY HOOK
// ============================================================================

export function useOpportunityHistory(opportunityId: string) {
  const [history, setHistory] = useState<OpportunityStageHistory[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchHistory = async () => {
      setLoading(true);
      const { data, error } = await supabase
        .from('opportunity_stage_history')
        .select('*')
        .eq('opportunity_id', opportunityId)
        .order('changed_at', { ascending: false });

      if (!error) {
        setHistory(data || []);
      }
      setLoading(false);
    };

    if (opportunityId) {
      fetchHistory();
    }
  }, [opportunityId]);

  return { history, loading };
}

// ============================================================================
// NOTIFICATIONS HOOK
// ============================================================================

export function useNotifications(userId: string) {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);

  const fetchNotifications = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('notifications')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(50);

    if (!error) {
      setNotifications(data || []);
      setUnreadCount((data || []).filter(n => !n.is_read).length);
    }
    setLoading(false);
  }, [userId]);

  useEffect(() => {
    if (userId) {
      fetchNotifications();
    }
  }, [userId, fetchNotifications]);

  const markAsRead = async (id: string) => {
    const { error } = await supabase
      .from('notifications')
      .update({ is_read: true, read_at: new Date().toISOString() })
      .eq('id', id);

    if (!error) {
      setNotifications(prev => prev.map(n => 
        n.id === id ? { ...n, is_read: true, read_at: new Date().toISOString() } : n
      ));
      setUnreadCount(prev => Math.max(0, prev - 1));
    }
    return { error };
  };

  const markAllAsRead = async () => {
    const { error } = await supabase
      .from('notifications')
      .update({ is_read: true, read_at: new Date().toISOString() })
      .eq('user_id', userId)
      .eq('is_read', false);

    if (!error) {
      setNotifications(prev => prev.map(n => ({ ...n, is_read: true, read_at: new Date().toISOString() })));
      setUnreadCount(0);
    }
    return { error };
  };

  const deleteNotification = async (id: string) => {
    const notification = notifications.find(n => n.id === id);
    const { error } = await supabase
      .from('notifications')
      .delete()
      .eq('id', id);

    if (!error) {
      setNotifications(prev => prev.filter(n => n.id !== id));
      if (notification && !notification.is_read) {
        setUnreadCount(prev => Math.max(0, prev - 1));
      }
    }
    return { error };
  };

  return { 
    notifications, 
    unreadCount, 
    loading, 
    refetch: fetchNotifications, 
    markAsRead, 
    markAllAsRead,
    deleteNotification 
  };
}

// ============================================================================
// NOTIFICATION SETTINGS HOOK
// ============================================================================

export function useNotificationSettings(userId: string) {
  const [settings, setSettings] = useState<NotificationSettings | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchSettings = async () => {
      setLoading(true);
      const { data, error } = await supabase
        .from('notification_settings')
        .select('*')
        .eq('user_id', userId)
        .single();

      if (error && error.code === 'PGRST116') {
        // Keine Settings vorhanden, erstellen
        const { data: newData } = await supabase
          .from('notification_settings')
          .insert({ user_id: userId })
          .select()
          .single();
        setSettings(newData);
      } else if (!error) {
        setSettings(data);
      }
      setLoading(false);
    };

    if (userId) {
      fetchSettings();
    }
  }, [userId]);

  const updateSettings = async (updates: Partial<NotificationSettings>) => {
    if (!settings) return { error: new Error('No settings loaded') };

    const { data, error } = await supabase
      .from('notification_settings')
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq('id', settings.id)
      .select()
      .single();

    if (!error && data) {
      setSettings(data);
    }
    return { data, error };
  };

  return { settings, loading, updateSettings };
}

// ============================================================================
// PIPELINE STATS HOOK (für Dashboard)
// ============================================================================

export interface PipelineStats {
  totalLeads: number;
  activeOpportunities: number;
  totalPipelineValue: number;
  weightedPipelineValue: number;
  opportunitiesByStage: Record<OpportunityStage, { count: number; value: number }>;
  overdueDeals: number;
  stuckDeals: number;
}

export function usePipelineStats(userId?: string) {
  const [stats, setStats] = useState<PipelineStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchStats = async () => {
      setLoading(true);
      
      try {
        // Leads zählen
        let leadsQuery = supabase.from('leads').select('id', { count: 'exact' });
        if (userId) leadsQuery = leadsQuery.eq('user_id', userId);
        const { count: totalLeads } = await leadsQuery;

        // Opportunities laden
        let oppsQuery = supabase.from('opportunities').select('*');
        if (userId) oppsQuery = oppsQuery.eq('user_id', userId);
        const { data: opportunities } = await oppsQuery;

        if (opportunities) {
          const activeOpps = opportunities.filter(o => 
            !['close_won', 'close_lost'].includes(o.stage)
          );

          // Stats berechnen
          const opportunitiesByStage: Record<string, { count: number; value: number }> = {};
          let totalValue = 0;
          let weightedValue = 0;
          let overdueCount = 0;
          let stuckCount = 0;

          const now = new Date();
          const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

          for (const opp of activeOpps) {
            const arr = opp.expected_subs_monthly * 12 + opp.expected_pay_monthly * 12;
            const prob = opp.probability ?? getDefaultProbability(opp.stage as OpportunityStage, undefined);

            totalValue += arr;
            weightedValue += arr * prob;

            if (!opportunitiesByStage[opp.stage]) {
              opportunitiesByStage[opp.stage] = { count: 0, value: 0 };
            }
            opportunitiesByStage[opp.stage].count++;
            opportunitiesByStage[opp.stage].value += arr;

            // Overdue check
            if (opp.expected_close_date && new Date(opp.expected_close_date) < now) {
              overdueCount++;
            }

            // Stuck check
            if (new Date(opp.stage_changed_at) < sevenDaysAgo) {
              stuckCount++;
            }
          }

          setStats({
            totalLeads: totalLeads || 0,
            activeOpportunities: activeOpps.length,
            totalPipelineValue: totalValue,
            weightedPipelineValue: weightedValue,
            opportunitiesByStage: opportunitiesByStage as Record<OpportunityStage, { count: number; value: number }>,
            overdueDeals: overdueCount,
            stuckDeals: stuckCount,
          });
        }
      } catch (err) {
        console.error('Error fetching pipeline stats:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchStats();
  }, [userId]);

  return { stats, loading };
}
