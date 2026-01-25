'use client';

import { useState } from 'react';
import { 
  Opportunity, 
  LostReason,
  PipelineSettings,
  OpportunityStage,
  OPPORTUNITY_STAGES,
  calculateExpectedCloseDate,
  getDefaultProbability,
  formatDate,
} from '@/lib/pipeline-types';
import { useLanguage } from '@/lib/LanguageContext';

interface StageChangeDialogProps {
  opportunity: Opportunity;
  lostReasons: LostReason[];
  settings: PipelineSettings | null;
  userRole: string;
  onConfirm: (newStage: OpportunityStage, lostReasonId?: string, lostReasonNotes?: string) => Promise<void>;
  onCancel: () => void;
}

const STAGE_ORDER: OpportunityStage[] = [
  'sql',
  'demo_booked',
  'demo_completed',
  'sent_quote',
  'close_won',
  'close_lost',
  'nurture',
];

export default function StageChangeDialog({ 
  opportunity, 
  lostReasons,
  settings,
  userRole,
  onConfirm, 
  onCancel 
}: StageChangeDialogProps) {
  const { t } = useLanguage();
  const [selectedStage, setSelectedStage] = useState<OpportunityStage>(opportunity.stage as OpportunityStage);
  const [lostReasonId, setLostReasonId] = useState('');
  const [lostReasonNotes, setLostReasonNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [showManualOverride, setShowManualOverride] = useState(false);

  // Manager können Stage manuell ändern
  const canManuallyChangeStage = userRole === 'line_manager' || userRole === 'country_manager';
  
  // Salesforce Link
  const sfLink = opportunity.sfid 
    ? `https://phorestcrm.lightning.force.com/lightning/r/Opportunity/${opportunity.sfid}/view`
    : null;

  const currentStageConfig = OPPORTUNITY_STAGES[opportunity.stage as OpportunityStage];
  const newStageConfig = OPPORTUNITY_STAGES[selectedStage];
  
  const newCloseDate = calculateExpectedCloseDate(selectedStage, settings || undefined);
  const newProbability = getDefaultProbability(selectedStage, settings || undefined);

  const handleConfirm = async () => {
    if (selectedStage === 'close_lost' && !lostReasonId) {
      alert('Bitte wähle einen Grund für den Verlust');
      return;
    }

    setSaving(true);
    try {
      await onConfirm(
        selectedStage,
        selectedStage === 'close_lost' ? lostReasonId : undefined,
        selectedStage === 'close_lost' ? lostReasonNotes : undefined
      );
    } finally {
      setSaving(false);
    }
  };

  const isGoLiveStage = selectedStage === 'close_won';
  const isLostStage = selectedStage === 'close_lost';

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl max-w-md w-full max-h-[90vh] overflow-y-auto">
        <div className="p-6 border-b">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-bold text-gray-800">Stage ändern</h2>
            <button
              onClick={onCancel}
              className="p-2 text-gray-400 hover:bg-gray-100 rounded-lg"
            >
              ✕
            </button>
          </div>
          <p className="text-sm text-gray-500 mt-1">{opportunity.name}</p>
        </div>

        <div className="p-6 space-y-4">
          {/* Current Stage */}
          <div className="text-sm text-gray-500">
            Aktuell: <span className={`inline-flex items-center px-2 py-0.5 rounded ${currentStageConfig.bgColor} ${currentStageConfig.color}`}>
              {currentStageConfig.icon} {currentStageConfig.label}
            </span>
          </div>

          {/* Salesforce Info Box */}
          <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
            <div className="flex items-start gap-3">
              <span className="text-2xl">ℹ️</span>
              <div className="flex-1">
                <p className="text-sm text-blue-800 font-medium mb-2">
                  Stage wird über Salesforce Import aktualisiert
                </p>
                <p className="text-xs text-blue-600 mb-3">
                  Für konsistente Daten bitte den Stage in Salesforce ändern und anschließend einen CSV-Import durchführen.
                </p>
                {sfLink ? (
                  <a
                    href={sfLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 px-3 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700"
                  >
                    ☁️ In Salesforce öffnen
                  </a>
                ) : (
                  <p className="text-xs text-blue-500 italic">
                    Kein Salesforce-Link verfügbar (manuell erstellte Opportunity)
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* Manager Override Section */}
          {canManuallyChangeStage && (
            <div className="border-t pt-4">
              {!showManualOverride ? (
                <button
                  onClick={() => setShowManualOverride(true)}
                  className="w-full px-4 py-2 text-sm text-orange-600 border border-orange-300 rounded-lg hover:bg-orange-50"
                >
                  🔓 Stage manuell überschreiben (nur Manager)
                </button>
              ) : (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-orange-700">Manuelles Override (Manager)</span>
                    <button
                      onClick={() => {
                        setShowManualOverride(false);
                        setSelectedStage(opportunity.stage as OpportunityStage);
                      }}
                      className="text-xs text-gray-500 hover:text-gray-700"
                    >
                      {t('common.cancel')}
                    </button>
                  </div>
                  
                  {/* Stage Selection */}
                  <div>
                    <label className="block text-sm font-medium text-gray-600 mb-2">
                      Neue Stage
                    </label>
                    <div className="space-y-2">
                      {STAGE_ORDER.map(stage => {
                        const config = OPPORTUNITY_STAGES[stage];
                        const isCurrentStage = stage === opportunity.stage;
                        
                        return (
                          <label
                            key={stage}
                            className={`flex items-center p-3 border rounded-lg cursor-pointer transition ${
                              selectedStage === stage
                                ? `border-2 ${config.bgColor} ${config.color}`
                                : isCurrentStage
                                ? 'border-gray-300 bg-gray-50 opacity-50'
                                : 'border-gray-200 hover:border-gray-300'
                            }`}
                          >
                            <input
                              type="radio"
                              name="stage"
                              value={stage}
                              checked={selectedStage === stage}
                              onChange={() => setSelectedStage(stage)}
                              disabled={isCurrentStage}
                              className="sr-only"
                            />
                            <span className="mr-3 text-lg">{config.icon}</span>
                            <div className="flex-1">
                              <div className="font-medium">{config.label}</div>
                              <div className="text-xs opacity-75">
                                {stage === 'close_won' && 'Deal gewonnen → Go-Live erstellen'}
                                {stage === 'close_lost' && 'Deal verloren'}
                                {stage === 'nurture' && t('pipeline.nurture')}
                                {!['close_won', 'close_lost', 'nurture'].includes(stage) && 
                                  `${Math.round(config.defaultProbability * 100)}% Probability`
                                }
                              </div>
                            </div>
                            {isCurrentStage && (
                              <span className="text-xs text-gray-400">Aktuell</span>
                            )}
                          </label>
                        );
                      })}
                    </div>
                  </div>

                  {/* Lost Reason (if Close Lost selected) */}
                  {isLostStage && (
                    <div className="space-y-3 p-4 bg-red-50 rounded-lg">
                      <div>
                        <label className="block text-sm font-medium text-red-800 mb-2">
                          Grund für Verlust *
                        </label>
                        <select
                          value={lostReasonId}
                          onChange={(e) => setLostReasonId(e.target.value)}
                          className="w-full px-3 py-2 border border-red-300 rounded-lg focus:ring-2 focus:ring-red-500 bg-white"
                          required
                        >
                          <option value="">-- Grund auswählen --</option>
                          {lostReasons.map(reason => (
                            <option key={reason.id} value={reason.id}>{reason.reason}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-red-800 mb-2">
                          Details (optional)
                        </label>
                        <textarea
                          value={lostReasonNotes}
                          onChange={(e) => setLostReasonNotes(e.target.value)}
                          className="w-full px-3 py-2 border border-red-300 rounded-lg focus:ring-2 focus:ring-red-500"
                          rows={2}
                          placeholder="Weitere Details zum Verlust..."
                        />
                      </div>
                    </div>
                  )}

                  {/* Go-Live Info (if Close Won selected) */}
                  {isGoLiveStage && (
                    <div className="p-4 bg-green-50 rounded-lg">
                      <div className="flex items-center gap-2 text-green-800 font-medium mb-2">
                        🎉 Go-Live erstellen
                      </div>
                      <p className="text-sm text-green-700">
                        Nach dem Stage-Wechsel zu "Close Won" kannst du einen Go-Live Eintrag erstellen, 
                        um den Abschluss zu dokumentieren und die Provision zu berechnen.
                      </p>
                    </div>
                  )}

                  {/* Preview */}
                  {selectedStage !== opportunity.stage && !isLostStage && !isGoLiveStage && (
                    <div className="p-4 bg-blue-50 rounded-lg">
                      <h4 className="text-sm font-medium text-blue-800 mb-2">Vorschau nach Stage-Wechsel:</h4>
                      <div className="text-sm text-blue-700 space-y-1">
                        <div>Probability: <strong>{Math.round(newProbability * 100)}%</strong></div>
                        <div>Expected Close: <strong>{formatDate(newCloseDate.toISOString())}</strong></div>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Info for non-managers */}
          {!canManuallyChangeStage && (
            <p className="text-xs text-gray-400 text-center">
              Nur Manager können den Stage manuell ändern.
            </p>
          )}
        </div>

        {/* Actions */}
        <div className="p-6 border-t flex justify-end gap-3">
          <button
            onClick={onCancel}
            className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50"
          >
            {showManualOverride ? t('common.cancel') : t('common.close')}
          </button>
          {showManualOverride && canManuallyChangeStage && (
            <button
              onClick={handleConfirm}
              disabled={saving || selectedStage === opportunity.stage}
              className={`px-4 py-2 rounded-lg font-medium disabled:opacity-50 ${
                isLostStage 
                  ? 'bg-red-600 text-white hover:bg-red-700'
                  : isGoLiveStage
                  ? 'bg-green-600 text-white hover:bg-green-700'
                  : 'bg-orange-600 text-white hover:bg-orange-700'
              }`}
            >
              {saving ? t('common.saving') : t('pipeline.changeStage')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
