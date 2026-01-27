// Types für Commercial Business Planner v4.0

// ============================================
// BEREICHE (Business Areas)
// ============================================
export type BusinessArea = 'dlt' | 'new_business' | 'expanding_business' | 'marketing';

export const BUSINESS_AREAS: BusinessArea[] = ['dlt', 'new_business', 'expanding_business', 'marketing'];

export const BUSINESS_AREA_LABELS: Record<BusinessArea, string> = {
  dlt: 'DLT',
  new_business: 'New Business',
  expanding_business: 'Expanding Business',
  marketing: 'Marketing'
};

export const BUSINESS_AREA_DESCRIPTIONS: Record<BusinessArea, string> = {
  dlt: 'Digital Leadership Team - Führungsebene mit Zugriff auf alle Bereiche',
  new_business: 'Neukundengewinnung - Sales Team für neue Kunden',
  expanding_business: 'Bestandskundenentwicklung - Customer Success Team',
  marketing: 'Marketing - Leadgenerierung und Markenbildung'
};

// ============================================
// ROLLEN
// ============================================
export type UserRole = 
  // Superuser
  | 'country_manager'
  // DLT
  | 'dlt_member'
  // New Business
  | 'line_manager_new_business'
  | 'ae_subscription_sales'
  | 'ae_payments'
  | 'commercial_director'
  | 'head_of_partnerships'
  // Expanding Business
  | 'head_of_expanding_revenue'
  | 'cs_account_executive'
  | 'cs_account_manager'
  | 'cs_sdr'
  // Marketing
  | 'head_of_marketing'
  | 'marketing_specialist'
  | 'marketing_executive'
  | 'demand_generation_specialist'
  // Legacy/Sonstige
  | 'sonstiges';

// Mapping: Welche Rolle gehört zu welchem Bereich
export const ROLE_TO_AREA: Record<UserRole, BusinessArea[]> = {
  // Superuser - alle Bereiche + Debug
  country_manager: ['dlt', 'new_business', 'expanding_business', 'marketing'],
  // DLT - alle Bereiche
  dlt_member: ['dlt', 'new_business', 'expanding_business', 'marketing'],
  // New Business
  line_manager_new_business: ['new_business'],
  ae_subscription_sales: ['new_business'],
  ae_payments: ['new_business'],
  commercial_director: ['new_business'],
  head_of_partnerships: ['new_business'],
  // Expanding Business
  head_of_expanding_revenue: ['expanding_business'],
  cs_account_executive: ['expanding_business'],
  cs_account_manager: ['expanding_business'],
  cs_sdr: ['expanding_business'],
  // Marketing
  head_of_marketing: ['marketing'],
  marketing_specialist: ['marketing'],
  marketing_executive: ['marketing'],
  demand_generation_specialist: ['marketing'],
  // Sonstige
  sonstiges: ['new_business'], // Default zu New Business
};

// Helper: Kann User auf Bereich zugreifen?
export const canAccessArea = (role: UserRole, area: BusinessArea): boolean => {
  return ROLE_TO_AREA[role]?.includes(area) ?? false;
};

// Helper: Alle Bereiche für eine Rolle
export const getAreasForRole = (role: UserRole): BusinessArea[] => {
  return ROLE_TO_AREA[role] ?? [];
};

// Helper um planbare Rollen zu identifizieren (haben Targets & Provisions-Berechnung)
// New Business AEs
export const PLANNABLE_ROLES: UserRole[] = ['ae_subscription_sales', 'ae_payments'];

export const isPlannable = (role: UserRole): boolean => PLANNABLE_ROLES.includes(role);

// Rollen die Go-Lives erhalten können (für ARR-Tracking)
export const CAN_RECEIVE_GO_LIVES: UserRole[] = [
  'ae_subscription_sales', 
  'ae_payments', 
  'line_manager_new_business', 
  'country_manager',
  'dlt_member',
  'commercial_director',
  'head_of_partnerships',
  'sonstiges'
];

