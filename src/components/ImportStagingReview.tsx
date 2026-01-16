'use client';

import { useState } from 'react';
import { User } from '@/lib/types';
import { useImportStaging, commitImportBatch } from '@/lib/import-hooks';
import { ImportBatch, ImportStagingRow, ImportMatchStatus, OPPORTUNITY_STAGES } from '@/lib/pipeline-types';

interface ImportStagingReviewProps {
  batch: ImportBatch;
  allUsers: User[];
  userId: string;
  onDiscard: () => void;
  onCommitSuccess: () => void;
}

export default function ImportStagingReview({ 
  batch, 
  allUsers, 
  userId,
  onDiscard, 
  onCommitSuccess 
}: ImportStagingReviewProps) {
  const [filter, setFilter] = useState<ImportMatchStatus | 'all' | 'selected'>('all');
  const [committing, setCommitting] = useState(false);
  const [error, setError] = useState('');
  const [showUserDialog, setShowUserDialog] = useState<ImportStagingRow | null>(null);
  const [showBulkAssignDialog, setShowBulkAssignDialog] = useState(false);

  const { 
    rows, 
    loading, 
    stats, 
    toggleSelection, 
    selectAll,
    assignUser,
    bulkAssignByOwnerName,
    bulkAssignAllConflicts,
    conflictOwners,
    refetch,
  } = useImportStaging(batch.id);

  // Gefilterte Rows
  const filteredRows = rows.filter(row => {
    if (filter === 'all') return true;
    if (filter === 'selected') return row.is_selected;
    return row.match_status === filter;
  });

  // Progress State mit Zeitschätzung
  const [progress, setProgress] = useState({ current: 0, total: 0, startTime: 0 });

  // Zeitschätzung berechnen
  const getTimeEstimate = () => {
    if (progress.current === 0 || progress.startTime === 0) return null;
    const elapsed = Date.now() - progress.startTime;
    const avgPerItem = elapsed / progress.current;
    const remaining = (progress.total - progress.current) * avgPerItem;
    
    if (remaining < 1000) return 'Gleich fertig...';
    if (remaining < 60000) return `~${Math.ceil(remaining / 1000)} Sekunden`;
    return `~${Math.ceil(remaining / 60000)} Minuten`;
  };

  // Commit Handler mit Progress
  const handleCommit = async () => {
    setError('');
    setCommitting(true);
    const startTime = Date.now();
    setProgress({ current: 0, total: stats.selected, startTime });

    const result = await commitImportBatch(batch.id, userId, (current, total) => {
      setProgress(prev => ({ current, total, startTime: prev.startTime }));
    });

    if (result.error) {
      setError(result.error);
      setCommitting(false);
      setProgress({ current: 0, total: 0, startTime: 0 });
    } else {
      onCommitSuccess();
    }
  };

  // Status Badge Render
  const renderStatusBadge = (status: ImportMatchStatus) => {
    const styles: Record<ImportMatchStatus, { bg: string; text: string; label: string }> = {
      new: { bg: 'bg-green-100', text: 'text-green-700', label: 'Neu' },
      changed: { bg: 'bg-blue-100', text: 'text-blue-700', label: 'Änderung' },
      unchanged: { bg: 'bg-gray-100', text: 'text-gray-500', label: 'Unverändert' },
      conflict: { bg: 'bg-red-100', text: 'text-red-700', label: 'Konflikt' },
      pending: { bg: 'bg-yellow-100', text: 'text-yellow-700', label: 'Prüfung' },
    };
    const style = styles[status];
    return (
      <span className={`px-2 py-0.5 rounded text-xs font-medium ${style.bg} ${style.text}`}>
        {style.label}
      </span>
    );
  };

  // Stage Badge Render
  const renderStageBadge = (stage: string | null) => {
    if (!stage) return '-';
    const config = OPPORTUNITY_STAGES[stage as keyof typeof OPPORTUNITY_STAGES];
    if (!config) return stage;
    return (
      <span className={`px-2 py-0.5 rounded text-xs font-medium ${config.bgColor} ${config.color}`}>
        {config.icon} {config.label}
      </span>
    );
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Batch Info */}
      <div className="bg-gray-50 rounded-lg p-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-medium text-gray-800">
              📦 Stapel vom {new Date(batch.created_at).toLocaleDateString('de-DE', { 
                day: '2-digit', 
                month: '2-digit', 
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
              })}
            </h3>
            <p className="text-sm text-gray-500">{batch.source_filename}</p>
          </div>
          <div className="text-right">
            <div className="text-sm text-gray-500">Gesamt: {stats.total} Datensätze</div>
          </div>
        </div>
      </div>

      {/* Stats Overview */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <button
          onClick={() => setFilter('new')}
          className={`p-3 rounded-lg text-center transition ${
            filter === 'new' ? 'ring-2 ring-green-500' : ''
          } bg-green-50`}
        >
          <div className="text-2xl font-bold text-green-600">{stats.new}</div>
          <div className="text-xs text-green-700">Neue</div>
        </button>
        <button
          onClick={() => setFilter('changed')}
          className={`p-3 rounded-lg text-center transition ${
            filter === 'changed' ? 'ring-2 ring-blue-500' : ''
          } bg-blue-50`}
        >
          <div className="text-2xl font-bold text-blue-600">{stats.changed}</div>
          <div className="text-xs text-blue-700">Änderungen</div>
        </button>
        <button
          onClick={() => setFilter('conflict')}
          className={`p-3 rounded-lg text-center transition ${
            filter === 'conflict' ? 'ring-2 ring-red-500' : ''
          } bg-red-50`}
        >
          <div className="text-2xl font-bold text-red-600">{stats.conflict}</div>
          <div className="text-xs text-red-700">Konflikte</div>
        </button>
        <button
          onClick={() => setFilter('unchanged')}
          className={`p-3 rounded-lg text-center transition ${
            filter === 'unchanged' ? 'ring-2 ring-gray-400' : ''
          } bg-gray-100`}
        >
          <div className="text-2xl font-bold text-gray-500">{stats.unchanged}</div>
          <div className="text-xs text-gray-600">Unverändert</div>
        </button>
        <button
          onClick={() => setFilter('selected')}
          className={`p-3 rounded-lg text-center transition ${
            filter === 'selected' ? 'ring-2 ring-purple-500' : ''
          } bg-purple-50`}
        >
          <div className="text-2xl font-bold text-purple-600">{stats.selected}</div>
          <div className="text-xs text-purple-700">Ausgewählt</div>
        </button>
      </div>

      {/* Error Message */}
      {error && (
        <div className="p-4 bg-red-50 border border-red-200 text-red-700 rounded-lg">
          {error}
        </div>
      )}

      {/* Conflict Warning */}
      {stats.conflict > 0 && (
        <div className="p-4 bg-orange-50 border border-orange-200 rounded-lg">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-xl">⚠️</span>
              <div>
                <span className="font-medium text-orange-800">
                  {stats.conflict} Datensätze haben Konflikte
                </span>
                <span className="text-orange-700 text-sm ml-2">
                  (User nicht gefunden - bitte manuell zuweisen oder in Salesforce ändern)
                </span>
              </div>
            </div>
            <button
              onClick={() => setShowBulkAssignDialog(true)}
              className="px-4 py-2 bg-orange-600 text-white rounded-lg text-sm font-medium hover:bg-orange-700"
            >
              🔧 Bulk-Zuweisung
            </button>
          </div>
        </div>
      )}

      {/* Info: Closed Stages ohne User werden automatisch importiert */}
      {rows.some(r => 
        (r.parsed_stage === 'close_won' || r.parsed_stage === 'close_lost') && 
        !r.matched_user_id && 
        r.match_status === 'new'
      ) && (
        <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
          <div className="flex items-center gap-2">
            <span className="text-xl">ℹ️</span>
            <div>
              <span className="font-medium text-blue-800">
                Closed Won/Lost mit Ex-Mitarbeiter
              </span>
              <span className="text-blue-700 text-sm ml-2">
                werden automatisch importiert. Der SF-Owner Name wird als Notiz gespeichert.
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Bulk Actions */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button
            onClick={() => selectAll(true)}
            className="px-3 py-1.5 text-sm border border-gray-300 rounded hover:bg-gray-50"
          >
            Alle auswählen
          </button>
          <button
            onClick={() => selectAll(false)}
            className="px-3 py-1.5 text-sm border border-gray-300 rounded hover:bg-gray-50"
          >
            Alle abwählen
          </button>
          <span className="text-gray-400">|</span>
          <button
            onClick={() => selectAll(true, 'new')}
            className="px-3 py-1.5 text-sm text-green-600 border border-green-300 rounded hover:bg-green-50"
          >
            Neue auswählen
          </button>
          <button
            onClick={() => selectAll(true, 'changed')}
            className="px-3 py-1.5 text-sm text-blue-600 border border-blue-300 rounded hover:bg-blue-50"
          >
            Änderungen auswählen
          </button>
        </div>
        <button
          onClick={() => setFilter('all')}
          className={`px-3 py-1.5 text-sm rounded ${
            filter === 'all' ? 'bg-gray-200' : 'hover:bg-gray-100'
          }`}
        >
          Filter zurücksetzen
        </button>
      </div>

      {/* Data Table */}
      <div className="border rounded-lg overflow-hidden">
        <div className="overflow-x-auto max-h-96">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 sticky top-0">
              <tr>
                <th className="w-10 px-3 py-3 text-left">
                  <input
                    type="checkbox"
                    checked={filteredRows.length > 0 && filteredRows.every(r => r.is_selected)}
                    onChange={(e) => {
                      filteredRows.forEach(r => toggleSelection(r.id, e.target.checked));
                    }}
                    className="rounded"
                  />
                </th>
                <th className="px-3 py-3 text-left text-gray-600 font-medium">Status</th>
                <th className="px-3 py-3 text-left text-gray-600 font-medium">Unternehmen</th>
                <th className="px-3 py-3 text-left text-gray-600 font-medium">Stage</th>
                <th className="px-3 py-3 text-left text-gray-600 font-medium">Owner</th>
                <th className="px-3 py-3 text-left text-gray-600 font-medium">Änderungen</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {filteredRows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-3 py-8 text-center text-gray-400">
                    Keine Datensätze in diesem Filter
                  </td>
                </tr>
              ) : (
                filteredRows.map((row) => (
                  <tr 
                    key={row.id} 
                    className={`hover:bg-gray-50 ${
                      row.match_status === 'conflict' ? 'bg-red-50' : ''
                    } ${row.match_status === 'unchanged' ? 'opacity-50' : ''}`}
                  >
                    <td className="px-3 py-3">
                      <input
                        type="checkbox"
                        checked={row.is_selected}
                        onChange={(e) => toggleSelection(row.id, e.target.checked)}
                        className="rounded"
                        disabled={row.match_status === 'unchanged'}
                      />
                    </td>
                    <td className="px-3 py-3">
                      {renderStatusBadge(row.match_status)}
                    </td>
                    <td className="px-3 py-3">
                      <div className="font-medium text-gray-800">{row.parsed_company_name}</div>
                      {row.sfid && (
                        <div className="text-xs text-gray-400">SFID: {row.sfid.substring(0, 15)}...</div>
                      )}
                    </td>
                    <td className="px-3 py-3">
                      {renderStageBadge(row.parsed_stage)}
                    </td>
                    <td className="px-3 py-3">
                      {row.user_match_status === 'matched' || row.user_match_status === 'manual' ? (
                        <span className="text-green-600">
                          ✓ {row.matched_user?.name || row.parsed_owner_name}
                        </span>
                      ) : (row.parsed_stage === 'close_won' || row.parsed_stage === 'close_lost') ? (
                        // Closed Stages ohne User: Automatisch importieren
                        <div className="flex items-center gap-1">
                          <span className="text-blue-600" title="Wird automatisch importiert">📋</span>
                          <span className="text-gray-600 italic">{row.parsed_owner_name}</span>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2">
                          <span className="text-red-600">✗ {row.parsed_owner_name}</span>
                          <button
                            onClick={() => setShowUserDialog(row)}
                            className="text-xs px-2 py-1 bg-blue-100 text-blue-700 rounded hover:bg-blue-200"
                          >
                            Zuweisen
                          </button>
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-3">
                      {row.changes ? (
                        <div className="space-y-1">
                          {Object.entries(row.changes).map(([key, change]) => (
                            <div key={key} className="text-xs">
                              <span className="text-gray-500">{key}:</span>{' '}
                              <span className="text-red-500 line-through">{change.from}</span>{' '}
                              <span className="text-green-600">→ {change.to}</span>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <span className="text-gray-400">-</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center justify-between pt-4 border-t">
        <button
          onClick={onDiscard}
          disabled={committing}
          className="px-4 py-2 text-red-600 hover:bg-red-50 rounded-lg disabled:opacity-50"
        >
          🗑️ Stapel verwerfen
        </button>
        <div className="flex items-center gap-4">
          {committing ? (
            /* Progress Bar während Import */
            <div className="flex items-center gap-4 min-w-[400px] bg-blue-50 p-4 rounded-lg border border-blue-200">
              <div className="animate-spin rounded-full h-8 w-8 border-4 border-blue-200 border-t-blue-600"></div>
              <div className="flex-1">
                <div className="flex justify-between text-sm font-medium text-blue-800 mb-2">
                  <span>📥 Importiere Datensätze...</span>
                  <span>{progress.current} / {progress.total}</span>
                </div>
                <div className="h-4 bg-blue-200 rounded-full overflow-hidden">
                  <div 
                    className="h-full bg-gradient-to-r from-blue-500 to-green-500 transition-all duration-300 ease-out"
                    style={{ width: `${progress.total > 0 ? (progress.current / progress.total) * 100 : 0}%` }}
                  />
                </div>
                <div className="flex justify-between text-xs text-blue-600 mt-2">
                  <span>{progress.total > 0 ? Math.round((progress.current / progress.total) * 100) : 0}% abgeschlossen</span>
                  <span>{getTimeEstimate() || 'Berechne...'}</span>
                </div>
              </div>
            </div>
          ) : (
            <>
              <span className="text-gray-500">
                {stats.selected} von {stats.total - stats.unchanged} Datensätze ausgewählt
              </span>
              <button
                onClick={handleCommit}
                disabled={stats.selected === 0}
                className="px-6 py-2 bg-green-600 text-white rounded-lg font-medium hover:bg-green-700 disabled:opacity-50"
              >
                ✓ {stats.selected} Datensätze übernehmen
              </button>
            </>
          )}
        </div>
      </div>

      {/* User Assignment Dialog */}
      {showUserDialog && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl p-6 max-w-md w-full">
            <h3 className="text-lg font-bold text-gray-800 mb-4">User zuweisen</h3>
            <p className="text-sm text-gray-600 mb-4">
              Salesforce-Owner: <strong>{showUserDialog.parsed_owner_name}</strong>
            </p>
            <select
              className="w-full px-3 py-2 border rounded-lg mb-4"
              onChange={(e) => {
                if (e.target.value) {
                  assignUser(showUserDialog.id, e.target.value);
                  setShowUserDialog(null);
                }
              }}
              defaultValue=""
            >
              <option value="">-- User auswählen --</option>
              {allUsers.map((u) => (
                <option key={u.id} value={u.id}>{u.name}</option>
              ))}
            </select>
            <div className="flex justify-end">
              <button
                onClick={() => setShowUserDialog(null)}
                className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg"
              >
                Abbrechen
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bulk Assign Dialog */}
      {showBulkAssignDialog && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl p-6 max-w-lg w-full max-h-[80vh] overflow-y-auto">
            <h3 className="text-lg font-bold text-gray-800 mb-4">🔧 Bulk-Zuweisung</h3>
            
            <p className="text-sm text-gray-600 mb-4">
              Weise alle Konflikte eines Salesforce-Owners auf einmal einem App-User zu.
            </p>

            {conflictOwners.length === 0 ? (
              <p className="text-gray-500 text-center py-4">Keine Konflikte vorhanden</p>
            ) : (
              <div className="space-y-3">
                {conflictOwners.map((ownerName) => {
                  const count = rows.filter(r => r.match_status === 'conflict' && r.parsed_owner_name === ownerName).length;
                  return (
                    <div key={ownerName} className="p-3 bg-gray-50 rounded-lg">
                      <div className="flex items-center justify-between mb-2">
                        <div>
                          <span className="font-medium text-gray-800">{ownerName}</span>
                          <span className="text-sm text-gray-500 ml-2">({count} Datensätze)</span>
                        </div>
                      </div>
                      <select
                        className="w-full px-3 py-2 border rounded-lg text-sm"
                        onChange={(e) => {
                          if (e.target.value) {
                            bulkAssignByOwnerName(ownerName, e.target.value);
                          }
                        }}
                        defaultValue=""
                      >
                        <option value="">-- User zuweisen --</option>
                        {allUsers.map((u) => (
                          <option key={u.id} value={u.id}>{u.name}</option>
                        ))}
                      </select>
                    </div>
                  );
                })}
              </div>
            )}

            <div className="mt-6 pt-4 border-t">
              <p className="text-sm text-gray-500 mb-3">Oder alle Konflikte auf einmal zuweisen:</p>
              <div className="flex gap-2">
                <select
                  id="bulk-all-select"
                  className="flex-1 px-3 py-2 border rounded-lg"
                  defaultValue=""
                >
                  <option value="">-- User für ALLE Konflikte --</option>
                  {allUsers.map((u) => (
                    <option key={u.id} value={u.id}>{u.name}</option>
                  ))}
                </select>
                <button
                  onClick={() => {
                    const select = document.getElementById('bulk-all-select') as HTMLSelectElement;
                    if (select.value) {
                      bulkAssignAllConflicts(select.value);
                    }
                  }}
                  className="px-4 py-2 bg-orange-600 text-white rounded-lg text-sm font-medium hover:bg-orange-700"
                >
                  Alle zuweisen
                </button>
              </div>
            </div>

            <div className="flex justify-end mt-6">
              <button
                onClick={() => setShowBulkAssignDialog(false)}
                className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200"
              >
                Schließen
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
