// Types für das DACH Kompensationsmodell v3.7

export type UserRole = 'country_manager' | 'line_manager' | 'ae' | 'sdr' | 'sonstiges' | 'head_of_partnerships';

// Helper um planbare Rollen zu identifizieren (haben Targets & Provisions-Berechnung)
export const PLANNABLE_ROLES: UserRole[] = ['ae'];

export const isPlannable = (role: UserRole): boolean => PLANNABLE_ROLES.includes(role);

// Rollen die Go-Lives erhalten können (für ARR-Tracking)
export const CAN_RECEIVE_GO_LIVES: UserRole[] = ['ae', 'line_manager', 'country_manager', 'sonstiges'];

export const canReceiveGoLives = (role: UserRole): boolean => CAN_RECEIVE_GO_LIVES.includes(role);

// Default für commission_relevant basierend auf Rolle
export const getDefaultCommissionRelevant = (role: UserRole): boolean => {
  return role === 'ae'; // Nur AE-Go-Lives sind standardmäßig provisions-relevant
};

export interface User {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  language?: string;
  created_at: string;
  // Profil-Erweiterungen (Stufe 2)
  employee_id?: string;
  phone?: string;
  region?: string;
  start_date?: string;
  manager_id?: string;
  photo_url?: string;
}

export interface UserProfile extends User {
  // Berechnete/verknüpfte Daten
  manager?: User;
  team_members?: User[];
}

export interface AESettings {
  id: string;
  user_id: string;
  year: number;
  region: string;
  
  // Grundeinstellungen
  ote: number;                      // On-Target Earnings (€57.000)
  
  // Go-Lives pro Monat (für Zielberechnung)
  monthly_go_live_targets: number[];  // 12 Werte [25, 30, 32, 49, ...]
  
  // Durchschnittliche Monatsumsätze
  avg_subs_bill: number;            // €155 pro Kunde/Monat
  avg_pay_bill: number;             // €162 pro Kunde/Monat
  pay_arr_factor: number;           // 0.75 = 75% vom Subs
  
  // Berechnete monatliche ARR-Ziele (wird aus Go-Lives berechnet)
  monthly_subs_targets: number[];   // 12 Werte
  monthly_pay_targets: number[];    // 12 Werte
  
  // Terminal-Provisionen
  terminal_base: number;            // €30
  terminal_bonus: number;           // €50 bei ≥70% Penetration
  terminal_penetration_threshold: number; // 0.70
  
  // Provisions-Stufen (frei editierbar)
  subs_tiers: ProvisionTier[];
  pay_tiers: ProvisionTier[];
  
  created_at: string;
  updated_at: string;
}

export interface ProvisionTier {
  label: string;
  min: number;
  max: number;
  rate: number;
}

