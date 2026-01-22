'use client';

import { useState } from 'react';
import { useAuth } from '@/lib/hooks';
import { LanguageProvider } from '@/lib/LanguageContext';
import { DataSourceProvider } from '@/lib/DataSourceContext';
import { BusinessArea } from '@/lib/types';
import AuthForm from '@/components/AuthForm';
import AreaSelector from '@/components/AreaSelector';
import AreaPlaceholder from '@/components/AreaPlaceholder';
import Dashboard from '@/components/Dashboard';
import AdminPanel from '@/components/AdminPanel';
import LanguageSelector from '@/components/LanguageSelector';
import { ToastProvider } from '@/components/Toast';
import { useLanguage } from '@/lib/LanguageContext';
import { User } from '@/lib/types';

// Wrapper für Admin-Panel vom Startbildschirm aus
function GlobalAdminWrapper({ user, onBack, onSignOut }: { user: User; onBack: () => void; onSignOut: () => void }) {
  const { t } = useLanguage();
  
  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white shadow-sm border-b sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button
              onClick={onBack}
              className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
              title="Zurück zur Bereichsauswahl"
            >
              <svg className="w-5 h-5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <div>
              <h1 className="text-xl font-bold text-gray-800">Commercial Business Planner</h1>
              <p className="text-xs text-gray-500">Admin-Bereich • {user.name}</p>
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

      {/* Admin Panel */}
      <main className="max-w-7xl mx-auto px-4 py-8">
        <AdminPanel currentUser={user} onBack={onBack} />
      </main>
    </div>
  );
}

function AppContent() {
  const { user, loading, signIn, signUp, signOut } = useAuth();
  const [selectedArea, setSelectedArea] = useState<BusinessArea | null>(null);
  const [showAdmin, setShowAdmin] = useState(false);

  // Loading State
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 via-blue-900 to-slate-900">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-white mx-auto"></div>
          <p className="mt-4 text-white text-lg">Laden...</p>
        </div>
      </div>
    );
  }

  // Not logged in - show Auth Form
  if (!user) {
    return <AuthForm onSignIn={signIn} onSignUp={signUp} />;
  }

  // Show Admin Panel (from Area Selector)
  if (showAdmin && !selectedArea) {
    return (
      <GlobalAdminWrapper 
        user={user} 
        onBack={() => setShowAdmin(false)} 
        onSignOut={signOut} 
      />
    );
  }

  // Logged in but no area selected - show Area Selector
  if (!selectedArea) {
    return (
      <AreaSelector 
        user={user} 
        onSelectArea={setSelectedArea}
        onOpenAdmin={() => setShowAdmin(true)}
        onSignOut={signOut}
      />
    );
  }

  // Area selected - show appropriate content
  // New Business uses the existing Dashboard
  if (selectedArea === 'new_business') {
    return (
      <Dashboard 
        user={user} 
        onSignOut={signOut}
        selectedArea={selectedArea}
        onBackToAreaSelector={() => setSelectedArea(null)}
      />
    );
  }

  // Other areas show placeholder
  return (
    <AreaPlaceholder
      area={selectedArea}
      userName={user.name}
      onBack={() => setSelectedArea(null)}
      onSignOut={signOut}
    />
  );
}

export default function Home() {
  const { user } = useAuth();
  
  return (
    <LanguageProvider userId={user?.id}>
      <DataSourceProvider>
        <ToastProvider>
          <AppContent />
        </ToastProvider>
      </DataSourceProvider>
    </LanguageProvider>
  );
}
