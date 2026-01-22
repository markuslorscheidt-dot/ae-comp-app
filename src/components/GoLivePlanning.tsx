'use client';

import { useState, useEffect, useMemo } from 'react';
import { User, isPlannable, calculateTotalGoLives, AESettings } from '@/lib/types';
import { useLanguage } from '@/lib/LanguageContext';
import { useAllUsers, useAllSettings } from '@/lib/hooks';
import { supabase } from '@/lib/supabase';

interface GoLivePlanningProps {
  currentUser: User;
  onBack: () => void;
}

interface AEPlanningData {
  user: User;
  percentage: number;
  inbound: number[];
  outbound: number[];
  partnerships: number[];
  terminalSales: number[];
  tipping: number[];
  // Flags ob manuell überschrieben
  manualOverride: boolean;
  terminalSalesManualOverride: boolean;
  tippingManualOverride: boolean;
}

const MONTHS = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];

export default function GoLivePlanning({ currentUser, onBack }: GoLivePlanningProps) {
  const { t } = useLanguage();
  const { users, loading: usersLoading } = useAllUsers();
  const { settings: allSettings, loading: settingsLoading } = useAllSettings(2026);
  
  // Business Targets (100%)
  const [businessInbound, setBusinessInbound] = useState<number[]>(
    [25, 25, 25, 30, 30, 20, 18, 15, 33, 34, 30, 15]
  );
  const [businessOutbound, setBusinessOutbound] = useState<number[]>(
    [0, 4, 4, 4, 4, 2, 2, 2, 4, 4, 4, 1]
  );
  const [businessPartnerships, setBusinessPartnerships] = useState<number[]>(
    [0, 1, 3, 10, 10, 10, 11, 11, 11, 10, 11, 2]
  );
  
  // Terminal Sales und Tipping (Business-Level) - Prozentsätze für initiale Berechnung
  const [terminalSalesPercent, setTerminalSalesPercent] = useState(75);
  const [tippingPercent, setTippingPercent] = useState(24);
  
  // Business Terminal Sales und Tipping als monatliche Arrays
  const [businessTerminalSales, setBusinessTerminalSales] = useState<number[]>(() => {
    // Initial aus Go-Lives berechnen
    const goLives = [25, 25, 25, 30, 30, 20, 18, 15, 33, 34, 30, 15].map((inb, i) => 
      inb + [0, 4, 4, 4, 4, 2, 2, 2, 4, 4, 4, 1][i] + [0, 1, 3, 10, 10, 10, 11, 11, 11, 10, 11, 2][i]
    );
    return goLives.map(gl => Math.round(gl * 75 / 100));
  });
  const [businessTipping, setBusinessTipping] = useState<number[]>(() => {
    const goLives = [25, 25, 25, 30, 30, 20, 18, 15, 33, 34, 30, 15].map((inb, i) => 
      inb + [0, 4, 4, 4, 4, 2, 2, 2, 4, 4, 4, 1][i] + [0, 1, 3, 10, 10, 10, 11, 11, 11, 10, 11, 2][i]
    );
    const termSales = goLives.map(gl => Math.round(gl * 75 / 100));
    return termSales.map(ts => Math.round(ts * 24 / 100));
  });
  
  // AE Planning Data
  const [aePlanningData, setAePlanningData] = useState<Map<string, AEPlanningData>>(new Map());
  
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  
  // Planbare User filtern
  const plannableUsers = useMemo(() => {
    return users.filter(u => isPlannable(u.role));
  }, [users]);
  
  // Initialisiere AE Planning Data wenn User geladen werden
  useEffect(() => {
    if (plannableUsers.length === 0) return;
    
    const newData = new Map<string, AEPlanningData>();
    
    // Verteile Prozente gleichmäßig initial
    const percentPerUser = Math.floor(100 / plannableUsers.length);
    let remainingPercent = 100;
    
    plannableUsers.forEach((user, index) => {
      const isLast = index === plannableUsers.length - 1;
      const percent = isLast ? remainingPercent : percentPerUser;
      remainingPercent -= percentPerUser;
      
      // Lade bestehende Settings wenn vorhanden
      const existingSettings = allSettings.find(s => s.user_id === user.id);
      
      const aeInbound = existingSettings?.monthly_inbound_targets || calculateFromPercentage(businessInbound, percent);
      const aeOutbound = existingSettings?.monthly_outbound_targets || calculateFromPercentage(businessOutbound, percent);
      const aePartnerships = existingSettings?.monthly_partnerships_targets || calculateFromPercentage(businessPartnerships, percent);
      // Berechne Go-Lives pro Monat für Terminal Sales und Tipping
      const aeGoLives = aeInbound.map((inb, i) => inb + aeOutbound[i] + aePartnerships[i]);
      const aeTerminalSales = aeGoLives.map(gl => Math.round(gl * terminalSalesPercent / 100));
      const aeTipping = aeTerminalSales.map(ts => Math.round(ts * tippingPercent / 100));
      
      newData.set(user.id, {
        user,
        percentage: percent,
        inbound: aeInbound,
        outbound: aeOutbound,
        partnerships: aePartnerships,
        terminalSales: aeTerminalSales,
        tipping: aeTipping,
        manualOverride: !!existingSettings?.monthly_inbound_targets,
        terminalSalesManualOverride: false,
        tippingManualOverride: false,
      });
    });
    
    setAePlanningData(newData);
  }, [plannableUsers, allSettings]);
  
  // Berechne Werte aus Prozentsatz
  function calculateFromPercentage(businessValues: number[], percentage: number): number[] {
    return businessValues.map(val => Math.round(val * percentage / 100));
  }
  
  // Summen berechnen
  const businessTotalInbound = businessInbound.reduce((a, b) => a + b, 0);
  const businessTotalOutbound = businessOutbound.reduce((a, b) => a + b, 0);
  const businessTotalPartnerships = businessPartnerships.reduce((a, b) => a + b, 0);
  const businessTotal = businessTotalInbound + businessTotalOutbound + businessTotalPartnerships;
  const businessTotalTerminalSales = businessTerminalSales.reduce((a, b) => a + b, 0);
  const businessTotalTipping = businessTipping.reduce((a, b) => a + b, 0);
  
  // Go-Lives pro Monat für Business
  const businessGoLivesPerMonth = businessInbound.map((inb, i) => inb + businessOutbound[i] + businessPartnerships[i]);
  
  // Prozentsumme der AEs
  const totalPercentage = Array.from(aePlanningData.values()).reduce((sum, data) => sum + data.percentage, 0);
  const percentageValid = totalPercentage === 100;
  
  // Handler für Business Target Änderungen
  const handleBusinessChange = (
    category: 'inbound' | 'outbound' | 'partnerships',
    month: number,
    value: number
  ) => {
    const setter = category === 'inbound' ? setBusinessInbound 
      : category === 'outbound' ? setBusinessOutbound 
      : setBusinessPartnerships;
    
    setter(prev => {
      const newValues = [...prev];
      newValues[month] = value;
      return newValues;
    });
    
    // Update AE values if not manually overridden
    recalculateAEValues();
  };
  
  // Handler für Business Terminal Sales Änderungen
  const handleBusinessTerminalSalesChange = (month: number, value: number) => {
    setBusinessTerminalSales(prev => {
      const newValues = [...prev];
      newValues[month] = value;
      return newValues;
    });
  };
  
  // Handler für Business Tipping Änderungen
  const handleBusinessTippingChange = (month: number, value: number) => {
    setBusinessTipping(prev => {
      const newValues = [...prev];
      newValues[month] = value;
      return newValues;
    });
  };
  
  // Recalculate Business Terminal Sales und Tipping aus Prozentsätzen
  const recalculateBusinessDerivedValues = () => {
    const goLives = businessInbound.map((inb, i) => inb + businessOutbound[i] + businessPartnerships[i]);
    setBusinessTerminalSales(goLives.map(gl => Math.round(gl * terminalSalesPercent / 100)));
    setBusinessTipping(prev => {
      const newTermSales = goLives.map(gl => Math.round(gl * terminalSalesPercent / 100));
      return newTermSales.map(ts => Math.round(ts * tippingPercent / 100));
    });
  };
  
  // Recalculate AE values based on percentages
  const recalculateAEValues = () => {
    setAePlanningData(prev => {
      const newData = new Map(prev);
      newData.forEach((data, id) => {
        if (!data.manualOverride) {
          newData.set(id, {
            ...data,
            inbound: calculateFromPercentage(businessInbound, data.percentage),
            outbound: calculateFromPercentage(businessOutbound, data.percentage),
            partnerships: calculateFromPercentage(businessPartnerships, data.percentage),
          });
        }
      });
      return newData;
    });
  };
  
  // Handler für AE Prozentsatz Änderung
  const handlePercentageChange = (userId: string, percentage: number) => {
    setAePlanningData(prev => {
      const newData = new Map(prev);
      const data = newData.get(userId);
      if (data) {
        newData.set(userId, {
          ...data,
          percentage,
          // Recalculate if not manually overridden
          inbound: data.manualOverride ? data.inbound : calculateFromPercentage(businessInbound, percentage),
          outbound: data.manualOverride ? data.outbound : calculateFromPercentage(businessOutbound, percentage),
          partnerships: data.manualOverride ? data.partnerships : calculateFromPercentage(businessPartnerships, percentage),
        });
      }
      return newData;
    });
  };
  
  // Handler für AE Go-Live Änderung (manuell)
  const handleAEValueChange = (
    userId: string,
    category: 'inbound' | 'outbound' | 'partnerships',
    month: number,
    value: number
  ) => {
    setAePlanningData(prev => {
      const newData = new Map(prev);
      const data = newData.get(userId);
      if (data) {
        const newCategoryValues = [...data[category]];
        newCategoryValues[month] = value;
        newData.set(userId, {
          ...data,
          [category]: newCategoryValues,
          manualOverride: true,
        });
      }
      return newData;
    });
  };
  
  // Reset AE to calculated values
  const resetAEToCalculated = (userId: string) => {
    setAePlanningData(prev => {
      const newData = new Map(prev);
      const data = newData.get(userId);
      if (data) {
        const aeInbound = calculateFromPercentage(businessInbound, data.percentage);
        const aeOutbound = calculateFromPercentage(businessOutbound, data.percentage);
        const aePartnerships = calculateFromPercentage(businessPartnerships, data.percentage);
        const aeGoLives = aeInbound.map((inb, i) => inb + aeOutbound[i] + aePartnerships[i]);
        const aeTerminalSales = aeGoLives.map(gl => Math.round(gl * terminalSalesPercent / 100));
        const aeTipping = aeTerminalSales.map(ts => Math.round(ts * tippingPercent / 100));
        
        newData.set(userId, {
          ...data,
          inbound: aeInbound,
          outbound: aeOutbound,
          partnerships: aePartnerships,
          terminalSales: aeTerminalSales,
          tipping: aeTipping,
          manualOverride: false,
          terminalSalesManualOverride: false,
          tippingManualOverride: false,
        });
      }
      return newData;
    });
  };
  
  // Handler für AE Terminal Sales Änderung (monatlich)
  const handleAETerminalSalesChange = (userId: string, month: number, value: number) => {
    setAePlanningData(prev => {
      const newData = new Map(prev);
      const data = newData.get(userId);
      if (data) {
        const newTerminalSales = [...data.terminalSales];
        newTerminalSales[month] = value;
        newData.set(userId, {
          ...data,
          terminalSales: newTerminalSales,
          terminalSalesManualOverride: true,
        });
      }
      return newData;
    });
  };
  
  // Handler für AE Tipping Änderung (monatlich)
  const handleAETippingChange = (userId: string, month: number, value: number) => {
    setAePlanningData(prev => {
      const newData = new Map(prev);
      const data = newData.get(userId);
      if (data) {
        const newTipping = [...data.tipping];
        newTipping[month] = value;
        newData.set(userId, {
          ...data,
          tipping: newTipping,
          tippingManualOverride: true,
        });
      }
      return newData;
    });
  };
  
  // Speichern
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
        
        const { error } = await supabase
          .from('ae_settings')
          .update({
            monthly_inbound_targets: data.inbound,
            monthly_outbound_targets: data.outbound,
            monthly_partnerships_targets: data.partnerships,
            monthly_go_live_targets: goLiveTargets,
            updated_at: new Date().toISOString(),
          })
          .eq('user_id', userId)
          .eq('year', 2026);
        
        if (error) {
          console.error('Error saving settings for', data.user.name, error);
          setMessage(`Fehler beim Speichern für ${data.user.name}: ${error.message}`);
          setSaving(false);
          return;
        }
      }
      
      setMessage('Alle Plandaten erfolgreich gespeichert!');
      setTimeout(() => setMessage(''), 3000);
    } catch (err: any) {
      setMessage(`Fehler: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };
  
  if (usersLoading || settingsLoading) {
    return (
      <div className="flex items-center justify-center p-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
        <span className="ml-3 text-gray-600">Lade Daten...</span>
      </div>
    );
  }
  
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-4">
          <button onClick={onBack} className="p-2 hover:bg-gray-100 rounded-lg transition">
            ← Zurück
          </button>
          <h2 className="text-2xl font-bold text-gray-800">Go-Live Planung</h2>
        </div>
        <button
          onClick={handleSave}
          disabled={saving || !percentageValid}
          className="px-6 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition disabled:opacity-50"
        >
          {saving ? 'Speichern...' : 'Alle speichern'}
        </button>
      </div>
      
      {/* Message */}
      {message && (
        <div className={`p-3 rounded-lg text-sm ${message.includes('Fehler') ? 'bg-red-50 text-red-700' : 'bg-green-50 text-green-700'}`}>
          {message}
        </div>
      )}
      
      {/* Validation Warning */}
      {!percentageValid && (
        <div className="p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
          <p className="text-yellow-800 font-medium">
            ⚠️ Die Summe der Prozentsätze beträgt {totalPercentage}% (muss 100% sein)
          </p>
        </div>
      )}
      
      {/* Business Targets (100%) */}
      <div className="bg-white rounded-xl shadow-sm p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold text-gray-800">Business Targets (100%)</h3>
          <span className="text-sm text-gray-500">
            Gesamt: <strong className="text-lg">{businessTotal}</strong> Go-Lives / Jahr
          </span>
        </div>
        
        {/* Inbound */}
        <div className="mb-4">
          <div className="flex items-center justify-between mb-2">
            <h4 className="font-medium text-blue-700">Inbound</h4>
            <span className="text-sm text-gray-500">Summe: <strong>{businessTotalInbound}</strong></span>
          </div>
          <div className="grid grid-cols-12 gap-1">
            {MONTHS.map((m, i) => (
              <div key={`bus-inbound-${i}`} className="text-center">
                <label className="block text-xs text-gray-500 mb-1">{m}</label>
                <input
                  type="number"
                  value={businessInbound[i]}
                  onChange={(e) => handleBusinessChange('inbound', i, parseInt(e.target.value) || 0)}
                  className="w-full px-1 py-1 text-center border border-blue-200 rounded text-sm bg-blue-50"
                />
              </div>
            ))}
          </div>
        </div>
        
        {/* Outbound */}
        <div className="mb-4">
          <div className="flex items-center justify-between mb-2">
            <h4 className="font-medium text-orange-700">Outbound</h4>
            <span className="text-sm text-gray-500">Summe: <strong>{businessTotalOutbound}</strong></span>
          </div>
          <div className="grid grid-cols-12 gap-1">
            {MONTHS.map((m, i) => (
              <div key={`bus-outbound-${i}`} className="text-center">
                <label className="block text-xs text-gray-500 mb-1">{m}</label>
                <input
                  type="number"
                  value={businessOutbound[i]}
                  onChange={(e) => handleBusinessChange('outbound', i, parseInt(e.target.value) || 0)}
                  className="w-full px-1 py-1 text-center border border-orange-200 rounded text-sm bg-orange-50"
                />
              </div>
            ))}
          </div>
        </div>
        
        {/* Partnerships */}
        <div className="mb-6">
          <div className="flex items-center justify-between mb-2">
            <h4 className="font-medium text-purple-700">Partnerships</h4>
            <span className="text-sm text-gray-500">Summe: <strong>{businessTotalPartnerships}</strong></span>
          </div>
          <div className="grid grid-cols-12 gap-1">
            {MONTHS.map((m, i) => (
              <div key={`bus-partnerships-${i}`} className="text-center">
                <label className="block text-xs text-gray-500 mb-1">{m}</label>
                <input
                  type="number"
                  value={businessPartnerships[i]}
                  onChange={(e) => handleBusinessChange('partnerships', i, parseInt(e.target.value) || 0)}
                  className="w-full px-1 py-1 text-center border border-purple-200 rounded text-sm bg-purple-50"
                />
              </div>
            ))}
          </div>
        </div>
        
        {/* Trennlinie */}
        <div className="border-t border-gray-200 pt-4 mt-4">
          <div className="flex items-center justify-between mb-4">
            <h4 className="font-medium text-gray-700">Abgeleitete Kennzahlen</h4>
            <div className="flex items-center space-x-4 text-sm">
              <span className="text-gray-500">Prozentsätze:</span>
              <div className="flex items-center space-x-1">
                <span className="text-teal-600">Terminal</span>
                <input
                  type="number"
                  value={terminalSalesPercent}
                  onChange={(e) => {
                    setTerminalSalesPercent(parseInt(e.target.value) || 0);
                    recalculateBusinessDerivedValues();
                  }}
                  className="w-12 px-1 py-0.5 text-center border border-teal-300 rounded text-xs font-bold"
                  min="0"
                  max="100"
                />
                <span className="text-teal-600">%</span>
              </div>
              <div className="flex items-center space-x-1">
                <span className="text-pink-600">Tipping</span>
                <input
                  type="number"
                  value={tippingPercent}
                  onChange={(e) => {
                    setTippingPercent(parseInt(e.target.value) || 0);
                    recalculateBusinessDerivedValues();
                  }}
                  className="w-12 px-1 py-0.5 text-center border border-pink-300 rounded text-xs font-bold"
                  min="0"
                  max="100"
                />
                <span className="text-pink-600">%</span>
              </div>
              <button
                onClick={recalculateBusinessDerivedValues}
                className="text-xs text-blue-600 hover:text-blue-800 underline"
              >
                Neu berechnen
              </button>
            </div>
          </div>
          
          {/* Terminal Sales (monatlich) */}
          <div className="mb-4">
            <div className="flex items-center justify-between mb-2">
              <h4 className="font-medium text-teal-700">Terminal Sales</h4>
              <span className="text-sm text-gray-500">Summe: <strong>{businessTotalTerminalSales}</strong></span>
            </div>
            <div className="grid grid-cols-12 gap-1">
              {MONTHS.map((m, i) => (
                <div key={`bus-terminal-${i}`} className="text-center">
                  <label className="block text-xs text-gray-500 mb-1">{m}</label>
                  <input
                    type="number"
                    value={businessTerminalSales[i]}
                    onChange={(e) => handleBusinessTerminalSalesChange(i, parseInt(e.target.value) || 0)}
                    className="w-full px-1 py-1 text-center border border-teal-200 rounded text-sm bg-teal-50"
                  />
                </div>
              ))}
            </div>
          </div>
          
          {/* Tipping (monatlich) */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <h4 className="font-medium text-pink-700">Tipping</h4>
              <span className="text-sm text-gray-500">Summe: <strong>{businessTotalTipping}</strong></span>
            </div>
            <div className="grid grid-cols-12 gap-1">
              {MONTHS.map((m, i) => (
                <div key={`bus-tipping-${i}`} className="text-center">
                  <label className="block text-xs text-gray-500 mb-1">{m}</label>
                  <input
                    type="number"
                    value={businessTipping[i]}
                    onChange={(e) => handleBusinessTippingChange(i, parseInt(e.target.value) || 0)}
                    className="w-full px-1 py-1 text-center border border-pink-200 rounded text-sm bg-pink-50"
                  />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
      
      {/* AE Sections */}
      {Array.from(aePlanningData.values()).map((data) => {
        const totalInbound = data.inbound.reduce((a, b) => a + b, 0);
        const totalOutbound = data.outbound.reduce((a, b) => a + b, 0);
        const totalPartnerships = data.partnerships.reduce((a, b) => a + b, 0);
        const total = totalInbound + totalOutbound + totalPartnerships;
        const totalTerminalSales = data.terminalSales.reduce((a, b) => a + b, 0);
        const totalTipping = data.tipping.reduce((a, b) => a + b, 0);
        
        return (
          <div key={data.user.id} className="bg-white rounded-xl shadow-sm p-6">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center space-x-4">
                <h3 className="text-lg font-bold text-gray-800">{data.user.name}</h3>
                <div className="flex items-center space-x-2">
                  <span className="text-sm text-gray-500">Anteil:</span>
                  <input
                    type="number"
                    value={data.percentage}
                    onChange={(e) => handlePercentageChange(data.user.id, parseInt(e.target.value) || 0)}
                    className="w-16 px-2 py-1 text-center border border-gray-300 rounded text-sm font-bold"
                    min="0"
                    max="100"
                  />
                  <span className="text-sm text-gray-500">%</span>
                </div>
                {(data.manualOverride || data.terminalSalesManualOverride || data.tippingManualOverride) && (
                  <button
                    onClick={() => resetAEToCalculated(data.user.id)}
                    className="text-xs text-blue-600 hover:text-blue-800 underline"
                  >
                    Zurücksetzen auf Berechnung
                  </button>
                )}
              </div>
              <span className="text-sm text-gray-500">
                Gesamt: <strong className="text-lg">{total}</strong> Go-Lives
              </span>
            </div>
            
            {/* Inbound */}
            <div className="mb-4">
              <div className="flex items-center justify-between mb-2">
                <h4 className="font-medium text-blue-700">Inbound</h4>
                <span className="text-sm text-gray-500">Summe: <strong>{totalInbound}</strong></span>
              </div>
              <div className="grid grid-cols-12 gap-1">
                {MONTHS.map((m, i) => (
                  <div key={`${data.user.id}-inbound-${i}`} className="text-center">
                    <label className="block text-xs text-gray-500 mb-1">{m}</label>
                    <input
                      type="number"
                      value={data.inbound[i]}
                      onChange={(e) => handleAEValueChange(data.user.id, 'inbound', i, parseInt(e.target.value) || 0)}
                      className={`w-full px-1 py-1 text-center border rounded text-sm ${
                        data.manualOverride ? 'border-blue-400 bg-blue-100' : 'border-blue-200 bg-blue-50'
                      }`}
                    />
                  </div>
                ))}
              </div>
            </div>
            
            {/* Outbound */}
            <div className="mb-4">
              <div className="flex items-center justify-between mb-2">
                <h4 className="font-medium text-orange-700">Outbound</h4>
                <span className="text-sm text-gray-500">Summe: <strong>{totalOutbound}</strong></span>
              </div>
              <div className="grid grid-cols-12 gap-1">
                {MONTHS.map((m, i) => (
                  <div key={`${data.user.id}-outbound-${i}`} className="text-center">
                    <label className="block text-xs text-gray-500 mb-1">{m}</label>
                    <input
                      type="number"
                      value={data.outbound[i]}
                      onChange={(e) => handleAEValueChange(data.user.id, 'outbound', i, parseInt(e.target.value) || 0)}
                      className={`w-full px-1 py-1 text-center border rounded text-sm ${
                        data.manualOverride ? 'border-orange-400 bg-orange-100' : 'border-orange-200 bg-orange-50'
                      }`}
                    />
                  </div>
                ))}
              </div>
            </div>
            
            {/* Partnerships */}
            <div className="mb-4">
              <div className="flex items-center justify-between mb-2">
                <h4 className="font-medium text-purple-700">Partnerships</h4>
                <span className="text-sm text-gray-500">Summe: <strong>{totalPartnerships}</strong></span>
              </div>
              <div className="grid grid-cols-12 gap-1">
                {MONTHS.map((m, i) => (
                  <div key={`${data.user.id}-partnerships-${i}`} className="text-center">
                    <label className="block text-xs text-gray-500 mb-1">{m}</label>
                    <input
                      type="number"
                      value={data.partnerships[i]}
                      onChange={(e) => handleAEValueChange(data.user.id, 'partnerships', i, parseInt(e.target.value) || 0)}
                      className={`w-full px-1 py-1 text-center border rounded text-sm ${
                        data.manualOverride ? 'border-purple-400 bg-purple-100' : 'border-purple-200 bg-purple-50'
                      }`}
                    />
                  </div>
                ))}
              </div>
            </div>
            
            {/* Terminal Sales (monatlich) */}
            <div className="mb-4">
              <div className="flex items-center justify-between mb-2">
                <h4 className="font-medium text-teal-700">Terminal Sales <span className="text-xs font-normal text-gray-500">({terminalSalesPercent}%)</span></h4>
                <span className="text-sm text-gray-500">Summe: <strong>{totalTerminalSales}</strong></span>
              </div>
              <div className="grid grid-cols-12 gap-1">
                {MONTHS.map((m, i) => (
                  <div key={`${data.user.id}-terminal-${i}`} className="text-center">
                    <label className="block text-xs text-gray-500 mb-1">{m}</label>
                    <input
                      type="number"
                      value={data.terminalSales[i]}
                      onChange={(e) => handleAETerminalSalesChange(data.user.id, i, parseInt(e.target.value) || 0)}
                      className={`w-full px-1 py-1 text-center border rounded text-sm ${
                        data.terminalSalesManualOverride ? 'border-teal-400 bg-teal-100' : 'border-teal-200 bg-teal-50'
                      }`}
                    />
                  </div>
                ))}
              </div>
            </div>
            
            {/* Tipping (monatlich) */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <h4 className="font-medium text-pink-700">Tipping <span className="text-xs font-normal text-gray-500">({tippingPercent}%)</span></h4>
                <span className="text-sm text-gray-500">Summe: <strong>{totalTipping}</strong></span>
              </div>
              <div className="grid grid-cols-12 gap-1">
                {MONTHS.map((m, i) => (
                  <div key={`${data.user.id}-tipping-${i}`} className="text-center">
                    <label className="block text-xs text-gray-500 mb-1">{m}</label>
                    <input
                      type="number"
                      value={data.tipping[i]}
                      onChange={(e) => handleAETippingChange(data.user.id, i, parseInt(e.target.value) || 0)}
                      className={`w-full px-1 py-1 text-center border rounded text-sm ${
                        data.tippingManualOverride ? 'border-pink-400 bg-pink-100' : 'border-pink-200 bg-pink-50'
                      }`}
                    />
                  </div>
                ))}
              </div>
            </div>
          </div>
        );
      })}
      
      {/* Summe */}
      <div className="bg-gray-100 rounded-xl p-4">
        <div className="flex items-center justify-between">
          <span className="font-medium text-gray-700">Prozent-Verteilung:</span>
          <span className={`font-bold ${percentageValid ? 'text-green-600' : 'text-red-600'}`}>
            {Array.from(aePlanningData.values()).map(d => `${d.user.name.split(' ')[0]}: ${d.percentage}%`).join(' + ')} = {totalPercentage}%
            {percentageValid ? ' ✓' : ' ✗'}
          </span>
        </div>
      </div>
    </div>
  );
}
