'use client';

import { useState, useEffect } from 'react';
import { AESettings, YearSummary, GoLive, User, canReceiveGoLives, getDefaultCommissionRelevant } from '@/lib/types';
import { Partner, SubscriptionPackage } from '@/lib/golive-types';
import { loadPartners, loadSubscriptionPackages } from '@/lib/golive-import-hooks';
import { useLanguage } from '@/lib/LanguageContext';
import { formatCurrency, formatPercent, getAchievementColor } from '@/lib/calculations';
import { PerformanceChart, GoLivesBarChart, ProvisionAreaChart } from './TrendCharts';

interface YearOverviewProps {
  settings: AESettings;
  yearSummary: YearSummary;
  goLives?: GoLive[];
  allUsers?: User[];
  onUpdateGoLive?: (id: string, updates: Partial<GoLive>) => Promise<{ error: any }>;
  onDeleteGoLive?: (id: string) => Promise<{ error: any }>;
  onBack: () => void;
  title?: string;
  canEdit?: boolean;
}

export default function YearOverview({ 
  settings, 
  yearSummary, 
  goLives = [], 
  allUsers = [],
  onUpdateGoLive,
  onDeleteGoLive,
  onBack, 
  title,
  canEdit = false
}: YearOverviewProps) {
  const { t } = useLanguage();
  const [selectedMonth, setSelectedMonth] = useState<number | null>(null);
  
  // Edit Modal State
  const [editingGoLive, setEditingGoLive] = useState<GoLive | null>(null);
  const [editForm, setEditForm] = useState({
    user_id: '',
    customer_name: '',
    oak_id: '',
    go_live_date: '',
    subs_monthly: '',
    has_terminal: false,
    pay_arr: '',
    commission_relevant: true,
    partner_id: null as string | null,
    is_enterprise: false,
    subscription_package_id: null as string | null,
  });
  const [saving, setSaving] = useState(false);
  const [partners, setPartners] = useState<Partner[]>([]);
  const [subscriptionPackages, setSubscriptionPackages] = useState<SubscriptionPackage[]>([]);
  
  // Sortierung für Go-Lives Tabelle
  type SortField = 'oak_id' | 'customer_name' | 'go_live_date' | 'subs_monthly' | 'subs_arr' | 'has_terminal' | 'pay_arr' | 'commission_relevant';
  const [sortField, setSortField] = useState<SortField>('go_live_date');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');

  // Partner und Subscription Packages laden
  useEffect(() => {
    loadPartners().then(setPartners).catch(console.error);
    loadSubscriptionPackages().then(setSubscriptionPackages).catch(console.error);
  }, []);

  // User die Go-Lives erhalten können
  const goLiveReceivers = allUsers.filter(u => canReceiveGoLives(u.role));

  // Go-Lives für den ausgewählten Monat
  const monthGoLives = selectedMonth 
    ? goLives.filter(gl => gl.month === selectedMonth)
    : [];

  // Sortierte Go-Lives
  const sortedMonthGoLives = [...monthGoLives].sort((a, b) => {
    let comparison = 0;
    switch (sortField) {
      case 'oak_id':
        comparison = (a.oak_id || 0) - (b.oak_id || 0);
        break;
      case 'customer_name':
        comparison = a.customer_name.localeCompare(b.customer_name, 'de');
        break;
      case 'go_live_date':
        comparison = new Date(a.go_live_date).getTime() - new Date(b.go_live_date).getTime();
        break;
      case 'subs_monthly':
        comparison = a.subs_monthly - b.subs_monthly;
        break;
      case 'subs_arr':
        comparison = a.subs_arr - b.subs_arr;
        break;
      case 'has_terminal':
        comparison = (a.has_terminal ? 1 : 0) - (b.has_terminal ? 1 : 0);
        break;
      case 'pay_arr':
        comparison = (a.pay_arr || 0) - (b.pay_arr || 0);
        break;
      case 'commission_relevant':
        comparison = (a.commission_relevant !== false ? 1 : 0) - (b.commission_relevant !== false ? 1 : 0);
        break;
    }
    return sortDirection === 'asc' ? comparison : -comparison;
  });

  // Sortierung umschalten
  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  // Sortier-Icon Komponente
  const SortIcon = ({ field }: { field: SortField }) => (
    <span className="ml-1 inline-block">
      {sortField === field ? (
        sortDirection === 'asc' ? '▲' : '▼'
      ) : (
        <span className="text-gray-300">⇅</span>
      )}
    </span>
  );

  const openEditModal = (gl: GoLive) => {
    setEditingGoLive(gl);
    setEditForm({
      user_id: gl.user_id,
      customer_name: gl.customer_name,
      oak_id: gl.oak_id?.toString() || '',
      go_live_date: gl.go_live_date,
      subs_monthly: gl.subs_monthly.toString(),
      has_terminal: gl.has_terminal,
      pay_arr: gl.pay_arr?.toString() || '',
      commission_relevant: gl.commission_relevant !== false,
      partner_id: gl.partner_id || null,
      is_enterprise: gl.is_enterprise || false,
      subscription_package_id: gl.subscription_package_id || null,
    });
  };

  const handleSaveEdit = async () => {
    if (!editingGoLive || !onUpdateGoLive) return;
    
    // Monat aus dem Datum extrahieren (YYYY-MM-DD Format)
    const newMonth = editForm.go_live_date ? parseInt(editForm.go_live_date.split('-')[1]) : editingGoLive.month;
    
    setSaving(true);
    const result = await onUpdateGoLive(editingGoLive.id, {
      user_id: editForm.user_id,
      customer_name: editForm.customer_name,
      oak_id: editForm.oak_id ? parseInt(editForm.oak_id) : null,
      go_live_date: editForm.go_live_date,
      month: newMonth, // Monat aus Datum aktualisieren
      subs_monthly: parseFloat(editForm.subs_monthly) || 0,
      has_terminal: editForm.has_terminal,
      pay_arr: editForm.pay_arr ? parseFloat(editForm.pay_arr) : null,
      commission_relevant: editForm.commission_relevant,
      partner_id: editForm.partner_id,
      is_enterprise: editForm.is_enterprise,
      subscription_package_id: editForm.subscription_package_id,
    });
    
    setSaving(false);
    if (!result.error) {
      setEditingGoLive(null);
    }
  };

  const handleDelete = async (id: string) => {
    if (!onDeleteGoLive) return;
    if (confirm(t('goLive.deleteConfirm'))) {
      await onDeleteGoLive(id);
    }
  };

  // Wenn User geändert wird, Default für commission_relevant anpassen
  const handleUserChange = (newUserId: string) => {
    const newUser = goLiveReceivers.find(u => u.id === newUserId);
    setEditForm({
      ...editForm,
      user_id: newUserId,
      commission_relevant: newUser ? getDefaultCommissionRelevant(newUser.role) : editForm.commission_relevant,
    });
  };

  // Berechnungen für Dashboard
  const totalGoLives = yearSummary.total_go_lives;
  const totalTerminals = yearSummary.total_terminals;
  const totalSubsArr = yearSummary.total_subs_actual;
  const totalPayArr = yearSummary.total_pay_actual;
  const totalAllInArr = totalSubsArr + totalPayArr;
  
  // Average Monthly Bills (ARR / 12 / Go-Lives, nur wenn Go-Lives > 0)
  const avgMonthlySubsBill = totalGoLives > 0 ? (totalSubsArr / 12) / totalGoLives : 0;
  const avgMonthlyPayBill = totalGoLives > 0 ? (totalPayArr / 12) / totalGoLives : 0;
  const avgMonthlyAllInBill = totalGoLives > 0 ? (totalAllInArr / 12) / totalGoLives : 0;
  
  // Ziele (Targets)
  const totalSubsTarget = yearSummary.total_subs_target;
  const totalPayTarget = yearSummary.total_pay_target;
  const totalAllInTarget = totalSubsTarget + totalPayTarget;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center space-x-4">
          <button onClick={onBack} className="p-2 hover:bg-gray-100 rounded-lg transition">{t('common.back')}</button>
          <h2 className="text-2xl font-bold text-gray-800">
            {title || `${t('yearOverview.title')} ${settings.year}`}
          </h2>
        </div>
      </div>

      {/* Reihe 1: Basis-KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4 mb-4">
        <div className="bg-white rounded-xl shadow-sm p-4">
          <span className="text-sm text-gray-500">Go-Lives</span>
          <p className="text-2xl font-bold text-gray-800">{totalGoLives}</p>
        </div>
        <div className="bg-white rounded-xl shadow-sm p-4">
          <span className="text-sm text-gray-500">{t('yearOverview.terminals')}</span>
          <p className="text-2xl font-bold text-gray-800">{totalTerminals}</p>
        </div>
        <div className="bg-white rounded-xl shadow-sm p-4">
          <span className="text-sm text-gray-500">{t('yearOverview.avgMonthlySubsBill')}</span>
          <p className="text-2xl font-bold text-green-600">{formatCurrency(avgMonthlySubsBill)}</p>
        </div>
        <div className="bg-white rounded-xl shadow-sm p-4">
          <span className="text-sm text-gray-500">{t('yearOverview.avgMonthlyPayBill')}</span>
          <p className="text-2xl font-bold text-orange-600">{formatCurrency(avgMonthlyPayBill)}</p>
        </div>
        <div className="bg-white rounded-xl shadow-sm p-4">
          <span className="text-sm text-gray-500">{t('yearOverview.avgMonthlyAllInBill')}</span>
          <p className="text-2xl font-bold text-blue-600">{formatCurrency(avgMonthlyAllInBill)}</p>
        </div>
      </div>

      {/* Reihe 2: ARR vs Ziele */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-4">
        <div className="bg-white rounded-xl shadow-sm p-4 border-l-4 border-green-500">
          <span className="text-sm text-gray-500">{t('yearOverview.subsArrYtdVsGoal')}</span>
          <p className="text-xl font-bold text-green-600">
            {formatCurrency(totalSubsArr)} <span className="text-gray-400 font-normal">/</span> <span className="text-green-400">{formatCurrency(totalSubsTarget)}</span>
          </p>
          <div className="mt-2 h-2 bg-gray-200 rounded-full overflow-hidden">
            <div 
              className="h-full bg-green-500 rounded-full transition-all"
              style={{ width: `${Math.min((totalSubsArr / totalSubsTarget) * 100, 100)}%` }}
            />
          </div>
          <p className="text-xs text-gray-500 mt-1">{totalSubsTarget > 0 ? ((totalSubsArr / totalSubsTarget) * 100).toFixed(1) : 0}% {t('yearOverview.achieved')}</p>
        </div>
        <div className="bg-white rounded-xl shadow-sm p-4 border-l-4 border-orange-500">
          <span className="text-sm text-gray-500">{t('yearOverview.payArrYtdVsGoal')}</span>
          <p className="text-xl font-bold text-orange-600">
            {formatCurrency(totalPayArr)} <span className="text-gray-400 font-normal">/</span> <span className="text-orange-400">{formatCurrency(totalPayTarget)}</span>
          </p>
          <div className="mt-2 h-2 bg-gray-200 rounded-full overflow-hidden">
            <div 
              className="h-full bg-orange-500 rounded-full transition-all"
              style={{ width: `${Math.min((totalPayArr / totalPayTarget) * 100, 100)}%` }}
            />
          </div>
          <p className="text-xs text-gray-500 mt-1">{totalPayTarget > 0 ? ((totalPayArr / totalPayTarget) * 100).toFixed(1) : 0}% {t('yearOverview.achieved')}</p>
        </div>
        <div className="bg-white rounded-xl shadow-sm p-4 border-l-4 border-blue-500">
          <span className="text-sm text-gray-500">{t('yearOverview.allInArrYtdVsGoal')}</span>
          <p className="text-xl font-bold text-blue-600">
            {formatCurrency(totalAllInArr)} <span className="text-gray-400 font-normal">/</span> <span className="text-blue-400">{formatCurrency(totalAllInTarget)}</span>
          </p>
          <div className="mt-2 h-2 bg-gray-200 rounded-full overflow-hidden">
            <div 
              className="h-full bg-blue-500 rounded-full transition-all"
              style={{ width: `${Math.min((totalAllInArr / totalAllInTarget) * 100, 100)}%` }}
            />
          </div>
          <p className="text-xs text-gray-500 mt-1">{totalAllInTarget > 0 ? ((totalAllInArr / totalAllInTarget) * 100).toFixed(1) : 0}% {t('yearOverview.achieved')}</p>
        </div>
      </div>

      {/* Reihe 3: Provisionen */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-8">
        <div className="bg-white rounded-xl shadow-sm p-4 border-l-4 border-green-500">
          <span className="text-sm text-gray-500">{t('yearOverview.m0Provision')}</span>
          <p className="text-2xl font-bold text-green-600">{formatCurrency(yearSummary.total_m0_provision)}</p>
        </div>
        <div className="bg-white rounded-xl shadow-sm p-4 border-l-4 border-orange-500">
          <span className="text-sm text-gray-500">{t('yearOverview.m3Provision')}</span>
          <p className="text-2xl font-bold text-orange-600">{formatCurrency(yearSummary.total_m3_provision)}</p>
        </div>
        <div className="bg-white rounded-xl shadow-sm p-4 border-l-4 border-purple-500">
          <span className="text-sm text-gray-500">{t('yearOverview.total')}</span>
          <p className="text-2xl font-bold text-purple-600">{formatCurrency(yearSummary.total_provision)}</p>
        </div>
      </div>

      {/* Performance Chart */}
      <div className="mb-8">
        <PerformanceChart monthlyResults={yearSummary.monthly_results} showTargets={true} />
      </div>

      {/* Go-Lives Bar Chart */}
      <div className="mb-8">
        <GoLivesBarChart 
          monthlyResults={yearSummary.monthly_results} 
          onMonthClick={(month) => setSelectedMonth(month)}
        />
      </div>

      {/* Provision Area Chart */}
      <div className="mb-8">
        <ProvisionAreaChart 
          monthlyResults={yearSummary.monthly_results} 
          ote={settings.ote}
        />
      </div>

      <div className="bg-white rounded-xl shadow-sm p-6 overflow-x-auto">
        <h3 className="text-lg font-bold text-gray-800 mb-4">{t('yearOverview.monthlyOverview')}</h3>
        <p className="text-sm text-gray-500 mb-4">💡 {t('yearOverview.clickForDetails')}</p>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b-2">
              <th className="text-left py-3 px-2 font-bold text-gray-700">{t('common.month')}</th>
              <th className="text-right py-3 px-2 font-bold text-gray-700">{t('yearOverview.goLives')}</th>
              <th className="text-right py-3 px-2 font-bold text-gray-700">{t('yearOverview.terminals')}</th>
              <th className="text-right py-3 px-2 font-bold text-green-700">{t('yearOverview.subsTarget')}</th>
              <th className="text-right py-3 px-2 font-bold text-green-700">{t('yearOverview.subsActual')}</th>
              <th className="text-right py-3 px-2 font-bold text-green-700">%</th>
              <th className="text-right py-3 px-2 font-bold text-orange-700">{t('yearOverview.payTarget')}</th>
              <th className="text-right py-3 px-2 font-bold text-orange-700">{t('yearOverview.payActual')}</th>
              <th className="text-right py-3 px-2 font-bold text-orange-700">%</th>
              <th className="text-right py-3 px-2 font-bold text-blue-700">Gesamt ARR Plan</th>
              <th className="text-right py-3 px-2 font-bold text-blue-700">Gesamt ARR IST</th>
              <th className="text-right py-3 px-2 font-bold text-green-700">Subs Provision</th>
              <th className="text-right py-3 px-2 font-bold text-orange-700">Pay Provision</th>
              <th className="text-right py-3 px-2 font-bold text-purple-700">Gesamt Provision</th>
            </tr>
          </thead>
          <tbody>
            {yearSummary.monthly_results.map((r) => (
              <tr 
                key={r.month} 
                className="border-b hover:bg-blue-50 cursor-pointer transition"
                onClick={() => setSelectedMonth(r.month)}
              >
                <td className="py-3 px-2 font-medium text-blue-600 hover:underline">{t(`months.${r.month}`)}</td>
                <td className="py-3 px-2 text-right">{r.go_lives_count}</td>
                <td className="py-3 px-2 text-right">{r.terminals_count}</td>
                <td className="py-3 px-2 text-right text-green-600">{formatCurrency(r.subs_target)}</td>
                <td className="py-3 px-2 text-right text-green-700 font-medium">{formatCurrency(r.subs_actual)}</td>
                <td className={`py-3 px-2 text-right font-medium ${getAchievementColor(r.subs_achievement)}`}>{formatPercent(r.subs_achievement)}</td>
                <td className="py-3 px-2 text-right text-orange-600">{formatCurrency(r.pay_target)}</td>
                <td className="py-3 px-2 text-right text-orange-700 font-medium">{formatCurrency(r.pay_actual)}</td>
                <td className={`py-3 px-2 text-right font-medium ${getAchievementColor(r.pay_achievement)}`}>{formatPercent(r.pay_achievement)}</td>
                <td className="py-3 px-2 text-right text-blue-600">{formatCurrency(r.subs_target + r.pay_target)}</td>
                <td className="py-3 px-2 text-right text-blue-700 font-medium">{formatCurrency(r.subs_actual + r.pay_actual)}</td>
                <td className="py-3 px-2 text-right text-green-600 font-medium">{formatCurrency(r.m0_provision)}</td>
                <td className="py-3 px-2 text-right text-orange-600 font-medium">{formatCurrency(r.m3_provision)}</td>
                <td className="py-3 px-2 text-right text-purple-700 font-bold">{formatCurrency(r.total_provision)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="bg-gray-100 font-bold border-t-2">
              <td className="py-3 px-2">{t('common.total').toUpperCase()}</td>
              <td className="py-3 px-2 text-right">{yearSummary.total_go_lives}</td>
              <td className="py-3 px-2 text-right">{yearSummary.total_terminals}</td>
              <td className="py-3 px-2 text-right text-green-600">{formatCurrency(yearSummary.total_subs_target)}</td>
              <td className="py-3 px-2 text-right text-green-700">{formatCurrency(yearSummary.total_subs_actual)}</td>
              <td className={`py-3 px-2 text-right ${getAchievementColor(yearSummary.total_subs_achievement)}`}>{formatPercent(yearSummary.total_subs_achievement)}</td>
              <td className="py-3 px-2 text-right text-orange-600">{formatCurrency(yearSummary.total_pay_target)}</td>
              <td className="py-3 px-2 text-right text-orange-700">{formatCurrency(yearSummary.total_pay_actual)}</td>
              <td className={`py-3 px-2 text-right ${getAchievementColor(yearSummary.total_pay_achievement)}`}>{formatPercent(yearSummary.total_pay_achievement)}</td>
              <td className="py-3 px-2 text-right text-blue-600">{formatCurrency(yearSummary.total_subs_target + yearSummary.total_pay_target)}</td>
              <td className="py-3 px-2 text-right text-blue-700">{formatCurrency(yearSummary.total_subs_actual + yearSummary.total_pay_actual)}</td>
              <td className="py-3 px-2 text-right text-green-700">{formatCurrency(yearSummary.total_m0_provision)}</td>
              <td className="py-3 px-2 text-right text-orange-700">{formatCurrency(yearSummary.total_m3_provision)}</td>
              <td className="py-3 px-2 text-right text-purple-800 text-lg">{formatCurrency(yearSummary.total_provision)}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      {/* Month Detail Modal */}
      {selectedMonth && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => setSelectedMonth(null)}>
          <div className="bg-white rounded-xl shadow-xl max-w-4xl w-full max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="p-6">
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-xl font-bold text-gray-800">
                  📅 {t(`months.${selectedMonth}`)} {settings.year} - Go-Lives
                </h3>
                <button 
                  onClick={() => setSelectedMonth(null)}
                  className="p-2 hover:bg-gray-100 rounded-lg transition text-gray-500"
                >
                  ✕
                </button>
              </div>

              {monthGoLives.length === 0 ? (
                <div className="text-center py-12 text-gray-500">
                  <p className="text-4xl mb-4">📭</p>
                  <p>{t('monthDetail.noGoLives')}</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b-2 bg-gray-50">
                        <th 
                          className="text-left py-3 px-3 font-bold text-gray-700 cursor-pointer hover:bg-gray-100 select-none"
                          onClick={() => handleSort('oak_id')}
                        >
                          {t('goLive.oakId')}<SortIcon field="oak_id" />
                        </th>
                        <th 
                          className="text-left py-3 px-3 font-bold text-gray-700 cursor-pointer hover:bg-gray-100 select-none"
                          onClick={() => handleSort('customer_name')}
                        >
                          {t('monthDetail.customer')}<SortIcon field="customer_name" />
                        </th>
                        <th 
                          className="text-left py-3 px-3 font-bold text-gray-700 cursor-pointer hover:bg-gray-100 select-none"
                          onClick={() => handleSort('go_live_date')}
                        >
                          {t('goLive.goLiveDate')}<SortIcon field="go_live_date" />
                        </th>
                        <th 
                          className="text-right py-3 px-3 font-bold text-green-700 cursor-pointer hover:bg-gray-100 select-none"
                          onClick={() => handleSort('subs_monthly')}
                        >
                          {t('goLive.subsMonthly')}<SortIcon field="subs_monthly" />
                        </th>
                        <th 
                          className="text-right py-3 px-3 font-bold text-green-700 cursor-pointer hover:bg-gray-100 select-none"
                          onClick={() => handleSort('subs_arr')}
                        >
                          {t('goLive.subsArr')}<SortIcon field="subs_arr" />
                        </th>
                        <th 
                          className="text-center py-3 px-3 font-bold text-blue-700 cursor-pointer hover:bg-gray-100 select-none"
                          onClick={() => handleSort('has_terminal')}
                        >
                          {t('goLive.hasTerminal')}<SortIcon field="has_terminal" />
                        </th>
                        <th 
                          className="text-right py-3 px-3 font-bold text-orange-700 cursor-pointer hover:bg-gray-100 select-none"
                          onClick={() => handleSort('pay_arr')}
                        >
                          {t('goLive.payArr')}<SortIcon field="pay_arr" />
                        </th>
                        <th 
                          className="text-center py-3 px-3 font-bold text-amber-700 cursor-pointer hover:bg-gray-100 select-none"
                          onClick={() => handleSort('commission_relevant')}
                        >
                          💰<SortIcon field="commission_relevant" />
                        </th>
                        {canEdit && <th className="py-3 px-3"></th>}
                      </tr>
                    </thead>
                    <tbody>
                      {sortedMonthGoLives.map((gl) => (
                        <tr key={gl.id} className={`border-b hover:bg-gray-50 ${gl.commission_relevant === false ? 'bg-gray-50 opacity-70' : ''}`}>
                          <td className="py-3 px-3 text-gray-500">{gl.oak_id || '-'}</td>
                          <td className="py-3 px-3 font-medium">{gl.customer_name}</td>
                          <td className="py-3 px-3">{new Date(gl.go_live_date).toLocaleDateString('de-DE')}</td>
                          <td className="py-3 px-3 text-right text-green-600">{formatCurrency(gl.subs_monthly)}</td>
                          <td className="py-3 px-3 text-right text-green-700 font-medium">{formatCurrency(gl.subs_arr)}</td>
                          <td className="py-3 px-3 text-center">
                            {gl.has_terminal ? (
                              <span className="text-blue-600">✓</span>
                            ) : (
                              <span className="text-gray-300">-</span>
                            )}
                          </td>
                          <td className="py-3 px-3 text-right text-orange-600">
                            {gl.pay_arr ? formatCurrency(gl.pay_arr) : '-'}
                          </td>
                          <td className="py-3 px-3 text-center">
                            {gl.commission_relevant !== false ? (
                              <span className="text-amber-600" title={t('goLive.commissionRelevant')}>✓</span>
                            ) : (
                              <span className="text-gray-300" title="Nicht provisions-relevant">-</span>
                            )}
                          </td>
                          {canEdit && (
                            <td className="py-3 px-3 text-right space-x-2">
                              <button
                                onClick={() => openEditModal(gl)}
                                className="text-blue-500 hover:text-blue-700 text-xs"
                              >
                                {t('common.edit')}
                              </button>
                              <button
                                onClick={() => handleDelete(gl.id)}
                                className="text-red-500 hover:text-red-700 text-xs"
                              >
                                {t('common.delete')}
                              </button>
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="bg-gray-100 font-bold border-t-2">
                        <td className="py-3 px-3" colSpan={3}>{t('common.total')} ({sortedMonthGoLives.length} Go-Lives)</td>
                        <td className="py-3 px-3 text-right text-green-600">
                          {formatCurrency(sortedMonthGoLives.reduce((sum, gl) => sum + gl.subs_monthly, 0))}
                        </td>
                        <td className="py-3 px-3 text-right text-green-700">
                          {formatCurrency(sortedMonthGoLives.reduce((sum, gl) => sum + gl.subs_arr, 0))}
                        </td>
                        <td className="py-3 px-3 text-center text-blue-600">
                          {sortedMonthGoLives.filter(gl => gl.has_terminal).length}
                        </td>
                        <td className="py-3 px-3 text-right text-orange-600">
                          {formatCurrency(sortedMonthGoLives.reduce((sum, gl) => sum + (gl.pay_arr || 0), 0))}
                        </td>
                        <td className="py-3 px-3 text-center text-amber-600">
                          {sortedMonthGoLives.filter(gl => gl.commission_relevant !== false).length}
                        </td>
                        {canEdit && <td></td>}
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Edit Go-Live Modal */}
      {editingGoLive && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60] p-4" onClick={() => setEditingGoLive(null)}>
          <div className="bg-white rounded-xl shadow-xl max-w-lg w-full max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="p-6">
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-xl font-bold text-gray-800">
                  ✏️ {t('goLive.editTitle')}
                </h3>
                <button 
                  onClick={() => setEditingGoLive(null)}
                  className="p-2 hover:bg-gray-100 rounded-lg transition text-gray-500"
                >
                  ✕
                </button>
              </div>

              <div className="space-y-4">
                {/* User Zuordnung */}
                {goLiveReceivers.length > 0 && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      {t('goLive.assignedTo')}
                    </label>
                    <select
                      value={editForm.user_id}
                      onChange={(e) => handleUserChange(e.target.value)}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                    >
                      {goLiveReceivers.map(u => (
                        <option key={u.id} value={u.id}>
                          {u.name} - {t(`roles.${u.role}`)}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                {/* Kundenname */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    {t('goLive.customerName')}
                  </label>
                  <input
                    type="text"
                    value={editForm.customer_name}
                    onChange={(e) => setEditForm({ ...editForm, customer_name: e.target.value })}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                {/* OAK ID */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    {t('goLive.oakId')}
                  </label>
                  <input
                    type="number"
                    value={editForm.oak_id}
                    onChange={(e) => setEditForm({ ...editForm, oak_id: e.target.value })}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                {/* Go-Live Datum */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    {t('goLive.goLiveDate')}
                  </label>
                  <input
                    type="date"
                    value={editForm.go_live_date}
                    onChange={(e) => setEditForm({ ...editForm, go_live_date: e.target.value })}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                {/* Subs €/Monat */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    {t('goLive.subsMonthly')}
                  </label>
                  <input
                    type="number"
                    value={editForm.subs_monthly}
                    onChange={(e) => setEditForm({ ...editForm, subs_monthly: e.target.value })}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                    step="0.01"
                  />
                  {editForm.subs_monthly && (
                    <p className="text-sm text-green-600 mt-1">
                      {t('goLive.subsArr')}: {formatCurrency(parseFloat(editForm.subs_monthly) * 12)}
                    </p>
                  )}
                </div>

                {/* Subscription Package */}
                <div className="p-3 bg-green-50 rounded-lg border border-green-200">
                  <label className="block text-sm font-medium text-green-700 mb-2">
                    📦 Subscription Paket
                  </label>
                  <select
                    value={editForm.subscription_package_id || ''}
                    onChange={(e) => setEditForm({ ...editForm, subscription_package_id: e.target.value || null })}
                    className="w-full px-3 py-2 border border-green-300 rounded-lg focus:ring-2 focus:ring-green-500 bg-white"
                  >
                    <option value="">Kein Paket (Standard)</option>
                    {subscriptionPackages.map(pkg => (
                      <option key={pkg.id} value={pkg.id}>
                        {pkg.name}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Terminal */}
                <div className="flex items-center">
                  <input
                    type="checkbox"
                    id="year_edit_hasTerminal"
                    checked={editForm.has_terminal}
                    onChange={(e) => setEditForm({ ...editForm, has_terminal: e.target.checked })}
                    className="w-5 h-5 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                  />
                  <label htmlFor="year_edit_hasTerminal" className="ml-2 text-sm font-medium text-gray-700">
                    {t('goLive.hasTerminal')}
                  </label>
                </div>

                {/* Provisions-relevant */}
                <div className="flex items-center p-3 bg-amber-50 rounded-lg border border-amber-200">
                  <input
                    type="checkbox"
                    id="year_edit_commissionRelevant"
                    checked={editForm.commission_relevant}
                    onChange={(e) => setEditForm({ ...editForm, commission_relevant: e.target.checked })}
                    className="w-5 h-5 text-amber-600 border-gray-300 rounded focus:ring-amber-500"
                  />
                  <label htmlFor="year_edit_commissionRelevant" className="ml-2 text-sm font-medium text-gray-700">
                    {t('goLive.commissionRelevant')}
                  </label>
                </div>

                {/* Partnership */}
                <div className="p-3 bg-purple-50 rounded-lg border border-purple-200">
                  <label className="block text-sm font-medium text-purple-700 mb-2">
                    🤝 Partnership
                  </label>
                  <select
                    value={editForm.partner_id || ''}
                    onChange={(e) => setEditForm({ ...editForm, partner_id: e.target.value || null })}
                    className="w-full px-3 py-2 border border-purple-300 rounded-lg focus:ring-2 focus:ring-purple-500 bg-white"
                  >
                    <option value="">Kein Partner (Standard)</option>
                    {partners.map(partner => (
                      <option key={partner.id} value={partner.id}>
                        {partner.name}
                      </option>
                    ))}
                  </select>
                  {editForm.partner_id && (
                    <p className="text-xs text-purple-600 mt-1">
                      ℹ️ Wird intern Head of Partnerships zugeordnet
                    </p>
                  )}
                </div>

                {/* Filialunternehmen */}
                <div className="flex items-center p-3 bg-indigo-50 rounded-lg border border-indigo-200">
                  <input
                    type="checkbox"
                    id="year_edit_isEnterprise"
                    checked={editForm.is_enterprise}
                    onChange={(e) => setEditForm({ ...editForm, is_enterprise: e.target.checked })}
                    className="w-5 h-5 text-indigo-600 border-gray-300 rounded focus:ring-indigo-500"
                  />
                  <label htmlFor="year_edit_isEnterprise" className="ml-2 text-sm font-medium text-gray-700">
                    🏢 Filialunternehmen (≥5 Filialen)
                  </label>
                </div>
                {editForm.is_enterprise && (
                  <p className="text-xs text-indigo-600 -mt-2 ml-3">
                    ℹ️ Wird intern Head of Partnerships zugeordnet
                  </p>
                )}

                {/* Pay ARR */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    {t('goLive.payArr')}
                    <span className="text-gray-400 font-normal ml-2">• {t('goLive.payArrHint')}</span>
                  </label>
                  <input
                    type="number"
                    value={editForm.pay_arr}
                    onChange={(e) => setEditForm({ ...editForm, pay_arr: e.target.value })}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                    step="0.01"
                  />
                </div>
              </div>

              {/* Buttons */}
              <div className="flex justify-end space-x-3 mt-6 pt-4 border-t">
                <button
                  onClick={() => setEditingGoLive(null)}
                  className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg transition"
                >
                  {t('common.cancel')}
                </button>
                <button
                  onClick={handleSaveEdit}
                  disabled={saving}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition disabled:opacity-50"
                >
                  {saving ? '...' : t('common.save')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="mt-6 bg-white rounded-xl shadow-sm p-6">
        <h3 className="text-lg font-bold text-gray-800 mb-4">{t('yearOverview.legend')}</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
          <div>
            <h4 className="font-medium text-gray-700 mb-2">{t('yearOverview.colorCoding')}</h4>
            <div className="space-y-2">
              <div className="flex items-center space-x-2"><span className="w-4 h-4 bg-green-500 rounded"></span><span>{t('yearOverview.greenSubs')}</span></div>
              <div className="flex items-center space-x-2"><span className="w-4 h-4 bg-orange-500 rounded"></span><span>{t('yearOverview.orangePay')}</span></div>
              <div className="flex items-center space-x-2"><span className="w-4 h-4 bg-blue-500 rounded"></span><span>{t('yearOverview.blueTerminal')}</span></div>
              <div className="flex items-center space-x-2"><span className="w-4 h-4 bg-purple-500 rounded"></span><span>{t('yearOverview.purpleTotal')}</span></div>
            </div>
          </div>
          <div>
            <h4 className="font-medium text-gray-700 mb-2">{t('yearOverview.calculationLogic')}</h4>
            <div className="space-y-1 text-gray-600">
              <p><strong>M0:</strong> {t('yearOverview.m0Formula', { base: settings.terminal_base, bonus: settings.terminal_bonus })}</p>
              <p><strong>M3:</strong> {t('yearOverview.m3Formula')}</p>
              <p>{t('yearOverview.terminalBonus', { bonus: settings.terminal_bonus })}</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
