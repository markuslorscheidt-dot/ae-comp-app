'use client';

import { useState, useEffect } from 'react';
import { GoLive, User } from '@/lib/types';
import { Partner, SubscriptionPackage } from '@/lib/golive-types';
import { loadPartners, loadSubscriptionPackages } from '@/lib/golive-import-hooks';
import { useLanguage } from '@/lib/LanguageContext';
import { formatCurrency } from '@/lib/calculations';
import DebugPanel from './DebugPanel';

interface GoLiveFormProps {
  onSubmit: (goLive: Partial<GoLive>) => Promise<{ error: any }>;
  onCancel: () => void;
  defaultMonth: number;
  initialData?: GoLive;
  canEnterPayARR?: boolean;
  defaultCommissionRelevant?: boolean; // Default basierend auf Rolle des Empfängers
  currentUser?: User; // Für DebugPanel
  targetUserId?: string; // User für den der Go-Live angelegt wird
}

export default function GoLiveForm({ onSubmit, onCancel, defaultMonth, initialData, canEnterPayARR = false, defaultCommissionRelevant = true, currentUser, targetUserId }: GoLiveFormProps) {
  const { t } = useLanguage();
  const [month, setMonth] = useState(initialData?.month || defaultMonth);
  const [customerName, setCustomerName] = useState(initialData?.customer_name || '');
  const [oakId, setOakId] = useState(initialData?.oak_id?.toString() || '');
  const [goLiveDate, setGoLiveDate] = useState(initialData?.go_live_date || '');
  const [subsMonthly, setSubsMonthly] = useState(initialData?.subs_monthly?.toString() || '');
  const [hasTerminal, setHasTerminal] = useState(initialData?.has_terminal || false);
  const [payArr, setPayArr] = useState(initialData?.pay_arr?.toString() || '');
  const [commissionRelevant, setCommissionRelevant] = useState(initialData?.commission_relevant ?? defaultCommissionRelevant);
  // NEU: Partnership & Enterprise
  const [partnerId, setPartnerId] = useState<string | null>(initialData?.partner_id || null);
  const [isEnterprise, setIsEnterprise] = useState(initialData?.is_enterprise || false);
  const [partners, setPartners] = useState<Partner[]>([]);
  // NEU: Subscription Package
  const [subscriptionPackageId, setSubscriptionPackageId] = useState<string | null>(initialData?.subscription_package_id || null);
  const [subscriptionPackages, setSubscriptionPackages] = useState<SubscriptionPackage[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Partner und Subscription Packages laden
  useEffect(() => {
    loadPartners().then(setPartners).catch(console.error);
    loadSubscriptionPackages().then(setSubscriptionPackages).catch(console.error);
  }, []);

  const subsArr = subsMonthly ? parseFloat(subsMonthly) * 12 : 0;

  const [successMessage, setSuccessMessage] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccessMessage('');
    setLoading(true);

    try {
      const result = await onSubmit({
        month,
        customer_name: customerName,
        oak_id: oakId ? parseInt(oakId) : null,
        go_live_date: goLiveDate,
        subs_monthly: parseFloat(subsMonthly) || 0,
        has_terminal: hasTerminal,
        pay_arr: payArr ? parseFloat(payArr) : null,
        commission_relevant: commissionRelevant,
        // NEU: Partnership & Enterprise
        partner_id: partnerId,
        is_enterprise: isEnterprise,
        // NEU: Subscription Package
        subscription_package_id: subscriptionPackageId,
      });

      if (result.error) {
        setError(result.error.message || t('errors.generic'));
      } else {
        // Erfolg: Formular zurücksetzen für nächste Eingabe
        setSuccessMessage(t('goLive.addSuccess'));
        setCustomerName('');
        setOakId('');
        setGoLiveDate('');
        setSubsMonthly('');
        setHasTerminal(false);
        setPayArr('');
        setPartnerId(null);
        setIsEnterprise(false);
        setSubscriptionPackageId(null);
        // Monat und commissionRelevant behalten für schnelle Eingabe
        
        // Erfolgsmeldung nach 1 Sekunde ausblenden
        setTimeout(() => setSuccessMessage(''), 1000);
      }
    } catch (err) {
      setError(t('errors.generic'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-white rounded-xl shadow-sm p-6">
      {/* DEBUG PANEL */}
      {currentUser && (
        <DebugPanel 
          user={currentUser} 
          data={{
            currentUserId: currentUser.id.substring(0, 8),
            currentUserRole: currentUser.role,
            targetUserId: targetUserId?.substring(0, 8) || 'nicht gesetzt',
            defaultCommissionRelevant: defaultCommissionRelevant,
            commissionRelevant: commissionRelevant,
            isEdit: !!initialData,
            formData: {
              month,
              customerName,
              subsMonthly,
              hasTerminal,
            }
          }}
          title="GoLiveForm Debug"
        />
      )}

      <h2 className="text-xl font-bold text-gray-800 mb-6">
        {initialData ? t('goLive.editTitle') : t('goLive.title')}
      </h2>

      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Monat */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            {t('common.month')}
          </label>
          <select
            value={month}
            onChange={(e) => setMonth(parseInt(e.target.value))}
            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
          >
            {[1,2,3,4,5,6,7,8,9,10,11,12].map(m => (
              <option key={m} value={m}>{t(`months.${m}`)}</option>
            ))}
          </select>
        </div>

        {/* Kundenname */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            {t('goLive.customerName')}
          </label>
          <input
            type="text"
            value={customerName}
            onChange={(e) => setCustomerName(e.target.value)}
            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
            placeholder={t('goLive.customerPlaceholder')}
            required
          />
        </div>

        {/* OAK ID */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            {t('goLive.oakId')}
          </label>
          <input
            type="number"
            value={oakId}
            onChange={(e) => setOakId(e.target.value)}
            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
            placeholder={t('goLive.oakIdPlaceholder')}
            min="0"
          />
        </div>

        {/* Go-Live Datum */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            {t('goLive.goLiveDate')}
          </label>
          <input
            type="date"
            value={goLiveDate}
            onChange={(e) => setGoLiveDate(e.target.value)}
            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
            required
          />
        </div>

        {/* Subs €/Monat */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            {t('goLive.subsMonthly')}
          </label>
          <input
            type="number"
            value={subsMonthly}
            onChange={(e) => setSubsMonthly(e.target.value)}
            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
            placeholder={t('goLive.subsMonthlyPlaceholder')}
            min="0"
            step="0.01"
            required
          />
          {subsArr > 0 && (
            <p className="text-sm text-green-600 mt-1">
              {t('goLive.subsArr')}: {formatCurrency(subsArr)}
            </p>
          )}
        </div>

        {/* Subscription Package */}
        <div className="p-3 bg-green-50 rounded-lg border border-green-200">
          <label className="block text-sm font-medium text-green-700 mb-2">
            📦 Subscription Paket
          </label>
          <select
            value={subscriptionPackageId || ''}
            onChange={(e) => setSubscriptionPackageId(e.target.value || null)}
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
            id="hasTerminal"
            checked={hasTerminal}
            onChange={(e) => setHasTerminal(e.target.checked)}
            className="w-5 h-5 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
          />
          <label htmlFor="hasTerminal" className="ml-2 text-sm font-medium text-gray-700">
            {t('goLive.hasTerminal')}
          </label>
        </div>

        {/* Partnership */}
        <div className="p-3 bg-purple-50 rounded-lg border border-purple-200">
          <label className="block text-sm font-medium text-purple-700 mb-2">
            🤝 Partnership
          </label>
          <select
            value={partnerId || ''}
            onChange={(e) => setPartnerId(e.target.value || null)}
            className="w-full px-3 py-2 border border-purple-300 rounded-lg focus:ring-2 focus:ring-purple-500 bg-white"
          >
            <option value="">Kein Partner (Standard)</option>
            {partners.map(partner => (
              <option key={partner.id} value={partner.id}>
                {partner.name}
              </option>
            ))}
          </select>
          {partnerId && (
            <p className="text-xs text-purple-600 mt-1">
              ℹ️ Wird intern Head of Partnerships zugeordnet
            </p>
          )}
        </div>

        {/* Filialunternehmen */}
        <div className="flex items-center p-3 bg-indigo-50 rounded-lg border border-indigo-200">
          <input
            type="checkbox"
            id="isEnterprise"
            checked={isEnterprise}
            onChange={(e) => setIsEnterprise(e.target.checked)}
            className="w-5 h-5 text-indigo-600 border-gray-300 rounded focus:ring-indigo-500"
          />
          <label htmlFor="isEnterprise" className="ml-2 text-sm font-medium text-gray-700">
            🏢 Filialunternehmen (≥5 Filialen)
          </label>
        </div>
        {isEnterprise && (
          <p className="text-xs text-indigo-600 -mt-2 ml-3">
            ℹ️ Wird intern Head of Partnerships zugeordnet
          </p>
        )}

        {/* Provisions-relevant */}
        <div className="flex items-center p-3 bg-amber-50 rounded-lg border border-amber-200">
          <input
            type="checkbox"
            id="commissionRelevant"
            checked={commissionRelevant}
            onChange={(e) => setCommissionRelevant(e.target.checked)}
            className="w-5 h-5 text-amber-600 border-gray-300 rounded focus:ring-amber-500"
          />
          <label htmlFor="commissionRelevant" className="ml-2 text-sm font-medium text-gray-700">
            {t('goLive.commissionRelevant')}
          </label>
          <span className="ml-2 text-xs text-gray-500">
            ({t('goLive.commissionRelevantHint')})
          </span>
        </div>

        {/* Pay ARR (nur für Manager) */}
        {canEnterPayARR && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {t('goLive.payArr')}
              <span className="text-gray-400 font-normal ml-2">• {t('goLive.payArrHint')}</span>
            </label>
            <input
              type="number"
              value={payArr}
              onChange={(e) => setPayArr(e.target.value)}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
              placeholder={t('goLive.payArrPlaceholder')}
              min="0"
              step="0.01"
            />
          </div>
        )}

        {/* Vorschau */}
        {(subsArr > 0 || hasTerminal) && (
          <div className="p-4 bg-gray-50 rounded-lg">
            <h3 className="text-sm font-medium text-gray-700 mb-2">{t('goLive.preview')}</h3>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div>
                <span className="text-gray-500">{t('goLive.subsArr')}:</span>
                <span className="ml-2 font-medium text-green-600">{formatCurrency(subsArr)}</span>
              </div>
              <div>
                <span className="text-gray-500">Terminal:</span>
                <span className="ml-2 font-medium">{hasTerminal ? t('common.yes') : t('common.no')}</span>
              </div>
              {payArr && (
                <div>
                  <span className="text-gray-500">{t('goLive.payArr')}:</span>
                  <span className="ml-2 font-medium text-orange-600">{formatCurrency(parseFloat(payArr))}</span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Erfolgsmeldung */}
        {successMessage && (
          <div className="p-3 bg-green-50 border border-green-200 text-green-700 rounded-lg text-sm flex items-center">
            <span className="mr-2">✅</span>
            {successMessage}
          </div>
        )}

        {error && (
          <div className="p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">
            {error}
          </div>
        )}

        {/* Buttons */}
        <div className="flex space-x-4 pt-4">
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 py-3 border border-gray-300 text-gray-700 rounded-lg font-medium hover:bg-gray-50 transition"
          >
            {t('common.cancel')}
          </button>
          <button
            type="submit"
            disabled={loading}
            className="flex-1 py-3 bg-green-600 text-white rounded-lg font-medium hover:bg-green-700 transition disabled:opacity-50"
          >
            {loading ? t('common.loading') : t('common.save')}
          </button>
        </div>
      </form>
    </div>
  );
}
