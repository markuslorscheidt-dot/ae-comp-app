'use client';

import { useState } from 'react';
import { User, GoLive } from '@/lib/types';
import { useLanguage } from '@/lib/LanguageContext';
import { useSettingsForUser, useGoLivesForUser } from '@/lib/hooks';
import { getPermissions } from '@/lib/permissions';
import { 
  useLeads, 
  useOpportunities, 
  usePipelineSettings, 
  useCompetitors,
  useLostReasons,
  usePipelineStats,
  useNotifications,
} from '@/lib/pipeline-hooks';
import {
  Opportunity,
  Lead,
  OpportunityStage,
  OpportunityStageHistory,
  OPPORTUNITY_STAGES,
  LEAD_SOURCES,
  ACTIVE_PIPELINE_STAGES,
  calculateARR,
  calculateWeightedValue,
  getDefaultProbability,
  isOverdue,
  isStuck,
  formatDate,
  daysUntil,
} from '@/lib/pipeline-types';
import { formatCurrency } from '@/lib/calculations';
import { supabase } from '@/lib/supabase';
import LeadForm from './LeadForm';
import OpportunityForm from './OpportunityForm';
import StageChangeDialog from './StageChangeDialog';
import PipelineAnalytics from './PipelineAnalytics';
import CSVImport from './CSVImport';
import CreateGoLiveDialog from './CreateGoLiveDialog';
import NotificationsPanel, { NotificationBadge } from './NotificationsPanel';
import SalesforceImport from './SalesforceImport';
import DebugPanel from './DebugPanel';

interface PipelineProps {
  user: User;
  allUsers: User[];
}

type PipelineView = 'pipeline' | 'analytics';
type ViewMode = 'leads' | 'opportunities';

