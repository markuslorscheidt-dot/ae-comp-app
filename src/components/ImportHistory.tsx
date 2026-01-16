'use client';

import { useState } from 'react';
import { ImportBatch, ImportBatchStatus } from '@/lib/pipeline-types';
import { rollbackImportBatch } from '@/lib/import-hooks';

interface ImportHistoryProps {
  batches: ImportBatch[];
  userId: string;
  onRollbackSuccess: () => void;
}

export default function ImportHistory({ batches, userId, onRollbackSuccess }: ImportHistoryProps) {
  const [rollingBack, setRollingBack] = useState<string | null>(null);
  const [showRollbackDialog, setShowRollbackDialog] = useState<ImportBatch | null>(null);
  const [rollbackConfirmText, setRollbackConfirmText] = useState('');
  const [error, setError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');

  // Status Badge Render
  const renderStatusBadge = (status: ImportBatchStatus) => {
    const styles: Record<ImportBatchStatus, { bg: string; text: string; label: string; icon: string }> = {
      open: { bg: 'bg-orange-100', text: 'text-orange-700', label: 'Offen', icon: '⏳' },
      completed: { bg: 'bg-green-100', text: 'text-green-700', label: 'Übernommen', icon: '✅' },
      discarded: { bg: 'bg-gray-100', text: 'text-gray-500', label: 'Verworfen', icon: '🗑️' },
      rolled_back: { bg: 'bg-red-100', text: 'text-red-700', label: 'Zurückgerollt', icon: '↩️' },
    };
    const style = styles[status];
    return (
      <span className={`inline-flex items-center gap-1 px-2 py-1 rounded text-sm font-medium ${style.bg} ${style.text}`}>
        {style.icon} {style.label}
      </span>
    );
  };

  // Rollback Handler
  const handleRollback = async () => {
    if (!showRollbackDialog) return;
    if (rollbackConfirmText !== 'ROLLBACK') return;

    setError('');
    setRollingBack(showRollbackDialog.id);

    const result = await rollbackImportBatch(showRollbackDialog.id, userId);

    if (result.error) {
      setError(result.error);
    } else {
      setSuccessMessage(
        `Rollback erfolgreich: ${result.stats.leads} Leads, ${result.stats.opportunities} Opportunities gelöscht. ` +
        `${result.stats.golives} Go-Lives wurden entkoppelt (nicht gelöscht).`
      );
      onRollbackSuccess();
    }

    setRollingBack(null);
    setShowRollbackDialog(null);
    setRollbackConfirmText('');
  };

  // Filtern: Nur completed und rolled_back anzeigen (open hat eigenen Tab)
  const historyBatches = batches.filter(b => b.status !== 'open');

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-medium text-gray-800">📚 Import-Historie</h3>
        <span className="text-sm text-gray-500">{historyBatches.length} Einträge</span>
      </div>

      {/* Success Message */}
      {successMessage && (
        <div className="p-4 bg-green-50 border border-green-200 text-green-700 rounded-lg flex items-center justify-between">
          <span>{successMessage}</span>
          <button onClick={() => setSuccessMessage('')} className="text-green-600 hover:text-green-800">✕</button>
        </div>
      )}

      {/* Error Message */}
      {error && (
        <div className="p-4 bg-red-50 border border-red-200 text-red-700 rounded-lg flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => setError('')} className="text-red-600 hover:text-red-800">✕</button>
        </div>
      )}

      {/* Info Box */}
      <div className="bg-blue-50 rounded-lg p-4">
        <h4 className="font-medium text-blue-800 mb-2">💡 Über Rollback</h4>
        <p className="text-sm text-blue-700">
          Mit Rollback kannst du einen kompletten Import rückgängig machen. 
          Alle Leads und Opportunities aus diesem Import werden gelöscht. 
          <strong> Go-Lives bleiben erhalten</strong> - nur die Verknüpfung wird entfernt.
        </p>
      </div>

      {/* History Table */}
      {historyBatches.length === 0 ? (
        <div className="text-center py-12 text-gray-400">
          <div className="text-4xl mb-2">📭</div>
          <p>Noch keine Import-Historie vorhanden</p>
        </div>
      ) : (
        <div className="border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-gray-600 font-medium">Datum</th>
                <th className="px-4 py-3 text-left text-gray-600 font-medium">Datei</th>
                <th className="px-4 py-3 text-left text-gray-600 font-medium">Status</th>
                <th className="px-4 py-3 text-left text-gray-600 font-medium">Statistik</th>
                <th className="px-4 py-3 text-left text-gray-600 font-medium">Erstellt von</th>
                <th className="px-4 py-3 text-right text-gray-600 font-medium">Aktionen</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {historyBatches.map((batch) => (
                <tr key={batch.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <div className="font-medium text-gray-800">
                      {new Date(batch.created_at).toLocaleDateString('de-DE')}
                    </div>
                    <div className="text-xs text-gray-500">
                      {new Date(batch.created_at).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="text-gray-700 truncate max-w-48" title={batch.source_filename}>
                      {batch.source_filename}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    {renderStatusBadge(batch.status)}
                    {batch.status === 'rolled_back' && batch.rolled_back_at && (
                      <div className="text-xs text-gray-500 mt-1">
                        am {new Date(batch.rolled_back_at).toLocaleDateString('de-DE')}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="text-xs space-y-0.5">
                      <div><span className="text-green-600">{batch.stats_new}</span> neu</div>
                      <div><span className="text-blue-600">{batch.stats_updated}</span> aktualisiert</div>
                      <div><span className="text-gray-400">{batch.stats_skipped}</span> übersprungen</div>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-gray-600">
                    {batch.created_by_user?.name || '-'}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {batch.status === 'completed' && (
                      <button
                        onClick={() => setShowRollbackDialog(batch)}
                        disabled={rollingBack === batch.id}
                        className="px-3 py-1.5 text-red-600 border border-red-300 rounded hover:bg-red-50 disabled:opacity-50"
                      >
                        {rollingBack === batch.id ? '...' : '↩️ Rollback'}
                      </button>
                    )}
                    {batch.status === 'discarded' && (
                      <span className="text-gray-400 text-sm">-</span>
                    )}
                    {batch.status === 'rolled_back' && (
                      <span className="text-gray-400 text-sm">
                        von {batch.rolled_back_by_user?.name || '-'}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Rollback Confirmation Dialog */}
      {showRollbackDialog && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full">
            <div className="p-6 border-b">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 bg-red-100 rounded-full flex items-center justify-center text-2xl">
                  🔴
                </div>
                <div>
                  <h3 className="text-lg font-bold text-gray-800">Rollback bestätigen</h3>
                  <p className="text-sm text-gray-500">Diese Aktion kann nicht rückgängig gemacht werden</p>
                </div>
              </div>
            </div>

            <div className="p-6 space-y-4">
              <div className="bg-gray-50 rounded-lg p-4">
                <div className="text-sm text-gray-600 space-y-1">
                  <div><strong>Stapel vom:</strong> {new Date(showRollbackDialog.created_at).toLocaleDateString('de-DE')}</div>
                  <div><strong>Datei:</strong> {showRollbackDialog.source_filename}</div>
                </div>
              </div>

              <div className="bg-red-50 rounded-lg p-4">
                <h4 className="font-medium text-red-800 mb-2">⚠️ Folgende Daten werden GELÖSCHT:</h4>
                <ul className="text-sm text-red-700 space-y-1">
                  <li>• {showRollbackDialog.stats_new} Leads</li>
                  <li>• {showRollbackDialog.stats_new + showRollbackDialog.stats_updated} Opportunities</li>
                </ul>
                <p className="text-sm text-red-600 mt-3">
                  <strong>Go-Lives bleiben erhalten</strong> - nur die Verknüpfung wird entfernt.
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Zur Bestätigung <strong>ROLLBACK</strong> eingeben:
                </label>
                <input
                  type="text"
                  value={rollbackConfirmText}
                  onChange={(e) => setRollbackConfirmText(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-red-500"
                  placeholder="ROLLBACK"
                />
              </div>
            </div>

            <div className="p-6 border-t flex justify-end gap-3">
              <button
                onClick={() => {
                  setShowRollbackDialog(null);
                  setRollbackConfirmText('');
                }}
                className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg"
              >
                Abbrechen
              </button>
              <button
                onClick={handleRollback}
                disabled={rollbackConfirmText !== 'ROLLBACK' || rollingBack !== null}
                className="px-4 py-2 bg-red-600 text-white rounded-lg font-medium hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Rollback durchführen
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
