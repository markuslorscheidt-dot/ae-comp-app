'use client';

import React, { useMemo, useState } from 'react';
import {
  Opportunity,
  OpportunityStage,
  OpportunityStageHistory,
  OPPORTUNITY_STAGES,
  ACTIVE_PIPELINE_STAGES,
  calculateARR,
  getDefaultProbability,
  daysBetween,
  PipelineSettings,
} from '@/lib/pipeline-types';
import { formatCurrency } from '@/lib/calculations';
import { User } from '@/lib/types';
import DebugPanel from './DebugPanel';

// Filter-Modus Typ
type DateFilterMode = 'created' | 'closed';

interface PipelineAnalyticsProps {
  opportunities: Opportunity[];
  stageHistory: OpportunityStageHistory[];
  settings: PipelineSettings | null;
  user: User;
}

export default function PipelineAnalytics({ 
  opportunities, 
  stageHistory,
  settings,
  user 
}: PipelineAnalyticsProps) {
  
  // Datumsfilter State - Input-Werte
  const [dateFromInput, setDateFromInput] = useState<string>('');
  const [dateToInput, setDateToInput] = useState<string>('');
  
  // Angewendete Filter-Werte (erst nach Klick auf "Anwenden")
  const [dateFrom, setDateFrom] = useState<string>('');
  const [dateTo, setDateTo] = useState<string>('');
  
  // Filter-Modus: nach Erstelldatum oder Close-Datum
  const [filterModeInput, setFilterModeInput] = useState<DateFilterMode>('created');
  const [filterMode, setFilterMode] = useState<DateFilterMode>('created');
  
  // Filter anwenden
  const applyFilter = () => {
    setDateFrom(dateFromInput);
    setDateTo(dateToInput);
    setFilterMode(filterModeInput);
  };
  
  // Filter zurücksetzen
  const resetFilter = () => {
    setDateFromInput('');
    setDateToInput('');
    setDateFrom('');
    setDateTo('');
    setFilterModeInput('created');
    setFilterMode('created');
  };

  // Gefilterte Opportunities basierend auf Datumsbereich und Filter-Modus
  const filteredOpportunities = useMemo(() => {
    if (!dateFrom && !dateTo) return opportunities;
    
    const fromDate = dateFrom ? new Date(dateFrom) : null;
    const toDate = dateTo ? new Date(dateTo + 'T23:59:59') : null;
    
    return opportunities.filter(opp => {
      let relevantDate: Date | null = null;
      
      if (filterMode === 'created') {
        // Erstelldatum-Modus: SF Erstelldatum verwenden (Fallback auf created_at)
        if (opp.sf_created_date) {
          relevantDate = new Date(opp.sf_created_date);
        } else {
          relevantDate = new Date(opp.created_at);
        }
      } else {
        // Close-Datum-Modus: Closed Won/Lost nach Close-Datum, Rest nach SF Erstelldatum
        const isClosedStage = opp.stage === 'close_won' || opp.stage === 'close_lost';
        if (isClosedStage && opp.expected_close_date) {
          relevantDate = new Date(opp.expected_close_date);
        } else if (opp.sf_created_date) {
          relevantDate = new Date(opp.sf_created_date);
        } else {
          relevantDate = new Date(opp.created_at);
        }
      }
      
      if (!relevantDate || isNaN(relevantDate.getTime())) return true; // Bei ungültigem Datum: nicht filtern
      
      if (fromDate && relevantDate < fromDate) return false;
      if (toDate && relevantDate > toDate) return false;
      
      return true;
    });
  }, [opportunities, dateFrom, dateTo, filterMode]);

  // Conversion Funnel berechnen
  const funnelData = useMemo(() => {
    const stages = ['sql', 'demo_booked', 'demo_completed', 'sent_quote', 'close_won', 'close_lost'] as OpportunityStage[];
    const data: { stage: OpportunityStage; count: number; value: number; conversionRate: number }[] = [];
    
    // Zähle alle Opportunities die jemals in einer Stage waren
    const stageReached: Record<string, Set<string>> = {};
    stages.forEach(s => stageReached[s] = new Set());
    
    // Aktuelle Stage zählen
    filteredOpportunities.forEach(opp => {
      const currentStageIndex = stages.indexOf(opp.stage as OpportunityStage);
      // Alle Stages bis zur aktuellen wurden erreicht (außer close_lost - das ist ein separater Endpunkt)
      const progressStages = ['sql', 'demo_booked', 'demo_completed', 'sent_quote', 'close_won'];
      const progressIndex = progressStages.indexOf(opp.stage as OpportunityStage);
      for (let i = 0; i <= progressIndex; i++) {
        if (progressStages[i]) {
          stageReached[progressStages[i]].add(opp.id);
        }
      }
      // Close Won und Close Lost separat zählen
      if (opp.stage === 'close_won') {
        stageReached['close_won'].add(opp.id);
      }
      if (opp.stage === 'close_lost') {
        stageReached['close_lost'].add(opp.id);
      }
    });
    
    // History für zusätzliche Erreichungen prüfen
    stageHistory.forEach(h => {
      if (stages.includes(h.to_stage as OpportunityStage)) {
        stageReached[h.to_stage].add(h.opportunity_id);
      }
    });
    
    let previousCount = 0;
    stages.forEach((stage, index) => {
      const count = stageReached[stage].size;
      const oppsInStage = filteredOpportunities.filter(o => o.stage === stage);
      const value = oppsInStage.reduce((sum, o) => sum + calculateARR(o.expected_subs_monthly), 0);
      
      const conversionRate = index === 0 ? 100 : (previousCount > 0 ? (count / previousCount) * 100 : 0);
      
      data.push({ stage, count, value, conversionRate });
      previousCount = count;
    });
    
    return data;
  }, [filteredOpportunities, stageHistory]);

  // Durchschnittliche Cycle Times berechnen
  const cycleTimes = useMemo(() => {
    const wonOpps = filteredOpportunities.filter(o => o.stage === 'close_won');
    
    if (wonOpps.length === 0) return null;
    
    const times = {
      sqlToDemo: [] as number[],
      demoToQuote: [] as number[],
      quoteToClose: [] as number[],
      total: [] as number[],
    };
    
    wonOpps.forEach(opp => {
      if (opp.demo_booked_date) {
        times.sqlToDemo.push(daysBetween(opp.created_at, opp.demo_booked_date));
      }
      if (opp.demo_completed_date && opp.quote_sent_date) {
        times.demoToQuote.push(daysBetween(opp.demo_completed_date, opp.quote_sent_date));
      }
      if (opp.quote_sent_date && opp.stage_changed_at) {
        times.quoteToClose.push(daysBetween(opp.quote_sent_date, opp.stage_changed_at));
      }
      times.total.push(daysBetween(opp.created_at, opp.stage_changed_at));
    });
    
    const avg = (arr: number[]) => arr.length > 0 ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : null;
    
    return {
      sqlToDemo: avg(times.sqlToDemo),
      demoToQuote: avg(times.demoToQuote),
      quoteToClose: avg(times.quoteToClose),
      total: avg(times.total),
      sampleSize: wonOpps.length,
    };
  }, [filteredOpportunities]);

  // Win/Loss Analyse
  const winLossData = useMemo(() => {
    const won = filteredOpportunities.filter(o => o.stage === 'close_won');
    const lost = filteredOpportunities.filter(o => o.stage === 'close_lost');
    const active = filteredOpportunities.filter(o => ACTIVE_PIPELINE_STAGES.includes(o.stage as OpportunityStage));
    
    const wonValue = won.reduce((sum, o) => sum + calculateARR(o.expected_subs_monthly), 0);
    const lostValue = lost.reduce((sum, o) => sum + calculateARR(o.expected_subs_monthly), 0);
    const activeValue = active.reduce((sum, o) => sum + calculateARR(o.expected_subs_monthly), 0);
    
    const totalClosed = won.length + lost.length;
    const winRate = totalClosed > 0 ? (won.length / totalClosed) * 100 : 0;
    
    return {
      won: { count: won.length, value: wonValue },
      lost: { count: lost.length, value: lostValue },
      active: { count: active.length, value: activeValue },
      winRate,
    };
  }, [filteredOpportunities]);

  // Lost Reasons Analyse
  const lostReasonsData = useMemo(() => {
    const lost = filteredOpportunities.filter(o => o.stage === 'close_lost' && o.lost_reason);
    const reasons: Record<string, { count: number; value: number; reason: string }> = {};
    
    lost.forEach(opp => {
      const reasonName = opp.lost_reason?.reason || 'Unbekannt';
      if (!reasons[reasonName]) {
        reasons[reasonName] = { count: 0, value: 0, reason: reasonName };
      }
      reasons[reasonName].count++;
      reasons[reasonName].value += calculateARR(opp.expected_subs_monthly);
    });
    
    return Object.values(reasons).sort((a, b) => b.count - a.count);
  }, [filteredOpportunities]);

  // Forecast nach Monat - nur ab aktuellem Monat
  const monthlyForecast = useMemo(() => {
    const now = new Date();
    const currentMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    
    const activeOpps = filteredOpportunities.filter(o => 
      ACTIVE_PIPELINE_STAGES.includes(o.stage as OpportunityStage) && 
      o.expected_close_date
    );
    
    const months: Record<string, { month: string; weighted: number; total: number; count: number }> = {};
    
    activeOpps.forEach(opp => {
      const closeDate = new Date(opp.expected_close_date!);
      const monthKey = `${closeDate.getFullYear()}-${String(closeDate.getMonth() + 1).padStart(2, '0')}`;
      
      // Nur aktuelle und zukünftige Monate anzeigen
      if (monthKey < currentMonthKey) return;
      
      const monthLabel = closeDate.toLocaleDateString('de-DE', { month: 'short', year: 'numeric' });
      
      if (!months[monthKey]) {
        months[monthKey] = { month: monthLabel, weighted: 0, total: 0, count: 0 };
      }
      
      const arr = calculateARR(opp.expected_subs_monthly);
      const prob = opp.probability ?? getDefaultProbability(opp.stage as OpportunityStage, settings || undefined);
      
      months[monthKey].total += arr;
      months[monthKey].weighted += arr * prob;
      months[monthKey].count++;
    });
    
    return Object.entries(months)
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(0, 6)
      .map(([, data]) => data);
  }, [filteredOpportunities, settings]);

  // Funnel Bar-Höhe berechnen
  const maxFunnelCount = Math.max(...funnelData.map(d => d.count), 1);

  return (
    <div className="space-y-6">
      {/* Debug Panel für Analytics */}
      <DebugPanel 
        user={user}
        title="Analytics Debug"
        data={{
          filter: {
            dateFrom,
            dateTo,
            dateFromInput,
            dateToInput,
          },
          counts: {
            totalOpportunities: opportunities.length,
            filteredOpportunities: filteredOpportunities.length,
          },
          winLossData,
          funnelData: funnelData.map(f => ({ stage: f.stage, count: f.count, value: f.value })),
          sampleOpportunity: opportunities[0] ? {
            id: opportunities[0].id,
            name: opportunities[0].name,
            stage: opportunities[0].stage,
            created_at: opportunities[0].created_at,
            sf_created_date: opportunities[0].sf_created_date,
            expected_close_date: opportunities[0].expected_close_date,
            stage_changed_at: opportunities[0].stage_changed_at,
          } : null,
        }}
      />

      {/* Date Filter */}
      <div className="bg-white rounded-xl shadow-sm p-4">
        <div className="flex flex-wrap items-center gap-3 mb-3">
          <span className="text-sm font-medium text-gray-700">📅 Zeitraum:</span>
          <div className="flex items-center gap-2">
            <input
              type="date"
              value={dateFromInput}
              onChange={(e) => setDateFromInput(e.target.value)}
              className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
            <span className="text-gray-500">bis</span>
            <input
              type="date"
              value={dateToInput}
              onChange={(e) => setDateToInput(e.target.value)}
              className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>
          <button
            onClick={applyFilter}
            disabled={!dateFromInput && !dateToInput}
            className="px-4 py-1.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Anwenden
          </button>
          {(dateFrom || dateTo) && (
            <button
              onClick={resetFilter}
              className="px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100 rounded-lg"
            >
              ✕ Zurücksetzen
            </button>
          )}
        </div>
        
        {/* Filter-Modus Auswahl */}
        <div className="flex flex-wrap items-center gap-4 pt-3 border-t border-gray-100">
          <span className="text-sm text-gray-600">Filter bezogen auf:</span>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="radio"
              name="filterMode"
              checked={filterModeInput === 'created'}
              onChange={() => setFilterModeInput('created')}
              className="w-4 h-4 text-blue-600 focus:ring-blue-500"
            />
            <span className={`text-sm ${filterModeInput === 'created' ? 'text-blue-700 font-medium' : 'text-gray-600'}`}>
              Erstelldatum
            </span>
            <span className="text-xs text-gray-400">(wann wurde die Opp erstellt)</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="radio"
              name="filterMode"
              checked={filterModeInput === 'closed'}
              onChange={() => setFilterModeInput('closed')}
              className="w-4 h-4 text-blue-600 focus:ring-blue-500"
            />
            <span className={`text-sm ${filterModeInput === 'closed' ? 'text-blue-700 font-medium' : 'text-gray-600'}`}>
              Close-Datum
            </span>
            <span className="text-xs text-gray-400">(wann wurde abgeschlossen)</span>
          </label>
        </div>
        
        {/* Filter-Status Anzeige */}
        {(dateFrom || dateTo) && (
          <div className="mt-3 pt-3 border-t border-gray-100">
            <span className="text-sm text-blue-600 font-medium">
              ✓ Filter aktiv ({filterMode === 'created' ? 'Erstelldatum' : 'Close-Datum'}): {filteredOpportunities.length} von {opportunities.length} Opportunities
            </span>
          </div>
        )}
      </div>

      {/* Win/Loss Overview */}
      <div className="bg-white rounded-xl shadow-sm p-6">
        <h3 className="text-lg font-medium text-gray-800 mb-4">📊 Pipeline Overview</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="text-center p-4 bg-green-50 rounded-lg">
            <div className="text-3xl font-bold text-green-600">{winLossData.won.count}</div>
            <div className="text-sm text-green-700">Gewonnen</div>
            <div className="text-xs text-green-600 mt-1">{formatCurrency(winLossData.won.value)}</div>
          </div>
          <div className="text-center p-4 bg-red-50 rounded-lg">
            <div className="text-3xl font-bold text-red-600">{winLossData.lost.count}</div>
            <div className="text-sm text-red-700">Verloren</div>
            <div className="text-xs text-red-600 mt-1">{formatCurrency(winLossData.lost.value)}</div>
          </div>
          <div className="text-center p-4 bg-blue-50 rounded-lg">
            <div className="text-3xl font-bold text-blue-600">{winLossData.active.count}</div>
            <div className="text-sm text-blue-700">Aktiv</div>
            <div className="text-xs text-blue-600 mt-1">{formatCurrency(winLossData.active.value)}</div>
            {/* Stage-Aufschlüsselung */}
            <div className="mt-2 pt-2 border-t border-blue-200 text-xs space-y-1">
              {ACTIVE_PIPELINE_STAGES.map(stage => {
                const count = filteredOpportunities.filter(o => o.stage === stage).length;
                if (count === 0) return null;
                const config = OPPORTUNITY_STAGES[stage];
                return (
                  <div key={stage} className="flex justify-between text-blue-600">
                    <span>{config.icon} {config.label}</span>
                    <span className="font-medium">{count}</span>
                  </div>
                );
              })}
            </div>
          </div>
          <div className="text-center p-4 bg-purple-50 rounded-lg">
            <div className="text-3xl font-bold text-purple-600">{winLossData.winRate.toFixed(0)}%</div>
            <div className="text-sm text-purple-700">Win Rate</div>
            <div className="text-xs text-purple-600 mt-1">von abgeschlossenen</div>
          </div>
        </div>
      </div>

      {/* Conversion Funnel */}
      <div className="bg-white rounded-xl shadow-sm p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-medium text-gray-800">🔻 Conversion Funnel</h3>
          <span className="text-xs text-gray-500 bg-gray-100 px-2 py-1 rounded">
            📊 Alle Raten bezogen auf SQL
          </span>
        </div>
        <div className="flex items-end justify-between gap-1 h-48">
          {funnelData.map((data, index) => {
            const config = OPPORTUNITY_STAGES[data.stage];
            const heightPercent = (data.count / maxFunnelCount) * 100;
            // Conversion Rate immer auf SQL (erstes Element) bezogen
            const sqlCount = funnelData[0]?.count || 1;
            const conversionFromSQL = index > 0 && sqlCount > 0
              ? ((data.count / sqlCount) * 100).toFixed(0)
              : null;
            
            return (
              <React.Fragment key={data.stage}>
                {/* Conversion Arrow zwischen Balken */}
                {index > 0 && (
                  <div className="flex flex-col items-center justify-center px-1" style={{ minWidth: '40px' }}>
                    <div className="text-xs font-semibold text-blue-600 bg-blue-50 px-2 py-0.5 rounded">
                      {conversionFromSQL}%
                    </div>
                    <div className="text-gray-400 text-lg">→</div>
                  </div>
                )}
                {/* Stage Balken */}
                <div className="flex-1 flex flex-col items-center">
                  <div 
                    className={`w-full ${config.bgColor} rounded-t-lg transition-all flex items-end justify-center`}
                    style={{ height: `${Math.max(heightPercent, 10)}%` }}
                  >
                    <span className={`text-sm font-bold ${config.color} pb-2`}>{data.count}</span>
                  </div>
                  <div className="text-xs text-gray-600 mt-2 text-center">
                    {config.icon} {config.label}
                  </div>
                  <div className="text-xs text-gray-400">{formatCurrency(data.value)}</div>
                </div>
              </React.Fragment>
            );
          })}
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        {/* Cycle Times */}
        <div className="bg-white rounded-xl shadow-sm p-6">
          <h3 className="text-lg font-medium text-gray-800 mb-4">⏱️ Durchschnittliche Cycle Times</h3>
          {cycleTimes ? (
            <div className="space-y-3">
              <div className="flex justify-between items-center p-3 bg-gray-50 rounded-lg">
                <span className="text-gray-600">SQL → Demo</span>
                <span className="font-medium">{cycleTimes.sqlToDemo ?? '-'} Tage</span>
              </div>
              <div className="flex justify-between items-center p-3 bg-gray-50 rounded-lg">
                <span className="text-gray-600">Demo → Quote</span>
                <span className="font-medium">{cycleTimes.demoToQuote ?? '-'} Tage</span>
              </div>
              <div className="flex justify-between items-center p-3 bg-gray-50 rounded-lg">
                <span className="text-gray-600">Quote → Close</span>
                <span className="font-medium">{cycleTimes.quoteToClose ?? '-'} Tage</span>
              </div>
              <div className="flex justify-between items-center p-3 bg-blue-50 rounded-lg border-2 border-blue-200">
                <span className="text-blue-700 font-medium">Gesamt</span>
                <span className="font-bold text-blue-700">{cycleTimes.total ?? '-'} Tage</span>
              </div>
              <p className="text-xs text-gray-400 text-center">
                Basierend auf {cycleTimes.sampleSize} gewonnenen Deals
              </p>
            </div>
          ) : (
            <div className="text-center py-8 text-gray-400">
              <p>Noch keine gewonnenen Deals</p>
              <p className="text-sm">Cycle Times werden berechnet sobald Deals abgeschlossen sind</p>
            </div>
          )}
        </div>

        {/* Lost Reasons */}
        <div className="bg-white rounded-xl shadow-sm p-6">
          <h3 className="text-lg font-medium text-gray-800 mb-4">❌ Verlustgründe</h3>
          {lostReasonsData.length > 0 ? (
            <div className="space-y-2">
              {lostReasonsData.slice(0, 5).map((data, index) => (
                <div key={data.reason} className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-red-100 flex items-center justify-center text-red-600 font-medium text-sm">
                    {index + 1}
                  </div>
                  <div className="flex-1">
                    <div className="flex justify-between">
                      <span className="text-gray-700">{data.reason}</span>
                      <span className="font-medium text-gray-800">{data.count}x</span>
                    </div>
                    <div className="text-xs text-gray-400">{formatCurrency(data.value)} verlorener ARR</div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-8 text-gray-400">
              <p>Noch keine verlorenen Deals</p>
            </div>
          )}
        </div>
      </div>

      {/* Monthly Forecast */}
      <div className="bg-white rounded-xl shadow-sm p-6">
        <h3 className="text-lg font-medium text-gray-800 mb-4">📅 Forecast nach Monat</h3>
        {monthlyForecast.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b">
                  <th className="text-left py-2 text-gray-600 font-medium">Monat</th>
                  <th className="text-right py-2 text-gray-600 font-medium">Deals</th>
                  <th className="text-right py-2 text-gray-600 font-medium">Pipeline</th>
                  <th className="text-right py-2 text-gray-600 font-medium">Gewichtet</th>
                </tr>
              </thead>
              <tbody>
                {monthlyForecast.map((data) => (
                  <tr key={data.month} className="border-b last:border-0">
                    <td className="py-3 font-medium">{data.month}</td>
                    <td className="py-3 text-right text-gray-600">{data.count}</td>
                    <td className="py-3 text-right text-gray-600">{formatCurrency(data.total)}</td>
                    <td className="py-3 text-right font-medium text-blue-600">{formatCurrency(data.weighted)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-gray-50 font-bold">
                  <td className="py-3">Gesamt</td>
                  <td className="py-3 text-right">{monthlyForecast.reduce((sum, d) => sum + d.count, 0)}</td>
                  <td className="py-3 text-right">{formatCurrency(monthlyForecast.reduce((sum, d) => sum + d.total, 0))}</td>
                  <td className="py-3 text-right text-blue-600">{formatCurrency(monthlyForecast.reduce((sum, d) => sum + d.weighted, 0))}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        ) : (
          <div className="text-center py-8 text-gray-400">
            <p>Keine aktiven Deals mit Expected Close Date</p>
          </div>
        )}
      </div>
    </div>
  );
}