export default function Pipeline({ user, allUsers }: PipelineProps) {
  const { t } = useLanguage();
  const permissions = getPermissions(user.role);
  const [view, setView] = useState<PipelineView>('pipeline');
  const [viewMode, setViewMode] = useState<ViewMode>('leads');
  const [stageFilter, setStageFilter] = useState<OpportunityStage | 'all'>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  
  // Datumsfilter für Pipeline-Ansicht
  const [pipelineDateFromInput, setPipelineDateFromInput] = useState('');
  const [pipelineDateToInput, setPipelineDateToInput] = useState('');
  const [pipelineDateFrom, setPipelineDateFrom] = useState('');
  const [pipelineDateTo, setPipelineDateTo] = useState('');
  
  // Forms & Dialogs
  const [showLeadForm, setShowLeadForm] = useState(false);
  const [showOpportunityForm, setShowOpportunityForm] = useState(false);
  const [showCSVImport, setShowCSVImport] = useState(false);
  const [showSalesforceImport, setShowSalesforceImport] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const [showGoLiveDialog, setShowGoLiveDialog] = useState(false);
  const [editingLead, setEditingLead] = useState<Lead | null>(null);
  const [editingOpportunity, setEditingOpportunity] = useState<Opportunity | null>(null);
  const [selectedLeadForOpp, setSelectedLeadForOpp] = useState<Lead | null>(null);
  const [stageChangeOpp, setStageChangeOpp] = useState<Opportunity | null>(null);
  const [wonOpportunity, setWonOpportunity] = useState<{ opp: Opportunity; lead: Lead } | null>(null);
  
  // Expanded leads (für Accordion)
  const [expandedLeads, setExpandedLeads] = useState<Set<string>>(new Set());

  // Stage History für Analytics
  const [stageHistory, setStageHistory] = useState<OpportunityStageHistory[]>([]);

  // Hooks
  const { settings } = usePipelineSettings(user.id);
  const { leads, loading: leadsLoading, createLead, updateLead, deleteLead, archiveLead, restoreLead, refetch: refetchLeads } = useLeads(undefined, showArchived);
  const { opportunities, loading: oppsLoading, createOpportunity, updateOpportunity, changeStage, archiveOpportunity, restoreOpportunity, refetch: refetchOpps } = useOpportunities(undefined, undefined, showArchived);
  const { competitors } = useCompetitors();
  const { lostReasons } = useLostReasons();
  const { stats } = usePipelineStats(user.id);

  const loading = leadsLoading || oppsLoading;

  // Toggle Lead Expansion
  const toggleLeadExpansion = (leadId: string) => {
    setExpandedLeads(prev => {
      const newSet = new Set(prev);
      if (newSet.has(leadId)) {
        newSet.delete(leadId);
      } else {
        newSet.add(leadId);
      }
      return newSet;
    });
  };

  // Datumsfilter anwenden/zurücksetzen
  const applyPipelineDateFilter = () => {
    setPipelineDateFrom(pipelineDateFromInput);
    setPipelineDateTo(pipelineDateToInput);
  };
  
  const resetPipelineDateFilter = () => {
    setPipelineDateFromInput('');
    setPipelineDateToInput('');
    setPipelineDateFrom('');
    setPipelineDateTo('');
  };

  // Opportunities nach Datum filtern
  const dateFilteredOpportunities = opportunities.filter(opp => {
    if (!pipelineDateFrom && !pipelineDateTo) return true;
    
    const fromDate = pipelineDateFrom ? new Date(pipelineDateFrom) : null;
    const toDate = pipelineDateTo ? new Date(pipelineDateTo + 'T23:59:59') : null;
    
    // Für Close Won/Lost: expected_close_date (tatsächliches Abschlussdatum), für aktive: created_at
    const isClosedStage = opp.stage === 'close_won' || opp.stage === 'close_lost';
    
    let relevantDate: Date;
    if (isClosedStage && opp.expected_close_date) {
      relevantDate = new Date(opp.expected_close_date);
    } else {
      relevantDate = new Date(opp.created_at);
    }
    
    if (fromDate && relevantDate < fromDate) return false;
    if (toDate && relevantDate > toDate) return false;
    
    return true;
  });

  // Filter Opportunities (Stage + Search + Datum)
  const filteredOpportunities = dateFilteredOpportunities.filter(opp => {
    if (stageFilter !== 'all' && opp.stage !== stageFilter) return false;
    if (searchTerm) {
      const search = searchTerm.toLowerCase();
      const lead = leads.find(l => l.id === opp.lead_id);
      return opp.name.toLowerCase().includes(search) ||
             lead?.company_name.toLowerCase().includes(search) ||
             lead?.contact_name?.toLowerCase().includes(search);
    }
    return true;
  });

  // Get opportunities for a lead (auch datumsgefiltert)
  const getLeadOpportunities = (leadId: string) => {
    return dateFilteredOpportunities.filter(o => o.lead_id === leadId);
  };

  // Calculate forecast (basierend auf datumsgefilterten Opportunities)
  const calculateForecast = () => {
    const activeOpps = dateFilteredOpportunities.filter(o => ACTIVE_PIPELINE_STAGES.includes(o.stage as OpportunityStage));
    const totalWeighted = activeOpps.reduce((sum, opp) => sum + calculateWeightedValue(opp, settings || undefined), 0);
    const totalPipeline = activeOpps.reduce((sum, opp) => sum + calculateARR(opp.expected_subs_monthly) + calculateARR(opp.expected_pay_monthly), 0);
    
    // Überfällig und Stuck aus gefilterten Daten berechnen
    const overdueCount = activeOpps.filter(o => isOverdue(o)).length;
    const stuckCount = activeOpps.filter(o => isStuck(o)).length;
    
    return { weighted: totalWeighted, total: totalPipeline, count: activeOpps.length, overdueCount, stuckCount };
  };

  const forecast = calculateForecast();

  // Handle Lead Save
  const handleLeadSave = async (leadData: Partial<Lead>) => {
    if (editingLead) {
      await updateLead(editingLead.id, leadData);
    } else {
      await createLead({ ...leadData, user_id: user.id });
    }
    setShowLeadForm(false);
    setEditingLead(null);
    refetchLeads();
  };

  // Handle Opportunity Save
  const handleOpportunitySave = async (oppData: Partial<Opportunity>) => {
    if (editingOpportunity) {
      await updateOpportunity(editingOpportunity.id, oppData);
    } else {
      await createOpportunity({ ...oppData, user_id: user.id }, settings || undefined);
    }
    setShowOpportunityForm(false);
    setEditingOpportunity(null);
    setSelectedLeadForOpp(null);
    refetchOpps();
  };

  // Handle Stage Change
  const handleStageChange = async (
    newStage: OpportunityStage,
    lostReasonId?: string,
    lostReasonNotes?: string
  ) => {
    if (!stageChangeOpp) return;
    
    await changeStage(stageChangeOpp.id, newStage, user.id, settings || undefined, lostReasonId, lostReasonNotes);
    
    // Bei Close Won: Go-Live Dialog öffnen
    if (newStage === 'close_won') {
      const lead = leads.find(l => l.id === stageChangeOpp.lead_id);
      if (lead) {
        setWonOpportunity({ opp: stageChangeOpp, lead });
        setShowGoLiveDialog(true);
      }
    }
    
    setStageChangeOpp(null);
    refetchOpps();
  };

  // Handle CSV Import
  const handleCSVImport = async (leadsToImport: Partial<Lead>[]): Promise<{ success: number; errors: string[] }> => {
    let success = 0;
    const errors: string[] = [];

    for (const leadData of leadsToImport) {
      const result = await createLead({ ...leadData, user_id: user.id });
      if (result.error) {
        errors.push(`${leadData.company_name}: ${result.error.message}`);
      } else {
        success++;
      }
    }

    refetchLeads();
    return { success, errors };
  };

  // Handle Go-Live Creation from Opportunity
  const handleCreateGoLive = async (goLiveData: Partial<GoLive>) => {
    if (!wonOpportunity) return { error: new Error('Keine Opportunity ausgewählt') };

    // Go-Live in DB erstellen
    const { data, error } = await supabase
      .from('go_lives')
      .insert({
        ...goLiveData,
        user_id: user.id,
        lead_id: wonOpportunity.lead.id,
        opportunity_id: wonOpportunity.opp.id,
      })
      .select()
      .single();

    if (error) {
      return { error };
    }

    // Opportunity mit go_live_id verknüpfen
    await updateOpportunity(wonOpportunity.opp.id, { go_live_id: data.id });

    setShowGoLiveDialog(false);
    setWonOpportunity(null);
    refetchOpps();
    
    return { data };
  };

  // Load Stage History für Analytics
  const loadStageHistory = async () => {
    const { data } = await supabase
      .from('opportunity_stage_history')
      .select('*')
      .order('changed_at', { ascending: false });
    
    if (data) {
      setStageHistory(data);
    }
  };

  // Beim Wechsel zu Analytics: History laden
  const handleViewChange = (newView: PipelineView) => {
    setView(newView);
    if (newView === 'analytics') {
      loadStageHistory();
    }
  };

  // Notifications Hook
  const { unreadCount } = useNotifications(user.id);

  // AE Settings für Go-Live Jahr
  const { settings: aeSettings } = useSettingsForUser(user.id);
  const currentYear = aeSettings?.year || new Date().getFullYear();

  // Render Stage Badge
  const renderStageBadge = (stage: OpportunityStage) => {
    const stageConfig = OPPORTUNITY_STAGES[stage];
    return (
      <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${stageConfig.bgColor} ${stageConfig.color}`}>
        {stageConfig.icon} {stageConfig.label}
      </span>
    );
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-gray-800">📊 Sales Pipeline</h2>
          <p className="text-sm text-gray-500">
            {leads.length} Leads • {opportunities.filter(o => ACTIVE_PIPELINE_STAGES.includes(o.stage as OpportunityStage)).length} aktive Opportunities
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* View Toggle */}
          <div className="flex bg-gray-100 rounded-lg p-1">
            <button
              onClick={() => handleViewChange('pipeline')}
              className={`px-3 py-1.5 rounded text-sm font-medium transition ${
                view === 'pipeline' ? 'bg-white shadow text-gray-800' : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              📋 Pipeline
            </button>
            <button
              onClick={() => handleViewChange('analytics')}
              className={`px-3 py-1.5 rounded text-sm font-medium transition ${
                view === 'analytics' ? 'bg-white shadow text-gray-800' : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              📈 Analytics
            </button>
          </div>

          <div className="h-6 w-px bg-gray-300"></div>

          {permissions.hasAdminAccess && (
            <button
              onClick={() => setShowSalesforceImport(true)}
              className="px-3 py-2 bg-blue-100 text-blue-700 border border-blue-300 rounded-lg font-medium hover:bg-blue-200 flex items-center gap-2"
            >
              ☁️ Salesforce
            </button>
          )}
          <button
            onClick={() => setShowCSVImport(true)}
            className="px-3 py-2 border border-gray-300 text-gray-700 rounded-lg font-medium hover:bg-gray-50 flex items-center gap-2"
          >
            📥 CSV Import
          </button>
          <button
            onClick={() => { setEditingLead(null); setShowLeadForm(true); }}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 flex items-center gap-2"
          >
            <span>+</span>
            <span>Neuer Lead</span>
          </button>
          
          <NotificationBadge 
            count={unreadCount} 
            onClick={() => setShowNotifications(true)} 
          />
        </div>
      </div>

      {/* Debug Panel für Pipeline */}
      <DebugPanel 
        user={user}
        title="Pipeline Debug"
        data={{
          filter: {
            pipelineDateFrom,
            pipelineDateTo,
            stageFilter,
            searchTerm,
          },
          counts: {
            totalOpportunities: opportunities.length,
            dateFilteredOpportunities: dateFilteredOpportunities.length,
            filteredOpportunities: filteredOpportunities.length,
            totalLeads: leads.length,
          },
          forecast: {
            total: forecast.total,
            count: forecast.count,
            overdueCount: forecast.overdueCount,
            stuckCount: forecast.stuckCount,
          },
          stageCounts: {
            sql: dateFilteredOpportunities.filter(o => o.stage === 'sql').length,
            demo_booked: dateFilteredOpportunities.filter(o => o.stage === 'demo_booked').length,
            demo_completed: dateFilteredOpportunities.filter(o => o.stage === 'demo_completed').length,
            sent_quote: dateFilteredOpportunities.filter(o => o.stage === 'sent_quote').length,
            close_won: dateFilteredOpportunities.filter(o => o.stage === 'close_won').length,
            close_lost: dateFilteredOpportunities.filter(o => o.stage === 'close_lost').length,
          },
          sampleOpportunity: opportunities[0] ? {
            id: opportunities[0].id,
            name: opportunities[0].name,
            stage: opportunities[0].stage,
            created_at: opportunities[0].created_at,
            expected_close_date: opportunities[0].expected_close_date,
            stage_changed_at: opportunities[0].stage_changed_at,
          } : null,
        }}
      />

      {/* Analytics View */}
      {view === 'analytics' ? (
        <PipelineAnalytics 
          opportunities={opportunities} 
          stageHistory={stageHistory}
          settings={settings}
          user={user}
        />
      ) : (
      <>
      {/* Forecast Card */}
      <div className="bg-gradient-to-r from-blue-600 to-indigo-600 rounded-xl p-6 text-white">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <h3 className="text-lg font-medium opacity-90">Pipeline</h3>
            <div className="text-3xl font-bold mt-1">{formatCurrency(forecast.total)}</div>
            <p className="text-sm opacity-75 mt-1">
              ARR in aktiver Pipeline
            </p>
          </div>
          <div className="grid grid-cols-3 gap-6 text-center">
            <div>
              <div className="text-2xl font-bold">{forecast.count}</div>
              <div className="text-sm opacity-75">Aktive Deals</div>
            </div>
            <div>
              <div className="text-2xl font-bold">{forecast.overdueCount}</div>
              <div className="text-sm opacity-75">Überfällig</div>
            </div>
            <div>
              <div className="text-2xl font-bold">{forecast.stuckCount}</div>
              <div className="text-sm opacity-75">Stuck</div>
            </div>
          </div>
        </div>
      </div>

      {/* Date Filter for Pipeline */}
      <div className="bg-white rounded-xl shadow-sm p-4">
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm font-medium text-gray-700">📅 Zeitraum:</span>
          <div className="flex items-center gap-2">
            <input
              type="date"
              value={pipelineDateFromInput}
              onChange={(e) => setPipelineDateFromInput(e.target.value)}
              className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
            <span className="text-gray-500">bis</span>
            <input
              type="date"
              value={pipelineDateToInput}
              onChange={(e) => setPipelineDateToInput(e.target.value)}
              className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>
          <button
            onClick={applyPipelineDateFilter}
            disabled={!pipelineDateFromInput && !pipelineDateToInput}
            className="px-4 py-1.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Anwenden
          </button>
          {(pipelineDateFrom || pipelineDateTo) && (
            <button
              onClick={resetPipelineDateFilter}
              className="px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100 rounded-lg"
            >
              ✕ Zurücksetzen
            </button>
          )}
          {(pipelineDateFrom || pipelineDateTo) && (
            <span className="text-sm text-blue-600 font-medium">
              Filter aktiv: {dateFilteredOpportunities.length} von {opportunities.length} Opportunities
            </span>
          )}
        </div>
      </div>

      {/* Stage Overview */}
      <div className="bg-white rounded-xl shadow-sm p-4">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-medium text-gray-700">Pipeline Stages</h3>
          <div className="flex items-center gap-4">
            {/* Archiv Toggle */}
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={showArchived}
                onChange={(e) => setShowArchived(e.target.checked)}
                className="w-4 h-4 text-orange-600 rounded focus:ring-orange-500"
              />
              <span className={`text-sm ${showArchived ? 'text-orange-600 font-medium' : 'text-gray-500'}`}>
                📦 Archiv anzeigen
              </span>
            </label>
            
            <div className="h-6 w-px bg-gray-200"></div>
            
            {/* Leads/Opportunities Toggle */}
            <div className="flex gap-2">
              <button
                onClick={() => setViewMode('leads')}
                className={`px-3 py-1 rounded text-sm ${viewMode === 'leads' ? 'bg-blue-100 text-blue-700' : 'text-gray-500 hover:bg-gray-100'}`}
              >
                🏢 Leads
              </button>
              <button
                onClick={() => setViewMode('opportunities')}
                className={`px-3 py-1 rounded text-sm ${viewMode === 'opportunities' ? 'bg-blue-100 text-blue-700' : 'text-gray-500 hover:bg-gray-100'}`}
              >
                📋 Opportunities
              </button>
            </div>
          </div>
        </div>
        
        <div className="flex gap-2 overflow-x-auto pb-2">
          {(() => {
            const activeOpps = dateFilteredOpportunities.filter(o => ACTIVE_PIPELINE_STAGES.includes(o.stage as OpportunityStage));
            const totalARR = activeOpps.reduce((sum, o) => sum + calculateARR(o.expected_subs_monthly), 0);
            return (
              <button
                onClick={() => setStageFilter('all')}
                className={`px-3 py-2 rounded-lg text-sm whitespace-nowrap transition flex items-center gap-2 ${
                  stageFilter === 'all' ? 'bg-gray-800 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                <span>Alle ({activeOpps.length})</span>
                {totalARR > 0 && <span className="text-xs opacity-75">{formatCurrency(totalARR)}</span>}
              </button>
            );
          })()}
          {ACTIVE_PIPELINE_STAGES.map(stage => {
            const stageConfig = OPPORTUNITY_STAGES[stage];
            const stageOpps = dateFilteredOpportunities.filter(o => o.stage === stage);
            const count = stageOpps.length;
            const value = stageOpps.reduce((sum, o) => sum + calculateARR(o.expected_subs_monthly), 0);
            return (
              <button
                key={stage}
                onClick={() => setStageFilter(stage)}
                className={`px-3 py-2 rounded-lg text-sm whitespace-nowrap transition flex items-center gap-2 ${
                  stageFilter === stage ? `${stageConfig.bgColor} ${stageConfig.color}` : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                <span>{stageConfig.icon}</span>
                <span>{stageConfig.label}</span>
                <span className="font-medium">({count})</span>
                {value > 0 && <span className="text-xs opacity-75">{formatCurrency(value)}</span>}
              </button>
            );
          })}
          {/* Close Won Button */}
          {(() => {
            const wonOpps = dateFilteredOpportunities.filter(o => o.stage === 'close_won');
            const wonValue = wonOpps.reduce((sum, o) => sum + calculateARR(o.expected_subs_monthly), 0);
            return (
              <button
                onClick={() => setStageFilter('close_won')}
                className={`px-3 py-2 rounded-lg text-sm whitespace-nowrap transition flex items-center gap-2 ${
                  stageFilter === 'close_won' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                <span>✅</span>
                <span>Closed Won</span>
                <span className="font-medium">({wonOpps.length})</span>
                {wonValue > 0 && <span className="text-xs opacity-75">{formatCurrency(wonValue)}</span>}
              </button>
            );
          })()}
          {/* Close Lost Button */}
          {(() => {
            const lostOpps = dateFilteredOpportunities.filter(o => o.stage === 'close_lost');
            const lostValue = lostOpps.reduce((sum, o) => sum + calculateARR(o.expected_subs_monthly), 0);
            return (
              <button
                onClick={() => setStageFilter('close_lost')}
                className={`px-3 py-2 rounded-lg text-sm whitespace-nowrap transition flex items-center gap-2 ${
                  stageFilter === 'close_lost' ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                <span>❌</span>
                <span>Closed Lost</span>
                <span className="font-medium">({lostOpps.length})</span>
                {lostValue > 0 && <span className="text-xs opacity-75">{formatCurrency(lostValue)}</span>}
              </button>
            );
          })()}
        </div>
      </div>

      {/* Search */}
      <div className="relative">
        <input
          type="text"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          placeholder="Suchen nach Lead, Opportunity oder Kontakt..."
          className="w-full px-4 py-2 pl-10 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
        />
        <span className="absolute left-3 top-2.5 text-gray-400">🔍</span>
      </div>

      {/* Content based on view mode */}
      {viewMode === 'leads' ? (
        /* Leads View with Opportunities as Accordion */
        <div className="space-y-3">
          {leads.length === 0 ? (
            <div className="bg-white rounded-xl shadow-sm p-12 text-center">
              <div className="text-6xl mb-4">📋</div>
              <h3 className="text-lg font-medium text-gray-800 mb-2">Noch keine Leads</h3>
              <p className="text-gray-500 mb-4">Erstelle deinen ersten Lead um die Pipeline zu starten.</p>
              <button
                onClick={() => { setEditingLead(null); setShowLeadForm(true); }}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700"
              >
                + Ersten Lead erstellen
              </button>
            </div>
          ) : (
            leads.map(lead => {
              const leadOpps = getLeadOpportunities(lead.id);
              const isExpanded = expandedLeads.has(lead.id);
              const totalARR = leadOpps.reduce((sum, o) => sum + calculateARR(o.expected_subs_monthly), 0);
              const activeOpps = leadOpps.filter(o => ACTIVE_PIPELINE_STAGES.includes(o.stage as OpportunityStage));
              const isArchived = lead.archived;
              
              return (
                <div key={lead.id} className={`bg-white rounded-xl shadow-sm overflow-hidden ${isArchived ? 'border-2 border-orange-300 opacity-75' : ''}`}>
                  {/* Lead Header */}
                  <div
                    className={`p-4 cursor-pointer hover:bg-gray-50 flex items-center justify-between ${isArchived ? 'bg-orange-50' : ''}`}
                    onClick={() => toggleLeadExpansion(lead.id)}
                  >
                    <div className="flex items-center gap-4">
                      <span className={`transform transition-transform ${isExpanded ? 'rotate-90' : ''}`}>
                        ▶
                      </span>
                      <div>
                        <div className="flex items-center gap-2">
                          {isArchived && <span className="text-orange-500" title="Archiviert">📦</span>}
                          <h3 className={`font-medium ${isArchived ? 'text-gray-500' : 'text-gray-800'}`}>{lead.company_name}</h3>
                          <span className={`px-2 py-0.5 rounded text-xs ${
                            lead.lead_source === 'enterprise' ? 'bg-purple-100 text-purple-700' :
                            lead.lead_source === 'inbound' ? 'bg-green-100 text-green-700' :
                            lead.lead_source === 'outbound' ? 'bg-blue-100 text-blue-700' :
                            'bg-orange-100 text-orange-700'
                          }`}>
                            {LEAD_SOURCES[lead.lead_source].icon} {LEAD_SOURCES[lead.lead_source].label}
                          </span>
                        </div>
                        <div className="text-sm text-gray-500 flex items-center gap-3">
                          {lead.contact_name && <span>👤 {lead.contact_name}</span>}
                          {lead.employee_count && <span>👥 {lead.employee_count} MA</span>}
                          {lead.location_count > 1 && <span>🏢 {lead.location_count} Filialen</span>}
                          {lead.competitor && <span>📊 {lead.competitor.name}</span>}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-4">
                      <div className="text-right">
                        <div className="font-medium text-gray-800">
                          {activeOpps.length} Opp{activeOpps.length !== 1 ? 's' : ''}
                        </div>
                        <div className="text-sm text-gray-500">{formatCurrency(totalARR)} ARR</div>
                      </div>
                      {isArchived ? (
                        // Archivierter Lead: Restore Button
                        <button
                          onClick={async (e) => {
                            e.stopPropagation();
                            if (confirm('Lead wiederherstellen?')) {
                              await restoreLead(lead.id);
                            }
                          }}
                          className="px-3 py-1.5 text-sm bg-orange-100 text-orange-700 hover:bg-orange-200 rounded"
                          title="Wiederherstellen"
                        >
                          ♻️ Restore
                        </button>
                      ) : (
                        // Aktiver Lead: Normal Buttons
                        <>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedLeadForOpp(lead);
                              setEditingOpportunity(null);
                              setShowOpportunityForm(true);
                            }}
                            className="p-2 text-blue-600 hover:bg-blue-50 rounded"
                            title="Neue Opportunity"
                          >
                            ➕
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setEditingLead(lead);
                              setShowLeadForm(true);
                            }}
                            className="p-2 text-gray-400 hover:bg-gray-100 rounded"
                            title="Lead bearbeiten"
                          >
                            ✏️
                          </button>
                        </>
                      )}
                    </div>
                  </div>

                  {/* Opportunities (Expanded) */}
                  {isExpanded && (
                    <div className="border-t bg-gray-50">
                      {leadOpps.length === 0 ? (
                        <div className="p-4 text-center text-gray-500">
                          <p>Noch keine Opportunities</p>
                          <button
                            onClick={() => {
                              setSelectedLeadForOpp(lead);
                              setEditingOpportunity(null);
                              setShowOpportunityForm(true);
                            }}
                            className="mt-2 text-blue-600 hover:underline"
                          >
                            + Opportunity hinzufügen
                          </button>
                        </div>
                      ) : (
                        <div className="divide-y divide-gray-200">
                          {leadOpps.map(opp => {
                            const overdue = isOverdue(opp);
                            const stuck = isStuck(opp, settings?.notify_deal_stuck_days || 7);
                            return (
                              <div
                                key={opp.id}
                                className={`p-4 flex items-center justify-between ${
                                  overdue ? 'bg-red-50' : stuck ? 'bg-yellow-50' : ''
                                }`}
                              >
                                <div className="flex items-center gap-4">
                                  <div className="w-8"></div>
                                  <div>
                                    <div className="flex items-center gap-2">
                                      <span className="font-medium text-gray-700">{opp.name}</span>
                                      {renderStageBadge(opp.stage as OpportunityStage)}
                                      {overdue && <span className="text-xs text-red-600 font-medium">⚠️ Überfällig</span>}
                                      {stuck && !overdue && <span className="text-xs text-yellow-600 font-medium">⏳ Stuck</span>}
                                    </div>
                                    <div className="text-sm text-gray-500 flex items-center gap-3">
                                      <span>{formatCurrency(opp.expected_subs_monthly)}/M</span>
                                      <span>→ {formatCurrency(calculateARR(opp.expected_subs_monthly))} ARR</span>
                                      {opp.has_terminal && <span>📱 Terminal</span>}
                                      {opp.expected_close_date && (
                                        <span className={overdue ? 'text-red-600' : ''}>
                                          📅 {formatDate(opp.expected_close_date)}
                                          {!overdue && daysUntil(opp.expected_close_date) <= 7 && (
                                            <span className="text-orange-600"> ({daysUntil(opp.expected_close_date)}d)</span>
                                          )}
                                        </span>
                                      )}
                                    </div>
                                  </div>
                                </div>
                                <div className="flex items-center gap-2">
                                  <button
                                    onClick={() => setStageChangeOpp(opp)}
                                    className="px-3 py-1 text-sm bg-gray-100 text-gray-700 rounded hover:bg-gray-200"
                                  >
                                    → Stage
                                  </button>
                                  <button
                                    onClick={() => {
                                      setSelectedLeadForOpp(lead);
                                      setEditingOpportunity(opp);
                                      setShowOpportunityForm(true);
                                    }}
                                    className="p-2 text-gray-400 hover:bg-gray-100 rounded"
                                  >
                                    ✏️
                                  </button>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      ) : (
        /* Opportunities List View */
        <div className="bg-white rounded-xl shadow-sm" style={{ overflow: 'visible' }}>
          <div style={{ overflowX: 'scroll', WebkitOverflowScrolling: 'touch' }}>
            <table style={{ width: '100%', minWidth: '1400px', tableLayout: 'fixed' }}>
            <thead className="bg-gray-50 border-b">
              <tr>
                <th style={{ width: '200px' }} className="text-left py-3 px-4 font-medium text-gray-600 whitespace-nowrap">Opportunity</th>
                <th style={{ width: '180px' }} className="text-left py-3 px-4 font-medium text-gray-600 whitespace-nowrap">Lead</th>
                <th style={{ width: '140px' }} className="text-left py-3 px-3 font-medium text-gray-600 whitespace-nowrap">Inhaber</th>
                <th style={{ width: '120px' }} className="text-left py-3 px-3 font-medium text-gray-600 whitespace-nowrap">Stage</th>
                <th style={{ width: '60px' }} className="text-center py-3 px-2 font-medium text-gray-600 whitespace-nowrap">Prob.</th>
                <th style={{ width: '80px' }} className="text-right py-3 px-3 font-medium text-gray-600 whitespace-nowrap">Monatl.</th>
                <th style={{ width: '80px' }} className="text-right py-3 px-3 font-medium text-gray-600 whitespace-nowrap">ARR</th>
                <th style={{ width: '100px' }} className="text-center py-3 px-3 font-medium text-gray-600 whitespace-nowrap">Close</th>
                <th style={{ width: '50px' }} className="text-center py-3 px-3 font-medium text-gray-600 whitespace-nowrap">SF</th>
                <th style={{ width: '120px' }} className="py-3 px-3 text-right font-medium text-gray-600">Aktionen</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {filteredOpportunities.length === 0 ? (
                <tr>
                  <td colSpan={10} className="py-12 text-center text-gray-500">
                    Keine Opportunities gefunden
                  </td>
                </tr>
              ) : (
                filteredOpportunities.map(opp => {
                  const lead = leads.find(l => l.id === opp.lead_id);
                  const overdue = isOverdue(opp);
                  const stuck = isStuck(opp);
                  const probability = opp.probability ?? getDefaultProbability(opp.stage as OpportunityStage, settings || undefined);
                  const sfLink = opp.sfid 
                    ? `https://phorestcrm.lightning.force.com/lightning/r/Opportunity/${opp.sfid}/view`
                    : null;
                  return (
                    <tr 
                      key={opp.id} 
                      className={`hover:bg-gray-50 cursor-pointer ${opp.archived ? 'bg-orange-50 opacity-75' : overdue ? 'bg-red-50' : stuck ? 'bg-yellow-50' : ''}`}
                      onClick={() => {
                        // Klick auf Zeile öffnet Bearbeiten-Formular
                        const lead = leads.find(l => l.id === opp.lead_id);
                        setSelectedLeadForOpp(lead || null);
                        setEditingOpportunity(opp);
                        setShowOpportunityForm(true);
                      }}
                    >
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-2">
                          {opp.archived && <span className="text-orange-500" title="Archiviert">📦</span>}
                          <span className={`font-medium ${opp.archived ? 'text-gray-500' : 'text-gray-800'}`}>{opp.name}</span>
                        </div>
                        <div className="text-sm text-gray-500 flex items-center gap-2">
                          {opp.has_terminal && <span>📱</span>}
                          {overdue && !opp.archived && <span className="text-red-600">⚠️</span>}
                          {stuck && !overdue && !opp.archived && <span className="text-yellow-600">⏳</span>}
                        </div>
                      </td>
                      <td className="py-3 px-4">
                        <div className="text-gray-700">{lead?.company_name}</div>
                        <div className="text-sm text-gray-500">{lead?.contact_name}</div>
                      </td>
                      <td className="py-3 px-3">
                        {opp.assigned_user ? (
                          <div className="text-gray-700 text-sm">{opp.assigned_user.name}</div>
                        ) : opp.sf_owner_name ? (
                          <div className="flex items-center gap-1">
                            <span className="text-orange-500" title="Nicht zugewiesen">⚠️</span>
                            <span className="text-gray-500 text-sm italic">{opp.sf_owner_name}</span>
                          </div>
                        ) : (
                          <span className="text-gray-400 text-sm">-</span>
                        )}
                      </td>
                      <td className="py-3 px-3">
                        {renderStageBadge(opp.stage as OpportunityStage)}
                      </td>
                      <td className="py-3 px-2 text-center">
                        <span className="text-sm font-medium text-gray-600">
                          {Math.round(probability * 100)}%
                        </span>
                      </td>
                      <td className="py-3 px-2 text-right font-medium text-gray-800 whitespace-nowrap">
                        {formatCurrency(opp.expected_subs_monthly)}
                      </td>
                      <td className="py-3 px-2 text-right font-medium text-green-600 whitespace-nowrap">
                        {formatCurrency(calculateARR(opp.expected_subs_monthly))}
                      </td>
                      <td className="py-3 px-2 text-center whitespace-nowrap">
                        <span className={overdue ? 'text-red-600 font-medium' : 'text-gray-600'}>
                          {formatDate(opp.expected_close_date)}
                        </span>
                      </td>
                      <td className="py-3 px-2 text-center" onClick={(e) => e.stopPropagation()}>
                        {sfLink ? (
                          <a
                            href={sfLink}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-blue-500 hover:text-blue-700"
                            title="In Salesforce öffnen"
                          >
                            ☁️
                          </a>
                        ) : (
                          <span className="text-gray-300">-</span>
                        )}
                      </td>
                      <td className="py-3 px-2" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-end gap-1">
                          {opp.archived ? (
                            // Archivierte Opportunity: Wiederherstellen Button
                            <button
                              onClick={async () => {
                                if (confirm('Opportunity wiederherstellen?')) {
                                  await restoreOpportunity(opp.id);
                                }
                              }}
                              className="px-2 py-1 text-xs bg-orange-100 text-orange-700 hover:bg-orange-200 rounded"
                              title="Wiederherstellen"
                            >
                              ♻️ Restore
                            </button>
                          ) : (
                            // Aktive Opportunity: Normal Buttons
                            <>
                              <button
                                onClick={() => setStageChangeOpp(opp)}
                                className="p-1.5 text-gray-400 hover:bg-gray-100 rounded"
                                title="Stage ändern"
                              >
                                →
                              </button>
                              <button
                                onClick={() => {
                                  setSelectedLeadForOpp(lead || null);
                                  setEditingOpportunity(opp);
                                  setShowOpportunityForm(true);
                                }}
                                className="p-1.5 text-gray-400 hover:bg-gray-100 rounded"
                                title="Bearbeiten"
                              >
                                ✏️
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
          </div>
        </div>
      )}

      {/* Lead Form Modal */}
      {showLeadForm && (
        <LeadForm
          lead={editingLead}
          competitors={competitors}
          onSave={handleLeadSave}
          onCancel={() => {
            setShowLeadForm(false);
            setEditingLead(null);
          }}
          onArchive={editingLead ? async () => {
            if (confirm('Lead archivieren? Der Lead und alle zugehörigen Opportunities bleiben erhalten und können wiederhergestellt werden.')) {
              await archiveLead(editingLead.id);
              setShowLeadForm(false);
              setEditingLead(null);
            }
          } : undefined}
        />
      )}

      {/* Opportunity Form Modal */}
      {showOpportunityForm && selectedLeadForOpp && (
        <OpportunityForm
          opportunity={editingOpportunity}
          lead={selectedLeadForOpp}
          settings={settings}
          userRole={user.role}
          onSave={handleOpportunitySave}
          onCancel={() => {
            setShowOpportunityForm(false);
            setEditingOpportunity(null);
            setSelectedLeadForOpp(null);
          }}
          onArchive={editingOpportunity ? async () => {
            if (confirm('Opportunity archivieren? Sie kann später wiederhergestellt werden.')) {
              const { error } = await archiveOpportunity(editingOpportunity.id);
              if (!error) {
                setShowOpportunityForm(false);
                setEditingOpportunity(null);
                setSelectedLeadForOpp(null);
              } else {
                alert('Fehler beim Archivieren: ' + error.message);
              }
            }
          } : undefined}
        />
      )}

      {/* Stage Change Dialog */}
      {stageChangeOpp && (
        <StageChangeDialog
          opportunity={stageChangeOpp}
          lostReasons={lostReasons}
          settings={settings}
          userRole={user.role}
          onConfirm={handleStageChange}
          onCancel={() => setStageChangeOpp(null)}
        />
      )}

      {/* CSV Import Dialog */}
      {showCSVImport && (
        <CSVImport
          onImport={handleCSVImport}
          onClose={() => setShowCSVImport(false)}
        />
      )}

      {/* Create Go-Live Dialog */}
      {showGoLiveDialog && wonOpportunity && (
        <CreateGoLiveDialog
          opportunity={wonOpportunity.opp}
          lead={wonOpportunity.lead}
          year={currentYear}
          onConfirm={handleCreateGoLive}
          onCancel={() => {
            setShowGoLiveDialog(false);
            setWonOpportunity(null);
          }}
        />
      )}

      {/* Notifications Panel */}
      {showNotifications && (
        <NotificationsPanel
          userId={user.id}
          onClose={() => setShowNotifications(false)}
        />
      )}

      {/* Salesforce Import */}
      {showSalesforceImport && (
        <SalesforceImport
          user={user}
          allUsers={allUsers}
          onClose={() => {
            setShowSalesforceImport(false);
            refetchLeads();
            refetchOpps();
          }}
        />
      )}
      </>
      )}
    </div>
  );
}