export interface GoLive {
  id: string;
  user_id: string;
  year: number;
  month: number;
  customer_name: string;
  oak_id: number | null;        // OAK ID (nummerisch)
  go_live_date: string;
  subs_monthly: number;      // Monatlicher Subs-Betrag
  subs_arr: number;          // = subs_monthly * 12
  has_terminal: boolean;
  pay_arr: number | null;    // Wird nach 3 Monaten eingetragen
  commission_relevant: boolean; // Provisions-relevant ja/nein
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface MonthlyResult {
  month: number;
  month_name: string;
  // Go-Lives
  go_lives_count: number;
  go_lives_target: number;
  terminals_count: number;
  terminal_penetration: number;
  // Subs ARR
  subs_target: number;
  subs_actual: number;
  subs_achievement: number;
  subs_rate: number;
  subs_provision: number;
  // Terminal
  terminal_rate: number;
  terminal_provision: number;
  // Pay ARR
  pay_target: number;
  pay_actual: number;
  pay_achievement: number;
  pay_rate: number;
  pay_provision: number;
  // Totals
  m0_provision: number;  // Subs + Terminal
  m3_provision: number;  // Pay
  total_provision: number;
}

export interface YearSummary {
  total_go_lives: number;
  total_go_lives_target: number;
  total_terminals: number;
  total_subs_target: number;
  total_subs_actual: number;
  total_subs_achievement: number;
  total_pay_target: number;
  total_pay_actual: number;
  total_pay_achievement: number;
  total_m0_provision: number;
  total_m3_provision: number;
  total_provision: number;
  monthly_results: MonthlyResult[];
}

// OTE Projektion für verschiedene Zielerreichungs-Szenarien
export interface OTEProjection {
  scenario: string;           // "100% - 110%", "110% - 120%", "120%+"
  factor: number;             // 1.05, 1.15, 1.25
  expected_subs_arr: number;
  expected_pay_arr: number;
  expected_total_arr: number;
  subs_provision: number;
  terminal_provision: number;
  pay_provision: number;
  total_provision: number;
  ote_match: boolean;         // Passt zum OTE?
}

export const MONTH_NAMES = [
  'Januar', 'Februar', 'März', 'April', 'Mai', 'Juni',
  'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'
];

// Default DACH Subs ARR Provisions-Stufen (NEU - aus Excel Screenshot)
export const DEFAULT_SUBS_TIERS: ProvisionTier[] = [
  { label: '< 50%', min: 0, max: 0.5, rate: 0 },
  { label: '50% - 70%', min: 0.5, max: 0.7, rate: 0.015 },
  { label: '70% - 85%', min: 0.7, max: 0.85, rate: 0.02 },
  { label: '85% - 100%', min: 0.85, max: 1.0, rate: 0.025 },
  { label: '100% - 110%', min: 1.0, max: 1.1, rate: 0.029 },
  { label: '110% - 120%', min: 1.1, max: 1.2, rate: 0.04 },
  { label: '120%+', min: 1.2, max: 999, rate: 0.05 },
];

// Default DACH Pay ARR Provisions-Stufen (NEU - aus Excel Screenshot)
export const DEFAULT_PAY_TIERS: ProvisionTier[] = [
  { label: '< 50%', min: 0, max: 0.5, rate: 0.01 },
  { label: '50% - 70%', min: 0.5, max: 0.7, rate: 0.015 },
  { label: '70% - 85%', min: 0.7, max: 0.85, rate: 0.02 },
  { label: '85% - 100%', min: 0.85, max: 1.0, rate: 0.025 },
  { label: '100% - 110%', min: 1.0, max: 1.1, rate: 0.029 },
  { label: '110% - 120%', min: 1.1, max: 1.2, rate: 0.04 },
  { label: '120%+', min: 1.2, max: 999, rate: 0.05 },
];

// Default Go-Lives pro Monat (aus Excel Screenshot)
export const DEFAULT_MONTHLY_GO_LIVE_TARGETS = [
  25, 30, 32, 49, 39, 32, 31, 28, 48, 48, 45, 18
];

// Default Grundeinstellungen
export const DEFAULT_SETTINGS = {
  ote: 57000,
  avg_subs_bill: 155,
  avg_pay_bill: 162,
  pay_arr_factor: 0.75,
  terminal_base: 30,
  terminal_bonus: 50,
  terminal_penetration_threshold: 0.70,
};

// Berechnet monatliche Subs ARR Ziele aus Go-Lives
export function calculateMonthlySubsTargets(goLiveTargets: number[], avgSubsBill: number): number[] {
  return goLiveTargets.map(gl => gl * avgSubsBill * 12);
}

// Berechnet monatliche Pay ARR Ziele aus Subs Zielen
export function calculateMonthlyPayTargets(subsTargets: number[], payArrFactor: number): number[] {
  return subsTargets.map(subs => Math.round(subs * payArrFactor));
}

// ============================================
// CHALLENGES
// ============================================

export type ChallengeType = 'team' | 'individual' | 'streak';
export type ChallengeMetric = 'go_lives' | 'subs_arr' | 'pay_arr' | 'total_arr' | 'terminals' | 'achievement' | 'premium_go_lives' | 'daily_go_live';
export type ChallengeRewardType = 'badge' | 'points' | 'custom';

export interface Challenge {
  id: string;
  name: string;
  description: string | null;
  icon: string;
  type: ChallengeType;
  metric: ChallengeMetric;
  target_value: number;
  start_date: string;
  end_date: string;
  reward_type: ChallengeRewardType;
  reward_value: string | null;
  is_active: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  // Streak-spezifische Felder (optional)
  streak_min_per_day?: number;  // Mindestanzahl pro Tag für Streak
}

export interface ChallengeProgress {
  challenge: Challenge;
  current_value: number;
  target_value: number;
  progress_percent: number;
  days_remaining: number;
  is_completed: boolean;
  // Für individual challenges: Fortschritt pro User
  user_progress?: Map<string, number>;
  // Für streak challenges
  current_streak?: number;
  best_streak?: number;
  streak_days?: boolean[];  // Array von Tagen (true = Ziel erreicht)
}

export const CHALLENGE_METRICS: Record<ChallengeMetric, { label: string; unit: string }> = {
  go_lives: { label: 'Go-Lives', unit: '' },
  subs_arr: { label: 'Subs ARR', unit: '€' },
  pay_arr: { label: 'Pay ARR', unit: '€' },
  total_arr: { label: 'Total ARR', unit: '€' },
  terminals: { label: 'Terminals', unit: '' },
  achievement: { label: 'Zielerreichung', unit: '%' },
  premium_go_lives: { label: 'Premium Go-Lives (>€200/M)', unit: '' },
  daily_go_live: { label: 'Täglicher Go-Live', unit: 'Tage' },
};

export const CHALLENGE_ICONS = ['🎯', '🏃', '💎', '🚀', '⭐', '🏆', '🔥', '💪', '🎪', '🎲', '📅', '⚡'];
