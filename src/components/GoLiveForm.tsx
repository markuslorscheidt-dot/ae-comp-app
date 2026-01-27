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
  avgPayBillTerminal?: number; // NEU: Avg Pay Bill Terminal aus Einstellungen für Target-Berechnung
}

export default function GoLiveForm({ onSubmit, onCancel, defaultMonth, initialData, canEnterPayARR = false, defaultCommissionRelevant = true, currentUser, targetUserId, avgPayBillTerminal = 0 }: GoLiveFormProps) {
  const { t } = useLanguage();
  const [month, setMonth] = useState(initialData?.month || defaultMonth);
  const [customerName, setCustomerName] = useState(initialData?.customer_name || '');
  const [oakId, setOakId] = useState(initialData?.oak_id?.toString() || '');
  const [goLiveDate, setGoLiveDate] = useState(initialData?.go_live_date || '');
  const [subsMonthly, setSubsMonthly] = useState(initialData?.subs_monthly?.toString() || '');
  const [hasTerminal, setHasTerminal] = useState(initialData?.has_terminal || false);
  // Pay monatlich Target (editierbar, Default aus Einstellungen)
  // Bei Edit: aus pay_arr_target berechnen, sonst aus Settings
  const [payMonthlyTarget, setPayMonthlyTarget] = useState(
    initialData?.pay_arr_target 
      ? (initialData.pay_arr_target / 12).toString() 
      : avgPayBillTerminal > 0 ? avgPayBillTerminal.toString() : ''
  );
  // Pay ARR Target wird aus dem editierbaren Wert berechnet
  const payArrTarget = hasTerminal && payMonthlyTarget ? parseFloat(payMonthlyTarget) * 12 : null;
  // Pay monatlich Ist (nach 3 Monaten eintragen), wird als ARR (×12) gespeichert
  const [payMonthly, setPayMonthly] = useState(initialData?.pay_arr ? (initialData.pay_arr / 12).toString() : '');
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
        pay_arr_target: payArrTarget,  // NEU: Pay ARR Target aus Einstellungen
        pay_arr: payMonthly ? parseFloat(payMonthly) * 12 : null,  // Pay ARR Ist (nach 3 Monaten)
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
        setPayMonthlyTarget(avgPayBillTerminal > 0 ? avgPayBillTerminal.toString() : '');  // Auf Default aus Settings zurücksetzen
        setPayMonthly('');
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
    <div className="bg-white rounded-lg md:rounded-xl shadow-sm p-4 md:p-6">
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

      <h2 className="text-lg md:text-xl font-bold text-gray-800 mb-4 md:mb-6">
        {initialData ? t('goLive.editTitle') : t('goLive.title')}
      </h2>

      <form onSubmit={handleSubmit} className="space-y-3 md:space-y-4">
        {/* Monat + Datum Row */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs md:text-sm font-medium text-gray-700 mb-1">
              {t('common.month')}
            </label>
            <select
              value={month}
              onChange={(e) => setMonth(parseInt(e.target.value))}
              className="w-full px-3 py-2.5 md:py-2 text-base md:text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
            >
              {[1,2,3,4,5,6,7,8,9,10,11,12].map(m => (
                <option key={m} value={m}>{t(`months.${m}`)}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs md:text-sm font-medium text-gray-700 mb-1">
              {t('goLive.goLiveDate')}
            </label>
            <input
              type="date"
              value={goLiveDate}
              onChange={(e) => setGoLiveDate(e.target.value)}
              className="w-full px-3 py-2.5 md:py-2 text-base md:text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
              required
            />
          </div>
        </div>

        {/* Kundenname */}
        <div>
          <label className="block text-xs md:text-sm font-medium text-gray-700 mb-1">
            {t('goLive.customerName')}
          </label>
          <input
            type="text"
            value={customerName}
            onChange={(e) => setCustomerName(e.target.value)}
            className="w-full px-3 py-2.5 md:py-2 text-base md:text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
            placeholder={t('goLive.customerPlaceholder')}
            required
          />
        </div>

        {/* OAK ID + Subs Monat Row */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs md:text-sm font-medium text-gray-700 mb-1">
              {t('goLive.oakId')}
            </label>
            <input
              type="number"
              value={oakId}
              onChange={(e) => setOakId(e.target.value)}
              className="w-full px-3 py-2.5 md:py-2 text-base md:text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
              placeholder={t('goLive.oakIdPlaceholder')}
              min="0"
            />
          </div>
          <div>
            <label className="block text-xs md:text-sm font-medium text-gray-700 mb-1">
              {t('goLive.subsMonthly')}
            </label>
            <input
              type="number"
              value={subsMonthly}
              onChange={(e) => setSubsMonthly(e.target.value)}
              className="w-full px-3 py-2.5 md:py-2 text-base md:text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
              placeholder="€/Monat"
              min="0"
              step="0.01"
              required
            />
            {subsArr > 0 && (
              <p className="text-[10px] md:text-xs text-green-600 mt-0.5">
                ARR: {formatCurrency(subsArr)}
              </p>
            )}
          </div>
        </div>

        {/* Subscription Package */}
        <div className="p-2.5 md:p-3 bg-green-50 rounded-lg border border-green-200">
          <label className="block text-xs md:text-sm font-medium text-green-700 mb-1.5 md:mb-2">
            📦 {t('goLive.subscriptionPackage')}
          </label>
          <select
            value={subscriptionPackageId || ''}
            onChange={(e) => setSubscriptionPackageId(e.target.value || null)}
            className="w-full px-3 py-2.5 md:py-2 text-base md:text-sm border border-green-300 rounded-lg focus:ring-2 focus:ring-green-500 bg-white"
          >
            <option value="">{t('goLive.noPackage')}</option>
            {subscriptionPackages.map(pkg => (
              <option key={pkg.id} value={pkg.id}>
                {pkg.name}
              </option>
            ))}
          </select>
        </div>

        {/* Checkboxes Row */}
        <div className="grid grid-cols-2 gap-3">
          {/* Terminal */}
          <div className="flex items-center p-2.5 bg-blue-50 rounded-lg border border-blue-200">
            <input
              type="checkbox"
              id="hasTerminal"
              checked={hasTerminal}
              onChange={(e) => setHasTerminal(e.target.checked)}
              className="w-5 h-5 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
            />
            <label htmlFor="hasTerminal" className="ml-2 text-xs md:text-sm font-medium text-gray-700">
              {t('goLive.hasTerminal')}
            </label>
          </div>

          {/* Provisions-relevant */}
          <div className="flex items-center p-2.5 bg-amber-50 rounded-lg border border-amber-200">
            <input
              type="checkbox"
              id="commissionRelevant"
              checked={commissionRelevant}
              onChange={(e) => setCommissionRelevant(e.target.checked)}
              className="w-5 h-5 text-amber-600 border-gray-300 rounded focus:ring-amber-500"
            />
            <label htmlFor="commissionRelevant" className="ml-2 text-xs md:text-sm font-medium text-gray-700">
              {t('goLive.commissionRelevant')} ✓
            </label>
          </div>
        </div>

        {/* Pay monatlich Target (erscheint wenn Terminal aktiviert) */}
        {hasTerminal && (
          <div className="p-2.5 md:p-3 bg-orange-50 rounded-lg border border-orange-200">
            <label className="block text-xs md:text-sm font-medium text-orange-700 mb-1.5 md:mb-2">
              💳 Pay monatlich Target (€)
            </label>
            <input
              type="number"
              value={payMonthlyTarget}
              onChange={(e) => setPayMonthlyTarget(e.target.value)}
              className="w-full px-3 py-2.5 md:py-2 text-base md:text-sm border border-orange-300 rounded-lg focus:ring-2 focus:ring-orange-500 bg-white"
              placeholder={`Default: €${avgPayBillTerminal}`}
              min="0"
              step="0.01"
            />
            {payArrTarget && payArrTarget > 0 && (
              <p className="text-[10px] md:text-xs text-orange-600 mt-1">
                → Pay ARR Target: <strong>{formatCurrency(payArrTarget)}</strong> (€{payMonthlyTarget} × 12)
              </p>
            )}
          </div>
        )}

        {/* Partnership */}
        <div className="p-2.5 md:p-3 bg-purple-50 rounded-lg border border-purple-200">
          <label className="block text-xs md:text-sm font-medium text-purple-700 mb-1.5 md:mb-2">
            🤝 {t('goLive.partnership')}
          </label>
          <select
            value={partnerId || ''}
            onChange={(e) => setPartnerId(e.target.value || null)}
            className="w-full px-3 py-2.5 md:py-2 text-base md:text-sm border border-purple-300 rounded-lg focus:ring-2 focus:ring-purple-500 bg-white"
          >
            <option value="">{t('goLive.noPartner')}</option>
            {partners.map(partner => (
              <option key={partner.id} value={partner.id}>
                {partner.name}
              </option>
            ))}
          </select>
        </div>

        {/* Enterprise / Filialunternehmen */}
        <div className="flex items-center p-2.5 md:p-3 bg-indigo-50 rounded-lg border border-indigo-200">
          <input
            type="checkbox"
            id="isEnterprise"
            checked={isEnterprise}
            onChange={(e) => setIsEnterprise(e.target.checked)}
            className="w-5 h-5 text-indigo-600 border-gray-300 rounded focus:ring-indigo-500"
          />
          <label htmlFor="isEnterprise" className="ml-2 text-xs md:text-sm font-medium text-gray-700">
            🏢 {t('goLive.enterprise')}
          </label>
        </div>

        {/* Pay monatlich (nur für Manager) - wird als ARR (×12) gespeichert */}
        {canEnterPayARR && (
          <div>
            <label className="block text-xs md:text-sm font-medium text-gray-700 mb-1">
              Pay monatlich (€)
              <span className="text-gray-400 font-normal ml-1 text-[10px] md:text-xs">({t('goLive.payArrHint')})</span>
            </label>
            <input
              type="number"
              value={payMonthly}
              onChange={(e) => setPayMonthly(e.target.value)}
              className="w-full px-3 py-2.5 md:py-2 text-base md:text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
              placeholder="z.B. 100"
              min="0"
              step="0.01"
            />
          </div>
        )}

        {/* Vorschau */}
        {(subsArr > 0 || hasTerminal) && (
          <div className="p-3 md:p-4 bg-gray-50 rounded-lg">
            <h3 className="text-xs md:text-sm font-medium text-gray-700 mb-2">{t('goLive.preview')}</h3>
            <div className="grid grid-cols-3 gap-2 text-xs md:text-sm">
              <div>
                <span className="text-gray-500 block text-[10px] md:text-xs">{t('goLive.subsArr')}</span>
                <span className="font-medium text-green-600">{formatCurrency(subsArr)}</span>
              </div>
              <div>
                <span className="text-gray-500 block text-[10px] md:text-xs">Terminal</span>
                <span className="font-medium">{hasTerminal ? '✓' : '-'}</span>
              </div>
              {payArrTarget && payArrTarget > 0 && (
                <div>
                  <span className="text-gray-500 block text-[10px] md:text-xs">Pay ARR Target</span>
                  <span className="font-medium text-orange-600">{formatCurrency(payArrTarget)}</span>
                  <span className="text-[9px] text-gray-400 block">(€{payMonthlyTarget}×12)</span>
                </div>
              )}
            </div>
            {/* Pay Ist (optional, nach 3 Monaten) */}
            {payMonthly && (
              <div className="mt-2 pt-2 border-t border-gray-200">
                <div className="grid grid-cols-3 gap-2 text-xs md:text-sm">
                  <div>
                    <span className="text-gray-500 block text-[10px] md:text-xs">Pay ARR Ist</span>
                    <span className="font-medium text-orange-600">{formatCurrency(parseFloat(payMonthly) * 12)}</span>
                  </div>
                  {payArrTarget && (
                    <div>
                      <span className="text-gray-500 block text-[10px] md:text-xs">Differenz</span>
                      <span className={`font-medium ${(payArrTarget - parseFloat(payMonthly) * 12) > 0 ? 'text-red-600' : 'text-green-600'}`}>
                        {formatCurrency(payArrTarget - parseFloat(payMonthly) * 12)}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Erfolgsmeldung */}
        {successMessage && (
          <div className="p-2.5 md:p-3 bg-green-50 border border-green-200 text-green-700 rounded-lg text-xs md:text-sm flex items-center">
            <span className="mr-2">✅</span>
            {successMessage}
          </div>
        )}

        {error && (
          <div className="p-2.5 md:p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-xs md:text-sm">
            {error}
          </div>
        )}

        {/* Buttons */}
        <div className="flex space-x-3 md:space-x-4 pt-3 md:pt-4">
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 py-3 border border-gray-300 text-gray-700 rounded-lg font-medium hover:bg-gray-50 transition text-sm md:text-base"
          >
            {t('common.cancel')}
          </button>
          <button
            type="submit"
            disabled={loading}
            className="flex-1 py-3 bg-green-600 text-white rounded-lg font-medium hover:bg-green-700 transition disabled:opacity-50 text-sm md:text-base"
          >
            {loading ? t('common.loading') : t('common.save')}
          </button>
        </div>
      </form>
    </div>
  );
}
