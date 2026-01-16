'use client';

import { useState } from 'react';
import { 
  Opportunity, 
  Lead, 
  PipelineSettings,
  OpportunityStage,
  OPPORTUNITY_STAGES,
  ACTIVE_PIPELINE_STAGES,
  calculateExpectedCloseDate,
  getDefaultProbability,
  calculateARR,
} from '@/lib/pipeline-types';
import { formatCurrency } from '@/lib/calculations';

interface OpportunityFormProps {
  opportunity: Opportunity | null;
  lead: Lead;
  settings: PipelineSettings | null;
  userRole: string;
  onSave: (data: Partial<Opportunity>) => Promise<void>;
  onCancel: () => void;
  onArchive?: () => Promise<void>;
}

export default function OpportunityForm({ 
  opportunity, 
  lead, 
  settings, 
  userRole,
  onSave, 
  onCancel, 
  onArchive 
}: OpportunityFormProps) {
  // Manager können Stage ändern
  const canChangeStage = userRole === 'line_manager' || userRole === 'country_manager';
  
  // Salesforce Link
  const sfLink = opportunity?.sfid 
    ? `https://phorestcrm.lightning.force.com/lightning/r/Opportunity/${opportunity.sfid}/view`
    : null;

  const [formData, setFormData] = useState({
    name: opportunity?.name || (lead.location_count === 1 ? lead.company_name : ''),
    stage: opportunity?.stage || 'sql' as OpportunityStage,
    expected_subs_monthly: opportunity?.expected_subs_monthly?.toString() || '',
    expected_pay_monthly: opportunity?.expected_pay_monthly?.toString() || '',
    has_terminal: opportunity?.has_terminal || false,
    probability: opportunity?.probability?.toString() || '',
    expected_close_date: opportunity?.expected_close_date || '',
    use_auto_date: !opportunity?.expected_close_date,
  });
  
  const [saving, setSaving] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [error, setError] = useState('');

  // Berechnete Werte
  const subsMonthly = parseFloat(formData.expected_subs_monthly) || 0;
  const payMonthly = parseFloat(formData.expected_pay_monthly) || 0;
  const subsARR = calculateARR(subsMonthly);
  const payARR = calculateARR(payMonthly);
  const totalARR = subsARR + payARR;
  
  const effectiveProbability = formData.probability 
    ? parseFloat(formData.probability) 
    : getDefaultProbability(formData.stage as OpportunityStage, settings || undefined);
  
  const weightedValue = totalARR * effectiveProbability;

  const autoCloseDate = calculateExpectedCloseDate(
    formData.stage as OpportunityStage, 
    settings || undefined
  ).toISOString().split('T')[0];

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!formData.name.trim()) {
      setError('Name/Filiale ist erforderlich');
      return;
    }

    if (!formData.expected_subs_monthly || parseFloat(formData.expected_subs_monthly) <= 0) {
      setError('Monatlicher Subs-Betrag ist erforderlich');
      return;
    }

    setSaving(true);
    try {
      await onSave({
        lead_id: lead.id,
        name: formData.name.trim(),
        stage: formData.stage as OpportunityStage,
        expected_subs_monthly: parseFloat(formData.expected_subs_monthly),
        expected_pay_monthly: parseFloat(formData.expected_pay_monthly) || 0,
        has_terminal: formData.has_terminal,
        probability: formData.probability ? parseFloat(formData.probability) : null,
        expected_close_date: formData.use_auto_date ? autoCloseDate : formData.expected_close_date,
      });
    } catch (err: any) {
      setError(err.message || 'Fehler beim Speichern');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl max-w-lg w-full max-h-[90vh] overflow-y-auto">
        <div className="p-6 border-b sticky top-0 bg-white">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-xl font-bold text-gray-800">
                {opportunity ? 'Opportunity bearbeiten' : 'Neue Opportunity'}
              </h2>
              <p className="text-sm text-gray-500">für {lead.company_name}</p>
            </div>
            <button
              onClick={onCancel}
              className="p-2 text-gray-400 hover:bg-gray-100 rounded-lg"
            >
              ✕
            </button>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && (
            <div className="p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">
              {error}
            </div>
          )}

          {/* Name */}
          <div>
            <label className="block text-sm font-medium text-gray-600 mb-1">
              Name / Filiale *
            </label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              placeholder={lead.location_count > 1 ? 'z.B. Filiale Köln' : lead.company_name}
              required
            />
            {lead.location_count === 1 && (
              <p className="text-xs text-gray-400 mt-1">Bei Single-Location kann der Unternehmensname verwendet werden</p>
            )}
          </div>

          {/* Stage */}
          <div>
            <label className="block text-sm font-medium text-gray-600 mb-1">
              Stage *
            </label>
            
            {/* Salesforce Info für bestehende Opportunities */}
            {opportunity && (
              <div className="mb-3 p-3 bg-blue-50 border border-blue-200 rounded-lg">
                <div className="flex items-start gap-2">
                  <span className="text-lg">ℹ️</span>
                  <div className="flex-1">
                    <p className="text-xs text-blue-700 mb-2">
                      Stage wird über Salesforce Import aktualisiert
                    </p>
                    {sfLink && (
                      <a
                        href={sfLink}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800"
                      >
                        ☁️ In Salesforce öffnen
                      </a>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Stage-Auswahl - nur für Manager bei bestehenden Opps, immer für neue */}
            {(!opportunity || canChangeStage) ? (
              <div className="grid grid-cols-2 gap-2">
                {ACTIVE_PIPELINE_STAGES.map(stage => {
                  const config = OPPORTUNITY_STAGES[stage];
                  return (
                    <label
                      key={stage}
                      className={`flex items-center p-3 border rounded-lg cursor-pointer transition ${
                        formData.stage === stage
                          ? `border-2 ${config.bgColor} ${config.color}`
                          : 'border-gray-200 hover:border-gray-300'
                      }`}
                    >
                      <input
                        type="radio"
                        name="stage"
                        value={stage}
                        checked={formData.stage === stage}
                        onChange={() => setFormData({ 
                          ...formData, 
                          stage: stage,
                          probability: '', // Reset to default
                        })}
                        className="sr-only"
                      />
                      <span className="mr-2">{config.icon}</span>
                      <div>
                        <div className="text-sm font-medium">{config.label}</div>
                        <div className="text-xs opacity-75">{Math.round(config.defaultProbability * 100)}%</div>
                      </div>
                    </label>
                  );
                })}
              </div>
            ) : (
              /* AE sieht nur den aktuellen Stage (read-only) */
              <div className="p-3 border border-gray-200 rounded-lg bg-gray-50">
                <div className="flex items-center gap-2">
                  <span className="text-lg">{OPPORTUNITY_STAGES[formData.stage as OpportunityStage]?.icon}</span>
                  <div>
                    <div className="font-medium text-gray-700">{OPPORTUNITY_STAGES[formData.stage as OpportunityStage]?.label}</div>
                    <div className="text-xs text-gray-500">{Math.round((OPPORTUNITY_STAGES[formData.stage as OpportunityStage]?.defaultProbability || 0) * 100)}%</div>
                  </div>
                </div>
                <p className="text-xs text-gray-400 mt-2">Nur Manager können den Stage hier ändern</p>
              </div>
            )}
          </div>

          {/* Werte */}
          <div>
            <h3 className="font-medium text-gray-700 mb-3">Erwartete Werte (monatlich)</h3>
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-gray-600 mb-1">
                  Subs monatlich * (€)
                </label>
                <input
                  type="number"
                  value={formData.expected_subs_monthly}
                  onChange={(e) => setFormData({ ...formData, expected_subs_monthly: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  placeholder="180"
                  min="0"
                  step="0.01"
                  required
                />
                {subsMonthly > 0 && (
                  <p className="text-sm text-green-600 mt-1">→ {formatCurrency(subsARR)} ARR</p>
                )}
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-600 mb-1">
                  Pay monatlich (€)
                </label>
                <input
                  type="number"
                  value={formData.expected_pay_monthly}
                  onChange={(e) => setFormData({ ...formData, expected_pay_monthly: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  placeholder="50"
                  min="0"
                  step="0.01"
                />
                {payMonthly > 0 && (
                  <p className="text-sm text-orange-600 mt-1">→ {formatCurrency(payARR)} ARR</p>
                )}
              </div>

              <label className="flex items-center space-x-3">
                <input
                  type="checkbox"
                  checked={formData.has_terminal}
                  onChange={(e) => setFormData({ ...formData, has_terminal: e.target.checked })}
                  className="w-5 h-5 rounded border-gray-300 text-blue-600"
                />
                <span className="text-sm text-gray-700">📱 Terminal</span>
              </label>
            </div>
          </div>

          {/* Zusammenfassung */}
          {totalARR > 0 && (
            <div className="bg-gray-50 rounded-lg p-4">
              <div className="grid grid-cols-2 gap-4 text-center">
                <div>
                  <div className="text-sm text-gray-500">Total ARR</div>
                  <div className="text-lg font-bold text-gray-800">{formatCurrency(totalARR)}</div>
                </div>
                <div>
                  <div className="text-sm text-gray-500">Gewichtet ({Math.round(effectiveProbability * 100)}%)</div>
                  <div className="text-lg font-bold text-blue-600">{formatCurrency(weightedValue)}</div>
                </div>
              </div>
            </div>
          )}

          {/* Prognose */}
          <div>
            <h3 className="font-medium text-gray-700 mb-3">Prognose</h3>
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-gray-600 mb-1">
                  Probability (%)
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    value={formData.probability}
                    onChange={(e) => setFormData({ ...formData, probability: e.target.value })}
                    className="w-24 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    placeholder={String(Math.round(getDefaultProbability(formData.stage as OpportunityStage, settings || undefined) * 100))}
                    min="0"
                    max="100"
                  />
                  <span className="text-sm text-gray-500">
                    Leer = Stage-Default ({Math.round(getDefaultProbability(formData.stage as OpportunityStage, settings || undefined) * 100)}%)
                  </span>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-600 mb-1">
                  Expected Close Date
                </label>
                <div className="space-y-2">
                  <label className="flex items-center space-x-2">
                    <input
                      type="radio"
                      checked={formData.use_auto_date}
                      onChange={() => setFormData({ ...formData, use_auto_date: true })}
                      className="text-blue-600"
                    />
                    <span className="text-sm">
                      Automatisch: <strong>{autoCloseDate}</strong>
                      <span className="text-gray-400 ml-1">(basierend auf Cycle Time)</span>
                    </span>
                  </label>
                  <label className="flex items-center space-x-2">
                    <input
                      type="radio"
                      checked={!formData.use_auto_date}
                      onChange={() => setFormData({ ...formData, use_auto_date: false })}
                      className="text-blue-600"
                    />
                    <span className="text-sm">Manuell setzen:</span>
                  </label>
                  {!formData.use_auto_date && (
                    <input
                      type="date"
                      value={formData.expected_close_date}
                      onChange={(e) => setFormData({ ...formData, expected_close_date: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    />
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center justify-between pt-4 border-t">
            {onArchive && opportunity && !opportunity.archived ? (
              <button
                type="button"
                onClick={async () => {
                  setArchiving(true);
                  try {
                    await onArchive();
                  } finally {
                    setArchiving(false);
                  }
                }}
                disabled={archiving}
                className="px-4 py-2 text-orange-600 hover:bg-orange-50 rounded-lg disabled:opacity-50"
              >
                {archiving ? '⏳ Archiviere...' : '📦 Archivieren'}
              </button>
            ) : (
              <div></div>
            )}
            <div className="flex gap-3">
              <button
                type="button"
                onClick={onCancel}
                className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50"
              >
                Abbrechen
              </button>
              <button
                type="submit"
                disabled={saving}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
              >
                {saving ? 'Speichern...' : (opportunity ? 'Speichern' : 'Opportunity erstellen')}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
