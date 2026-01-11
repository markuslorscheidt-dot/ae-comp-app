// ============================================
// BADGE SYSTEM - Typen und Berechnungen
// ============================================

import { User, AESettings, GoLive } from './types';

export type BadgeId = 
  | 'first_blood'
  | 'hot_streak'
  | 'rocket_start'
  | 'diamond_closer'
  | 'sharpshooter'
  | 'monthly_king'
  | 'speed_demon'
  | 'money_maker'
  | 'ote_champion'
  | 'rising_star'
  | 'terminal_titan'
  | 'centurion';

export interface Badge {
  id: BadgeId;
  icon: string;
  nameKey: string;
  descKey: string;
  rarity: 'common' | 'rare' | 'epic' | 'legendary';
}

export interface EarnedBadge {
  badge: Badge;
  earnedAt: Date;
  month?: number;
  year?: number;
  details?: string;
}

// Alle verfügbaren Badges
export const ALL_BADGES: Badge[] = [
  {
    id: 'first_blood',
    icon: '🎯',
    nameKey: 'badges.firstBlood',
    descKey: 'badges.firstBloodDesc',
    rarity: 'common',
  },
  {
    id: 'hot_streak',
    icon: '🔥',
    nameKey: 'badges.hotStreak',
    descKey: 'badges.hotStreakDesc',
    rarity: 'epic',
  },
  {
    id: 'rocket_start',
    icon: '🚀',
    nameKey: 'badges.rocketStart',
    descKey: 'badges.rocketStartDesc',
    rarity: 'rare',
  },
  {
    id: 'diamond_closer',
    icon: '💎',
    nameKey: 'badges.diamondCloser',
    descKey: 'badges.diamondCloserDesc',
    rarity: 'epic',
  },
  {
    id: 'sharpshooter',
    icon: '🎯',
    nameKey: 'badges.sharpshooter',
    descKey: 'badges.sharpshooterDesc',
    rarity: 'legendary',
  },
  {
    id: 'monthly_king',
    icon: '👑',
    nameKey: 'badges.monthlyKing',
    descKey: 'badges.monthlyKingDesc',
    rarity: 'epic',
  },
  {
    id: 'speed_demon',
    icon: '⚡',
    nameKey: 'badges.speedDemon',
    descKey: 'badges.speedDemonDesc',
    rarity: 'rare',
  },
  {
    id: 'money_maker',
    icon: '💰',
    nameKey: 'badges.moneyMaker',
    descKey: 'badges.moneyMakerDesc',
    rarity: 'epic',
  },
  {
    id: 'ote_champion',
    icon: '🏆',
    nameKey: 'badges.oteChampion',
    descKey: 'badges.oteChampionDesc',
    rarity: 'legendary',
  },
  {
    id: 'rising_star',
    icon: '🌟',
    nameKey: 'badges.risingStar',
    descKey: 'badges.risingStarDesc',
    rarity: 'rare',
  },
  {
    id: 'terminal_titan',
    icon: '🤝',
    nameKey: 'badges.terminalTitan',
    descKey: 'badges.terminalTitanDesc',
    rarity: 'rare',
  },
  {
    id: 'centurion',
    icon: '💯',
    nameKey: 'badges.centurion',
    descKey: 'badges.centurionDesc',
    rarity: 'legendary',
  },
];

// Rarity Farben
export const RARITY_COLORS = {
  common: {
    bg: 'bg-gray-100',
    border: 'border-gray-300',
    text: 'text-gray-600',
    glow: '',
  },
  rare: {
    bg: 'bg-blue-50',
    border: 'border-blue-300',
    text: 'text-blue-600',
    glow: 'shadow-blue-200',
  },
  epic: {
    bg: 'bg-purple-50',
    border: 'border-purple-300',
    text: 'text-purple-600',
    glow: 'shadow-purple-200',
  },
  legendary: {
    bg: 'bg-gradient-to-br from-yellow-50 to-amber-50',
    border: 'border-yellow-400',
    text: 'text-yellow-600',
    glow: 'shadow-yellow-200 shadow-lg',
  },
};

// Monatliche Performance Daten
interface MonthlyPerformance {
  month: number;
  year: number;
  subsTarget: number;
  subsActual: number;
  subsAchievement: number;
  payTarget: number;
  payActual: number;
  goLivesCount: number;
  terminalsCount: number;
  terminalPenetration: number;
  provision: number;
}

