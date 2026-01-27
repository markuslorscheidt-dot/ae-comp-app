'use client';

import { useState, useEffect, useMemo } from 'react';
import { 
  AESettings, 
  ProvisionTier, 
  DEFAULT_SUBS_TIERS, 
  DEFAULT_PAY_TIERS, 
  DEFAULT_MONTHLY_INBOUND_TARGETS,
  DEFAULT_MONTHLY_OUTBOUND_TARGETS,
  DEFAULT_MONTHLY_PARTNERSHIPS_TARGETS,
  DEFAULT_SETTINGS, 
  calculateMonthlySubsTargets, 
  calculateTotalGoLives,
  User,
  isPlannable
} from '@/lib/types';
import { useLanguage } from '@/lib/LanguageContext';
import { calculateOTEProjections, validateOTESettings, formatCurrency } from '@/lib/calculations';
import { useAllUsers, useAllSettings } from '@/lib/hooks';
import { supabase } from '@/lib/supabase';
import DebugPanel from './DebugPanel';
import PartnerManagement from './PartnerManagement';
import SubscriptionPackageManagement from './SubscriptionPackageManagement';

interface SettingsPanelProps {
  settings: AESettings;
  onSave: (updates: Partial<AESettings>) => Promise<{ error: any }>;
  onBack: () => void;
  currentUser?: User;
  onRefetch?: () => void;  // Callback um Settings nach dem Speichern neu zu laden
}

interface AEPlanningData {
  user: User;
  percentage: number;
  inbound: number[];
  outbound: number[];
  partnerships: number[];
  payTerminals: number[];  // Verkaufte Terminals (für €30/€50 Provision)
  terminalSales: number[];
  tipping: number[];
  expanded: boolean;
}

const MONTHS = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];

