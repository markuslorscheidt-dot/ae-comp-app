'use client';

import { useState, useMemo } from 'react';
import { User, isPlannable, UserRole } from '@/lib/types';
import { useLanguage } from '@/lib/LanguageContext';
import { useAllUsers, useMultiUserData } from '@/lib/hooks';
import { calculateYearSummary, formatCurrency, formatPercent } from '@/lib/calculations';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar } from 'recharts';

interface DLTTeamPerformanceProps {
  user: User;
}

// Role display names
const ROLE_LABELS: Partial<Record<UserRole, string>> = {
  ae_subscription_sales: 'AE Subscription Sales',
  ae_payments: 'AE Payments',
  line_manager_new_business: 'Line Manager',
  commercial_director: 'Commercial Director',
  head_of_partnerships: 'Head of Partnerships'
};

export default function DLTTeamPerformance({ user }: DLTTeamPerformanceProps) {
  const { t } = useLanguage();
  const currentYear = new Date().getFullYear();
  const [selectedYear, setSelectedYear] = useState(currentYear);
  const [sortBy, setSortBy] = useState<'achievement' | 'arr' | 'golives' | 'name'>('achievement');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  
  // Load all users
  const { users, loading: usersLoading } = useAllUsers();
  
  // Filter plannable users
  const plannableUsers = useMemo(() => 
    users.filter(u => isPlannable(u.role)), 
    [users]
  );
  
  // Load multi-user data
  const userIds = useMemo(() => plannableUsers.map(u => u.id), [plannableUsers]);
  const { data: multiUserData, loading: dataLoading } = useMultiUserData(userIds, selectedYear);

  // Calculate performance data for each user
  const performanceData = useMemo(() => {
    if (!multiUserData || multiUserData.length === 0) return [];

    return multiUserData.map(({ userId, settings, goLives }) => {
      const userData = plannableUsers.find(u => u.id === userId);
      if (!userData || !settings) {
        return null;
      }

      const summary = calculateYearSummary(goLives, settings);
      
      return {
        id: userId,
        name: userData.name,
        role: userData.role,
        goLives: summary.total_go_lives,
        goLivesTarget: summary.total_go_lives_target,
        goLivesAchievement: summary.total_go_lives_target > 0 
          ? (summary.total_go_lives / summary.total_go_lives_target) * 100 
          : 0,
        subsARR: summary.total_subs_actual,
        subsTarget: summary.total_subs_target,
        subsAchievement: summary.total_subs_achievement * 100,
        payARR: summary.total_pay_actual,
        payTarget: summary.total_pay_target,
        payAchievement: summary.total_pay_achievement * 100,
        totalProvision: summary.total_provision,
        terminals: summary.total_terminals
      };
    }).filter(Boolean) as NonNullable<typeof performanceData[number]>[];
  }, [multiUserData, plannableUsers]);

  // Sorted performance data
  const sortedData = useMemo(() => {
    const sorted = [...performanceData].sort((a, b) => {
      let comparison = 0;
      switch (sortBy) {
        case 'achievement':
          comparison = a.subsAchievement - b.subsAchievement;
          break;
        case 'arr':
          comparison = a.subsARR - b.subsARR;
          break;
        case 'golives':
          comparison = a.goLives - b.goLives;
          break;
        case 'name':
          comparison = a.name.localeCompare(b.name);
          break;
      }
      return sortOrder === 'desc' ? -comparison : comparison;
    });
    return sorted;
  }, [performanceData, sortBy, sortOrder]);

  // Radar chart data for top performers
  const radarData = useMemo(() => {
    const top5 = sortedData.slice(0, 5);
    
    return [
      { metric: t('dlt.team.goLives'), ...Object.fromEntries(top5.map(u => [u.name, u.goLivesAchievement])) },
      { metric: t('dlt.team.subsARR'), ...Object.fromEntries(top5.map(u => [u.name, u.subsAchievement])) },
      { metric: t('dlt.team.payARR'), ...Object.fromEntries(top5.map(u => [u.name, u.payAchievement])) },
    ];
  }, [sortedData, t]);

  // Bar chart data
  const barChartData = useMemo(() => {
    return sortedData.slice(0, 10).map(u => ({
      name: u.name.split(' ')[0], // First name only for chart
      fullName: u.name,
      achievement: u.subsAchievement,
      goLives: u.goLives
    }));
  }, [sortedData]);

  const loading = usersLoading || dataLoading;

  // Achievement color helper
  const getAchievementColor = (achievement: number) => {
    if (achievement >= 100) return 'text-green-600 bg-green-100';
    if (achievement >= 80) return 'text-yellow-600 bg-yellow-100';
    return 'text-red-600 bg-red-100';
  };

  // Rank badge
  const RankBadge = ({ rank }: { rank: number }) => {
    const colors = {
      1: 'bg-yellow-400 text-yellow-900',
      2: 'bg-gray-300 text-gray-700',
      3: 'bg-amber-600 text-amber-100'
    };
    const color = colors[rank as keyof typeof colors] || 'bg-gray-100 text-gray-600';
    
    return (
      <span className={`inline-flex items-center justify-center w-8 h-8 rounded-full text-sm font-bold ${color}`}>
        {rank}
      </span>
    );
  };

  if (loading) {
    return (
      <main className="max-w-7xl mx-auto px-4 py-8">
        <div className="flex items-center justify-center h-64">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
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
            <span className="text-3xl">👥</span>
            {t('dlt.team.title')}
          </h1>
          <p className="text-gray-500 mt-1">{t('dlt.team.subtitle')}</p>
        </div>
        
        <div className="flex items-center gap-4">
          <select
            value={selectedYear}
            onChange={(e) => setSelectedYear(Number(e.target.value))}
            className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          >
            {[currentYear - 1, currentYear, currentYear + 1].map(year => (
              <option key={year} value={year}>{year}</option>
            ))}
          </select>
          
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
            className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          >
            <option value="achievement">{t('dlt.team.sortByAchievement')}</option>
            <option value="arr">{t('dlt.team.sortByARR')}</option>
            <option value="golives">{t('dlt.team.sortByGoLives')}</option>
            <option value="name">{t('dlt.team.sortByName')}</option>
          </select>
          
          <button
            onClick={() => setSortOrder(o => o === 'asc' ? 'desc' : 'asc')}
            className="p-2 border border-gray-300 rounded-lg hover:bg-gray-50"
          >
            {sortOrder === 'desc' ? '↓' : '↑'}
          </button>
        </div>
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        {/* Achievement Bar Chart */}
        <div className="bg-white rounded-xl shadow-sm p-6">
          <h3 className="text-lg font-semibold text-gray-800 mb-4">{t('dlt.team.achievementComparison')}</h3>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={barChartData} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis type="number" domain={[0, 150]} tickFormatter={(val) => `${val}%`} />
              <YAxis type="category" dataKey="name" width={80} />
              <Tooltip 
                formatter={(value: number) => `${value.toFixed(1)}%`}
                labelFormatter={(label, payload) => payload?.[0]?.payload?.fullName || label}
              />
              <Bar 
                dataKey="achievement" 
                name={t('dlt.team.achievement')}
                fill="#3B82F6"
                radius={[0, 4, 4, 0]}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Go-Lives Comparison */}
        <div className="bg-white rounded-xl shadow-sm p-6">
          <h3 className="text-lg font-semibold text-gray-800 mb-4">{t('dlt.team.goLivesComparison')}</h3>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={barChartData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" />
              <YAxis />
              <Tooltip 
                labelFormatter={(label, payload) => payload?.[0]?.payload?.fullName || label}
              />
              <Bar 
                dataKey="goLives" 
                name={t('dlt.team.goLives')}
                fill="#10B981"
                radius={[4, 4, 0, 0]}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Team Ranking Table */}
      <div className="bg-white rounded-xl shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-200">
          <h3 className="text-lg font-semibold text-gray-800">{t('dlt.team.ranking')}</h3>
        </div>
        
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  {t('dlt.team.rank')}
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  {t('dlt.team.name')}
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  {t('dlt.team.role')}
                </th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                  {t('dlt.team.goLives')}
                </th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                  {t('dlt.team.subsARR')}
                </th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                  {t('dlt.team.achievement')}
                </th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                  {t('dlt.team.provision')}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {sortedData.map((performer, idx) => (
                <tr key={performer.id} className="hover:bg-gray-50">
                  <td className="px-4 py-4">
                    <RankBadge rank={idx + 1} />
                  </td>
                  <td className="px-4 py-4">
                    <span className="font-medium text-gray-900">{performer.name}</span>
                  </td>
                  <td className="px-4 py-4">
                    <span className="text-sm text-gray-500">
                      {ROLE_LABELS[performer.role] || performer.role}
                    </span>
                  </td>
                  <td className="px-4 py-4 text-right">
                    <span className="font-medium">{performer.goLives}</span>
                    <span className="text-gray-400 text-sm"> / {performer.goLivesTarget}</span>
                  </td>
                  <td className="px-4 py-4 text-right">
                    <span className="font-medium">{formatCurrency(performer.subsARR)}</span>
                  </td>
                  <td className="px-4 py-4 text-right">
                    <span className={`px-2 py-1 rounded-full text-sm font-medium ${getAchievementColor(performer.subsAchievement)}`}>
                      {performer.subsAchievement.toFixed(1)}%
                    </span>
                  </td>
                  <td className="px-4 py-4 text-right">
                    <span className="font-medium text-green-600">{formatCurrency(performer.totalProvision)}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        
        {sortedData.length === 0 && (
          <div className="px-6 py-12 text-center text-gray-500">
            {t('dlt.team.noData')}
          </div>
        )}
      </div>
    </main>
  );
}
