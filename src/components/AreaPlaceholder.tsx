'use client';

import { BusinessArea, BUSINESS_AREA_LABELS } from '@/lib/types';
import { useLanguage } from '@/lib/LanguageContext';
import LanguageSelector from './LanguageSelector';

interface AreaPlaceholderProps {
  area: BusinessArea;
  userName: string;
  onBack: () => void;
  onSignOut: () => void;
}

// Icons für die Bereiche
const AREA_ICONS: Record<BusinessArea, string> = {
  dlt: '👔',
  new_business: '🚀',
  expanding_business: '📈',
  marketing: '📣'
};

export default function AreaPlaceholder({ area, userName, onBack, onSignOut }: AreaPlaceholderProps) {
  const { t } = useLanguage();

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-100 to-slate-200">
      {/* Header */}
      <header className="bg-white shadow-sm border-b">
        <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button
              onClick={onBack}
              className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
              title={t('ui.backToAreaSelector')}
            >
              <svg className="w-5 h-5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <div>
              <h1 className="text-xl font-bold text-gray-800">
                Commercial Business Planner
              </h1>
              <p className="text-sm text-gray-500">
                {BUSINESS_AREA_LABELS[area]} • {userName}
              </p>
            </div>
          </div>
          
          <div className="flex items-center gap-4">
            <LanguageSelector />
            <button
              onClick={onSignOut}
              className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded-lg transition-colors"
            >
              {t('auth.logout')}
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-2xl mx-auto px-4 py-24">
        <div className="bg-white rounded-2xl shadow-lg p-12 text-center">
          {/* Icon */}
          <div className="text-8xl mb-6">
            {AREA_ICONS[area]}
          </div>
          
          {/* Title */}
          <h2 className="text-3xl font-bold text-gray-800 mb-4">
            {BUSINESS_AREA_LABELS[area]}
          </h2>
          
          {/* Coming Soon */}
          <div className="inline-flex items-center gap-2 bg-yellow-100 text-yellow-800 px-4 py-2 rounded-full text-sm font-medium mb-6">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            {t('areas.comingSoon')}
          </div>
          
          {/* Description */}
          <p className="text-gray-600 mb-8">
            {t('areas.comingSoonDesc')}
          </p>

          {/* Features Preview based on area */}
          <div className="text-left bg-gray-50 rounded-xl p-6 mb-8">
            <h3 className="font-semibold text-gray-700 mb-3">Geplante Features:</h3>
            <ul className="space-y-2 text-sm text-gray-600">
              {area === 'dlt' && (
                <>
                  <li className="flex items-center gap-2">
                    <span className="text-purple-500">●</span>
                    Leadership Dashboard mit KPIs aller Bereiche
                  </li>
                  <li className="flex items-center gap-2">
                    <span className="text-purple-500">●</span>
                    Team-Performance Übersichten
                  </li>
                  <li className="flex items-center gap-2">
                    <span className="text-purple-500">●</span>
                    Strategische Reports & Analytics
                  </li>
                </>
              )}
              {area === 'expanding_business' && (
                <>
                  <li className="flex items-center gap-2">
                    <span className="text-green-500">●</span>
                    Customer Success Dashboard
                  </li>
                  <li className="flex items-center gap-2">
                    <span className="text-green-500">●</span>
                    Upselling & Cross-Selling Tracking
                  </li>
                  <li className="flex items-center gap-2">
                    <span className="text-green-500">●</span>
                    Churn Prevention & Health Scores
                  </li>
                </>
              )}
              {area === 'marketing' && (
                <>
                  <li className="flex items-center gap-2">
                    <span className="text-orange-500">●</span>
                    Lead Generation Dashboard
                  </li>
                  <li className="flex items-center gap-2">
                    <span className="text-orange-500">●</span>
                    Campaign Performance Tracking
                  </li>
                  <li className="flex items-center gap-2">
                    <span className="text-orange-500">●</span>
                    Marketing Qualified Leads (MQL) Pipeline
                  </li>
                </>
              )}
            </ul>
          </div>
          
          {/* Back Button */}
          <button
            onClick={onBack}
            className="px-6 py-3 bg-gray-800 text-white rounded-lg hover:bg-gray-700 transition-colors"
          >
            ← {t('ui.backToAreaSelector')}
          </button>
        </div>
      </main>
    </div>
  );
}