export default function SettingsPanel({ settings, onSave, onBack, currentUser, onRefetch }: SettingsPanelProps) {
  const { t } = useLanguage();
  const { users } = useAllUsers();
  const { settings: allSettings } = useAllSettings(2026);
  
  // ========== GRUNDEINSTELLUNGEN ==========
  const [year, setYear] = useState(settings.year);
  const [region, setRegion] = useState(settings.region);
  
  // ========== BUSINESS TARGETS (100%) ==========
  const [businessInbound, setBusinessInbound] = useState<number[]>(
    [25, 25, 25, 30, 30, 20, 18, 15, 33, 34, 30, 15]
  );
  const [businessOutbound, setBusinessOutbound] = useState<number[]>(
    [0, 4, 4, 4, 4, 2, 2, 2, 4, 4, 4, 1]
  );
  const [businessPartnerships, setBusinessPartnerships] = useState<number[]>(
    [0, 1, 3, 10, 10, 10, 11, 11, 11, 10, 11, 2]
  );
  
  // Prozentsätze für Pay Terminals, Terminal Sales und Tipping
  const [payTerminalsPercent, setPayTerminalsPercent] = useState(75);  // Ziel-% für Pay Terminals
  const [terminalPenetrationThreshold, setTerminalPenetrationThreshold] = useState(75);  // Schwellwert für Bonus (€50)
  const [terminalSalesPercent, setTerminalSalesPercent] = useState(75);
  const [tippingPercent, setTippingPercent] = useState(24);
  
  // Business Pay Terminals, Terminal Sales und Tipping (monatlich)
  const [businessPayTerminals, setBusinessPayTerminals] = useState<number[]>([]);
  const [businessTerminalSales, setBusinessTerminalSales] = useState<number[]>([]);
  const [businessTipping, setBusinessTipping] = useState<number[]>([]);
  
  // ========== AE PLANNING DATA ==========
  const [aePlanningData, setAePlanningData] = useState<Map<string, AEPlanningData>>(new Map());
  
  // ========== UMSATZ-BERECHNUNG ==========
  const [avgSubsBill, setAvgSubsBill] = useState(settings.avg_subs_bill || DEFAULT_SETTINGS.avg_subs_bill);
  const [avgPayBillTerminal, setAvgPayBillTerminal] = useState(settings.avg_pay_bill || DEFAULT_SETTINGS.avg_pay_bill);
  const [avgPayBillTipping, setAvgPayBillTipping] = useState(settings.avg_pay_bill_tipping || DEFAULT_SETTINGS.avg_pay_bill_tipping);
  
  // ========== PROVISIONSMODELL (pro AE) ==========
  const [aeTerminalBase, setAeTerminalBase] = useState<Map<string, number>>(new Map());
  const [aeTerminalBonus, setAeTerminalBonus] = useState<Map<string, number>>(new Map());
  const [aeSubsTiers, setAeSubsTiers] = useState<Map<string, ProvisionTier[]>>(new Map());
  const [aePayTiers, setAePayTiers] = useState<Map<string, ProvisionTier[]>>(new Map());
  
  // ========== UI STATE ==========
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [businessTargetsExpanded, setBusinessTargetsExpanded] = useState(true);
  const [selectedAEId, setSelectedAEId] = useState<string | null>(null);
  
  // OTE pro AE (wird aus aePlanningData oder allSettings geladen)
  const [aeOTEs, setAeOTEs] = useState<Map<string, number>>(new Map());
  
  // Getter für aktuell ausgewählten AE
  const selectedTerminalBase = selectedAEId ? (aeTerminalBase.get(selectedAEId) || DEFAULT_SETTINGS.terminal_base) : DEFAULT_SETTINGS.terminal_base;
  const selectedTerminalBonus = selectedAEId ? (aeTerminalBonus.get(selectedAEId) || DEFAULT_SETTINGS.terminal_bonus) : DEFAULT_SETTINGS.terminal_bonus;
  const selectedSubsTiers = selectedAEId ? (aeSubsTiers.get(selectedAEId) || DEFAULT_SUBS_TIERS) : DEFAULT_SUBS_TIERS;
  const selectedPayTiers = selectedAEId ? (aePayTiers.get(selectedAEId) || DEFAULT_PAY_TIERS) : DEFAULT_PAY_TIERS;
  
  // Planbare User
  const plannableUsers = useMemo(() => users.filter(u => isPlannable(u.role)), [users]);
  
  // ========== BERECHNUNGEN ==========
  const businessGoLives = useMemo(() => 
    businessInbound.map((inb, i) => inb + businessOutbound[i] + businessPartnerships[i]), 
    [businessInbound, businessOutbound, businessPartnerships]
  );
  
  const businessTotalInbound = businessInbound.reduce((a, b) => a + b, 0);
  const businessTotalOutbound = businessOutbound.reduce((a, b) => a + b, 0);
  const businessTotalPartnerships = businessPartnerships.reduce((a, b) => a + b, 0);
  const businessTotal = businessTotalInbound + businessTotalOutbound + businessTotalPartnerships;
  const businessTotalPayTerminals = businessPayTerminals.reduce((a, b) => a + b, 0);
  const businessTotalTerminalSales = businessTerminalSales.reduce((a, b) => a + b, 0);
  const businessTotalTipping = businessTipping.reduce((a, b) => a + b, 0);
  
  // Terminal Penetration für Business
  const businessTerminalPenetration = businessTotal > 0 ? (businessTotalPayTerminals / businessTotal * 100) : 0;
  
  // Prozentsumme der AEs
  const totalPercentage = Array.from(aePlanningData.values()).reduce((sum, data) => sum + data.percentage, 0);
  const percentageValid = totalPercentage === 100;
  
  // Pay ARR Berechnung
  const yearlyPayArr = (businessTotalTerminalSales * avgPayBillTerminal * 12) + (businessTotalTipping * avgPayBillTipping * 12);
  const yearlySubsArr = businessTotal * avgSubsBill * 12;
  
  // ========== INITIALISIERUNG ==========
  // Settings-Werte synchronisieren wenn sich settings ändert (z.B. nach Navigation)
  useEffect(() => {
    if (settings) {
      setAvgSubsBill(settings.avg_subs_bill || DEFAULT_SETTINGS.avg_subs_bill);
      setAvgPayBillTerminal(settings.avg_pay_bill || DEFAULT_SETTINGS.avg_pay_bill);
      setAvgPayBillTipping(settings.avg_pay_bill_tipping || DEFAULT_SETTINGS.avg_pay_bill_tipping);
    }
  }, [settings]);

  useEffect(() => {
    // Business Pay Terminals, Terminal Sales und Tipping initialisieren
    const payTerms = businessGoLives.map(gl => Math.round(gl * payTerminalsPercent / 100));
    setBusinessPayTerminals(payTerms);
    const termSales = businessGoLives.map(gl => Math.round(gl * terminalSalesPercent / 100));
    setBusinessTerminalSales(termSales);
    setBusinessTipping(termSales.map(ts => Math.round(ts * tippingPercent / 100)));
  }, []);
  
  // AE Planning Data initialisieren
  useEffect(() => {
    if (plannableUsers.length === 0) return;
    
    const newData = new Map<string, AEPlanningData>();
    const newOTEs = new Map<string, number>();
    const newTerminalBase = new Map<string, number>();
    const newTerminalBonus = new Map<string, number>();
    const newSubsTiers = new Map<string, ProvisionTier[]>();
    const newPayTiers = new Map<string, ProvisionTier[]>();
    const percentPerUser = Math.floor(100 / plannableUsers.length);
    let remainingPercent = 100;
    
    plannableUsers.forEach((user, index) => {
      const isLast = index === plannableUsers.length - 1;
      const defaultPercent = isLast ? remainingPercent : percentPerUser;
      remainingPercent -= percentPerUser;
      
      const existingSettings = allSettings.find(s => s.user_id === user.id);
      // NEU: Prozentsatz aus DB laden oder Default berechnen
      const percent = existingSettings?.target_percentage ?? defaultPercent;
      const aeInbound = existingSettings?.monthly_inbound_targets || calculateFromPercentage(businessInbound, percent);
      const aeOutbound = existingSettings?.monthly_outbound_targets || calculateFromPercentage(businessOutbound, percent);
      const aePartnerships = existingSettings?.monthly_partnerships_targets || calculateFromPercentage(businessPartnerships, percent);
      const aeGoLives = aeInbound.map((inb, i) => inb + aeOutbound[i] + aePartnerships[i]);
      
      newData.set(user.id, {
        user,
        percentage: percent,
        inbound: aeInbound,
        outbound: aeOutbound,
        partnerships: aePartnerships,
        payTerminals: aeGoLives.map(gl => Math.round(gl * payTerminalsPercent / 100)),
        terminalSales: aeGoLives.map(gl => Math.round(gl * terminalSalesPercent / 100)),
        tipping: aeGoLives.map(gl => Math.round(gl * terminalSalesPercent / 100 * tippingPercent / 100)),
        expanded: false,
      });
      
      // OTE aus existierenden Settings oder Default
      newOTEs.set(user.id, existingSettings?.ote || DEFAULT_SETTINGS.ote);
      
      // Provisionsmodell pro AE aus existierenden Settings oder Default
      newTerminalBase.set(user.id, existingSettings?.terminal_base || DEFAULT_SETTINGS.terminal_base);
      newTerminalBonus.set(user.id, existingSettings?.terminal_bonus || DEFAULT_SETTINGS.terminal_bonus);
      newSubsTiers.set(user.id, existingSettings?.subs_tiers || DEFAULT_SUBS_TIERS);
      newPayTiers.set(user.id, existingSettings?.pay_tiers || DEFAULT_PAY_TIERS);
    });
    
    setAePlanningData(newData);
    setAeOTEs(newOTEs);
    setAeTerminalBase(newTerminalBase);
    setAeTerminalBonus(newTerminalBonus);
    setAeSubsTiers(newSubsTiers);
    setAePayTiers(newPayTiers);
    
    // Ersten AE auswählen wenn noch keiner gewählt
    if (!selectedAEId && plannableUsers.length > 0) {
      setSelectedAEId(plannableUsers[0].id);
    }
  }, [plannableUsers, allSettings]);
  
  // ========== HELPER FUNCTIONS ==========
  function calculateFromPercentage(businessValues: number[], percentage: number): number[] {
    return businessValues.map(val => Math.round(val * percentage / 100));
  }
  
  const recalculateBusinessDerived = () => {
    const newPayTerms = businessGoLives.map(gl => Math.round(gl * payTerminalsPercent / 100));
    setBusinessPayTerminals(newPayTerms);
    const newTermSales = businessGoLives.map(gl => Math.round(gl * terminalSalesPercent / 100));
    setBusinessTerminalSales(newTermSales);
    setBusinessTipping(newTermSales.map(ts => Math.round(ts * tippingPercent / 100)));
  };
  
  // ========== HANDLERS ==========
  const handleBusinessChange = (category: 'inbound' | 'outbound' | 'partnerships', month: number, value: number) => {
    const setter = category === 'inbound' ? setBusinessInbound 
      : category === 'outbound' ? setBusinessOutbound 
      : setBusinessPartnerships;
    setter(prev => { const n = [...prev]; n[month] = value; return n; });
  };
  
  const handleBusinessPayTerminalsChange = (month: number, value: number) => {
    setBusinessPayTerminals(prev => { const n = [...prev]; n[month] = value; return n; });
  };
  
  const handleBusinessTerminalChange = (month: number, value: number) => {
    setBusinessTerminalSales(prev => { const n = [...prev]; n[month] = value; return n; });
  };
  
  const handleBusinessTippingChange = (month: number, value: number) => {
    setBusinessTipping(prev => { const n = [...prev]; n[month] = value; return n; });
  };
  
  const handleAEPercentageChange = (userId: string, percentage: number) => {
    setAePlanningData(prev => {
      const newData = new Map(prev);
      const data = newData.get(userId);
      if (data) {
        const aeInbound = calculateFromPercentage(businessInbound, percentage);
        const aeOutbound = calculateFromPercentage(businessOutbound, percentage);
        const aePartnerships = calculateFromPercentage(businessPartnerships, percentage);
        const aeGoLives = aeInbound.map((inb, i) => inb + aeOutbound[i] + aePartnerships[i]);
        newData.set(userId, {
          ...data,
          percentage,
          inbound: aeInbound,
          outbound: aeOutbound,
          partnerships: aePartnerships,
          payTerminals: aeGoLives.map(gl => Math.round(gl * payTerminalsPercent / 100)),
          terminalSales: aeGoLives.map(gl => Math.round(gl * terminalSalesPercent / 100)),
          tipping: aeGoLives.map(gl => Math.round(gl * terminalSalesPercent / 100 * tippingPercent / 100)),
        });
      }
      return newData;
    });
  };
  
  const handleAEValueChange = (userId: string, category: 'inbound' | 'outbound' | 'partnerships' | 'payTerminals' | 'terminalSales' | 'tipping', month: number, value: number) => {
    setAePlanningData(prev => {
      const newData = new Map(prev);
      const data = newData.get(userId);
      if (data) {
        const newCategoryValues = [...data[category]];
        newCategoryValues[month] = value;
        newData.set(userId, { ...data, [category]: newCategoryValues });
      }
      return newData;
    });
  };
  
  const toggleAEExpanded = (userId: string) => {
    setAePlanningData(prev => {
      const newData = new Map(prev);
      const data = newData.get(userId);
      if (data) newData.set(userId, { ...data, expanded: !data.expanded });
      return newData;
    });
  };
  
  // Handler für AE-spezifische Provisionsmodell-Änderungen
  const handleTerminalBaseChange = (value: number) => {
    if (!selectedAEId) return;
    setAeTerminalBase(prev => {
      const newMap = new Map(prev);
      newMap.set(selectedAEId, value);
      return newMap;
    });
  };

  const handleTerminalBonusChange = (value: number) => {
    if (!selectedAEId) return;
    setAeTerminalBonus(prev => {
      const newMap = new Map(prev);
      newMap.set(selectedAEId, value);
      return newMap;
    });
  };

  const handleSubsTierRateChange = (index: number, rate: number) => {
    if (!selectedAEId) return;
    const currentTiers = aeSubsTiers.get(selectedAEId) || DEFAULT_SUBS_TIERS;
    const newTiers = [...currentTiers];
    newTiers[index] = { ...newTiers[index], rate };
    setAeSubsTiers(prev => {
      const newMap = new Map(prev);
      newMap.set(selectedAEId, newTiers);
      return newMap;
    });
  };

  const handlePayTierRateChange = (index: number, rate: number) => {
    if (!selectedAEId) return;
    const currentTiers = aePayTiers.get(selectedAEId) || DEFAULT_PAY_TIERS;
    const newTiers = [...currentTiers];
    newTiers[index] = { ...newTiers[index], rate };
    setAePayTiers(prev => {
      const newMap = new Map(prev);
      newMap.set(selectedAEId, newTiers);
      return newMap;
    });
  };
  
  // ========== SAVE ==========
  const handleSave = async () => {
    if (!percentageValid) {
      setMessage('Die Summe der Prozentsätze muss 100% ergeben!');
      return;
    }
    
    setSaving(true);
    setMessage('');
    
    try {
      // Speichere für jeden AE
      for (const [userId, data] of aePlanningData) {
        const goLiveTargets = calculateTotalGoLives(data.inbound, data.outbound, data.partnerships);
        const subsTargets = calculateMonthlySubsTargets(goLiveTargets, avgSubsBill);
        const payTargets = data.terminalSales.map((ts, i) => 
          (ts * avgPayBillTerminal * 12) + (data.tipping[i] * avgPayBillTipping * 12)
        );
        const aeOTE = aeOTEs.get(userId) || DEFAULT_SETTINGS.ote;
        const userTerminalBase = aeTerminalBase.get(userId) || DEFAULT_SETTINGS.terminal_base;
        const userTerminalBonus = aeTerminalBonus.get(userId) || DEFAULT_SETTINGS.terminal_bonus;
        const userSubsTiers = aeSubsTiers.get(userId) || DEFAULT_SUBS_TIERS;
        const userPayTiers = aePayTiers.get(userId) || DEFAULT_PAY_TIERS;
        
        const { error } = await supabase
          .from('ae_settings')
          .update({
            monthly_inbound_targets: data.inbound,
            monthly_outbound_targets: data.outbound,
            monthly_partnerships_targets: data.partnerships,
            target_percentage: data.percentage,
            monthly_go_live_targets: goLiveTargets,
            monthly_subs_targets: subsTargets,
            monthly_pay_targets: payTargets,
            avg_subs_bill: avgSubsBill,
            avg_pay_bill: avgPayBillTerminal,
            avg_pay_bill_tipping: avgPayBillTipping,
            terminal_base: userTerminalBase,
            terminal_bonus: userTerminalBonus,
            subs_tiers: userSubsTiers,
            pay_tiers: userPayTiers,
            ote: aeOTE,
            region: region,
            year: year,
            updated_at: new Date().toISOString(),
          })
          .eq('user_id', userId)
          .eq('year', 2026);
        
        if (error) {
          setMessage(`Fehler beim Speichern für ${data.user.name}: ${error.message}`);
          setSaving(false);
          return;
        }
      }
      
      setMessage('Alle Einstellungen erfolgreich gespeichert!');
      setTimeout(() => setMessage(''), 3000);
      
      // Settings im Dashboard neu laden damit die Änderungen übernommen werden
      if (onRefetch) {
        onRefetch();
      }
    } catch (err: any) {
      setMessage(`Fehler: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };
  
  // ========== OTE PREVIEW (für ausgewählten AE) ==========
  const selectedAEData = selectedAEId ? aePlanningData.get(selectedAEId) : null;
  const selectedAEOTE = selectedAEId ? (aeOTEs.get(selectedAEId) || DEFAULT_SETTINGS.ote) : DEFAULT_SETTINGS.ote;
  
  // Berechne AE-spezifische Werte für OTE Preview
  const selectedAEGoLives = selectedAEData 
    ? selectedAEData.inbound.reduce((a,b)=>a+b,0) + selectedAEData.outbound.reduce((a,b)=>a+b,0) + selectedAEData.partnerships.reduce((a,b)=>a+b,0)
    : 0;
  const selectedAEPayTerminals = selectedAEData ? selectedAEData.payTerminals.reduce((a,b)=>a+b,0) : 0;
  const selectedAEPenetration = selectedAEGoLives > 0 ? (selectedAEPayTerminals / selectedAEGoLives) : 0;
  
  const previewSettings: AESettings = selectedAEData ? {
    ...settings,
    year, region, 
    ote: selectedAEOTE,
    monthly_go_live_targets: calculateTotalGoLives(selectedAEData.inbound, selectedAEData.outbound, selectedAEData.partnerships),
    monthly_inbound_targets: selectedAEData.inbound,
    monthly_outbound_targets: selectedAEData.outbound,
    monthly_partnerships_targets: selectedAEData.partnerships,
    avg_subs_bill: avgSubsBill,
    avg_pay_bill: avgPayBillTerminal,
    pay_arr_factor: 0,
    monthly_subs_targets: calculateMonthlySubsTargets(
      calculateTotalGoLives(selectedAEData.inbound, selectedAEData.outbound, selectedAEData.partnerships), 
      avgSubsBill
    ),
    monthly_pay_targets: selectedAEData.terminalSales.map((ts, i) => 
      (ts * avgPayBillTerminal * 12) + (selectedAEData.tipping[i] * avgPayBillTipping * 12)
    ),
    terminal_base: selectedTerminalBase,
    terminal_bonus: selectedTerminalBonus,
    terminal_penetration_threshold: terminalPenetrationThreshold / 100,  // Als Dezimalwert (0.75)
    subs_tiers: selectedSubsTiers,
    pay_tiers: selectedPayTiers,
  } : settings;

  const oteValidation = validateOTESettings(previewSettings, selectedAEPayTerminals);
  const oteProjections = calculateOTEProjections(previewSettings, selectedAEPayTerminals);
  
  // Handler für AE OTE Änderung
  const handleAEOTEChange = (oteValue: number) => {
    if (!selectedAEId) return;
    setAeOTEs(prev => {
      const newOTEs = new Map(prev);
      newOTEs.set(selectedAEId, oteValue);
      return newOTEs;
    });
  };

  return (
    <div className="space-y-6">
      {/* DEBUG */}
      {currentUser && (
        <DebugPanel 
          user={currentUser} 
          data={{ year, selectedAEOTE, businessTotal, yearlySubsArr, yearlyPayArr }}
          title="Settings Debug"
        />
      )}

      {/* ========== HEADER mit Quick Stats ========== */}
      <div className="bg-white rounded-xl shadow-sm p-4">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center space-x-4">
            <button onClick={onBack} className="p-2 hover:bg-gray-100 rounded-lg transition">
              ← {t('common.back')}
            </button>
            <h2 className="text-2xl font-bold text-gray-800">{t('nav.settings')}</h2>
          </div>
          <button
            onClick={handleSave}
            disabled={saving || !percentageValid}
            className="px-6 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition disabled:opacity-50"
          >
            {saving ? t('common.saving') : 'Alle speichern'}
          </button>
        </div>
        
        {/* Quick Stats */}
        <div className="grid grid-cols-2 md:grid-cols-8 gap-2 text-center">
          <div className="bg-blue-50 rounded-lg p-2">
            <div className="text-xs text-blue-600">Go-Lives</div>
            <div className="text-lg font-bold text-blue-700">{businessTotal}</div>
          </div>
          <div className={`rounded-lg p-2 ${businessTerminalPenetration >= terminalPenetrationThreshold ? 'bg-green-50' : 'bg-amber-50'}`}>
            <div className={`text-xs ${businessTerminalPenetration >= terminalPenetrationThreshold ? 'text-green-600' : 'text-amber-600'}`}>
              Pay Term. ({businessTerminalPenetration.toFixed(0)}%)
            </div>
            <div className={`text-lg font-bold ${businessTerminalPenetration >= terminalPenetrationThreshold ? 'text-green-700' : 'text-amber-700'}`}>
              {businessTotalPayTerminals}
            </div>
          </div>
          <div className="bg-teal-50 rounded-lg p-2">
            <div className="text-xs text-teal-600">Terminal</div>
            <div className="text-lg font-bold text-teal-700">{businessTotalTerminalSales}</div>
          </div>
          <div className="bg-pink-50 rounded-lg p-2">
            <div className="text-xs text-pink-600">Tipping</div>
            <div className="text-lg font-bold text-pink-700">{businessTotalTipping}</div>
          </div>
          <div className="bg-green-50 rounded-lg p-2">
            <div className="text-xs text-green-600">Subs ARR</div>
            <div className="text-lg font-bold text-green-700">{formatCurrency(yearlySubsArr)}</div>
          </div>
          <div className="bg-orange-50 rounded-lg p-2">
            <div className="text-xs text-orange-600">Pay ARR</div>
            <div className="text-lg font-bold text-orange-700">{formatCurrency(yearlyPayArr)}</div>
          </div>
          <div className="bg-purple-50 rounded-lg p-2">
            <div className="text-xs text-purple-600">Gesamt ARR</div>
            <div className="text-lg font-bold text-purple-700">{formatCurrency(yearlySubsArr + yearlyPayArr)}</div>
          </div>
          <div className={`rounded-lg p-2 ${percentageValid ? 'bg-green-50' : 'bg-red-50'}`}>
            <div className={`text-xs ${percentageValid ? 'text-green-600' : 'text-red-600'}`}>AE-Verteilung</div>
            <div className={`text-lg font-bold ${percentageValid ? 'text-green-700' : 'text-red-700'}`}>
              {totalPercentage}% {percentageValid ? '✓' : '✗'}
            </div>
          </div>
        </div>
      </div>

      {message && (
        <div className={`p-3 rounded-lg text-sm ${message.includes('Fehler') ? 'bg-red-50 text-red-700' : 'bg-green-50 text-green-700'}`}>
          {message}
        </div>
      )}

      {/* ========== 1. GRUNDEINSTELLUNGEN ========== */}
      <div className="bg-white rounded-xl shadow-sm p-6">
        <h3 className="text-lg font-bold text-gray-800 mb-4">1. Grundeinstellungen</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Jahr</label>
            <input type="number" value={year} onChange={(e) => setYear(parseInt(e.target.value))}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Region</label>
            <input type="text" value={region} onChange={(e) => setRegion(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg" />
          </div>
        </div>
      </div>

      {/* ========== 2. BUSINESS TARGETS (100%) ========== */}
      <div className="bg-white rounded-xl shadow-sm p-6">
        <div 
          className="flex items-center justify-between cursor-pointer"
          onClick={() => setBusinessTargetsExpanded(!businessTargetsExpanded)}
        >
          <h3 className="text-lg font-bold text-gray-800">2. Business Targets (100%)</h3>
          <div className="flex items-center space-x-4">
            <span className="text-sm text-gray-500">
              {businessTotal} Go-Lives | {businessTotalTerminalSales} Terminal | {businessTotalTipping} Tipping
            </span>
            <span className="text-gray-400">{businessTargetsExpanded ? '▼' : '▶'}</span>
          </div>
        </div>
        
        {businessTargetsExpanded && (
          <div className="mt-4 space-y-4">
            {/* Go-Lives */}
            {[
              { key: 'inbound', label: 'Inbound', color: 'blue', data: businessInbound, total: businessTotalInbound },
              { key: 'outbound', label: 'Outbound', color: 'orange', data: businessOutbound, total: businessTotalOutbound },
              { key: 'partnerships', label: 'Partnerships', color: 'purple', data: businessPartnerships, total: businessTotalPartnerships },
            ].map(cat => (
              <div key={cat.key}>
                <div className="flex items-center justify-between mb-1">
                  <h4 className={`font-medium text-${cat.color}-700`}>{cat.label}</h4>
                  <span className="text-sm text-gray-500">Summe: <strong>{cat.total}</strong></span>
                </div>
                <div className="grid grid-cols-12 gap-1">
                  {MONTHS.map((m, i) => (
                    <div key={i} className="text-center">
                      <label className="block text-xs text-gray-500">{m}</label>
                      <input type="number" value={cat.data[i]}
                        onChange={(e) => handleBusinessChange(cat.key as any, i, parseInt(e.target.value) || 0)}
                        className={`w-full px-1 py-1 text-center border border-${cat.color}-200 rounded text-sm bg-${cat.color}-50`} />
                    </div>
                  ))}
                </div>
              </div>
            ))}
            
            {/* Derived: Pay Terminals, Terminal Sales & Tipping */}
            <div className="pt-4 border-t">
              <div className="flex flex-wrap items-center justify-between mb-2 gap-2">
                <span className="font-medium text-gray-700">Abgeleitete Kennzahlen</span>
                <div className="flex flex-wrap items-center gap-3 text-sm">
                  <div className="flex items-center space-x-1">
                    <span className="text-green-600">Pay Term.</span>
                    <input type="number" value={payTerminalsPercent} onChange={(e) => setPayTerminalsPercent(parseInt(e.target.value) || 0)}
                      className="w-12 px-1 py-0.5 text-center border border-green-300 rounded text-xs" />
                    <span className="text-green-600">%</span>
                  </div>
                  <div className="flex items-center space-x-1">
                    <span className="text-amber-600">Bonus ab</span>
                    <input type="number" value={terminalPenetrationThreshold} onChange={(e) => setTerminalPenetrationThreshold(parseInt(e.target.value) || 0)}
                      className="w-12 px-1 py-0.5 text-center border border-amber-300 rounded text-xs" />
                    <span className="text-amber-600">%</span>
                  </div>
                  <div className="flex items-center space-x-1">
                    <span className="text-teal-600">Terminal</span>
                    <input type="number" value={terminalSalesPercent} onChange={(e) => setTerminalSalesPercent(parseInt(e.target.value) || 0)}
                      className="w-12 px-1 py-0.5 text-center border border-teal-300 rounded text-xs" />
                    <span className="text-teal-600">%</span>
                  </div>
                  <div className="flex items-center space-x-1">
                    <span className="text-pink-600">Tipping</span>
                    <input type="number" value={tippingPercent} onChange={(e) => setTippingPercent(parseInt(e.target.value) || 0)}
                      className="w-12 px-1 py-0.5 text-center border border-pink-300 rounded text-xs" />
                    <span className="text-pink-600">%</span>
                  </div>
                  <button onClick={recalculateBusinessDerived} className="text-xs text-blue-600 underline">Berechnen</button>
                </div>
              </div>
              
              {/* Pay Terminals */}
              <div className="mb-2">
                <div className="flex items-center justify-between mb-1">
                  <h4 className="font-medium text-green-700">Pay Terminals (Hardware)</h4>
                  <span className="text-sm text-gray-500">
                    Summe: <strong>{businessTotalPayTerminals}</strong> 
                    <span className={`ml-2 ${businessTerminalPenetration >= terminalPenetrationThreshold ? 'text-green-600' : 'text-amber-600'}`}>
                      ({businessTerminalPenetration.toFixed(0)}% → {businessTerminalPenetration >= terminalPenetrationThreshold ? '€50 Bonus' : '€30 Basis'})
                    </span>
                  </span>
                </div>
                <div className="grid grid-cols-12 gap-1">
                  {MONTHS.map((m, i) => (
                    <div key={i} className="text-center">
                      <label className="block text-xs text-gray-500">{m}</label>
                      <input type="number" value={businessPayTerminals[i] || 0}
                        onChange={(e) => handleBusinessPayTerminalsChange(i, parseInt(e.target.value) || 0)}
                        className="w-full px-1 py-1 text-center border border-green-200 rounded text-sm bg-green-50" />
                    </div>
                  ))}
                </div>
              </div>
              
              {[
                { label: 'Terminal Sales', color: 'teal', data: businessTerminalSales, handler: handleBusinessTerminalChange, total: businessTotalTerminalSales },
                { label: 'Tipping', color: 'pink', data: businessTipping, handler: handleBusinessTippingChange, total: businessTotalTipping },
              ].map(cat => (
                <div key={cat.label} className="mb-2">
                  <div className="flex items-center justify-between mb-1">
                    <h4 className={`font-medium text-${cat.color}-700`}>{cat.label}</h4>
                    <span className="text-sm text-gray-500">Summe: <strong>{cat.total}</strong></span>
                  </div>
                  <div className="grid grid-cols-12 gap-1">
                    {MONTHS.map((m, i) => (
                      <div key={i} className="text-center">
                        <label className="block text-xs text-gray-500">{m}</label>
                        <input type="number" value={cat.data[i] || 0}
                          onChange={(e) => cat.handler(i, parseInt(e.target.value) || 0)}
                          className={`w-full px-1 py-1 text-center border border-${cat.color}-200 rounded text-sm bg-${cat.color}-50`} />
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ========== 3. AE-VERTEILUNG ========== */}
      <div className="bg-white rounded-xl shadow-sm p-6">
        <h3 className="text-lg font-bold text-gray-800 mb-4">3. AE-Verteilung</h3>
        
        {/* Prozent-Übersicht */}
        <div className={`p-3 rounded-lg mb-4 ${percentageValid ? 'bg-green-50' : 'bg-red-50'}`}>
          <div className="flex items-center justify-between">
            <span className="font-medium text-gray-700">Verteilung:</span>
            <span className={`font-bold ${percentageValid ? 'text-green-600' : 'text-red-600'}`}>
              {Array.from(aePlanningData.values()).map(d => `${d.user.name.split(' ')[0]}: ${d.percentage}%`).join(' + ')} = {totalPercentage}%
              {percentageValid ? ' ✓' : ' ✗'}
            </span>
          </div>
        </div>
        
        {/* AE Sektionen */}
        {Array.from(aePlanningData.values()).map((data) => {
          const total = data.inbound.reduce((a,b)=>a+b,0) + data.outbound.reduce((a,b)=>a+b,0) + data.partnerships.reduce((a,b)=>a+b,0);
          const totalPayTerminals = data.payTerminals.reduce((a,b)=>a+b,0);
          const totalTerminal = data.terminalSales.reduce((a,b)=>a+b,0);
          const totalTipping = data.tipping.reduce((a,b)=>a+b,0);
          const penetration = total > 0 ? (totalPayTerminals / total * 100) : 0;
          const penetrationOk = penetration >= terminalPenetrationThreshold;
          
          return (
            <div key={data.user.id} className="border rounded-lg mb-3">
              {/* Header (immer sichtbar) */}
              <div 
                className="flex items-center justify-between p-4 cursor-pointer hover:bg-gray-50"
                onClick={() => toggleAEExpanded(data.user.id)}
              >
                <div className="flex items-center space-x-4">
                  <span className="font-bold text-gray-800">{data.user.name}</span>
                  <div className="flex items-center space-x-2" onClick={e => e.stopPropagation()}>
                    <input type="number" value={data.percentage}
                      onChange={(e) => handleAEPercentageChange(data.user.id, parseInt(e.target.value) || 0)}
                      className="w-14 px-2 py-1 text-center border border-gray-300 rounded text-sm font-bold" />
                    <span className="text-gray-500">%</span>
                  </div>
                </div>
                <div className="flex items-center space-x-4 text-sm text-gray-500">
                  <span className="text-blue-600">{total} GL</span>
                  <span className={`font-medium ${penetrationOk ? 'text-green-600' : 'text-amber-600'}`}>
                    {totalPayTerminals} Pay ({penetration.toFixed(0)}%)
                  </span>
                  <span className="text-teal-600">{totalTerminal} Term</span>
                  <span className="text-pink-600">{totalTipping} Tip</span>
                  <span className="text-gray-400">{data.expanded ? '▼' : '▶'}</span>
                </div>
              </div>
              
              {/* Details (klappbar) */}
              {data.expanded && (
                <div className="px-4 pb-4 space-y-3">
                  {[
                    { key: 'inbound', label: 'Inbound', color: 'blue', values: data.inbound },
                    { key: 'outbound', label: 'Outbound', color: 'orange', values: data.outbound },
                    { key: 'partnerships', label: 'Partnerships', color: 'purple', values: data.partnerships },
                    { key: 'payTerminals', label: 'Pay Terminals (Hardware)', color: 'green', values: data.payTerminals },
                    { key: 'terminalSales', label: 'Terminal Sales', color: 'teal', values: data.terminalSales },
                    { key: 'tipping', label: 'Tipping', color: 'pink', values: data.tipping },
                  ].map(cat => (
                    <div key={cat.key}>
                      <div className="flex items-center justify-between mb-1">
                        <h5 className={`text-sm font-medium text-${cat.color}-700`}>{cat.label}</h5>
                        <span className="text-xs text-gray-500">Summe: {cat.values.reduce((a,b)=>a+b,0)}</span>
                      </div>
                      <div className="grid grid-cols-12 gap-1">
                        {MONTHS.map((m, i) => (
                          <input key={i} type="number" value={cat.values[i]}
                            onChange={(e) => handleAEValueChange(data.user.id, cat.key as any, i, parseInt(e.target.value) || 0)}
                            className={`w-full px-1 py-0.5 text-center border border-${cat.color}-200 rounded text-xs bg-${cat.color}-50`} />
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* ========== 4. UMSATZ-BERECHNUNG ========== */}
      <div className="bg-white rounded-xl shadow-sm p-6">
        <h3 className="text-lg font-bold text-gray-800 mb-4">4. Umsatz-Berechnung</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Avg Subs Bill</label>
            <div className="relative">
              <span className="absolute left-3 top-2 text-gray-500">€</span>
              <input type="number" value={avgSubsBill} onChange={(e) => setAvgSubsBill(parseInt(e.target.value) || 0)}
                className="w-full pl-8 pr-3 py-2 border border-gray-300 rounded-lg" />
            </div>
            <p className="text-xs text-gray-500 mt-1">Subs ARR = Go-Lives × Bill × 12</p>
          </div>
          <div>
            <label className="block text-sm font-medium text-teal-700 mb-1">Avg Pay Bill Terminal</label>
            <div className="relative">
              <span className="absolute left-3 top-2 text-gray-500">€</span>
              <input type="number" value={avgPayBillTerminal} onChange={(e) => setAvgPayBillTerminal(parseInt(e.target.value) || 0)}
                className="w-full pl-8 pr-3 py-2 border border-teal-300 rounded-lg bg-teal-50" />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-pink-700 mb-1">Avg Pay Bill Tipping</label>
            <div className="relative">
              <span className="absolute left-3 top-2 text-gray-500">€</span>
              <input type="number" value={avgPayBillTipping} onChange={(e) => setAvgPayBillTipping(parseInt(e.target.value) || 0)}
                className="w-full pl-8 pr-3 py-2 border border-pink-300 rounded-lg bg-pink-50" />
            </div>
          </div>
        </div>
        <div className="mt-4 p-4 bg-gray-50 rounded-lg text-sm space-y-2">
          <div>
            <strong className="text-green-700">Subs ARR:</strong> ({businessTotal} × €{avgSubsBill} × 12) = <strong className="text-green-600">{formatCurrency(yearlySubsArr)}</strong>
          </div>
          <div>
            <strong className="text-orange-700">Pay ARR:</strong> ({businessTotalTerminalSales} × €{avgPayBillTerminal} × 12) + ({businessTotalTipping} × €{avgPayBillTipping} × 12) = <strong className="text-orange-600">{formatCurrency(yearlyPayArr)}</strong>
          </div>
          <div className="border-t border-gray-300 pt-2 mt-2">
            <strong className="text-purple-700">Gesamt ARR:</strong> {formatCurrency(yearlySubsArr)} + {formatCurrency(yearlyPayArr)} = <strong className="text-purple-600 text-base">{formatCurrency(yearlySubsArr + yearlyPayArr)}</strong>
          </div>
        </div>
      </div>

      {/* ========== 5. AE AUSWÄHLEN + OTE ========== */}
      <div className="bg-white rounded-xl shadow-sm p-6">
        <h3 className="text-lg font-bold text-gray-800 mb-4">5. AE auswählen & OTE <span className="text-sm font-normal text-gray-500">(ab hier AE-spezifisch)</span></h3>
        
        {/* AE Auswahl und OTE */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">AE auswählen</label>
            <select 
              value={selectedAEId || ''} 
              onChange={(e) => setSelectedAEId(e.target.value)}
              className="w-full px-3 py-2 border border-indigo-300 rounded-lg bg-indigo-50 font-medium"
            >
              {Array.from(aePlanningData.values()).map(data => (
                <option key={data.user.id} value={data.user.id}>
                  {data.user.name} ({data.percentage}%)
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">OTE für {selectedAEData?.user.name || 'AE'}</label>
            <div className="relative">
              <span className="absolute left-3 top-2 text-gray-500">€</span>
              <input 
                type="number" 
                value={selectedAEOTE} 
                onChange={(e) => handleAEOTEChange(parseInt(e.target.value) || 0)}
                className="w-full pl-8 pr-3 py-2 border border-gray-300 rounded-lg" 
              />
            </div>
          </div>
        </div>
        
        {/* AE Summary */}
        {selectedAEData && (
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-center">
            <div className="bg-blue-50 rounded-lg p-2">
              <div className="text-xs text-blue-600">Go-Lives</div>
              <div className="text-lg font-bold text-blue-700">
                {selectedAEData.inbound.reduce((a,b)=>a+b,0) + selectedAEData.outbound.reduce((a,b)=>a+b,0) + selectedAEData.partnerships.reduce((a,b)=>a+b,0)}
              </div>
            </div>
            <div className="bg-teal-50 rounded-lg p-2">
              <div className="text-xs text-teal-600">Terminal</div>
              <div className="text-lg font-bold text-teal-700">
                {selectedAEData.terminalSales.reduce((a,b)=>a+b,0)}
              </div>
            </div>
            <div className="bg-pink-50 rounded-lg p-2">
              <div className="text-xs text-pink-600">Tipping</div>
              <div className="text-lg font-bold text-pink-700">
                {selectedAEData.tipping.reduce((a,b)=>a+b,0)}
              </div>
            </div>
            <div className="bg-green-50 rounded-lg p-2">
              <div className="text-xs text-green-600">Subs ARR</div>
              <div className="text-lg font-bold text-green-700">
                {formatCurrency((selectedAEData.inbound.reduce((a,b)=>a+b,0) + selectedAEData.outbound.reduce((a,b)=>a+b,0) + selectedAEData.partnerships.reduce((a,b)=>a+b,0)) * avgSubsBill * 12)}
              </div>
            </div>
            <div className="bg-orange-50 rounded-lg p-2">
              <div className="text-xs text-orange-600">Pay ARR</div>
              <div className="text-lg font-bold text-orange-700">
                {formatCurrency((selectedAEData.terminalSales.reduce((a,b)=>a+b,0) * avgPayBillTerminal * 12) + (selectedAEData.tipping.reduce((a,b)=>a+b,0) * avgPayBillTipping * 12))}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ========== 6. PROVISIONSMODELL (AE-spezifisch) ========== */}
      <div className="bg-white rounded-xl shadow-sm p-6">
        <h3 className="text-lg font-bold text-gray-800 mb-4">
          6. Provisionsmodell 
          <span className="text-sm font-normal text-indigo-600 ml-2">für {selectedAEData?.user.name || 'AE'}</span>
        </h3>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Terminal Basis €</label>
            <input type="number" value={selectedTerminalBase} onChange={(e) => handleTerminalBaseChange(parseInt(e.target.value) || 0)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Terminal Bonus €</label>
            <input type="number" value={selectedTerminalBonus} onChange={(e) => handleTerminalBonusChange(parseInt(e.target.value) || 0)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg" />
          </div>
        </div>
        
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Subs Tiers */}
          <div>
            <h4 className="font-medium text-green-700 mb-2">Subs ARR Stufen</h4>
            <table className="w-full text-sm">
              <tbody>
                {selectedSubsTiers.map((tier, i) => (
                  <tr key={i} className="border-b">
                    <td className="py-1">{tier.label}</td>
                    <td className="py-1 text-right">
                      <input type="number" value={(tier.rate * 100).toFixed(1)}
                        onChange={(e) => handleSubsTierRateChange(i, parseFloat(e.target.value) / 100)}
                        className="w-14 px-1 py-0.5 text-right border rounded text-xs" step="0.1" />%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          
          {/* Pay Tiers */}
          <div>
            <h4 className="font-medium text-orange-700 mb-2">Pay ARR Stufen</h4>
            <table className="w-full text-sm">
              <tbody>
                {selectedPayTiers.map((tier, i) => (
                  <tr key={i} className="border-b">
                    <td className="py-1">{tier.label}</td>
                    <td className="py-1 text-right">
                      <input type="number" value={(tier.rate * 100).toFixed(1)}
                        onChange={(e) => handlePayTierRateChange(i, parseFloat(e.target.value) / 100)}
                        className="w-14 px-1 py-0.5 text-right border rounded text-xs" step="0.1" />%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          
          {/* Terminal-Provision (Einmalig) */}
          <div>
            <h4 className="font-medium text-blue-700 mb-2">Terminal-Provision (Einmalig)</h4>
            <table className="w-full text-sm">
              <tbody>
                <tr className={`border-b ${selectedAEPenetration < (terminalPenetrationThreshold / 100) ? 'bg-blue-50' : ''}`}>
                  <td className="py-1">&lt; {terminalPenetrationThreshold}%</td>
                  <td className="py-1 text-right font-medium">€{selectedTerminalBase}</td>
                  <td className="py-1 text-right text-xs text-gray-500">pro Terminal</td>
                </tr>
                <tr className={`border-b ${selectedAEPenetration >= (terminalPenetrationThreshold / 100) ? 'bg-blue-50' : ''}`}>
                  <td className="py-1">≥ {terminalPenetrationThreshold}%</td>
                  <td className="py-1 text-right font-medium">€{selectedTerminalBonus}</td>
                  <td className="py-1 text-right text-xs text-gray-500">pro Terminal</td>
                </tr>
              </tbody>
            </table>
            {selectedAEData && (
              <div className={`mt-2 p-2 rounded text-xs ${selectedAEPenetration >= (terminalPenetrationThreshold / 100) ? 'bg-green-50 text-green-700' : 'bg-amber-50 text-amber-700'}`}>
                <strong>{selectedAEData.user.name.split(' ')[0]}:</strong> {(selectedAEPenetration * 100).toFixed(0)}% Penetration 
                → <strong>€{selectedAEPenetration >= (terminalPenetrationThreshold / 100) ? selectedTerminalBonus : selectedTerminalBase}</strong> × {selectedAEPayTerminals} = <strong>{formatCurrency(selectedAEPayTerminals * (selectedAEPenetration >= (terminalPenetrationThreshold / 100) ? selectedTerminalBonus : selectedTerminalBase))}</strong>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ========== 7. OTE VALIDIERUNG ========== */}
      <div className="bg-white rounded-xl shadow-sm p-6">
        <h3 className="text-lg font-bold text-gray-800 mb-4">
          7. OTE Validierung 
          <span className="text-sm font-normal text-indigo-600 ml-2">für {selectedAEData?.user.name || 'AE'}</span>
        </h3>
        
        {/* OTE Validierung */}
        <div className={`p-4 rounded-lg mb-4 ${oteValidation.valid ? 'bg-green-50 border border-green-200' : 'bg-yellow-50 border border-yellow-200'}`}>
          <p className={`font-medium ${oteValidation.valid ? 'text-green-700' : 'text-yellow-700'}`}>
            {oteValidation.valid 
              ? `OTE passt! Erwartete Provision: ${formatCurrency(oteValidation.expectedProvision)}`
              : `OTE Abweichung: ${oteValidation.deviation > 0 ? '+' : ''}${oteValidation.deviation.toFixed(1)}%`
            }
          </p>
          <p className="text-sm text-gray-600 mt-1">
            OTE: {formatCurrency(selectedAEOTE)} | Erwartet bei 100%: {formatCurrency(oteValidation.expectedProvision)}
          </p>
        </div>

        {/* Szenarien Tabelle */}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b">
                <th className="text-left py-2 px-1">Szenario</th>
                <th className="text-right py-2 px-1 text-green-600">Subs</th>
                <th className="text-right py-2 px-1 text-orange-600">Pay</th>
                <th className="text-right py-2 px-1 text-blue-600">Terminal</th>
                <th className="text-right py-2 px-1 text-purple-700 font-bold">Gesamt</th>
              </tr>
            </thead>
            <tbody>
              {oteProjections.map((proj, i) => (
                <tr key={i} className={`border-b ${proj.ote_match ? 'bg-green-50' : ''}`}>
                  <td className="py-1 px-1">{proj.scenario}</td>
                  <td className="py-1 px-1 text-right text-green-600">{formatCurrency(proj.subs_provision)}</td>
                  <td className="py-1 px-1 text-right text-orange-600">{formatCurrency(proj.pay_provision)}</td>
                  <td className="py-1 px-1 text-right text-blue-600">{formatCurrency(proj.terminal_provision)}</td>
                  <td className="py-1 px-1 text-right font-bold text-purple-700">
                    {formatCurrency(proj.total_provision)} {proj.ote_match && '✓'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ========== PARTNER-VERWALTUNG ========== */}
      <div className="bg-white rounded-xl shadow-sm p-6">
        <PartnerManagement />
      </div>

      {/* ========== SUBSCRIPTION-PAKETVERWALTUNG ========== */}
      <div className="bg-white rounded-xl shadow-sm p-6">
        <SubscriptionPackageManagement />
      </div>
    </div>
  );
}
