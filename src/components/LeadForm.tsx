'use client';

import { useState } from 'react';
import { Lead, Competitor, LeadSource, LEAD_SOURCES } from '@/lib/pipeline-types';

interface LeadFormProps {
  lead: Lead | null;
  competitors: Competitor[];
  onSave: (data: Partial<Lead>) => Promise<void>;
  onCancel: () => void;
  onArchive?: () => Promise<void>;
}

export default function LeadForm({ lead, competitors, onSave, onCancel, onArchive }: LeadFormProps) {
  const [formData, setFormData] = useState({
    company_name: lead?.company_name || '',
    contact_name: lead?.contact_name || '',
    contact_email: lead?.contact_email || '',
    contact_phone: lead?.contact_phone || '',
    employee_count: lead?.employee_count?.toString() || '',
    location_count: lead?.location_count?.toString() || '1',
    lead_source: lead?.lead_source || 'inbound' as LeadSource,
    has_existing_software: lead?.has_existing_software || false,
    competitor_id: lead?.competitor_id || '',
    notes: lead?.notes || '',
  });
  
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!formData.company_name.trim()) {
      setError('Unternehmensname ist erforderlich');
      return;
    }

    setSaving(true);
    try {
      await onSave({
        company_name: formData.company_name.trim(),
        contact_name: formData.contact_name.trim() || null,
        contact_email: formData.contact_email.trim() || null,
        contact_phone: formData.contact_phone.trim() || null,
        employee_count: formData.employee_count ? Number(formData.employee_count) : null,
        location_count: Number(formData.location_count) || 1,
        lead_source: formData.lead_source,
        has_existing_software: formData.has_existing_software,
        competitor_id: formData.competitor_id || null,
        notes: formData.notes.trim() || null,
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
            <h2 className="text-xl font-bold text-gray-800">
              {lead ? 'Lead bearbeiten' : 'Neuer Lead'}
            </h2>
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

          {/* Unternehmensdaten */}
          <div>
            <h3 className="font-medium text-gray-700 mb-3">Unternehmensdaten</h3>
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-gray-600 mb-1">
                  Unternehmensname *
                </label>
                <input
                  type="text"
                  value={formData.company_name}
                  onChange={(e) => setFormData({ ...formData, company_name: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  placeholder="Salon Beispiel GmbH"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-600 mb-1">
                  Kontaktperson
                </label>
                <input
                  type="text"
                  value={formData.contact_name}
                  onChange={(e) => setFormData({ ...formData, contact_name: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  placeholder="Maria Müller"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-600 mb-1">
                    E-Mail
                  </label>
                  <input
                    type="email"
                    value={formData.contact_email}
                    onChange={(e) => setFormData({ ...formData, contact_email: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    placeholder="maria@beispiel.de"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-600 mb-1">
                    Telefon
                  </label>
                  <input
                    type="tel"
                    value={formData.contact_phone}
                    onChange={(e) => setFormData({ ...formData, contact_phone: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    placeholder="+49 221 12345"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Unternehmensgröße */}
          <div>
            <h3 className="font-medium text-gray-700 mb-3">Unternehmensgröße</h3>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-gray-600 mb-1">
                  Anzahl Mitarbeiter
                </label>
                <input
                  type="number"
                  value={formData.employee_count}
                  onChange={(e) => setFormData({ ...formData, employee_count: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  placeholder="8"
                  min="1"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-600 mb-1">
                  Anzahl Filialen
                </label>
                <input
                  type="number"
                  value={formData.location_count}
                  onChange={(e) => setFormData({ ...formData, location_count: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  placeholder="1"
                  min="1"
                />
              </div>
            </div>
          </div>

          {/* Lead-Ursprung */}
          <div>
            <h3 className="font-medium text-gray-700 mb-3">Lead-Ursprung *</h3>
            <div className="grid grid-cols-2 gap-2">
              {(Object.keys(LEAD_SOURCES) as LeadSource[]).map(source => (
                <label
                  key={source}
                  className={`flex items-center p-3 border rounded-lg cursor-pointer transition ${
                    formData.lead_source === source
                      ? 'border-blue-500 bg-blue-50'
                      : 'border-gray-200 hover:border-gray-300'
                  }`}
                >
                  <input
                    type="radio"
                    name="lead_source"
                    value={source}
                    checked={formData.lead_source === source}
                    onChange={() => setFormData({ ...formData, lead_source: source })}
                    className="sr-only"
                  />
                  <span className="mr-2">{LEAD_SOURCES[source].icon}</span>
                  <span className="text-sm">{LEAD_SOURCES[source].label}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Aktuelle Software */}
          <div>
            <h3 className="font-medium text-gray-700 mb-3">Aktuelle Software-Situation</h3>
            <label className="flex items-center space-x-3 mb-3">
              <input
                type="checkbox"
                checked={formData.has_existing_software}
                onChange={(e) => setFormData({ 
                  ...formData, 
                  has_existing_software: e.target.checked,
                  competitor_id: e.target.checked ? formData.competitor_id : ''
                })}
                className="w-5 h-5 rounded border-gray-300 text-blue-600"
              />
              <span className="text-sm text-gray-700">Nutzt bereits Salon-Software</span>
            </label>
            
            {formData.has_existing_software && (
              <select
                value={formData.competitor_id}
                onChange={(e) => setFormData({ ...formData, competitor_id: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              >
                <option value="">-- Welche Software? --</option>
                {competitors.map(comp => (
                  <option key={comp.id} value={comp.id}>{comp.name}</option>
                ))}
              </select>
            )}
          </div>

          {/* Notizen */}
          <div>
            <label className="block text-sm font-medium text-gray-600 mb-1">
              Notizen
            </label>
            <textarea
              value={formData.notes}
              onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              rows={3}
              placeholder="Zusätzliche Informationen zum Lead..."
            />
          </div>

          {/* Actions */}
          <div className="flex items-center justify-between pt-4 border-t">
            {onArchive && lead && !lead.archived ? (
              <button
                type="button"
                onClick={onArchive}
                className="px-4 py-2 text-orange-600 hover:bg-orange-50 rounded-lg"
              >
                📦 Archivieren
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
                {saving ? 'Speichern...' : (lead ? 'Speichern' : 'Lead erstellen')}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
