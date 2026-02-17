'use client';

import { useState, useEffect, useMemo } from 'react';
import { User, BusinessArea, BUSINESS_AREA_LABELS, isPlannable } from '@/lib/types';
import { useLanguage } from '@/lib/LanguageContext';
import { useAllUsers, useMultiUserData } from '@/lib/hooks';
import { calculateYearSummary, formatCurrency, formatPercent } from '@/lib/calculations';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, BarChart, Bar, PieChart, Pie, Cell } from 'recharts';

interface DLTLeadershipDashboardProps {
  user: User;
}

// Colors for business areas
const AREA_COLORS: Record<BusinessArea, string> = {
  dlt: '#8B5CF6',
  new_business: '#3B82F6',
  expanding_business: '#10B981',
  marketing: '#F59E0B'
};

const MONTH_NAMES_SHORT = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];

export default function DLTLeadershipDashboard({ user }: DLTLeadershipDashboardProps) {
  const { t } = useLanguage();
  const currentYear = new Date().getFullYear();
  const [selectedYear, setSelectedYear] = useState(currentYear);
  
  // Load all users and their data
  const { users, loading: usersLoading } = useAllUsers();
  
  // Filter plannable users (AEs with targets)
  const plannableUsers = useMemo(() => 
    users.filter(u => isPlannable(u.role)), 
    [users]
  );
  
  // Load multi-user data
  const userIds = useMemo(() => plannableUsers.map(u => u.id), [plannableUsers]);
  const { data: multiUserData, loading: dataLoading } = useMultiUserData(userIds, selectedYear);

  // Calculate aggregated KPIs
  const kpis = useMemo(() => {
    if (!multiUserData || multiUserData.length === 0) {
      return {
        totalGoLives: 0,
        totalGoLivesTarget: 0,
        totalSubsARR: 0,
        totalSubsTarget: 0,
        totalPayARR: 0,
        totalPayTarget: 0,
        totalProvision: 0,
        activeAEs: 0,
        avgAchievement: 0
      };
    }

    let totalGoLives = 0;
    let totalGoLivesTarget = 0;
    let totalSubsARR = 0;
    let totalSubsTarget = 0;
    let totalPayARR = 0;
    let totalPayTarget = 0;
    let totalProvision = 0;
    let achievementSum = 0;
    let activeCount = 0;

    multiUserData.forEach(({ settings, goLives }) => {
      if (!settings) return;
      
      const summary = calculateYearSummary(goLives, settings);
      
      totalGoLives += summary.total_go_lives;
      totalGoLivesTarget += summary.total_go_lives_target;
      totalSubsARR += summary.total_subs_actual;
      totalSubsTarget += summary.total_subs_target;
      totalPayARR += summary.total_pay_actual;
      totalPayTarget += summary.total_pay_target;
      totalProvision += summary.total_provision;
      
      if (summary.total_subs_target > 0) {
        achievementSum += summary.total_subs_achievement;
        activeCount++;
      }
    });

    return {
      totalGoLives,
      totalGoLivesTarget,
      totalSubsARR,
      totalSubsTarget,
      totalPayARR,
      totalPayTarget,
      totalProvision,
      activeAEs: activeCount,
      avgAchievement: activeCount > 0 ? achievementSum / activeCount : 0
    };
  }, [multiUserData]);

  // Monthly trend data
  const monthlyTrend = useMemo(() => {
    if (!multiUserData || multiUserData.length === 0) return [];

    const monthlyData = MONTH_NAMES_SHORT.map((name, idx) => ({
      name,
      month: idx + 1,
      subsARR: 0,
      subsTarget: 0,
      goLives: 0,
      goLivesTarget: 0
    }));

    multiUserData.forEach(({ settings, goLives }) => {
      if (!settings) return;
      
      const summary = calculateYearSummary(goLives, settings);
      
      summary.monthly_results.forEach((result, idx) => {
        monthlyData[idx].subsARR += result.subs_actual;
        monthlyData[idx].subsTarget += result.subs_target;
        monthlyData[idx].goLives += result.go_lives_count;
        monthlyData[idx].goLivesTarget += result.go_lives_target;
      });
    });

    return monthlyData;
  }, [multiUserData]);

  // KPI Card Component
  const KPICard = ({ 
    title, 
    value, 
    target, 
    icon, 
    color,
    format = 'number'
  }: { 
    title: string; 
    value: number; 
    target?: number;
    icon: string; 
    color: string;
    format?: 'number' | 'currency' | 'percent';
  }) => {
    const achievement = target && target > 0 ? (value / target) * 100 : 0;
    const achievementColor = achievement >= 100 ? 'text-green-600' : achievement >= 80 ? 'text-yellow-600' : 'text-red-600';
    
    const formatValue = (val: number) => {
      if (format === 'currency') return formatCurrency(val);
      if (format === 'percent') return formatPercent(val);
      return val.toLocaleString('de-DE');
    };

    return (
      <div className="bg-white rounded-xl shadow-sm p-6 border-l-4" style={{ borderLeftColor: color }}>
        <div className="flex items-center justify-between mb-2">
          <span className="text-2xl">{icon}</span>
          {target !== undefined && (
            <span className={`text-sm font-medium ${achievementColor}`}>
              {achievement.toFixed(0)}%
            </span>
          )}
        </div>
        <h3 className="text-sm text-gray-500 mb-1">{title}</h3>
        <p className="text-2xl font-bold text-gray-800">{formatValue(value)}</p>
        {target !== undefined && (
          <p className="text-xs text-gray-400 mt-1">
            {t('dlt.kpi.target')}: {formatValue(target)}
          </p>
        )}
      </div>
    );
  };

  const loading = usersLoading || dataLoading;

  if (loading) {
    return (
      <main className="max-w-7xl mx-auto px-4 py-8">
        <div className="flex items-center justify-center h-64">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-purple-600 mx-auto mb-4"></div>
            <p className="text-gray-500">{t('ui.loading')}</p>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="max-w-7xl mx-auto px-4 py-8">
      {/* Title & Year Selector */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-gray-800 flex items-center gap-3">
            <span className="text-3xl">📊</span>
            {t('dlt.leadership.title')}
          </h1>
          <p className="text-gray-500 mt-1">{t('dlt.leadership.subtitle')}</p>
        </div>
        
        <select
          value={selectedYear}
          onChange={(e) => setSelectedYear(Number(e.target.value))}
          className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
        >
          {[currentYear - 1, currentYear, currentYear + 1].map(year => (
            <option key={year} value={year}>{year}</option>
          ))}
        </select>
      </div>

      {/* KPI Cards Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <KPICard
          title={t('dlt.kpi.goLives')}
          value={kpis.totalGoLives}
          target={kpis.totalGoLivesTarget}
          icon="🎯"
          color={AREA_COLORS.new_business}
        />
        <KPICard
          title={t('dlt.kpi.subsARR')}
          value={kpis.totalSubsARR}
          target={kpis.totalSubsTarget}
          icon="💰"
          color={AREA_COLORS.expanding_business}
          format="currency"
        />
        <KPICard
          title={t('dlt.kpi.payARR')}
          value={kpis.totalPayARR}
          target={kpis.totalPayTarget}
          icon="💳"
          color={AREA_COLORS.marketing}
          format="currency"
        />
        <KPICard
          title={t('dlt.kpi.provision')}
          value={kpis.totalProvision}
          icon="📈"
          color={AREA_COLORS.dlt}
          format="currency"
        />
      </div>

      {/* Secondary KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-8">
        <div className="bg-white rounded-xl shadow-sm p-6">
          <div className="flex items-center gap-3 mb-2">
            <span className="text-2xl">👥</span>
            <span className="text-sm text-gray-500">{t('dlt.kpi.activeAEs')}</span>
          </div>
          <p className="text-3xl font-bold text-gray-800">{kpis.activeAEs}</p>
        </div>
        <div className="bg-white rounded-xl shadow-sm p-6">
          <div className="flex items-center gap-3 mb-2">
            <span className="text-2xl">📊</span>
            <span className="text-sm text-gray-500">{t('dlt.kpi.avgAchievement')}</span>
          </div>
          <p className="text-3xl font-bold text-gray-800">{formatPercent(kpis.avgAchievement)}</p>
        </div>
        <div className="bg-white rounded-xl shadow-sm p-6">
          <div className="flex items-center gap-3 mb-2">
            <span className="text-2xl">💵</span>
            <span className="text-sm text-gray-500">{t('dlt.kpi.totalARR')}</span>
          </div>
          <p className="text-3xl font-bold text-gray-800">{formatCurrency(kpis.totalSubsARR + kpis.totalPayARR)}</p>
        </div>
      </div>

      {/* Charts Section */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        {/* ARR Trend Chart */}
        <div className="bg-white rounded-xl shadow-sm p-6">
          <h3 className="text-lg font-semibold text-gray-800 mb-4">{t('dlt.charts.arrTrend')}</h3>
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={monthlyTrend}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" />
              <YAxis tickFormatter={(val) => `${(val / 1000).toFixed(0)}k`} />
              <Tooltip 
                formatter={(value: number) => formatCurrency(value)}
                labelFormatter={(label) => `${label} ${selectedYear}`}
              />
              <Legend />
              <Line 
                type="monotone" 
                dataKey="subsARR" 
                name={t('dlt.kpi.subsARR')}
                stroke={AREA_COLORS.new_business} 
                strokeWidth={2}
                dot={{ fill: AREA_COLORS.new_business }}
              />
              <Line 
                type="monotone" 
                dataKey="subsTarget" 
                name={t('dlt.kpi.target')}
                stroke={AREA_COLORS.new_business} 
                strokeWidth={2}
                strokeDasharray="5 5"
                dot={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>

        {/* Go-Lives Chart */}
        <div className="bg-white rounded-xl shadow-sm p-6">
          <h3 className="text-lg font-semibold text-gray-800 mb-4">{t('dlt.charts.goLivesTrend')}</h3>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={monthlyTrend}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" />
              <YAxis />
              <Tooltip 
                labelFormatter={(label) => `${label} ${selectedYear}`}
              />
              <Legend />
              <Bar 
                dataKey="goLives" 
                name={t('dlt.kpi.goLives')}
                fill={AREA_COLORS.expanding_business} 
              />
              <Bar 
                dataKey="goLivesTarget" 
                name={t('dlt.kpi.target')}
                fill={AREA_COLORS.expanding_business}
                opacity={0.3}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Business Areas Overview */}
      <div className="bg-white rounded-xl shadow-sm p-6">
        <h3 className="text-lg font-semibold text-gray-800 mb-4">{t('dlt.leadership.areasOverview')}</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {(['new_business', 'expanding_business', 'marketing'] as BusinessArea[]).map((area) => (
            <div 
              key={area}
              className="p-4 rounded-lg border"
              style={{ borderColor: AREA_COLORS[area], backgroundColor: `${AREA_COLORS[area]}10` }}
            >
              <div className="flex items-center gap-2 mb-2">
                <span className="text-xl">
                  {area === 'new_business' ? '🚀' : area === 'expanding_business' ? '📈' : '📣'}
                </span>
                <span className="font-medium text-gray-800">{BUSINESS_AREA_LABELS[area]}</span>
              </div>
              <p className="text-sm text-gray-500">
                {area === 'new_business' && `${kpis.activeAEs} ${t('dlt.leadership.activeAEs')}`}
                {area === 'expanding_business' && t('dlt.leadership.comingSoon')}
                {area === 'marketing' && t('dlt.leadership.comingSoon')}
              </p>
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
