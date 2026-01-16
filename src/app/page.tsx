'use client';

import { useAuth } from '@/lib/hooks';
import { LanguageProvider } from '@/lib/LanguageContext';
import { DataSourceProvider } from '@/lib/DataSourceContext';
import AuthForm from '@/components/AuthForm';
import Dashboard from '@/components/Dashboard';
import { ToastProvider } from '@/components/Toast';

function AppContent() {
  const { user, loading, signIn, signUp, signOut } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-600 to-blue-800">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-white mx-auto"></div>
          <p className="mt-4 text-white text-lg">Laden...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return <AuthForm onSignIn={signIn} onSignUp={signUp} />;
  }

  return <Dashboard user={user} onSignOut={signOut} />;
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
