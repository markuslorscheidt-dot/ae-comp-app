'use client';

import { useState, useEffect } from 'react';
import { AESettings, ProvisionTier, DEFAULT_SUBS_TIERS, DEFAULT_PAY_TIERS, DEFAULT_MONTHLY_GO_LIVE_TARGETS, DEFAULT_SETTINGS, calculateMonthlySubsTargets, calculateMonthlyPayTargets, User } from '@/lib/types';
import { useLanguage } from '@/lib/LanguageContext';
import { calculateOTEProjections, validateOTESettings, formatCurrency, formatPercent } from '@/lib/calculations';
import DebugPanel from './DebugPanel';
import PartnerManagement from './PartnerManagement';

interface SettingsPanelProps {
  settings: AESettings;
  onSave: (updates: Partial<AESettings>) => Promise<{ error: any }>;
  onBack: () => void;
  currentUser?: User;
  selectedUser?: User;
}

export default function SettingsPanel({ settings, onSave, onBack, currentUser, selectedUser }: SettingsPanelProps) {
  const { t } = useLanguage();
  
  // Grundeinstellungen
  const [year, setYear] = useState(settings.year);
  const [region, setRegion] = useState(settings.region);
  const [ote, setOte] = useState(settings.ote);
  
  // Go-Lives pro Monat
  const [goLiveTargets, setGoLiveTargets] = useState<number[]>(
    settings.monthly_go_live_targets || DEFAULT_MONTHLY_GO_LIVE_TARGETS
  );
  
  // Durchschnittliche Umsätze
  const [avgSubsBill, setAvgSubsBill] = useState(settings.avg_subs_bill || DEFAULT_SETTINGS.avg_subs_bill);
  const [avgPayBill, setAvgPayBill] = useState(settings.avg_pay_bill || DEFAULT_SETTINGS.avg_pay_bill);
  const [payArrFactor, setPayArrFactor] = useState(settings.pay_arr_factor || DEFAULT_SETTINGS.pay_arr_factor);
  
  // Terminal
  const [terminalBase, setTerminalBase] = useState(settings.terminal_base);
  const [terminalBonus, setTerminalBonus] = useState(settings.terminal_bonus);
  
  // Provisions-Stufen
  const [subsTiers, setSubsTiers] = useState<ProvisionTier[]>(settings.subs_tiers || DEFAULT_SUBS_TIERS);
  const [payTiers, setPayTiers] = useState<ProvisionTier[]>(settings.pay_tiers || DEFAULT_PAY_TIERS);
  
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  // Berechnete Werte
  const subsTargets = calculateMonthlySubsTargets(goLiveTargets, avgSubsBill);
  const payTargets = calculateMonthlyPayTargets(subsTargets, payArrFactor);
  const yearlySubsTarget = subsTargets.reduce((a, b) => a + b, 0);
  const yearlyPayTarget = payTargets.reduce((a, b) => a + b, 0);
  const yearlyGoLives = goLiveTargets.reduce((a, b) => a + b, 0);

  // Preview-Settings für OTE-Validierung
  const previewSettings: AESettings = {
    ...settings,
    year,
    region,
    ote,
    monthly_go_live_targets: goLiveTargets,
    avg_subs_bill: avgSubsBill,
    avg_pay_bill: avgPayBill,
    pay_arr_factor: payArrFactor,
    monthly_subs_targets: subsTargets,
    monthly_pay_targets: payTargets,
    terminal_base: terminalBase,
    terminal_bonus: terminalBonus,
    subs_tiers: subsTiers,
    pay_tiers: payTiers,
  };

  const oteValidation = validateOTESettings(previewSettings);
  const oteProjections = calculateOTEProjections(previewSettings);

  const handleGoLiveChange = (month: number, value: number) => {
    const newTargets = [...goLiveTargets];
    newTargets[month] = value;
    setGoLiveTargets(newTargets);
  };

  const handleSubsTierRateChange = (index: number, rate: number) => {
    const newTiers = [...subsTiers];
    newTiers[index] = { ...newTiers[index], rate };
    setSubsTiers(newTiers);
  };

  const handlePayTierRateChange = (index: number, rate: number) => {
    const newTiers = [...payTiers];
    newTiers[index] = { ...newTiers[index], rate };
    setPayTiers(newTiers);
  };

  const handleSave = async () => {
    setSaving(true);
    setMessage('');

    const updates: Partial<AESettings> = {
      year,
      region,
      ote,
      monthly_go_live_targets: goLiveTargets,
      avg_subs_bill: avgSubsBill,
      avg_pay_bill: avgPayBill,
      pay_arr_factor: payArrFactor,
      monthly_subs_targets: subsTargets,
      monthly_pay_targets: payTargets,
      terminal_base: terminalBase,
      terminal_bonus: terminalBonus,
      subs_tiers: subsTiers,
      pay_tiers: payTiers,
    };

    const result = await onSave(updates);
    
    if (result.error) {
      setMessage(t('settingsPanel.saveError') + `: ${result.error.message}`);
    } else {
      setMessage(t('settingsPanel.saved'));
      setTimeout(() => setMessage(''), 3000);
    }
    
    setSaving(false);
  };

  // Monatsnamen - werden durch i18n ersetzt
  const months = [
    t('months.1').substring(0, 3),
    t('months.2').substring(0, 3),
    t('months.3').substring(0, 3),
    t('months.4').substring(0, 3),
    t('months.5').substring(0, 3),
    t('months.6').substring(0, 3),
    t('months.7').substring(0, 3),
    t('months.8').substring(0, 3),
    t('months.9').substring(0, 3),
    t('months.10').substring(0, 3),
    t('months.11').substring(0, 3),
    t('months.12').substring(0, 3),
  ];

  return (
    <div className="space-y-6">
      {/* DEBUG PANEL */}
      {currentUser && (
        <DebugPanel 
          user={currentUser} 
          data={{
            settingsId: settings.id.substring(0, 8),
            settingsUserId: settings.user_id.substring(0, 8),
            year: year,
            ote: ote,
            yearlyGoLives: yearlyGoLives,
            yearlySubsTarget: yearlySubsTarget,
            yearlyPayTarget: yearlyPayTarget,
            subsTiersCount: subsTiers.length,
            payTiersCount: payTiers.length,
          }}
          title="SettingsPanel Debug"
        />
      )}

      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-4">
          <button onClick={onBack} className="p-2 hover:bg-gray-100 rounded-lg transition">
            {t('common.back')}
          </button>
          <h2 className="text-2xl font-bold text-gray-800">
            {t('nav.settings')}{selectedUser ? ` ${t('common.for')} ${selectedUser.name}` : ''}
          </h2>
        </div>
        <button
          onClick={handleSave}
          disabled={saving}
          className="px-6 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition disabled:opacity-50"
        >
          {saving ? t('common.saving') : t('common.save')}
        </button>
      </div>

      {message && (
        <div className={`p-3 rounded-lg text-sm ${message.includes('❌') ? 'bg-red-50 text-red-700' : 'bg-green-50 text-green-700'}`}>
          {message}
        </div>
      )}

      {/* Grundeinstellungen */}
      <div className="bg-white rounded-xl shadow-sm p-6">
        <h3 className="text-lg font-bold text-gray-800 mb-4">{t('settingsPanel.basicSettings')}</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{t('settingsPanel.year')}</label>
            <input
              type="number"
              value={year}
              onChange={(e) => setYear(parseInt(e.target.value))}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{t('settingsPanel.companyRegion')}</label>
            <input
              type="text"
              value={region}
              onChange={(e) => setRegion(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">OTE (On-Target Earnings)</label>
            <div className="relative">
              <span className="absolute left-3 top-2 text-gray-500">€</span>
              <input
                type="number"
                value={ote}
                onChange={(e) => setOte(parseInt(e.target.value))}
                className="w-full pl-8 pr-3 py-2 border border-gray-300 rounded-lg"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Go-Lives pro Monat */}
      <div className="bg-white rounded-xl shadow-sm p-6">
        <h3 className="text-lg font-bold text-gray-800 mb-4">{t('settingsPanel.goLivesPerMonth')}</h3>
        <div className="grid grid-cols-6 md:grid-cols-12 gap-2">
          {months.map((m, i) => (
            <div key={i} className="text-center">
              <label className="block text-xs font-medium text-gray-500 mb-1">{m}</label>
              <input
                type="number"
                value={goLiveTargets[i]}
                onChange={(e) => handleGoLiveChange(i, parseInt(e.target.value) || 0)}
                className="w-full px-2 py-1 text-center border border-gray-300 rounded text-sm"
              />
            </div>
          ))}
        </div>
        <p className="mt-2 text-sm text-gray-500">
          Summe: <strong>{yearlyGoLives}</strong> Go-Lives / {t('settingsPanel.year')}
        </p>
      </div>

      {/* Durchschnittliche Monatsumsätze */}
      <div className="bg-white rounded-xl shadow-sm p-6">
        <h3 className="text-lg font-bold text-gray-800 mb-4">{t('settingsPanel.avgMonthlyRevenue')}</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{t('settingsPanel.avgSubsBill')}</label>
            <input
              type="number"
              value={avgSubsBill}
              onChange={(e) => setAvgSubsBill(parseInt(e.target.value) || 0)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{t('settingsPanel.avgPayBill')}</label>
            <input
              type="number"
              value={avgPayBill}
              onChange={(e) => setAvgPayBill(parseInt(e.target.value) || 0)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{t('settingsPanel.payArrFactor')}</label>
            <div className="relative">
              <input
                type="number"
                value={(payArrFactor * 100).toFixed(0)}
                onChange={(e) => setPayArrFactor(parseInt(e.target.value) / 100)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                step="1"
              />
              <span className="absolute right-3 top-2 text-gray-500">%</span>
            </div>
          </div>
        </div>
      </div>

      {/* Berechnete ARR-Ziele */}
      <div className="bg-white rounded-xl shadow-sm p-6">
        <h3 className="text-lg font-bold text-gray-800 mb-4">{t('settingsPanel.monthlyArrTargets')}</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b">
                <th className="text-left py-2 px-1 font-medium text-gray-500">{t('settingsPanel.month')}</th>
                <th className="text-right py-2 px-1 font-medium text-green-600">{t('settingsPanel.subsArrTarget')}</th>
                <th className="text-right py-2 px-1 font-medium text-orange-600">{t('settingsPanel.payArrTarget')}</th>
                <th className="text-right py-2 px-1 font-medium text-purple-600">{t('settingsPanel.totalArrTarget')}</th>
              </tr>
            </thead>
            <tbody>
              {months.map((m, i) => (
                <tr key={i} className="border-b">
                  <td className="py-2 px-1">{m}</td>
                  <td className="py-2 px-1 text-right text-green-600">{formatCurrency(subsTargets[i])}</td>
                  <td className="py-2 px-1 text-right text-orange-600">{formatCurrency(payTargets[i])}</td>
                  <td className="py-2 px-1 text-right text-purple-600 font-medium">{formatCurrency(subsTargets[i] + payTargets[i])}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-gray-50 font-bold">
                <td className="py-2 px-1">{t('settingsPanel.yearlyTarget')}</td>
                <td className="py-2 px-1 text-right text-green-700">{formatCurrency(yearlySubsTarget)}</td>
                <td className="py-2 px-1 text-right text-orange-700">{formatCurrency(yearlyPayTarget)}</td>
                <td className="py-2 px-1 text-right text-purple-700">{formatCurrency(yearlySubsTarget + yearlyPayTarget)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {/* Terminal-Provision */}
      <div className="bg-white rounded-xl shadow-sm p-6">
        <h3 className="text-lg font-bold text-gray-800 mb-4">{t('settingsPanel.terminalProvision')}</h3>
        <p className="text-sm text-gray-500 mb-4">{t('settingsPanel.terminalHint')}</p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{t('settingsPanel.base')}</label>
            <input
              type="number"
              value={terminalBase}
              onChange={(e) => setTerminalBase(parseInt(e.target.value) || 0)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{t('settingsPanel.bonusPenetration')}</label>
            <input
              type="number"
              value={terminalBonus}
              onChange={(e) => setTerminalBonus(parseInt(e.target.value) || 0)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg"
            />
          </div>
        </div>
      </div>

      {/* Provisions-Stufen */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Subs ARR Stufen */}
        <div className="bg-white rounded-xl shadow-sm p-6">
          <h3 className="text-lg font-bold text-green-700 mb-4">{t('settingsPanel.subsArrTiers')}</h3>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b">
                <th className="text-left py-2 font-medium text-gray-500">{t('settingsPanel.achievement')}</th>
                <th className="text-right py-2 font-medium text-gray-500">{t('settingsPanel.subsArrPaid')}</th>
              </tr>
            </thead>
            <tbody>
              {subsTiers.map((tier, i) => (
                <tr key={i} className="border-b">
                  <td className="py-2">{tier.label}</td>
                  <td className="py-2 text-right">
                    <div className="flex items-center justify-end space-x-1">
                      <input
                        type="number"
                        value={(tier.rate * 100).toFixed(1)}
                        onChange={(e) => handleSubsTierRateChange(i, parseFloat(e.target.value) / 100)}
                        className="w-16 px-2 py-1 text-right border border-gray-300 rounded text-sm"
                        step="0.1"
                      />
                      <span className="text-gray-500">%</span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Pay ARR Stufen */}
        <div className="bg-white rounded-xl shadow-sm p-6">
          <h3 className="text-lg font-bold text-orange-700 mb-4">{t('settingsPanel.payArrTiers')}</h3>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b">
                <th className="text-left py-2 font-medium text-gray-500">{t('settingsPanel.achievement')}</th>
                <th className="text-right py-2 font-medium text-gray-500">{t('settingsPanel.payArrPaid')}</th>
              </tr>
            </thead>
            <tbody>
              {payTiers.map((tier, i) => (
                <tr key={i} className="border-b">
                  <td className="py-2">{tier.label}</td>
                  <td className="py-2 text-right">
                    <div className="flex items-center justify-end space-x-1">
                      <input
                        type="number"
                        value={(tier.rate * 100).toFixed(1)}
                        onChange={(e) => handlePayTierRateChange(i, parseFloat(e.target.value) / 100)}
                        className="w-16 px-2 py-1 text-right border border-gray-300 rounded text-sm"
                        step="0.1"
                      />
                      <span className="text-gray-500">%</span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* OTE Validierung */}
      <div className="bg-white rounded-xl shadow-sm p-6">
        <h3 className="text-lg font-bold text-gray-800 mb-4">{t('settingsPanel.oteValidation')}</h3>
        
        <div className={`p-4 rounded-lg mb-4 ${oteValidation.valid ? 'bg-green-50 border border-green-200' : 'bg-yellow-50 border border-yellow-200'}`}>
          <p className={`font-medium ${oteValidation.valid ? 'text-green-700' : 'text-yellow-700'}`}>
            {oteValidation.valid 
              ? `${t('settingsPanel.oteValid')} ${formatCurrency(oteValidation.expectedProvision)}`
              : oteValidation.deviation > 0
                ? t('settingsPanel.oteOverBy').replace('{percent}', oteValidation.deviation.toFixed(1))
                : t('settingsPanel.oteUnderBy').replace('{percent}', Math.abs(oteValidation.deviation).toFixed(1))
            }
          </p>
          <p className="text-sm text-gray-600 mt-1">
            OTE: {formatCurrency(ote)} | {t('settingsPanel.oteExpected')}: {formatCurrency(oteValidation.expectedProvision)} | 
            {t('settingsPanel.oteDeviation')}: {oteValidation.deviation > 0 ? '+' : ''}{oteValidation.deviation.toFixed(1)}%
          </p>
        </div>

        <h4 className="font-medium text-gray-700 mb-2">{t('settingsPanel.projections')}</h4>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b">
                <th className="text-left py-2 px-2 font-medium text-gray-500">{t('settingsPanel.scenario')}</th>
                <th className="text-right py-2 px-2 font-medium text-green-600">{t('settingsPanel.subsArr')}</th>
                <th className="text-right py-2 px-2 font-medium text-orange-600">{t('settingsPanel.payArr')}</th>
                <th className="text-right py-2 px-2 font-medium text-purple-600">{t('settingsPanel.totalArr')}</th>
                <th className="text-right py-2 px-2 font-medium text-green-600">{t('settingsPanel.subsProv')}</th>
                <th className="text-right py-2 px-2 font-medium text-blue-600">{t('settingsPanel.terminal')}</th>
                <th className="text-right py-2 px-2 font-medium text-orange-600">{t('settingsPanel.payProv')}</th>
                <th className="text-right py-2 px-2 font-medium text-purple-700">{t('settingsPanel.total')}</th>
              </tr>
            </thead>
            <tbody>
              {oteProjections.map((proj, i) => (
                <tr key={i} className={`border-b ${proj.ote_match ? 'bg-green-50' : ''}`}>
                  <td className="py-2 px-2 font-medium">{proj.scenario}</td>
                  <td className="py-2 px-2 text-right text-green-600">{formatCurrency(proj.expected_subs_arr)}</td>
                  <td className="py-2 px-2 text-right text-orange-600">{formatCurrency(proj.expected_pay_arr)}</td>
                  <td className="py-2 px-2 text-right text-purple-600">{formatCurrency(proj.expected_total_arr)}</td>
                  <td className="py-2 px-2 text-right text-green-600">{formatCurrency(proj.subs_provision)}</td>
                  <td className="py-2 px-2 text-right text-blue-600">{formatCurrency(proj.terminal_provision)}</td>
                  <td className="py-2 px-2 text-right text-orange-600">{formatCurrency(proj.pay_provision)}</td>
                  <td className="py-2 px-2 text-right font-bold text-purple-700">
                    {formatCurrency(proj.total_provision)}
                    {proj.ote_match && <span className="ml-1 text-green-600">✓</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Berechnungslogik */}
      <div className="bg-gray-50 rounded-xl p-6">
        <h3 className="text-lg font-bold text-gray-800 mb-4">{t('settingsPanel.legendCalculation')}</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 text-sm">
          <div>
            <h4 className="font-medium text-green-700 mb-2">{t('settingsPanel.m0GoLive')}</h4>
            <ul className="space-y-1 text-gray-600">
              <li>• {t('settingsPanel.m0Formula')}</li>
              <li>• Terminals × €{terminalBase}/€{terminalBonus}</li>
            </ul>
          </div>
          <div>
            <h4 className="font-medium text-orange-700 mb-2">{t('settingsPanel.m3After')}</h4>
            <ul className="space-y-1 text-gray-600">
              <li>• {t('settingsPanel.m3Formula')}</li>
            </ul>
          </div>
        </div>
        <div className="mt-4 pt-4 border-t">
          <h4 className="font-medium text-gray-700 mb-2">{t('settingsPanel.colorCoding')}</h4>
          <div className="flex flex-wrap gap-4 text-sm">
            <span className="flex items-center"><span className="w-4 h-4 bg-green-500 rounded mr-2"></span>{t('settingsPanel.greenSubs')}</span>
            <span className="flex items-center"><span className="w-4 h-4 bg-orange-500 rounded mr-2"></span>{t('settingsPanel.orangePay')}</span>
            <span className="flex items-center"><span className="w-4 h-4 bg-blue-500 rounded mr-2"></span>{t('settingsPanel.blueTerminal')}</span>
            <span className="flex items-center"><span className="w-4 h-4 bg-purple-500 rounded mr-2"></span>{t('settingsPanel.purpleTotal')}</span>
          </div>
        </div>
      </div>

      {/* Partner-Verwaltung */}
      <div className="bg-white rounded-xl shadow-sm p-6">
        <PartnerManagement />
      </div>
    </div>
  );
}
