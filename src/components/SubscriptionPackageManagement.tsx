'use client';

// ============================================================================
// SUBSCRIPTION PACKAGE MANAGEMENT COMPONENT
// Version: v3.18.0
// Pakete anlegen, anzeigen und löschen (für Settings)
// ============================================================================

import { useState, useEffect } from 'react';
import { SubscriptionPackage } from '@/lib/golive-types';
import { loadSubscriptionPackages, createSubscriptionPackage, deleteSubscriptionPackage } from '@/lib/golive-import-hooks';

export default function SubscriptionPackageManagement() {
  // ========== STATE ==========
  const [packages, setPackages] = useState<SubscriptionPackage[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [newPackageName, setNewPackageName] = useState('');
  const [isAdding, setIsAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ========== EFFECTS ==========
  
  useEffect(() => {
    loadPackagesData();
  }, []);

  const loadPackagesData = async () => {
    setIsLoading(true);
    try {
      const data = await loadSubscriptionPackages();
      setPackages(data);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  // ========== HANDLERS ==========

  const handleAddPackage = async () => {
    if (!newPackageName.trim()) return;

    setIsAdding(true);
    setError(null);

    try {
      const newPackage = await createSubscriptionPackage(newPackageName);
      if (newPackage) {
        setPackages(prev => [...prev, newPackage].sort((a, b) => 
          a.name.localeCompare(b.name)
        ));
        setNewPackageName('');
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsAdding(false);
    }
  };

  const handleDeletePackage = async (id: string, name: string) => {
    if (!confirm(`Paket "${name}" wirklich löschen?\n\nHinweis: Bestehende Go-Lives behalten ihre Paket-Zuordnung.`)) {
      return;
    }

    try {
      await deleteSubscriptionPackage(id);
      setPackages(prev => prev.filter(p => p.id !== id));
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
          <h2 className="text-xl font-semibold">📦 Subscription-Paketverwaltung</h2>
          <p className="text-sm text-gray-600">
            Subscription-Pakete (Kickstart, Power, Power Plus, etc.)
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

      {/* Neues Paket */}
      <div className="bg-white p-4 rounded-lg border shadow-sm">
        <h3 className="text-sm font-medium text-gray-700 mb-3">
          ➕ Neues Paket anlegen
        </h3>
        <div className="flex gap-2">
          <input
            type="text"
            className="flex-1 px-3 py-2 border rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500"
            placeholder="z.B. Enterprise"
            value={newPackageName}
            onChange={(e) => setNewPackageName(e.target.value)}
            onKeyPress={(e) => e.key === 'Enter' && handleAddPackage()}
            disabled={isAdding}
          />
          <button
            onClick={handleAddPackage}
            disabled={isAdding || !newPackageName.trim()}
            className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
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

      {/* Paket-Liste */}
      <div className="bg-white rounded-lg border shadow-sm overflow-hidden">
        <div className="px-4 py-3 bg-gray-50 border-b">
          <h3 className="text-sm font-medium text-gray-700">
            📋 Paket-Liste ({packages.length})
          </h3>
        </div>

        {isLoading ? (
          <div className="p-8 text-center text-gray-500">
            <div className="animate-spin text-2xl mb-2">⏳</div>
            Lade Pakete...
          </div>
        ) : packages.length === 0 ? (
          <div className="p-8 text-center text-gray-500">
            <div className="text-4xl mb-2">📦</div>
            <div>Noch keine Pakete angelegt</div>
            <div className="text-sm mt-1">
              Lege Pakete an, um sie bei Go-Lives zuweisen zu können.
            </div>
          </div>
        ) : (
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Paket-Name
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
              {packages.map(pkg => (
                <tr key={pkg.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex items-center">
                      <span className="mr-2">📦</span>
                      <span className="text-sm font-medium text-gray-900">
                        {pkg.name}
                      </span>
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {new Date(pkg.created_at).toLocaleDateString('de-DE', {
                      day: '2-digit',
                      month: '2-digit',
                      year: 'numeric'
                    })}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-right text-sm">
                    <button
                      onClick={() => handleDeletePackage(pkg.id, pkg.name)}
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
      <div className="bg-green-50 border border-green-200 rounded-lg p-4">
        <h4 className="font-medium text-green-800 mb-2">ℹ️ Hinweis</h4>
        <ul className="text-sm text-green-700 space-y-1">
          <li>• Pakete können bei Go-Live Erfassung zugewiesen werden</li>
          <li>• Standard-Pakete: Kickstart, Power, Power Plus</li>
          <li>• Beim Löschen bleiben bestehende Zuordnungen erhalten</li>
        </ul>
      </div>
    </div>
  );
}
