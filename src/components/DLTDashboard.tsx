'use client';

import { useState } from 'react';
import dynamic from 'next/dynamic';
import { User, BUSINESS_AREA_LABELS } from '@/lib/types';
import { useLanguage } from '@/lib/LanguageContext';
import LanguageSelector from './LanguageSelector';
import DLTLeadershipDashboard from './DLTLeadershipDashboard';
import DLTTeamPerformance from './DLTTeamPerformance';
import DLTSettings from './DLTSettings';

const DLTStrategicReports = dynamic(
  () => import('./DLTStrategicReports').then((mod) => ({ default: mod.default })),
  { ssr: false, loading: () => <div className="flex items-center justify-center py-12"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-green-600" /></div> }
);

interface DLTDashboardProps {
  user: User;
  onBack: () => void;
  onSignOut: () => void;
}

type DLTView = 'home' | 'leadership' | 'team' | 'reports' | 'settings';

// Navigation Cards Configuration
const NAV_CARDS: { id: DLTView; icon: string; color: string; borderColor: string; hoverBg: string }[] = [
  { id: 'leadership', icon: '📊', color: 'text-purple-600', borderColor: 'border-l-purple-500', hoverBg: 'hover:bg-purple-50' },
  { id: 'team', icon: '👥', color: 'text-blue-600', borderColor: 'border-l-blue-500', hoverBg: 'hover:bg-blue-50' },
  { id: 'reports', icon: '📈', color: 'text-green-600', borderColor: 'border-l-green-500', hoverBg: 'hover:bg-green-50' },
  { id: 'settings', icon: '⚙️', color: 'text-gray-600', borderColor: 'border-l-gray-500', hoverBg: 'hover:bg-gray-50' },
];

export default function DLTDashboard({ user, onBack, onSignOut }: DLTDashboardProps) {
  const { t } = useLanguage();
  const [currentView, setCurrentView] = useState<DLTView>('home');

  // Header Component (reusable)
  const Header = ({ showBackToHome = false }: { showBackToHome?: boolean }) => (
    <header className="bg-white shadow-sm border-b">
      <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button
            onClick={showBackToHome ? () => setCurrentView('home') : onBack}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
            title={showBackToHome ? t('dlt.backToHome') : t('ui.backToAreaSelector')}
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
              {BUSINESS_AREA_LABELS.dlt} • {user.name}
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
  );

  // Render sub-views
  if (currentView === 'leadership') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-100 to-slate-200">
        <Header showBackToHome />
        <DLTLeadershipDashboard user={user} />
      </div>
    );
  }

  if (currentView === 'team') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-100 to-slate-200">
        <Header showBackToHome />
        <DLTTeamPerformance user={user} />
      </div>
    );
  }

  if (currentView === 'reports') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-100 to-slate-200">
        <Header showBackToHome />
        <DLTStrategicReports user={user} />
      </div>
    );
  }

  if (currentView === 'settings') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-100 to-slate-200">
        <Header showBackToHome />
        <DLTSettings user={user} />
      </div>
    );
  }

  // Home View with Navigation Cards
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-100 to-slate-200">
      <Header />

      {/* Main Content */}
      <main className="max-w-4xl mx-auto px-4 py-12">
        {/* Title Section */}
        <div className="text-center mb-12">
          <div className="text-7xl mb-4">👔</div>
          <h2 className="text-3xl font-bold text-gray-800 mb-2">
            {BUSINESS_AREA_LABELS.dlt}
          </h2>
          <p className="text-gray-600">
            Director Leadership Team
          </p>
        </div>

        {/* Navigation Cards Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-12">
          {NAV_CARDS.map((card) => (
            <button
              key={card.id}
              onClick={() => setCurrentView(card.id)}
              className={`bg-white rounded-xl shadow-md p-6 text-left border-l-4 ${card.borderColor} ${card.hoverBg} transition-all hover:shadow-lg hover:-translate-y-1 group`}
            >
              <div className="flex items-start justify-between">
                <div>
                  <div className={`text-4xl mb-3 ${card.color}`}>
                    {card.icon}
                  </div>
                  <h3 className="text-lg font-semibold text-gray-800 mb-1">
                    {t(`dlt.nav.${card.id}`)}
                  </h3>
                  <p className="text-sm text-gray-500">
                    {t(`dlt.nav.${card.id}Desc`)}
                  </p>
                </div>
                <svg 
                  className="w-5 h-5 text-gray-400 group-hover:text-gray-600 group-hover:translate-x-1 transition-all" 
                  fill="none" 
                  stroke="currentColor" 
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </div>
            </button>
          ))}
        </div>

        {/* Back Button */}
        <div className="text-center">
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
