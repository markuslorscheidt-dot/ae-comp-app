'use client';

import { useState, useEffect } from 'react';
import { AESettings, GoLive, User, canReceiveGoLives, getDefaultCommissionRelevant } from '@/lib/types';
import { Partner, SubscriptionPackage } from '@/lib/golive-types';
import { loadPartners, loadSubscriptionPackages } from '@/lib/golive-import-hooks';
import { useLanguage } from '@/lib/LanguageContext';
import { calculateMonthlyResult, formatCurrency, formatPercent, getAchievementColor } from '@/lib/calculations';
import DebugPanel from './DebugPanel';

interface MonthDetailProps {
  month: number;
  settings: AESettings;
  goLives: GoLive[];
  allUsers?: User[]; // Für User-Änderung
  currentUser?: User; // Für DebugPanel
  onBack: () => void;
  onUpdateGoLive: (id: string, updates: Partial<GoLive>) => Promise<{ error: any }>;
  onDeleteGoLive: (id: string) => Promise<{ error: any }>;
  onAddGoLive: () => void;
  canEnterPayARR?: boolean;
  canAddGoLives?: boolean;
  canEditGoLives?: boolean;
}

export default function MonthDetail({ 
  month, 
  settings, 
  goLives, 
  allUsers = [],
  currentUser,
  onBack, 
  onUpdateGoLive,
  onDeleteGoLive,
  onAddGoLive,
  canEnterPayARR = false,
  canAddGoLives = true,
  canEditGoLives = true
}: MonthDetailProps) {
  const { t } = useLanguage();
  const result = calculateMonthlyResult(month, goLives, settings);
  
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
  type SortField = 'customer_name' | 'go_live_date' | 'subs_arr' | 'has_terminal' | 'pay_arr' | 'commission_relevant' | 'total_arr';
  const [sortField, setSortField] = useState<SortField>('go_live_date');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');

  // Partner und Subscription Packages laden
  useEffect(() => {
    loadPartners().then(setPartners).catch(console.error);
    loadSubscriptionPackages().then(setSubscriptionPackages).catch(console.error);
  }, []);

  // User die Go-Lives erhalten können
  const goLiveReceivers = allUsers.filter(u => canReceiveGoLives(u.role));

  // Sortierte Go-Lives
  const sortedGoLives = [...goLives].sort((a, b) => {
    let comparison = 0;
    switch (sortField) {
      case 'customer_name':
        comparison = a.customer_name.localeCompare(b.customer_name, 'de');
        break;
      case 'go_live_date':
        comparison = new Date(a.go_live_date).getTime() - new Date(b.go_live_date).getTime();
        break;
      case 'subs_arr':
        comparison = a.subs_arr - b.subs_arr;
        break;
      case 'has_terminal':
        comparison = (a.has_terminal ? 1 : 0) - (b.has_terminal ? 1 : 0);
        break;
      case 'pay_arr':
        // Sortiere nach pay_arr_target (oder pay_arr wenn vorhanden)
        comparison = (a.pay_arr_target || a.pay_arr || 0) - (b.pay_arr_target || b.pay_arr || 0);
        break;
      case 'commission_relevant':
        comparison = (a.commission_relevant !== false ? 1 : 0) - (b.commission_relevant !== false ? 1 : 0);
        break;
      case 'total_arr':
        comparison = (a.subs_arr + (a.pay_arr_target || a.pay_arr || 0)) - (b.subs_arr + (b.pay_arr_target || b.pay_arr || 0));
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

  const handleDelete = async (id: string) => {
    if (confirm(t('goLive.deleteConfirm'))) {
      await onDeleteGoLive(id);
    }
  };

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
    if (!editingGoLive) return;
    
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

  // Wenn User geändert wird, Default für commission_relevant anpassen
  const handleUserChange = (newUserId: string) => {
    const newUser = goLiveReceivers.find(u => u.id === newUserId);
    setEditForm({
      ...editForm,
      user_id: newUserId,
      // Nur Default ändern wenn User sich ändert UND vorher auf Default war
      commission_relevant: newUser ? getDefaultCommissionRelevant(newUser.role) : editForm.commission_relevant,
    });
  };

  return (
    <div>
      {/* DEBUG PANEL */}
      {currentUser && (
        <DebugPanel 
          user={currentUser} 
          data={{
            month: month,
            goLivesCount: goLives.length,
            goLivesDetail: goLives.map(g => ({ 
              id: g.id.substring(0, 8), 
              customer: g.customer_name, 
              userId: g.user_id.substring(0, 8),
              commissionRelevant: g.commission_relevant 
            })),
            settingsUserId: settings.user_id.substring(0, 8),
            allUsersCount: allUsers.length,
            goLiveReceiversCount: goLiveReceivers.length,
          }}
          title="MonthDetail Debug"
        />
      )}

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center space-x-4">
          <button onClick={onBack} className="p-2 hover:bg-gray-100 rounded-lg transition">
            {t('common.back')}
          </button>
          <h2 className="text-2xl font-bold text-gray-800">
            {t(`months.${month}`)} {settings.year}
          </h2>
        </div>
        {canAddGoLives && (
          <button
            onClick={onAddGoLive}
            className="px-4 py-2 bg-green-600 text-white rounded-lg font-medium hover:bg-green-700 transition"
          >
            {t('nav.addGoLive')}
          </button>
        )}
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <div className="bg-white rounded-xl shadow-sm p-4 border-l-4 border-green-500">
          <span className="text-sm text-gray-500">{t('monthDetail.subsArr')}</span>
          <p className="text-xl font-bold text-gray-800">{formatCurrency(result.subs_actual)}</p>
          <p className={`text-sm ${getAchievementColor(result.subs_achievement)}`}>
            {formatPercent(result.subs_achievement)} {t('common.target')}
          </p>
        </div>
        <div className="bg-white rounded-xl shadow-sm p-4 border-l-4 border-orange-500">
          <span className="text-sm text-gray-500">{t('monthDetail.payArr')}</span>
          <p className="text-xl font-bold text-gray-800">{formatCurrency(result.pay_actual)}</p>
          <p className={`text-sm ${getAchievementColor(result.pay_achievement)}`}>
            {formatPercent(result.pay_achievement)} {t('common.target')}
          </p>
        </div>
        <div className="bg-white rounded-xl shadow-sm p-4 border-l-4 border-blue-500">
          <span className="text-sm text-gray-500">{t('monthDetail.terminals')}</span>
          <p className="text-xl font-bold text-gray-800">{result.terminals_count}</p>
          <p className="text-sm text-gray-500">
            {formatPercent(result.terminal_penetration)} Penetration
          </p>
        </div>
        <div className="bg-white rounded-xl shadow-sm p-4 border-l-4 border-purple-500">
          <span className="text-sm text-gray-500">{t('monthDetail.totalProvision')}</span>
          <p className="text-xl font-bold text-green-600">{formatCurrency(result.total_provision)}</p>
          <p className="text-xs text-gray-500">
            M0: {formatCurrency(result.m0_provision)} | M3: {formatCurrency(result.m3_provision)}
          </p>
        </div>
      </div>

      {/* Provision Calculation */}
      <div className="bg-white rounded-xl shadow-sm p-6 mb-6">
        <h3 className="text-lg font-bold text-gray-800 mb-4">{t('monthDetail.provisionCalculation')}</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
          <div className="p-3 bg-green-50 rounded-lg">
            <div className="font-medium text-green-700">Subs Provision (M0)</div>
            <div className="text-green-600">
              {formatCurrency(result.subs_actual)} × {formatPercent(result.subs_rate)} = {formatCurrency(result.subs_provision)}
            </div>
          </div>
          <div className="p-3 bg-blue-50 rounded-lg">
            <div className="font-medium text-blue-700">Terminal Provision (M0)</div>
            <div className="text-blue-600">
              {result.terminals_count} × €{result.terminal_rate} = {formatCurrency(result.terminal_provision)}
            </div>
          </div>
          <div className="p-3 bg-orange-50 rounded-lg">
            <div className="font-medium text-orange-700">Pay Provision (M3)</div>
            <div className="text-orange-600">
              {formatCurrency(result.pay_actual)} × {formatPercent(result.pay_rate)} = {formatCurrency(result.m3_provision)}
            </div>
          </div>
        </div>
      </div>

      {/* Go-Lives Table */}
      <div className="bg-white rounded-xl shadow-sm p-6">
        <h3 className="text-lg font-bold text-gray-800 mb-4">
          {t('monthDetail.goLivesTable')} ({goLives.length})
        </h3>

        {goLives.length === 0 ? (
          <p className="text-gray-500 text-center py-8">{t('monthDetail.noGoLives')}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th 
                    className="text-left py-3 px-2 font-medium text-gray-500 cursor-pointer hover:bg-gray-100 select-none"
                    onClick={() => handleSort('customer_name')}
                  >
                    {t('monthDetail.customer')}<SortIcon field="customer_name" />
                  </th>
                  <th 
                    className="text-left py-3 px-2 font-medium text-gray-500 cursor-pointer hover:bg-gray-100 select-none"
                    onClick={() => handleSort('go_live_date')}
                  >
                    {t('common.date')}<SortIcon field="go_live_date" />
                  </th>
                  <th 
                    className="text-right py-3 px-2 font-medium text-green-600 cursor-pointer hover:bg-gray-100 select-none"
                    onClick={() => handleSort('subs_arr')}
                  >
                    {t('monthDetail.subsArr')}<SortIcon field="subs_arr" />
                  </th>
                  <th 
                    className="text-center py-3 px-2 font-medium text-blue-600 cursor-pointer hover:bg-gray-100 select-none"
                    onClick={() => handleSort('has_terminal')}
                  >
                    Terminal<SortIcon field="has_terminal" />
                  </th>
                  <th 
                    className="text-right py-3 px-2 font-medium text-orange-600 cursor-pointer hover:bg-gray-100 select-none"
                    onClick={() => handleSort('pay_arr')}
                  >
                    Pay ARR (€)<SortIcon field="pay_arr" />
                  </th>
                  <th 
                    className="text-center py-3 px-2 font-medium text-amber-600 cursor-pointer hover:bg-gray-100 select-none"
                    onClick={() => handleSort('commission_relevant')}
                  >
                    💰<SortIcon field="commission_relevant" />
                  </th>
                  <th 
                    className="text-right py-3 px-2 font-medium text-gray-500 cursor-pointer hover:bg-gray-100 select-none"
                    onClick={() => handleSort('total_arr')}
                  >
                    {t('monthDetail.totalArr')}<SortIcon field="total_arr" />
                  </th>
                  <th className="py-3 px-2"></th>
                </tr>
              </thead>
              <tbody>
                {sortedGoLives.map(gl => (
                  <tr key={gl.id} className={`border-b hover:bg-gray-50 ${gl.commission_relevant === false ? 'bg-gray-50 opacity-70' : ''}`}>
                    <td className="py-3 px-2 font-medium text-gray-800">{gl.customer_name}</td>
                    <td className="py-3 px-2 text-gray-600">
                      {new Date(gl.go_live_date).toLocaleDateString('de-DE')}
                    </td>
                    <td className="py-3 px-2 text-right text-green-600 font-medium">
                      {formatCurrency(gl.subs_arr)}
                    </td>
                    <td className="py-3 px-2 text-center">
                      {gl.has_terminal ? (
                        <span className="text-blue-600">✓</span>
                      ) : (
                        <span className="text-gray-300">–</span>
                      )}
                    </td>
                    <td className="py-3 px-2 text-right text-orange-600 font-medium">
                      {gl.pay_arr_target || gl.pay_arr ? (
                        <div>
                          <span>{formatCurrency(gl.pay_arr_target || gl.pay_arr || 0)}</span>
                          {gl.pay_arr && gl.pay_arr_target && (
                            <span className={`block text-[10px] ${gl.pay_arr >= gl.pay_arr_target ? 'text-green-600' : 'text-red-500'}`}>
                              Ist: {formatCurrency(gl.pay_arr)}
                            </span>
                          )}
                        </div>
                      ) : '–'}
                    </td>
                    <td className="py-3 px-2 text-center">
                      {gl.commission_relevant !== false ? (
                        <span className="text-amber-600">✓</span>
                      ) : (
                        <span className="text-gray-300">–</span>
                      )}
                    </td>
                    <td className="py-3 px-2 text-right font-medium">
                      {formatCurrency(gl.subs_arr + (gl.pay_arr_target || gl.pay_arr || 0))}
                    </td>
                    <td className="py-3 px-2 text-right space-x-2">
                      {canEditGoLives && (
                        <button
                          onClick={() => openEditModal(gl)}
                          className="text-blue-500 hover:text-blue-700 text-xs"
                        >
                          {t('common.edit')}
                        </button>
                      )}
                      <button
                        onClick={() => handleDelete(gl.id)}
                        className="text-red-500 hover:text-red-700 text-xs"
                      >
                        {t('common.delete')}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Edit Modal */}
      {editingGoLive && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => setEditingGoLive(null)}>
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
                    📦 {t('goLive.subscriptionPackage')}
                  </label>
                  <select
                    value={editForm.subscription_package_id || ''}
                    onChange={(e) => setEditForm({ ...editForm, subscription_package_id: e.target.value || null })}
                    className="w-full px-3 py-2 border border-green-300 rounded-lg focus:ring-2 focus:ring-green-500 bg-white"
                  >
                    <option value="">{t('goLive.noPackage')}</option>
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
                    id="edit_hasTerminal"
                    checked={editForm.has_terminal}
                    onChange={(e) => setEditForm({ ...editForm, has_terminal: e.target.checked })}
                    className="w-5 h-5 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                  />
                  <label htmlFor="edit_hasTerminal" className="ml-2 text-sm font-medium text-gray-700">
                    {t('goLive.hasTerminal')}
                  </label>
                </div>

                {/* Provisions-relevant */}
                <div className="flex items-center p-3 bg-amber-50 rounded-lg border border-amber-200">
                  <input
                    type="checkbox"
                    id="edit_commissionRelevant"
                    checked={editForm.commission_relevant}
                    onChange={(e) => setEditForm({ ...editForm, commission_relevant: e.target.checked })}
                    className="w-5 h-5 text-amber-600 border-gray-300 rounded focus:ring-amber-500"
                  />
                  <label htmlFor="edit_commissionRelevant" className="ml-2 text-sm font-medium text-gray-700">
                    {t('goLive.commissionRelevant')}
                  </label>
                </div>

                {/* Partnership */}
                <div className="p-3 bg-purple-50 rounded-lg border border-purple-200">
                  <label className="block text-sm font-medium text-purple-700 mb-2">
                    🤝 {t('goLive.partnership')}
                  </label>
                  <select
                    value={editForm.partner_id || ''}
                    onChange={(e) => setEditForm({ ...editForm, partner_id: e.target.value || null })}
                    className="w-full px-3 py-2 border border-purple-300 rounded-lg focus:ring-2 focus:ring-purple-500 bg-white"
                  >
                    <option value="">{t('goLive.noPartner')}</option>
                    {partners.map(partner => (
                      <option key={partner.id} value={partner.id}>
                        {partner.name}
                      </option>
                    ))}
                  </select>
                  {editForm.partner_id && (
                    <p className="text-xs text-purple-600 mt-1">
                      ℹ️ {t('goLive.partnerHint')}
                    </p>
                  )}
                </div>

                {/* Enterprise / Filialunternehmen */}
                <div className="flex items-center p-3 bg-indigo-50 rounded-lg border border-indigo-200">
                  <input
                    type="checkbox"
                    id="edit_isEnterprise"
                    checked={editForm.is_enterprise}
                    onChange={(e) => setEditForm({ ...editForm, is_enterprise: e.target.checked })}
                    className="w-5 h-5 text-indigo-600 border-gray-300 rounded focus:ring-indigo-500"
                  />
                  <label htmlFor="edit_isEnterprise" className="ml-2 text-sm font-medium text-gray-700">
                    🏢 {t('goLive.enterprise')}
                  </label>
                </div>
                {editForm.is_enterprise && (
                  <p className="text-xs text-indigo-600 -mt-2 ml-3">
                    ℹ️ {t('goLive.enterpriseHint')}
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
    </div>
  );
}
