'use client';

import { useState, useMemo, useEffect } from 'react';
import { User, isPlannable, canReceiveGoLives, MONTH_NAMES } from '@/lib/types';
import { useLanguage } from '@/lib/LanguageContext';
import { useAllUsers, useMultiUserData } from '@/lib/hooks';
import { calculateYearSummary, formatCurrency, formatPercent, getAchievementColor } from '@/lib/calculations';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, AreaChart, Area, ComposedChart, Bar } from 'recharts';
import PDFExportButton from './PDFExportButton';
import { useRef } from 'react';
import { PerformanceChart, GoLivesBarChart, PayPerformanceChart } from './TrendCharts';
import { supabase } from '@/lib/supabase';

/** Form für YTD-Monatsdaten (IST + Plan, wie Jahresübersicht) */
interface YtdMonthlyRow {
  month: number;
  go_lives_count: number;
  go_lives_target: number;
  terminals_count: number;
  terminal_penetration: number;
  subs_actual: number;
  subs_target: number;
  pay_actual: number;
  pay_target: number;
}

interface DLTStrategicReportsProps {
  user: User;
}

interface DLTPlanzahlen {
  year: number;
  region: string;
  business_inbound: number[];
  business_outbound: number[];
  business_partnerships: number[];
  business_terminal_sales: number[];
  business_tipping: number[];
  avg_subs_bill: number;
  avg_pay_bill_terminal: number;
  avg_pay_bill_tipping: number;
}

const MONTH_NAMES_SHORT = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];

