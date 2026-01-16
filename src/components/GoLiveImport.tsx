'use client';

// ============================================================================
// GO-LIVE IMPORT COMPONENT
// Version: v3.17.0
// CSV Upload, Filtering, Matching, Staging Review, Batch Import
// ============================================================================

import { useState, useEffect, useMemo, useCallback } from 'react';
import {
  GoLiveStagingRow,
  GoLiveFilters,
  GoLiveCountry,
  Partner,
  UserOption,
  COUNTRIES_CONFIG,
  MONTH_NAMES_DE,
  countImportable,
} from '@/lib/golive-types';
import {
  parseGoLiveCSV,
  performMatching,
  applyFilters,
  calculateFilterStats,
  importGoLives,
  loadPartners,
  createPartner,
  loadAllUsers,
} from '@/lib/golive-import-hooks';

// ============================================================================
// MAIN COMPONENT
// ============================================================================

interface GoLiveImportProps {
  onBack?: () => void;
  onImportComplete?: (count: number) => void;
}

export default function GoLiveImport({ onBack, onImportComplete }: GoLiveImportProps) {
  // ========== STATE ==========
  
  // CSV & Parsing
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [parsedData, setParsedData] = useState<GoLiveStagingRow[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);

  // Staging Data (nach Matching)
  const [stagingData, setStagingData] = useState<GoLiveStagingRow[]>([]);

  // Filter
  const [filters, setFilters] = useState<GoLiveFilters>({
    countries: ['Germany'], // Default: nur Germany
    stages: ['all'],
    month: 'all'
  });

  // Partners
  const [partners, setPartners] = useState<Partner[]>([]);
  const [allUsers, setAllUsers] = useState<UserOption[]>([]);
  const [newPartnerName, setNewPartnerName] = useState('');
  const [isAddingPartner, setIsAddingPartner] = useState(false);

  // Import
  const [isImporting, setIsImporting] = useState(false);
  const [importProgress, setImportProgress] = useState(0);
  const [importCurrent, setImportCurrent] = useState({ current: 0, total: 0 });
  const [importResult, setImportResult] = useState<{
    success: number;
    failed: number;
    duplicates: number;
  } | null>(null);

  // ========== EFFECTS ==========

  // Partner und Users laden beim Mount
  useEffect(() => {
    loadPartners().then(setPartners);
    loadAllUsers().then(setAllUsers);
  }, []);

  // Filter anwenden wenn sich parsedData oder filters ändern
  const filteredData = useMemo(() => {
    return applyFilters(parsedData, filters);
  }, [parsedData, filters]);

  // Staging-Daten synchronisieren
  useEffect(() => {
    // Wenn parsedData sich ändert, aktualisiere nur die gefilterten IDs in stagingData
    const filteredOakids = new Set(filteredData.map(r => r.oakid));
    
    // Behalte User-Eingaben (ARR, Partner, Enterprise) aus stagingData
    const updatedStaging = filteredData.map(filtered => {
      const existing = stagingData.find(s => s.oakid === filtered.oakid);
      if (existing) {
        return {
          ...filtered,
          arr: existing.arr,
          partnerId: existing.partnerId,
          isEnterprise: existing.isEnterprise,
          // Manuell gesetzte User-ID behalten
          matchedUserId: existing.matchedUserId || filtered.matchedUserId,
          matchedUserName: existing.matchedUserName || filtered.matchedUserName,
        };
      }
      return filtered;
    });

    setStagingData(updatedStaging);
  }, [filteredData]);

  // Filter-Statistiken
  const filterStats = useMemo(() => {
    return calculateFilterStats(parsedData);
  }, [parsedData]);

  // ========== HANDLERS ==========

  // CSV Upload & Parsing
  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setCsvFile(file);
    setParseError(null);
    setIsLoading(true);
    setImportResult(null);

    try {
      // 1. Parse CSV
      const parsed = await parseGoLiveCSV(file);
      
      // 2. Auto-Matching durchführen
      const matched = await performMatching(parsed);
      
      setParsedData(matched);
      setStagingData(applyFilters(matched, filters));
    } catch (error: any) {
      setParseError(error.message || 'Fehler beim Parsen der CSV');
      setParsedData([]);
      setStagingData([]);
    } finally {
      setIsLoading(false);
    }
  };

  // Filter ändern
  const handleCountryToggle = (country: GoLiveCountry) => {
    setFilters(prev => {
      const countries = prev.countries.includes(country)
        ? prev.countries.filter(c => c !== country)
        : [...prev.countries, country];
      return { ...prev, countries };
    });
  };

  const handleStageChange = (stage: string) => {
    setFilters(prev => ({ ...prev, stages: [stage] }));
  };

  const handleMonthChange = (month: number | 'all') => {
    setFilters(prev => ({ ...prev, month }));
  };

  // Row Update (ARR, Partner, Enterprise, User)
  const handleRowUpdate = useCallback((oakid: string, field: string, value: any) => {
    setStagingData(prev => prev.map(row => {
      if (row.oakid !== oakid) return row;
      
      const updated = { ...row, [field]: value };
      
      // Bei User-Änderung auch den Namen aktualisieren
      if (field === 'matchedUserId') {
        const user = allUsers.find(u => u.id === value);
        updated.matchedUserName = user?.name || null;
        updated.isImportable = !row.isDuplicate && value !== null;
      }
      
      // Validierung aktualisieren
      updated.validationErrors = [];
      if (!updated.matchedUserId) updated.validationErrors.push('Kein AE zugeordnet');
      if (!updated.arr || updated.arr <= 0) updated.validationErrors.push('ARR fehlt');
      if (updated.isDuplicate) updated.validationErrors.push('Duplikat');
      
      return updated;
    }));
  }, [allUsers]);

  // Bulk ARR setzen
  const handleBulkArrSet = (arr: number) => {
    setStagingData(prev => prev.map(row => {
      if (row.isDuplicate) return row;
      return { ...row, arr };
    }));
  };

  // Partner Quick-Add
  const handleAddPartner = async () => {
    if (!newPartnerName.trim()) return;
    
    setIsAddingPartner(true);
    try {
      const newPartner = await createPartner(newPartnerName);
      if (newPartner) {
        setPartners(prev => [...prev, newPartner].sort((a, b) => a.name.localeCompare(b.name)));
        setNewPartnerName('');
      }
    } catch (error: any) {
      alert(error.message);
    } finally {
      setIsAddingPartner(false);
    }
  };

  // Import starten
  const handleImport = async () => {
    setIsImporting(true);
    setImportProgress(0);
    setImportCurrent({ current: 0, total: stagingData.length });

    try {
      const result = await importGoLives(stagingData, (progress, current, total) => {
        setImportProgress(progress);
        setImportCurrent({ current, total });
      });

      setImportResult(result);
      
      if (result.success > 0 && onImportComplete) {
        onImportComplete(result.success);
      }
    } catch (error: any) {
      alert('Import-Fehler: ' + error.message);
    } finally {
      setIsImporting(false);
    }
  };

  // Reset
  const handleReset = () => {
    setCsvFile(null);
    setParsedData([]);
    setStagingData([]);
    setParseError(null);
    setImportResult(null);
    setFilters({
      countries: ['Germany'],
      stages: ['all'],
      month: 'all'
    });
  };

  // ========== RENDER ==========

  // Import-Ergebnis anzeigen
  if (importResult) {
    return (
      <div className="max-w-2xl mx-auto p-6">
        <div className="bg-white rounded-lg shadow-lg p-8 text-center">
          <div className="text-6xl mb-4">
            {importResult.success > 0 ? '✅' : '⚠️'}
          </div>
          <h2 className="text-2xl font-bold mb-4">
            {importResult.success > 0 ? 'Import erfolgreich!' : 'Import abgeschlossen'}
          </h2>
          
          <div className="grid grid-cols-3 gap-4 mb-6">
            <div className="bg-green-50 p-4 rounded-lg">
              <div className="text-3xl font-bold text-green-600">{importResult.success}</div>
              <div className="text-sm text-gray-600">Importiert</div>
            </div>
            <div className="bg-yellow-50 p-4 rounded-lg">
              <div className="text-3xl font-bold text-yellow-600">{importResult.duplicates}</div>
              <div className="text-sm text-gray-600">Duplikate</div>
            </div>
            <div className="bg-red-50 p-4 rounded-lg">
              <div className="text-3xl font-bold text-red-600">{importResult.failed}</div>
              <div className="text-sm text-gray-600">Fehler</div>
            </div>
          </div>

          <div className="flex gap-4 justify-center">
            <button
              onClick={handleReset}
              className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
            >
              Neuer Import
            </button>
            {onBack && (
              <button
                onClick={onBack}
                className="px-6 py-2 border border-gray-300 rounded-lg hover:bg-gray-50"
              >
                Zurück
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Import läuft
  if (isImporting) {
    return (
      <div className="max-w-md mx-auto p-6">
        <div className="bg-white rounded-lg shadow-lg p-8">
          <h2 className="text-xl font-semibold mb-4 text-center">
            Importiere Go-Lives...
          </h2>
          
          <div className="mb-4">
            <div className="h-4 bg-gray-200 rounded-full overflow-hidden">
              <div
                className="h-full bg-blue-600 transition-all duration-300"
                style={{ width: `${importProgress}%` }}
              />
            </div>
          </div>
          
          <div className="text-center text-gray-600">
            {importCurrent.current} von {importCurrent.total} ({importProgress}%)
          </div>
        </div>
      </div>
    );
  }

  // Kein File - Upload-Screen
  if (!csvFile) {
    return (
      <div className="max-w-2xl mx-auto p-6">
        <div className="bg-white rounded-lg shadow-lg p-8">
          <div className="text-center mb-6">
            <div className="text-5xl mb-4">📁</div>
            <h2 className="text-2xl font-bold mb-2">Go-Live Import</h2>
            <p className="text-gray-600">
              Salesforce Go-Live Reports (CSV) importieren
            </p>
          </div>

          <div className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center hover:border-blue-400 transition-colors">
            <input
              type="file"
              accept=".csv"
              onChange={handleFileSelect}
              className="hidden"
              id="csv-upload"
            />
            <label
              htmlFor="csv-upload"
              className="cursor-pointer block"
            >
              <div className="text-4xl mb-2">📄</div>
              <div className="text-lg font-medium text-gray-700 mb-1">
                CSV-Datei auswählen
              </div>
              <div className="text-sm text-gray-500">
                Delimiter: Semikolon (;) • Encoding: ISO-8859-1
              </div>
            </label>
          </div>

          {parseError && (
            <div className="mt-4 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700">
              ⚠️ {parseError}
            </div>
          )}

          {onBack && (
            <button
              onClick={onBack}
              className="mt-6 w-full py-2 border border-gray-300 rounded-lg hover:bg-gray-50"
            >
              Zurück
            </button>
          )}
        </div>
      </div>
    );
  }

  // Loading
  if (isLoading) {
    return (
      <div className="max-w-md mx-auto p-6">
        <div className="bg-white rounded-lg shadow-lg p-8 text-center">
          <div className="animate-spin text-4xl mb-4">⏳</div>
          <div className="text-lg font-medium">CSV wird verarbeitet...</div>
          <div className="text-sm text-gray-500 mt-2">
            Parsing, Matching, Duplikat-Check
          </div>
        </div>
      </div>
    );
  }

  // ========== MAIN VIEW: Filter + Staging Table ==========
  
  const importableCount = countImportable(stagingData);
  const duplicateCount = stagingData.filter(r => r.isDuplicate).length;
  const unmatchedCount = stagingData.filter(r => !r.matchedUserId && !r.isDuplicate).length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Go-Live Import</h2>
          <p className="text-gray-600">
            📄 {csvFile.name} • {parsedData.length} Zeilen geladen
          </p>
        </div>
        <button
          onClick={handleReset}
          className="px-4 py-2 text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded"
        >
          ✕ Neue Datei
        </button>
      </div>

      {/* Filter Section */}
      <div className="bg-white rounded-lg shadow p-4">
        <h3 className="font-semibold mb-3">🔍 Filter</h3>
        
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Country Filter */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              🌍 Land
            </label>
            <div className="space-y-1">
              {(Object.keys(COUNTRIES_CONFIG) as GoLiveCountry[]).map(country => {
                const count = filterStats.countries[country] || 0;
                const config = COUNTRIES_CONFIG[country];
                return (
                  <label
                    key={country}
                    className="flex items-center gap-2 cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={filters.countries.includes(country)}
                      onChange={() => handleCountryToggle(country)}
                      className="rounded"
                    />
                    <span>{config.flag} {config.labelDe}</span>
                    <span className="text-gray-400">({count})</span>
                  </label>
                );
              })}
            </div>
          </div>

          {/* Stage Filter */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              📌 Stage
            </label>
            <select
              value={filters.stages[0]}
              onChange={(e) => handleStageChange(e.target.value)}
              className="w-full px-3 py-2 border rounded-lg"
            >
              <option value="all">Alle Stages ({parsedData.length})</option>
              {Object.entries(filterStats.stages).map(([stage, count]) => (
                <option key={stage} value={stage}>
                  {stage} ({count})
                </option>
              ))}
            </select>
          </div>

          {/* Month Filter */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              📅 Monat
            </label>
            <select
              value={filters.month}
              onChange={(e) => handleMonthChange(
                e.target.value === 'all' ? 'all' : parseInt(e.target.value)
              )}
              className="w-full px-3 py-2 border rounded-lg"
            >
              <option value="all">Alle Monate</option>
              {Object.entries(filterStats.months)
                .sort(([a], [b]) => parseInt(a) - parseInt(b))
                .map(([month, count]) => (
                  <option key={month} value={month}>
                    {MONTH_NAMES_DE[parseInt(month) - 1]} ({count})
                  </option>
                ))}
            </select>
          </div>
        </div>
      </div>

      {/* Stats Bar */}
      <div className="flex gap-4 text-sm">
        <div className="flex items-center gap-2 px-3 py-1 bg-blue-50 rounded">
          <span className="font-bold text-blue-700">{stagingData.length}</span>
          <span className="text-gray-600">Gefiltert</span>
        </div>
        <div className="flex items-center gap-2 px-3 py-1 bg-green-50 rounded">
          <span className="font-bold text-green-700">{importableCount}</span>
          <span className="text-gray-600">Importierbar</span>
        </div>
        <div className="flex items-center gap-2 px-3 py-1 bg-red-50 rounded">
          <span className="font-bold text-red-700">{duplicateCount}</span>
          <span className="text-gray-600">Duplikate</span>
        </div>
        <div className="flex items-center gap-2 px-3 py-1 bg-yellow-50 rounded">
          <span className="font-bold text-yellow-700">{unmatchedCount}</span>
          <span className="text-gray-600">Ohne AE</span>
        </div>
      </div>

      {/* Bulk ARR */}
      <div className="bg-gray-50 rounded-lg p-3 flex items-center gap-4">
        <span className="text-sm font-medium text-gray-700">💰 ARR für alle setzen:</span>
        <div className="flex gap-2">
          {[1860, 2280, 2880, 3600].map(arr => (
            <button
              key={arr}
              onClick={() => handleBulkArrSet(arr)}
              className="px-3 py-1 text-sm bg-white border rounded hover:bg-blue-50"
            >
              €{arr.toLocaleString('de-DE')}
            </button>
          ))}
        </div>
      </div>

      {/* Staging Table */}
      <div className="bg-white rounded-lg shadow overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-2 py-3 text-left text-xs font-medium text-gray-500 uppercase w-12">
                  Status
                </th>
                <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                  Salon
                </th>
                <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase w-28">
                  Datum
                </th>
                <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase w-40">
                  AE
                </th>
                <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase w-12">
                  Opp
                </th>
                <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase w-28">
                  ARR (€)
                </th>
                <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase w-40">
                  Partner
                </th>
                <th className="px-3 py-3 text-center text-xs font-medium text-gray-500 uppercase w-20">
                  Enterprise
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {stagingData.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-6 py-8 text-center text-gray-500">
                    Keine Daten für die gewählten Filter
                  </td>
                </tr>
              ) : (
                stagingData.map((row) => (
                  <tr
                    key={row.oakid}
                    className={
                      row.isDuplicate
                        ? 'bg-red-50'
                        : !row.matchedUserId
                        ? 'bg-yellow-50'
                        : 'hover:bg-gray-50'
                    }
                  >
                    {/* Status */}
                    <td className="px-2 py-3 text-center">
                      {row.isDuplicate ? (
                        <span title="Bereits importiert">❌</span>
                      ) : row.matchedUserId && row.arr ? (
                        <span title="Bereit zum Import">✅</span>
                      ) : (
                        <span title="Daten fehlen">⚠️</span>
                      )}
                    </td>

                    {/* Salon */}
                    <td className="px-3 py-3 text-sm">
                      <div className="font-medium truncate max-w-xs" title={row.salonName}>
                        {row.salonName}
                      </div>
                      {row.isDuplicate && (
                        <div className="text-xs text-red-600">Bereits importiert</div>
                      )}
                    </td>

                    {/* Datum */}
                    <td className="px-3 py-3 text-sm text-gray-600">
                      {row.goLiveDate
                        ? new Date(row.goLiveDate).toLocaleDateString('de-DE')
                        : '-'}
                    </td>

                    {/* AE */}
                    <td className="px-3 py-3">
                      {row.matchedUserId ? (
                        <span className="text-sm text-green-700">
                          ✓ {row.matchedUserName}
                        </span>
                      ) : (
                        <select
                          className="w-full px-2 py-1 text-sm border rounded"
                          value={row.matchedUserId || ''}
                          onChange={(e) => handleRowUpdate(row.oakid, 'matchedUserId', e.target.value || null)}
                          disabled={row.isDuplicate}
                        >
                          <option value="">Bitte wählen...</option>
                          {allUsers.map(u => (
                            <option key={u.id} value={u.id}>{u.name}</option>
                          ))}
                        </select>
                      )}
                    </td>

                    {/* Opportunity */}
                    <td className="px-3 py-3 text-center">
                      {row.matchedOpportunityId ? (
                        <span className="text-green-600" title={row.matchedOpportunityName || ''}>✓</span>
                      ) : (
                        <span className="text-gray-400">—</span>
                      )}
                    </td>

                    {/* ARR */}
                    <td className="px-3 py-3">
                      <input
                        type="number"
                        className="w-full px-2 py-1 text-sm border rounded"
                        placeholder="2280"
                        value={row.arr || ''}
                        onChange={(e) => handleRowUpdate(
                          row.oakid,
                          'arr',
                          e.target.value ? parseFloat(e.target.value) : null
                        )}
                        disabled={row.isDuplicate}
                      />
                    </td>

                    {/* Partner */}
                    <td className="px-3 py-3">
                      <select
                        className="w-full px-2 py-1 text-sm border rounded"
                        value={row.partnerId || ''}
                        onChange={(e) => handleRowUpdate(
                          row.oakid,
                          'partnerId',
                          e.target.value || null
                        )}
                        disabled={row.isDuplicate}
                      >
                        <option value="">— Kein Partner —</option>
                        {partners.map(p => (
                          <option key={p.id} value={p.id}>{p.name}</option>
                        ))}
                      </select>
                    </td>

                    {/* Enterprise */}
                    <td className="px-3 py-3 text-center">
                      <input
                        type="checkbox"
                        className="h-4 w-4"
                        checked={row.isEnterprise}
                        onChange={(e) => handleRowUpdate(
                          row.oakid,
                          'isEnterprise',
                          e.target.checked
                        )}
                        disabled={row.isDuplicate}
                      />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Partner Quick-Add */}
      <div className="bg-gray-50 rounded-lg p-4">
        <h4 className="text-sm font-medium text-gray-700 mb-2">
          ➕ Neuen Partner anlegen
        </h4>
        <div className="flex gap-2">
          <input
            type="text"
            className="flex-1 px-3 py-2 border rounded"
            placeholder="z.B. L'Oréal Professional"
            value={newPartnerName}
            onChange={(e) => setNewPartnerName(e.target.value)}
            onKeyPress={(e) => e.key === 'Enter' && handleAddPartner()}
          />
          <button
            onClick={handleAddPartner}
            disabled={isAddingPartner || !newPartnerName.trim()}
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
          >
            {isAddingPartner ? '...' : 'Anlegen'}
          </button>
        </div>
      </div>

      {/* Import Button */}
      <div className="flex gap-4 justify-end">
        {onBack && (
          <button
            onClick={onBack}
            className="px-6 py-3 border border-gray-300 rounded-lg hover:bg-gray-50"
          >
            Abbrechen
          </button>
        )}
        <button
          onClick={handleImport}
          disabled={importableCount === 0}
          className="px-6 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed font-medium"
        >
          {importableCount > 0
            ? `✓ ${importableCount} Go-Lives importieren`
            : 'Keine importierbaren Zeilen'}
        </button>
      </div>
    </div>
  );
}
