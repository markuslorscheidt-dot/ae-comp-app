'use client';

import { useState } from 'react';
import { User, BusinessArea, BUSINESS_AREAS, BUSINESS_AREA_LABELS, canAccessArea } from '@/lib/types';
import { useLanguage } from '@/lib/LanguageContext';
import { hasAdminAccess } from '@/lib/permissions';
import LanguageSelector from './LanguageSelector';

interface AreaSelectorProps {
  user: User;
  onSelectArea: (area: BusinessArea) => void;
  onOpenAdmin: () => void;
  onSignOut: () => void;
}

// Icons für die Bereiche
const AREA_ICONS: Record<BusinessArea, string> = {
  dlt: '👔',
  new_business: '🚀',
  expanding_business: '📈',
  marketing: '📣'
};

// Farben für die Bereiche
const AREA_COLORS: Record<BusinessArea, { bg: string; border: string; hover: string }> = {
  dlt: { 
    bg: 'bg-purple-50', 
    border: 'border-purple-200', 
    hover: 'hover:border-purple-400 hover:bg-purple-100' 
  },
  new_business: { 
    bg: 'bg-blue-50', 
    border: 'border-blue-200', 
    hover: 'hover:border-blue-400 hover:bg-blue-100' 
  },
  expanding_business: { 
    bg: 'bg-green-50', 
    border: 'border-green-200', 
    hover: 'hover:border-green-400 hover:bg-green-100' 
  },
  marketing: { 
    bg: 'bg-orange-50', 
    border: 'border-orange-200', 
    hover: 'hover:border-orange-400 hover:bg-orange-100' 
  }
};

export default function AreaSelector({ user, onSelectArea, onOpenAdmin, onSignOut }: AreaSelectorProps) {
  const { t } = useLanguage();
  
  // Ermittle die Bereiche, auf die der User zugreifen kann
  const accessibleAreas = BUSINESS_AREAS.filter(area => canAccessArea(user.role, area));
  
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
        <div className="text-center mb-8 md:mb-12">
          <h2 className="text-2xl md:text-3xl font-bold text-white mb-2">
            {t('areas.selectArea')}
          </h2>
          <p className="text-blue-200 text-sm md:text-base">
            {t('areas.selectAreaSubtitle')}
          </p>
        </div>

        {/* Area Cards Grid - Responsive */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 md:gap-6">
          {BUSINESS_AREAS.map(area => {
            const isAccessible = accessibleAreas.includes(area);
            const colors = AREA_COLORS[area];
            
            return (
              <button
                key={area}
                onClick={() => isAccessible && onSelectArea(area)}
                disabled={!isAccessible}
                className={`
                  relative p-5 md:p-8 rounded-xl md:rounded-2xl border-2 text-left transition-all duration-200
                  ${isAccessible 
                    ? `${colors.bg} ${colors.border} ${colors.hover} cursor-pointer transform active:scale-[0.98] md:hover:scale-[1.02] hover:shadow-xl` 
                    : 'bg-gray-100 border-gray-200 opacity-50 cursor-not-allowed'
                  }
                `}
              >
                {/* Icon */}
                <div className="text-4xl md:text-5xl mb-3 md:mb-4">
                  {AREA_ICONS[area]}
                </div>
                
                {/* Title */}
                <h3 className={`text-xl md:text-2xl font-bold mb-1 md:mb-2 ${isAccessible ? 'text-gray-800' : 'text-gray-500'}`}>
                  {t(`areas.${area}`)}
                </h3>
                
                {/* Description based on area */}
                <p className={`text-xs md:text-sm ${isAccessible ? 'text-gray-600' : 'text-gray-400'}`}>
                  {area === 'dlt' && 'Leadership Dashboards & Übersichten'}
                  {area === 'new_business' && 'Go-Lives, Pipeline, Provision & mehr'}
                  {area === 'expanding_business' && 'Customer Success & Revenue Expansion'}
                  {area === 'marketing' && 'Leadgenerierung & Kampagnen'}
                </p>

                {/* Lock indicator for inaccessible areas */}
                {!isAccessible && (
                  <div className="absolute top-3 right-3 md:top-4 md:right-4 text-gray-400">
                    <svg className="w-5 h-5 md:w-6 md:h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                    </svg>
                  </div>
                )}

                {/* Arrow for accessible areas */}
                {isAccessible && (
                  <div className="absolute bottom-3 right-3 md:bottom-4 md:right-4 text-gray-400">
                    <svg className="w-5 h-5 md:w-6 md:h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                    </svg>
                  </div>
                )}
              </button>
            );
          })}
        </div>

        {/* Info Text */}
        <p className="text-center text-blue-200/60 mt-6 md:mt-8 text-xs md:text-sm">
          Du hast Zugriff auf {accessibleAreas.length} von {BUSINESS_AREAS.length} Bereichen
        </p>
      </main>
    </div>
  );
}
