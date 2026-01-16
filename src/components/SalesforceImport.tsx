'use client';

import { useState, useRef } from 'react';
import { User } from '@/lib/types';
import { 
  useOpenBatch, 
  useImportBatches, 
  createImportBatch,
  discardImportBatch,
} from '@/lib/import-hooks';
import { ImportBatch } from '@/lib/pipeline-types';
import ImportStagingReview from './ImportStagingReview';
import ImportHistory from './ImportHistory';

interface SalesforceImportProps {
  user: User;
  allUsers: User[];
  onClose: () => void;
}

type ImportView = 'upload' | 'review' | 'history';

export default function SalesforceImport({ user, allUsers, onClose }: SalesforceImportProps) {
  const [view, setView] = useState<ImportView>('upload');
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [currentBatch, setCurrentBatch] = useState<ImportBatch | null>(null);
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const { openBatch, loading: openBatchLoading, refetch: refetchOpenBatch } = useOpenBatch();
  const { batches, refetch: refetchBatches } = useImportBatches();

  // Wenn offener Batch existiert, direkt zum Review
  const handleCheckOpenBatch = () => {
    if (openBatch) {
      setCurrentBatch(openBatch);
      setView('review');
    }
  };

  // File Upload Handler
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setError('');
    setUploading(true);

    try {
      // Salesforce exportiert als ISO-8859-1 (Latin-1), nicht UTF-8
      // Wir versuchen erst ISO-8859-1, dann UTF-8 als Fallback
      let text: string;
      
      try {
        // Versuche ISO-8859-1 (für Salesforce CSVs mit Umlauten)
        const buffer = await file.arrayBuffer();
        const decoder = new TextDecoder('iso-8859-1');
        text = decoder.decode(buffer);
      } catch {
        // Fallback zu UTF-8
        text = await file.text();
      }
      
      const result = await createImportBatch(text, file.name, user.id, allUsers);
      
      if (result.error) {
        setError(result.error);
      } else if (result.batch) {
        setCurrentBatch(result.batch);
        setView('review');
        refetchOpenBatch();
      }
    } catch (err: any) {
      setError(err.message || 'Fehler beim Verarbeiten der Datei');
    } finally {
      setUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  // Batch verwerfen
  const handleDiscard = async () => {
    if (!currentBatch) return;
    
    if (!confirm('Stapel wirklich verwerfen? Alle Staging-Daten werden gelöscht.')) return;
    
    await discardImportBatch(currentBatch.id);
    setCurrentBatch(null);
    setView('upload');
    refetchOpenBatch();
    refetchBatches();
  };

  // Nach erfolgreichem Commit
  const handleCommitSuccess = () => {
    setCurrentBatch(null);
    setView('upload');
    refetchOpenBatch();
    refetchBatches();
  };

  // Nach Rollback
  const handleRollbackSuccess = () => {
    refetchBatches();
  };

  if (openBatchLoading) {
    return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
        <div className="bg-white rounded-xl p-8">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-6xl max-h-[95vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="p-6 border-b flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-blue-100 rounded-full flex items-center justify-center text-2xl">
              📥
            </div>
            <div>
              <h2 className="text-xl font-bold text-gray-800">Salesforce Import</h2>
              <p className="text-sm text-gray-500">
                {view === 'upload' && 'CSV-Datei hochladen'}
                {view === 'review' && 'Staging-Stapel prüfen'}
                {view === 'history' && 'Import-Historie'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {/* Tab Navigation */}
            <div className="flex bg-gray-100 rounded-lg p-1 mr-4">
              <button
                onClick={() => setView('upload')}
                className={`px-3 py-1.5 rounded text-sm font-medium transition ${
                  view === 'upload' ? 'bg-white shadow text-gray-800' : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                📤 Upload
              </button>
              <button
                onClick={() => {
                  if (openBatch) {
                    setCurrentBatch(openBatch);
                    setView('review');
                  }
                }}
                disabled={!openBatch}
                className={`px-3 py-1.5 rounded text-sm font-medium transition ${
                  view === 'review' ? 'bg-white shadow text-gray-800' : 'text-gray-500 hover:text-gray-700'
                } ${!openBatch ? 'opacity-50 cursor-not-allowed' : ''}`}
              >
                📋 Review {openBatch && <span className="ml-1 px-1.5 py-0.5 bg-orange-500 text-white text-xs rounded-full">1</span>}
              </button>
              <button
                onClick={() => setView('history')}
                className={`px-3 py-1.5 rounded text-sm font-medium transition ${
                  view === 'history' ? 'bg-white shadow text-gray-800' : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                📚 Historie
              </button>
            </div>
            <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-lg">
              ✕
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {/* Upload View */}
          {view === 'upload' && (
            <div className="max-w-2xl mx-auto space-y-6">
              {/* Offener Batch Warnung */}
              {openBatch && (
                <div className="p-4 bg-orange-50 border border-orange-200 rounded-lg">
                  <div className="flex items-center gap-3">
                    <span className="text-2xl">⚠️</span>
                    <div className="flex-1">
                      <h3 className="font-medium text-orange-800">Offener Stapel vorhanden</h3>
                      <p className="text-sm text-orange-700">
                        Es gibt noch einen unverarbeiteten Import-Stapel vom{' '}
                        {new Date(openBatch.created_at).toLocaleDateString('de-DE')}.
                      </p>
                    </div>
                    <button
                      onClick={() => {
                        setCurrentBatch(openBatch);
                        setView('review');
                      }}
                      className="px-4 py-2 bg-orange-600 text-white rounded-lg text-sm font-medium hover:bg-orange-700"
                    >
                      Zum Stapel →
                    </button>
                  </div>
                </div>
              )}

              {error && (
                <div className="p-4 bg-red-50 border border-red-200 text-red-700 rounded-lg">
                  {error}
                </div>
              )}

              {/* Salesforce Report Link */}
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                <h4 className="font-medium text-blue-800 mb-2">📊 Salesforce Bericht für den Import</h4>
                <a 
                  href="https://phorestcrm.lightning.force.com/lightning/r/Report/00O1n000007npkjEAA/view"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 text-blue-600 hover:text-blue-800 hover:underline font-medium"
                >
                  🔗 New DACH Opportunities Monthly - 2YRS
                  <span className="text-xs">↗</span>
                </a>
                <p className="text-sm text-blue-600 mt-1">
                  Öffne den Bericht → Exportieren → CSV herunterladen
                </p>
              </div>

              {/* Upload Area */}
              <div
                className={`border-2 border-dashed rounded-xl p-12 text-center transition ${
                  openBatch 
                    ? 'border-gray-200 bg-gray-50 opacity-50 cursor-not-allowed' 
                    : 'border-gray-300 hover:border-blue-400 cursor-pointer'
                }`}
                onClick={() => !openBatch && fileInputRef.current?.click()}
              >
                <div className="text-5xl mb-4">📄</div>
                <h3 className="text-lg font-medium text-gray-700 mb-2">
                  Salesforce CSV hochladen
                </h3>
                <p className="text-gray-500 mb-4">
                  {openBatch 
                    ? 'Bitte erst den offenen Stapel verarbeiten'
                    : 'Klicken oder Datei hierher ziehen'
                  }
                </p>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv,.txt"
                  onChange={handleFileUpload}
                  disabled={!!openBatch || uploading}
                  className="hidden"
                />
                {!openBatch && (
                  <button 
                    disabled={uploading}
                    className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
                  >
                    {uploading ? 'Verarbeite...' : 'Datei auswählen'}
                  </button>
                )}
              </div>

              {/* Info Box */}
              <div className="bg-gray-50 rounded-lg p-4">
                <h4 className="font-medium text-gray-700 mb-2">📋 So funktioniert der Import</h4>
                <ol className="text-sm text-gray-600 space-y-2 list-decimal list-inside">
                  <li>Exportiere den Opportunity-Report aus Salesforce als CSV</li>
                  <li>Lade die CSV-Datei hier hoch</li>
                  <li>Prüfe die erkannten Datensätze im Staging-Bereich</li>
                  <li>Wähle aus, welche Datensätze übernommen werden sollen</li>
                  <li>Bestätige die Übernahme in die Pipeline</li>
                </ol>
              </div>

              {/* Erwartete Spalten */}
              <div className="bg-blue-50 rounded-lg p-4">
                <h4 className="font-medium text-blue-800 mb-2">📊 Erkannte Salesforce-Spalten</h4>
                <div className="grid grid-cols-2 gap-2 text-sm text-blue-700">
                  <div>• Opportunity-Name</div>
                  <div>• Phase (Stage)</div>
                  <div>• Schlusstermin</div>
                  <div>• Erstelldatum</div>
                  <div>• Opportunity-Inhaber</div>
                  <div>• Unique Sign Up Link (für SFID)</div>
                  <div>• Rating (optional)</div>
                  <div>• Nächster Schritt (optional)</div>
                </div>
              </div>
            </div>
          )}

          {/* Review View */}
          {view === 'review' && currentBatch && (
            <ImportStagingReview
              batch={currentBatch}
              allUsers={allUsers}
              userId={user.id}
              onDiscard={handleDiscard}
              onCommitSuccess={handleCommitSuccess}
            />
          )}

          {/* History View */}
          {view === 'history' && (
            <ImportHistory
              batches={batches}
              userId={user.id}
              onRollbackSuccess={handleRollbackSuccess}
            />
          )}
        </div>
      </div>
    </div>
  );
}
