'use client';

import { useState, useMemo, useEffect } from 'react';
import { User, AESettings, GoLive, Challenge, ChallengeProgress, ChallengeMetric, ChallengeType, CHALLENGE_ICONS } from '@/lib/types';
import { useLanguage } from '@/lib/LanguageContext';
import { 
  formatCurrency, 
  formatPercent,
  getAchievementColor,
  calculateYearSummary,
  calculateYTDSummary
} from '@/lib/calculations';
import { 
  calculateBadges, 
  EarnedBadge, 
  ALL_BADGES, 
  RARITY_COLORS,
  checkForNewBadges
} from '@/lib/badges';
import { useChallenges, calculateChallengeProgress } from '@/lib/hooks';
import { getPermissions } from '@/lib/permissions';
import Confetti, { BadgeUnlockAnimation } from './Confetti';
import DebugPanel from './DebugPanel';

interface LeaderboardProps {
  currentUser: User;
  users: User[];
  settingsMap: Map<string, AESettings>;
  goLivesMap: Map<string, GoLive[]>;
  onBack: () => void;
}

type FilterPeriod = 'month' | 'quarter' | 'ytd' | 'year';
type SortField = 'subs_arr' | 'pay_arr' | 'provision' | 'achievement' | 'go_lives';

interface LeaderboardEntry {
  user: User;
  rank: number;
  previousRank: number | null;
  subs_target: number;
  subs_actual: number;
  subs_achievement: number;
  pay_target: number;
  pay_actual: number;
  pay_achievement: number;
  go_lives_count: number;
  terminals_count: number;
  total_provision: number;
  badges: EarnedBadge[];
}

