'use client';

import { useState, useEffect, useMemo } from 'react';
import { User, GoLive, AESettings, isPlannable, canReceiveGoLives, getDefaultCommissionRelevant, Challenge, BusinessArea, BUSINESS_AREA_LABELS } from '@/lib/types';
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
  selectedArea?: BusinessArea;
  onBackToAreaSelector?: () => void;
}

type View = 'dashboard' | 'month' | 'year' | 'add' | 'settings' | 'leaderboard' | 'profile' | 'pipeline' | 'golive_import';

export default function Dashboard({ user, onSignOut, selectedArea, onBackToAreaSelector }: DashboardProps) {
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
  // Default: 'all' für GESAMT-Ansicht
  const [selectedViewUserIds, setSelectedViewUserIds] = useState<string[]>(['all']);

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

  const [currentView, setCurrentView] = useState<View>('year');
  const [selectedMonth, setSelectedMonth] = useState<number>(new Date().getMonth() + 1);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

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

  // Navigation Component - Responsive
  const Navigation = () => {
    const navItems = [
      { view: 'year' as View, label: t('nav.yearOverview'), icon: '📅', show: true },
      { view: 'dashboard' as View, label: t('nav.dashboard'), icon: '📊', show: true },
      { view: 'pipeline' as View, label: t('nav.pipeline'), icon: '📈', show: !isDemo },
      { view: 'leaderboard' as View, label: t('nav.leaderboard'), icon: '🏆', show: true },
      { view: 'add' as View, label: t('nav.addGoLive'), icon: '➕', show: (permissions.enterOwnGoLives || permissions.enterGoLivesForOthers) && !isDemo, highlight: true },
      { view: 'settings' as View, label: t('nav.settings'), icon: '⚙️', show: permissions.editSettings && !isDemo },
    ].filter(item => item.show);

    return (
      <nav className="bg-white shadow-sm border-b sticky top-0 z-20">
        <div className="max-w-7xl mx-auto px-4">
          <div className="flex items-center justify-between h-14 md:h-16">
            {/* Left: Back Button + Title */}
            <div className="flex items-center space-x-2 md:space-x-4 min-w-0 flex-1">
              {onBackToAreaSelector && (
                <button
                  onClick={onBackToAreaSelector}
                  className="p-2 hover:bg-gray-100 rounded-lg transition-colors flex-shrink-0"
                  title={t('ui.backToAreaSelector')}
                >
                  <svg className="w-5 h-5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                  </svg>
                </button>
              )}
              <div className="min-w-0">
                <h1 className="text-base md:text-xl font-bold text-gray-800 truncate">{t('dashboard.title')}</h1>
                <p className="text-xs text-gray-500 truncate hidden sm:block">
                  {selectedArea && <span className="font-medium text-blue-600">{BUSINESS_AREA_LABELS[selectedArea]}</span>}
                  {selectedArea && ' • '}
                  {settings.year} • {settings.region}
                </p>
              </div>
            </div>
            
            {/* Center: Desktop Navigation */}
            <div className="hidden lg:flex items-center space-x-1 xl:space-x-2">
              {navItems.map(item => (
                <button
                  key={item.view}
                  onClick={() => setCurrentView(item.view)}
                  className={`px-2 xl:px-3 py-2 rounded-lg text-sm font-medium transition whitespace-nowrap ${
                    item.highlight 
                      ? 'bg-green-600 text-white hover:bg-green-700'
                      : currentView === item.view 
                        ? 'bg-blue-100 text-blue-700' 
                        : 'text-gray-600 hover:bg-gray-100'
                  }`}
                >
                  <span className="hidden xl:inline">{item.icon} </span>{item.label}
                </button>
              ))}
            </div>

            {/* Right: User Controls */}
            <div className="flex items-center space-x-2 md:space-x-4 flex-shrink-0">
              {/* Language - hidden on mobile */}
              <div className="hidden md:block">
                <LanguageSelector variant="buttons" />
              </div>
              
              {/* Demo Dropdown - hidden on mobile */}
              {canAccessDemo && (
                <select
                  value={dataSource}
                  onChange={(e) => setDataSource(e.target.value as DataSource)}
                  className={`hidden md:block text-sm px-2 py-1.5 rounded-lg border transition ${
                    isDemo 
                      ? 'bg-orange-100 border-orange-300 text-orange-700' 
                      : 'bg-gray-100 border-gray-300 text-gray-700'
                  }`}
                >
                  <option value="production">🔴 Prod</option>
                  <option value="demo-75">🟡 75%</option>
                  <option value="demo-100">🟢 100%</option>
                  <option value="demo-120">🚀 120%</option>
                </select>
              )}
              
              {/* User Profile - simplified on mobile */}
              <button 
                onClick={() => {
                  setProfileUserId(user.id);
                  setCurrentView('profile');
                  setMobileMenuOpen(false);
                }}
                className="hidden sm:block text-right hover:bg-gray-100 rounded-lg p-2 transition"
              >
                <div className="text-sm font-medium text-gray-700 truncate max-w-[100px] lg:max-w-none">{user.name}</div>
                <div className="text-xs text-gray-500 hidden lg:block">{t(`roles.${user.role}`)}</div>
              </button>
              
              {/* Logout - hidden on mobile */}
              <button onClick={onSignOut} className="hidden md:block text-sm text-gray-500 hover:text-gray-700 px-2 py-1">
                {t('auth.logout')}
              </button>
              
              {/* Mobile Menu Button */}
              <button
                onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                className="lg:hidden p-2 hover:bg-gray-100 rounded-lg transition-colors"
                aria-label={t('ui.openMenu')}
              >
                {mobileMenuOpen ? (
                  <svg className="w-6 h-6 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                ) : (
                  <svg className="w-6 h-6 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                  </svg>
                )}
              </button>
            </div>
          </div>
        </div>
        
        {/* Mobile Menu Overlay */}
        {mobileMenuOpen && (
          <div className="lg:hidden fixed inset-0 top-14 bg-black/50 z-30" onClick={() => setMobileMenuOpen(false)}>
            <div 
              className="bg-white border-t shadow-lg max-h-[calc(100vh-3.5rem)] overflow-y-auto"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Mobile Navigation Items */}
              <div className="p-4 space-y-2">
                {navItems.map(item => (
                  <button
                    key={item.view}
                    onClick={() => {
                      setCurrentView(item.view);
                      setMobileMenuOpen(false);
                    }}
                    className={`w-full px-4 py-3 rounded-lg text-left font-medium transition flex items-center space-x-3 ${
                      item.highlight 
                        ? 'bg-green-600 text-white'
                        : currentView === item.view 
                          ? 'bg-blue-100 text-blue-700' 
                          : 'text-gray-700 hover:bg-gray-100'
                    }`}
                  >
                    <span className="text-xl">{item.icon}</span>
                    <span>{item.label}</span>
                  </button>
                ))}
              </div>
              
              {/* Mobile User Section */}
              <div className="border-t p-4 space-y-3">
                <button 
                  onClick={() => {
                    setProfileUserId(user.id);
                    setCurrentView('profile');
                    setMobileMenuOpen(false);
                  }}
                  className="w-full px-4 py-3 rounded-lg text-left hover:bg-gray-100 transition flex items-center space-x-3"
                >
                  <span className="text-xl">👤</span>
                  <div>
                    <div className="font-medium text-gray-700">{user.name}</div>
                    <div className="text-xs text-gray-500">{t(`roles.${user.role}`)}</div>
                  </div>
                </button>
                
                {/* Language Selector Mobile */}
                <div className="px-4 py-2">
                  <LanguageSelector variant="buttons" />
                </div>
                
                {/* Demo Dropdown Mobile */}
                {canAccessDemo && (
                  <div className="px-4 py-2">
                    <label className="block text-sm text-gray-500 mb-1">Modus</label>
                    <select
                      value={dataSource}
                      onChange={(e) => setDataSource(e.target.value as DataSource)}
                      className={`w-full text-sm px-3 py-2 rounded-lg border transition ${
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
                  </div>
                )}
                
                <button 
                  onClick={onSignOut}
                  className="w-full px-4 py-3 rounded-lg text-left text-red-600 hover:bg-red-50 transition flex items-center space-x-3"
                >
                  <span className="text-xl">🚪</span>
                  <span>{t('auth.logout')}</span>
                </button>
              </div>
            </div>
          </div>
        )}
        
        {/* Demo-Modus Banner */}
        {isDemo && (
          <div className="bg-orange-500 text-white text-center py-1.5 md:py-2 text-xs md:text-sm font-medium">
            ⚠️ DEMO-MODUS ({scenarioLabel.label})
          </div>
        )}
      </nav>
    );
  };

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
            onBack={() => setCurrentView('add')}
            onImportComplete={(count) => {
              // Refresh Go-Lives nach erfolgreichem Import
              refetchGoLives();
            }}
          />
        </main>
      </div>
    );
  }

  // Admin-View wurde in den Startbildschirm verschoben

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
            onBack={() => setCurrentView('year')}
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
            onBack={() => setCurrentView('year')}
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
          <SettingsPanel 
            settings={settings} 
            onSave={updateSettings}
            onBack={() => setCurrentView('year')}
            currentUser={user}
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

          {/* Go-Live Import Button für Admins */}
          {permissions.hasAdminAccess && !isDemo && (
            <div className="mb-6">
              <button
                onClick={() => setCurrentView('golive_import')}
                className="w-full px-4 py-3 bg-purple-50 border border-purple-200 text-purple-700 rounded-xl hover:bg-purple-100 transition-colors flex items-center justify-center gap-2"
              >
                <span>📥</span>
                <span className="font-medium">Go-Live Import (Salesforce/CSV)</span>
              </button>
            </div>
          )}
          
          <GoLiveForm 
            onSubmit={handleAddGoLive}
            onCancel={() => setCurrentView('year')}
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
            onBack={() => setCurrentView('year')}
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
              onBack={() => setCurrentView('year')}
            />
          ) : (
            <YearOverview 
              settings={showData.settings || settings} 
              yearSummary={displaySummary}
              goLives={showData.goLives}
              allUsers={allUsers}
              onUpdateGoLive={handleUniversalUpdate}
              onDeleteGoLive={handleUniversalDelete}
              onBack={() => setCurrentView('year')}
              title={isAllSelected ? 'GESAMT - Alle User' : (!isViewingPlannable && selectedUser ? `${selectedUser.name} (nur ARR)` : undefined)}
              canEdit={
                // Nur AE-Rollen ohne erweiterte Rechte dürfen in GESAMT-Ansicht nicht bearbeiten
                (user.role === 'ae_subscription_sales' || user.role === 'ae_payments' || user.role === 'cs_sdr') 
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

        {/* Stats Cards - Responsive */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-6 mb-6 md:mb-8">
          <div className="bg-white rounded-lg md:rounded-xl shadow-sm p-3 md:p-6 border-l-4 border-green-500">
            <div className="flex items-center justify-between mb-1 md:mb-2">
              <span className="text-xs md:text-sm font-medium text-gray-500 truncate">{t('dashboard.ytdSubsArr')}</span>
              <span className={`text-[10px] md:text-xs px-1.5 md:px-2 py-0.5 md:py-1 rounded-full ${getAchievementBgColor(ytdSummary.total_subs_achievement)}`}>
                {formatPercent(ytdSummary.total_subs_achievement)}
              </span>
            </div>
            <p className="text-lg md:text-2xl font-bold text-gray-800">{formatCurrency(ytdSummary.total_subs_actual)}</p>
            <p className="text-xs md:text-sm text-gray-500 mt-1 truncate">{t('common.target')}: {formatCurrency(ytdSummary.total_subs_target)}</p>
          </div>

          <div className="bg-white rounded-lg md:rounded-xl shadow-sm p-3 md:p-6 border-l-4 border-orange-500">
            <div className="flex items-center justify-between mb-1 md:mb-2">
              <span className="text-xs md:text-sm font-medium text-gray-500 truncate">{t('dashboard.ytdPayArr')}</span>
              <span className={`text-[10px] md:text-xs px-1.5 md:px-2 py-0.5 md:py-1 rounded-full ${getAchievementBgColor(ytdSummary.total_pay_achievement)}`}>
                {formatPercent(ytdSummary.total_pay_achievement)}
              </span>
            </div>
            <p className="text-lg md:text-2xl font-bold text-gray-800">{formatCurrency(ytdSummary.total_pay_actual)}</p>
            <p className="text-xs md:text-sm text-gray-500 mt-1 truncate">{t('common.target')}: {formatCurrency(ytdSummary.total_pay_target)}</p>
          </div>

          <div className="bg-white rounded-lg md:rounded-xl shadow-sm p-3 md:p-6 border-l-4 border-blue-500">
            <span className="text-xs md:text-sm font-medium text-gray-500">{t('dashboard.ytdGoLives')}</span>
            <p className="text-lg md:text-2xl font-bold text-gray-800 mt-1 md:mt-2">{ytdSummary.total_go_lives}</p>
            <p className="text-xs md:text-sm text-gray-500 mt-1">{t('dashboard.terminals')}: {ytdSummary.total_terminals}</p>
          </div>

          <div className="bg-white rounded-lg md:rounded-xl shadow-sm p-3 md:p-6 border-l-4 border-purple-500">
            <span className="text-xs md:text-sm font-medium text-gray-500">{t('dashboard.ytdProvision')}</span>
            <p className="text-lg md:text-2xl font-bold text-green-600 mt-1 md:mt-2">{formatCurrency(ytdSummary.total_provision)}</p>
            <div className="text-[10px] md:text-xs text-gray-500 mt-1 space-y-0.5 md:space-y-1">
              <div className="flex justify-between">
                <span className="hidden sm:inline">{t('dashboard.m0Provision')}:</span>
                <span className="sm:hidden">M0:</span>
                <span className="text-green-600">{formatCurrency(ytdSummary.total_m0_provision)}</span>
              </div>
              <div className="flex justify-between">
                <span className="hidden sm:inline">{t('dashboard.m3Provision')}:</span>
                <span className="sm:hidden">M3:</span>
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

        {/* Active Challenges Widget - Responsive */}
        {activeChallenges.length > 0 && (
          <div className="mb-6 md:mb-8">
            <div className="flex items-center justify-between mb-3 md:mb-4">
              <h2 className="text-base md:text-lg font-bold text-gray-800 flex items-center">
                <span className="mr-2">🎯</span>
                {t('dashboard.activeChallenges')}
              </h2>
              <button
                onClick={() => setCurrentView('leaderboard')}
                className="text-xs md:text-sm text-blue-600 hover:text-blue-800 px-2 py-1"
              >
                {t('dashboard.viewAll')} →
              </button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 md:gap-4">
              {activeChallenges.slice(0, 3).map(challenge => {
                const allGoLivesForProgress = Array.from(multiGoLives.values()).flat();
                const progress = calculateChallengeProgress(challenge, allGoLivesForProgress);
                
                return (
                  <div 
                    key={challenge.id} 
                    className="bg-white rounded-lg md:rounded-xl shadow-sm p-3 md:p-4 border-l-4 border-emerald-500 hover:shadow-md transition cursor-pointer active:bg-gray-50"
                    onClick={() => setCurrentView('leaderboard')}
                  >
                    <div className="flex items-center space-x-2 md:space-x-3 mb-2">
                      <span className="text-xl md:text-2xl">{challenge.icon}</span>
                      <div className="flex-1 min-w-0">
                        <h4 className="font-bold text-gray-800 truncate text-sm md:text-base">{challenge.name}</h4>
                        <p className="text-[10px] md:text-xs text-gray-500">{progress.days_remaining} {t('challenges.days')} {t('challenges.timeLeft').toLowerCase()}</p>
                      </div>
                    </div>
                    <div className="mb-2">
                      <div className="flex justify-between text-[10px] md:text-xs mb-1">
                        <span className="text-gray-600">{t('challenges.progress')}</span>
                        <span className="font-bold text-emerald-600">{Math.round(progress.progress_percent)}%</span>
                      </div>
                      <div className="w-full bg-gray-200 rounded-full h-1.5 md:h-2">
                        <div 
                          className="h-1.5 md:h-2 rounded-full bg-emerald-500 transition-all"
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

        {/* Monthly Grid - Responsive */}
        <h2 className="text-base md:text-lg font-bold text-gray-800 mb-3 md:mb-4">{t('dashboard.months')} {settings.year}</h2>
        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-12 gap-2 md:gap-3 mb-6 md:mb-8">
          {yearSummary.monthly_results.map((result) => (
            <button
              key={result.month}
              onClick={() => { setSelectedMonth(result.month); setCurrentView('month'); }}
              className={`bg-white rounded-lg shadow-sm p-2 md:p-3 text-left hover:shadow-md transition active:bg-gray-50 ${
                result.month === currentMonth ? 'ring-2 ring-blue-500' : ''
              }`}
            >
              <div className="flex items-center justify-between mb-1">
                <span className="font-medium text-gray-800 text-xs md:text-sm">{t(`months.${result.month}`).substring(0, 3)}</span>
                {result.month === currentMonth && (
                  <span className="w-2 h-2 bg-blue-500 rounded-full"></span>
                )}
              </div>
              <div className="text-[10px] md:text-xs text-gray-500 mb-0.5">{result.go_lives_count} GL</div>
              <div className="text-xs md:text-sm font-bold text-green-600">{formatCurrency(result.total_provision)}</div>
              <div className="mt-1 text-[9px] md:text-[10px] hidden sm:block">
                <div className={getAchievementColor(result.subs_achievement)}>
                  S: {formatPercent(result.subs_achievement)}
                </div>
                <div className={getAchievementColor(result.pay_achievement)}>
                  P: {formatPercent(result.pay_achievement)}
                </div>
              </div>
            </button>
          ))}
        </div>

        {/* Provision Tiers - Responsive */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6">
          <div className="bg-white rounded-lg md:rounded-xl shadow-sm p-4 md:p-6">
            <h3 className="text-sm md:text-lg font-bold text-gray-800 mb-3 md:mb-4 flex items-center">
              <span className="w-2 h-2 md:w-3 md:h-3 bg-green-500 rounded-full mr-2"></span>
              {t('dashboard.subsProvisionTiers')}
            </h3>
            <table className="w-full text-xs md:text-sm">
              <thead>
                <tr className="border-b">
                  <th className="text-left py-1.5 md:py-2 text-gray-500">{t('dashboard.achievement')}</th>
                  <th className="text-right py-1.5 md:py-2 text-gray-500">{t('dashboard.rate')}</th>
                </tr>
              </thead>
              <tbody>
                {settings.subs_tiers.map((tier, i) => (
                  <tr key={i} className="border-b">
                    <td className="py-1.5 md:py-2">{tier.label}</td>
                    <td className="py-1.5 md:py-2 text-right font-medium">{formatPercent(tier.rate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="bg-white rounded-lg md:rounded-xl shadow-sm p-4 md:p-6">
            <h3 className="text-sm md:text-lg font-bold text-gray-800 mb-3 md:mb-4 flex items-center">
              <span className="w-2 h-2 md:w-3 md:h-3 bg-orange-500 rounded-full mr-2"></span>
              {t('dashboard.payProvisionTiers')}
            </h3>
            <table className="w-full text-xs md:text-sm">
              <thead>
                <tr className="border-b">
                  <th className="text-left py-1.5 md:py-2 text-gray-500">{t('dashboard.achievement')}</th>
                  <th className="text-right py-1.5 md:py-2 text-gray-500">{t('dashboard.rate')}</th>
                </tr>
              </thead>
              <tbody>
                {settings.pay_tiers.map((tier, i) => (
                  <tr key={i} className="border-b">
                    <td className="py-1.5 md:py-2">{tier.label}</td>
                    <td className="py-1.5 md:py-2 text-right font-medium">{formatPercent(tier.rate)}</td>
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