// Badge-Berechnung
export function calculateBadges(
  user: User,
  settings: AESettings,
  goLives: GoLive[],
  allUsersData?: Map<string, { settings: AESettings; goLives: GoLive[] }>
): EarnedBadge[] {
  const earnedBadges: EarnedBadge[] = [];
  const currentYear = new Date().getFullYear();
  const currentMonth = new Date().getMonth() + 1;

  // Berechne monatliche Performance
  const monthlyPerf: MonthlyPerformance[] = [];
  for (let m = 1; m <= 12; m++) {
    const monthGoLives = goLives.filter(gl => gl.month === m);
    const subsTarget = settings.monthly_subs_targets?.[m - 1] || 0;
    const subsActual = monthGoLives.reduce((sum, gl) => sum + gl.subs_arr, 0);
    const payTarget = settings.monthly_pay_targets?.[m - 1] || 0;
    const payActual = monthGoLives.reduce((sum, gl) => sum + (gl.pay_arr || 0), 0);
    const terminalsCount = monthGoLives.filter(gl => gl.has_terminal).length;
    
    monthlyPerf.push({
      month: m,
      year: currentYear,
      subsTarget,
      subsActual,
      subsAchievement: subsTarget > 0 ? subsActual / subsTarget : 0,
      payTarget,
      payActual,
      goLivesCount: monthGoLives.length,
      terminalsCount,
      terminalPenetration: monthGoLives.length > 0 ? terminalsCount / monthGoLives.length : 0,
      provision: 0, // Wird später berechnet wenn nötig
    });
  }

  // 1. First Blood - Erster Go-Live
  if (goLives.length > 0) {
    earnedBadges.push({
      badge: ALL_BADGES.find(b => b.id === 'first_blood')!,
      earnedAt: new Date(),
      details: `${goLives.length} Go-Lives total`,
    });
  }

  // 2. Hot Streak - 3 Monate in Folge über 100%
  let streak = 0;
  let maxStreak = 0;
  for (const perf of monthlyPerf) {
    if (perf.month <= currentMonth && perf.subsAchievement >= 1.0) {
      streak++;
      maxStreak = Math.max(maxStreak, streak);
    } else {
      streak = 0;
    }
  }
  if (maxStreak >= 3) {
    earnedBadges.push({
      badge: ALL_BADGES.find(b => b.id === 'hot_streak')!,
      earnedAt: new Date(),
      details: `${maxStreak} Monate Streak`,
    });
  }

  // 3. Diamond Closer - Über 120% in einem Monat
  const diamondMonth = monthlyPerf.find(p => p.month <= currentMonth && p.subsAchievement >= 1.2);
  if (diamondMonth) {
    earnedBadges.push({
      badge: ALL_BADGES.find(b => b.id === 'diamond_closer')!,
      earnedAt: new Date(),
      month: diamondMonth.month,
      details: `${Math.round(diamondMonth.subsAchievement * 100)}% erreicht`,
    });
  }

  // 4. Sharpshooter - 5 Monate hintereinander Ziel erreicht
  let targetStreak = 0;
  let maxTargetStreak = 0;
  for (const perf of monthlyPerf) {
    if (perf.month <= currentMonth && perf.subsAchievement >= 1.0) {
      targetStreak++;
      maxTargetStreak = Math.max(maxTargetStreak, targetStreak);
    } else if (perf.subsTarget > 0) {
      targetStreak = 0;
    }
  }
  if (maxTargetStreak >= 5) {
    earnedBadges.push({
      badge: ALL_BADGES.find(b => b.id === 'sharpshooter')!,
      earnedAt: new Date(),
      details: `${maxTargetStreak} Monate perfekt`,
    });
  }

  // 5. Speed Demon - Meiste Go-Lives (mindestens 15 in einem Monat)
  const maxGoLivesMonth = monthlyPerf
    .filter(p => p.month <= currentMonth)
    .reduce((max, p) => p.goLivesCount > max.goLivesCount ? p : max, monthlyPerf[0]);
  if (maxGoLivesMonth && maxGoLivesMonth.goLivesCount >= 15) {
    earnedBadges.push({
      badge: ALL_BADGES.find(b => b.id === 'speed_demon')!,
      earnedAt: new Date(),
      month: maxGoLivesMonth.month,
      details: `${maxGoLivesMonth.goLivesCount} Go-Lives`,
    });
  }

  // 6. Terminal Titan - Über 80% Terminal-Penetration (min 5 Go-Lives)
  const titanMonth = monthlyPerf.find(
    p => p.month <= currentMonth && p.goLivesCount >= 5 && p.terminalPenetration >= 0.8
  );
  if (titanMonth) {
    earnedBadges.push({
      badge: ALL_BADGES.find(b => b.id === 'terminal_titan')!,
      earnedAt: new Date(),
      month: titanMonth.month,
      details: `${Math.round(titanMonth.terminalPenetration * 100)}% Penetration`,
    });
  }

  // 7. Centurion - 100 Go-Lives insgesamt
  if (goLives.length >= 100) {
    earnedBadges.push({
      badge: ALL_BADGES.find(b => b.id === 'centurion')!,
      earnedAt: new Date(),
      details: `${goLives.length} Go-Lives total`,
    });
  }

  // 8. Rising Star - Größte Verbesserung vs. Vormonat (mindestens +30%)
  for (let i = 1; i < monthlyPerf.length && monthlyPerf[i].month <= currentMonth; i++) {
    const prev = monthlyPerf[i - 1];
    const curr = monthlyPerf[i];
    if (prev.subsActual > 0 && curr.subsActual > 0) {
      const improvement = (curr.subsActual - prev.subsActual) / prev.subsActual;
      if (improvement >= 0.3) {
        earnedBadges.push({
          badge: ALL_BADGES.find(b => b.id === 'rising_star')!,
          earnedAt: new Date(),
          month: curr.month,
          details: `+${Math.round(improvement * 100)}% Verbesserung`,
        });
        break;
      }
    }
  }

  // 9. OTE Champion - YTD über OTE
  const ytdSubs = monthlyPerf
    .filter(p => p.month <= currentMonth)
    .reduce((sum, p) => sum + p.subsActual, 0);
  const ytdTarget = monthlyPerf
    .filter(p => p.month <= currentMonth)
    .reduce((sum, p) => sum + p.subsTarget, 0);
  // Vereinfacht: Wenn YTD Subs > YTD Target = OTE erreicht
  if (ytdTarget > 0 && ytdSubs >= ytdTarget) {
    earnedBadges.push({
      badge: ALL_BADGES.find(b => b.id === 'ote_champion')!,
      earnedAt: new Date(),
      details: `${Math.round((ytdSubs / ytdTarget) * 100)}% OTE`,
    });
  }

  // Badges die Vergleich mit anderen brauchen (nur wenn Daten vorhanden)
  if (allUsersData && allUsersData.size > 1) {
    // 10. Monthly King - #1 in einem Monat
    for (let m = 1; m <= currentMonth; m++) {
      let isKing = true;
      const userMonthSubs = monthlyPerf[m - 1]?.subsActual || 0;
      
      if (userMonthSubs === 0) continue;
      
      for (const [otherId, otherData] of allUsersData) {
        if (otherId === user.id) continue;
        const otherMonthGoLives = otherData.goLives.filter(gl => gl.month === m);
        const otherSubs = otherMonthGoLives.reduce((sum, gl) => sum + gl.subs_arr, 0);
        if (otherSubs > userMonthSubs) {
          isKing = false;
          break;
        }
      }
      
      if (isKing) {
        earnedBadges.push({
          badge: ALL_BADGES.find(b => b.id === 'monthly_king')!,
          earnedAt: new Date(),
          month: m,
          details: `#1 im Monat`,
        });
        break; // Nur einmal vergeben
      }
    }

    // 11. Rocket Start - Bester im ersten Monat (Januar)
    const janGoLives = goLives.filter(gl => gl.month === 1);
    const janSubs = janGoLives.reduce((sum, gl) => sum + gl.subs_arr, 0);
    
    if (janSubs > 0) {
      let isBestJan = true;
      for (const [otherId, otherData] of allUsersData) {
        if (otherId === user.id) continue;
        const otherJanSubs = otherData.goLives
          .filter(gl => gl.month === 1)
          .reduce((sum, gl) => sum + gl.subs_arr, 0);
        if (otherJanSubs > janSubs) {
          isBestJan = false;
          break;
        }
      }
      
      if (isBestJan) {
        earnedBadges.push({
          badge: ALL_BADGES.find(b => b.id === 'rocket_start')!,
          earnedAt: new Date(),
          month: 1,
          details: `Bester Januar`,
        });
      }
    }

    // 12. Money Maker - Höchste Provision in einem Monat
    // Vereinfacht: Höchste Subs ARR = höchste Provision
    const maxSubsMonth = monthlyPerf
      .filter(p => p.month <= currentMonth)
      .reduce((max, p) => p.subsActual > max.subsActual ? p : max, monthlyPerf[0]);
    
    if (maxSubsMonth && maxSubsMonth.subsActual > 0) {
      let isMoneyMaker = true;
      for (const [otherId, otherData] of allUsersData) {
        if (otherId === user.id) continue;
        for (let m = 1; m <= currentMonth; m++) {
          const otherMonthSubs = otherData.goLives
            .filter(gl => gl.month === m)
            .reduce((sum, gl) => sum + gl.subs_arr, 0);
          if (otherMonthSubs > maxSubsMonth.subsActual) {
            isMoneyMaker = false;
            break;
          }
        }
        if (!isMoneyMaker) break;
      }
      
      if (isMoneyMaker) {
        earnedBadges.push({
          badge: ALL_BADGES.find(b => b.id === 'money_maker')!,
          earnedAt: new Date(),
          month: maxSubsMonth.month,
          details: `Top Provision`,
        });
      }
    }
  }

  return earnedBadges;
}

// Prüfe auf neue Badges (für Konfetti-Trigger)
export function checkForNewBadges(
  previousBadges: EarnedBadge[],
  currentBadges: EarnedBadge[]
): EarnedBadge[] {
  const previousIds = new Set(previousBadges.map(b => b.badge.id));
  return currentBadges.filter(b => !previousIds.has(b.badge.id));
}
