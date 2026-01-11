'use client';

import { useState, useMemo } from 'react';
import { User, AESettings, GoLive, ProvisionTier } from '@/lib/types';
import { useLanguage } from '@/lib/LanguageContext';
import { 
  formatCurrency, 
  formatPercent, 
  getProvisionRate,
  getAchievementColor,
  getAchievementBgColor
} from '@/lib/calculations';
import UserSelector from './UserSelector';
import DebugPanel from './DebugPanel';

interface SimulatorProps {
  currentUser: User;
  users: User[];
  settingsMap: Map<string, AESettings>;
  onBack: () => void;
}

interface SimulatedGoLive {
  id: string;
  month: number;
  customer_name: string;
  go_live_date: string;
  subs_monthly: number;
  subs_arr: number;
  has_terminal: boolean;
  pay_arr: number | null;
}

interface MonthlySimResult {
  month: number;
  go_lives: SimulatedGoLive[];
  go_lives_count: number;
  terminals_count: number;
  terminal_penetration: number;
  subs_target: number;
  subs_actual: number;
  subs_achievement: number;
  subs_rate: number;
  subs_provision: number;
  terminal_rate: number;
  terminal_provision: number;
  m0_provision: number;
  pay_target: number;
  pay_actual: number;
  pay_achievement: number;
  pay_rate: number;
  pay_provision: number;
  total_provision: number;
}

