'use client';

import { useState, useEffect, useMemo } from 'react';
import { User, GoLive, AESettings, isPlannable, canReceiveGoLives, getDefaultCommissionRelevant, Challenge } from '@/lib/types';
import { useAllUsers, useSettingsForUser, useGoLivesForUser, useMultiUserData, updateGoLiveUniversal, deleteGoLiveUniversal, useChallenges, calculateChallengeProgress } from '@/lib/hooks';
import { useLanguage } from '@/lib/LanguageContext';
import { useDataSource } from '@/lib/DataSourceContext';
import { 
  DataSource, 
  SCENARIO_LABELS, 
  useDemoData, 
  isDemoScenario, 
  DEMO_USERS, 
  ALL_DEMO_USERS, 
  DEMO_SETTINGS, 
  DEMO_CHALLENGES 
} from '@/lib/demo-data';
import { 
  calculateYearSummary,
  calculateYTDSummary,
  formatCurrency, 
  formatPercent,
  getAchievementColor,
  getAchievementBgColor
} from '@/lib/calculations';
import { getPermissions } from '@/lib/permissions';
import GoLiveForm from './GoLiveForm';
import MonthDetail from './MonthDetail';
import YearOverview from './YearOverview';
import AdminPanel from './AdminPanel';
import SettingsPanel from './SettingsPanel';
import LanguageSelector from './LanguageSelector';
import UserSelector from './UserSelector';
import Leaderboard from './Leaderboard';
import UserProfile from './UserProfile';
import DebugPanel from './DebugPanel';
import Pipeline from './Pipeline';
import GoLiveImport from './GoLiveImport';
import { AchievementGauges } from './TrendCharts';
import { useToast, useChallengeNotifications } from './Toast';
import { supabase } from '@/lib/supabase';

interface DashboardProps {
  user: User;
  onSignOut: () => void;
}

type View = 'dashboard' | 'month' | 'year' | 'add' | 'admin' | 'settings' | 'leaderboard' | 'profile' | 'pipeline' | 'golive_import';

