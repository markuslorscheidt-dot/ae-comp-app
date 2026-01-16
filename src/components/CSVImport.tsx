'use client';

import { useState, useRef } from 'react';
import { Lead, LeadSource, LEAD_SOURCES } from '@/lib/pipeline-types';

interface CSVImportProps {
  onImport: (leads: Partial<Lead>[]) => Promise<{ success: number; errors: string[] }>;
  onClose: () => void;
}

interface CSVRow {
  company_name?: string;
  contact_name?: string;
  contact_email?: string;
  contact_phone?: string;
  employee_count?: string;
  location_count?: string;
  lead_source?: string;
  notes?: string;
  [key: string]: string | undefined;
}

interface ParsedLead extends Partial<Lead> {
  _row: number;
  _errors: string[];
}

const REQUIRED_COLUMNS = ['company_name'];
const OPTIONAL_COLUMNS = ['contact_name', 'contact_email', 'contact_phone', 'employee_count', 'location_count', 'lead_source', 'notes'];

export default function CSVImport({ onImport, onClose }: CSVImportProps) {
  const [step, setStep] = useState<'upload' | 'preview' | 'importing' | 'done'>('upload');
  const [csvData, setCsvData] = useState<CSVRow[]>([]);
  const [parsedLeads, setParsedLeads] = useState<ParsedLead[]>([]);
  const [columnMapping, setColumnMapping] = useState<Record<string, string>>({});
  const [availableColumns, setAvailableColumns] = useState<string[]>([]);
  const [importResult, setImportResult] = useState<{ success: number; errors: string[] } | null>(null);
  const [error, setError] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  // CSV parsen
  const parseCSV = (text: string): CSVRow[] => {
    const lines = text.split('\n').filter(line => line.trim());
    if (lines.length < 2) return [];

    // Header parsen (erste Zeile)
    const headers = lines[0].split(/[,;]/).map(h => h.trim().toLowerCase().replace(/['"]/g, ''));
    setAvailableColumns(headers);

    // Auto-Mapping versuchen
    const autoMapping: Record<string, string> = {};
    headers.forEach(header => {
      // Direkte Matches
      if (REQUIRED_COLUMNS.includes(header) || OPTIONAL_COLUMNS.includes(header)) {
        autoMapping[header] = header;
      }
      // Alternative Namen
      if (header === 'firma' || header === 'unternehmen' || header === 'company') {
        autoMapping[header] = 'company_name';
      }
      if (header === 'kontakt' || header === 'ansprechpartner' || header === 'name') {
        autoMapping[header] = 'contact_name';
      }
      if (header === 'email' || header === 'e-mail' || header === 'mail') {
        autoMapping[header] = 'contact_email';
      }
      if (header === 'telefon' || header === 'phone' || header === 'tel') {
        autoMapping[header] = 'contact_phone';
      }
      if (header === 'mitarbeiter' || header === 'employees') {
        autoMapping[header] = 'employee_count';
      }
      if (header === 'filialen' || header === 'standorte' || header === 'locations') {
        autoMapping[header] = 'location_count';
      }
      if (header === 'quelle' || header === 'source') {
        autoMapping[header] = 'lead_source';
      }
      if (header === 'notizen' || header === 'bemerkung' || header === 'kommentar') {
        autoMapping[header] = 'notes';
      }
    });
    setColumnMapping(autoMapping);

    // Datenzeilen parsen
    const rows: CSVRow[] = [];
    for (let i = 1; i < lines.length; i++) {
      const values = lines[i].split(/[,;]/).map(v => v.trim().replace(/^["']|["']$/g, ''));
      const row: CSVRow = {};
      headers.forEach((header, index) => {
        row[header] = values[index] || '';
      });
      rows.push(row);
    }

    return rows;
  };

  // Leads aus CSV-Daten erstellen
  const createLeadsFromCSV = (data: CSVRow[], mapping: Record<string, string>): ParsedLead[] => {
    return data.map((row, index) => {
      const errors: string[] = [];
      
      // Mapped values extrahieren
      const getValue = (field: string): string => {
        const sourceColumn = Object.keys(mapping).find(k => mapping[k] === field);
        return sourceColumn ? (row[sourceColumn] || '') : '';
      };

      const companyName = getValue('company_name');
      if (!companyName) {
        errors.push('Unternehmensname fehlt');
      }

      // Lead Source validieren
      let leadSource: LeadSource = 'inbound';
      const sourceValue = getValue('lead_source').toLowerCase();
      if (sourceValue) {
        if (['inbound', 'outbound', 'partnership', 'enterprise'].includes(sourceValue)) {
          leadSource = sourceValue as LeadSource;
        } else if (sourceValue.includes('partner')) {
          leadSource = 'partnership';
        } else if (sourceValue.includes('enterprise') || sourceValue.includes('filial')) {
          leadSource = 'enterprise';
        } else if (sourceValue.includes('outbound') || sourceValue.includes('kalt')) {
          leadSource = 'outbound';
        }
      }

      // Zahlen parsen
      const employeeCount = parseInt(getValue('employee_count')) || null;
      const locationCount = parseInt(getValue('location_count')) || 1;

      return {
        company_name: companyName,
        contact_name: getValue('contact_name') || null,
        contact_email: getValue('contact_email') || null,
        contact_phone: getValue('contact_phone') || null,
        employee_count: employeeCount,
        location_count: locationCount,
        lead_source: leadSource,
        notes: getValue('notes') || null,
        imported_from: 'csv',
        _row: index + 2, // +2 weil Header = Zeile 1
        _errors: errors,
      };
    });
  };

  // Datei hochladen
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setError('');
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const text = event.target?.result as string;
        const data = parseCSV(text);
        
        if (data.length === 0) {
          setError('Die CSV-Datei enthält keine Daten');
          return;
        }

        setCsvData(data);
        setStep('preview');
      } catch (err) {
        setError('Fehler beim Lesen der Datei');
      }
    };
    reader.readAsText(file);
  };

  // Mapping aktualisieren und Preview neu berechnen
  const updateMapping = (csvColumn: string, targetField: string) => {
    const newMapping = { ...columnMapping };
    
    // Alte Zuordnung für dieses Target-Field entfernen
    Object.keys(newMapping).forEach(key => {
      if (newMapping[key] === targetField) {
        delete newMapping[key];
      }
    });
    
    // Neue Zuordnung setzen
    if (targetField) {
      newMapping[csvColumn] = targetField;
    }
    
    setColumnMapping(newMapping);
  };

  // Preview aktualisieren wenn Mapping sich ändert
  const previewLeads = createLeadsFromCSV(csvData, columnMapping);
  const validLeads = previewLeads.filter(l => l._errors.length === 0);
  const invalidLeads = previewLeads.filter(l => l._errors.length > 0);

  // Import starten
  const handleImport = async () => {
    setStep('importing');
    
    const leadsToImport = validLeads.map(({ _row, _errors, ...lead }) => lead);
    const result = await onImport(leadsToImport);
    
    setImportResult(result);
    setStep('done');
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="p-6 border-b flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold text-gray-800">📥 CSV Import</h2>
            <p className="text-sm text-gray-500">
              {step === 'upload' && 'Lade eine CSV-Datei mit Leads hoch'}
              {step === 'preview' && 'Überprüfe die Zuordnung und Vorschau'}
              {step === 'importing' && 'Importiere Leads...'}
              {step === 'done' && 'Import abgeschlossen'}
            </p>
          </div>
          <button onClick={onClose} className="p-2 text-gray-400 hover:bg-gray-100 rounded-lg">
            ✕
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {/* Step 1: Upload */}
          {step === 'upload' && (
            <div className="space-y-6">
              {error && (
                <div className="p-4 bg-red-50 border border-red-200 text-red-700 rounded-lg">
                  {error}
                </div>
              )}

              <div 
                className="border-2 border-dashed border-gray-300 rounded-xl p-12 text-center hover:border-blue-400 transition cursor-pointer"
                onClick={() => fileInputRef.current?.click()}
              >
                <div className="text-5xl mb-4">📄</div>
                <h3 className="text-lg font-medium text-gray-700 mb-2">CSV-Datei hochladen</h3>
                <p className="text-gray-500 mb-4">Klicken oder Datei hierher ziehen</p>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv,.txt"
                  onChange={handleFileUpload}
                  className="hidden"
                />
                <button className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">
                  Datei auswählen
                </button>
              </div>

              <div className="bg-gray-50 rounded-lg p-4">
                <h4 className="font-medium text-gray-700 mb-2">📋 Erwartetes Format</h4>
                <p className="text-sm text-gray-600 mb-3">
                  Die CSV sollte eine Header-Zeile haben. Folgende Spalten werden erkannt:
                </p>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div><strong className="text-red-600">company_name*</strong> - Unternehmensname (Pflicht)</div>
                  <div><strong>contact_name</strong> - Kontaktperson</div>
                  <div><strong>contact_email</strong> - E-Mail</div>
                  <div><strong>contact_phone</strong> - Telefon</div>
                  <div><strong>employee_count</strong> - Anzahl Mitarbeiter</div>
                  <div><strong>location_count</strong> - Anzahl Filialen</div>
                  <div><strong>lead_source</strong> - Quelle (inbound/outbound/partnership/enterprise)</div>
                  <div><strong>notes</strong> - Notizen</div>
                </div>
              </div>
            </div>
          )}

          {/* Step 2: Preview & Mapping */}
          {step === 'preview' && (
            <div className="space-y-6">
              {/* Column Mapping */}
              <div className="bg-blue-50 rounded-lg p-4">
                <h4 className="font-medium text-blue-800 mb-3">🔗 Spaltenzuordnung</h4>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  {availableColumns.map(col => (
                    <div key={col}>
                      <label className="block text-xs text-gray-600 mb-1">{col}</label>
                      <select
                        value={columnMapping[col] || ''}
                        onChange={(e) => updateMapping(col, e.target.value)}
                        className="w-full px-2 py-1 text-sm border rounded"
                      >
                        <option value="">-- Ignorieren --</option>
                        <option value="company_name">Unternehmensname *</option>
                        <option value="contact_name">Kontaktperson</option>
                        <option value="contact_email">E-Mail</option>
                        <option value="contact_phone">Telefon</option>
                        <option value="employee_count">Mitarbeiter</option>
                        <option value="location_count">Filialen</option>
                        <option value="lead_source">Quelle</option>
                        <option value="notes">Notizen</option>
                      </select>
                    </div>
                  ))}
                </div>
              </div>

              {/* Summary */}
              <div className="flex gap-4">
                <div className="flex-1 bg-green-50 rounded-lg p-4 text-center">
                  <div className="text-3xl font-bold text-green-600">{validLeads.length}</div>
                  <div className="text-sm text-green-700">Gültige Leads</div>
                </div>
                <div className="flex-1 bg-red-50 rounded-lg p-4 text-center">
                  <div className="text-3xl font-bold text-red-600">{invalidLeads.length}</div>
                  <div className="text-sm text-red-700">Ungültige Zeilen</div>
                </div>
              </div>

              {/* Invalid Rows Warning */}
              {invalidLeads.length > 0 && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                  <h4 className="font-medium text-red-800 mb-2">⚠️ Ungültige Zeilen</h4>
                  <ul className="text-sm text-red-700 space-y-1">
                    {invalidLeads.slice(0, 5).map(lead => (
                      <li key={lead._row}>
                        Zeile {lead._row}: {lead._errors.join(', ')}
                      </li>
                    ))}
                    {invalidLeads.length > 5 && (
                      <li>... und {invalidLeads.length - 5} weitere</li>
                    )}
                  </ul>
                </div>
              )}

              {/* Preview Table */}
              <div>
                <h4 className="font-medium text-gray-700 mb-2">Vorschau (erste 10 Zeilen)</h4>
                <div className="overflow-x-auto border rounded-lg">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-3 py-2 text-left">Status</th>
                        <th className="px-3 py-2 text-left">Unternehmen</th>
                        <th className="px-3 py-2 text-left">Kontakt</th>
                        <th className="px-3 py-2 text-left">E-Mail</th>
                        <th className="px-3 py-2 text-left">Quelle</th>
                      </tr>
                    </thead>
                    <tbody>
                      {previewLeads.slice(0, 10).map((lead, i) => (
                        <tr key={i} className={lead._errors.length > 0 ? 'bg-red-50' : ''}>
                          <td className="px-3 py-2">
                            {lead._errors.length > 0 ? '❌' : '✅'}
                          </td>
                          <td className="px-3 py-2 font-medium">{lead.company_name || '-'}</td>
                          <td className="px-3 py-2">{lead.contact_name || '-'}</td>
                          <td className="px-3 py-2">{lead.contact_email || '-'}</td>
                          <td className="px-3 py-2">
                            {lead.lead_source && LEAD_SOURCES[lead.lead_source]?.icon} {lead.lead_source}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* Step 3: Importing */}
          {step === 'importing' && (
            <div className="text-center py-12">
              <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-blue-600 mx-auto"></div>
              <p className="mt-4 text-gray-600">Importiere {validLeads.length} Leads...</p>
            </div>
          )}

          {/* Step 4: Done */}
          {step === 'done' && importResult && (
            <div className="space-y-6">
              <div className="text-center py-8">
                {importResult.success > 0 ? (
                  <>
                    <div className="text-6xl mb-4">🎉</div>
                    <h3 className="text-2xl font-bold text-green-600 mb-2">
                      {importResult.success} Leads importiert!
                    </h3>
                  </>
                ) : (
                  <>
                    <div className="text-6xl mb-4">😕</div>
                    <h3 className="text-2xl font-bold text-red-600 mb-2">
                      Import fehlgeschlagen
                    </h3>
                  </>
                )}
              </div>

              {importResult.errors.length > 0 && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                  <h4 className="font-medium text-red-800 mb-2">Fehler beim Import:</h4>
                  <ul className="text-sm text-red-700 space-y-1">
                    {importResult.errors.map((err, i) => (
                      <li key={i}>{err}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-6 border-t flex justify-between">
          {step === 'upload' && (
            <button onClick={onClose} className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg">
              Abbrechen
            </button>
          )}
          
          {step === 'preview' && (
            <>
              <button 
                onClick={() => setStep('upload')} 
                className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg"
              >
                ← Zurück
              </button>
              <button
                onClick={handleImport}
                disabled={validLeads.length === 0}
                className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
              >
                {validLeads.length} Leads importieren
              </button>
            </>
          )}

          {step === 'done' && (
            <button
              onClick={onClose}
              className="ml-auto px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
            >
              Schließen
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