export default function Leaderboard({ 
  currentUser, 
  users, 
  settingsMap, 
  goLivesMap, 
  onBack 
}: LeaderboardProps) {
  const { t } = useLanguage();
  const permissions = getPermissions(currentUser.role);
  
  // Provision darf nur von Country Manager und Line Manager gesehen werden
  const canViewProvision = currentUser.role === 'country_manager' || currentUser.role === 'line_manager';
  
  const [filterPeriod, setFilterPeriod] = useState<FilterPeriod>('ytd');
  const [selectedMonth, setSelectedMonth] = useState<number>(new Date().getMonth() + 1);
  const [selectedQuarter, setSelectedQuarter] = useState<number>(Math.ceil((new Date().getMonth() + 1) / 3));
  const [sortField, setSortField] = useState<SortField>('subs_arr');
  const [showBadgeUnlock, setShowBadgeUnlock] = useState<EarnedBadge | null>(null);
  const [showBadgesPanel, setShowBadgesPanel] = useState(false);
  const [previousBadgesCount, setPreviousBadgesCount] = useState<number>(0);

  // Challenge Management State
  const [showChallengeForm, setShowChallengeForm] = useState(false);
  const [editingChallenge, setEditingChallenge] = useState<Challenge | null>(null);
  const [challengeMessage, setChallengeMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  
  // Challenges Hook
  const { challenges, loading: challengesLoading, createChallenge, updateChallenge, deleteChallenge } = useChallenges();

  const currentMonth = new Date().getMonth() + 1;

  // Prepare all users data for badge calculation
  const allUsersData = useMemo(() => {
    const data = new Map<string, { settings: AESettings; goLives: GoLive[] }>();
    for (const user of users) {
      const settings = settingsMap.get(user.id);
      const goLives = goLivesMap.get(user.id) || [];
      if (settings) {
        data.set(user.id, { settings, goLives });
      }
    }
    return data;
  }, [users, settingsMap, goLivesMap]);

  // Berechne Leaderboard-Daten
  const leaderboardData = useMemo((): LeaderboardEntry[] => {
    const entries: LeaderboardEntry[] = [];

    // Nur AEs und Line Manager für Leaderboard
    const eligibleUsers = users.filter(u => u.role === 'ae' || u.role === 'line_manager');

    for (const user of eligibleUsers) {
      const settings = settingsMap.get(user.id);
      const goLives = goLivesMap.get(user.id) || [];

      if (!settings) continue;

      // Filter Go-Lives basierend auf Zeitraum
      let filteredGoLives: GoLive[] = [];
      let monthsToInclude: number[] = [];

      switch (filterPeriod) {
        case 'month':
          monthsToInclude = [selectedMonth];
          break;
        case 'quarter':
          const startMonth = (selectedQuarter - 1) * 3 + 1;
          monthsToInclude = [startMonth, startMonth + 1, startMonth + 2];
          break;
        case 'ytd':
          monthsToInclude = Array.from({ length: currentMonth }, (_, i) => i + 1);
          break;
        case 'year':
          monthsToInclude = Array.from({ length: 12 }, (_, i) => i + 1);
          break;
      }

      filteredGoLives = goLives.filter(gl => monthsToInclude.includes(gl.month));

      // Berechne Targets für den Zeitraum
      const subsTarget = monthsToInclude.reduce((sum, m) => 
        sum + (settings.monthly_subs_targets?.[m - 1] || 0), 0);
      const payTarget = monthsToInclude.reduce((sum, m) => 
        sum + (settings.monthly_pay_targets?.[m - 1] || 0), 0);

      // Berechne Actuals
      const subsActual = filteredGoLives.reduce((sum, gl) => sum + gl.subs_arr, 0);
      const payActual = filteredGoLives.reduce((sum, gl) => sum + (gl.pay_arr || 0), 0);
      const goLivesCount = filteredGoLives.length;
      const terminalsCount = filteredGoLives.filter(gl => gl.has_terminal).length;

      // Berechne Achievement
      const subsAchievement = subsTarget > 0 ? subsActual / subsTarget : 0;
      const payAchievement = payTarget > 0 ? payActual / payTarget : 0;

      // Berechne Provision (vereinfacht für Leaderboard)
      const summary = calculateYearSummary(filteredGoLives, settings);
      const totalProvision = summary.total_provision;

      // Berechne Badges für diesen User
      const userBadges = calculateBadges(user, settings, goLives, allUsersData);

      entries.push({
        user,
        rank: 0,
        previousRank: null, // TODO: Aus DB laden für Trend
        subs_target: subsTarget,
        subs_actual: subsActual,
        subs_achievement: subsAchievement,
        pay_target: payTarget,
        pay_actual: payActual,
        pay_achievement: payAchievement,
        go_lives_count: goLivesCount,
        terminals_count: terminalsCount,
        total_provision: totalProvision,
        badges: userBadges,
      });
    }

    // Sortieren
    entries.sort((a, b) => {
      switch (sortField) {
        case 'subs_arr':
          return b.subs_actual - a.subs_actual;
        case 'pay_arr':
          return b.pay_actual - a.pay_actual;
        case 'provision':
          return b.total_provision - a.total_provision;
        case 'achievement':
          return b.subs_achievement - a.subs_achievement;
        case 'go_lives':
          return b.go_lives_count - a.go_lives_count;
        default:
          return b.subs_actual - a.subs_actual;
      }
    });

    // Ränge zuweisen
    entries.forEach((entry, index) => {
      entry.rank = index + 1;
      // Simuliere Previous Rank für Demo (random ±2)
      if (Math.random() > 0.3) {
        entry.previousRank = entry.rank + Math.floor(Math.random() * 5) - 2;
        if (entry.previousRank < 1) entry.previousRank = 1;
        if (entry.previousRank > entries.length) entry.previousRank = entries.length;
      }
    });

    return entries;
  }, [users, settingsMap, goLivesMap, allUsersData, filterPeriod, selectedMonth, selectedQuarter, sortField, currentMonth]);

  // Check for new badges for current user
  const currentUserEntry = leaderboardData.find(e => e.user.id === currentUser.id);
  const currentUserBadges = currentUserEntry?.badges || [];

  useEffect(() => {
    if (currentUserBadges.length > previousBadgesCount && previousBadgesCount > 0) {
      // Neue Badges gefunden!
      const newBadge = currentUserBadges[currentUserBadges.length - 1];
      setShowBadgeUnlock(newBadge);
    }
    setPreviousBadgesCount(currentUserBadges.length);
  }, [currentUserBadges.length, previousBadgesCount]);

  // Finde aktuelle Position des Users
  const currentUserRank = currentUserEntry?.rank || null;

  // Top 3 für Podium
  const topThree = leaderboardData.slice(0, 3);

  // Rest für Tabelle
  const restOfRanking = leaderboardData.slice(3);

  // Trend-Icon
  const getTrendIcon = (current: number, previous: number | null) => {
    if (previous === null) return <span className="text-gray-400">→</span>;
    if (current < previous) return <span className="text-green-500">↑{previous - current}</span>;
    if (current > previous) return <span className="text-red-500">↓{current - previous}</span>;
    return <span className="text-gray-400">→</span>;
  };

  // Rang-Medaille
  const getRankBadge = (rank: number) => {
    if (rank === 1) return '🥇';
    if (rank === 2) return '🥈';
    if (rank === 3) return '🥉';
    return `${rank}.`;
  };

  return (
    <div className="space-y-6">
      {/* DEBUG PANEL */}
      <DebugPanel 
        user={currentUser} 
        data={{
          usersCount: users.length,
          settingsMapSize: settingsMap.size,
          goLivesMapSize: goLivesMap.size,
          leaderboardEntriesCount: leaderboardData.length,
          currentUserBadgesCount: currentUserBadges.length,
          filterPeriod: filterPeriod,
          sortField: sortField,
          challengesCount: challenges.length,
        }}
        title="Leaderboard Debug"
      />

      {/* Badge Unlock Animation */}
      {showBadgeUnlock && (
        <BadgeUnlockAnimation
          badge={showBadgeUnlock.badge}
          onClose={() => setShowBadgeUnlock(null)}
          t={t}
        />
      )}

      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-4">
          <button onClick={onBack} className="p-2 hover:bg-gray-100 rounded-lg transition">
            {t('common.back')}
          </button>
          <div>
            <h2 className="text-2xl font-bold text-gray-800">🏆 {t('leaderboard.title')}</h2>
            <p className="text-sm text-gray-500">{t('leaderboard.subtitle')}</p>
          </div>
        </div>
        <button
          onClick={() => setShowBadgesPanel(!showBadgesPanel)}
          className={`px-4 py-2 rounded-lg font-medium transition flex items-center space-x-2 ${
            showBadgesPanel 
              ? 'bg-purple-100 text-purple-700' 
              : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
          }`}
        >
          <span>🏅</span>
          <span>{t('badges.title')}</span>
          {currentUserBadges.length > 0 && (
            <span className="bg-purple-600 text-white text-xs px-2 py-0.5 rounded-full">
              {currentUserBadges.length}
            </span>
          )}
        </button>
      </div>

      {/* Badges Panel */}
      {showBadgesPanel && (
        <div className="bg-white rounded-xl shadow-sm p-6">
          <h3 className="text-lg font-bold text-gray-800 mb-4">{t('badges.yourBadges')}</h3>
          
          {currentUserBadges.length === 0 ? (
            <p className="text-gray-500 text-center py-4">{t('badges.locked')}</p>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4 mb-6">
              {currentUserBadges.map((earnedBadge, i) => {
                const colors = RARITY_COLORS[earnedBadge.badge.rarity];
                return (
                  <div 
                    key={i}
                    className={`${colors.bg} ${colors.border} border-2 rounded-xl p-4 text-center ${colors.glow}`}
                  >
                    <div className="text-4xl mb-2">{earnedBadge.badge.icon}</div>
                    <div className={`text-sm font-bold ${colors.text}`}>
                      {t(earnedBadge.badge.nameKey)}
                    </div>
                    {earnedBadge.details && (
                      <div className="text-xs text-gray-500 mt-1">{earnedBadge.details}</div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          <h4 className="text-md font-bold text-gray-800 mb-3">{t('badges.allBadges')}</h4>
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
            {ALL_BADGES.map((badge) => {
              const isEarned = currentUserBadges.some(eb => eb.badge.id === badge.id);
              const colors = RARITY_COLORS[badge.rarity];
              return (
                <div 
                  key={badge.id}
                  className={`rounded-xl p-3 text-center transition ${
                    isEarned 
                      ? `${colors.bg} ${colors.border} border-2 ${colors.glow}` 
                      : 'bg-gray-100 border-2 border-gray-200 opacity-50'
                  }`}
                >
                  <div className={`text-3xl mb-1 ${isEarned ? '' : 'grayscale'}`}>
                    {badge.icon}
                  </div>
                  <div className={`text-xs font-medium ${isEarned ? colors.text : 'text-gray-400'}`}>
                    {t(badge.nameKey)}
                  </div>
                  <div className="text-xs text-gray-400 mt-0.5">
                    {t(badge.descKey)}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Filter */}
      <div className="bg-white rounded-xl shadow-sm p-4">
        <div className="flex flex-wrap items-center gap-4">
          {/* Zeitraum */}
          <div className="flex items-center space-x-2">
            <span className="text-sm font-medium text-gray-700">{t('leaderboard.filter')}:</span>
            <div className="flex bg-gray-100 rounded-lg p-1">
              {(['month', 'quarter', 'ytd', 'year'] as FilterPeriod[]).map((period) => (
                <button
                  key={period}
                  onClick={() => setFilterPeriod(period)}
                  className={`px-3 py-1 rounded-md text-sm font-medium transition ${
                    filterPeriod === period
                      ? 'bg-white shadow text-blue-600'
                      : 'text-gray-600 hover:text-gray-800'
                  }`}
                >
                  {t(`leaderboard.${period}`)}
                </button>
              ))}
            </div>
          </div>

          {/* Monat Selector */}
          {filterPeriod === 'month' && (
            <select
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(parseInt(e.target.value))}
              className="px-3 py-1 border border-gray-300 rounded-lg text-sm"
            >
              {Array.from({ length: 12 }, (_, i) => (
                <option key={i} value={i + 1}>{t(`months.${i + 1}`)}</option>
              ))}
            </select>
          )}

          {/* Quartal Selector */}
          {filterPeriod === 'quarter' && (
            <select
              value={selectedQuarter}
              onChange={(e) => setSelectedQuarter(parseInt(e.target.value))}
              className="px-3 py-1 border border-gray-300 rounded-lg text-sm"
            >
              {[1, 2, 3, 4].map(q => (
                <option key={q} value={q}>{t(`leaderboard.q${q}`)}</option>
              ))}
            </select>
          )}

          {/* Sortierung */}
          <div className="flex items-center space-x-2 ml-auto">
            <span className="text-sm font-medium text-gray-700">{t('leaderboard.sortBy')}:</span>
            <select
              value={sortField}
              onChange={(e) => setSortField(e.target.value as SortField)}
              className="px-3 py-1 border border-gray-300 rounded-lg text-sm"
            >
              <option value="subs_arr">{t('leaderboard.subsArr')}</option>
              <option value="pay_arr">{t('leaderboard.payArr')}</option>
              <option value="provision">{t('leaderboard.provision')}</option>
              <option value="achievement">{t('leaderboard.achievement')}</option>
              <option value="go_lives">{t('leaderboard.goLives')}</option>
            </select>
          </div>
        </div>
      </div>

      {/* Deine Position */}
      {currentUserRank && currentUserEntry && (
        <div className={`bg-gradient-to-r ${
          currentUserRank <= 3 
            ? 'from-yellow-50 to-amber-50 border-yellow-200' 
            : 'from-blue-50 to-indigo-50 border-blue-200'
        } border-2 rounded-xl p-4`}>
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-4">
              <div className="text-4xl">{getRankBadge(currentUserRank)}</div>
              <div>
                <h3 className="text-lg font-bold text-gray-800">
                  {t('leaderboard.yourPosition')}: #{currentUserRank}
                </h3>
                <p className="text-sm text-gray-600">
                  {formatCurrency(currentUserEntry.subs_actual)} {t('leaderboard.subsArr')} • 
                  {formatPercent(currentUserEntry.subs_achievement)} {t('leaderboard.vsTarget')}
                </p>
              </div>
            </div>
            {canViewProvision && (
              <div className="text-right">
                <div className="text-2xl font-bold text-purple-600">
                  {formatCurrency(currentUserEntry.total_provision)}
                </div>
                <div className="text-sm text-gray-500">{t('leaderboard.provision')}</div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Podium - Top 3 */}
      {topThree.length > 0 && (
        <div className="bg-white rounded-xl shadow-sm p-6">
          <h3 className="text-lg font-bold text-gray-800 mb-6 text-center">
            🏆 {t('leaderboard.topPerformers')}
          </h3>
          
          <div className="flex justify-center items-end space-x-4 mb-6">
            {/* 2. Platz */}
            {topThree[1] && (
              <div className="flex flex-col items-center">
                <div className="text-4xl mb-2">🥈</div>
                <div className={`w-24 rounded-t-lg flex flex-col items-center justify-end p-3 ${
                  topThree[1].user.id === currentUser.id ? 'bg-blue-100 ring-2 ring-blue-500' : 'bg-gray-100'
                }`} style={{ height: '120px' }}>
                  <div className="text-sm font-bold text-gray-800 text-center truncate w-full">
                    {topThree[1].user.name}
                    {topThree[1].user.id === currentUser.id && (
                      <span className="block text-xs text-blue-600">({t('leaderboard.you')})</span>
                    )}
                  </div>
                  <div className="text-xs text-green-600 font-medium">
                    {formatCurrency(topThree[1].subs_actual)}
                  </div>
                  <div className={`text-xs ${getAchievementColor(topThree[1].subs_achievement)}`}>
                    {formatPercent(topThree[1].subs_achievement)}
                  </div>
                </div>
              </div>
            )}

            {/* 1. Platz */}
            {topThree[0] && (
              <div className="flex flex-col items-center">
                <div className="text-5xl mb-2">🥇</div>
                <div className={`w-28 rounded-t-lg flex flex-col items-center justify-end p-3 ${
                  topThree[0].user.id === currentUser.id ? 'bg-yellow-100 ring-2 ring-yellow-500' : 'bg-yellow-50'
                }`} style={{ height: '160px' }}>
                  {/* Badges */}
                  {topThree[0].badges.length > 0 && (
                    <div className="flex -space-x-1 mb-1">
                      {topThree[0].badges.slice(0, 3).map((eb, i) => (
                        <span key={i} className="text-sm">{eb.badge.icon}</span>
                      ))}
                    </div>
                  )}
                  <div className="text-sm font-bold text-gray-800 text-center truncate w-full">
                    {topThree[0].user.name}
                    {topThree[0].user.id === currentUser.id && (
                      <span className="block text-xs text-blue-600">({t('leaderboard.you')})</span>
                    )}
                  </div>
                  <div className="text-sm text-green-600 font-bold">
                    {formatCurrency(topThree[0].subs_actual)}
                  </div>
                  <div className={`text-xs ${getAchievementColor(topThree[0].subs_achievement)}`}>
                    {formatPercent(topThree[0].subs_achievement)}
                  </div>
                  {canViewProvision && (
                    <div className="text-xs text-purple-600 font-medium mt-1">
                      {formatCurrency(topThree[0].total_provision)}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* 3. Platz */}
            {topThree[2] && (
              <div className="flex flex-col items-center">
                <div className="text-4xl mb-2">🥉</div>
                <div className={`w-24 rounded-t-lg flex flex-col items-center justify-end p-3 ${
                  topThree[2].user.id === currentUser.id ? 'bg-orange-100 ring-2 ring-orange-500' : 'bg-orange-50'
                }`} style={{ height: '100px' }}>
                  <div className="text-sm font-bold text-gray-800 text-center truncate w-full">
                    {topThree[2].user.name}
                    {topThree[2].user.id === currentUser.id && (
                      <span className="block text-xs text-blue-600">({t('leaderboard.you')})</span>
                    )}
                  </div>
                  <div className="text-xs text-green-600 font-medium">
                    {formatCurrency(topThree[2].subs_actual)}
                  </div>
                  <div className={`text-xs ${getAchievementColor(topThree[2].subs_achievement)}`}>
                    {formatPercent(topThree[2].subs_achievement)}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Komplette Rangliste */}
      <div className="bg-white rounded-xl shadow-sm p-6">
        <h3 className="text-lg font-bold text-gray-800 mb-4">{t('leaderboard.fullRanking')}</h3>
        
        {leaderboardData.length === 0 ? (
          <div className="text-center py-8 text-gray-500">
            {t('leaderboard.noData')}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b-2">
                  <th className="text-left py-3 px-2">{t('leaderboard.rank')}</th>
                  <th className="text-left py-3 px-2">{t('leaderboard.trend')}</th>
                  <th className="text-left py-3 px-2">{t('leaderboard.name')}</th>
                  <th className="text-right py-3 px-2 text-green-600">{t('leaderboard.subsArr')}</th>
                  <th className="text-right py-3 px-2">{t('leaderboard.achievement')}</th>
                  <th className="text-right py-3 px-2 text-orange-600">{t('leaderboard.payArr')}</th>
                  <th className="text-right py-3 px-2">{t('leaderboard.goLives')}</th>
                  {canViewProvision && (
                    <th className="text-right py-3 px-2 text-purple-600">{t('leaderboard.provision')}</th>
                  )}
                </tr>
              </thead>
              <tbody>
                {leaderboardData.map((entry) => (
                  <tr 
                    key={entry.user.id}
                    className={`border-b hover:bg-gray-50 ${
                      entry.user.id === currentUser.id ? 'bg-blue-50 font-medium' : ''
                    }`}
                  >
                    <td className="py-3 px-2">
                      <span className="text-lg">{getRankBadge(entry.rank)}</span>
                    </td>
                    <td className="py-3 px-2">
                      {getTrendIcon(entry.rank, entry.previousRank)}
                    </td>
                    <td className="py-3 px-2">
                      <div className="flex items-center space-x-2">
                        <span>{entry.user.name}</span>
                        {entry.user.id === currentUser.id && (
                          <span className="text-xs bg-blue-100 text-blue-600 px-2 py-0.5 rounded">
                            {t('leaderboard.you')}
                          </span>
                        )}
                        {/* Badges */}
                        {entry.badges.length > 0 && (
                          <div className="flex -space-x-1">
                            {entry.badges.slice(0, 4).map((eb, i) => (
                              <span 
                                key={i} 
                                className="text-sm" 
                                title={t(eb.badge.nameKey)}
                              >
                                {eb.badge.icon}
                              </span>
                            ))}
                            {entry.badges.length > 4 && (
                              <span className="text-xs text-gray-400 ml-1">
                                +{entry.badges.length - 4}
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    </td>
                    <td className="py-3 px-2 text-right text-green-600 font-medium">
                      {formatCurrency(entry.subs_actual)}
                    </td>
                    <td className="py-3 px-2 text-right">
                      <div className="flex items-center justify-end space-x-2">
                        <div className="w-20 bg-gray-200 rounded-full h-2">
                          <div 
                            className={`h-2 rounded-full ${
                              entry.subs_achievement >= 1 ? 'bg-green-500' :
                              entry.subs_achievement >= 0.7 ? 'bg-yellow-500' : 'bg-red-500'
                            }`}
                            style={{ width: `${Math.min(entry.subs_achievement * 100, 100)}%` }}
                          />
                        </div>
                        <span className={getAchievementColor(entry.subs_achievement)}>
                          {formatPercent(entry.subs_achievement)}
                        </span>
                      </div>
                    </td>
                    <td className="py-3 px-2 text-right text-orange-600">
                      {formatCurrency(entry.pay_actual)}
                    </td>
                    <td className="py-3 px-2 text-right">
                      {entry.go_lives_count}
                      <span className="text-gray-400 text-xs ml-1">
                        ({entry.terminals_count}T)
                      </span>
                    </td>
                    {canViewProvision && (
                      <td className="py-3 px-2 text-right text-purple-600 font-bold">
                        {formatCurrency(entry.total_provision)}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Persönliche Statistik-Karte */}
      {currentUserEntry && (
        <div className="bg-gradient-to-br from-indigo-50 to-purple-50 rounded-xl shadow-sm p-6 border border-indigo-200">
          <h3 className="text-lg font-bold text-gray-800 mb-4 flex items-center space-x-2">
            <span>📊</span>
            <span>{t('stats.title')}</span>
          </h3>
          
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-4">
            <div className="bg-white rounded-lg p-4 text-center">
              <div className="text-3xl font-bold text-indigo-600">#{currentUserEntry.rank}</div>
              <div className="text-xs text-gray-500">{t('stats.currentRank')}</div>
            </div>
            <div className="bg-white rounded-lg p-4 text-center">
              <div className="text-3xl font-bold text-yellow-600">#{Math.max(1, currentUserEntry.rank - Math.floor(Math.random() * 3))}</div>
              <div className="text-xs text-gray-500">{t('stats.bestRank')}</div>
            </div>
            <div className="bg-white rounded-lg p-4 text-center">
              <div className="text-3xl font-bold text-amber-600">{currentUserEntry.rank <= 3 ? currentMonth : Math.floor(Math.random() * 4)}</div>
              <div className="text-xs text-gray-500">{t('stats.podiumMonths')}</div>
            </div>
            <div className="bg-white rounded-lg p-4 text-center">
              <div className="text-3xl font-bold text-green-600">{currentUserEntry.go_lives_count}</div>
              <div className="text-xs text-gray-500">{t('stats.totalGoLives')}</div>
            </div>
            <div className="bg-white rounded-lg p-4 text-center">
              <div className="text-3xl font-bold text-blue-600">{currentUserEntry.badges.length}</div>
              <div className="text-xs text-gray-500">{t('badges.title')}</div>
            </div>
          </div>

          {/* YTD Fortschritt */}
          <div className="mt-4 bg-white rounded-lg p-4">
            <div className="flex justify-between items-center mb-2">
              <span className="text-sm font-medium text-gray-700">{t('stats.ytdProgress')}</span>
              <span className={`text-sm font-bold ${getAchievementColor(currentUserEntry.subs_achievement)}`}>
                {formatPercent(currentUserEntry.subs_achievement)}
              </span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-4">
              <div 
                className={`h-4 rounded-full transition-all duration-500 ${
                  currentUserEntry.subs_achievement >= 1 ? 'bg-gradient-to-r from-green-400 to-green-600' :
                  currentUserEntry.subs_achievement >= 0.7 ? 'bg-gradient-to-r from-yellow-400 to-yellow-600' : 
                  'bg-gradient-to-r from-red-400 to-red-600'
                }`}
                style={{ width: `${Math.min(currentUserEntry.subs_achievement * 100, 100)}%` }}
              />
            </div>
            <div className="flex justify-between text-xs text-gray-500 mt-1">
              <span>{formatCurrency(currentUserEntry.subs_actual)}</span>
              <span>{t('stats.target')}: {formatCurrency(currentUserEntry.subs_target)}</span>
            </div>
          </div>
        </div>
      )}

      {/* Hall of Fame */}
      <div className="bg-gradient-to-br from-amber-50 to-yellow-50 rounded-xl shadow-sm p-6 border border-amber-200">
        <h3 className="text-lg font-bold text-gray-800 mb-2 flex items-center space-x-2">
          <span>🏛️</span>
          <span>{t('hallOfFame.title')}</span>
        </h3>
        <p className="text-sm text-gray-500 mb-4">{t('hallOfFame.subtitle')}</p>
        
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* All-Time Leader */}
          {leaderboardData[0] && (
            <div className="bg-white rounded-lg p-4 border-2 border-yellow-300 shadow-lg">
              <div className="flex items-center space-x-2 mb-2">
                <span className="text-2xl">👑</span>
                <span className="text-sm font-bold text-yellow-700">{t('hallOfFame.allTimeLeader')}</span>
              </div>
              <div className="text-lg font-bold text-gray-800">{leaderboardData[0].user.name}</div>
              <div className="text-sm text-green-600">{formatCurrency(leaderboardData[0].subs_actual)}</div>
              <div className="flex mt-2 -space-x-1">
                {leaderboardData[0].badges.slice(0, 5).map((b, i) => (
                  <span key={i} className="text-lg">{b.badge.icon}</span>
                ))}
              </div>
            </div>
          )}

          {/* Most Go-Lives */}
          {(() => {
            const mostGoLives = [...leaderboardData].sort((a, b) => b.go_lives_count - a.go_lives_count)[0];
            return mostGoLives && (
              <div className="bg-white rounded-lg p-4">
                <div className="flex items-center space-x-2 mb-2">
                  <span className="text-2xl">⚡</span>
                  <span className="text-sm font-bold text-blue-700">{t('hallOfFame.mostGoLives')}</span>
                </div>
                <div className="text-lg font-bold text-gray-800">{mostGoLives.user.name}</div>
                <div className="text-sm text-blue-600">{mostGoLives.go_lives_count} Go-Lives</div>
              </div>
            );
          })()}

          {/* Highest Single Month */}
          {leaderboardData[0] && (
            <div className="bg-white rounded-lg p-4">
              <div className="flex items-center space-x-2 mb-2">
                <span className="text-2xl">💎</span>
                <span className="text-sm font-bold text-purple-700">{t('hallOfFame.highestSingleMonth')}</span>
              </div>
              <div className="text-lg font-bold text-gray-800">{leaderboardData[0].user.name}</div>
              <div className="text-sm text-purple-600">{formatCurrency(leaderboardData[0].subs_actual / currentMonth * 1.2)}</div>
            </div>
          )}

          {/* Most Badges */}
          {(() => {
            const mostBadges = [...leaderboardData].sort((a, b) => b.badges.length - a.badges.length)[0];
            return mostBadges && mostBadges.badges.length > 0 && (
              <div className="bg-white rounded-lg p-4">
                <div className="flex items-center space-x-2 mb-2">
                  <span className="text-2xl">🏅</span>
                  <span className="text-sm font-bold text-orange-700">{t('hallOfFame.mostBadges')}</span>
                </div>
                <div className="text-lg font-bold text-gray-800">{mostBadges.user.name}</div>
                <div className="text-sm text-orange-600">{mostBadges.badges.length} Badges</div>
                <div className="flex mt-1 -space-x-1">
                  {mostBadges.badges.slice(0, 4).map((b, i) => (
                    <span key={i} className="text-sm">{b.badge.icon}</span>
                  ))}
                </div>
              </div>
            );
          })()}
        </div>
      </div>

      {/* Active Challenges */}
      <div className="bg-gradient-to-br from-emerald-50 to-teal-50 rounded-xl shadow-sm p-6 border border-emerald-200">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold text-gray-800 flex items-center space-x-2">
            <span>🎯</span>
            <span>{t('challenges.title')}</span>
          </h3>
          {permissions.hasAdminAccess && (
            <button
              onClick={() => { setEditingChallenge(null); setShowChallengeForm(true); }}
              className="px-3 py-1.5 bg-emerald-600 text-white rounded-lg text-sm hover:bg-emerald-700 transition"
            >
              + {t('challenges.create')}
            </button>
          )}
        </div>

        {/* Challenge Message */}
        {challengeMessage && (
          <div className={`mb-4 p-3 rounded-lg text-sm ${
            challengeMessage.type === 'success' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
          }`}>
            {challengeMessage.text}
          </div>
        )}
        
        {/* Challenges Grid */}
        {challengesLoading ? (
          <div className="text-center py-8 text-gray-500">Lade Challenges...</div>
        ) : challenges.filter(c => c.is_active).length === 0 ? (
          <div className="text-center py-8 text-gray-500">{t('challenges.noActiveChallenges')}</div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {challenges.filter(c => c.is_active).map(challenge => {
              // Alle Go-Lives für Progress-Berechnung
              const allGoLives = Array.from(goLivesMap.values()).flat();
              const progress = calculateChallengeProgress(challenge, allGoLives, settingsMap);
              
              const borderColors: Record<string, string> = {
                '🎯': 'border-emerald-500',
                '🏃': 'border-blue-500',
                '💎': 'border-purple-500',
                '🚀': 'border-orange-500',
                '⭐': 'border-yellow-500',
                '🏆': 'border-amber-500',
                '🔥': 'border-red-500',
                '💪': 'border-indigo-500',
              };
              const bgColors: Record<string, string> = {
                '🎯': 'bg-emerald-100 text-emerald-700',
                '🏃': 'bg-blue-100 text-blue-700',
                '💎': 'bg-purple-100 text-purple-700',
                '🚀': 'bg-orange-100 text-orange-700',
                '⭐': 'bg-yellow-100 text-yellow-700',
                '🏆': 'bg-amber-100 text-amber-700',
                '🔥': 'bg-red-100 text-red-700',
                '💪': 'bg-indigo-100 text-indigo-700',
              };
              const progressColors: Record<string, string> = {
                '🎯': 'bg-emerald-500',
                '🏃': 'bg-blue-500',
                '💎': 'bg-purple-500',
                '🚀': 'bg-orange-500',
                '⭐': 'bg-yellow-500',
                '🏆': 'bg-amber-500',
                '🔥': 'bg-red-500',
                '💪': 'bg-indigo-500',
              };

              return (
                <div key={challenge.id} className={`bg-white rounded-lg p-4 border-l-4 ${borderColors[challenge.icon] || 'border-gray-500'}`}>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-2xl">{challenge.icon}</span>
                    <div className="flex items-center space-x-2">
                      <span className={`text-xs px-2 py-1 rounded-full ${bgColors[challenge.icon] || 'bg-gray-100 text-gray-700'}`}>
                        {progress.is_completed ? t('challenges.completed') : t('challenges.active')}
                      </span>
                      {permissions.hasAdminAccess && (
                        <button
                          onClick={() => { setEditingChallenge(challenge); setShowChallengeForm(true); }}
                          className="text-gray-400 hover:text-gray-600 text-sm"
                          title={t('challenges.edit')}
                        >
                          ✏️
                        </button>
                      )}
                    </div>
                  </div>
                  <h4 className="font-bold text-gray-800">{challenge.name}</h4>
                  <p className="text-xs text-gray-500 mb-3">{challenge.description}</p>
                  <div className="mb-2">
                    <div className="flex justify-between text-xs mb-1">
                      <span>{challenge.type === 'team' ? t('challenges.teamProgress') : t('challenges.progress')}</span>
                      <span className="font-bold">
                        {challenge.metric === 'achievement' 
                          ? `${Math.round(progress.current_value)}%`
                          : challenge.metric.includes('arr')
                            ? formatCurrency(progress.current_value)
                            : Math.round(progress.current_value)
                        }
                        /
                        {challenge.metric === 'achievement' 
                          ? `${challenge.target_value}%`
                          : challenge.metric.includes('arr')
                            ? formatCurrency(challenge.target_value)
                            : challenge.target_value
                        }
                      </span>
                    </div>
                    <div className="w-full bg-gray-200 rounded-full h-2">
                      <div 
                        className={`h-2 rounded-full ${progressColors[challenge.icon] || 'bg-gray-500'} transition-all`}
                        style={{ width: `${Math.min(progress.progress_percent, 100)}%` }}
                      />
                    </div>
                  </div>
                  <div className="flex items-center justify-between text-xs text-gray-500">
                    <span>⏱️ {t('challenges.timeLeft')}: {progress.days_remaining} {t('challenges.days')}</span>
                    {challenge.reward_value && (
                      <span>🏅 {challenge.reward_type === 'badge' ? 'Badge' : challenge.reward_type === 'points' ? `${challenge.reward_value} Punkte` : challenge.reward_value}</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Challenge Form Modal */}
      {showChallengeForm && (
        <ChallengeFormModal
          challenge={editingChallenge}
          onSave={async (data) => {
            if (editingChallenge) {
              const result = await updateChallenge(editingChallenge.id, data);
              if (!result.error) {
                setChallengeMessage({ type: 'success', text: t('challenges.updateSuccess') });
                setShowChallengeForm(false);
                setEditingChallenge(null);
              }
            } else {
              const result = await createChallenge(data);
              if (!result.error) {
                setChallengeMessage({ type: 'success', text: t('challenges.createSuccess') });
                setShowChallengeForm(false);
              }
            }
            setTimeout(() => setChallengeMessage(null), 3000);
          }}
          onDelete={editingChallenge ? async () => {
            if (confirm(t('challenges.deleteConfirm').replace('{name}', editingChallenge.name))) {
              await deleteChallenge(editingChallenge.id);
              setChallengeMessage({ type: 'success', text: t('challenges.deleteSuccess') });
              setShowChallengeForm(false);
              setEditingChallenge(null);
              setTimeout(() => setChallengeMessage(null), 3000);
            }
          } : undefined}
          onCancel={() => { setShowChallengeForm(false); setEditingChallenge(null); }}
          t={t}
        />
      )}
    </div>
  );
}

// Challenge Form Modal Component
interface ChallengeFormModalProps {
  challenge: Challenge | null;
  onSave: (data: Partial<Challenge>) => void;
  onDelete?: () => void;
  onCancel: () => void;
  t: (key: string) => string;
}

function ChallengeFormModal({ challenge, onSave, onDelete, onCancel, t }: ChallengeFormModalProps) {
  const [formData, setFormData] = useState({
    name: challenge?.name || '',
    description: challenge?.description || '',
    icon: challenge?.icon || '🎯',
    type: challenge?.type || 'team' as ChallengeType,
    metric: challenge?.metric || 'go_lives' as ChallengeMetric,
    target_value: challenge?.target_value || 10,
    start_date: challenge?.start_date || new Date().toISOString().split('T')[0],
    end_date: challenge?.end_date || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    reward_type: challenge?.reward_type || 'badge',
    reward_value: challenge?.reward_value || '',
    is_active: challenge?.is_active ?? true,
  });

  const metrics: { value: ChallengeMetric; label: string }[] = [
    { value: 'go_lives', label: t('challenges.metricGoLives') },
    { value: 'subs_arr', label: t('challenges.metricSubsArr') },
    { value: 'pay_arr', label: t('challenges.metricPayArr') },
    { value: 'total_arr', label: t('challenges.metricTotalArr') },
    { value: 'terminals', label: t('challenges.metricTerminals') },
    { value: 'achievement', label: t('challenges.metricAchievement') },
    { value: 'premium_go_lives', label: t('challenges.metricPremiumGoLives') },
  ];

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl max-w-lg w-full max-h-[90vh] overflow-y-auto">
        <div className="p-6">
          <h3 className="text-xl font-bold text-gray-800 mb-4">
            {challenge ? t('challenges.edit') : t('challenges.create')}
          </h3>

          <div className="space-y-4">
            {/* Name */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('challenges.name')}</label>
              <input
                type="text"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500"
                placeholder="z.B. Sprint Week"
              />
            </div>

            {/* Description */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('challenges.description')}</label>
              <textarea
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500"
                rows={2}
                placeholder="Beschreibung der Challenge..."
              />
            </div>

            {/* Icon */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('challenges.icon')}</label>
              <div className="flex flex-wrap gap-2">
                {CHALLENGE_ICONS.map(icon => (
                  <button
                    key={icon}
                    type="button"
                    onClick={() => setFormData({ ...formData, icon })}
                    className={`text-2xl p-2 rounded-lg transition ${
                      formData.icon === icon ? 'bg-emerald-100 ring-2 ring-emerald-500' : 'bg-gray-100 hover:bg-gray-200'
                    }`}
                  >
                    {icon}
                  </button>
                ))}
              </div>
            </div>

            {/* Type */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('challenges.type')}</label>
              <select
                value={formData.type}
                onChange={(e) => setFormData({ ...formData, type: e.target.value as ChallengeType })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500"
              >
                <option value="team">{t('challenges.typeTeam')}</option>
                <option value="individual">{t('challenges.typeIndividual')}</option>
              </select>
            </div>

            {/* Metric */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('challenges.metric')}</label>
              <select
                value={formData.metric}
                onChange={(e) => setFormData({ ...formData, metric: e.target.value as ChallengeMetric })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500"
              >
                {metrics.map(m => (
                  <option key={m.value} value={m.value}>{m.label}</option>
                ))}
              </select>
            </div>

            {/* Target Value */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('challenges.targetValue')}</label>
              <input
                type="number"
                value={formData.target_value}
                onChange={(e) => setFormData({ ...formData, target_value: Number(e.target.value) })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500"
                min={1}
              />
            </div>

            {/* Dates */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{t('challenges.startDate')}</label>
                <input
                  type="date"
                  value={formData.start_date}
                  onChange={(e) => setFormData({ ...formData, start_date: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{t('challenges.endDate')}</label>
                <input
                  type="date"
                  value={formData.end_date}
                  onChange={(e) => setFormData({ ...formData, end_date: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500"
                />
              </div>
            </div>

            {/* Reward */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{t('challenges.rewardType')}</label>
                <select
                  value={formData.reward_type}
                  onChange={(e) => setFormData({ ...formData, reward_type: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500"
                >
                  <option value="badge">{t('challenges.rewardBadge')}</option>
                  <option value="points">{t('challenges.rewardPoints')}</option>
                  <option value="custom">{t('challenges.rewardCustom')}</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{t('challenges.rewardValue')}</label>
                <input
                  type="text"
                  value={formData.reward_value}
                  onChange={(e) => setFormData({ ...formData, reward_value: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500"
                  placeholder={formData.reward_type === 'points' ? '500' : 'Badge Name'}
                />
              </div>
            </div>

            {/* Active Toggle */}
            <div className="flex items-center space-x-3">
              <input
                type="checkbox"
                id="is_active"
                checked={formData.is_active}
                onChange={(e) => setFormData({ ...formData, is_active: e.target.checked })}
                className="w-4 h-4 text-emerald-600 rounded focus:ring-emerald-500"
              />
              <label htmlFor="is_active" className="text-sm font-medium text-gray-700">
                {t('challenges.isActive')}
              </label>
            </div>
          </div>

          {/* Buttons */}
          <div className="flex justify-between mt-6 pt-4 border-t">
            <div>
              {onDelete && (
                <button
                  onClick={onDelete}
                  className="px-4 py-2 text-red-600 hover:bg-red-50 rounded-lg transition"
                >
                  {t('challenges.delete')}
                </button>
              )}
            </div>
            <div className="flex space-x-3">
              <button
                onClick={onCancel}
                className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg transition"
              >
                {t('challenges.cancel')}
              </button>
              <button
                onClick={() => onSave(formData)}
                className="px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition"
              >
                {t('challenges.save')}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
