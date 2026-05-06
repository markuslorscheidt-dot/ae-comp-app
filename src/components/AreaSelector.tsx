'use client';

import { useState } from 'react';
import { User, BusinessArea, canAccessArea } from '@/lib/types';
import { useLanguage } from '@/lib/LanguageContext';
import { hasAdminAccess } from '@/lib/permissions';
import LanguageSelector from './LanguageSelector';

interface AreaSelectorProps {
  user: User;
  onSelectArea: (area: BusinessArea) => void;
  onOpenAdmin: () => void;
  onSignOut: () => void;
}

const VISIBLE_BUSINESS_AREAS: BusinessArea[] = ['dlt', 'new_business'];

// Icons für die Bereiche
const AREA_ICONS: Record<BusinessArea, string> = {
  dlt: '👔',
  new_business: '🚀',
  expanding_business: '📈',
  marketing: '📣'
};

export default function AreaSelector({ user, onSelectArea, onOpenAdmin, onSignOut }: AreaSelectorProps) {
  const { t } = useLanguage();
  const [selectedArea, setSelectedArea] = useState<BusinessArea | ''>('');
  
  // Ermittle die Bereiche, auf die der User zugreifen kann
  const accessibleAreas = VISIBLE_BUSINESS_AREAS.filter(area => canAccessArea(user.role, area));
  
  // Prüfe ob User Admin-Zugang hat
  const canAccessAdmin = hasAdminAccess(user.role);
  
  // Wenn nur ein Bereich verfügbar ist, direkt dorthin
  // (Auskommentiert - User soll immer die Auswahl sehen)
  // if (accessibleAreas.length === 1) {
  //   onSelectArea(accessibleAreas[0]);
  //   return null;
  // }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-900 to-slate-900">
      {/* Header - Responsive */}
      <header className="bg-white/10 backdrop-blur-sm border-b border-white/10">
        <div className="max-w-7xl mx-auto px-4 py-3 md:py-4">
          {/* Mobile: Stack layout, Desktop: Flex */}
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 sm:gap-4">
            <div className="min-w-0">
              <h1 className="text-xl md:text-2xl font-bold text-white truncate">
                Commercial Business Planner
              </h1>
              <p className="text-sm text-blue-200 truncate">
                {user.name} • {t(`roles.${user.role}`)}
              </p>
            </div>
            
            <div className="flex items-center gap-2 sm:gap-4 flex-wrap">
              {/* Admin Button */}
              {canAccessAdmin && (
                <button
                  onClick={onOpenAdmin}
                  className="px-3 py-2 text-sm font-medium text-white bg-white/20 hover:bg-white/30 rounded-lg transition-colors flex items-center gap-2"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                  <span className="hidden sm:inline">Admin</span>
                </button>
              )}
              <LanguageSelector />
              <button
                onClick={onSignOut}
                className="px-3 py-2 text-sm text-white/80 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
              >
                {t('auth.logout')}
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content - Responsive */}
      <main className="max-w-5xl mx-auto px-4 py-8 md:py-16">
        <div className="text-center mb-4 md:mb-5">
          <h2 className="text-2xl md:text-3xl font-bold text-white mb-2">
            {t('areas.selectArea')}
          </h2>
        </div>

        {/* Area Dropdown */}
        <div className="mx-auto max-w-xl rounded-2xl border border-white/20 bg-white/10 p-4 shadow-xl backdrop-blur-sm md:p-6">
          <label htmlFor="business-area-select" className="mb-2 block text-sm font-medium text-blue-100">
            Arbeitsbereich
          </label>
          <div className="flex flex-col gap-3 sm:flex-row">
            <select
              id="business-area-select"
              value={selectedArea}
              onChange={(e) => setSelectedArea(e.target.value as BusinessArea | '')}
              className="min-h-12 flex-1 rounded-xl border border-white/20 bg-white px-4 py-3 text-base font-medium text-gray-800 shadow-sm focus:border-blue-300 focus:outline-none focus:ring-2 focus:ring-blue-300"
            >
              <option value="">Bereich auswählen...</option>
              {VISIBLE_BUSINESS_AREAS.map(area => {
                const isAccessible = accessibleAreas.includes(area);

                return (
                  <option key={area} value={area} disabled={!isAccessible}>
                    {AREA_ICONS[area]} {t(`areas.${area}`)}
                  </option>
                );
              })}
            </select>
            <button
              type="button"
              disabled={!selectedArea}
              onClick={() => selectedArea && onSelectArea(selectedArea)}
              className="min-h-12 rounded-xl bg-white px-5 py-3 text-base font-semibold text-blue-900 shadow-sm transition hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Öffnen
            </button>
          </div>
        </div>

        {/* Info Text */}
        <p className="text-center text-blue-200/60 mt-6 md:mt-8 text-xs md:text-sm">
          {t('areas.accessInfo', { accessible: accessibleAreas.length, total: VISIBLE_BUSINESS_AREAS.length })}
        </p>
      </main>
    </div>
  );
}