export default function Simulator({ currentUser, users, settingsMap, onBack }: SimulatorProps) {
  const { t } = useLanguage();
  
  // Filter: Einzelner User oder GESAMT
  // Initialisiere mit erstem User aus der Liste (das sind nur planbare User)
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>(
    users.length > 0 ? [users[0].id] : []
  );
  const isAllSelected = selectedUserIds.includes('all');
  
  // Simulierte Go-Lives pro User
  const [simulatedGoLives, setSimulatedGoLives] = useState<Map<string, SimulatedGoLive[]>>(new Map());
  
  // Formular für neuen Go-Live
  const [selectedMonth, setSelectedMonth] = useState<number>(new Date().getMonth() + 1);
  const [newGoLive, setNewGoLive] = useState({
    customer_name: '',
    go_live_date: new Date().toISOString().split('T')[0],
    subs_monthly: 155,
    has_terminal: true,
    pay_arr: null as number | null,
  });

  // Aktiver User für Eingabe
  const activeUserId = isAllSelected ? users[0]?.id : selectedUserIds[0];
  const activeUser = users.find(u => u.id === activeUserId);
  
  // Settings für aktiven User oder kombiniert
  const getEffectiveSettings = (): AESettings | null => {
    if (isAllSelected) {
      const allSettings = Array.from(settingsMap.values());
      if (allSettings.length === 0) return null;
      
      const first = allSettings[0];
      return {
        ...first,
        id: 'combined',
        user_id: 'combined',
        ote: allSettings.reduce((sum, s) => sum + s.ote, 0),
        monthly_subs_targets: first.monthly_subs_targets.map((_, i) =>
          allSettings.reduce((sum, s) => sum + (s.monthly_subs_targets?.[i] || 0), 0)
        ),
        monthly_pay_targets: first.monthly_pay_targets.map((_, i) =>
          allSettings.reduce((sum, s) => sum + (s.monthly_pay_targets?.[i] || 0), 0)
        ),
        monthly_go_live_targets: first.monthly_go_live_targets.map((_, i) =>
          allSettings.reduce((sum, s) => sum + (s.monthly_go_live_targets?.[i] || 0), 0)
        ),
      };
    }
    return settingsMap.get(activeUserId) || null;
  };

  const settings = getEffectiveSettings();

  // Alle Go-Lives für Anzeige
  const getAllGoLives = (): SimulatedGoLive[] => {
    if (isAllSelected) {
      return Array.from(simulatedGoLives.values()).flat();
    }
    return simulatedGoLives.get(activeUserId) || [];
  };

  const allGoLives = getAllGoLives();

  // Berechne monatliche Ergebnisse
  const monthlyResults = useMemo((): MonthlySimResult[] => {
    if (!settings) return [];

    return Array.from({ length: 12 }, (_, i) => {
      const month = i + 1;
      const monthGoLives = allGoLives.filter(gl => gl.month === month);
      
      const goLivesCount = monthGoLives.length;
      const terminalsCount = monthGoLives.filter(gl => gl.has_terminal).length;
      const terminalPenetration = goLivesCount > 0 ? terminalsCount / goLivesCount : 0;
      
      const subsTarget = settings.monthly_subs_targets?.[i] || 0;
      const subsActual = monthGoLives.reduce((sum, gl) => sum + gl.subs_arr, 0);
      const subsAchievement = subsTarget > 0 ? subsActual / subsTarget : 0;
      const subsRate = getProvisionRate(subsAchievement, settings.subs_tiers);
      const subsProvision = subsActual * subsRate;
      
      const terminalRate = terminalPenetration >= 0.7 ? settings.terminal_bonus : settings.terminal_base;
      const terminalProvision = terminalsCount * terminalRate;
      
      const m0Provision = subsProvision + terminalProvision;
      
      const payTarget = settings.monthly_pay_targets?.[i] || 0;
      const payActual = monthGoLives.reduce((sum, gl) => sum + (gl.pay_arr || 0), 0);
      const payAchievement = payTarget > 0 ? payActual / payTarget : 0;
      const payRate = getProvisionRate(payAchievement, settings.pay_tiers);
      const payProvision = payActual * payRate;
      
      return {
        month,
        go_lives: monthGoLives,
        go_lives_count: goLivesCount,
        terminals_count: terminalsCount,
        terminal_penetration: terminalPenetration,
        subs_target: subsTarget,
        subs_actual: subsActual,
        subs_achievement: subsAchievement,
        subs_rate: subsRate,
        subs_provision: subsProvision,
        terminal_rate: terminalRate,
        terminal_provision: terminalProvision,
        m0_provision: m0Provision,
        pay_target: payTarget,
        pay_actual: payActual,
        pay_achievement: payAchievement,
        pay_rate: payRate,
        pay_provision: payProvision,
        total_provision: m0Provision + payProvision,
      };
    });
  }, [allGoLives, settings]);

  // Jahres-Zusammenfassung
  const yearSummary = useMemo(() => {
    const totalGoLives = monthlyResults.reduce((sum, r) => sum + r.go_lives_count, 0);
    const totalTerminals = monthlyResults.reduce((sum, r) => sum + r.terminals_count, 0);
    const totalSubsTarget = monthlyResults.reduce((sum, r) => sum + r.subs_target, 0);
    const totalSubsActual = monthlyResults.reduce((sum, r) => sum + r.subs_actual, 0);
    const totalPayTarget = monthlyResults.reduce((sum, r) => sum + r.pay_target, 0);
    const totalPayActual = monthlyResults.reduce((sum, r) => sum + r.pay_actual, 0);
    const totalM0Provision = monthlyResults.reduce((sum, r) => sum + r.m0_provision, 0);
    const totalPayProvision = monthlyResults.reduce((sum, r) => sum + r.pay_provision, 0);
    
    return {
      totalGoLives,
      totalTerminals,
      totalSubsTarget,
      totalSubsActual,
      totalSubsAchievement: totalSubsTarget > 0 ? totalSubsActual / totalSubsTarget : 0,
      totalPayTarget,
      totalPayActual,
      totalPayAchievement: totalPayTarget > 0 ? totalPayActual / totalPayTarget : 0,
      totalM0Provision,
      totalPayProvision,
      totalProvision: totalM0Provision + totalPayProvision,
      ote: settings?.ote || 0,
    };
  }, [monthlyResults, settings]);

  // Go-Live hinzufügen
  const handleAddGoLive = () => {
    if (!newGoLive.customer_name.trim()) return;
    
    const goLive: SimulatedGoLive = {
      id: `sim-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      month: selectedMonth,
      customer_name: newGoLive.customer_name,
      go_live_date: newGoLive.go_live_date,
      subs_monthly: newGoLive.subs_monthly,
      subs_arr: newGoLive.subs_monthly * 12,
      has_terminal: newGoLive.has_terminal,
      pay_arr: newGoLive.pay_arr,
    };

    const targetUserId = isAllSelected ? users[0]?.id : activeUserId;
    setSimulatedGoLives(prev => {
      const newMap = new Map(prev);
      const existing = newMap.get(targetUserId) || [];
      newMap.set(targetUserId, [...existing, goLive]);
      return newMap;
    });

    setNewGoLive({
      customer_name: '',
      go_live_date: new Date().toISOString().split('T')[0],
      subs_monthly: 155,
      has_terminal: true,
      pay_arr: null,
    });
  };

  // Go-Live löschen
  const handleDeleteGoLive = (goLiveId: string) => {
    setSimulatedGoLives(prev => {
      const newMap = new Map(prev);
      for (const [userId, goLives] of newMap) {
        newMap.set(userId, goLives.filter(gl => gl.id !== goLiveId));
      }
      return newMap;
    });
  };

  // Alle löschen
  const handleClearAll = () => {
    if (confirm(t('simulator.deleteAllConfirm'))) {
      setSimulatedGoLives(new Map());
    }
  };

  if (!settings) {
    return (
      <div className="text-center py-12">
        <p className="text-gray-500">{t('simulator.noSettings')}</p>
        <button onClick={onBack} className="mt-4 text-blue-600 hover:underline">
          {t('common.back')}
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* DEBUG PANEL */}
      <DebugPanel 
        user={currentUser} 
        data={{
          usersCount: users.length,
          settingsMapSize: settingsMap.size,
          selectedUserIds: selectedUserIds,
          isAllSelected: isAllSelected,
          simulatedGoLivesCount: allGoLives.length,
          yearSummary: yearSummary ? {
            totalGoLives: yearSummary.total_go_lives,
            totalProvision: yearSummary.total_provision,
          } : null,
        }}
        title="Simulator Debug"
      />

      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-4">
          <button onClick={onBack} className="p-2 hover:bg-gray-100 rounded-lg transition">
            {t('common.back')}
          </button>
          <h2 className="text-2xl font-bold text-gray-800">🎯 {t('simulator.title')}</h2>
        </div>
        {allGoLives.length > 0 && (
          <button
            onClick={handleClearAll}
            className="px-4 py-2 text-red-600 hover:bg-red-50 rounded-lg transition"
          >
            🗑️ {t('simulator.deleteAll')}
          </button>
        )}
      </div>

      {/* User Filter */}
      {users.length > 1 && (
        <div className="bg-white rounded-xl shadow-sm p-4">
          <UserSelector
            users={users}
            selectedUserIds={selectedUserIds}
            onSelectionChange={setSelectedUserIds}
            currentUser={currentUser}
            mode="single"
            showAllOption={true}
            label={t('simulator.simulationFor')}
          />
          {isAllSelected && (
            <p className="mt-2 text-sm text-purple-600">
              📊 <strong>{t('common.total').toUpperCase()}</strong>: {t('simulator.totalSimulation').replace('{count}', users.length.toString())}
            </p>
          )}
        </div>
      )}

      {/* Eingabe-Formular */}
      <div className="bg-white rounded-xl shadow-sm p-6">
        <h3 className="text-lg font-bold text-gray-800 mb-4">+ {t('simulator.addGoLive')}</h3>
        
        <div className="grid grid-cols-2 md:grid-cols-6 gap-4">
          {/* Monat */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{t('simulator.month')}</label>
            <select
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(parseInt(e.target.value))}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg"
            >
              {Array.from({ length: 12 }, (_, i) => (
                <option key={i} value={i + 1}>{t(`months.${i + 1}`)}</option>
              ))}
            </select>
          </div>

          {/* Kunde */}
          <div className="md:col-span-2">
            <label className="block text-sm font-medium text-gray-700 mb-1">{t('simulator.customer')}</label>
            <input
              type="text"
              value={newGoLive.customer_name}
              onChange={(e) => setNewGoLive({ ...newGoLive, customer_name: e.target.value })}
              placeholder={t('simulator.customerPlaceholder')}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg"
            />
          </div>

          {/* Subs €/M */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{t('simulator.subsMonthly')}</label>
            <input
              type="number"
              value={newGoLive.subs_monthly}
              onChange={(e) => setNewGoLive({ ...newGoLive, subs_monthly: parseInt(e.target.value) || 0 })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg"
            />
          </div>

          {/* Terminal */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{t('simulator.terminal')}</label>
            <select
              value={newGoLive.has_terminal ? 'ja' : 'nein'}
              onChange={(e) => setNewGoLive({ ...newGoLive, has_terminal: e.target.value === 'ja' })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg"
            >
              <option value="ja">{t('common.yes')}</option>
              <option value="nein">{t('common.no')}</option>
            </select>
          </div>

          {/* Pay ARR (optional) */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{t('simulator.payArr')}</label>
            <input
              type="number"
              value={newGoLive.pay_arr || ''}
              onChange={(e) => setNewGoLive({ ...newGoLive, pay_arr: e.target.value ? parseInt(e.target.value) : null })}
              placeholder={t('simulator.payArrOptional')}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg"
            />
          </div>
        </div>

        <div className="mt-4 flex items-center justify-between">
          <p className="text-sm text-gray-500">
            {t('simulator.subsArr')}: <strong className="text-green-600">{formatCurrency(newGoLive.subs_monthly * 12)}</strong>
          </p>
          <button
            onClick={handleAddGoLive}
            disabled={!newGoLive.customer_name.trim()}
            className="px-6 py-2 bg-green-600 text-white rounded-lg font-medium hover:bg-green-700 transition disabled:opacity-50"
          >
            + {t('simulator.add')}
          </button>
        </div>
      </div>

      {/* Jahres-Zusammenfassung Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <div className="bg-white rounded-xl shadow-sm p-4">
          <span className="text-sm text-gray-500">{t('simulator.goLives')}</span>
          <p className="text-2xl font-bold text-gray-800">{yearSummary.totalGoLives}</p>
          <p className="text-xs text-gray-500">{t('simulator.terminals')}: {yearSummary.totalTerminals}</p>
        </div>
        <div className="bg-white rounded-xl shadow-sm p-4">
          <span className="text-sm text-gray-500">{t('simulator.subsArr')}</span>
          <p className="text-2xl font-bold text-green-600">{formatCurrency(yearSummary.totalSubsActual)}</p>
          <p className={`text-xs ${getAchievementColor(yearSummary.totalSubsAchievement)}`}>
            {formatPercent(yearSummary.totalSubsAchievement)} {t('common.target').toLowerCase()}: {formatCurrency(yearSummary.totalSubsTarget)}
          </p>
        </div>
        <div className="bg-white rounded-xl shadow-sm p-4">
          <span className="text-sm text-gray-500">{t('simulator.payArr')}</span>
          <p className="text-2xl font-bold text-orange-600">{formatCurrency(yearSummary.totalPayActual)}</p>
          <p className={`text-xs ${getAchievementColor(yearSummary.totalPayAchievement)}`}>
            {formatPercent(yearSummary.totalPayAchievement)} {t('common.target').toLowerCase()}: {formatCurrency(yearSummary.totalPayTarget)}
          </p>
        </div>
        <div className="bg-white rounded-xl shadow-sm p-4">
          <span className="text-sm text-gray-500">{t('simulator.provision')}</span>
          <p className="text-2xl font-bold text-purple-600">{formatCurrency(yearSummary.totalProvision)}</p>
          <p className="text-xs text-gray-500">
            M0: {formatCurrency(yearSummary.totalM0Provision)} | M3: {formatCurrency(yearSummary.totalPayProvision)}
          </p>
        </div>
        <div className={`bg-white rounded-xl shadow-sm p-4 border-2 ${
          yearSummary.totalProvision >= yearSummary.ote ? 'border-green-500' : 'border-orange-500'
        }`}>
          <span className="text-sm text-gray-500">{t('simulator.vsOte')}</span>
          <p className={`text-2xl font-bold ${
            yearSummary.totalProvision >= yearSummary.ote ? 'text-green-600' : 'text-orange-600'
          }`}>
            {formatPercent(yearSummary.ote > 0 ? yearSummary.totalProvision / yearSummary.ote : 0)}
          </p>
          <p className="text-xs text-gray-500">
            {t('simulator.ote')}: {formatCurrency(yearSummary.ote)}
          </p>
        </div>
      </div>

      {/* Monatliche Details Tabelle */}
      <div className="bg-white rounded-xl shadow-sm p-6 overflow-x-auto">
        <h3 className="text-lg font-bold text-gray-800 mb-4">{t('simulator.yearlySummary')}</h3>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b-2">
              <th className="text-left py-2 px-2 font-bold text-gray-700">{t('common.month')}</th>
              <th className="text-right py-2 px-2 font-bold text-gray-700">{t('simulator.goLives')}</th>
              <th className="text-right py-2 px-2 font-bold text-gray-700">{t('simulator.terminals')}</th>
              <th className="text-right py-2 px-2 font-bold text-green-600">{t('simulator.subsTarget')}</th>
              <th className="text-right py-2 px-2 font-bold text-green-600">{t('simulator.subsActual')}</th>
              <th className="text-right py-2 px-2 font-bold text-green-600">%</th>
              <th className="text-right py-2 px-2 font-bold text-orange-600">{t('simulator.payTarget')}</th>
              <th className="text-right py-2 px-2 font-bold text-orange-600">{t('simulator.payActual')}</th>
              <th className="text-right py-2 px-2 font-bold text-orange-600">%</th>
              <th className="text-right py-2 px-2 font-bold text-blue-600">{t('simulator.m0Provision')}</th>
              <th className="text-right py-2 px-2 font-bold text-orange-600">{t('simulator.m3Provision')}</th>
              <th className="text-right py-2 px-2 font-bold text-purple-600">{t('simulator.totalProvision')}</th>
            </tr>
          </thead>
          <tbody>
            {monthlyResults.map((result) => (
              <tr key={result.month} className="border-b hover:bg-gray-50">
                <td className="py-2 px-2 font-medium">{t(`months.${result.month}`)}</td>
                <td className="py-2 px-2 text-right">{result.go_lives_count}</td>
                <td className="py-2 px-2 text-right">{result.terminals_count}</td>
                <td className="py-2 px-2 text-right text-green-600">{formatCurrency(result.subs_target)}</td>
                <td className="py-2 px-2 text-right text-green-600">{formatCurrency(result.subs_actual)}</td>
                <td className={`py-2 px-2 text-right ${getAchievementColor(result.subs_achievement)}`}>
                  {formatPercent(result.subs_achievement)}
                </td>
                <td className="py-2 px-2 text-right text-orange-600">{formatCurrency(result.pay_target)}</td>
                <td className="py-2 px-2 text-right text-orange-600">{formatCurrency(result.pay_actual)}</td>
                <td className={`py-2 px-2 text-right ${getAchievementColor(result.pay_achievement)}`}>
                  {formatPercent(result.pay_achievement)}
                </td>
                <td className="py-2 px-2 text-right text-blue-600">{formatCurrency(result.m0_provision)}</td>
                <td className="py-2 px-2 text-right text-orange-600">{formatCurrency(result.pay_provision)}</td>
                <td className="py-2 px-2 text-right font-bold text-purple-600">{formatCurrency(result.total_provision)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="bg-gray-100 font-bold border-t-2">
              <td className="py-3 px-2">{t('common.total').toUpperCase()}</td>
              <td className="py-3 px-2 text-right">{yearSummary.totalGoLives}</td>
              <td className="py-3 px-2 text-right">{yearSummary.totalTerminals}</td>
              <td className="py-3 px-2 text-right text-green-700">{formatCurrency(yearSummary.totalSubsTarget)}</td>
              <td className="py-3 px-2 text-right text-green-700">{formatCurrency(yearSummary.totalSubsActual)}</td>
              <td className={`py-3 px-2 text-right ${getAchievementColor(yearSummary.totalSubsAchievement)}`}>
                {formatPercent(yearSummary.totalSubsAchievement)}
              </td>
              <td className="py-3 px-2 text-right text-orange-700">{formatCurrency(yearSummary.totalPayTarget)}</td>
              <td className="py-3 px-2 text-right text-orange-700">{formatCurrency(yearSummary.totalPayActual)}</td>
              <td className={`py-3 px-2 text-right ${getAchievementColor(yearSummary.totalPayAchievement)}`}>
                {formatPercent(yearSummary.totalPayAchievement)}
              </td>
              <td className="py-3 px-2 text-right text-blue-700">{formatCurrency(yearSummary.totalM0Provision)}</td>
              <td className="py-3 px-2 text-right text-orange-700">{formatCurrency(yearSummary.totalPayProvision)}</td>
              <td className="py-3 px-2 text-right text-purple-700">{formatCurrency(yearSummary.totalProvision)}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      {/* Go-Live Liste pro Monat */}
      {monthlyResults.filter(r => r.go_lives_count > 0).map((result) => (
        <div key={result.month} className="bg-white rounded-xl shadow-sm p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-bold text-gray-800">
              {t(`months.${result.month}`)} - {result.go_lives_count} {t('simulator.goLives')}
            </h3>
            <div className="flex items-center space-x-4 text-sm">
              <span className="text-green-600">Subs: {formatCurrency(result.subs_actual)}</span>
              <span className="text-orange-600">Pay: {formatCurrency(result.pay_actual)}</span>
              <span className="text-purple-600 font-bold">{t('simulator.provision')}: {formatCurrency(result.total_provision)}</span>
            </div>
          </div>

          <table className="w-full text-sm">
            <thead>
              <tr className="border-b">
                <th className="text-left py-2">{t('simulator.customer')}</th>
                <th className="text-right py-2">{t('simulator.subsMonthly')}</th>
                <th className="text-center py-2">{t('simulator.terminal')}</th>
                <th className="text-right py-2 text-green-600">{t('simulator.subsArr')}</th>
                <th className="text-right py-2 text-orange-600">{t('simulator.payArr')}</th>
                <th className="text-right py-2 text-purple-600">{t('simulator.totalArr')}</th>
                <th className="text-right py-2"></th>
              </tr>
            </thead>
            <tbody>
              {result.go_lives.map((gl) => (
                <tr key={gl.id} className="border-b hover:bg-gray-50">
                  <td className="py-2">{gl.customer_name}</td>
                  <td className="py-2 text-right">{formatCurrency(gl.subs_monthly)}</td>
                  <td className="py-2 text-center">{gl.has_terminal ? '✅' : '❌'}</td>
                  <td className="py-2 text-right text-green-600">{formatCurrency(gl.subs_arr)}</td>
                  <td className="py-2 text-right text-orange-600">{gl.pay_arr ? formatCurrency(gl.pay_arr) : '-'}</td>
                  <td className="py-2 text-right text-purple-600 font-medium">
                    {formatCurrency(gl.subs_arr + (gl.pay_arr || 0))}
                  </td>
                  <td className="py-2 text-right">
                    <button
                      onClick={() => handleDeleteGoLive(gl.id)}
                      className="text-red-500 hover:text-red-700"
                    >
                      🗑️
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Provisions-Berechnung */}
          <div className="mt-4 pt-4 border-t grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div className="bg-green-50 rounded-lg p-3">
              <div className="text-green-700 font-medium">{t('simulator.m0SubsProvision')}</div>
              <div className="text-xs text-gray-600">
                {t('common.target')}: {formatCurrency(result.subs_target)} | 
                {t('simulator.reached')}: {formatPercent(result.subs_achievement)} | 
                {t('simulator.rate')}: {formatPercent(result.subs_rate)}
              </div>
              <div className="text-lg font-bold text-green-700">{formatCurrency(result.subs_provision)}</div>
            </div>
            <div className="bg-blue-50 rounded-lg p-3">
              <div className="text-blue-700 font-medium">{t('simulator.m0TerminalProvision')}</div>
              <div className="text-xs text-gray-600">
                {result.terminals_count} × €{result.terminal_rate} 
                ({formatPercent(result.terminal_penetration)} {t('simulator.penetration')})
              </div>
              <div className="text-lg font-bold text-blue-700">{formatCurrency(result.terminal_provision)}</div>
            </div>
            <div className="bg-orange-50 rounded-lg p-3">
              <div className="text-orange-700 font-medium">{t('simulator.m3PayProvision')}</div>
              <div className="text-xs text-gray-600">
                {t('common.target')}: {formatCurrency(result.pay_target)} | 
                {t('simulator.reached')}: {formatPercent(result.pay_achievement)} | 
                {t('simulator.rate')}: {formatPercent(result.pay_rate)}
              </div>
              <div className="text-lg font-bold text-orange-700">{formatCurrency(result.pay_provision)}</div>
            </div>
            <div className="bg-purple-50 rounded-lg p-3">
              <div className="text-purple-700 font-medium">{t('simulator.totalProvisionLabel')}</div>
              <div className="text-xs text-gray-600">
                M0: {formatCurrency(result.m0_provision)} + M3: {formatCurrency(result.pay_provision)}
              </div>
              <div className="text-lg font-bold text-purple-700">{formatCurrency(result.total_provision)}</div>
            </div>
          </div>
        </div>
      ))}

      {/* Leere State */}
      {allGoLives.length === 0 && (
        <div className="bg-gray-50 rounded-xl p-12 text-center">
          <div className="text-6xl mb-4">🎯</div>
          <h3 className="text-xl font-bold text-gray-800 mb-2">{t('simulator.startSimulation')}</h3>
          <p className="text-gray-600 mb-4">{t('simulator.startHint')}</p>
          <p className="text-sm text-gray-500">{t('simulator.startTip')}</p>
        </div>
      )}

      {/* Legende */}
      <div className="bg-gray-50 rounded-xl p-6">
        <h3 className="text-lg font-bold text-gray-800 mb-4">{t('simulator.legend')}</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 text-sm">
          <div>
            <h4 className="font-medium text-green-700 mb-2">{t('simulator.m0SubsProvision')}</h4>
            <p className="text-gray-600">{t('simulator.subsFormula')}</p>
          </div>
          <div>
            <h4 className="font-medium text-blue-700 mb-2">{t('simulator.m0TerminalProvision')}</h4>
            <p className="text-gray-600">
              {t('simulator.terminalFormula')
                .replace('{base}', settings.terminal_base.toString())
                .replace('{bonus}', settings.terminal_bonus.toString())}
            </p>
          </div>
          <div>
            <h4 className="font-medium text-orange-700 mb-2">{t('simulator.m3PayProvision')}</h4>
            <p className="text-gray-600">{t('simulator.payFormula')}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
