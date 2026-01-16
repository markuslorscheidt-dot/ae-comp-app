'use client';

// ============================================================================
// PARTNER MANAGEMENT COMPONENT
// Version: v3.17.0
// Partner anlegen, anzeigen und löschen (für Settings)
// ============================================================================

import { useState, useEffect } from 'react';
import { Partner } from '@/lib/golive-types';
import { loadPartners, createPartner, deletePartner } from '@/lib/golive-import-hooks';

export default function PartnerManagement() {
  // ========== STATE ==========
  const [partners, setPartners] = useState<Partner[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [newPartnerName, setNewPartnerName] = useState('');
  const [isAdding, setIsAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ========== EFFECTS ==========
  
  useEffect(() => {
    loadPartnersData();
  }, []);

  const loadPartnersData = async () => {
    setIsLoading(true);
    try {
      const data = await loadPartners();
      setPartners(data);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  // ========== HANDLERS ==========

  const handleAddPartner = async () => {
    if (!newPartnerName.trim()) return;

    setIsAdding(true);
    setError(null);

    try {
      const newPartner = await createPartner(newPartnerName);
      if (newPartner) {
        setPartners(prev => [...prev, newPartner].sort((a, b) => 
          a.name.localeCompare(b.name)
        ));
        setNewPartnerName('');
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsAdding(false);
    }
  };

  const handleDeletePartner = async (id: string, name: string) => {
    if (!confirm(`Partner "${name}" wirklich löschen?\n\nHinweis: Bestehende Go-Lives behalten ihre Partner-Zuordnung.`)) {
      return;
    }

    try {
      await deletePartner(id);
      setPartners(prev => prev.filter(p => p.id !== id));
    } catch (err: any) {
      setError(err.message);
    }
  };

  // ========== RENDER ==========

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold">🤝 Partner-Verwaltung</h2>
          <p className="text-sm text-gray-600">
            Partner für Partnership-Deals (L'Oréal, Wella, etc.)
          </p>
        </div>
      </div>

      {/* Error Message */}
      {error && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-red-700">
          ⚠️ {error}
          <button
            onClick={() => setError(null)}
            className="ml-2 text-red-500 hover:text-red-700"
          >
            ✕
          </button>
        </div>
      )}

      {/* Neuer Partner */}
      <div className="bg-white p-4 rounded-lg border shadow-sm">
        <h3 className="text-sm font-medium text-gray-700 mb-3">
          ➕ Neuen Partner anlegen
        </h3>
        <div className="flex gap-2">
          <input
            type="text"
            className="flex-1 px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            placeholder="z.B. L'Oréal Professional"
            value={newPartnerName}
            onChange={(e) => setNewPartnerName(e.target.value)}
            onKeyPress={(e) => e.key === 'Enter' && handleAddPartner()}
            disabled={isAdding}
          />
          <button
            onClick={handleAddPartner}
            disabled={isAdding || !newPartnerName.trim()}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {isAdding ? (
              <span className="flex items-center gap-2">
                <span className="animate-spin">⏳</span>
                Anlegen...
              </span>
            ) : (
              'Anlegen'
            )}
          </button>
        </div>
      </div>

      {/* Partner-Liste */}
      <div className="bg-white rounded-lg border shadow-sm overflow-hidden">
        <div className="px-4 py-3 bg-gray-50 border-b">
          <h3 className="text-sm font-medium text-gray-700">
            📋 Partner-Liste ({partners.length})
          </h3>
        </div>

        {isLoading ? (
          <div className="p-8 text-center text-gray-500">
            <div className="animate-spin text-2xl mb-2">⏳</div>
            Lade Partner...
          </div>
        ) : partners.length === 0 ? (
          <div className="p-8 text-center text-gray-500">
            <div className="text-4xl mb-2">🤝</div>
            <div>Noch keine Partner angelegt</div>
            <div className="text-sm mt-1">
              Lege Partner an, um sie bei Go-Live Imports zuweisen zu können.
            </div>
          </div>
        ) : (
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Partner-Name
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Erstellt am
                </th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Aktionen
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {partners.map(partner => (
                <tr key={partner.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex items-center">
                      <span className="mr-2">🏢</span>
                      <span className="text-sm font-medium text-gray-900">
                        {partner.name}
                      </span>
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {new Date(partner.created_at).toLocaleDateString('de-DE', {
                      day: '2-digit',
                      month: '2-digit',
                      year: 'numeric'
                    })}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-right text-sm">
                    <button
                      onClick={() => handleDeletePartner(partner.id, partner.name)}
                      className="text-red-600 hover:text-red-900 hover:underline"
                    >
                      Löschen
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Info Box */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
        <h4 className="font-medium text-blue-800 mb-2">ℹ️ Hinweis</h4>
        <ul className="text-sm text-blue-700 space-y-1">
          <li>• Partner werden bei Go-Live Imports zugewiesen</li>
          <li>• Partner-Deals zählen zum ARR-Target von Head of Partnerships</li>
          <li>• Beim Löschen bleiben bestehende Zuordnungen erhalten</li>
        </ul>
      </div>
    </div>
  );
}