export default function DLTStrategicReports({ user }: DLTStrategicReportsProps) {
  const { t } = useLanguage();
  const currentYear = new Date().getFullYear();
  const currentMonth = new Date().getMonth();
  const [selectedYear, setSelectedYear] = useState(currentYear);
  const [reportType, setReportType] = useState<'trend' | 'forecast' | 'ytd'>('trend');
  const exportRef = useRef<HTMLDivElement>(null);
  
  // Load all users
  const { users, loading: usersLoading } = useAllUsers();

  // DLT-Settings (Planzahlen) sind die zentrale Quelle für Plan-Ziele.
  const [planzahlen, setPlanzahlen] = useState<DLTPlanzahlen | null>(null);
  const [planzahlenLoading, setPlanzahlenLoading] = useState(true);
  useEffect(() => {
    const fetchPlanzahlen = async () => {
      setPlanzahlenLoading(true);
      const { data, error } = await supabase
        .from('dlt_planzahlen')
        .select('*')
        .eq('year', selectedYear)
        .single();

      if (error && error.code !== 'PGRST116') {
        console.error('DLT Planzahlen load error:', error);
        setPlanzahlen(null);
      } else {
        setPlanzahlen((data as DLTPlanzahlen) || null);
      }
      setPlanzahlenLoading(false);
    };
    fetchPlanzahlen();
  }, [selectedYear]);

  // Filter: plannable Users (für Targets) und Go-Live Empfänger (für IST)
  const plannableUsers = useMemo(
    () => users.filter(u => isPlannable(u.role)),
    [users]
  );
  const goLiveReceivers = useMemo(
    () => users.filter(u => canReceiveGoLives(u.role)),
    [users]
  );
  
  // Load multi-user data (gleiche Quelle wie Jahresübersicht / Monatliche Übersicht)
  // - Go-Lives: alle Go-Live Empfänger (IST)
  // - Settings/Targets: nur plannable Users (AEs)
  const goLiveReceiverIds = useMemo(() => goLiveReceivers.map(u => u.id), [goLiveReceivers]);
  const plannableUserIds = useMemo(() => plannableUsers.map(u => u.id), [plannableUsers]);
  const { settings: multiSettings, goLives: multiGoLives, combined, loading: dataLoading } = useMultiUserData(
    goLiveReceiverIds,
    selectedYear,
    plannableUserIds
  );

  const planTargets = useMemo(() => {
    if (!planzahlen) return null;
    const pad = (arr: number[] = []) => Array.from({ length: 12 }, (_, i) => arr[i] ?? 0);
    const inbound = pad(planzahlen.business_inbound);
    const outbound = pad(planzahlen.business_outbound);
    const partnerships = pad(planzahlen.business_partnerships);
    const terminalSales = pad(planzahlen.business_terminal_sales);
    const tipping = pad(planzahlen.business_tipping);
    const goLivesTarget = inbound.map((v, i) => v + outbound[i] + partnerships[i]);
    const subsTarget = goLivesTarget.map((v) => v * (planzahlen.avg_subs_bill || 0) * 12);
    const payTarget = terminalSales.map((v, i) =>
      (v * (planzahlen.avg_pay_bill_terminal || 0) * 12) + (tipping[i] * (planzahlen.avg_pay_bill_tipping || 0) * 12)
    );
    return { goLivesTarget, subsTarget, payTarget };
  }, [planzahlen]);

  // Aggregation über combined (vom Hook bereits aggregiert) oder über Einzeluser
  const monthlyData = useMemo(() => {
    if (combined?.settings && combined?.goLives?.length >= 0) {
      const summary = calculateYearSummary(combined.goLives, combined.settings);
      let cumSubsARR = 0;
      let cumSubsTarget = 0;
      let cumPayARR = 0;
      let cumPayTarget = 0;
      return MONTH_NAMES_SHORT.map((name, idx) => {
        const r = summary.monthly_results[idx];
        if (!r) return { name, month: idx + 1, subsARR: 0, subsTarget: 0, payARR: 0, payTarget: 0, goLives: 0, goLivesTarget: 0, cumSubsARR: 0, cumSubsTarget: 0, cumPayARR: 0, cumPayTarget: 0, cumTotalARR: 0, cumTotalTarget: 0 };
        const subsTarget = planTargets ? planTargets.subsTarget[idx] : r.subs_target;
        const payTarget = planTargets ? planTargets.payTarget[idx] : r.pay_target;
        const goLivesTarget = planTargets ? planTargets.goLivesTarget[idx] : r.go_lives_target;
        cumSubsARR += r.subs_actual;
        cumSubsTarget += subsTarget;
        cumPayARR += r.pay_actual;
        cumPayTarget += payTarget;
        return {
          name,
          month: idx + 1,
          subsARR: r.subs_actual,
          subsTarget,
          // Pay IST: Finance-Actual oder Forecast (zentrale Berechnungslogik)
          payARR: r.pay_actual,
          payTarget,
          goLives: r.go_lives_count,
          goLivesTarget,
          cumSubsARR,
          cumSubsTarget,
          cumPayARR,
          cumPayTarget,
          cumTotalARR: cumSubsARR + cumPayARR,
          cumTotalTarget: cumSubsTarget + cumPayTarget
        };
      });
    }
    if (!multiSettings || !multiGoLives || goLiveReceiverIds.length === 0) return [];

    const data = MONTH_NAMES_SHORT.map((name, idx) => ({
      name,
      month: idx + 1,
      subsARR: 0,
      subsTarget: 0,
      payARR: 0,
      payTarget: 0,
      goLives: 0,
      goLivesTarget: 0,
      cumSubsARR: 0,
      cumSubsTarget: 0,
      cumPayARR: 0,
      cumPayTarget: 0,
      cumTotalARR: 0,
      cumTotalTarget: 0
    }));
    let cumSubsARR = 0;
    let cumSubsTarget = 0;
    let cumPayARR = 0;
    let cumPayTarget = 0;
    goLiveReceiverIds.forEach(uid => {
      const settings = multiSettings.get(uid);
      const goLives = multiGoLives.get(uid) ?? [];
      if (!settings) return;
      const summary = calculateYearSummary(goLives, settings);
      summary.monthly_results.forEach((result, idx) => {
        data[idx].subsARR += result.subs_actual;
        data[idx].subsTarget += result.subs_target;
        // Pay IST: Finance-Actual oder Forecast (zentrale Berechnungslogik)
        data[idx].payARR += result.pay_actual;
        data[idx].payTarget += result.pay_target;
        data[idx].goLives += result.go_lives_count;
        data[idx].goLivesTarget += result.go_lives_target;
      });
    });

    if (planTargets) {
      data.forEach((month, idx) => {
        month.subsTarget = planTargets.subsTarget[idx];
        month.payTarget = planTargets.payTarget[idx];
        month.goLivesTarget = planTargets.goLivesTarget[idx];
      });
    }
    data.forEach((month, idx) => {
      cumSubsARR += month.subsARR;
      cumSubsTarget += month.subsTarget;
      data[idx].cumSubsARR = cumSubsARR;
      data[idx].cumSubsTarget = cumSubsTarget;
      cumPayARR += month.payARR;
      cumPayTarget += month.payTarget;
      data[idx].cumPayARR = cumPayARR;
      data[idx].cumPayTarget = cumPayTarget;
      data[idx].cumTotalARR = cumSubsARR + cumPayARR;
      data[idx].cumTotalTarget = cumSubsTarget + cumPayTarget;
    });

    return data;
  }, [combined, multiSettings, multiGoLives, goLiveReceiverIds, planTargets]);

  // Forecast data (simple linear projection)
  const forecastData = useMemo(() => {
    if (monthlyData.length === 0) return [];

    // Calculate average growth rate from actual data
    const actualMonths = monthlyData.filter((m, idx) => idx <= currentMonth);
    if (actualMonths.length < 2) return monthlyData;

    const avgGrowth = actualMonths.reduce((sum, m) => sum + m.subsARR, 0) / actualMonths.length;
    
    return monthlyData.map((month, idx) => {
      if (idx <= currentMonth) {
        return { ...month, forecast: month.subsARR, isActual: true };
      }
      // Simple forecast based on average
      return { 
        ...month, 
        forecast: avgGrowth * (1 + (idx - currentMonth) * 0.02), // 2% growth per month
        isActual: false 
      };
    });
  }, [monthlyData, currentMonth]);

  // YTD: aus monthlyData (bereits aus combined oder Maps aggregiert)
  const ytdMonthlyResult = useMemo((): YtdMonthlyRow[] => {
    const allGoLives = combined?.goLives ?? Array.from(multiGoLives?.values() ?? []).flat();
    return Array.from({ length: 12 }, (_, i) => {
      const m = monthlyData[i];
      const goLives = m?.goLives ?? 0;
      const terminals = allGoLives.filter(g => g.month === i + 1 && g.has_terminal).length;
      return {
        month: i + 1,
        go_lives_count: goLives,
        go_lives_target: m?.goLivesTarget ?? 0,
        terminals_count: terminals,
        terminal_penetration: goLives > 0 ? terminals / goLives : 0,
        subs_actual: m?.subsARR ?? 0,
        subs_target: m?.subsTarget ?? 0,
        // Pay IST: Finance-Actual oder Forecast
        pay_actual: m?.payARR ?? 0,
        pay_target: m?.payTarget ?? 0,
      };
    });
  }, [monthlyData, combined, multiGoLives]);

  const ytdSummary = useMemo(() => {
    const ytdData = ytdMonthlyResult.slice(0, currentMonth + 1);
    const totalSubsArr = ytdData.reduce((s, r) => s + r.subs_actual, 0);
    const totalSubsTarget = ytdData.reduce((s, r) => s + r.subs_target, 0);
    const totalPayArr = ytdData.reduce((s, r) => s + r.pay_actual, 0);
    const totalPayTarget = ytdData.reduce((s, r) => s + r.pay_target, 0);
    return {
      totalSubsARR: totalSubsArr,
      totalSubsTarget,
      totalPayARR: totalPayArr,
      totalPayTarget,
      totalAllInARR: totalSubsArr + totalPayArr,
      totalAllInTarget: totalSubsTarget + totalPayTarget,
      totalGoLives: ytdData.reduce((s, r) => s + r.go_lives_count, 0),
      totalGoLivesTarget: ytdData.reduce((s, r) => s + r.go_lives_target, 0),
      totalTerminals: ytdData.reduce((s, r) => s + r.terminals_count, 0),
      monthsCompleted: currentMonth + 1,
    };
  }, [ytdMonthlyResult, currentMonth]);

  const fullYearTotals = useMemo(() => ({
    totalGoLives: ytdMonthlyResult.reduce((s, r) => s + r.go_lives_count, 0),
    totalTerminals: ytdMonthlyResult.reduce((s, r) => s + r.terminals_count, 0),
    totalSubsTarget: ytdMonthlyResult.reduce((s, r) => s + r.subs_target, 0),
    totalSubsARR: ytdMonthlyResult.reduce((s, r) => s + r.subs_actual, 0),
    totalPayTarget: ytdMonthlyResult.reduce((s, r) => s + r.pay_target, 0),
    totalPayARR: ytdMonthlyResult.reduce((s, r) => s + r.pay_actual, 0),
  }), [ytdMonthlyResult]);

  // Bill-KPIs sollen auf DLT-Settings-Planzahlen basieren.
  const planBillMetrics = useMemo(() => {
    if (!planzahlen || !planTargets) return null;
    const yearlyGoLivesGoal = planTargets.goLivesTarget.reduce((s, v) => s + v, 0);
    const yearlyPayGoal = planTargets.payTarget.reduce((s, v) => s + v, 0);
    const subsBill = planzahlen.avg_subs_bill || 0;
    const payBill = yearlyGoLivesGoal > 0 ? yearlyPayGoal / (yearlyGoLivesGoal * 12) : 0;
    return {
      subsBill,
      payBill,
      payBillTerminal: planzahlen.avg_pay_bill_terminal || 0,
      payBillTipping: planzahlen.avg_pay_bill_tipping || 0,
      allInBill: subsBill + payBill
    };
  }, [planzahlen, planTargets]);

  const loading = usersLoading || dataLoading || planzahlenLoading;

  if (loading) {
    return (
      <main className="max-w-7xl mx-auto px-4 py-8">
        <div className="flex items-center justify-center h-64">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-green-600 mx-auto mb-4"></div>
            <p className="text-gray-500">{t('ui.loading')}</p>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="max-w-7xl mx-auto px-4 py-8">
      {/* Title & Controls */}
      <div className="flex flex-col md:flex-row md:items-center justify-between mb-8 gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-800 flex items-center gap-3">
            <span className="text-3xl">📈</span>
            {t('dlt.reports.title')}
          </h1>
          <p className="text-gray-500 mt-1">{t('dlt.reports.subtitle')}</p>
        </div>
        
        <div className="flex items-center gap-4">
          <PDFExportButton
            targetRef={exportRef}
            baseFilename="DLT_Strategic_Report"
            year={selectedYear}
            title={`${t('dlt.reports.title')} ${selectedYear}`}
            subtitle="DLT - Director Leadership Team"
            orientation="landscape"
            variant="secondary"
            size="md"
          />
          
          <select
            value={selectedYear}
            onChange={(e) => setSelectedYear(Number(e.target.value))}
            className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
          >
            {[currentYear - 1, currentYear, currentYear + 1].map(year => (
              <option key={year} value={year}>{year}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Report Type Tabs */}
      <div className="flex gap-2 mb-6">
        {[
          { id: 'trend', label: t('dlt.reports.trendAnalysis'), icon: '📊' },
          { id: 'forecast', label: t('dlt.reports.forecast'), icon: '🔮' },
          { id: 'ytd', label: t('dlt.reports.ytdSummary'), icon: '📋' }
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => setReportType(tab.id as typeof reportType)}
            className={`px-4 py-2 rounded-lg font-medium transition-colors flex items-center gap-2 ${
              reportType === tab.id
                ? 'bg-green-600 text-white'
                : 'bg-white text-gray-600 hover:bg-gray-100 border border-gray-200'
            }`}
          >
            <span>{tab.icon}</span>
            {tab.label}
          </button>
        ))}
      </div>

      {/* Export Container */}
      <div ref={exportRef}>
        {/* Trend Analysis */}
        {reportType === 'trend' && (
          <div className="space-y-6">
            {/* Cumulative Subs ARR Chart */}
            <div className="bg-white rounded-xl shadow-sm p-6">
              <h3 className="text-lg font-semibold text-gray-800 mb-4">Kummulierter Subs ARR</h3>
              <ResponsiveContainer width="100%" height={350}>
                <AreaChart data={monthlyData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="name" />
                  <YAxis tickFormatter={(val) => `${(val / 1000000).toFixed(1)}M`} />
                  <Tooltip 
                    formatter={(value: number) => formatCurrency(value)}
                    labelFormatter={(label) => `${label} ${selectedYear}`}
                  />
                  <Legend />
                  <Area 
                    type="monotone" 
                    dataKey="cumSubsARR" 
                    name="Subs ARR IST"
                    stroke="#10B981" 
                    fill="#10B98133"
                    strokeWidth={2}
                  />
                  <Area 
                    type="monotone" 
                    dataKey="cumSubsTarget" 
                    name="Subs ARR Ziel"
                    stroke="#6B7280" 
                    fill="#6B728033"
                    strokeWidth={2}
                    strokeDasharray="5 5"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>

            {/* Cumulative Pay ARR Chart */}
            <div className="bg-white rounded-xl shadow-sm p-6">
              <h3 className="text-lg font-semibold text-gray-800 mb-4">Kummulierter Pay ARR</h3>
              <ResponsiveContainer width="100%" height={350}>
                <AreaChart data={monthlyData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="name" />
                  <YAxis tickFormatter={(val) => `${(val / 1000000).toFixed(1)}M`} />
                  <Tooltip 
                    formatter={(value: number) => formatCurrency(value)}
                    labelFormatter={(label) => `${label} ${selectedYear}`}
                  />
                  <Legend />
                  <Area 
                    type="monotone" 
                    dataKey="cumPayARR" 
                    name="Pay ARR IST"
                    stroke="#F97316" 
                    fill="#F9731633"
                    strokeWidth={2}
                  />
                  <Area 
                    type="monotone" 
                    dataKey="cumPayTarget" 
                    name="Pay ARR Ziel"
                    stroke="#6B7280" 
                    fill="#6B728033"
                    strokeWidth={2}
                    strokeDasharray="5 5"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>

            {/* Cumulative Total ARR Chart */}
            <div className="bg-white rounded-xl shadow-sm p-6">
              <h3 className="text-lg font-semibold text-gray-800 mb-4">Kummulierter Gesamt ARR</h3>
              <ResponsiveContainer width="100%" height={350}>
                <AreaChart data={monthlyData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="name" />
                  <YAxis tickFormatter={(val) => `${(val / 1000000).toFixed(1)}M`} />
                  <Tooltip 
                    formatter={(value: number) => formatCurrency(value)}
                    labelFormatter={(label) => `${label} ${selectedYear}`}
                  />
                  <Legend />
                  <Area 
                    type="monotone" 
                    dataKey="cumTotalARR" 
                    name="Gesamt ARR IST"
                    stroke="#3B82F6" 
                    fill="#3B82F633"
                    strokeWidth={2}
                  />
                  <Area 
                    type="monotone" 
                    dataKey="cumTotalTarget" 
                    name="Gesamt ARR Ziel"
                    stroke="#6B7280" 
                    fill="#6B728033"
                    strokeWidth={2}
                    strokeDasharray="5 5"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>

            {/* Monthly Comparison */}
            <div className="bg-white rounded-xl shadow-sm p-6">
              <h3 className="text-lg font-semibold text-gray-800 mb-4">{t('dlt.reports.monthlyARR')}</h3>
              <ResponsiveContainer width="100%" height={300}>
                <ComposedChart data={monthlyData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="name" />
                  <YAxis tickFormatter={(val) => `${(val / 1000).toFixed(0)}k`} />
                  <Tooltip formatter={(value: number) => formatCurrency(value)} />
                  <Legend />
                  <Bar dataKey="subsARR" name={t('dlt.kpi.subsARR')} fill="#3B82F6" />
                  <Line type="monotone" dataKey="subsTarget" name={t('dlt.kpi.target')} stroke="#EF4444" strokeWidth={2} dot={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        {/* Forecast */}
        {reportType === 'forecast' && (
          <div className="space-y-6">
            <div className="bg-white rounded-xl shadow-sm p-6">
              <h3 className="text-lg font-semibold text-gray-800 mb-4">{t('dlt.reports.arrForecast')}</h3>
              <ResponsiveContainer width="100%" height={400}>
                <ComposedChart data={forecastData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="name" />
                  <YAxis tickFormatter={(val) => `${(val / 1000).toFixed(0)}k`} />
                  <Tooltip formatter={(value: number) => formatCurrency(value)} />
                  <Legend />
                  <Bar 
                    dataKey="subsARR" 
                    name={t('dlt.reports.actualARR')}
                    fill="#10B981" 
                  />
                  <Line 
                    type="monotone" 
                    dataKey="forecast" 
                    name={t('dlt.reports.forecast')}
                    stroke="#F59E0B" 
                    strokeWidth={2}
                    strokeDasharray="5 5"
                  />
                  <Line 
                    type="monotone" 
                    dataKey="subsTarget" 
                    name={t('dlt.kpi.target')}
                    stroke="#EF4444" 
                    strokeWidth={2}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>

            {/* Forecast Info */}
            <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-6">
              <div className="flex items-start gap-3">
                <span className="text-2xl">🔮</span>
                <div>
                  <h4 className="font-semibold text-yellow-800 mb-1">{t('dlt.reports.forecastNote')}</h4>
                  <p className="text-sm text-yellow-700">
                    {t('dlt.reports.forecastDescription')}
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* YTD Summary – wie Jahresübersicht, basierend auf zentralen DLT-Settings (ohne Provision) */}
        {reportType === 'ytd' && (
          <div className="space-y-6">
            {/*
              Bill-KPIs basieren auf DLT-Settings-Planzahlen.
              Dadurch gilt konsistent: Subs Bill + Pay Bill = All-in Bill.
            */}
            {(() => {
              const monthlySubsBill = planBillMetrics?.subsBill ?? 0;
              const monthlyPayBill = planBillMetrics?.payBill ?? 0;
              const monthlyAllInBill = planBillMetrics?.allInBill ?? 0;
              const hasBillMetrics = !!planBillMetrics;
              return (
                <>
            {/* Reihe 1: Basis-KPIs (wie Jahresübersicht) */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2 md:gap-4">
              <div className="bg-white rounded-lg md:rounded-xl shadow-sm p-3 md:p-4">
                <span className="text-xs md:text-sm text-gray-500">Go-Lives</span>
                <p className="text-lg md:text-2xl font-bold text-gray-800">{ytdSummary.totalGoLives}</p>
                <p className="text-xs text-gray-500 mt-1">{t('dlt.kpi.target')}: {ytdSummary.totalGoLivesTarget}</p>
              </div>
              <div className="bg-white rounded-lg md:rounded-xl shadow-sm p-3 md:p-4">
                <span className="text-xs md:text-sm text-gray-500">{t('yearOverview.terminals')}</span>
                <p className="text-lg md:text-2xl font-bold text-gray-800">{ytdSummary.totalTerminals}</p>
              </div>
              <div className="bg-white rounded-lg md:rounded-xl shadow-sm p-3 md:p-4">
                <span className="text-xs md:text-sm text-gray-500 truncate block">{t('yearOverview.avgMonthlySubsBill')}</span>
                <p className="text-lg md:text-2xl font-bold text-green-600">
                  {hasBillMetrics ? formatCurrency(monthlySubsBill) : '–'}
                </p>
              </div>
              <div className="bg-white rounded-lg md:rounded-xl shadow-sm p-3 md:p-4">
                <span className="text-xs md:text-sm text-gray-500 truncate block">{t('yearOverview.avgMonthlyPayBill')}</span>
                <p className="text-lg md:text-2xl font-bold text-orange-600">
                  {hasBillMetrics ? formatCurrency(monthlyPayBill) : '–'}
                </p>
                {hasBillMetrics && (
                  <p className="text-[10px] md:text-xs text-gray-500 mt-1">
                    Pay Bill (Terminal): {formatCurrency(planBillMetrics.payBillTerminal)} | Tipping: {formatCurrency(planBillMetrics.payBillTipping)}
                  </p>
                )}
              </div>
              <div className="bg-white rounded-lg md:rounded-xl shadow-sm p-3 md:p-4 col-span-2 sm:col-span-1">
                <span className="text-xs md:text-sm text-gray-500 truncate block">{t('yearOverview.avgMonthlyAllInBill')}</span>
                <p className="text-lg md:text-2xl font-bold text-blue-600">
                  {hasBillMetrics ? formatCurrency(monthlyAllInBill) : '–'}
                </p>
              </div>
            </div>

            <div className="text-xs text-gray-500 -mt-2">
              Basis: DLT-Settings-Planzahlen (Jahresziel) als Monatswert pro Go-Live. Daher gilt: Subs Bill + Pay Bill = All-in Bill.
            </div>

                <div className="bg-white rounded-lg md:rounded-xl shadow-sm p-3 md:p-4 border border-gray-200">
                  <div className="text-xs md:text-sm text-gray-600 mb-2">
                    Berücksichtigte Monate (YTD):
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {MONTH_NAMES_SHORT.slice(0, currentMonth + 1).map((month) => (
                      <span
                        key={month}
                        className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-blue-50 text-blue-700 border border-blue-200"
                      >
                        {month}
                      </span>
                    ))}
                  </div>
                </div>

            {/* Reihe 2: ARR YTD vs Ziel mit Fortschrittsbalken */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 md:gap-4">
              <div className="bg-white rounded-lg md:rounded-xl shadow-sm p-3 md:p-4 border-l-4 border-green-500">
                <span className="text-xs md:text-sm text-gray-500">Subs ARR YTD vs Goal YTD</span>
                <p className="text-base md:text-xl font-bold text-green-600">
                  {formatCurrency(ytdSummary.totalSubsARR)} <span className="text-gray-400 font-normal">/</span>{' '}
                  <span className="text-green-400">{formatCurrency(ytdSummary.totalSubsTarget)}</span>
                </p>
                <div className="mt-1.5 md:mt-2 h-1.5 md:h-2 bg-gray-200 rounded-full overflow-hidden">
                  <div className="h-full bg-green-500 rounded-full transition-all" style={{ width: `${Math.min(ytdSummary.totalSubsTarget > 0 ? (ytdSummary.totalSubsARR / ytdSummary.totalSubsTarget) * 100 : 0, 100)}%` }} />
                </div>
                <p className="text-[10px] md:text-xs text-gray-500 mt-1">
                  {ytdSummary.totalSubsTarget > 0 ? ((ytdSummary.totalSubsARR / ytdSummary.totalSubsTarget) * 100).toFixed(1) : 0}% {t('yearOverview.achieved')}
                </p>
              </div>
              <div className="bg-white rounded-lg md:rounded-xl shadow-sm p-3 md:p-4 border-l-4 border-orange-500">
                <span className="text-xs md:text-sm text-gray-500">Pay ARR YTD vs Goal YTD</span>
                <p className="text-base md:text-xl font-bold text-orange-600">
                  {formatCurrency(ytdSummary.totalPayARR)} <span className="text-gray-400 font-normal">/</span>{' '}
                  <span className="text-orange-400">{formatCurrency(ytdSummary.totalPayTarget)}</span>
                </p>
                <div className="mt-1.5 md:mt-2 h-1.5 md:h-2 bg-gray-200 rounded-full overflow-hidden">
                  <div className="h-full bg-orange-500 rounded-full transition-all" style={{ width: `${Math.min(ytdSummary.totalPayTarget > 0 ? (ytdSummary.totalPayARR / ytdSummary.totalPayTarget) * 100 : 0, 100)}%` }} />
                </div>
                <p className="text-[10px] md:text-xs text-gray-500 mt-1">
                  {ytdSummary.totalPayTarget > 0 ? ((ytdSummary.totalPayARR / ytdSummary.totalPayTarget) * 100).toFixed(1) : 0}% {t('yearOverview.achieved')}
                </p>
              </div>
              <div className="bg-white rounded-lg md:rounded-xl shadow-sm p-3 md:p-4 border-l-4 border-blue-500">
                <span className="text-xs md:text-sm text-gray-500">All-in ARR YTD vs Goal YTD</span>
                <p className="text-base md:text-xl font-bold text-blue-600">
                  {formatCurrency(ytdSummary.totalAllInARR)} <span className="text-gray-400 font-normal">/</span>{' '}
                  <span className="text-blue-400">{formatCurrency(ytdSummary.totalAllInTarget)}</span>
                </p>
                <div className="mt-1.5 md:mt-2 h-1.5 md:h-2 bg-gray-200 rounded-full overflow-hidden">
                  <div className="h-full bg-blue-500 rounded-full transition-all" style={{ width: `${Math.min(ytdSummary.totalAllInTarget > 0 ? (ytdSummary.totalAllInARR / ytdSummary.totalAllInTarget) * 100 : 0, 100)}%` }} />
                </div>
                <p className="text-[10px] md:text-xs text-gray-500 mt-1">
                  {ytdSummary.totalAllInTarget > 0 ? ((ytdSummary.totalAllInARR / ytdSummary.totalAllInTarget) * 100).toFixed(1) : 0}% {t('yearOverview.achieved')}
                </p>
              </div>
            </div>

            {/* Reihe 3: ARR YTD vs Jahresziel */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 md:gap-4">
              <div className="bg-white rounded-lg md:rounded-xl shadow-sm p-3 md:p-4 border-l-4 border-green-500">
                <span className="text-xs md:text-sm text-gray-500">Subs ARR YTD vs Yearly ARR Goal</span>
                <p className="text-base md:text-xl font-bold text-green-600">
                  {formatCurrency(ytdSummary.totalSubsARR)} <span className="text-gray-400 font-normal">/</span>{' '}
                  <span className="text-green-400">{formatCurrency(fullYearTotals.totalSubsTarget)}</span>
                </p>
                <div className="mt-1.5 md:mt-2 h-1.5 md:h-2 bg-gray-200 rounded-full overflow-hidden">
                  <div className="h-full bg-green-500 rounded-full transition-all" style={{ width: `${Math.min(fullYearTotals.totalSubsTarget > 0 ? (ytdSummary.totalSubsARR / fullYearTotals.totalSubsTarget) * 100 : 0, 100)}%` }} />
                </div>
                <p className="text-[10px] md:text-xs text-gray-500 mt-1">
                  {fullYearTotals.totalSubsTarget > 0 ? ((ytdSummary.totalSubsARR / fullYearTotals.totalSubsTarget) * 100).toFixed(1) : 0}% {t('yearOverview.achieved')}
                </p>
              </div>
              <div className="bg-white rounded-lg md:rounded-xl shadow-sm p-3 md:p-4 border-l-4 border-orange-500">
                <span className="text-xs md:text-sm text-gray-500">Pay ARR YTD vs Yearly ARR Goal</span>
                <p className="text-base md:text-xl font-bold text-orange-600">
                  {formatCurrency(ytdSummary.totalPayARR)} <span className="text-gray-400 font-normal">/</span>{' '}
                  <span className="text-orange-400">{formatCurrency(fullYearTotals.totalPayTarget)}</span>
                </p>
                <div className="mt-1.5 md:mt-2 h-1.5 md:h-2 bg-gray-200 rounded-full overflow-hidden">
                  <div className="h-full bg-orange-500 rounded-full transition-all" style={{ width: `${Math.min(fullYearTotals.totalPayTarget > 0 ? (ytdSummary.totalPayARR / fullYearTotals.totalPayTarget) * 100 : 0, 100)}%` }} />
                </div>
                <p className="text-[10px] md:text-xs text-gray-500 mt-1">
                  {fullYearTotals.totalPayTarget > 0 ? ((ytdSummary.totalPayARR / fullYearTotals.totalPayTarget) * 100).toFixed(1) : 0}% {t('yearOverview.achieved')}
                </p>
              </div>
              <div className="bg-white rounded-lg md:rounded-xl shadow-sm p-3 md:p-4 border-l-4 border-blue-500">
                <span className="text-xs md:text-sm text-gray-500">All-in ARR YTD vs Yearly ARR Goal</span>
                <p className="text-base md:text-xl font-bold text-blue-600">
                  {formatCurrency(ytdSummary.totalAllInARR)} <span className="text-gray-400 font-normal">/</span>{' '}
                  <span className="text-blue-400">{formatCurrency(fullYearTotals.totalSubsTarget + fullYearTotals.totalPayTarget)}</span>
                </p>
                <div className="mt-1.5 md:mt-2 h-1.5 md:h-2 bg-gray-200 rounded-full overflow-hidden">
                  <div className="h-full bg-blue-500 rounded-full transition-all" style={{ width: `${Math.min((fullYearTotals.totalSubsTarget + fullYearTotals.totalPayTarget) > 0 ? (ytdSummary.totalAllInARR / (fullYearTotals.totalSubsTarget + fullYearTotals.totalPayTarget)) * 100 : 0, 100)}%` }} />
                </div>
                <p className="text-[10px] md:text-xs text-gray-500 mt-1">
                  {(fullYearTotals.totalSubsTarget + fullYearTotals.totalPayTarget) > 0 ? ((ytdSummary.totalAllInARR / (fullYearTotals.totalSubsTarget + fullYearTotals.totalPayTarget)) * 100).toFixed(1) : 0}% {t('yearOverview.achieved')}
                </p>
              </div>
            </div>
                </>
              );
            })()}

            {/* Performance über Zeit (Subs + Pay IST/Ziel) */}
            <PerformanceChart monthlyResults={ytdMonthlyResult} showTargets={true} />

            {/* Pay-Entwicklung (nur Pay) */}
            <PayPerformanceChart monthlyResults={ytdMonthlyResult} />

            {/* Go-Lives pro Monat */}
            <GoLivesBarChart monthlyResults={ytdMonthlyResult} />

            {/* Monatliche Übersicht (ohne Provision) */}
            <div className="bg-white rounded-xl shadow-sm overflow-hidden">
              <div className="px-6 py-4 border-b border-gray-200">
                <h3 className="text-lg font-semibold text-gray-800">{t('yearOverview.monthlyOverview')}</h3>
                <p className="text-sm text-gray-500 mt-1">💡 {t('yearOverview.clickForDetails')}</p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">{t('dlt.reports.month')}</th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Go-Lives</th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Terminals</th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-green-600 uppercase">Subs Plan</th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-green-600 uppercase">Subs IST</th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">%</th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-orange-600 uppercase">Pay Plan</th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-orange-600 uppercase">Pay IST</th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">%</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {ytdMonthlyResult.map((r, idx) => {
                      const subsPct = r.subs_target > 0 ? r.subs_actual / r.subs_target : 0;
                      const payPct = r.pay_target > 0 ? r.pay_actual / r.pay_target : 0;
                      const isPast = idx <= currentMonth;
                      return (
                        <tr key={r.month} className={isPast ? '' : 'text-gray-400'}>
                          <td className="px-4 py-3 font-medium">{MONTH_NAMES[r.month - 1]}</td>
                          <td className="px-4 py-3 text-right">{r.go_lives_count}</td>
                          <td className="px-4 py-3 text-right">{r.terminals_count}</td>
                          <td className="px-4 py-3 text-right text-green-600">{formatCurrency(r.subs_target)}</td>
                          <td className="px-4 py-3 text-right text-green-700 font-medium">{formatCurrency(r.subs_actual)}</td>
                          <td className={`px-4 py-3 text-right font-medium ${getAchievementColor(subsPct)}`}>{formatPercent(subsPct)}</td>
                          <td className="px-4 py-3 text-right text-orange-600">{formatCurrency(r.pay_target)}</td>
                          <td className="px-4 py-3 text-right text-orange-700 font-medium">{formatCurrency(r.pay_actual)}</td>
                          <td className={`px-4 py-3 text-right font-medium ${getAchievementColor(payPct)}`}>{formatPercent(payPct)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot className="bg-gray-50 font-semibold">
                    <tr>
                      <td className="px-4 py-3">{t('dlt.reports.total')}</td>
                      <td className="px-4 py-3 text-right">{fullYearTotals.totalGoLives}</td>
                      <td className="px-4 py-3 text-right">{fullYearTotals.totalTerminals}</td>
                      <td className="px-4 py-3 text-right text-green-600">{formatCurrency(fullYearTotals.totalSubsTarget)}</td>
                      <td className="px-4 py-3 text-right text-green-700">{formatCurrency(fullYearTotals.totalSubsARR)}</td>
                      <td className={`px-4 py-3 text-right ${getAchievementColor(fullYearTotals.totalSubsTarget > 0 ? fullYearTotals.totalSubsARR / fullYearTotals.totalSubsTarget : 0)}`}>
                        {formatPercent(fullYearTotals.totalSubsTarget > 0 ? fullYearTotals.totalSubsARR / fullYearTotals.totalSubsTarget : 0)}
                      </td>
                      <td className="px-4 py-3 text-right text-orange-600">{formatCurrency(fullYearTotals.totalPayTarget)}</td>
                      <td className="px-4 py-3 text-right text-orange-700">{formatCurrency(fullYearTotals.totalPayARR)}</td>
                      <td className={`px-4 py-3 text-right ${getAchievementColor(fullYearTotals.totalPayTarget > 0 ? fullYearTotals.totalPayARR / fullYearTotals.totalPayTarget : 0)}`}>
                        {formatPercent(fullYearTotals.totalPayTarget > 0 ? fullYearTotals.totalPayARR / fullYearTotals.totalPayTarget : 0)}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