export const canReceiveGoLives = (role: UserRole): boolean => CAN_RECEIVE_GO_LIVES.includes(role);

// Default für commission_relevant basierend auf Rolle
export const getDefaultCommissionRelevant = (role: UserRole): boolean => {
  // Nur AE-Rollen sind standardmäßig provisions-relevant
  return role === 'ae_subscription_sales' || role === 'ae_payments';
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
  
  // Go-Lives pro Monat (für Zielberechnung) - Legacy: Summe aller Kategorien
  monthly_go_live_targets: number[];  // 12 Werte [25, 30, 32, 49, ...]
  
  // NEU: Go-Lives aufgeteilt nach Kategorien (12 Werte pro Kategorie)
  monthly_inbound_targets?: number[];      // Inbound Go-Lives
  monthly_outbound_targets?: number[];     // Outbound Go-Lives
  monthly_partnerships_targets?: number[]; // Partnerships Go-Lives
  
  // NEU: Prozentuale Verteilung der Business Targets auf diesen AE
  target_percentage?: number;              // z.B. 60 = 60% der Business Targets
  
  // Durchschnittliche Monatsumsätze
  avg_subs_bill: number;            // €155 pro Kunde/Monat
  avg_pay_bill: number;             // €50 pro Terminal/Monat (für Terminal Sales)
  avg_pay_bill_tipping?: number;    // €30 pro Tipping-Terminal/Monat
  pay_arr_factor: number;           // 0.75 = 75% vom Subs (optional, für Legacy)
  
  // Berechnete monatliche ARR-Ziele (Subs wird aus Go-Lives berechnet)
  monthly_subs_targets: number[];   // 12 Werte - berechnet: Go-Lives × avg_subs_bill × 12
  monthly_pay_targets: number[];    // 12 Werte - NEU: direkt aus Sheet ODER berechnet
  
  // NEU: Pay ARR Targets direkt aus Google Sheet (ersetzt Berechnung)
  monthly_pay_arr_targets?: number[];  // 12 Werte - direkt importiert aus Sheet
  
  // Terminal-Provisionen
  terminal_base: number;            // €30
  terminal_bonus: number;           // €50 bei ≥70% Penetration
  terminal_penetration_threshold: number; // 0.70
  
  // Provisions-Stufen (frei editierbar)
  subs_tiers: ProvisionTier[];
  pay_tiers: ProvisionTier[];
  
  // NEU: Google Sheets Integration
  google_sheet_url?: string;        // URL zum Google Sheet
  use_google_sheet?: boolean;       // true = aus Sheet laden, false = manuell
  last_sheet_sync?: string;         // Zeitstempel der letzten Synchronisation
  
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
  pay_arr_target: number | null;  // NEU: Pay ARR Target bei Go-Live (aus avg_pay_bill_terminal × 12)
  pay_arr: number | null;    // Pay ARR Ist (nach 3 Monaten eintragen)
  commission_relevant: boolean; // Provisions-relevant ja/nein
  // NEU: Partnership & Enterprise Zuordnung
  partner_id: string | null;    // Partner-ID für Partnership-Deals
  is_enterprise: boolean;       // Filialunternehmen (≥5 Filialen)
  // NEU: Subscription Package
  subscription_package_id: string | null;  // Subscription-Paket (Kickstart, Power, etc.)
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
  // Pay ARR - Target (M0)
  pay_arr_target_total: number;     // Summe aller pay_arr_target bei Go-Live
  pay_target: number;               // Monatliches Pay Target aus Settings
  pay_m0_achievement: number;       // pay_arr_target_total / pay_target
  pay_m0_rate: number;              // Provisions-Rate für M0
  pay_m0_provision: number;         // M0 Provision auf Target-Basis
  // Pay ARR - Ist (M3)
  pay_actual: number;               // Tatsächlicher Pay ARR (nach 3 Monaten)
  pay_achievement: number;          // pay_actual / pay_target
  pay_rate: number;                 // Provisions-Rate für Ist
  pay_provision: number;            // Volle Provision auf Ist-Basis
  // Clawback (M3)
  pay_clawback_base: number;        // Differenz: pay_arr_target_total - pay_actual (wenn positiv)
  pay_clawback: number;             // Clawback-Betrag: pay_clawback_base × rate
  // Totals
  m0_provision: number;             // Subs + Terminal + Pay M0
  m3_provision: number;             // Pay Ist - Pay M0 (kann negativ sein = Clawback)
  total_provision: number;          // m0_provision + m3_provision
}

