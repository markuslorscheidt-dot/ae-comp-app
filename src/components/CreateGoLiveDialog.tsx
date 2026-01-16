'use client';

import { useState } from 'react';
import { Opportunity, Lead, calculateARR, formatDate } from '@/lib/pipeline-types';
import { formatCurrency } from '@/lib/calculations';
import { GoLive } from '@/lib/types';

interface CreateGoLiveDialogProps {
  opportunity: Opportunity;
  lead: Lead;
  year: number;
  onConfirm: (goLiveData: Partial<GoLive>) => Promise<{ error?: Error }>;
  onCancel: () => void;
}

export default function CreateGoLiveDialog({
  opportunity,
  lead,
  year,
  onConfirm,
  onCancel,
}: CreateGoLiveDialogProps) {
  const [formData, setFormData] = useState({
    month: new Date().getMonth() + 1,
    subs_arr: calculateARR(opportunity.expected_subs_monthly),
    pay_arr: calculateARR(opportunity.expected_pay_monthly),
    has_terminal: opportunity.has_terminal,
    salon_name: `${lead.company_name}${opportunity.name !== lead.company_name ? ` - ${opportunity.name}` : ''}`,
    notes: '',
  });
  
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSaving(true);

    try {
      const result = await onConfirm({
        month: formData.month,
        subs_arr: formData.subs_arr,
        pay_arr: formData.pay_arr,
        has_terminal: formData.has_terminal,
        salon_name: formData.salon_name,
        notes: formData.notes || null,
        year,
        // Diese werden in der Parent-Komponente gesetzt:
        // user_id, lead_id, opportunity_id
      });

      if (result.error) {
        setError(result.error.message);
        setSaving(false);
      }
      // Bei Erfolg wird der Dialog von außen geschlossen
    } catch (err: any) {
      setError(err.message || 'Fehler beim Erstellen');
      setSaving(false);
    }
  };

  const months = [
    'Januar', 'Februar', 'März', 'April', 'Mai', 'Juni',
    'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'
  ];

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl max-w-lg w-full">
        <div className="p-6 border-b">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center text-2xl">
              🎉
            </div>
            <div>
              <h2 className="text-xl font-bold text-gray-800">Go-Live erstellen</h2>
              <p className="text-sm text-gray-500">Deal gewonnen! Jetzt Go-Live dokumentieren.</p>
            </div>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && (
            <div className="p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">
              {error}
            </div>
          )}

          {/* Info Box */}
          <div className="bg-blue-50 rounded-lg p-4">
            <div className="text-sm text-blue-800">
              <div className="font-medium mb-2">📋 Aus Opportunity übernommen:</div>
              <div className="grid grid-cols-2 gap-2 text-blue-700">
                <div>Lead: <strong>{lead.company_name}</strong></div>
                <div>Opportunity: <strong>{opportunity.name}</strong></div>
                <div>Subs ARR: <strong>{formatCurrency(calculateARR(opportunity.expected_subs_monthly))}</strong></div>
                <div>Pay ARR: <strong>{formatCurrency(calculateARR(opportunity.expected_pay_monthly))}</strong></div>
              </div>
            </div>
          </div>

          {/* Monat */}
          <div>
            <label className="block text-sm font-medium text-gray-600 mb-1">
              Go-Live Monat *
            </label>
            <select
              value={formData.month}
              onChange={(e) => setFormData({ ...formData, month: Number(e.target.value) })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500"
              required
            >
              {months.map((name, index) => (
                <option key={index + 1} value={index + 1}>
                  {name} {year}
                </option>
              ))}
            </select>
          </div>

          {/* Salon Name */}
          <div>
            <label className="block text-sm font-medium text-gray-600 mb-1">
              Salon Name
            </label>
            <input
              type="text"
              value={formData.salon_name}
              onChange={(e) => setFormData({ ...formData, salon_name: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500"
            />
          </div>

          {/* ARR Werte */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-600 mb-1">
                Subs ARR (€)
              </label>
              <input
                type="number"
                value={formData.subs_arr}
                onChange={(e) => setFormData({ ...formData, subs_arr: Number(e.target.value) })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500"
                min="0"
                step="0.01"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-600 mb-1">
                Pay ARR (€)
              </label>
              <input
                type="number"
                value={formData.pay_arr}
                onChange={(e) => setFormData({ ...formData, pay_arr: Number(e.target.value) })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500"
                min="0"
                step="0.01"
              />
            </div>
          </div>

          {/* Terminal */}
          <label className="flex items-center space-x-3">
            <input
              type="checkbox"
              checked={formData.has_terminal}
              onChange={(e) => setFormData({ ...formData, has_terminal: e.target.checked })}
              className="w-5 h-5 rounded border-gray-300 text-green-600"
            />
            <span className="text-sm text-gray-700">📱 Terminal</span>
          </label>

          {/* Notizen */}
          <div>
            <label className="block text-sm font-medium text-gray-600 mb-1">
              Notizen (optional)
            </label>
            <textarea
              value={formData.notes}
              onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500"
              rows={2}
              placeholder="Zusätzliche Informationen..."
            />
          </div>

          {/* Summary */}
          <div className="bg-green-50 rounded-lg p-4 text-center">
            <div className="text-sm text-green-700 mb-1">Gesamt ARR</div>
            <div className="text-2xl font-bold text-green-600">
              {formatCurrency(formData.subs_arr + formData.pay_arr)}
            </div>
          </div>
        </form>

        {/* Footer */}
        <div className="p-6 border-t flex justify-end gap-3">
          <button
            onClick={onCancel}
            className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg"
          >
            Abbrechen
          </button>
          <button
            onClick={handleSubmit}
            disabled={saving}
            className="px-6 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50"
          >
            {saving ? 'Erstelle...' : '🚀 Go-Live erstellen'}
          </button>
        </div>
      </div>
    </div>
  );
}
