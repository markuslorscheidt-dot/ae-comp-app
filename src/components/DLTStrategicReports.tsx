'use client';

import { useState, useMemo, useEffect } from 'react';
import { User, GoLive, isPlannable, canReceiveGoLives, MONTH_NAMES } from '@/lib/types';
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

interface ChurnEventRow {
  churn_month: string | null;
  scheduled: boolean | null;
  total_arr_lost: number | null;
}

interface MonthlyChurnRow {
  month: number;
  scheduledCount: number;
  nonScheduledCount: number;
  scheduledArrLost: number;
  nonScheduledArrLost: number;
  totalCount: number;
  totalArrLost: number;
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
  const defaultYtdMonths = useMemo(
    () => Array.from(
      { length: selectedYear < currentYear ? 12 : currentMonth + 1 },
      (_, idx) => idx + 1
    ),
    [selectedYear, currentYear, currentMonth]
  );
  const visibleYtdMonths = useMemo(
    () => Array.from({ length: 12 }, (_, idx) => idx + 1),
    []
  );
  const [reportType, setReportType] = useState<'trend' | 'forecast' | 'ytd'>('trend');
  const [selectedYtdMonths, setSelectedYtdMonths] = useState<number[]>(defaultYtdMonths);
  const [selectedMonthDetail, setSelectedMonthDetail] = useState<number | null>(null);
  const [churnEvents, setChurnEvents] = useState<ChurnEventRow[]>([]);
  const [churnLoading, setChurnLoading] = useState(true);
  const [payIstInputsByGoLiveId, setPayIstInputsByGoLiveId] = useState<Record<string, string>>({});
  const [savingPayIstByGoLiveId, setSavingPayIstByGoLiveId] = useState<Record<string, boolean>>({});
  const [payIstErrorByGoLiveId, setPayIstErrorByGoLiveId] = useState<Record<string, string>>({});
  const exportRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setSelectedYtdMonths(defaultYtdMonths);
  }, [defaultYtdMonths]);

  useEffect(() => {
    let active = true;

    const fetchChurnEvents = async () => {
      setChurnLoading(true);
      const from = `${selectedYear}-01-01`;
      const to = `${selectedYear + 1}-01-01`;

      const { data, error } = await supabase
        .from('churn_events')
        .select('churn_month, scheduled, total_arr_lost')
        .gte('churn_month', from)
        .lt('churn_month', to);

      if (!active) return;

      if (error) {
        console.error('Churn load error:', error);
        setChurnEvents([]);
      } else {
        setChurnEvents((data as ChurnEventRow[]) || []);
      }
      setChurnLoading(false);
    };

    fetchChurnEvents();
    return () => {
      active = false;
    };
  }, [selectedYear]);
  
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
  const { settings: multiSettings, goLives: multiGoLives, combined, loading: dataLoading, refetch: refetchMultiData } = useMultiUserData(
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

  const allGoLives = useMemo<GoLive[]>(
    () => combined?.goLives ?? Array.from(multiGoLives?.values() ?? []).flat(),
    [combined, multiGoLives]
  );

  const monthDetailGoLives = useMemo(
    () =>
      selectedMonthDetail
        ? allGoLives
            .filter((g) => g.month === selectedMonthDetail)
            .sort((a, b) => new Date(a.go_live_date).getTime() - new Date(b.go_live_date).getTime())
        : [],
    [allGoLives, selectedMonthDetail]
  );

  const userNameById = useMemo(() => new Map(users.map((u) => [u.id, u.name])), [users]);

  // Gleiche PAY-Logik wie in calculations.ts (Reporting):
  // 1) pay_arr (Ist), 2) pay_arr_target (Forecast), 3) Terminal-Default aus Settings (avg_pay_bill * 12)
  const getEffectiveGoLivePayArr = (gl: GoLive): number => {
    if (gl.pay_arr !== null && gl.pay_arr !== undefined) return gl.pay_arr;
    if (gl.pay_arr_target !== null && gl.pay_arr_target !== undefined) return gl.pay_arr_target;
    if (!gl.has_terminal) return 0;
    const userSettings = multiSettings?.get(gl.user_id);
    const fallbackAvgPayBill = userSettings?.avg_pay_bill ?? combined?.settings?.avg_pay_bill ?? 0;
    return fallbackAvgPayBill * 12;
  };

  useEffect(() => {
    if (!selectedMonthDetail) return;
    const nextInputs: Record<string, string> = {};
    monthDetailGoLives.forEach((gl) => {
      nextInputs[gl.id] = gl.pay_arr !== null && gl.pay_arr !== undefined
        ? String(Math.round((gl.pay_arr / 12) * 100) / 100)
        : '';
    });
    setPayIstInputsByGoLiveId(nextInputs);
    setSavingPayIstByGoLiveId({});
    setPayIstErrorByGoLiveId({});
  }, [selectedMonthDetail, monthDetailGoLives]);

  const getDraftPayIstMonthly = (gl: GoLive): number | null => {
    const raw = (payIstInputsByGoLiveId[gl.id] ?? '').trim();
    if (!raw) return null;
    const normalized = raw.replace(',', '.');
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : null;
  };

  const getEffectiveGoLivePayArrForDisplay = (gl: GoLive): number => {
    const draftMonthly = getDraftPayIstMonthly(gl);
    if (draftMonthly !== null) return draftMonthly * 12;
    return getEffectiveGoLivePayArr(gl);
  };

  const handleSavePayIstForGoLive = async (gl: GoLive) => {
    const draftMonthly = getDraftPayIstMonthly(gl);
    setSavingPayIstByGoLiveId((prev) => ({ ...prev, [gl.id]: true }));
    setPayIstErrorByGoLiveId((prev) => ({ ...prev, [gl.id]: '' }));
    const nextPayArr = draftMonthly === null ? null : Math.round(draftMonthly * 12 * 100) / 100;

    const { error } = await supabase
      .from('go_lives')
      .update({ pay_arr: nextPayArr, updated_at: new Date().toISOString() })
      .eq('id', gl.id);

    if (error) {
      setPayIstErrorByGoLiveId((prev) => ({ ...prev, [gl.id]: error.message || 'Speichern fehlgeschlagen' }));
    } else {
      await refetchMultiData();
    }
    setSavingPayIstByGoLiveId((prev) => ({ ...prev, [gl.id]: false }));
  };

  // YTD: aus monthlyData (bereits aus combined oder Maps aggregiert)
  const ytdMonthlyResult = useMemo((): YtdMonthlyRow[] => {
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

  const ytdSelectedMonthlyResult = useMemo(
    () => ytdMonthlyResult.filter((row) => selectedYtdMonths.includes(row.month)),
    [ytdMonthlyResult, selectedYtdMonths]
  );

  const ytdSummary = useMemo(() => {
    const ytdData = ytdSelectedMonthlyResult;
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
      monthsCompleted: ytdData.length,
    };
  }, [ytdSelectedMonthlyResult]);

  const ytdSelectedTotals = useMemo(() => ({
    totalGoLives: ytdSelectedMonthlyResult.reduce((s, r) => s + r.go_lives_count, 0),
    totalTerminals: ytdSelectedMonthlyResult.reduce((s, r) => s + r.terminals_count, 0),
    totalSubsTarget: ytdSelectedMonthlyResult.reduce((s, r) => s + r.subs_target, 0),
    totalSubsARR: ytdSelectedMonthlyResult.reduce((s, r) => s + r.subs_actual, 0),
    totalPayTarget: ytdSelectedMonthlyResult.reduce((s, r) => s + r.pay_target, 0),
    totalPayARR: ytdSelectedMonthlyResult.reduce((s, r) => s + r.pay_actual, 0),
  }), [ytdSelectedMonthlyResult]);

  const monthlyChurnData = useMemo<MonthlyChurnRow[]>(
    () =>
      Array.from({ length: 12 }, (_, idx) => {
        const month = idx + 1;
        const monthEvents = churnEvents.filter((event) => {
          if (!event.churn_month) return false;
          const d = new Date(event.churn_month);
          if (Number.isNaN(d.getTime())) return false;
          return d.getMonth() + 1 === month;
        });

        const scheduledEvents = monthEvents.filter((event) => event.scheduled === true);
        const nonScheduledEvents = monthEvents.filter((event) => event.scheduled !== true);
        const scheduledArrLost = scheduledEvents.reduce((sum, event) => sum + (Number(event.total_arr_lost) || 0), 0);
        const nonScheduledArrLost = nonScheduledEvents.reduce((sum, event) => sum + (Number(event.total_arr_lost) || 0), 0);

        return {
          month,
          scheduledCount: scheduledEvents.length,
          nonScheduledCount: nonScheduledEvents.length,
          scheduledArrLost,
          nonScheduledArrLost,
          totalCount: monthEvents.length,
          totalArrLost: scheduledArrLost + nonScheduledArrLost,
        };
      }),
    [churnEvents]
  );

  const selectedMonthlyChurnData = useMemo(
    () => monthlyChurnData.filter((row) => selectedYtdMonths.includes(row.month)),
    [monthlyChurnData, selectedYtdMonths]
  );

  const selectedChurnTotals = useMemo(
    () =>
      selectedMonthlyChurnData.reduce(
        (acc, row) => ({
          scheduledCount: acc.scheduledCount + row.scheduledCount,
          nonScheduledCount: acc.nonScheduledCount + row.nonScheduledCount,
          scheduledArrLost: acc.scheduledArrLost + row.scheduledArrLost,
          nonScheduledArrLost: acc.nonScheduledArrLost + row.nonScheduledArrLost,
          totalCount: acc.totalCount + row.totalCount,
          totalArrLost: acc.totalArrLost + row.totalArrLost,
        }),
        {
          scheduledCount: 0,
          nonScheduledCount: 0,
          scheduledArrLost: 0,
          nonScheduledArrLost: 0,
          totalCount: 0,
          totalArrLost: 0,
        }
      ),
    [selectedMonthlyChurnData]
  );

  const ytdAllInAfterChurn = useMemo(() => {
    const allInArr = ytdSummary.totalAllInARR;
    const churnArr = selectedChurnTotals.totalArrLost;
    const netArr = allInArr - churnArr;
    const retentionPct = allInArr > 0 ? netArr / allInArr : 0;
    return { allInArr, churnArr, netArr, retentionPct };
  }, [ytdSummary.totalAllInARR, selectedChurnTotals.totalArrLost]);

  const selectedTerminalsTarget = useMemo(() => {
    if (!planzahlen) return null;
    const terminalTargets = Array.from({ length: 12 }, (_, idx) => planzahlen.business_terminal_sales?.[idx] ?? 0);
    return selectedYtdMonths.reduce((sum, month) => sum + (terminalTargets[month - 1] || 0), 0);
  }, [planzahlen, selectedYtdMonths]);

  const handleToggleYtdMonth = (month: number) => {
    setSelectedYtdMonths((prev) => {
      if (prev.includes(month)) {
        if (prev.length === 1) return prev;
        return prev.filter((m) => m !== month);
      }
      return [...prev, month].sort((a, b) => a - b);
    });
  };

  const fullYearTotals = useMemo(() => ({
    totalGoLives: ytdMonthlyResult.reduce((s, r) => s + r.go_lives_count, 0),
    totalTerminals: ytdMonthlyResult.reduce((s, r) => s + r.terminals_count, 0),
    totalSubsTarget: ytdMonthlyResult.reduce((s, r) => s + r.subs_target, 0),
    totalSubsARR: ytdMonthlyResult.reduce((s, r) => s + r.subs_actual, 0),
    totalPayTarget: ytdMonthlyResult.reduce((s, r) => s + r.pay_target, 0),
    totalPayARR: ytdMonthlyResult.reduce((s, r) => s + r.pay_actual, 0),
  }), [ytdMonthlyResult]);

  // Bill-KPIs basieren auf den aktuell ausgewählten Monaten (YTD-Filter).
  const selectedBillMetrics = useMemo(() => {
    if (selectedYtdMonths.length === 0) return null;
    const selectedRows = ytdMonthlyResult.filter((row) => selectedYtdMonths.includes(row.month));
    const totalGoLives = selectedRows.reduce((sum, row) => sum + row.go_lives_count, 0);
    const totalSubsArr = selectedRows.reduce((sum, row) => sum + row.subs_actual, 0);
    const totalPayArr = selectedRows.reduce((sum, row) => sum + row.pay_actual, 0);
    const totalSubsTarget = selectedRows.reduce((sum, row) => sum + row.subs_target, 0);
    const totalPayTarget = selectedRows.reduce((sum, row) => sum + row.pay_target, 0);
    const totalGoLivesTarget = selectedRows.reduce((sum, row) => sum + row.go_lives_target, 0);

    const subsBill = totalGoLives > 0 ? totalSubsArr / 12 / totalGoLives : 0;
    const payBill = totalGoLives > 0 ? totalPayArr / 12 / totalGoLives : 0;
    const subsBillTarget = totalGoLivesTarget > 0 ? totalSubsTarget / 12 / totalGoLivesTarget : 0;
    const payBillTarget = totalGoLivesTarget > 0 ? totalPayTarget / 12 / totalGoLivesTarget : 0;

    return {
      subsBill,
      payBill,
      subsBillTarget,
      payBillTarget,
      allInBill: subsBill + payBill,
      allInBillTarget: subsBillTarget + payBillTarget,
    };
  }, [ytdMonthlyResult, selectedYtdMonths]);

  const loading = usersLoading || dataLoading || planzahlenLoading || churnLoading;

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
              Bill-KPIs basieren auf den aktuell ausgewählten Monaten.
              Monthly Pay Bill = Summe Pay ARR / Summe Go-Lives (über alle ausgewählten Monate).
            */}
            {(() => {
              const monthlySubsBill = selectedBillMetrics?.subsBill ?? 0;
              const monthlyPayBill = selectedBillMetrics?.payBill ?? 0;
              const monthlyAllInBill = selectedBillMetrics?.allInBill ?? 0;
              const hasBillMetrics = !!selectedBillMetrics;
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
                <p className="text-xs text-gray-500 mt-1">
                  {t('dlt.kpi.target')}: {selectedTerminalsTarget !== null ? selectedTerminalsTarget : '–'}
                </p>
              </div>
              <div className="bg-white rounded-lg md:rounded-xl shadow-sm p-3 md:p-4">
                <span className="text-xs md:text-sm text-gray-500 truncate block">{t('yearOverview.avgMonthlySubsBill')}</span>
                <p className="text-lg md:text-2xl font-bold text-green-600">
                  {hasBillMetrics ? formatCurrency(monthlySubsBill) : '–'}
                </p>
                <p className="text-xs text-gray-500 mt-1">
                  {t('dlt.kpi.target')}: {hasBillMetrics ? formatCurrency(selectedBillMetrics.subsBillTarget) : '–'}
                </p>
              </div>
              <div className="bg-white rounded-lg md:rounded-xl shadow-sm p-3 md:p-4">
                <span className="text-xs md:text-sm text-gray-500 truncate block">{t('yearOverview.avgMonthlyPayBill')}</span>
                <p className="text-lg md:text-2xl font-bold text-orange-600">
                  {hasBillMetrics ? formatCurrency(monthlyPayBill) : '–'}
                </p>
                <p className="text-xs text-gray-500 mt-1">
                  {t('dlt.kpi.target')}: {hasBillMetrics ? formatCurrency(selectedBillMetrics.payBillTarget) : '–'}
                </p>
              </div>
              <div className="bg-white rounded-lg md:rounded-xl shadow-sm p-3 md:p-4 col-span-2 sm:col-span-1">
                <span className="text-xs md:text-sm text-gray-500 truncate block">{t('yearOverview.avgMonthlyAllInBill')}</span>
                <p className="text-lg md:text-2xl font-bold text-blue-600">
                  {hasBillMetrics ? formatCurrency(monthlyAllInBill) : '–'}
                </p>
                <p className="text-xs text-gray-500 mt-1">
                  {t('dlt.kpi.target')}: {hasBillMetrics ? formatCurrency(selectedBillMetrics.allInBillTarget) : '–'}
                </p>
              </div>
            </div>

            <div className="text-xs text-gray-500 -mt-2">
              Basis: (Summe ARR / 12) / Summe Go-Lives über die ausgewählten Monate. Daher gilt: Subs Bill + Pay Bill = All-in Bill.
            </div>

                <div className="bg-white rounded-lg md:rounded-xl shadow-sm p-3 md:p-4 border border-gray-200">
                  <div className="text-xs md:text-sm text-gray-600 mb-2">
                    Berücksichtigte Monate (YTD):
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {visibleYtdMonths.map((monthNum) => (
                      <button
                        key={monthNum}
                        type="button"
                        onClick={() => handleToggleYtdMonth(monthNum)}
                        className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium border transition ${
                          selectedYtdMonths.includes(monthNum)
                            ? 'bg-blue-50 text-blue-700 border-blue-200'
                            : 'bg-gray-50 text-gray-500 border-gray-200 hover:bg-gray-100'
                        }`}
                      >
                        {MONTH_NAMES_SHORT[monthNum - 1]}
                      </button>
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

            {/* Reihe 4: All-in ARR YTD nach Churn */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 md:gap-4">
              <div className="bg-white rounded-lg md:rounded-xl shadow-sm p-3 md:p-4 border-l-4 border-purple-500 sm:col-span-3">
                <span className="text-xs md:text-sm text-gray-500">All-in ARR YTD minus Churn</span>
                <p className="text-base md:text-xl font-bold text-purple-600">
                  {formatCurrency(ytdAllInAfterChurn.netArr)} <span className="text-gray-400 font-normal">/</span>{' '}
                  <span className="text-purple-400">{formatCurrency(ytdAllInAfterChurn.allInArr)}</span>
                </p>
                <div className="mt-1.5 md:mt-2 h-1.5 md:h-2 bg-gray-200 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-purple-500 rounded-full transition-all"
                    style={{ width: `${Math.min(Math.max(ytdAllInAfterChurn.retentionPct * 100, 0), 100)}%` }}
                  />
                </div>
                <p className="text-[10px] md:text-xs text-gray-500 mt-1">
                  Churn berücksichtigt: {formatCurrency(ytdAllInAfterChurn.churnArr)} ({(ytdAllInAfterChurn.retentionPct * 100).toFixed(1)}% verbleibend)
                </p>
              </div>
            </div>
                </>
              );
            })()}

            {/* Performance über Zeit (Subs + Pay IST/Ziel) */}
            <PerformanceChart monthlyResults={ytdSelectedMonthlyResult} showTargets={true} />

            {/* Pay-Entwicklung (nur Pay) */}
            <PayPerformanceChart monthlyResults={ytdSelectedMonthlyResult} />

            {/* Go-Lives pro Monat */}
            <GoLivesBarChart monthlyResults={ytdSelectedMonthlyResult} />

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
                      <th className="px-4 py-3 text-right text-xs font-medium text-blue-600 uppercase">Gesamt ARR Plan</th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-blue-700 uppercase">Gesamt ARR Ist</th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">%</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {ytdSelectedMonthlyResult.map((r) => {
                      const subsPct = r.subs_target > 0 ? r.subs_actual / r.subs_target : 0;
                      const payPct = r.pay_target > 0 ? r.pay_actual / r.pay_target : 0;
                      const totalPlan = r.subs_target + r.pay_target;
                      const totalActual = r.subs_actual + r.pay_actual;
                      const totalPct = totalPlan > 0 ? totalActual / totalPlan : 0;
                      const isPast = (r.month - 1) <= currentMonth;
                      return (
                        <tr
                          key={r.month}
                          className={`transition ${isPast ? 'cursor-pointer hover:bg-blue-50' : 'text-gray-400 cursor-pointer hover:bg-gray-50'}`}
                          onClick={() => setSelectedMonthDetail(r.month)}
                        >
                          <td className="px-4 py-3 font-medium">{MONTH_NAMES[r.month - 1]}</td>
                          <td className="px-4 py-3 text-right">{r.go_lives_count}</td>
                          <td className="px-4 py-3 text-right">{r.terminals_count}</td>
                          <td className="px-4 py-3 text-right text-green-600">{formatCurrency(r.subs_target)}</td>
                          <td className="px-4 py-3 text-right text-green-700 font-medium">{formatCurrency(r.subs_actual)}</td>
                          <td className={`px-4 py-3 text-right font-medium ${getAchievementColor(subsPct)}`}>{formatPercent(subsPct)}</td>
                          <td className="px-4 py-3 text-right text-orange-600">{formatCurrency(r.pay_target)}</td>
                          <td className="px-4 py-3 text-right text-orange-700 font-medium">{formatCurrency(r.pay_actual)}</td>
                          <td className={`px-4 py-3 text-right font-medium ${getAchievementColor(payPct)}`}>{formatPercent(payPct)}</td>
                          <td className="px-4 py-3 text-right text-blue-600">{formatCurrency(totalPlan)}</td>
                          <td className="px-4 py-3 text-right text-blue-700 font-medium">{formatCurrency(totalActual)}</td>
                          <td className={`px-4 py-3 text-right font-medium ${getAchievementColor(totalPct)}`}>{formatPercent(totalPct)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot className="bg-gray-50 font-semibold">
                    <tr>
                      <td className="px-4 py-3">{t('dlt.reports.total')}</td>
                      <td className="px-4 py-3 text-right">{ytdSelectedTotals.totalGoLives}</td>
                      <td className="px-4 py-3 text-right">{ytdSelectedTotals.totalTerminals}</td>
                      <td className="px-4 py-3 text-right text-green-600">{formatCurrency(ytdSelectedTotals.totalSubsTarget)}</td>
                      <td className="px-4 py-3 text-right text-green-700">{formatCurrency(ytdSelectedTotals.totalSubsARR)}</td>
                      <td className={`px-4 py-3 text-right ${getAchievementColor(ytdSelectedTotals.totalSubsTarget > 0 ? ytdSelectedTotals.totalSubsARR / ytdSelectedTotals.totalSubsTarget : 0)}`}>
                        {formatPercent(ytdSelectedTotals.totalSubsTarget > 0 ? ytdSelectedTotals.totalSubsARR / ytdSelectedTotals.totalSubsTarget : 0)}
                      </td>
                      <td className="px-4 py-3 text-right text-orange-600">{formatCurrency(ytdSelectedTotals.totalPayTarget)}</td>
                      <td className="px-4 py-3 text-right text-orange-700">{formatCurrency(ytdSelectedTotals.totalPayARR)}</td>
                      <td className={`px-4 py-3 text-right ${getAchievementColor(ytdSelectedTotals.totalPayTarget > 0 ? ytdSelectedTotals.totalPayARR / ytdSelectedTotals.totalPayTarget : 0)}`}>
                        {formatPercent(ytdSelectedTotals.totalPayTarget > 0 ? ytdSelectedTotals.totalPayARR / ytdSelectedTotals.totalPayTarget : 0)}
                      </td>
                      <td className="px-4 py-3 text-right text-blue-600">{formatCurrency(ytdSelectedTotals.totalSubsTarget + ytdSelectedTotals.totalPayTarget)}</td>
                      <td className="px-4 py-3 text-right text-blue-700">{formatCurrency(ytdSelectedTotals.totalSubsARR + ytdSelectedTotals.totalPayARR)}</td>
                      <td className={`px-4 py-3 text-right ${getAchievementColor((ytdSelectedTotals.totalSubsTarget + ytdSelectedTotals.totalPayTarget) > 0 ? (ytdSelectedTotals.totalSubsARR + ytdSelectedTotals.totalPayARR) / (ytdSelectedTotals.totalSubsTarget + ytdSelectedTotals.totalPayTarget) : 0)}`}>
                        {formatPercent((ytdSelectedTotals.totalSubsTarget + ytdSelectedTotals.totalPayTarget) > 0 ? (ytdSelectedTotals.totalSubsARR + ytdSelectedTotals.totalPayARR) / (ytdSelectedTotals.totalSubsTarget + ytdSelectedTotals.totalPayTarget) : 0)}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>

            <div className="bg-white rounded-xl shadow-sm overflow-hidden">
              <div className="px-6 py-4 border-b border-gray-200">
                <h3 className="text-lg font-semibold text-gray-800">Churn pro Monat</h3>
                <p className="text-sm text-gray-500 mt-1">
                  Scheduled und Non-Scheduled Churn im gleichen Monatsraster wie die Go-Live-Übersicht.
                </p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">{t('dlt.reports.month')}</th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-amber-700 uppercase">Scheduled #</th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-rose-700 uppercase">Churns</th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-rose-700 uppercase">ARR Lost</th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-amber-700 uppercase">Scheduled ARR Lost</th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-gray-600 uppercase">Total Churn #</th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-red-700 uppercase">Total ARR Lost</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {selectedMonthlyChurnData.map((row) => (
                      <tr key={`churn-${row.month}`}>
                        <td className="px-4 py-3 font-medium">{MONTH_NAMES[row.month - 1]}</td>
                        <td className="px-4 py-3 text-right text-amber-700">{row.scheduledCount}</td>
                        <td className="px-4 py-3 text-right text-rose-700">{row.nonScheduledCount}</td>
                        <td className="px-4 py-3 text-right text-rose-700">{formatCurrency(row.nonScheduledArrLost)}</td>
                        <td className="px-4 py-3 text-right text-amber-700">{formatCurrency(row.scheduledArrLost)}</td>
                        <td className="px-4 py-3 text-right">{row.totalCount}</td>
                        <td className="px-4 py-3 text-right font-semibold text-red-700">{formatCurrency(row.totalArrLost)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="bg-gray-50 font-semibold">
                    <tr>
                      <td className="px-4 py-3">{t('dlt.reports.total')}</td>
                      <td className="px-4 py-3 text-right text-amber-700">{selectedChurnTotals.scheduledCount}</td>
                      <td className="px-4 py-3 text-right text-rose-700">{selectedChurnTotals.nonScheduledCount}</td>
                      <td className="px-4 py-3 text-right text-rose-700">{formatCurrency(selectedChurnTotals.nonScheduledArrLost)}</td>
                      <td className="px-4 py-3 text-right text-amber-700">{formatCurrency(selectedChurnTotals.scheduledArrLost)}</td>
                      <td className="px-4 py-3 text-right">{selectedChurnTotals.totalCount}</td>
                      <td className="px-4 py-3 text-right text-red-700">{formatCurrency(selectedChurnTotals.totalArrLost)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          </div>
        )}
      </div>

      {selectedMonthDetail && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => setSelectedMonthDetail(null)}
        >
          <div
            className="max-h-[90vh] w-full max-w-5xl overflow-y-auto rounded-xl bg-white shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="sticky top-0 flex items-center justify-between border-b bg-white px-6 py-4">
              <h3 className="text-lg font-semibold text-gray-800">
                📅 {MONTH_NAMES[selectedMonthDetail - 1]} {selectedYear} - Go-Lives
              </h3>
              <button
                onClick={() => setSelectedMonthDetail(null)}
                className="rounded-lg p-2 text-gray-500 transition hover:bg-gray-100"
              >
                ✕
              </button>
            </div>

            <div className="p-6">
              {monthDetailGoLives.length === 0 ? (
                <div className="py-8 text-center text-gray-500">
                  {t('monthDetail.noGoLives')}
                </div>
              ) : (
                <>
                  <div className="mb-4 grid grid-cols-2 gap-3 text-sm md:grid-cols-5">
                    <div className="rounded-lg bg-gray-50 p-3">
                      <div className="text-gray-500">Go-Lives</div>
                      <div className="text-lg font-bold text-gray-800">{monthDetailGoLives.length}</div>
                    </div>
                    <div className="rounded-lg bg-gray-50 p-3">
                      <div className="text-gray-500">Terminals</div>
                      <div className="text-lg font-bold text-blue-700">
                        {monthDetailGoLives.filter((g) => g.has_terminal).length}
                      </div>
                    </div>
                    <div className="rounded-lg bg-gray-50 p-3">
                      <div className="text-gray-500">Subs ARR</div>
                      <div className="text-lg font-bold text-green-700">
                        {formatCurrency(monthDetailGoLives.reduce((sum, g) => sum + g.subs_arr, 0))}
                      </div>
                    </div>
                    <div className="rounded-lg bg-gray-50 p-3">
                      <div className="text-gray-500">Pay ARR</div>
                      <div className="text-lg font-bold text-orange-700">
                        {formatCurrency(monthDetailGoLives.reduce((sum, g) => sum + getEffectiveGoLivePayArrForDisplay(g), 0))}
                      </div>
                    </div>
                    <div className="rounded-lg bg-gray-50 p-3">
                      <div className="text-gray-500">Gesamt ARR</div>
                      <div className="text-lg font-bold text-blue-700">
                        {formatCurrency(
                          monthDetailGoLives.reduce((sum, g) => sum + (g.subs_arr || 0) + getEffectiveGoLivePayArrForDisplay(g), 0)
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b bg-gray-50">
                          <th className="px-3 py-2 text-left font-semibold text-gray-600">{t('goLive.oakId')}</th>
                          <th className="px-3 py-2 text-left font-semibold text-gray-600">{t('monthDetail.customer')}</th>
                          <th className="px-3 py-2 text-left font-semibold text-gray-600">{t('goLive.goLiveDate')}</th>
                          <th className="px-3 py-2 text-left font-semibold text-gray-600">{t('goLive.assignedTo')}</th>
                          <th className="px-3 py-2 text-right font-semibold text-green-700">{t('goLive.subsArr')}</th>
                          <th className="px-3 py-2 text-right font-semibold text-emerald-700">Pay Ist / Monat (€)</th>
                          <th className="px-3 py-2 text-right font-semibold text-orange-700">{t('goLive.payArr')}</th>
                          <th className="px-3 py-2 text-right font-semibold text-blue-700">Gesamt ARR</th>
                        </tr>
                      </thead>
                      <tbody>
                        {monthDetailGoLives.map((gl) => (
                          <tr key={gl.id} className="border-b last:border-b-0">
                            <td className="px-3 py-2 text-gray-500">{gl.oak_id || '-'}</td>
                            <td className="px-3 py-2 font-medium text-gray-800">{gl.customer_name}</td>
                            <td className="px-3 py-2 text-gray-700">{new Date(gl.go_live_date).toLocaleDateString('de-DE')}</td>
                            <td className="px-3 py-2 text-gray-700">{userNameById.get(gl.user_id) || '-'}</td>
                            <td className="px-3 py-2 text-right text-green-700">{formatCurrency(gl.subs_arr)}</td>
                            <td className="px-3 py-2">
                              <div className="flex items-center justify-end gap-2">
                                <input
                                  type="number"
                                  value={payIstInputsByGoLiveId[gl.id] ?? ''}
                                  onChange={(e) =>
                                    setPayIstInputsByGoLiveId((prev) => ({ ...prev, [gl.id]: e.target.value }))
                                  }
                                  disabled={!gl.has_terminal || savingPayIstByGoLiveId[gl.id]}
                                  placeholder={gl.has_terminal ? 'z.B. 145' : '-'}
                                  className={`w-24 rounded border px-2 py-1 text-right text-sm ${
                                    !gl.has_terminal ? 'bg-gray-100 text-gray-400 border-gray-200' : 'border-emerald-300'
                                  }`}
                                />
                                <button
                                  type="button"
                                  onClick={() => handleSavePayIstForGoLive(gl)}
                                  disabled={!gl.has_terminal || savingPayIstByGoLiveId[gl.id]}
                                  className="rounded bg-emerald-600 px-2 py-1 text-xs font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                  {savingPayIstByGoLiveId[gl.id] ? '...' : 'Speichern'}
                                </button>
                              </div>
                              {payIstErrorByGoLiveId[gl.id] ? (
                                <div className="mt-1 text-right text-xs text-red-600">{payIstErrorByGoLiveId[gl.id]}</div>
                              ) : null}
                            </td>
                            <td className="px-3 py-2 text-right text-orange-700">{formatCurrency(getEffectiveGoLivePayArrForDisplay(gl))}</td>
                            <td className="px-3 py-2 text-right font-medium text-blue-700">
                              {formatCurrency((gl.subs_arr || 0) + getEffectiveGoLivePayArrForDisplay(gl))}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