export interface YearSummary {
  total_go_lives: number;
  total_go_lives_target: number;
  total_terminals: number;
  total_subs_target: number;
  total_subs_actual: number;
  total_subs_achievement: number;
  // Pay Target (M0)
  total_pay_arr_target: number;     // Summe aller pay_arr_target bei Go-Live
  total_pay_target: number;         // Summe aller Pay Targets aus Settings
  total_pay_m0_provision: number;   // M0 Provision auf Target-Basis
  // Pay Ist (M3)
  total_pay_actual: number;
  total_pay_achievement: number;
  // Clawback
  total_pay_clawback_base: number;  // Summe der Differenzen (Target - Ist)
  total_pay_clawback: number;       // Summe aller Clawbacks
  // Totals
  total_m0_provision: number;       // Subs + Terminal + Pay M0
  total_m3_provision: number;       // Pay Ist Differenz (kann negativ = Clawback sein)
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

// Default Go-Lives Kategorien (Summe = DEFAULT_MONTHLY_GO_LIVE_TARGETS)
export const DEFAULT_MONTHLY_INBOUND_TARGETS = [
  15, 18, 19, 30, 24, 19, 19, 17, 29, 29, 27, 11
];
export const DEFAULT_MONTHLY_OUTBOUND_TARGETS = [
  5, 6, 6, 10, 8, 7, 6, 6, 10, 10, 9, 4
];
export const DEFAULT_MONTHLY_PARTNERSHIPS_TARGETS = [
  5, 6, 7, 9, 7, 6, 6, 5, 9, 9, 9, 3
];

// Default Grundeinstellungen
export const DEFAULT_SETTINGS = {
  ote: 57000,
  avg_subs_bill: 155,
  avg_pay_bill: 50,              // €50 pro Terminal/Monat
  avg_pay_bill_tipping: 30,     // €30 pro Tipping-Terminal/Monat
  pay_arr_factor: 0.75,
  terminal_base: 30,
  terminal_bonus: 50,
  terminal_penetration_threshold: 0.70,
};

// Berechnet monatliche Subs ARR Ziele aus Go-Lives
export function calculateMonthlySubsTargets(goLiveTargets: number[], avgSubsBill: number): number[] {
  return goLiveTargets.map(gl => gl * avgSubsBill * 12);
}

// Berechnet monatliche Pay ARR Ziele aus Subs Zielen (Legacy-Modus)
export function calculateMonthlyPayTargets(subsTargets: number[], payArrFactor: number): number[] {
  return subsTargets.map(subs => Math.round(subs * payArrFactor));
}

// NEU: Berechnet Go-Lives Summe aus den drei Kategorien
export function calculateTotalGoLives(
  inbound: number[],
  outbound: number[],
  partnerships: number[]
): number[] {
  return inbound.map((val, i) => val + (outbound[i] || 0) + (partnerships[i] || 0));
}

// NEU: Google Sheet URL zu CSV Export URL konvertieren
export function googleSheetToCsvUrl(sheetUrl: string): string | null {
  // Extrahiere Sheet ID aus verschiedenen URL-Formaten
  const match = sheetUrl.match(/\/d\/([a-zA-Z0-9-_]+)/);
  if (!match) return null;
  
  const sheetId = match[1];
  return `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:csv`;
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