export default function Dashboard({ user, onSignOut }: DashboardProps) {
  const { t } = useLanguage();
  const { dataSource, setDataSource, isDemo, scenarioLabel } = useDataSource();
  const permissions = getPermissions(user.role);
  
  // Prüfen ob User Admin ist (für Demo-Dropdown)
  const canAccessDemo = permissions.hasAdminAccess; // Country Manager oder Line Manager
  
  // ========== PRODUKTIONS-DATEN (laufen immer) ==========
  // Load all users (for managers)
  const { users: prodUsers, loading: usersLoading } = useAllUsers();
  
  // ========== DEMO-DATEN ==========
  // Demo-Daten basierend auf Szenario (nur aufrufen wenn Demo aktiv)
  const demoScenario = isDemoScenario(dataSource) ? dataSource : 'demo-100';
  const demoData = useDemoData(demoScenario);
  
  // ========== AKTIVE DATEN (je nach Modus) ==========
  const allUsers = isDemo ? ALL_DEMO_USERS : prodUsers;
  
  // Planbare Rollen (nur AE) - diese haben Targets und Provisionsberechnung
  const plannableUsers = allUsers.filter(u => isPlannable(u.role));
  
  // Alle User die Go-Lives erhalten können (AE, LM, CM, Sonstiges) - für Go-Live Erfassung UND Anzeige
  const goLiveReceivers = allUsers.filter(u => canReceiveGoLives(u.role));
  
  // Für Settings: Nur planbare User (AEs)
  const selectableAEs = isDemo 
    ? DEMO_USERS  // Im Demo immer alle Demo-AEs
    : (permissions.viewAllUsers 
        ? plannableUsers
        : plannableUsers.filter(u => u.id === user.id));

  // Für Anzeige/View: Alle User die Go-Lives erhalten können (inkl. Manager)
  const selectableForView = isDemo
    ? DEMO_USERS  // Im Demo nur Demo-AEs
    : (permissions.viewAllUsers
        ? goLiveReceivers
        : goLiveReceivers.filter(u => u.id === user.id));

  // Selected user for Settings and Go-Live entry (muss planbar sein)
  const [selectedUserId, setSelectedUserId] = useState<string>(
    isPlannable(user.role) ? user.id : (plannableUsers[0]?.id || user.id)
  );
  
  // Selected user for Profile view (kann jeder sein)
  const [profileUserId, setProfileUserId] = useState<string>(user.id);
  
  // Selected users for Year Overview (alle Go-Live Empfänger + GESAMT für AEs)
  const [selectedViewUserIds, setSelectedViewUserIds] = useState<string[]>(
    canReceiveGoLives(user.role) ? [user.id] : (goLiveReceivers[0]?.id ? [goLiveReceivers[0].id] : [])
  );

  // Bei Demo-Modus Wechsel: User-IDs auf Demo-User setzen
  useEffect(() => {
    if (isDemo && DEMO_USERS.length > 0) {
      setSelectedUserId(DEMO_USERS[0].id);
      setSelectedViewUserIds([DEMO_USERS[0].id]);
      setProfileUserId(DEMO_USERS[0].id);
    } else if (!isDemo && user) {
      // Zurück zu Produktion: Eigenen User setzen
      setSelectedUserId(isPlannable(user.role) ? user.id : (prodUsers.filter(u => isPlannable(u.role))[0]?.id || user.id));
      setSelectedViewUserIds([user.id]);
      setProfileUserId(user.id);
    }
  }, [isDemo, user, prodUsers]);
  
  // ========== PRODUKTIONS-DATEN HOOKS ==========
  // Sichere User-ID: Wenn Demo-ID erkannt wird, verwende echten User
  const isDemoUserId = (id: string) => id.startsWith('demo-');
  const safeSelectedUserId = isDemoUserId(selectedUserId) ? user.id : selectedUserId;
  
  const { 
    settings: prodSettings, 
    loading: settingsLoading, 
    error: settingsError, 
    updateSettings 
  } = useSettingsForUser(isDemo ? undefined : safeSelectedUserId);
  
  const { 
    goLives: prodGoLives, 
    loading: goLivesLoading, 
    addGoLive, 
    updateGoLive, 
    deleteGoLive,
    refetch: refetchGoLives
  } = useGoLivesForUser(isDemo ? undefined : safeSelectedUserId);

  // Load multi-user data for comparison/total view
  const isAllSelected = selectedViewUserIds.includes('all');
  const viewUserIds = isAllSelected 
    ? goLiveReceivers.map(u => u.id)  // Alle Go-Live Empfänger (AE, LM, CM, Sonstiges)
    : selectedViewUserIds;
  
  // Alle User IDs die Go-Lives empfangen können (für Multi-User Daten)
  // Im Demo-Modus leeres Array, um keine Supabase-Calls mit Demo-IDs zu machen
  const allGoLiveReceiverIds = isDemo ? [] : goLiveReceivers.map(u => u.id);
  
  // Nur plannable User IDs für Settings-Summierung bei GESAMT
  const plannableUserIds = isDemo ? [] : plannableUsers.map(u => u.id);
  
  const { 
    settings: prodMultiSettings, 
    goLives: prodMultiGoLives, 
    combined: prodCombined,
    loading: multiLoading,
    refetch: refetchMulti
  } = useMultiUserData(
    allGoLiveReceiverIds.length > 0 ? allGoLiveReceiverIds : [],
    2026,
    plannableUserIds
  );

  // ========== AKTIVE DATEN (je nach Modus) ==========
  // Settings für ausgewählten User
  const settings = useMemo(() => {
    if (isDemo) {
      return demoData.settingsMap.get(selectedUserId) || Array.from(demoData.settingsMap.values())[0];
    }
    return prodSettings;
  }, [isDemo, demoData, selectedUserId, prodSettings]);
  
  // Go-Lives für ausgewählten User  
  const goLives = useMemo(() => {
    if (isDemo) {
      return demoData.goLivesMap.get(selectedUserId) || [];
    }
    return prodGoLives;
  }, [isDemo, demoData, selectedUserId, prodGoLives]);
  
  // Multi-User Settings und Go-Lives
  const multiSettings = useMemo(() => {
    if (isDemo) {
      return demoData.settingsMap;
    }
    return prodMultiSettings;
  }, [isDemo, demoData, prodMultiSettings]);
  
  const multiGoLives = useMemo(() => {
    if (isDemo) {
      return demoData.goLivesMap;
    }
    return prodMultiGoLives;
  }, [isDemo, demoData, prodMultiGoLives]);
  
  // Combined (für GESAMT-Ansicht) - im Demo-Modus aggregieren
  const combined = useMemo(() => {
    if (!isDemo) return prodCombined;
    
    // Demo: Aggregiere alle Settings und Go-Lives
    const allDemoSettings = Array.from(demoData.settingsMap.values());
    const allDemoGoLives = demoData.allGoLives;
    
    // Basis-Settings vom ersten User nehmen und Werte summieren
    const baseSettings = allDemoSettings[0];
    if (!baseSettings) return prodCombined;
    
    return {
      settings: {
        ...baseSettings, // Alle Felder vom Basis-Settings
        id: 'combined',
        user_id: 'all',
        ote: allDemoSettings.reduce((sum, s) => sum + (s.ote || 0), 0),
        monthly_subs_targets: baseSettings.monthly_subs_targets.map((_: number, i: number) => 
          allDemoSettings.reduce((sum, s) => sum + (s.monthly_subs_targets?.[i] || 0), 0)
        ),
        monthly_pay_targets: baseSettings.monthly_pay_targets.map((_: number, i: number) => 
          allDemoSettings.reduce((sum, s) => sum + (s.monthly_pay_targets?.[i] || 0), 0)
        ),
        monthly_go_live_targets: baseSettings.monthly_go_live_targets.map((_: number, i: number) => 
          allDemoSettings.reduce((sum, s) => sum + (s.monthly_go_live_targets?.[i] || 0), 0)
        ),
      } as AESettings,
      goLives: allDemoGoLives,
    };
  }, [isDemo, demoData, prodCombined]);

  // Universal Update-Wrapper für YearOverview (kann User wechseln und lädt alle Daten neu)
  const handleUniversalUpdate = async (id: string, updates: Partial<GoLive>) => {
    const result = await updateGoLiveUniversal(id, updates);
    if (!result.error) {
      // Nach erfolgreichem Update alle Daten neu laden
      await refetchGoLives();
      await refetchMulti();
    }
    return result;
  };

  // Universal Delete-Wrapper
  const handleUniversalDelete = async (id: string) => {
    const result = await deleteGoLiveUniversal(id);
    if (!result.error) {
      await refetchGoLives();
      await refetchMulti();
    }
    return result;
  };

  // Challenges laden für Dashboard Widget
  const { challenges: prodChallenges } = useChallenges();
  
  // Aktive Daten: Challenges
  const challenges = useMemo(() => {
    if (isDemo) {
      return demoData.challenges;
    }
    return prodChallenges;
  }, [isDemo, demoData, prodChallenges]);
  
  const activeChallenges = useMemo(() => {
    return challenges.filter((c: Challenge) => c.is_active);
  }, [challenges]);

  // Challenge Progress für Benachrichtigungen berechnen
  const challengeProgressMap = useMemo(() => {
    const map = new Map<string, { is_completed: boolean; days_remaining: number; progress_percent: number }>();
    const allGoLivesForProgress = isDemo
      ? demoData.allGoLives 
      : Array.from(multiGoLives.values()).flat();
    
    activeChallenges.forEach((challenge: Challenge) => {
      const progress = calculateChallengeProgress(challenge, allGoLivesForProgress);
      map.set(challenge.id, {
        is_completed: progress.is_completed,
        days_remaining: progress.days_remaining,
        progress_percent: progress.progress_percent,
      });
    });
    return map;
  }, [activeChallenges, multiGoLives, isDemo, demoData]);

  // Challenge-Benachrichtigungen aktivieren
  useChallengeNotifications(activeChallenges, challengeProgressMap);

  const [currentView, setCurrentView] = useState<View>('dashboard');
  const [selectedMonth, setSelectedMonth] = useState<number>(new Date().getMonth() + 1);

  const currentMonth = new Date().getMonth() + 1;

  // Get the selected user object
  const selectedUser = allUsers.find(u => u.id === selectedUserId) || user;

  // Loading state
  const loading = settingsLoading || goLivesLoading || usersLoading;

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">{t('common.loading')}</p>
        </div>
      </div>
    );
  }

  if (settingsError || !settings) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="bg-white p-8 rounded-xl shadow-lg max-w-md text-center">
          <h2 className="text-xl font-bold text-gray-800 mb-2">{t('common.error')}</h2>
          <p className="text-gray-600">{settingsError || t('errors.noSettings')}</p>
        </div>
      </div>
    );
  }

  const yearSummary = calculateYearSummary(goLives, settings);
  const ytdSummary = calculateYTDSummary(goLives, settings, currentMonth);

  const handleAddGoLive = async (goLive: Partial<GoLive>) => {
    const result = await addGoLive({ 
      ...goLive, 
      user_id: selectedUserId, 
      year: settings.year 
    });
    // Nach erfolgreichem Speichern: Multi-User Daten neu laden für Jahresübersicht
    if (!result.error) {
      refetchMulti();
    }
    // View bleibt auf 'add' für schnelle Dateneingabe
    // Das Formular wird automatisch zurückgesetzt durch GoLiveForm
    return result;
  };

  // Navigation Component
  const Navigation = () => (
    <nav className="bg-white shadow-sm border-b sticky top-0 z-10">
      <div className="max-w-7xl mx-auto px-4">
        <div className="flex items-center justify-between h-16">
          <div className="flex items-center space-x-4">
            <h1 className="text-xl font-bold text-gray-800">{t('dashboard.title')}</h1>
            <span className="text-sm text-gray-500">{settings.year} • {settings.region}</span>
          </div>
          
          <div className="flex items-center space-x-2">
            <button
              onClick={() => setCurrentView('dashboard')}
              className={`px-3 py-2 rounded-lg text-sm font-medium transition ${
                currentView === 'dashboard' ? 'bg-blue-100 text-blue-700' : 'text-gray-600 hover:bg-gray-100'
              }`}
            >
              {t('nav.dashboard')}
            </button>
            <button
              onClick={() => setCurrentView('year')}
              className={`px-3 py-2 rounded-lg text-sm font-medium transition ${
                currentView === 'year' ? 'bg-blue-100 text-blue-700' : 'text-gray-600 hover:bg-gray-100'
              }`}
            >
              {t('nav.yearOverview')}
            </button>
            {!isDemo && (
              <button
                onClick={() => setCurrentView('pipeline')}
                className={`px-3 py-2 rounded-lg text-sm font-medium transition ${
                  currentView === 'pipeline' ? 'bg-indigo-100 text-indigo-700' : 'text-gray-600 hover:bg-gray-100'
                }`}
              >
                📊 Pipeline
              </button>
            )}
            {!isDemo && permissions.hasAdminAccess && (
              <button
                onClick={() => setCurrentView('golive_import')}
                className={`px-3 py-2 rounded-lg text-sm font-medium transition ${
                  currentView === 'golive_import' ? 'bg-teal-100 text-teal-700' : 'text-gray-600 hover:bg-gray-100'
                }`}
              >
                📥 Go-Live Import
              </button>
            )}
            {(permissions.enterOwnGoLives || permissions.enterGoLivesForOthers) && !isDemo && (
              <button
                onClick={() => setCurrentView('add')}
                className="px-3 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 transition"
              >
                {t('nav.addGoLive')}
              </button>
            )}
            {permissions.hasAdminAccess && !isDemo && (
              <button
                onClick={() => setCurrentView('admin')}
                className={`px-3 py-2 rounded-lg text-sm font-medium transition ${
                  currentView === 'admin' ? 'bg-purple-100 text-purple-700' : 'text-gray-600 hover:bg-gray-100'
                }`}
              >
                {t('nav.admin')}
              </button>
            )}
            {permissions.editSettings && !isDemo && (
              <button
                onClick={() => setCurrentView('settings')}
                className={`px-3 py-2 rounded-lg text-sm font-medium transition ${
                  currentView === 'settings' ? 'bg-orange-100 text-orange-700' : 'text-gray-600 hover:bg-gray-100'
                }`}
              >
                ⚙️ {t('nav.settings')}
              </button>
            )}
            <button
              onClick={() => setCurrentView('leaderboard')}
              className={`px-3 py-2 rounded-lg text-sm font-medium transition ${
                currentView === 'leaderboard' ? 'bg-amber-100 text-amber-700' : 'text-gray-600 hover:bg-gray-100'
              }`}
            >
              🏆 {t('nav.leaderboard')}
            </button>
          </div>

          <div className="flex items-center space-x-4">
            <LanguageSelector variant="buttons" />
            
            {/* Demo-Modus Dropdown (nur für Admins) */}
            {canAccessDemo && (
              <select
                value={dataSource}
                onChange={(e) => setDataSource(e.target.value as DataSource)}
                className={`text-sm px-3 py-1.5 rounded-lg border transition ${
                  isDemo 
                    ? 'bg-orange-100 border-orange-300 text-orange-700' 
                    : 'bg-gray-100 border-gray-300 text-gray-700'
                }`}
              >
                <option value="production">🔴 Produktion</option>
                <option value="demo-75">🟡 Demo 75%</option>
                <option value="demo-100">🟢 Demo 100%</option>
                <option value="demo-120">🚀 Demo 120%</option>
              </select>
            )}
            
            <button 
              onClick={() => {
                setProfileUserId(user.id);
                setCurrentView('profile');
              }}
              className="text-right hover:bg-gray-100 rounded-lg p-2 transition"
            >
              <div className="text-sm font-medium text-gray-700">{user.name}</div>
              <div className="text-xs text-gray-500">{t(`roles.${user.role}`)}</div>
            </button>
            <button onClick={onSignOut} className="text-sm text-gray-500 hover:text-gray-700">
              {t('auth.logout')}
            </button>
          </div>
        </div>
      </div>
      
      {/* Demo-Modus Banner */}
      {isDemo && (
        <div className="bg-orange-500 text-white text-center py-2 text-sm font-medium">
          ⚠️ DEMO-MODUS ({scenarioLabel.label}) - Keine echten Daten
        </div>
      )}
    </nav>
  );

  // Pipeline View
  if (currentView === 'pipeline') {
    return (
      <div className="min-h-screen bg-gray-50">
        <Navigation />
        <main className="max-w-7xl mx-auto px-4 py-8">
          <Pipeline user={user} allUsers={allUsers} />
        </main>
      </div>
    );
  }

  // Go-Live Import View
  if (currentView === 'golive_import' && permissions.hasAdminAccess) {
    return (
      <div className="min-h-screen bg-gray-50">
        <Navigation />
        <main className="max-w-7xl mx-auto px-4 py-8">
          <GoLiveImport 
            onBack={() => setCurrentView('dashboard')}
            onImportComplete={(count) => {
              // Refresh Go-Lives nach erfolgreichem Import
              refetchGoLives();
            }}
          />
        </main>
      </div>
    );
  }

  // Admin View
  if (currentView === 'admin' && permissions.hasAdminAccess) {
    return (
      <div className="min-h-screen bg-gray-50">
        <Navigation />
        <main className="max-w-7xl mx-auto px-4 py-8">
          <AdminPanel currentUser={user} onBack={() => setCurrentView('dashboard')} />
        </main>
      </div>
    );
  }

  // Leaderboard View
  if (currentView === 'leaderboard') {
    return (
      <div className="min-h-screen bg-gray-50">
        <Navigation />
        <main className="max-w-7xl mx-auto px-4 py-8">
          <Leaderboard
            currentUser={user}
            users={selectableAEs}
            settingsMap={multiSettings}
            goLivesMap={multiGoLives}
            onBack={() => setCurrentView('dashboard')}
            challenges={challenges}
            isDemo={isDemo}
          />
        </main>
      </div>
    );
  }

  // Profile View
  if (currentView === 'profile') {
    const profileUser = allUsers.find(u => u.id === profileUserId) || user;
    const profileSettings = multiSettings.get(profileUserId);
    const profileGoLives = multiGoLives.get(profileUserId) || [];
    const canEditProfile = user.id === profileUserId || permissions.manageUsers;

    const handleSaveProfile = async (updatedData: Partial<User>) => {
      const { error } = await supabase
        .from('users')
        .update(updatedData)
        .eq('id', profileUserId);
      
      if (error) throw error;
      
      // Refresh page to get updated data
      window.location.reload();
    };

    return (
      <div className="min-h-screen bg-gray-50">
        <Navigation />
        <main className="max-w-7xl mx-auto px-4 py-8">
          <UserProfile
            user={profileUser}
            currentUser={user}
            settings={profileSettings}
            goLives={profileGoLives}
            allUsers={allUsers}
            onBack={() => setCurrentView('dashboard')}
            onSave={canEditProfile ? handleSaveProfile : undefined}
            canEdit={canEditProfile}
          />
        </main>
      </div>
    );
  }

  // Settings View
  if (currentView === 'settings' && permissions.editSettings) {
    return (
      <div className="min-h-screen bg-gray-50">
        <Navigation />
        <main className="max-w-7xl mx-auto px-4 py-8">
          {/* User Selector for Settings - nur AEs */}
          {permissions.viewAllUsers && selectableAEs.length > 0 && (
            <div className="bg-white rounded-xl shadow-sm p-4 mb-6">
              <UserSelector
                users={selectableAEs}
                selectedUserIds={[selectedUserId]}
                onSelectionChange={(ids) => setSelectedUserId(ids[0])}
                currentUser={user}
                mode="single"
                label={t('userSelector.settingsFor')}
              />
              {selectedUserId !== user.id && (
                <p className="mt-2 text-sm text-blue-600">
                  📝 {t('userSelector.editingSettingsOf')} <strong>{selectedUser.name}</strong>
                </p>
              )}
            </div>
          )}
          
          <SettingsPanel 
            settings={settings} 
            onSave={updateSettings}
            onBack={() => setCurrentView('dashboard')}
            currentUser={user}
            selectedUser={selectedUser}
          />
        </main>
      </div>
    );
  }

  // Add Go-Live View
  if (currentView === 'add') {
    // Finde den ausgewählten User für defaultCommissionRelevant
    const goLiveTargetUser = goLiveReceivers.find(u => u.id === selectedUserId) || user;
    
    return (
      <div className="min-h-screen bg-gray-50">
        <Navigation />
        <main className="max-w-2xl mx-auto px-4 py-8">
          {/* User Selector for Go-Live - alle die Go-Lives erhalten können */}
          {permissions.enterGoLivesForOthers && goLiveReceivers.length > 0 && (
            <div className="bg-white rounded-xl shadow-sm p-4 mb-6">
              <UserSelector
                users={goLiveReceivers}
                selectedUserIds={[selectedUserId]}
                onSelectionChange={(ids) => setSelectedUserId(ids[0])}
                currentUser={user}
                mode="single"
                label={t('userSelector.goLiveFor')}
              />
              {selectedUserId !== user.id && (
                <p className="mt-2 text-sm text-blue-600">
                  📝 {t('userSelector.recordingGoLiveFor')} <strong>{goLiveTargetUser.name}</strong>
                  {!isPlannable(goLiveTargetUser.role) && (
                    <span className="ml-2 text-amber-600">
                      ⚠️ {t('goLive.nonPlannableHint')}
                    </span>
                  )}
                </p>
              )}
            </div>
          )}
          
          <GoLiveForm 
            onSubmit={handleAddGoLive}
            onCancel={() => setCurrentView('dashboard')}
            defaultMonth={currentMonth}
            canEnterPayARR={permissions.enterPayARR}
            defaultCommissionRelevant={getDefaultCommissionRelevant(goLiveTargetUser.role)}
            currentUser={user}
            targetUserId={selectedUserId}
          />
        </main>
      </div>
    );
  }

  // Month Detail View
  if (currentView === 'month') {
    return (
      <div className="min-h-screen bg-gray-50">
        <Navigation />
        <main className="max-w-7xl mx-auto px-4 py-8">
          <MonthDetail
            month={selectedMonth}
            settings={settings}
            goLives={goLives.filter(gl => gl.month === selectedMonth)}
            allUsers={allUsers}
            currentUser={user}
            onBack={() => setCurrentView('dashboard')}
            onUpdateGoLive={handleUniversalUpdate}
            onDeleteGoLive={handleUniversalDelete}
            onAddGoLive={() => setCurrentView('add')}
            canEnterPayARR={permissions.enterPayARR}
            canAddGoLives={permissions.enterOwnGoLives}
            canEditGoLives={permissions.enterGoLivesForOthers || permissions.enterOwnGoLives}
          />
        </main>
      </div>
    );
  }

  // Year Overview View
  if (currentView === 'year') {
    // Determine what data to show
    const isCompareMode = selectedViewUserIds.length > 1 && !isAllSelected;
    
    // Für Einzelauswahl: Hole Go-Lives aus multiGoLives Map
    const singleSelectedUserId = selectedViewUserIds[0];
    const singleUserGoLives = multiGoLives.get(singleSelectedUserId) || [];
    const singleUserSettings = multiSettings.get(singleSelectedUserId) || settings;
    
    const showData = isAllSelected || isCompareMode
      ? { settings: combined.settings, goLives: combined.goLives }
      : { settings: singleUserSettings, goLives: singleUserGoLives };

    const displaySummary = showData.settings 
      ? calculateYearSummary(showData.goLives, showData.settings)
      : yearSummary;

    // Prüfe ob ausgewählter User ein planbarer User (AE) ist
    const selectedUser = selectableForView.find(u => selectedViewUserIds.includes(u.id));
    const isViewingPlannable = selectedUser ? isPlannable(selectedUser.role) : false;

    return (
      <div className="min-h-screen bg-gray-50">
        <Navigation />
        <main className="max-w-7xl mx-auto px-4 py-8">
          {/* DEBUG PANEL - nur für Country Manager sichtbar */}
          <DebugPanel 
            user={user} 
            data={{
              allUsersCount: allUsers.length,
              goLiveReceiversCount: goLiveReceivers.length,
              goLiveReceiverIds: goLiveReceivers.map(u => ({ id: u.id.substring(0, 8), name: u.name, role: u.role })),
              allGoLiveReceiverIds: allGoLiveReceiverIds.map(id => id.substring(0, 8)),
              multiGoLivesKeys: Array.from(multiGoLives.keys()).map(k => k.substring(0, 8)),
              multiGoLivesTotalCount: Array.from(multiGoLives.values()).flat().length,
              multiGoLivesDetail: Array.from(multiGoLives.entries()).map(([userId, gls]) => ({
                userId: userId.substring(0, 8),
                count: gls.length,
                customers: gls.map(g => g.customer_name)
              })),
              selectedViewUserIds: selectedViewUserIds.map(id => id.substring(0, 8)),
              singleSelectedUserId: singleSelectedUserId?.substring(0, 8),
              singleUserGoLivesCount: singleUserGoLives.length,
              combinedGoLivesCount: combined.goLives.length,
              combinedGoLives: combined.goLives.map(g => ({ userId: g.user_id.substring(0, 8), customer: g.customer_name })),
              showDataGoLivesCount: showData.goLives.length,
            }}
            title="Jahresübersicht Debug"
          />

          {/* User Filter for Year Overview - alle Go-Live Empfänger */}
          {permissions.viewAllUsers && selectableForView.length > 0 && (
            <div className="bg-white rounded-xl shadow-sm p-4 mb-6">
              <UserSelector
                users={selectableForView}
                selectedUserIds={selectedViewUserIds}
                onSelectionChange={setSelectedViewUserIds}
                currentUser={user}
                mode="compare"
                showAllOption={true}
                label={t('userSelector.display')}
              />
              {isAllSelected && (
                <p className="mt-2 text-sm text-purple-600">
                  📊 <strong>{t('userSelector.total')}</strong>: {t('userSelector.allUsersSum').replace('{count}', selectableForView.length.toString())}
                </p>
              )}
              {isCompareMode && (
                <p className="mt-2 text-sm text-blue-600">
                  📊 <strong>{t('userSelector.comparison')}</strong>: {t('userSelector.compareUsers').replace('{count}', selectedViewUserIds.length.toString())}
                </p>
              )}
            </div>
          )}

          {/* Comparison View */}
          {isCompareMode ? (
            <ComparisonYearOverview
              users={selectableForView.filter(u => selectedViewUserIds.includes(u.id))}
              settingsMap={multiSettings}
              goLivesMap={multiGoLives}
              onBack={() => setCurrentView('dashboard')}
            />
          ) : (
            <YearOverview 
              settings={showData.settings || settings} 
              yearSummary={displaySummary}
              goLives={showData.goLives}
              allUsers={allUsers}
              onUpdateGoLive={handleUniversalUpdate}
              onDeleteGoLive={handleUniversalDelete}
              onBack={() => setCurrentView('dashboard')}
              title={isAllSelected ? 'GESAMT - Alle User' : (!isViewingPlannable && selectedUser ? `${selectedUser.name} (nur ARR)` : undefined)}
              canEdit={
                // AE und SDR dürfen in GESAMT-Ansicht nicht bearbeiten
                (user.role === 'ae' || user.role === 'sdr') 
                  ? false 
                  : (permissions.enterGoLivesForOthers || permissions.enterOwnGoLives)
              }
            />
          )}
        </main>
      </div>
    );
  }

  // Dashboard View (Default)
  return (
    <div className="min-h-screen bg-gray-50">
      <Navigation />
      <main className="max-w-7xl mx-auto px-4 py-8">
        {/* DEBUG PANEL */}
        <DebugPanel 
          user={user} 
          data={{
            currentUser: { id: user.id.substring(0, 8), name: user.name, role: user.role },
            selectedUserId: selectedUserId.substring(0, 8),
            goLivesCount: goLives.length,
            goLivesDetail: goLives.map(g => ({ customer: g.customer_name, month: g.month, commissionRelevant: g.commission_relevant })),
            settingsYear: settings.year,
            permissions: permissions,
          }}
          title="Dashboard Debug"
        />

        {/* User Selector for Dashboard - nur AEs */}
        {permissions.viewAllUsers && selectableAEs.length > 0 && (
          <div className="bg-white rounded-xl shadow-sm p-4 mb-6">
            <UserSelector
              users={selectableAEs}
              selectedUserIds={[selectedUserId]}
              onSelectionChange={(ids) => setSelectedUserId(ids[0])}
              currentUser={user}
              mode="single"
              label={t('userSelector.dashboardFor')}
            />
          </div>
        )}

        {/* Show whose data we're viewing */}
        {selectedUserId !== user.id && (
          <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-lg">
            <p className="text-blue-700">
              📊 {t('userSelector.dataOf')} <strong>{selectedUser.name}</strong> ({t(`roles.${selectedUser.role}`)})
            </p>
          </div>
        )}

        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
          <div className="bg-white rounded-xl shadow-sm p-6 border-l-4 border-green-500">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-gray-500">{t('dashboard.ytdSubsArr')}</span>
              <span className={`text-xs px-2 py-1 rounded-full ${getAchievementBgColor(ytdSummary.total_subs_achievement)}`}>
                {formatPercent(ytdSummary.total_subs_achievement)}
              </span>
            </div>
            <p className="text-2xl font-bold text-gray-800">{formatCurrency(ytdSummary.total_subs_actual)}</p>
            <p className="text-sm text-gray-500 mt-1">{t('common.target')}: {formatCurrency(ytdSummary.total_subs_target)}</p>
          </div>

          <div className="bg-white rounded-xl shadow-sm p-6 border-l-4 border-orange-500">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-gray-500">{t('dashboard.ytdPayArr')}</span>
              <span className={`text-xs px-2 py-1 rounded-full ${getAchievementBgColor(ytdSummary.total_pay_achievement)}`}>
                {formatPercent(ytdSummary.total_pay_achievement)}
              </span>
            </div>
            <p className="text-2xl font-bold text-gray-800">{formatCurrency(ytdSummary.total_pay_actual)}</p>
            <p className="text-sm text-gray-500 mt-1">{t('common.target')}: {formatCurrency(ytdSummary.total_pay_target)}</p>
          </div>

          <div className="bg-white rounded-xl shadow-sm p-6 border-l-4 border-blue-500">
            <span className="text-sm font-medium text-gray-500">{t('dashboard.ytdGoLives')}</span>
            <p className="text-2xl font-bold text-gray-800 mt-2">{ytdSummary.total_go_lives}</p>
            <p className="text-sm text-gray-500 mt-1">{t('dashboard.terminals')}: {ytdSummary.total_terminals}</p>
          </div>

          <div className="bg-white rounded-xl shadow-sm p-6 border-l-4 border-purple-500">
            <span className="text-sm font-medium text-gray-500">{t('dashboard.ytdProvision')}</span>
            <p className="text-2xl font-bold text-green-600 mt-2">{formatCurrency(ytdSummary.total_provision)}</p>
            <div className="text-xs text-gray-500 mt-1 space-y-1">
              <div className="flex justify-between">
                <span>{t('dashboard.m0Provision')}:</span>
                <span className="text-green-600">{formatCurrency(ytdSummary.total_m0_provision)}</span>
              </div>
              <div className="flex justify-between">
                <span>{t('dashboard.m3Provision')}:</span>
                <span className="text-orange-600">{formatCurrency(ytdSummary.total_m3_provision)}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Achievement Gauges */}
        <div className="mb-8">
          <AchievementGauges
            subsActual={ytdSummary.total_subs_actual}
            subsTarget={ytdSummary.total_subs_target}
            payActual={ytdSummary.total_pay_actual}
            payTarget={ytdSummary.total_pay_target}
          />
        </div>

        {/* Active Challenges Widget */}
        {activeChallenges.length > 0 && (
          <div className="mb-8">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-gray-800 flex items-center">
                <span className="mr-2">🎯</span>
                {t('dashboard.activeChallenges')}
              </h2>
              <button
                onClick={() => setCurrentView('leaderboard')}
                className="text-sm text-blue-600 hover:text-blue-800"
              >
                {t('dashboard.viewAll')} →
              </button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {activeChallenges.slice(0, 3).map(challenge => {
                const allGoLivesForProgress = Array.from(multiGoLives.values()).flat();
                const progress = calculateChallengeProgress(challenge, allGoLivesForProgress);
                
                return (
                  <div 
                    key={challenge.id} 
                    className="bg-white rounded-xl shadow-sm p-4 border-l-4 border-emerald-500 hover:shadow-md transition cursor-pointer"
                    onClick={() => setCurrentView('leaderboard')}
                  >
                    <div className="flex items-center space-x-3 mb-2">
                      <span className="text-2xl">{challenge.icon}</span>
                      <div className="flex-1 min-w-0">
                        <h4 className="font-bold text-gray-800 truncate">{challenge.name}</h4>
                        <p className="text-xs text-gray-500">{progress.days_remaining} {t('challenges.days')} {t('challenges.timeLeft').toLowerCase()}</p>
                      </div>
                    </div>
                    <div className="mb-2">
                      <div className="flex justify-between text-xs mb-1">
                        <span className="text-gray-600">{t('challenges.progress')}</span>
                        <span className="font-bold text-emerald-600">{Math.round(progress.progress_percent)}%</span>
                      </div>
                      <div className="w-full bg-gray-200 rounded-full h-2">
                        <div 
                          className="h-2 rounded-full bg-emerald-500 transition-all"
                          style={{ width: `${Math.min(progress.progress_percent, 100)}%` }}
                        />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Monthly Grid */}
        <h2 className="text-lg font-bold text-gray-800 mb-4">{t('dashboard.months')} {settings.year}</h2>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 mb-8">
          {yearSummary.monthly_results.map((result) => (
            <button
              key={result.month}
              onClick={() => { setSelectedMonth(result.month); setCurrentView('month'); }}
              className={`bg-white rounded-xl shadow-sm p-4 text-left hover:shadow-md transition ${
                result.month === currentMonth ? 'ring-2 ring-blue-500' : ''
              }`}
            >
              <div className="flex items-center justify-between mb-2">
                <span className="font-medium text-gray-800">{t(`months.${result.month}`)}</span>
                {result.month === currentMonth && (
                  <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded">{t('common.current')}</span>
                )}
              </div>
              <div className="text-sm text-gray-600 mb-1">{result.go_lives_count} {t('dashboard.goLives')}</div>
              <div className="text-lg font-bold text-green-600">{formatCurrency(result.total_provision)}</div>
              <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
                <div>
                  <span className="text-gray-500">Subs:</span>
                  <span className={`ml-1 ${getAchievementColor(result.subs_achievement)}`}>
                    {formatPercent(result.subs_achievement)}
                  </span>
                </div>
                <div>
                  <span className="text-gray-500">Pay:</span>
                  <span className={`ml-1 ${getAchievementColor(result.pay_achievement)}`}>
                    {formatPercent(result.pay_achievement)}
                  </span>
                </div>
              </div>
            </button>
          ))}
        </div>

        {/* Provision Tiers */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-white rounded-xl shadow-sm p-6">
            <h3 className="text-lg font-bold text-gray-800 mb-4 flex items-center">
              <span className="w-3 h-3 bg-green-500 rounded-full mr-2"></span>
              {t('dashboard.subsProvisionTiers')}
            </h3>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="text-left py-2 text-gray-500">{t('dashboard.achievement')}</th>
                  <th className="text-right py-2 text-gray-500">{t('dashboard.rate')}</th>
                </tr>
              </thead>
              <tbody>
                {settings.subs_tiers.map((tier, i) => (
                  <tr key={i} className="border-b">
                    <td className="py-2">{tier.label}</td>
                    <td className="py-2 text-right font-medium">{formatPercent(tier.rate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="bg-white rounded-xl shadow-sm p-6">
            <h3 className="text-lg font-bold text-gray-800 mb-4 flex items-center">
              <span className="w-3 h-3 bg-orange-500 rounded-full mr-2"></span>
              {t('dashboard.payProvisionTiers')}
            </h3>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="text-left py-2 text-gray-500">{t('dashboard.achievement')}</th>
                  <th className="text-right py-2 text-gray-500">{t('dashboard.rate')}</th>
                </tr>
              </thead>
              <tbody>
                {settings.pay_tiers.map((tier, i) => (
                  <tr key={i} className="border-b">
                    <td className="py-2">{tier.label}</td>
                    <td className="py-2 text-right font-medium">{formatPercent(tier.rate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </main>
    </div>
  );
}

// ============================================
// COMPARISON YEAR OVERVIEW COMPONENT
// ============================================

interface ComparisonYearOverviewProps {
  users: User[];
  settingsMap: Map<string, AESettings>;
  goLivesMap: Map<string, GoLive[]>;
  onBack: () => void;
}

function ComparisonYearOverview({ users, settingsMap, goLivesMap, onBack }: ComparisonYearOverviewProps) {
  const { t } = useLanguage();

  // Calculate summaries for each user
  const userSummaries = users.map(user => {
    const settings = settingsMap.get(user.id);
    const goLives = goLivesMap.get(user.id) || [];
    const summary = settings ? calculateYearSummary(goLives, settings) : null;
    return { user, settings, summary };
  });

  const months = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center space-x-4">
          <button onClick={onBack} className="p-2 hover:bg-gray-100 rounded-lg transition">
            {t('common.back')}
          </button>
          <h2 className="text-2xl font-bold text-gray-800">
            Vergleich: {users.map(u => u.name).join(' vs ')}
          </h2>
        </div>
      </div>

      {/* Summary Cards per User */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        {userSummaries.map(({ user, summary }) => (
          <div key={user.id} className="bg-white rounded-xl shadow-sm p-6">
            <h3 className="text-lg font-bold text-gray-800 mb-4">{user.name}</h3>
            {summary ? (
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <span className="text-sm text-gray-500">Subs ARR</span>
                  <p className="text-xl font-bold text-green-600">{formatCurrency(summary.total_subs_actual)}</p>
                  <p className={`text-sm ${getAchievementColor(summary.total_subs_achievement)}`}>
                    {formatPercent(summary.total_subs_achievement)}
                  </p>
                </div>
                <div>
                  <span className="text-sm text-gray-500">Pay ARR</span>
                  <p className="text-xl font-bold text-orange-600">{formatCurrency(summary.total_pay_actual)}</p>
                  <p className={`text-sm ${getAchievementColor(summary.total_pay_achievement)}`}>
                    {formatPercent(summary.total_pay_achievement)}
                  </p>
                </div>
                <div>
                  <span className="text-sm text-gray-500">Go-Lives</span>
                  <p className="text-xl font-bold text-gray-800">{summary.total_go_lives}</p>
                </div>
                <div>
                  <span className="text-sm text-gray-500">Provision</span>
                  <p className="text-xl font-bold text-purple-600">{formatCurrency(summary.total_provision)}</p>
                </div>
              </div>
            ) : (
              <p className="text-gray-500">Keine Daten verfügbar</p>
            )}
          </div>
        ))}
      </div>

      {/* Monthly Comparison Table */}
      <div className="bg-white rounded-xl shadow-sm p-6 overflow-x-auto">
        <h3 className="text-lg font-bold text-gray-800 mb-4">Monatlicher Vergleich</h3>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b-2">
              <th className="text-left py-3 px-2 font-bold text-gray-700">{t('common.month')}</th>
              {users.map(user => (
                <th key={user.id} colSpan={3} className="text-center py-3 px-2 font-bold text-gray-700 border-l">
                  {user.name}
                </th>
              ))}
            </tr>
            <tr className="border-b">
              <th></th>
              {users.map(user => (
                <>
                  <th key={`${user.id}-subs`} className="text-right py-2 px-1 text-xs text-green-600 border-l">Subs</th>
                  <th key={`${user.id}-pay`} className="text-right py-2 px-1 text-xs text-orange-600">Pay</th>
                  <th key={`${user.id}-prov`} className="text-right py-2 px-1 text-xs text-purple-600">Prov.</th>
                </>
              ))}
            </tr>
          </thead>
          <tbody>
            {months.map(month => (
              <tr key={month} className="border-b hover:bg-gray-50">
                <td className="py-2 px-2 font-medium">{t(`months.${month}`)}</td>
                {userSummaries.map(({ user, summary }) => {
                  const monthData = summary?.monthly_results.find(r => r.month === month);
                  return (
                    <>
                      <td key={`${user.id}-${month}-subs`} className="py-2 px-1 text-right text-green-600 border-l">
                        {monthData ? formatCurrency(monthData.subs_actual) : '-'}
                      </td>
                      <td key={`${user.id}-${month}-pay`} className="py-2 px-1 text-right text-orange-600">
                        {monthData ? formatCurrency(monthData.pay_actual) : '-'}
                      </td>
                      <td key={`${user.id}-${month}-prov`} className="py-2 px-1 text-right text-purple-600 font-medium">
                        {monthData ? formatCurrency(monthData.total_provision) : '-'}
                      </td>
                    </>
                  );
                })}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="bg-gray-100 font-bold border-t-2">
              <td className="py-3 px-2">{t('common.total').toUpperCase()}</td>
              {userSummaries.map(({ user, summary }) => (
                <>
                  <td key={`${user.id}-total-subs`} className="py-3 px-1 text-right text-green-700 border-l">
                    {summary ? formatCurrency(summary.total_subs_actual) : '-'}
                  </td>
                  <td key={`${user.id}-total-pay`} className="py-3 px-1 text-right text-orange-700">
                    {summary ? formatCurrency(summary.total_pay_actual) : '-'}
                  </td>
                  <td key={`${user.id}-total-prov`} className="py-3 px-1 text-right text-purple-700">
                    {summary ? formatCurrency(summary.total_provision) : '-'}
                  </td>
                </>
              ))}
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
